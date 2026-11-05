# Contributing

Thanks for helping. The flow is deliberately simple.

## 1. Open an issue first

Use a template: **Bug report**, **New rule proposal**, or **Feature request**. For a new rule, include a real-world snippet from an instruction file and say what the repo looked like. Small fixes (typos, docs) can go straight to a PR.

## 2. Fork, branch, code

```bash
git clone https://github.com/OWNER/agent-md-caregiver.git
cd agent-md-caregiver
git checkout -b feat/short-description
npm test
```

Branch prefixes: `feat/`, `fix/`, `docs/`, `chore/`. Requires Node 20 or newer. There are no runtime dependencies and we want to keep it that way.

## 3. Rules of the road

- **One PR, one concern.** Small PRs get reviewed fast.
- **Tests required.** A new rule needs a test file and at least one fixture where it fires and one where it must stay silent. False positives are the biggest risk of this tool, so the "stays silent" case matters as much as the other.
- **Deterministic and offline.** No LLM calls, no network, never execute commands found in a file.
- **Update docs** (README rule table, `--explain` text) when behavior changes.
- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/), e.g. `feat(rules): add AMC008 tree-dump`.

## 4. Open the PR

Fill in the PR template. Link the issue (`Closes #123`). Make sure `npm test` passes.

## Adding a rule (when the rule framework lands)

1. Pick the next free `AMC0NN` id.
2. Add `src/rules/<name>.js` and `test/rules/<name>.test.js`.
3. Add fixtures under `test/fixtures/<name>/`.
4. Register it, document it in the README table, add `--explain` text.

## Conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
