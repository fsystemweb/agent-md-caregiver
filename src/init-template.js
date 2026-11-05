/** The recommended AGENTS.md skeleton printed by `--init`. Short on purpose. */
export const INIT_TEMPLATE = `# AGENTS.md

One or two sentences: what this project is. Link deeper docs instead of inlining them.

## Commands
- Install: \`<exact install command>\`
- Build: \`<exact build command>\`
- Test: \`<exact test command>\`
- Lint: \`<exact lint command>\`

## Conventions
- Language, version and style rules an agent could not guess from the code.

## Boundaries
- Always: run the tests before committing.
- Ask first: adding a dependency, changing public APIs, deleting files.
- Never: commit secrets, edit generated files by hand.
`;
