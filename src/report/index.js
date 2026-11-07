import { formatAgent } from './agent.js';
import { formatGithub } from './github.js';
import { formatJson } from './json.js';
import { formatPretty } from './pretty.js';
import { formatSarif } from './sarif.js';

export const ALL_FORMATS = ['pretty', 'json', 'github', 'sarif', 'agent'];

export { formatAgent, formatGithub, formatJson, formatPretty, formatSarif };
