const LEVEL = { error: 'error', warn: 'warning', info: 'notice' };

/** Escape the message part of a workflow command. */
const data = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
/** Escape a property value of a workflow command. */
const prop = (s) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * GitHub Actions workflow commands: one `::error file=...::message` line per finding, which
 * GitHub shows as an annotation on the file in the run and on the pull request.
 * @param {import('../lint.js').LintResult} result
 * @returns {string}  Empty when there are no findings.
 */
export function formatGithub(result) {
  return result.findings
    .map((f) => {
      const text = f.suggestion ? `${f.message}. Fix: ${f.suggestion}` : f.message;
      const props = `file=${prop(f.file)},line=${f.line},col=${f.col},title=${prop(`${f.ruleId} ${f.severity}`)}`;
      return `::${LEVEL[f.severity]} ${props}::${data(text)}\n`;
    })
    .join('');
}
