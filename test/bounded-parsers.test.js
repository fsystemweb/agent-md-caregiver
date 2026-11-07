import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { parseCommandSegment } from '../src/parse/commands.js';
import { parseMakeTargets } from '../src/repo/makefile.js';
import { clampLines, MAX_LINE_LENGTH, MAX_TEXT_BYTES, readTextInside } from '../src/repo/safe-read.js';
import { parseToml } from '../src/repo/toml.js';
import { closestName, distance } from '../src/rules/lib/suggest.js';
import { makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const time = (fn) => {
  const t = process.hrtime.bigint();
  const r = fn();
  return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};

/** Previous implementation of parseMakeTargets, the oracle for the equivalence test. */
function oracleTargets(text) {
  const ASSIGNMENT = /^\s*(?:export\s+|override\s+)?[A-Za-z0-9_.-]+\s*(?:::?:?|[?+!])?=/;
  const TARGET = /^([^\s:#=$%][^:#=$%]*?)\s*::?(?!=)/;
  const PHONY = /^\.PHONY\s*:(.*)$/;
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('\t') || /^\s*#/.test(line)) continue;
    const phony = PHONY.exec(line);
    if (phony) {
      for (const name of phony[1].split('#')[0].split(/\s+/)) if (name && !/[$%]/.test(name)) targets.add(name);
      continue;
    }
    if (ASSIGNMENT.test(line)) continue;
    const m = TARGET.exec(line);
    if (!m) continue;
    for (const name of m[1].split(/\s+/)) if (name && !name.startsWith('.') && !/[$%]/.test(name)) targets.add(name);
  }
  return [...targets].sort();
}

describe('Makefile targets (security audit: quadratic TARGET regex)', () => {
  test('same targets as the old regex on 4000 random Makefiles', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const bits = ['a', 'b', 'all', 'test', ' ', ' ', ':', ':', '::', '=', ':=', '#', '$', '%', '\t', '.PHONY', '.x', '-'];
    for (let n = 0; n < 4000; n++) {
      const text = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () =>
        Array.from({ length: Math.floor(rnd() * 8) }, () => pick(bits)).join(''),
      ).join('\n');
      assert.deepEqual(parseMakeTargets(text), oracleTargets(text), JSON.stringify(text));
    }
  });

  test('ordinary Makefiles', () => {
    const text = '.PHONY: build test\nbuild test: deps\n\tcc\nVAR := 1\nall:\nfoo::\n$(X): y\n%.o: %.c\n';
    assert.deepEqual(parseMakeTargets(text), ['all', 'build', 'foo', 'test']);
  });

  test('a hostile line of whitespace is cheap', () => {
    const { r, ms } = time(() => parseMakeTargets(`a${' '.repeat(400000)}b\nall:\n`));
    assert.deepEqual(r, ['all']);
    assert.ok(ms < 200, `took ${ms} ms`);
  });
});

describe('TOML multi-line strings (security audit: rescan on every line)', () => {
  test('closed strings still parse, in both quote styles and with text after the close', () => {
    const t = parseToml('a = """\nline1\nline2"""\nb = \'\'\'\nx\n\'\'\'\n[t]\nc = 1\n');
    assert.ok(t.tables.get('').get('a').includes('line2'));
    assert.ok(t.tables.get('').has('b'));
    assert.equal(t.tables.get('t').get('c'), '1');
    assert.ok(parseToml('d = """one line"""\n') !== null);
  });

  test('an unclosed string is null, and a huge one is cheap', () => {
    assert.equal(parseToml('a = """\nnever closed\n'), null);
    const { r, ms } = time(() => parseToml(`k = """\n${'\n'.repeat(400000)}`));
    assert.equal(r, null);
    assert.ok(ms < 300, `took ${ms} ms`);
  });
});

