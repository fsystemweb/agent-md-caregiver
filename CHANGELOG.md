# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project follows [Semantic Versioning](https://semver.org/). The JSON report has its own `schemaVersion`, see [docs/json-schema.md](docs/json-schema.md).

## [Unreleased]

### Added
- Documentation site (#15): Markdown in `docs/` served by GitHub Pages from `/docs` (no build step in the package): home, getting started, CLI reference, one page per rule `AMC000`-`AMC011` (kept in sync with `--explain` by a test), configuration, CI guide, compatibility, agent review and schemas. A test checks every relative link. `--docs` prints the site URL (offline), `--help` ends with it, and `homepage` in `package.json` points to it. No `postinstall` script, on purpose.
- Agent review layer (#16): `--format agent` prints a versioned review handoff (`schemaVersion: 1`, documented in `docs/handoff-schema.md`) with what the rules could not decide: skipped commands, sections with nothing checkable, candidate contradictions and unchecked prose instructions. The package ships a Claude Code skill (`skills/agent-md-review`) with prompt-injection guidance. The tool still makes no network calls and runs no subprocess for it, and exit codes come from the deterministic rules only.
- Python support (#14). Package managers pip and uv are detected (`uv.lock`, `[tool.uv]`, `requirements*.txt`); poetry, pipenv and pdm are detected too. `AMC004` flags `pip install x` in a uv repo and the reverse, with a safe translation (`uv add x`); `AMC003` flags "use uv" against `pip install x`, within and across files; `AMC001` checks `poe <task>`, near-miss `uv run <script>` against `pyproject.toml`, and `pytest` in a project that never mentions it. `python -m venv`, `pip install -r/-e/.`, `uvx`, `pipx`, `uv pip` and global installs are never flagged. A small zero-dependency TOML reader backs it; anything it does not understand means "stay silent".
- Compatibility table (languages, package managers, per-rule dependency on JavaScript) in the README and `docs/compatibility.md` (#13).

### Fixed
- Security (audit findings, low): `.gitignore` lines and `package.json` workspace globs no longer compile to backtracking regexes. A pattern such as `*a*a*a*b` against a long name, or one `.gitignore` line with tens of thousands of spaces, could pin the CPU for seconds to minutes. Globs now match with a linear-time matcher, over-long lines (more than 4096 characters) are skipped, and a malformed character class like `[z-a]` no longer crashes the run (#18).
- Security (audit finding, low): symlinks that leave the repo root are no longer followed. A `codex.md`, `CLAUDE.md`, `AGENTS.md`, `.agentmdcaregiver.json` or `.gitignore` pointing outside the checked repo is not discovered, read or echoed in findings; naming one on the command line or as the config is an error (exit 2). Symlinks inside the repo still work (#18).
- Security (audit finding, low): the pretty and GitHub reports now show control characters (ESC, CSI, OSC, a lone CR, bidi overrides) from the checked files as `\xNN` / `\uNNNN` instead of passing them to the terminal or log viewer (#18).
- `AMC002` no longer reports paths written relative to a subfolder (`main.tsx` for `src/main.tsx`) or package specifiers such as `three@0.160.0/examples/jsm/` (#11). It also accepts git-ignored files that exist on disk under a subfolder (`backend/appsettings.json`) and module specifiers without an extension (`./state` for `src/state.ts`).

## [0.1.0] - 2026-11-05

First release. Not published to npm yet.

### Added
- Markdown claim extractor: commands (fenced and inline, with `cd` tracking), paths, `@imports`, relative links and directives, each with exact line and column. Skips placeholders, globs, URLs, blockquotes and non-shell blocks; honours `<!-- amc-ignore -->` and `<!-- amc-ignore-next-line -->`.
- Read-only repo context: `.gitignore`-aware file tree (git or filesystem fallback), `package.json` scripts, workspaces, lockfiles, `packageManager`, Makefile targets and git rename history.
- Rules:
  - `AMC000` empty-file (info)
  - `AMC001` command-not-found (error): missing npm/pnpm/yarn/bun scripts, workspaces and `make` targets, with did-you-mean
  - `AMC002` path-missing (error): suggests the git rename or the closest path
  - `AMC003` contradiction (error): package manager, tabs vs spaces, test runner, "never X" vs "run X", within and across files
  - `AMC004` package-manager-mismatch (warn)
  - `AMC005` broken-import (error)
  - `AMC006` vague-instruction (warn)
  - `AMC007` too-long (warn)
  - `AMC008` tree-dump (info)
  - `AMC009` missing-boundaries (info)
  - `AMC010` legacy-filename (info)
  - `AMC011` duplicate-instruction (info)
- CLI: file and directory arguments, `--root`, `--format pretty|json|github|sarif`, `--max-lines`, `--rule <id>=<level>`, `--strict`, `--init [--write]`, `--explain <id>`, `--no-color`. Exit codes 0 clean, 1 findings, 2 usage or internal error.
- `.agentmdcaregiver.json` config (`maxLines`, `strict`, `rules`); command-line options win.
- JSON report with `schemaVersion: 1`, GitHub Actions annotations, SARIF 2.1.0.
- CI on Node 20 and 22 with the tool linting its own `AGENTS.md`.

### Known limitations
- The parser only reads a line as an instruction when it has a verb such as always, never, must, do not, prefer or use, so some contradictions are missed (on purpose: false positives are the main risk).
