/**
 * Split a command into words, honoring single and double quotes. Offsets point at the
 * first character of each word in the original text (the opening quote, if any).
 * @param {string} text
 * @returns {{ value: string, start: number }[]}
 */
export function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    const start = i;
    let value = '';
    let quote = '';
    while (i < text.length && (quote || !/\s/.test(text[i]))) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = '';
        else value += c;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else {
        value += c;
      }
      i++;
    }
    tokens.push({ value, start });
  }
  return tokens;
}
