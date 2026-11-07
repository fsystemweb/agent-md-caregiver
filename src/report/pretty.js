import { visible } from './sanitize.js';

const COLORS = { error: '31', warn: '33', info: '36', dim: '2', bold: '1', green: '32' };

/**
 * Human-readable report.
 * @param {import('../lint.js').LintResult} result
 * @param {{ color: boolean }} opts
 * @returns {string}
 */
export function formatPretty(result, { color }) {
  const paint = (/** @type {keyof typeof COLORS} */ c, /** @type {string} */ s) =>
    color ? `\u001b[${COLORS[c]}m${s}\u001b[0m` : s;
  const lines = [];
  let lastFile = null;
  for (const f of result.findings) {
    if (f.file !== lastFile) {
      if (lastFile !== null) lines.push('');
      lines.push(paint('bold', visible(f.file)));
      lastFile = f.file;
    }
    const where = `${f.line}:${f.col}`.padEnd(7);
    lines.push(`  ${paint('dim', where)} ${paint(f.severity, f.severity.padEnd(5))}  ${visible(f.message)}  ${paint('dim', f.ruleId)}`);
    if (f.evidence) lines.push(`          ${paint('dim', '>')} ${visible(f.evidence)}`);
    if (f.suggestion) lines.push(`          ${paint('green', 'fix:')} ${visible(f.suggestion)}`);
  }
  if (lines.length) lines.push('');
  const n = (/** @type {string} */ s) => result.findings.filter((f) => f.severity === s).length;
  const files = `${result.files.length} file${result.files.length === 1 ? '' : 's'} checked`;
  if (result.files.length === 0) {
    lines.push('No instruction files found (looked for AGENTS.md, CLAUDE.md, codex.md).');
  } else if (result.findings.length === 0) {
    lines.push(paint('green', `${files}, no problems found.`));
  } else {
    lines.push(`${files}: ${n('error')} error(s), ${n('warn')} warning(s), ${n('info')} info.`);
  }
  return `${lines.join('\n')}\n`;
}
