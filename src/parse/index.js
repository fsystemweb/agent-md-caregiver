import { commandFromInline, commandsFromFence } from './commands.js';
import { directivesFromLine } from './directives.js';
import { codeSpans, importFromLine, maskSpans, pathFromSpan, pathsFromLinks } from './paths.js';
import { blank } from './util.js';

/**
 * @typedef {import('./util.js').Claim} Claim
 *
 * @typedef {object} Heading
 * @property {number} level
 * @property {string} text
 * @property {number} line
 *
 * @typedef {object} TreeDump
 * @property {number} line      First line (the fence opener for fenced dumps).
 * @property {number} endLine
 * @property {number} lines     Number of tree lines inside.
 * @property {boolean} fenced
 *
 * @typedef {object} ParseResult
 * @property {Claim[]} claims   Sorted by line, then column.
 * @property {{ lineCount: number, headings: Heading[], treeDumps: TreeDump[] }} structure
 */

const SHELL_LANGS = new Set(['', 'sh', 'bash', 'shell', 'zsh', 'console', 'shell-session', 'terminal']);
const TREE_GLYPHS = /[├└│]/;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const IGNORE_MARKER = /<!--\s*amc-ignore(-next-line)?\s*-->/;
const MIN_TREE_LINES = 3;

/**
 * Scan a Markdown instruction file and extract verifiable claims with exact positions.
 * Pure and offline: never touches the file system and never executes anything it reads.
 *
 * Ignore markers (HTML comments):
 * - `<!-- amc-ignore -->` on its own line ignores the block right below it (until a blank line,
 *   or through the end of a fenced block that follows directly).
 * - `<!-- amc-ignore-next-line -->` ignores the next line (or the whole fenced block it opens).
 * - `<!-- amc-ignore -->` at the end of a content line ignores that line.
 *
 * Also skipped: blockquotes, fenced blocks that are not shell (`text`, `diff`, `json`, ...),
 * URLs, globs, and placeholders such as `<name>` and `$VAR`.
 *
 * @param {string} text
 * @param {{ file?: string }} [options]
 * @returns {ParseResult}
 */
export function parse(text, { file = '<input>' } = {}) {
  const lines = text.split(/\r?\n/);
  let lineCount = lines.length;
  if (lines[lineCount - 1] === '') lineCount--;

  /** @type {Claim[]} */
  const claims = [];
  /** @type {Heading[]} */
  const headings = [];
  /** @type {TreeDump[]} */
  const treeDumps = [];

  /** @type {{ char: string, len: number, lang: string, line: number, body: { n: number, text: string }[], ignored: boolean } | null} */
  let fence = null;
  let inComment = false;
  let skipNext = false;
  let skipBlock = false;
  /** @type {{ line: number, end: number, count: number } | null} */
  let treeRun = null;

  const flushTreeRun = () => {
    if (treeRun && treeRun.count >= MIN_TREE_LINES) {
      treeDumps.push({ line: treeRun.line, endLine: treeRun.end, lines: treeRun.count, fenced: false });
    }
    treeRun = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i];

    if (fence) {
      const closer = new RegExp(`^\\s*${fence.char === '`' ? '`' : '~'}{${fence.len},}\\s*$`);
      if (closer.test(raw)) {
        closeFence(fence, n);
        fence = null;
      } else {
        fence.body.push({ n, text: raw });
      }
      continue;
    }

    // HTML comments: mask them so their text never becomes a claim.
    let line = raw;
    const trimmed = raw.trim();
    const marker = IGNORE_MARKER.exec(raw);
    const markerOnly = marker && trimmed === marker[0];
    if (markerOnly) {
      flushTreeRun();
      if (marker[1]) skipNext = true;
      else skipBlock = true;
      continue;
    }
    ({ line, inComment } = maskComments(line, inComment));
    const inlineIgnore = Boolean(marker);

    if (!trimmed) {
      flushTreeRun();
      skipBlock = false;
      skipNext = false;
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      flushTreeRun();
      fence = {
        char: open[2][0],
        len: open[2].length,
        lang: open[3].toLowerCase(),
        line: n,
        body: [],
        ignored: skipNext || skipBlock || inlineIgnore,
      };
      skipNext = false;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2], line: n });
    }

    const isTreeLine = TREE_GLYPHS.test(line);
    if (isTreeLine) {
      if (treeRun) {
        treeRun.end = n;
        treeRun.count++;
      } else {
        treeRun = { line: n, end: n, count: 1 };
      }
    } else {
      flushTreeRun();
    }

    const ignored = skipNext || skipBlock || inlineIgnore;
    skipNext = false;
    if (ignored || isTreeLine) continue;
    if (/^\s{0,3}>/.test(line)) continue; // blockquote: illustrative

    const spans = codeSpans(line);
    for (const span of spans) {
      const cmd = commandFromInline(span.content, file, n, span.col, span.raw);
      if (cmd) {
        claims.push(cmd);
        continue;
      }
      const p = pathFromSpan(span, file, n);
      if (p) claims.push(p);
    }
    const masked = maskSpans(line, spans);
    claims.push(...pathsFromLinks(masked, file, n));
    const imp = importFromLine(masked, file, n);
    if (imp) claims.push(imp);
    if (!heading) claims.push(...directivesFromLine(line, file, n));
  }

  if (fence) closeFence(fence, lines.length); // unterminated fence runs to end of file
  flushTreeRun();

  /**
   * @param {NonNullable<typeof fence>} f
   * @param {number} endLine
   */
  function closeFence(f, endLine) {
    skipBlock = false;
    const treeCount = f.body.filter((b) => TREE_GLYPHS.test(b.text)).length;
    if (treeCount >= MIN_TREE_LINES) {
      treeDumps.push({ line: f.line, endLine, lines: treeCount, fenced: true });
      return;
    }
    if (f.ignored || !SHELL_LANGS.has(f.lang)) return;
    claims.push(...commandsFromFence(f.body, file));
  }

  claims.sort((a, b) => a.line - b.line || a.col - b.col);
  return { claims, structure: { lineCount, headings, treeDumps } };
}

/**
 * Blank out `<!-- ... -->` regions (possibly spanning lines), keeping columns stable.
 * @param {string} line
 * @param {boolean} inComment
 * @returns {{ line: string, inComment: boolean }}
 */
function maskComments(line, inComment) {
  let out = line;
  let pos = 0;
  while (pos < out.length) {
    if (inComment) {
      const end = out.indexOf('-->', pos);
      if (end === -1) return { line: blank(out, pos, out.length), inComment: true };
      out = blank(out, pos, end + 3);
      pos = end + 3;
      inComment = false;
    } else {
      const start = out.indexOf('<!--', pos);
      if (start === -1) break;
      inComment = true;
      pos = start;
    }
  }
  return { line: out, inComment };
}
