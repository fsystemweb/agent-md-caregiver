import { makeClaim } from './util.js';

const VERB = /\b(always|never|must not|must|do not|don't|prefer|use)\b/i;

/** Only subjects we can later verify or compare. Anything else is not a directive claim. */
const SUBJECTS = /** @type {[string, RegExp][]} */ ([
  ['package-manager', /\b(?:npm|pnpm|yarn|bun)\b/i],
  ['indentation', /\b(?:tabs?|spaces?|indent(?:ation|ed)?)\b/i],
  ['test-runner', /\b(?:jest|vitest|mocha|pytest|ava|jasmine|node:test|node --test)\b/i],
  ['language-version', /\b(?:node(?:\.js)?|python|typescript|java|go|rust|ruby)\s*v?\d+(?:\.\d+)*\+?/i],
]);

/**
 * Directive claims (one per recognized subject) for a prose line.
 * @param {string} line   Comment-masked source line.
 * @param {string} file
 * @param {number} lineNo
 * @returns {import('./util.js').Claim[]}
 */
export function directivesFromLine(line, file, lineNo) {
  const marker = /^\s*(?:[-*+]\s+|\d+\.\s+)?/.exec(line)[0].length;
  const body = line.slice(marker).trimEnd();
  if (!body || body.startsWith('|')) return [];
  const verb = VERB.exec(body);
  if (!verb) return [];
  const claims = [];
  for (const [subject, re] of SUBJECTS) {
    if (!re.test(body)) continue;
    claims.push(
      makeClaim('directive', body, file, lineNo, marker + 1, line, {
        verb: verb[1].toLowerCase(),
        subject,
      }),
    );
  }
  return claims;
}
