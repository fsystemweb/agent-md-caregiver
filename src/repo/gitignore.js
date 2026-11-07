import { compileGlob } from './glob.js';

/** A .gitignore line longer than this is skipped: no real pattern comes close, and it bounds the work. */
const MAX_LINE_LENGTH = 4096;

/** Strip trailing whitespace, keeping a space that is escaped with a backslash. Linear in the line length. */
function trimEnd(line) {
  let end = line.length;
  while (end > 0 && /\s/.test(line[end - 1]) && line[end - 2] !== '\\') end--;
  return line.slice(0, end);
}

/**
 * @typedef {object} IgnoreRule
 * @property {import('./glob.js').Matcher} re  Matches a path relative to the .gitignore's directory.
 * @property {boolean} negate
 * @property {boolean} dirOnly
 */

/**
 * Parse the text of a .gitignore file. Covers comments, negation, anchoring,
 * directory-only patterns and the common glob syntax. Not covered: `.git/info/exclude`
 * and global excludes (when git is available we ask git itself instead).
 * @param {string} text
 * @returns {IgnoreRule[]}
 */
export function parseGitignore(text) {
  /** @type {IgnoreRule[]} */
  const rules = [];
  for (let line of text.split(/\r?\n/)) {
    if (line.length > MAX_LINE_LENGTH) continue;
    line = trimEnd(line);
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const re = compileGlob(line, { floating: !anchored });
    rules.push({ re, negate, dirOnly });
  }
  return rules;
}

/**
 * Last matching rule wins, as in git.
 * @param {IgnoreRule[]} rules
 * @param {string} relPath  Relative to the rules' directory, '/' separated.
 * @param {boolean} isDir
 * @returns {boolean | null} true = ignored, false = re-included, null = no rule matched
 */
export function matchIgnore(rules, relPath, isDir) {
  let result = null;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(relPath)) result = !r.negate;
  }
  return result;
}
