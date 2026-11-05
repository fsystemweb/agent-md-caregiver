/** Bump when the shape of the JSON report changes. Documented in docs/json-schema.md. */
export const SCHEMA_VERSION = 1;

/**
 * Stable, machine-readable report. Deterministic: no timestamps, no absolute paths.
 * @param {import('../lint.js').LintResult} result
 * @param {{ version: string }} tool
 * @returns {string}
 */
export function formatJson(result, tool) {
  const count = (/** @type {string} */ s) => result.findings.filter((f) => f.severity === s).length;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: 'agent-md-caregiver', version: tool.version },
    files: result.files,
    findings: result.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      file: f.file,
      line: f.line,
      col: f.col,
      evidence: f.evidence,
      suggestion: f.suggestion ?? null,
    })),
    summary: {
      files: result.files.length,
      errors: count('error'),
      warnings: count('warn'),
      infos: count('info'),
    },
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
