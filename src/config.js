import { existsSync } from 'node:fs';
import { readTextInside } from './repo/safe-read.js';
import { join } from 'node:path';
import { UsageError } from './args.js';
import { findRule } from './rules/index.js';

export const CONFIG_FILE = '.agentmdcaregiver.json';
const LEVELS = ['off', 'info', 'warn', 'error'];
const KEYS = ['maxLines', 'rules', 'strict'];

/**
 * @typedef {object} Config
 * @property {number} [maxLines]
 * @property {Record<string, import('./rules/index.js').Severity | 'off'>} rules  Keyed by canonical rule id.
 * @property {boolean} [strict]
 */

/**
 * Read `.agentmdcaregiver.json` from the repo root. A missing file is fine; a broken one is a
 * usage error (exit 2), because silently ignoring a typo'd config would hide what the user asked for.
 *
 * ```json
 * { "maxLines": 200, "strict": false, "rules": { "AMC008": "off", "AMC006": "error" } }
 * ```
 * @param {string} root
 * @returns {Config}
 * @throws {UsageError}
 */
export function loadConfig(root) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { rules: {} };
  const bad = (msg) => new UsageError(`${CONFIG_FILE}: ${msg}`);
  const raw = readTextInside(root, CONFIG_FILE);
  if (raw === null) throw bad('cannot be read, or is a symlink that leaves the repo root (such links are not followed)');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw bad(`not valid JSON (${/** @type {Error} */ (e).message})`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw bad('expected a JSON object');
  for (const key of Object.keys(data)) {
    if (!KEYS.includes(key)) throw bad(`unknown key "${key}". Known keys: ${KEYS.join(', ')}`);
  }
  /** @type {Config} */
  const config = { rules: {} };
  if ('maxLines' in data) {
    if (!Number.isInteger(data.maxLines) || data.maxLines < 1) throw bad('"maxLines" must be a positive integer');
    config.maxLines = data.maxLines;
  }
  if ('strict' in data) {
    if (typeof data.strict !== 'boolean') throw bad('"strict" must be true or false');
    config.strict = data.strict;
  }
  if ('rules' in data) {
    const rules = data.rules;
    if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
      throw bad('"rules" must be an object like { "AMC008": "off" }');
    }
    for (const [id, level] of Object.entries(rules)) {
      const rule = findRule(id);
      if (!rule) throw bad(`unknown rule "${id}" in "rules"`);
      if (typeof level !== 'string' || !LEVELS.includes(level.toLowerCase())) {
        throw bad(`"rules.${id}" must be one of ${LEVELS.join(', ')}`);
      }
      config.rules[rule.id] = /** @type {any} */ (level.toLowerCase());
    }
  }
  return config;
}
