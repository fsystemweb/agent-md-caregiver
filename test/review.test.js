import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { makeRepo } from './helpers/make-repo.js';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SNAPSHOT = new URL('./snapshots/agent-handoff.json', import.meta.url);

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const AGENTS = [
  '# Acme',
  '',
  '## Commands',
  '- Test: `npm test`',
  '',
  '```sh',
  'cd ../elsewhere',
  'npm run build',
  '```',
  '',
  '- Build: `npm run build --if-present`',
  '- Ship: `make -C deploy release`',
  '',
  '## Style',
  'We care a lot about quality here.',
  'Reviews are friendly and fast.',
  'Everyone is welcome to propose changes.',
  '',
  '## Data',
  '- Always keep database migrations in sync with the schema files.',
  '- Never keep database migrations in sync with the schema files automatically.',
  '- Keep components small and follow the existing style.',
  '- Use `src/missing.js` as the entry.',
  '',
].join('\n');

const FILES = {
  'AGENTS.md': AGENTS,
  'package.json': '{"scripts":{"test":"x","build":"y"}}',
  'Makefile': 'release:\n\techo\n',
};

/** @param {string[]} argv @param {Record<string, string>} [files] */
function cli(argv, files = FILES) {
  const r = makeRepo(files);
  cleanups.push(r.cleanup);
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    cwd: r.root,
    env: {},
  });
  return { code, stdout, stderr };
}

describe('--format agent', () => {
  const { stdout } = cli(['--format', 'agent']);
  const doc = JSON.parse(stdout);

  test('matches the committed snapshot', () => {
    const actual = stdout.replace(`"version": "${PKG.version}"`, '"version": "__VERSION__"');
    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(SNAPSHOT, actual);
    assert.equal(actual, readFileSync(SNAPSHOT, 'utf8'));
  });

  test('is deterministic, versioned, and has the documented shape', () => {
    assert.equal(cli(['--format', 'agent']).stdout, stdout);
    assert.deepEqual(Object.keys(doc), ['schemaVersion', 'kind', 'tool', 'guidance', 'files', 'deterministic', 'items', 'summary']);
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.kind, 'review-handoff');
    assert.equal(doc.guidance.advisory, true);
    assert.deepEqual(Object.keys(doc.items[0]), ['id', 'kind', 'file', 'line', 'col', 'context', 'related', 'reason', 'question']);
    assert.ok(!stdout.includes(process.cwd()), 'no absolute paths');
    assert.deepEqual(doc.items.map((i) => i.id), doc.items.map((_, n) => `R${String(n + 1).padStart(3, '0')}`));
  });

  test('carries the same deterministic findings as --format json', () => {
    const json = JSON.parse(cli(['--format', 'json']).stdout);
    assert.deepEqual(doc.deterministic.findings, json.findings);
    assert.deepEqual(doc.deterministic.summary, json.summary);
  });

  test('skipped claims: unresolvable cd, unmodeled flags', () => {
    const skipped = doc.items.filter((i) => i.kind === 'skipped-claim');
    assert.deepEqual(skipped.map((i) => i.line), [8, 11, 12]);
    assert.match(skipped[0].reason, /`cd`/);
    assert.match(skipped[1].reason, /npm run build --if-present/);
  });

  test('section with prose and nothing checkable', () => {
    const [s] = doc.items.filter((i) => i.kind === 'no-checkable-content');
    assert.equal(s.line, 14);
    assert.match(s.reason, /"Style".*3 lines of prose/);
  });

  test('candidate contradiction: same subject, opposite polarity, both lines named', () => {
    const [c] = doc.items.filter((i) => i.kind === 'candidate-contradiction');
    assert.equal(c.line, 21);
    assert.equal(c.related[0].line, 20);
    assert.match(c.question, /conflict/);
  });

  test('unchecked instruction in prose; lines with a checkable claim are not repeated', () => {
    const lines = doc.items.filter((i) => i.kind === 'unchecked-instruction').map((i) => i.line);
    assert.ok(lines.includes(22));
    assert.ok(!lines.includes(4) && !lines.includes(23));
  });

  test('a clean, specific file has few or no items', () => {
    const out = JSON.parse(cli(['--format', 'agent'], { 'AGENTS.md': '# A\n\n## Commands\n- Test: `npm test`\n', 'package.json': '{"scripts":{"test":"x"}}' }).stdout);
    assert.deepEqual(out.items, []);
    assert.deepEqual(out.summary, { items: 0, byKind: {} });
  });
});

describe('the exit code never depends on the review layer', () => {
  test('same exit code as json, for a failing and a passing repo', () => {
    for (const files of [FILES, { 'AGENTS.md': '# A\n\n## Boundaries\n- Never: commit secrets.\n' }]) {
      assert.equal(cli(['--format', 'agent'], files).code, cli(['--format', 'json'], files).code);
    }
    assert.equal(cli(['--format', 'agent']).code, 1); // AMC002 on src/missing.js
  });

  test('items alone do not fail a run', () => {
    const files = { 'AGENTS.md': '# A\n\n## Commands\n- Test: `npm test`\n\n## Style\nWe care about quality.\nBe kind to each other.\nShip often.\n\n## Boundaries\n- Never: commit secrets.\n', 'package.json': '{"scripts":{"test":"x"}}' };
    const { code, stdout } = cli(['--format', 'agent', '--strict'], files);
    assert.equal(code, 0);
    assert.ok(JSON.parse(stdout).items.length > 0);
  });
});

describe('the review layer adds no network and no subprocess', () => {
  const dirs = [new URL('../src/review/', import.meta.url), new URL('../src/report/', import.meta.url)];
  test('no network or process modules are imported', () => {
    for (const dir of dirs) {
      for (const f of readdirSync(dir)) {
        const src = readFileSync(new URL(f, dir), 'utf8');
        assert.doesNotMatch(src, /node:(?:child_process|http|https|net|dns|tls|worker_threads)|\bfetch\(/, f);
      }
    }
  });
});

describe('the shipped skill', () => {
  const dir = fileURLToPath(new URL('../skills/agent-md-review/', import.meta.url));
  const skill = readFileSync(`${dir}SKILL.md`, 'utf8');

  test('has frontmatter and is published with the package', () => {
    assert.match(skill, /^---\nname: agent-md-review\ndescription: .+\n---\n/);
    assert.ok(PKG.files.includes('skills'));
  });

  test('tells the agent to treat the file as data and never run its commands', () => {
    assert.match(skill, /untrusted/i);
    assert.match(skill, /never run/i);
    assert.match(skill, /approval/i);
    assert.match(skill, /advisory/i);
    assert.match(skill, /--format agent/);
  });
});
