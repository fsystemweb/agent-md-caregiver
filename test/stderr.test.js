import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

function cli(files, argv = []) {
  const r = makeRepo(files);
  cleanups.push(r.cleanup);
  let stderr = '';
  let stdout = '';
  const code = run(argv, { stdout: { write: (s) => (stdout += s) }, stderr: { write: (s) => (stderr += s) }, cwd: r.root, env: {} });
  return { code, stderr, stdout };
}

describe('error messages on stderr never carry control characters from the checked repo (security audit)', () => {
  test('an unknown config key containing ESC and BEL', () => {
    const r = cli({ 'AGENTS.md': '# A\n', '.agentmdcaregiver.json': JSON.stringify({ '\u001b[31mX\u001b]0;pwn\u0007': 1 }) });
    assert.equal(r.code, 2);
    assert.ok(!CONTROLS.test(r.stderr), 'no control characters on stderr');
    assert.ok(r.stderr.includes('unknown key "\\x1b[31mX\\x1b]0;pwn\\x07"'), r.stderr);
  });

  test('an unknown rule id, and a JSON parse error that quotes the file', () => {
    const r1 = cli({ 'AGENTS.md': '# A\n', '.agentmdcaregiver.json': JSON.stringify({ rules: { '\u001b[2JAMC999': 'off' } }) });
    assert.equal(r1.code, 2);
    assert.ok(!CONTROLS.test(r1.stderr));
    const r2 = cli({ 'AGENTS.md': '# A\n', '.agentmdcaregiver.json': '\u001b[2J not json' });
    assert.equal(r2.code, 2);
    assert.ok(!CONTROLS.test(r2.stderr));
  });

  test('a command-line path with control characters is shown, not printed', () => {
    const r = cli({ 'AGENTS.md': '# A\n' }, ['no\u001b[2Jsuch.md']);
    assert.equal(r.code, 2);
    assert.ok(!CONTROLS.test(r.stderr));
  });

  test('ordinary messages are unchanged, line breaks kept', () => {
    const r = cli({ 'AGENTS.md': '# A\n' }, ['--format', 'nope']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--format must be one of pretty, json, github, sarif, agent \(got "nope"\)\nTry --help for usage\.\n$/);
  });
});
