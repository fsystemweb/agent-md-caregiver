/**
 * @typedef {'command' | 'path' | 'directive'} ClaimKind
 *
 * @typedef {object} Claim
 * @property {ClaimKind} kind
 * @property {string} text   Normalized claim text (command, path, or directive line).
 * @property {string} file
 * @property {number} line   1-based.
 * @property {number} col    1-based, UTF-16 code units, points at the start of `text` in the source line.
 * @property {string} raw    Source text the claim came from.
 * @property {'fence' | 'inline-code' | 'link' | 'import'} [via]  How a command or path claim was written.
 * @property {string} [verb]     Directive claims only: always, never, must, must not, do not, don't, prefer, use.
 * @property {string} [subject]  Directive claims only: package-manager, indentation, test-runner, language-version.
 */

/** Anything that stands for a value we cannot know: `<name>`, `$VAR`, `${VAR}`, `{{x}}`, `%VAR%`. */
const PLACEHOLDER = /<[^<>\s][^<>]*>|\$\{?[A-Za-z_]|\{\{|%[A-Z_]+%/;

/**
 * @param {string} s
 * @returns {boolean}
 */
export function hasPlaceholder(s) {
  return PLACEHOLDER.test(s);
}

/**
 * @param {ClaimKind} kind
 * @param {string} text
 * @param {string} file
 * @param {number} line
 * @param {number} col
 * @param {string} raw
 * @param {Partial<Claim>} [extra]
 * @returns {Claim}
 */
export function makeClaim(kind, text, file, line, col, raw, extra = {}) {
  return { kind, text, file, line, col, raw, ...extra };
}

/**
 * Replace `[start, end)` with spaces so columns of everything else stay valid.
 * @param {string} s
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export function blank(s, start, end) {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}
