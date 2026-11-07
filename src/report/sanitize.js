/**
 * Make untrusted text safe to print. Finding messages, evidence and file names are copied from
 * the checked repo, so they may hold terminal control sequences (ESC, CSI, OSC, a lone CR) or
 * characters that reorder text (bidi overrides). Those are shown as `\xNN` / `\uNNNN` instead
 * of being left for the terminal or the log viewer to act on. Tabs are kept.
 * @param {string} s
 * @param {{ keepLineBreaks?: boolean }} [opts]  Keep CR and LF for a caller that escapes them itself.
 * @returns {string}
 */
export function visible(s, { keepLineBreaks = false } = {}) {
  const controls = keepLineBreaks
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
    : /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
  return String(s)
    .replace(controls, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/[\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}
