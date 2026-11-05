<p align="center">
  <img src="assets/logo.svg" alt="A nurse taking care of a Markdown file" width="180">
</p>

<h1 align="center">agent-md-caregiver</h1>

<p align="center">
  <strong>A linter for your agent instructions.</strong><br>
  Checks <code>AGENTS.md</code>, <code>CLAUDE.md</code> and <code>codex.md</code> against the actual repo.
</p>

<p align="center">
  <a href="LICENSE">MIT</a> · Node ≥ 20 · zero runtime dependencies · offline and deterministic
</p>

> **Status: pre-alpha, design phase.** The plan is in [PLAN.md](PLAN.md) and the tool lands PR by PR. The demo below is a **preview of the target output**, not a recording. It will be replaced with a real one in the release PR.

## Why

Everyone writing agent instruction files has stale ones. A script gets renamed, a folder moves, the team switches to pnpm, and the file keeps telling agents to run commands that no longer exist. Agents *do follow* these files, so every stale line wastes tokens and sends the agent in the wrong direction, in every session. No linter checks them.

`agent-md-caregiver` reads your instruction file, extracts every claim it can verify, and checks each one against your file tree, `package.json` scripts, lockfiles and git history.

## What it finds

| Rule | Catches |
|---|---|
| `AMC001` command-not-found | `npm run lint:fix` when no `lint:fix` script exists; `make deploy` with no target |
| `AMC002` path-missing | `src/utils/helpers.ts` was renamed or deleted. Suggests the new path from git history |
| `AMC003` contradiction | "Use pnpm" in one place, `npm install` in another; tabs vs spaces; "never X" vs "run X" |
| `AMC004` package-manager-mismatch | File says `npm`, lockfile says `pnpm` |
| `AMC005` broken-import | `@AGENTS.md` or a relative link that points nowhere |
| `AMC006` vague-instruction | "Run the tests" with no command |
| `AMC007` too-long | Over the line budget (default 150): agents follow roughly 150-200 instructions in total |
| `AMC008` tree-dump | Big directory listings that go stale and don't help agents navigate |
| `AMC009` missing-boundaries | No Always / Ask first / Never section |
| `AMC010` legacy-filename | `codex.md`, or `CLAUDE.md` and `AGENTS.md` that have drifted apart |
| `AMC011` duplicate-instruction | The same instruction twice |

Details and severities are in [PLAN.md](PLAN.md#33-rules-srcrules-one-file-per-rule-one-test-file-per-rule).

## Demo (preview of target output)

Given this `AGENTS.md`:

```md
# Acme API

## Commands
- Install: `pnpm install`
- Test: `npm run test:unit`
- Lint: `npm run lint:fix`

## Layout
- HTTP handlers live in `src/routes/users.ts`
```

and a repo where the script is called `test`, there is no `lint:fix`, the file was renamed to `src/routes/user.ts`, and the lockfile is `package-lock.json`:

```text
$ npx agent-md-caregiver

AGENTS.md
  4:11  error  AMC004  File says `pnpm` but the repo uses npm (package-lock.json found)
  5:9   error  AMC001  `npm run test:unit` — no such script. Did you mean `test`?
  6:9   error  AMC001  `npm run lint:fix` — no such script. Available: test, build
  9:32  error  AMC002  `src/routes/users.ts` does not exist. Renamed to `src/routes/user.ts` (git, 3 days ago)

✖ 4 problems (4 errors, 0 warnings)
```

## Usage (planned CLI)

```bash
npx agent-md-caregiver                 # auto-discovers AGENTS.md, CLAUDE.md, codex.md (also nested ones)
npx agent-md-caregiver AGENTS.md       # check specific files
npx agent-md-caregiver --format json   # machine-readable, for agents and scripts
npx agent-md-caregiver --strict        # warnings fail too (CI)
npx agent-md-caregiver --explain AMC002
```

Exit codes: `0` clean · `1` findings at or above the threshold · `2` usage or internal error.

Suppress a false positive with `<!-- amc-ignore-next-line -->`. Tune severity with `--rule AMC007=off` or `.agentmdcaregiver.json`.

### Using it from a coding agent

Every finding in `--format json` carries file, line, evidence and a concrete suggestion, so an agent can fix the file without guessing. The JSON schema is versioned (`schemaVersion`). Add this to your own `AGENTS.md`:

```md
Before finishing a task that changes scripts, folders or tooling, run `npx agent-md-caregiver` and fix anything it reports.
```

## Our standard: AGENTS.md first

- `AGENTS.md` is the single source of truth (read by Codex, Cursor, Copilot, Jules, Devin, opencode and more).
- `CLAUDE.md` is a one-line `@AGENTS.md` import (or a symlink) plus anything Claude-specific.
- `codex.md` is legacy: migrate to `AGENTS.md`.
- Keep it under about 150 lines. Link deeper docs instead of inlining them.
- Exact, runnable commands first. Boundaries: Always / Ask first / Never.
- Write it by hand. Auto-generated context files were reported to lower task success and raise cost.

## What it does not do

- It does not call an LLM, use the network, or execute the commands in your file.
- It does not generate your instruction file.
- It checks claims, not writing style.

## Contributing

Issues and PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md); it is short.

## License

[MIT](LICENSE). Open to use.
