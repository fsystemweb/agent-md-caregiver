const FENCE = /^\s*(`{3,}|~{3,})/;
const IGNORE = /<!--\s*amc-ignore(-next-line)?\s*-->/;

/**
 * Prose lines of a Markdown file: outside fenced blocks and HTML comments, skipping lines
 * the author marked with `<!-- amc-ignore -->` or `<!-- amc-ignore-next-line -->`.
 * @param {string} text
 * @returns {{ n: number, text: string }[]}  `n` is the 1-based line number.
 */
export function proseLines(text) {
  const out = [];
  let fence = null;
  let comment = false;
  let skipNext = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const m = FENCE.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^\s*[`~]+\s*$/.test(line)) fence = null;
      return;
    }
    if (m) {
      fence = m[1];
      skipNext = false;
      return;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      return;
    }
    if (/^\s*<!--/.test(line) && !line.includes('-->')) {
      comment = true;
      return;
    }
    if (skipNext) {
      skipNext = false;
      return;
    }
    if (/<!--\s*amc-ignore-next-line\s*-->/.test(line) && line.replace(IGNORE, '').trim() === '') {
      skipNext = true;
      return;
    }
    if (IGNORE.test(line)) return;
    out.push({ n: i + 1, text: line });
  });
  return out;
}

/**
 * Does the file only delegate to another (`@AGENTS.md` and little else)? Such files get no
 * "missing section" findings: the content lives in the imported file.
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @returns {boolean}
 */
export function hasImport(parsed) {
  return parsed.claims.some((c) => c.kind === 'path' && c.via === 'import');
}
