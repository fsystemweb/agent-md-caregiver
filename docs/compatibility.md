# Compatibility

`agent-md-caregiver` is JavaScript-first. This page says what to expect on other stacks.

**Requirements:** Node 20 or newer. `git` is optional: with it the tool reads the file tree from git and suggests renames from history; without it the tool walks the filesystem and skips rename suggestions.

Support levels:

- **Full**: all rules that apply to the ecosystem work.
- **Partial**: some rules work.
- **Names only**: recognised by name, but not verified against the repo.
- **None**: ignored. The tool stays quiet rather than guess.

Last verified against the code and against fixture repos on 2026-11-07.

## Package managers

| Manager | Level | Requirement |
|---|---|---|
| npm | Full | `package.json`, `package-lock.json` or `packageManager` field |
| pnpm | Full | `pnpm-lock.yaml` or `packageManager` field |
| yarn | Full | `yarn.lock` or `packageManager` field |
| bun | Full | `bun.lock` / `bun.lockb` or `packageManager` field |
| pip / poetry / uv | None | not detected, no checks (tracked in [#14](https://github.com/fsystemweb/agent-md-caregiver/issues/14)) |
| cargo, go, composer, gradle, maven, bundler | None | not detected, no checks |

## Languages and ecosystems

| Ecosystem | Level | What works | What does not |
|---|---|---|---|
| JavaScript / TypeScript | Full | `AMC001`-`AMC011` | |
| Any language with a Makefile | Partial | `make` targets verified (`AMC001`) | |
| Python, Go, Rust, Java, others | Partial | paths (`AMC002`, including the file argument of `node`, `python`, `pytest`), imports and links (`AMC005`), hygiene (`AMC006`-`AMC011`), tabs vs spaces (`AMC003`) | script and command verification, package-manager checks |
| Test runners | Names only | jest, vitest, mocha, pytest, ava, jasmine, node:test compared against each other (`AMC003`) | not confirmed against repo config |

## Rules

| Rule | Depends on JavaScript? |
|---|---|
| `AMC000` empty-file | No |
| `AMC001` command-not-found | `npm`/`pnpm`/`yarn`/`bun` scripts: yes. `make` targets: no |
| `AMC002` path-missing | No |
| `AMC003` contradiction | Package manager and test runner: yes. Tabs vs spaces, "never X" vs "run X": no |
| `AMC004` package-manager-mismatch | Yes |
| `AMC005` broken-import | No |
| `AMC006`-`AMC011` hygiene | No |

## Checked by hand

Fixture repos for Python (uv), Go and Rust were linted for this page. A run on real Python, Go and Rust projects that have instruction files is still open: the Python repos on the maintainer's machine have none, and there are no local Go or Rust repos.

| Fixture | Caught | Stayed silent (as designed) |
|---|---|---|
| Python + uv | missing path, missing `pytest` file | `uv run <unknown script>`, `pip install` in a uv repo, "pip" vs "uv" |
| Go | missing `make` target, missing path | `go test ./...` |
| Rust | missing path | `cargo nextest run`, `npm install` in a repo without `package.json` |

Planned: [#14](https://github.com/fsystemweb/agent-md-caregiver/issues/14) (Python). Gaps worth their own issues: `Cargo.toml`, `go.mod`, `justfile`.
