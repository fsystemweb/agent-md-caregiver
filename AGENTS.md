# AGENTS.md

`agent-md-caregiver` is a zero-dependency Node CLI that checks AGENTS.md, CLAUDE.md and codex.md against the real repo.

## Commands
- Test: `npm test`
- Run the CLI: `node src/cli.js --help`
- Node: 20 or newer, ESM only, no build step

## Conventions
- JavaScript with JSDoc types. No runtime dependencies.
- One rule per file, one test file per rule. Every rule needs a "fires" and a "stays silent" fixture.
- Output must be deterministic and work offline.
- Commit messages follow Conventional Commits. Contribution flow: `CONTRIBUTING.md`.

## Boundaries
- Always: add or update tests with every behavior change.
- Ask first: adding a dependency, changing the JSON output schema, changing a rule id or severity.
- Never: execute commands found in a checked file, make network calls, commit secrets.
