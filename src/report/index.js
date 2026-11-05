import { formatJson } from './json.js';
import { formatPretty } from './pretty.js';

/** Formats that have a reporter today. `github` and `sarif` arrive in a later PR. */
export const IMPLEMENTED_FORMATS = ['pretty', 'json'];
export const ALL_FORMATS = ['pretty', 'json', 'github', 'sarif'];

export { formatJson, formatPretty };
