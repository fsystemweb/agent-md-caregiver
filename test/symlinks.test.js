import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { createRepoContext } from '../src/repo/index.js';
import { makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

const MARKER = 'DUMMY_SECRET_MARKER_123 outside line';

/**
 * A repo plus a sibling "outside" directory holding a dummy secret, with symlinks you choose.
 * @param {Record<string, string>} files
 * @param {Record<string, string>} links  repo-relative link path -> target (absolute or relative to the link)
 */
function setup(files, links) {
  const outside = makeRepo({ 'secret.txt': `${MARKER}\nsecond line\n` });
  const repo = makeRepo(files);
  cleanups.push(outside.cleanup, repo.cleanup);
  for (const [link, target] of Object.entries(links)) {
    const at = join(repo.root, link);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(target.replace('$OUT', outside.root), at);
  }
  return { repo, outside };
}

function cli(root, argv) {
  let stdout = '';
  let stderr = '';
  const code = run(argv, { stdout: { write: (s) => (stdout += s) }, stderr: { write: (s) => (stderr += s) }, cwd: root, env: {} });
  return { code, stdout, stderr };
}

describe('symlinks that leave the repo root are never read (security audit: symlink read and echo)', () => {
  test('a codex.md symlink to an outside file is not discovered, read or echoed', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n\n## Boundaries\n- Never: commit secrets.\n' }, { 'codex.md': '$OUT/secret.txt' });
    for (const format of ['pretty', 'json', 'agent', 'sarif', 'github']) {
      const r = cli(repo.root, ['--format', format]);
      assert.ok(!r.stdout.includes('DUMMY_SECRET'), `${format}: no outside content`);
      assert.ok(!r.stderr.includes('DUMMY_SECRET'), `${format}: no outside content on stderr`);
    }
    assert.deepEqual(JSON.parse(cli(repo.root, ['--format', 'json']).stdout).files, ['AGENTS.md']);
  });

  test('naming the symlink on the command line is an error, not a read', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n' }, { 'codex.md': '$OUT/secret.txt' });
    const r = cli(repo.root, ['codex.md']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /resolves outside the repo root/);
    assert.ok(!r.stdout.includes('DUMMY_SECRET') && !r.stderr.includes('DUMMY_SECRET'));
  });

  test('a symlinked directory that leaves the root is not followed either', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n' }, { 'pkg/AGENTS.md': '$OUT/secret.txt' });
    const out = JSON.parse(cli(repo.root, ['--format', 'json']).stdout);
    assert.deepEqual(out.files, ['AGENTS.md']);
  });

  test('a symlinked .agentmdcaregiver.json that leaves the root is refused and not quoted', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n' }, { '.agentmdcaregiver.json': '$OUT/secret.txt' });
    const r = cli(repo.root, []);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /symlink that leaves the repo root/);
    assert.ok(!r.stderr.includes('DUMMY_SECRET'));
  });

  test('a sibling AGENTS.md symlink to an outside file is not read by AMC010', () => {
    const { repo } = setup({ 'CLAUDE.md': '# Mine\n\nUse tabs.\n' }, { 'AGENTS.md': '$OUT/secret.txt' });
    const r = cli(repo.root, ['--format', 'json']);
    assert.ok(!r.stdout.includes('DUMMY_SECRET'));
  });

  test('existsOnDisk does not report files outside the root through a symlink', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n' }, { 'link.txt': '$OUT/secret.txt' });
    assert.equal(createRepoContext(repo.root).existsOnDisk('link.txt'), false);
  });
});

describe('symlinks that stay inside the repo keep working', () => {
  test('CLAUDE.md -> AGENTS.md is read and checked', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n\nRun `npm run nope`.\n', 'package.json': '{"scripts":{"test":"x"}}' }, { 'CLAUDE.md': 'AGENTS.md' });
    const out = JSON.parse(cli(repo.root, ['--format', 'json']).stdout);
    assert.deepEqual(out.files, ['AGENTS.md', 'CLAUDE.md']);
    assert.ok(out.findings.some((f) => f.file === 'CLAUDE.md' && f.ruleId === 'AMC001'));
  });

  test('a config symlink inside the repo is honored', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n', 'conf/real.json': '{"rules":{"AMC009":"off"}}' }, { '.agentmdcaregiver.json': 'conf/real.json' });
    writeFileSync(join(repo.root, 'conf', 'real.json'), '{"rules":{"AMC009":"off"}}');
    const out = JSON.parse(cli(repo.root, ['--format', 'json']).stdout);
    assert.ok(!out.findings.some((f) => f.ruleId === 'AMC009'));
  });

  test('the repo root itself may be reached through a symlink', () => {
    const { repo } = setup({ 'AGENTS.md': '# A\n' }, {});
    const via = makeRepo({});
    cleanups.push(via.cleanup);
    symlinkSync(repo.root, join(via.root, 'link'));
    const out = JSON.parse(cli(via.root, ['--root', 'link', '--format', 'json']).stdout);
    assert.deepEqual(out.files, ['AGENTS.md']);
  });
});
