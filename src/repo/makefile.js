const ASSIGNMENT = /^\s*(?:export\s+|override\s+)?[A-Za-z0-9_.-]+\s*(?:::?:?|[?+!])?=/;
/** Lines longer than this are not Makefile rules; skipping them bounds the work on a hostile file. */
const MAX_LINE_LENGTH = 4000;
const NAMES = /^[^\s:#=$%][^:#=$%]*/;

/**
 * The text before the colon of a rule line (`all test: deps`), or null when the line is not a rule.
 * Linear: the name part cannot contain a colon, so the first colon ends it. A colon followed by `=`
 * is an assignment (`:=`), not a rule.
 * @param {string} line
 * @returns {string | null}
 */
function ruleNames(line) {
  const m = NAMES.exec(line);
  if (!m) return null;
  const i = m[0].length;
  return line[i] === ':' && line[i + 1] !== '=' ? m[0] : null;
}
const PHONY = /^\.PHONY\s*:(.*)$/;

/**
 * Explicit target names declared in Makefile text (including `.PHONY` names).
 * Pattern rules (`%`), special targets (`.DEFAULT`), variable assignments, recipe lines
 * and targets built from variables (`$(NAME)`) are skipped.
 * @param {string} text
 * @returns {string[]} sorted, unique
 */
export function parseMakeTargets(text) {
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (line.length > MAX_LINE_LENGTH || !line.trim() || line.startsWith('\t') || /^\s*#/.test(line)) continue;
    const phony = PHONY.exec(line);
    if (phony) {
      for (const name of phony[1].split('#')[0].split(/\s+/)) {
        if (name && !/[$%]/.test(name)) targets.add(name);
      }
      continue;
    }
    if (ASSIGNMENT.test(line)) continue;
    const names = ruleNames(line);
    if (names === null) continue;
    for (const name of names.split(/\s+/)) {
      if (name && !name.startsWith('.') && !/[$%]/.test(name)) targets.add(name);
    }
  }
  return [...targets].sort();
}

/**
 * Can we trust the target list? Not if the Makefile pulls in other files (`include`)
 * or has a catch-all rule (`%:`, `.DEFAULT:`), because targets may come from elsewhere.
 * @param {string} text
 * @returns {boolean}
 */
export function isOpaqueMakefile(text) {
  return /^(?:-?include|sinclude)\s/m.test(text) || /^(?:%|\.DEFAULT)\s*::?(?!=)/m.test(text);
}
