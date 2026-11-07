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
| pip | Full | `requirements*.txt` (and a `pyproject.toml` without `[project]` or a tool table) |
| uv | Full | `uv.lock` or `[tool.uv]` in `pyproject.toml` |
| poetry, pipenv, pdm | Partial | `poetry.lock` / `[tool.poetry]`, `Pipfile`, `pdm.lock` / `[tool.pdm]` are detected, so mismatches and contradictions are reported; no install-command translation beyond the common cases |
| cargo, go, composer, gradle, maven, bundler | None | not detected, no checks |

## Languages and ecosystems

| Ecosystem | Level | What works | What does not |
|---|---|---|---|
| JavaScript / TypeScript | Full | `AMC001`-`AMC011` | |
| Any language with a Makefile | Partial | `make` targets verified (`AMC001`) | |
| Python | Full (pip, uv) | package-manager mismatch and contradiction (`AMC003`, `AMC004`), Poe tasks and console scripts (`AMC001`), pytest declared (`AMC001`), `src/` layouts (`AMC002`), plus everything below | |
| Go, Rust, Java, others | Partial | paths (`AMC002`, including the file argument of `node`, `python`, `pytest`), imports and links (`AMC005`), hygiene (`AMC006`-`AMC011`), tabs vs spaces (`AMC003`) | script and command verification, package-manager checks |
| Test runners | Names only | jest, vitest, mocha, pytest, ava, jasmine, node:test compared against each other (`AMC003`) | not confirmed against repo config |

## Rules

| Rule | Depends on JavaScript? |
|---|---|
| `AMC000` empty-file | No |
| `AMC001` command-not-found | `npm`/`pnpm`/`yarn`/`bun` scripts: yes. `make` targets: no. Python: Poe tasks, `uv run` console scripts, pytest |
| `AMC002` path-missing | No (`src/` layouts and subfolder-relative paths are understood) |
| `AMC003` contradiction | JavaScript and Python package managers, test runners, tabs vs spaces, "never X" vs "run X" |
| `AMC004` package-manager-mismatch | JavaScript (npm, pnpm, yarn, bun) and Python (pip, uv, poetry, pipenv, pdm) |
| `AMC005` broken-import | No |
| `AMC006`-`AMC011` hygiene | No |

## Checked by hand

Fixture repos for Go and Rust were linted for this page; Python was checked on real projects (below). A run on real Go and Rust projects that have instruction files is still open: there are none on the maintainer's machine.

| Fixture | Caught | Stayed silent (as designed) |
|---|---|---|
| Go | missing `make` target, missing path | `go test ./...` |
| Rust | missing path | `cargo nextest run`, `npm install` in a repo without `package.json` |

### Python, on real projects

Four local Python projects (three pip, one uv with `pyproject.toml` and `uv.lock`) were linted with a typical `AGENTS.md` (setup, install, run, test, venv, `uvx`, `uv pip`, `pip install -r`). Result: no false positives; the one finding (`python main.py` where the repo has no `main.py`) was a real mistake.

Gaps worth their own issues: `Cargo.toml`, `go.mod`, `justfile`, and install-command translation for poetry, pipenv and pdm.