describe('claim extraction on hostile lines (security audit: whitespace regexes, edit distance)', () => {
  const md = (body) => `# A\n\n\`\`\`bash\n${body}\n\`\`\`\n`;
  function lint(files) {
    const r = makeRepo(files);
    cleanups.push(r.cleanup);
    let stdout = '';
    const code = run(['--format', 'json'], { stdout: { write: (s) => (stdout += s) }, stderr: { write() {} }, cwd: r.root, env: {} });
    return { code, report: JSON.parse(stdout), root: r.root };
  }
  const PKG = JSON.stringify({ scripts: { build: 'echo' } });

  test('comments after a command are still stripped, and a plain hash is kept', () => {
    assert.equal(parseCommandSegment('npm run build  # why', true).text, 'npm run build');
    assert.equal(parseCommandSegment('npm run build', true).text, 'npm run build');
    assert.equal(parseCommandSegment('npm run a#b', true).text, 'npm run a#b');
  });

  test('a command followed by 80000 spaces, and a cd with 80000 spaces, finish quickly', () => {
    for (const body of [`npm run x${' '.repeat(80000)}y`, `cd a${' '.repeat(80000)}b\nnpm run build`]) {
      const { ms } = time(() => lint({ 'AGENTS.md': md(body), 'package.json': PKG }));
      assert.ok(ms < 1500, `took ${ms} ms`);
    }
  });

  test('cd still tracks directories, with trailing spaces', () => {
    const { report } = lint({ 'AGENTS.md': md('cd sub   \nnpm run nope'), 'package.json': PKG, 'sub/package.json': JSON.stringify({ scripts: { ok: 'x' } }) });
    const f = report.findings.find((x) => x.ruleId === 'AMC001');
    assert.ok(f && f.message.includes('nope'), JSON.stringify(report.findings));
  });

  test('very long names do not build a huge edit-distance table', () => {
    const long = 'a'.repeat(20000);
    const { r, ms } = time(() => [distance(long, `${long}b`), closestName(long, [`${long}b`, 'build'])]);
    assert.ok(r[0] >= 20000);
    assert.equal(r[1], null);
    assert.ok(ms < 100, `took ${ms} ms`);
    assert.equal(distance('buidl', 'build'), 1, 'short names still work');
  });

  test('20000 backslash continuation lines are bounded', () => {
    const body = `npm run build ${'\\\n'.repeat(20000)}x`;
    const { ms } = time(() => lint({ 'AGENTS.md': md(body), 'package.json': PKG }));
    assert.ok(ms < 1500, `took ${ms} ms`);
  });
});

describe('input size limits', () => {
  test('clampLines cuts long lines and keeps the line count', () => {
    const text = `short\n${'x'.repeat(MAX_LINE_LENGTH + 500)}\nend`;
    const out = clampLines(text);
    assert.equal(out.split('\n').length, 3);
    assert.equal(out.split('\n')[1].length, MAX_LINE_LENGTH);
    assert.equal(clampLines('a\nb'), 'a\nb');
  });

  test('a file over the size cap is not read; one under it is', () => {
    const r = makeRepo({ 'small.txt': 'ok' });
    cleanups.push(r.cleanup);
    writeFileSync(join(r.root, 'big.txt'), 'x'.repeat(MAX_TEXT_BYTES + 1));
    assert.equal(readTextInside(r.root, 'small.txt'), 'ok');
    assert.equal(readTextInside(r.root, 'big.txt'), null);
  });

  test('a long line in an instruction file is cut in the evidence and keeps its line number', () => {
    const r = makeRepo({ 'AGENTS.md': `# A\n\nRun the tests ${'x'.repeat(9000)}\n` });
    cleanups.push(r.cleanup);
    let stdout = '';
    run(['--format', 'json'], { stdout: { write: (s) => (stdout += s) }, stderr: { write() {} }, cwd: r.root, env: {} });
    const f = JSON.parse(stdout).findings.find((x) => x.evidence.startsWith('Run the tests'));
    assert.ok(f, stdout.slice(0, 500));
    assert.equal(f.line, 3);
    assert.ok(f.evidence.length <= MAX_LINE_LENGTH);
  });
});
