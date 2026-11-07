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

**Documentation: [fsystemweb.github.io/agent-md-caregiver](https://fsystemweb.github.io/agent-md-caregiver/)**

> **Status: v0.1.0, not yet on npm.** All eleven rules and the CLI work (`pretty`, `json`, `github` and `sarif` output); see the [changelog](CHANGELOG.md). The demo below is real output, checked by a test on every run. Until the first publish, run it from a clone: `node src/cli.js`.

## Why

Everyone writing agent instruction files has stale ones. A script gets renamed, a folder moves, the team switches to pnpm, and the file keeps telling agents to run commands that no longer exist. Agents *do follow* these files, so every stale line wastes tokens and sends the agent in the wrong direction, in every session. No linter checks them.

`agent-md-caregiver` reads your instruction file, extracts every claim it can verify, and checks each one against your file tree, `package.json` scripts, lockfiles and git history.

## What it finds

| Rule | Catches |
|---|---|
| `AMC001` command-not-found | `npm run lint:fix` when no `lint:fix` script exists; `make deploy` with no target |
| `AMC002` path-missing | `src/utils/helpers.ts` was renamed or deleted. Suggests the new path from git history |
| `AMC003` contradiction | "Use pnpm" in one place, `npm install` in another (same for "use uv" and `pip install x`); tabs vs spaces; "never X" vs "run X" |
| `AMC004` package-manager-mismatch | File says `npm`, lockfile says `pnpm` |
| `AMC005` broken-import | `@AGENTS.md` or a relative link that points nowhere |
| `AMC006` vague-instruction | "Run the tests" with no command |
| `AMC007` too-long | Over the line budget (default 150): agents follow roughly 150-200 instructions in total |
| `AMC008` tree-dump | Big directory listings that go stale and don't help agents navigate |
| `AMC009` missing-boundaries | No Always / Ask first / Never section |
| `AMC010` legacy-filename | `codex.md`, or `CLAUDE.md` and `AGENTS.md` that have drifted apart |
| `AMC011` duplicate-instruction | The same instruction twice |

## Compatibility

JavaScript and TypeScript repos get every rule. Other stacks get the language-agnostic ones.

| Ecosystem | Level | What works |
|---|---|---|
| npm, pnpm, yarn, bun | Full | all rules |
| pip, uv (Python) | Full | package manager (`AMC003`, `AMC004`), Poe tasks, console scripts and pytest (`AMC001`), `src/` layouts (`AMC002`) |
| poetry, pipenv, pdm | Partial | detected for mismatch and contradiction checks |
| Any language with a Makefile | Partial | `make` targets (`AMC001`) |
| Go, Rust, Java, others | Partial | paths (`AMC002`), links and imports (`AMC005`), hygiene (`AMC006`-`AMC011`), tabs vs spaces (`AMC003`) |
| cargo, go, maven... | None | not detected: the tool stays quiet instead of guessing |

Needs Node 20 or newer; `git` is optional (used for rename suggestions). Per-rule table and details: [docs/compatibility.md](docs/compatibility.md).

## Demo

Given this `AGENTS.md`:

```md
# Acme API

@docs/code-style.md

## Commands
- Install: `npm install`
- Test: `npm run test:unit`
- Lint: `npm run lint:fix`

## Layout
- HTTP handlers live in `src/routes/users.ts`
```

and a repo where the only scripts are `test` and `build`, and git history shows `docs/code-style.md` was renamed to `docs/style.md` and `src/routes/users.ts` to `src/routes/user.ts`:

```text
$ node src/cli.js

AGENTS.md
  3:2     error  Import `docs/code-style.md` does not exist  AMC005
          > @docs/code-style.md
          fix: Renamed to `docs/style.md` in git history. Update the import.
  7:10    error  `npm run test:unit`: no such script "test:unit" in package.json  AMC001
          > `npm run test:unit`
          fix: Did you mean `npm run test`?
  8:10    error  `npm run lint:fix`: no such script "lint:fix" in package.json  AMC001
          > `npm run lint:fix`
          fix: Add a "lint:fix" script to package.json or remove this command. Available scripts: build, test.
  11:26   error  `src/routes/users.ts` does not exist  AMC002
          > `src/routes/users.ts`
          fix: Renamed to `src/routes/user.ts` in git history. Replace the path.

1 file checked: 4 error(s), 0 warning(s), 0 info.
```

The exit code is `1`. `test/readme-demo.test.js` rebuilds that repo and checks this output line by line, so the example cannot drift from the tool.

## Usage

```bash
npx agent-md-caregiver                 # auto-discovers AGENTS.md, CLAUDE.md, codex.md (also nested ones)
npx agent-md-caregiver AGENTS.md       # check specific files
npx agent-md-caregiver --format json   # machine-readable, for agents and scripts
npx agent-md-caregiver --format agent  # findings + what the rules could not judge, for an agent to review
npx agent-md-caregiver --strict        # warnings fail too (CI)
npx agent-md-caregiver --explain AMC002
```

Exit codes: `0` clean · `1` findings at or above the threshold · `2` usage or internal error.

Suppress a false positive with `<!-- amc-ignore-next-line -->`. Tune severity with `--rule AMC007=off` or a `.agentmdcaregiver.json` in the repo root:

```json
{ "maxLines": 200, "strict": false, "rules": { "AMC008": "off", "AMC006": "error" } }
```

Command-line options win over the file. An invalid file is an error (exit 2), never silently ignored.

### In CI

```yaml
- run: npx agent-md-caregiver --strict --format github   # annotations on the PR
# or upload to code scanning:
- run: npx agent-md-caregiver --format sarif > amc.sarif || true
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: amc.sarif }
```

Use `actions/checkout` with `fetch-depth: 0` so rename suggestions can read git history. This repo runs the first form on itself.

### Using it from a coding agent

Every finding in `--format json` carries file, line, evidence and a concrete suggestion, so an agent can fix the file without guessing. The JSON schema is versioned (`schemaVersion`). Add this to your own `AGENTS.md`:

```md
Before finishing a task that changes scripts, folders or tooling, run `npx agent-md-caregiver` and fix anything it reports.
```

### Agent review (optional)

The rules check facts. For what they cannot judge (vague lines, conflicts in different words, sections with nothing checkable), `--format agent` prints a [review handoff](docs/handoff-schema.md) for your coding agent, and the package ships a Claude Code skill (`skills/agent-md-review`) that reviews it and proposes edits you approve. The tool itself still does not call an LLM, use the network or run your commands, and exit codes never depend on the review. See [docs/agent-review.md](docs/agent-review.md).

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
