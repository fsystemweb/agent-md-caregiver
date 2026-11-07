import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { formatGithub, formatPretty, formatSarif } from '../src/report/index.js';
import { RULES } from '../src/rules/index.js';
import { makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const finding = (over = {}) => ({
  ruleId: 'AMC001', severity: 'error', message: 'No such script "x"', file: 'AGENTS.md',
  line: 3, col: 7, evidence: '`npm run x`', suggestion: 'Did you mean `npm run test`?', ...over,
});
const result = (findings) => ({ files: ['AGENTS.md'], findings });

describe('github format', () => {
  test('one workflow command per finding, severities mapped', () => {
    const out = formatGithub(result([
      finding(),
      finding({ severity: 'warn', ruleId: 'AMC006', line: 4, suggestion: undefined }),
      finding({ severity: 'info', ruleId: 'AMC009', line: 5 }),
    ]));
    assert.deepEqual(out.trimEnd().split('\n'), [
      '::error file=AGENTS.md,line=3,col=7,title=AMC001 error::No such script "x". Fix: Did you mean `npm run test`?',
      '::warning file=AGENTS.md,line=4,col=7,title=AMC006 warn::No such script "x"',
      '::notice file=AGENTS.md,line=5,col=7,title=AMC009 info::No such script "x". Fix: Did you mean `npm run test`?',
    ]);
  });

  test('escapes %, newlines in messages and : , in file names', () => {
    const [line] = formatGithub(result([finding({ message: '100% bad\nreally', file: 'a:b,c/AGENTS.md', suggestion: undefined })])).split('\n');
    assert.equal(line, '::error file=a%3Ab%2Cc/AGENTS.md,line=3,col=7,title=AMC001 error::100%25 bad%0Areally');
  });

  test('clean run prints nothing', () => {
    assert.equal(formatGithub(result([])), '');
  });
});

describe('sarif format', () => {
  const sarif = JSON.parse(formatSarif(result([finding(), finding({ severity: 'info', ruleId: 'AMC010', evidence: '' })]), { version: '1.2.3' }));
  const [run1] = sarif.runs;

  test('envelope and tool', () => {
    assert.equal(sarif.version, '2.1.0');
    assert.match(sarif.$schema, /sarif-2\.1\.0/);
    assert.equal(sarif.runs.length, 1);
    assert.equal(run1.tool.driver.name, 'agent-md-caregiver');
    assert.equal(run1.tool.driver.version, '1.2.3');
  });

  test('every rule is described, with default levels', () => {
    assert.deepEqual(run1.tool.driver.rules.map((r) => r.id), RULES.map((r) => r.id));
    const r1 = run1.tool.driver.rules.find((r) => r.id === 'AMC001');
    assert.equal(r1.defaultConfiguration.level, 'error');
    assert.equal(run1.tool.driver.rules.find((r) => r.id === 'AMC009').defaultConfiguration.level, 'note');
    assert.equal(run1.tool.driver.rules.find((r) => r.id === 'AMC004').defaultConfiguration.level, 'warning');
  });

  test('results: level, message, location, ruleIndex', () => {
    const [a, b] = run1.results;
    assert.equal(a.ruleId, 'AMC001');
    assert.equal(a.ruleIndex, 1);
    assert.equal(a.level, 'error');
    assert.equal(a.message.text, 'No such script "x". Fix: Did you mean `npm run test`?');
    assert.deepEqual(a.locations[0].physicalLocation, {
      artifactLocation: { uri: 'AGENTS.md', uriBaseId: '%SRCROOT%' },
      region: { startLine: 3, startColumn: 7, snippet: { text: '`npm run x`' } },
    });
    assert.equal(b.level, 'note');
    assert.equal('snippet' in b.locations[0].physicalLocation.region, false);
  });

  test('clean run: valid document with no results', () => {
    const clean = JSON.parse(formatSarif(result([]), { version: '1' }));
    assert.deepEqual(clean.runs[0].results, []);
  });
});

describe('through the CLI', () => {
  function cli(argv, files) {
    const r = makeRepo(files);
    cleanups.push(r.cleanup);
    let stdout = '';
    const code = run(argv, { stdout: { write: (s) => (stdout += s) }, stderr: { write() {} }, cwd: r.root, env: {} });
    return { code, stdout };
  }
  const FILES = { 'package.json': '{"scripts":{"test":"x"}}', 'AGENTS.md': '`npm run nope`\n' };

  test('--format github and --format sarif print their format and keep the exit code', () => {
    const gh = cli(['--format', 'github'], FILES);
    assert.equal(gh.code, 1);
    assert.match(gh.stdout, /^::error file=AGENTS\.md,line=1,col=2,title=AMC001 error::/m);
    const sf = cli(['--format', 'sarif'], FILES);
    assert.equal(sf.code, 1);
    assert.equal(JSON.parse(sf.stdout).runs[0].results.some((x) => x.ruleId === 'AMC001'), true);
  });

  test('sarif output is deterministic and has no absolute paths', () => {
    const a = cli(['--format', 'sarif'], FILES);
    const b = cli(['--format', 'sarif'], FILES);
    assert.equal(a.stdout, b.stdout);
    assert.ok(!a.stdout.includes('/tmp'));
  });
});

describe('untrusted text in reports (security audit: terminal escape injection)', () => {
  const hostile = '\u001b[2K\u001b[1A\u001b[32mALL OK\u001b[0m \u202e\u0007 end';
  const shown = '\\x1b[2K\\x1b[1A\\x1b[32mALL OK\\x1b[0m \\u202e\\x07 end';

  test('pretty output shows control characters instead of passing them to the terminal', () => {
    const out = formatPretty(result([finding({ message: hostile, evidence: hostile, suggestion: hostile, file: `a${hostile}.md` })]), { color: false });
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202e]/.test(out.replace(/\n/g, '')), 'no control characters in output');
    assert.ok(out.includes(`> ${shown}`));
    assert.ok(out.includes(`fix: ${shown}`));
  });

  test('pretty output keeps ordinary text, tabs and its own colors', () => {
    const out = formatPretty(result([finding({ evidence: 'a\tb' })]), { color: true });
    assert.ok(out.includes('a\tb'));
    assert.ok(out.includes('\u001b[31m'));
  });

  test('github output also strips control characters but still escapes line breaks', () => {
    const out = formatGithub(result([finding({ message: `${hostile}\nnext`, file: 'x.md' })]));
    assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202e]/.test(out.replace(/\n$/, '')));
    assert.ok(out.includes(`${shown}%0Anext`));
  });
});
