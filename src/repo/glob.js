/**
 * Translate a gitignore-style glob into a regex source (no anchors).
 * Supports `**`, `*`, `?`, and `[...]` classes. `*` and `?` never cross a `/`.
 * @param {string} glob
 * @returns {string}
 */
export function globToRegexSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        if (glob[i + 2] === '/' && atStart) {
          out += '(?:.*/)?'; // `**/` matches zero or more directories
          i += 2;
        } else if (i + 2 === glob.length && atStart) {
          out += '.*'; // trailing `/**`
          i += 1;
        } else {
          out += '[^/]*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) {
        out += '\\[';
      } else {
        let cls = glob.slice(i + 1, end);
        if (cls[0] === '!') cls = '^' + cls.slice(1);
        out += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) {
      out += escapeRegex(glob[++i]);
    } else {
      out += escapeRegex(c);
    }
  }
  return out;
}

/** @param {string} c */
function escapeRegex(c) {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
