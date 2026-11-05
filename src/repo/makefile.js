const ASSIGNMENT = /^\s*(?:export\s+|override\s+)?[A-Za-z0-9_.-]+\s*(?:::?:?|[?+!])?=/;
const TARGET = /^([^\s:#=$%][^:#=$%]*?)\s*::?(?!=)/;
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
    if (!line.trim() || line.startsWith('\t') || /^\s*#/.test(line)) continue;
    const phony = PHONY.exec(line);
    if (phony) {
      for (const name of phony[1].split('#')[0].split(/\s+/)) {
        if (name && !/[$%]/.test(name)) targets.add(name);
      }
      continue;
    }
    if (ASSIGNMENT.test(line)) continue;
    const m = TARGET.exec(line);
    if (!m) continue;
    for (const name of m[1].split(/\s+/)) {
      if (name && !name.startsWith('.') && !/[$%]/.test(name)) targets.add(name);
    }
  }
  return [...targets].sort();
}
