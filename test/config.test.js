import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const LONG = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

function cli(argv, files) {
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
  return { code, stdout, stderr, findings: stdout.startsWith('{') ? JSON.parse(stdout).findings : null };
}

const FILES = (config) => ({ 'AGENTS.md': `\`npm test\`\n## Boundaries\n- Never: leak secrets.\n${LONG}`, ...(config === undefined ? {} : { '.agentmdcaregiver.json': config }) });
const ids = (r) => r.findings.map((f) => f.ruleId);

describe('.agentmdcaregiver.json', () => {
  test('no config: defaults apply (line budget 150)', () => {
    assert.deepEqual(ids(cli(['--format', 'json'], FILES())), []);
  });

  test('maxLines from the config', () => {
    const r = cli(['--format', 'json'], FILES('{"maxLines": 20}'));
    assert.deepEqual(ids(r), ['AMC007']);
    assert.equal(r.findings[0].severity, 'warn');
  });

  test('--max-lines wins over the config', () => {
    assert.deepEqual(ids(cli(['--format', 'json', '--max-lines', '100'], FILES('{"maxLines": 20}'))), []);
  });

  test('rules: change a level, turn a rule off (ids case-insensitive)', () => {
    assert.equal(cli(['--format', 'json'], FILES('{"maxLines": 20, "rules": {"amc007": "error"}}')).findings[0].severity, 'error');
    assert.deepEqual(ids(cli(['--format', 'json'], FILES('{"maxLines": 20, "rules": {"AMC007": "off"}}'))), []);
  });

  test('--rule wins over the config', () => {
    const r = cli(['--format', 'json', '--rule', 'AMC007=info'], FILES('{"maxLines": 20, "rules": {"AMC007": "error"}}'));
    assert.equal(r.findings[0].severity, 'info');
    assert.equal(r.code, 0);
  });

  test('strict from the config makes warnings fail', () => {
    assert.equal(cli([], FILES('{"maxLines": 20}')).code, 0);
    assert.equal(cli([], FILES('{"maxLines": 20, "strict": true}')).code, 1);
  });

  test('a broken config is a usage error (exit 2), never ignored', () => {
    const cases = [
      ['{nope', /not valid JSON/],
      ['[]', /expected a JSON object/],
      ['{"maxline": 5}', /unknown key "maxline"/],
      ['{"maxLines": 0}', /positive integer/],
      ['{"strict": "yes"}', /true or false/],
      ['{"rules": []}', /"rules" must be an object/],
      ['{"rules": {"AMC999": "off"}}', /unknown rule "AMC999"/],
      ['{"rules": {"AMC007": "loud"}}', /must be one of/],
    ];
    for (const [config, re] of cases) {
      const r = cli([], FILES(config));
      assert.equal(r.code, 2, config);
      assert.match(r.stderr, /\.agentmdcaregiver\.json/);
      assert.match(r.stderr, re, config);
    }
  });
});
