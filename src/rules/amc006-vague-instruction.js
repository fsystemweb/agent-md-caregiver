import { hasImport, proseLines } from './lib/prose.js';
import { isHedged } from './lib/context.js';

/** What a vague mention is about, how it is spelled, and what a real command for it looks like. */
const TOPICS = [
  {
    name: 'tests',
    say: /\b(?:run|execute|launch)\s+(?:(?:all|the|your|our|any|unit|integration)\s+)*(?:tests?|test suite)\b/i,
    command: /\b(?:tests?|jest|vitest|pytest|mocha|rspec|phpunit|check)\b|go test|cargo test/i,
    fix: 'Write the exact test command, e.g. `npm test`.',
  },
  {
    name: 'linter',
    say: /\b(?:run|execute|launch)\s+(?:(?:the|your|our)\s+)*(?:linter|lint(?:ing)?)\b/i,
    command: /\b(?:lint|eslint|ruff|flake8|pylint|clippy|rubocop|biome)\b/i,
    fix: 'Write the exact lint command, e.g. `npm run lint`.',
  },
  {
    name: 'build',
    say: /\b(?:run|execute|do)\s+(?:(?:the|a|your|our)\s+)*build\b|\bbuild the (?:project|app|application|code)\b/i,
    command: /\b(?:build|compile|tsc|webpack|vite|make|gradle|mvn|cargo|go build)\b/i,
    fix: 'Write the exact build command, e.g. `npm run build`.',
  },
  {
    name: 'formatter',
    say: /\b(?:run|execute)\s+(?:(?:the|your|our)\s+)*(?:formatter|prettier)\b|\bformat the (?:code|files)\b/i,
    command: /\b(?:format|prettier|fmt|black|gofmt|rustfmt|biome)\b/i,
    fix: 'Write the exact format command, e.g. `npm run format`.',
  },
  {
    name: 'type check',
    say: /\b(?:run|execute)\s+(?:(?:the|your|our)\s+)*type[- ]?check(?:er|ing|s)?\b/i,
    command: /\b(?:typecheck|tsc|mypy|pyright|type-check)\b/i,
    fix: 'Write the exact type-check command, e.g. `npx tsc --noEmit`.',
  },
];

/** @type {import('./index.js').Rule} */
export const vagueInstruction = {
  id: 'AMC006',
  name: 'vague-instruction',
  severity: 'warn',
  summary: 'An instruction says "run the tests" without a command, or the file has no commands at all.',
  explain: [
    'AMC006 vague-instruction (warn)',
    '',
    'Agents do best with exact commands. Two things are reported:',
    '',
    '1. "Run the tests", "build the project", "run the linter" (also formatter and type check)',
    '   when the file contains no command for that task. If the file has one (for example a',
    '   `npm test` in a Commands section), the prose is fine and nothing is reported. A line that',
    '   already has inline code is never reported.',
    '',
    '2. A root instruction file with no command at all. Without them an agent has to guess how to',
    '   build and test. Files that import another file (`@AGENTS.md`) and nested files are skipped.',
    '',
    'Fix: add a Commands section with the exact install, build, test and lint commands.',
    '`agent-md-caregiver --init` prints a skeleton. Suppress with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ file, text, parsed }) {
    /** @type {import('./index.js').RuleFinding[]} */
    const findings = [];
    const commands = parsed.claims.filter((c) => c.kind === 'command').map((c) => c.text);
    const nonBlank = text.split(/\r?\n/).filter((l) => l.trim() !== '').length;

    if (commands.length === 0 && !file.includes('/') && nonBlank > 0 && !hasImport(parsed)) {
      findings.push({
        message: 'No commands: agents cannot tell how to build, test or lint this project',
        line: 1,
        col: 1,
        evidence: text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '',
        suggestion: 'Add a Commands section with the exact install, build, test and lint commands (`--init` prints a skeleton).',
      });
    }

    const seen = new Set();
    for (const { n, text: line } of proseLines(text)) {
      if (line.includes('`') || /^\s*#/.test(line)) continue;
      for (const topic of TOPICS) {
        if (seen.has(topic.name)) continue;
        const m = topic.say.exec(line);
        if (!m || isHedged(line, m.index + 1)) continue;
        if (commands.some((c) => topic.command.test(c))) continue;
        seen.add(topic.name);
        findings.push({
          message: `Vague: "${m[0].trim()}" but the file has no ${topic.name} command`,
          line: n,
          col: m.index + 1,
          evidence: line.trim(),
          suggestion: topic.fix,
        });
      }
    }
    return findings;
  },
};
