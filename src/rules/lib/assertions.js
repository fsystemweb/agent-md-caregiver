import { isHedged } from './context.js';
import { MANAGERS, projectCommand } from './pm.js';
import { PY_MANAGER_WORD } from './python.js';

/**
 * @typedef {object} Assertion  One thing a file says about how to work in the repo.
 * @property {string} value     `pnpm`, `tabs`, `2 spaces`, `vitest`, ...
 * @property {number} line
 * @property {number} col
 * @property {string} evidence
 * @property {'command' | 'directive'} kind
 * @property {boolean} scoped   True when a heading or the line limits it to part of the repo.
 */

const NEGATIVE = /\b(?:never|don'?t|do not|does not|avoid|must not|shouldn'?t|should not|not|no)\b/i;
const NEGATIVE_VERBS = new Set(['never', 'must not', 'do not', "don't"]);
const MANAGER_WORD = /\b(npm|pnpm|yarn|bun)\b/gi;
const RUNNER_WORD = /\b(jest|vitest|mocha|pytest|ava|jasmine|node:test|node --test)\b/gi;

/** Words that say "only here": a language, a file type, a layer, a package. */
const SCOPE =
  /\b(?:makefiles?|python|py|javascript|js|jsx|typescript|ts|tsx|rust|c\+\+|java|kotlin|swift|ruby|php|html|css|scss|json|ya?ml|toml|markdown|sql|shell|bash|e2e|end-to-end|integration|legacy|old|frontend|backend|client|server|api|web|packages?|services?|modules?)\b|\bGo(?:lang)?\b/i;

const mentionsManager = (s) => /\b(?:npm|pnpm|yarn|bun)\b/i.test(s);

/** A heading names its own manager or scope: "Using yarn", "Python". */
function headingText(parsed, line) {
  let found = '';
  for (const h of parsed.structure.headings) {
    if (h.line > line) break;
    found = h.text;
  }
  return found;
}

/**
 * Package manager the line tells agents to use: from project-level commands and from
 * positive directives that name exactly one manager.
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @param {string[]} lines  Source lines (claims carry only their own span).
 * @returns {(Assertion & { command?: ReturnType<typeof projectCommand> })[]}
 */
export function pmAssertions(parsed, lines) {
  const out = [];
  for (const c of parsed.claims) {
    if (c.kind === 'command') {
      const cmd = projectCommand(c.text);
      if (!cmd || isHedged(lines[c.line - 1] ?? '', c.col)) continue;
      out.push({
        value: cmd.pm,
        line: c.line,
        col: c.col,
        evidence: c.text,
        kind: /** @type {const} */ ('command'),
        scoped: mentionsManager(headingText(parsed, c.line)),
        command: cmd,
      });
    } else if (c.kind === 'directive' && c.subject === 'package-manager') {
      if (NEGATIVE_VERBS.has(c.verb ?? '') || NEGATIVE.test(c.text) || /\be\.g\./i.test(c.text)) continue;
      if (new RegExp(PY_MANAGER_WORD.source, 'i').test(c.text)) continue; // names a Python manager too: two ecosystems
      const names = new Set([...c.text.matchAll(MANAGER_WORD)].map((m) => m[1].toLowerCase()));
      if (names.size !== 1 || !MANAGERS.includes(/** @type {any} */ ([...names][0]))) continue;
      out.push({
        value: [...names][0],
        line: c.line,
        col: c.col,
        evidence: c.text,
        kind: /** @type {const} */ ('directive'),
        scoped: mentionsManager(headingText(parsed, c.line)),
      });
    }
  }
  return out;
}

/**
 * Indentation rules: `tabs`, `spaces` or `N spaces`. Lines scoped to a language or file type
 * are skipped, as are lines that mention both without saying which wins.
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @returns {Assertion[]}
 */
