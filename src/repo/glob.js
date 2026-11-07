/**
 * Gitignore-style globs, matched without a backtracking regex engine.
 *
 * Globs come from the checked repo (.gitignore lines, package.json `workspaces`), so they are
 * untrusted. Compiling `*a*a*a*b` to a regex makes V8 backtrack polynomially (degree = number of
 * stars) on a long non-matching name. Here a glob is a list of tokens and matching simulates all
 * the ways it could match at once, one input character at a time, so the cost is
 * O(input length x token count) whatever the pattern looks like.
 *
 * Supports `**`, `*`, `?`, `[...]` classes and `\` escapes. `*` and `?` never cross a `/`.
 */

/** Patterns longer than this never match: no real .gitignore line comes close. */
export const MAX_GLOB_LENGTH = 1024;

/**
 * @typedef {{ t: 'lit', c: string } | { t: 'any1' } | { t: 'cls', re: RegExp } | { t: 'star' } | { t: 'dotstar' } | { t: 'dirs' }} Token
 *
 * @typedef {object} Matcher
 * @property {(s: string) => boolean} test  Does the whole string match?
 */

/** A matcher that never matches (over-long or malformed patterns). */
const NEVER = { test: () => false };

/**
 * @param {string} glob
 * @returns {Token[] | null}  null when the pattern is too long or has a malformed class.
 */
function tokenize(glob) {
  if (glob.length > MAX_GLOB_LENGTH) return null;
  /** @type {Token[]} */
  const out = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        if (glob[i + 2] === '/' && atStart) {
          out.push({ t: 'dirs' }); // `**/` matches zero or more directories
          i += 2;
        } else if (i + 2 === glob.length && atStart) {
          out.push({ t: 'dotstar' }); // trailing `/**`
          i += 1;
        } else {
          out.push({ t: 'star' });
          i += 1;
        }
      } else {
        out.push({ t: 'star' });
      }
    } else if (c === '?') {
      out.push({ t: 'any1' });
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) {
        out.push({ t: 'lit', c: '[' });
      } else {
        let cls = glob.slice(i + 1, end);
        if (cls[0] === '!') cls = `^${cls.slice(1)}`;
        try {
          out.push({ t: 'cls', re: new RegExp(`^[${cls.replace(/\\/g, '\\\\')}]$`) }); // one character, never backtracks
        } catch {
          return null; // e.g. a reversed range like [z-a]
        }
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) {
      out.push({ t: 'lit', c: glob[++i] });
    } else {
      out.push({ t: 'lit', c });
    }
  }
  return out;
}

/**
 * Compile a glob to a matcher for whole strings.
 * @param {string} glob
 * @param {{ floating?: boolean }} [opts]  `floating`: may also match below any leading directories
 *   (an unanchored .gitignore pattern), like a leading `**` + `/`.
 * @returns {Matcher}
 */
export function compileGlob(glob, { floating = false } = {}) {
  const tokens = tokenize(glob);
  if (tokens === null) return NEVER;
  if (floating) tokens.unshift({ t: 'dirs' });
  const n = tokens.length;
  // State 2i: about to match tokens[i]. State 2i+1: inside the `.*` part of a `dirs` token at i.
  // State 2n is the accepting state.

  /** @param {Set<number>} set @param {number} state */
  const add = (set, state) => {
    if (set.has(state)) return;
    set.add(state);
    if (state % 2 === 0 && state < 2 * n) {
      const t = tokens[state / 2].t;
      if (t === 'star' || t === 'dotstar' || t === 'dirs') add(set, state + 2); // may match nothing
    }
  };

  return {
    test(s) {
      let cur = new Set();
      add(cur, 0);
      for (const ch of s) {
        /** @type {Set<number>} */
        const next = new Set();
        for (const st of cur) {
          if (st === 2 * n) continue;
          const i = st >> 1;
          const tok = tokens[i];
          if (st % 2 === 1) {
            // inside `.*` of `dirs`: stay on anything, leave on `/`
            next.add(st);
            if (ch === '/') add(next, 2 * (i + 1));
            continue;
          }
          switch (tok.t) {
            case 'lit':
              if (ch === tok.c) add(next, 2 * (i + 1));
              break;
            case 'any1':
              if (ch !== '/') add(next, 2 * (i + 1));
              break;
            case 'cls':
              if (tok.re.test(ch)) add(next, 2 * (i + 1));
              break;
            case 'star':
              if (ch !== '/') add(next, st);
              break;
            case 'dotstar':
              add(next, st);
              break;
            case 'dirs':
              next.add(2 * i + 1);
              if (ch === '/') add(next, 2 * (i + 1));
              break;
          }
        }
        if (next.size === 0) return false;
        cur = next;
      }
      return cur.has(2 * n);
    },
  };
}
