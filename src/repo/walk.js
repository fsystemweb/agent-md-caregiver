import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchIgnore, parseGitignore } from './gitignore.js';

/**
 * Walk a directory without git, honoring nested .gitignore files. `.git` and
 * `node_modules` are always skipped. Symlinks are listed as files and never followed.
 * @param {string} root
 * @returns {string[]} sorted, '/' separated, relative to root
 */
export function walkFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {{ base: string, rules: import('./gitignore.js').IgnoreRule[] }[]} */
  const scopes = [];

  /** @param {string} rel */
  const visit = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const hasIgnore = entries.some((e) => e.name === '.gitignore' && !e.isDirectory());
    if (hasIgnore) {
      try {
        const text = readFileSync(join(root, rel, '.gitignore'), 'utf8');
        scopes.push({ base: rel, rules: parseGitignore(text) });
      } catch {
        // unreadable .gitignore: treat as absent
      }
    }

    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      const isDir = e.isDirectory();
      if (isIgnored(path, isDir)) continue;
      if (isDir) visit(path);
      else files.push(path);
    }

    if (hasIgnore) scopes.pop();
  };

  /**
   * @param {string} path
   * @param {boolean} isDir
   */
  const isIgnored = (path, isDir) => {
    let ignored = false;
    for (const s of scopes) {
      const sub = s.base ? path.slice(s.base.length + 1) : path;
      const m = matchIgnore(s.rules, sub, isDir);
      if (m !== null) ignored = m;
    }
    return ignored;
  };

  visit('');
  return files.sort();
}
