import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { hasGit, makeRepo } from './helpers/make-repo.js';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The first fenced block under "## Demo" with the given info string. */
function demoBlock(lang) {
  const demo = README.slice(README.indexOf('## Demo'), README.indexOf('## Usage'));
  const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```').exec(demo);
  assert.ok(m, `README demo has a ${lang} block`);
  return m[1];
}

test('README demo: the shown output is what the tool prints for the shown repo', { skip: !hasGit && 'git not installed' }, () => {
  const agents = demoBlock('md') + '\n';
  const bulk = (prefix) => Array.from({ length: 30 }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
  const r = makeRepo(
    {
      'package.json': '{"name":"acme-api","scripts":{"test":"node --test","build":"tsc"}}\n',
      'package-lock.json': '{}\n',
      'src/routes/users.ts': bulk('// line'),
      'docs/code-style.md': '# Code style\n' + bulk('rule'),
    },
    { git: true },
  );
  try {
    r.mv('src/routes/users.ts', 'src/routes/user.ts');
    r.mv('docs/code-style.md', 'docs/style.md');
    r.commit('rename files');
    r.write('AGENTS.md', agents);

    let out = '';
    const code = run([], { stdout: { write: (s) => (out += s) }, stderr: { write() {} }, cwd: r.root, env: {} });
    const shown = demoBlock('text').replace(/^\$ node src\/cli\.js\n\n/, '') + '\n';
    assert.equal(out, shown);
    assert.equal(code, 1);
  } finally {
    r.cleanup();
  }
});
