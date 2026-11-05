import { RULES } from '../rules/index.js';

const LEVEL = { error: 'error', warn: 'warning', info: 'note' };

/**
 * SARIF 2.1.0 for GitHub code scanning and other SARIF viewers. Deterministic: no timestamps,
 * no absolute paths (locations are relative to %SRCROOT%).
 * @param {import('../lint.js').LintResult} result
 * @param {{ version: string }} tool
 * @returns {string}
 */
export function formatSarif(result, tool) {
  const ruleIndex = new Map(RULES.map((r, i) => [r.id, i]));
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'agent-md-caregiver',
            version: tool.version,
            informationUri: 'https://github.com/fsystemweb/agent-md-caregiver',
            rules: RULES.map((r) => ({
              id: r.id,
              name: r.name,
              shortDescription: { text: r.summary },
              fullDescription: { text: r.explain },
              defaultConfiguration: { level: LEVEL[r.severity] },
            })),
          },
        },
        originalUriBaseIds: { '%SRCROOT%': { description: { text: 'The repository root.' } } },
        artifacts: result.files.map((uri) => ({ location: { uri, uriBaseId: '%SRCROOT%' } })),
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          ruleIndex: ruleIndex.get(f.ruleId),
          level: LEVEL[f.severity],
          message: { text: f.suggestion ? `${f.message}. Fix: ${f.suggestion}` : f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file, uriBaseId: '%SRCROOT%' },
                region: {
                  startLine: f.line,
                  startColumn: f.col,
                  ...(f.evidence ? { snippet: { text: f.evidence } } : {}),
                },
              },
            },
          ],
        })),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
