import { posix } from 'node:path';
import { looksLikePath, stripLineRef } from '../parse/paths.js';
import { tokenize } from './lib/tokenize.js';
import { checkPath, isHedged, whereDidItGo } from './lib/context.js';
import { closestPath } from './lib/suggest.js';

/** @typedef {import('./index.js').RuleFinding} RuleFinding */

/** `three@0.160.0/examples/jsm/`, `@scope/pkg@1.2.3/dist/x.js`: a package specifier, not a repo path. */
const PACKAGE_SPECIFIER = /^(?:@[\w.-]+\/)?[\w.-]+@[\w.^~<>=*-]+(?:\/|$)/;

/**
 * Is a path written relative to some subfolder ("main.tsx" for "src/main.tsx")? True when an
 * existing file or directory ends with the written path (ignored files that exist on disk count,
 * and so does a module specifier without its extension). Humans read these fine, so we stay silent.
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} written
 * @returns {boolean}
 */
function existsBelow(repo, written) {
  const tail = written.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (!tail || tail.startsWith('../') || tail === '..') return false;
  const suffix = '/' + tail;
  if (repo.files().some((f) => f.endsWith(suffix)) || repo.dirs().some((d) => d.endsWith(suffix))) return true;
  // `./state` for `src/state.ts` or `src/state/index.ts`: a module specifier without its extension.
  if (!/\.[A-Za-z0-9]+$/.test(posix.basename(tail))) {
    if (repo.files().some((f) => f.replace(/\.[A-Za-z0-9]+$/, '').endsWith(suffix))) return true;
  }
  // Git-ignored but present on disk under some tracked directory (`backend/appsettings.json`).
  return repo.dirs().some((d) => repo.existsOnDisk(`${d}/${tail}`));
}

const NODE_VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--env-file', '--experimental-loader']);
const NODE_CODE_FLAGS = new Set(['-e', '--eval', '-p', '--print']);

/**
 * File arguments of `node x.js`, `python x.py`, `pytest tests/x.py`: paths a command needs.
 * @param {string} text  Command claim text.
 * @returns {{ target: string, offset: number }[]}
 */
function commandFileArgs(text) {
  const toks = tokenize(text);
  const tool = toks[0]?.value;
  const out = [];
  if (tool === 'node') {
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i].value;
      if (NODE_CODE_FLAGS.has(t)) break;
      if (NODE_VALUE_FLAGS.has(t)) i++;
      else if (!t.startsWith('-')) {
        if (looksLikePath(t)) out.push({ target: t, offset: toks[i].start });
        break;
      }
    }
  } else if (tool === 'python' || tool === 'python3') {
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i].value;
      if (t === '-m' || t === '-c') break;
      if (!t.startsWith('-')) {
        if (looksLikePath(t)) out.push({ target: t, offset: toks[i].start });
        break;
      }
    }
  } else if (tool === 'pytest') {
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i].value.replace(/::.*$/, '');
      if (!t.startsWith('-') && /\.py$/.test(t) && looksLikePath(t)) out.push({ target: t, offset: toks[i].start });
    }
  }
  return out;
}

/** @type {import('./index.js').Rule} */
export const pathMissing = {
  id: 'AMC002',
  name: 'path-missing',
  severity: 'error',
  summary: 'A file or directory the file points agents to does not exist (suggests where it went).',
  explain: [
    'AMC002 path-missing (error)',
    '',
    'The file mentions a path in inline code (or as the file argument of `node`, `python`, `pytest`)',
    'that is not in the repo. Agents go looking for it, fail, and guess.',
    '',
    'The finding suggests where it went: first the git history (a rename or move, including whole',
    'directories), then the one existing file or directory with the same or a very similar name.',
    '',
    'Paths are looked up next to the instruction file, then in each parent directory up to the root.',
    '',
    'What it stays silent on: globs, placeholders, URLs, absolute and `~/` paths, `path/to/...`,',
    'anything .gitignore covers or that exists on disk (dist/, .env), `node_modules`, extensionless',
    'names whose parent directory does not exist (probably an API route, not a file), and paths after',
    '"never", "avoid", "e.g.", "for example", package specifiers such as `three@0.160.0/examples/`, and',
    'paths written relative to a subfolder (`main.tsx` when only `src/main.tsx` exists).',
    'Links and `@` imports are checked by AMC005.',
    '',
    'Fix: correct the path, or remove the reference.',
    'Suppress a deliberate case with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ file, text, parsed, repo }) {
    /** @type {RuleFinding[]} */
    const findings = [];
    const lines = text.split(/\r?\n/);

    /**
     * @param {string} target
     * @param {number} line
     * @param {number} col
     * @param {string} evidence
     * @param {string} [dir]  Directory set by `cd`, relative to the instruction file.
     */
    const verify = (target, line, col, evidence, dir) => {
      const written = stripLineRef(target);
      if (/^(?:\/|~|[A-Za-z]:)/.test(written) || /(^|\/)(?:path\/to|node_modules)(\/|$)/.test(written)) return;
      const joined = dir ? posix.join(dir, written) : written;
      if (PACKAGE_SPECIFIER.test(written)) return;
      const { status, normalized } = checkPath(repo, file, joined);
      if (status !== 'missing') return;
      if (existsBelow(repo, written)) return;

      const where = whereDidItGo(repo, normalized, closestPath);
      const base = posix.basename(normalized);
      const fileLike = /\.[A-Za-z0-9]+$/.test(base);
      const parent = posix.dirname(normalized);
      if (!fileLike && !written.endsWith('/') && !where && parent !== '.' && !repo.hasPath(parent)) return;

      let suggestion = 'Fix the path or remove the reference.';
      if (where?.how === 'git') suggestion = `Renamed to \`${where.path}\` in git history. Replace the path.`;
      else if (where) suggestion = `Did you mean \`${where.path}\`?`;
      findings.push({ message: `\`${written}\` does not exist`, line, col, evidence, suggestion });
    };

    for (const claim of parsed.claims) {
      if (claim.kind === 'path' && claim.via === 'inline-code') {
        if (isHedged(lines[claim.line - 1] ?? '', claim.col)) continue;
        verify(claim.text, claim.line, claim.col, claim.raw.trim());
      } else if (claim.kind === 'command' && claim.dir !== '?') {
        if (claim.via === 'inline-code' && isHedged(lines[claim.line - 1] ?? '', claim.col)) continue;
        for (const arg of commandFileArgs(claim.text)) {
          verify(arg.target, claim.line, claim.col + arg.offset, claim.raw.trim(), claim.dir);
        }
      }
    }
    return findings;
  },
};
