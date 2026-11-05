import { hasPlaceholder, makeClaim } from './util.js';

const TOOL = /^(npm|pnpm|yarn|bun|bunx|npx|pnpx|make|node|python3?|pytest)(?:\s+(.+))?$/;
/** Tools that are a complete command with no arguments (`make`, `pytest`, `yarn` = install). */
const BARE_OK = new Set(['make', 'pytest', 'yarn']);
/** `node 20`, `python 3.12`: a version mention, not a command. */
const VERSION_ARG = /^v?\d+(?:\.\d+)*[+x]?$/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/;
const SEPARATOR = /&&|\|\||;|\|/g;

/**
 * Parse one shell segment (no `&&`, `;`, `|` inside) as a command we know how to check.
 * @param {string} segment
 * @param {boolean} allowBare  Accept `make` / `pytest` / `yarn` with no arguments (fenced blocks only).
 * @returns {{ text: string, offset: number } | null} offset is where `text` starts inside `segment`.
 */
export function parseCommandSegment(segment, allowBare) {
  let offset = segment.length - segment.trimStart().length;
  let rest = segment.trim();
  let m;
  while ((m = ENV_ASSIGNMENT.exec(rest))) {
    offset += m[0].length;
    rest = rest.slice(m[0].length);
  }
  rest = rest.replace(/\s+#.*$/, '');
  if (!rest || hasPlaceholder(rest)) return null;
  const match = TOOL.exec(rest);
  if (!match) return null;
  const [, tool, args] = match;
  if (args === undefined) {
    if (!allowBare || !BARE_OK.has(tool)) return null;
  } else if ((tool === 'node' || tool.startsWith('python')) && VERSION_ARG.test(args.trim())) {
    return null;
  }
  return { text: rest, offset };
}

/**
 * Split a shell line at `&&`, `||`, `;` and `|`, keeping offsets.
 * @param {string} line
 * @returns {{ text: string, offset: number }[]}
 */
export function splitSegments(line) {
  const out = [];
  let last = 0;
  for (const m of line.matchAll(SEPARATOR)) {
    out.push({ text: line.slice(last, m.index), offset: last });
    last = m.index + m[0].length;
  }
  out.push({ text: line.slice(last), offset: last });
  return out;
}

/**
 * Extract command claims from the body of a shell-ish fenced block.
 * @param {{ n: number, text: string }[]} body  Fence content lines with their 1-based line numbers.
 * @param {string} file
 * @returns {import('./util.js').Claim[]}
 */
export function commandsFromFence(body, file) {
  const claims = [];
  for (let i = 0; i < body.length; i++) {
    const { n } = body[i];
    let source = body[i].text;
    let joined = source;
    // Line continuations: `npm run build \` + next line. The claim stays on the first line.
    while (joined.trimEnd().endsWith('\\') && i + 1 < body.length) {
      joined = joined.trimEnd().slice(0, -1).trimEnd() + ' ' + body[++i].text.trim();
    }
    const prompt = /^(\s*)(?:\$|>)\s+/.exec(joined);
    const promptLen = prompt ? prompt[0].length : 0;
    const content = joined.slice(promptLen);
    if (!content.trim() || /^\s*#/.test(content)) continue;
    for (const seg of splitSegments(content)) {
      const cmd = parseCommandSegment(seg.text, true);
      if (!cmd) continue;
      const col = promptLen + seg.offset + cmd.offset + 1;
      claims.push(makeClaim('command', cmd.text, file, n, col, source, { via: 'fence' }));
    }
  }
  return claims;
}

/**
 * Command claim for an inline code span, if the whole span is a command.
 * @param {string} content  Trimmed span content.
 * @param {string} file
 * @param {number} line
 * @param {number} col      Column of `content`.
 * @param {string} raw      The span including backticks.
 * @returns {import('./util.js').Claim | null}
 */
export function commandFromInline(content, file, line, col, raw) {
  if (/&&|\|\||;|\|/.test(content)) return null;
  const cmd = parseCommandSegment(content, false);
  if (!cmd) return null;
  return makeClaim('command', cmd.text, file, line, col + cmd.offset, raw, { via: 'inline-code' });
}