export function indentAssertions(parsed) {
  const out = [];
  for (const c of parsed.claims) {
    if (c.kind !== 'directive' || c.subject !== 'indentation') continue;
    const body = c.text;
    const count = /(\d+)[- ]?spaces?\b/i.exec(body);
    const mentionsTabs = /\btabs\b/i.test(body);
    const mentionsSpaces = /\bspaces?\b/i.test(body);
    const sure = /\bindent\w*/i.test(body) || count || (mentionsTabs && mentionsSpaces);
    if (!sure || (!mentionsTabs && !mentionsSpaces)) continue;
    if (SCOPE.test(body) || /\be\.g\./i.test(body)) continue;
    let value = null;
    if (mentionsTabs && mentionsSpaces) {
      const m =
        /\b(tabs?|spaces?)\b[^.;:]*?\b(?:not|never|instead of|rather than|over|and not|no)\b[^.;:]*?\b(tabs?|spaces?)\b/i.exec(
          body,
        );
      if (!m) continue;
      const first = m[1].toLowerCase().startsWith('tab') ? 'tabs' : 'spaces';
      const second = m[2].toLowerCase().startsWith('tab') ? 'tabs' : 'spaces';
      if (first === second) continue;
      value = first;
    } else {
      const which = mentionsTabs ? 'tabs' : 'spaces';
      const flip = NEGATIVE_VERBS.has(c.verb ?? '') || /\b(?:never|not)\b/i.test(body);
      value = flip ? (which === 'tabs' ? 'spaces' : 'tabs') : which;
    }
    if (value === 'spaces' && count) value = `${count[1]} spaces`;
    out.push({
      value,
      line: c.line,
      col: c.col,
      evidence: c.text,
      kind: /** @type {const} */ ('directive'),
      scoped: false,
    });
  }
  return out;
}

/** Two indentation values disagree: tabs vs spaces, or two different widths. */
export function indentConflict(a, b) {
  if (a === b) return false;
  if (a === 'tabs' || b === 'tabs') return true;
  return a !== 'spaces' && b !== 'spaces';
}

/**
 * Test runner the file says to use ("Use vitest"). Lines naming two runners, a negation or
 * a scope ("for e2e") are skipped.
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @returns {Assertion[]}
 */
export function runnerAssertions(parsed) {
  const out = [];
  for (const c of parsed.claims) {
    if (c.kind !== 'directive' || c.subject !== 'test-runner') continue;
    if (NEGATIVE_VERBS.has(c.verb ?? '') || NEGATIVE.test(c.text) || /\be\.g\./i.test(c.text)) continue;
    if (SCOPE.test(c.text)) continue;
    const names = new Set(
      [...c.text.matchAll(RUNNER_WORD)].map((m) => m[1].toLowerCase().replace('node --test', 'node:test')),
    );
    if (names.size !== 1) continue;
    out.push({
      value: [...names][0],
      line: c.line,
      col: c.col,
      evidence: c.text,
      kind: /** @type {const} */ ('directive'),
      scoped: false,
    });
  }
  return out;
}

/** Prohibitions with a condition ("unless", "in CI", "before") are not absolute. */
const CONDITIONAL =
  /\b(?:unless|except|without|only|when|if|before|after|outside|in (?:ci|prod\w*)|on (?:main|master|prod\w*)|directly)\b/i;

/**
 * Commands the file forbids ("never run `x`") and commands it tells agents to run.
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @param {string[]} lines
 * @returns {{ forbidden: Assertion[], required: Assertion[] }}
 */
export function commandAssertions(parsed, lines) {
  const forbidden = [];
  const required = [];
  for (const c of parsed.claims) {
    if (c.kind !== 'command') continue;
    const make = () => ({
      value: c.text.replace(/\s+/g, ' '),
      line: c.line,
      col: c.col,
      evidence: c.text,
      kind: /** @type {const} */ ('command'),
      scoped: false,
    });
    const srcLine = lines[c.line - 1] ?? '';
    const before = srcLine.slice(0, Math.max(0, c.col - 1));
    if (c.via === 'inline-code' && NEGATIVE.test(before)) {
      if (!CONDITIONAL.test(srcLine)) forbidden.push(make());
    } else if (!isHedged(lines[c.line - 1] ?? '', c.col)) {
      required.push(make());
    }
  }
  return { forbidden, required };
}
