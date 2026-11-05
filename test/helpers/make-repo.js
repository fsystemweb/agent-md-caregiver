import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const hasGit = spawnSync('git', ['--version']).status === 0;

/**
 * Run git in a throwaway repo with a fixed identity and no hooks or signing.
 * @param {string} cwd
 * @param {...string} args
 */
export function git(cwd, ...args) {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Write files (path → contents) into a fresh temp directory outside any git repo.
 * @param {Record<string, string>} files
 * @param {{ git?: boolean }} [opts]  `git: true` runs `git init` and commits everything.
 * @returns {{ root: string, write: (rel: string, text: string) => void, mv: (from: string, to: string) => void, commit: (msg: string) => void, cleanup: () => void }}
 */
export function makeRepo(files, { git: useGit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'amc-repo-'));
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const commit = (msg) => {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', msg);
  };
  if (useGit) {
    git(root, 'init', '-q', '-b', 'main');
    commit('initial');
  }
  return {
    root,
    write,
    mv(from, to) {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      if (useGit) git(root, 'mv', from, to);
      else renameSync(join(root, from), join(root, to));
    },
    commit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
