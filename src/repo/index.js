import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { gitFiles, gitRenames, gitStatus, isGitRepo } from './git.js';
import { matchIgnore, parseGitignore } from './gitignore.js';
import { isOpaqueMakefile, parseMakeTargets } from './makefile.js';
import {
  LOCKFILES,
  matchWorkspaceDirs,
  parsePackageManager,
  workspacePatterns,
} from './package.js';
import { parsePyproject, REQUIREMENTS_FILE } from './python.js';
import { walkFiles } from './walk.js';

/**
 * @typedef {object} WorkspacePackage
 * @property {string} dir      Relative to the repo root.
 * @property {string | null} name
 * @property {string[]} scripts  Script names, sorted.
 *
 * @typedef {object} RepoContextOptions
 * @property {boolean} [useGit]  Ask git for the file list and rename history. Default true;
 *                               falls back to a filesystem walk when git is unavailable.
 */

const MAKEFILES = ['Makefile', 'makefile', 'GNUmakefile'];

/**
 * Normalize a path as written in an instruction file to a repo-relative '/' path.
 * Returns null for anything that cannot be inside the repo (absolute, `~/`, or escaping with `..`).
 * @param {string} p
 * @returns {string | null} '' means the repo root
 */
export function normalizeRepoPath(p) {
  if (!p || p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:[\\/]/.test(p)) return null;
  const n = posix.normalize(p.replace(/\\/g, '/')).replace(/\/+$/, '');
  if (n === '..' || n.startsWith('../')) return null;
  return n === '.' ? '' : n;
}

/**
 * Read-only, lazily computed, cached view of a repository. Nothing here runs anything
 * from the files it reads; the only subprocess is a fixed `git` command.
 */
export class RepoContext {
  /**
   * @param {string} root
   * @param {RepoContextOptions} [options]
   */
  constructor(root = process.cwd(), options = {}) {
    /** Absolute repo root. */
    this.root = resolve(root);
    this.useGit = options.useGit !== false;
    /** @type {Map<string, any>} */
    this._cache = new Map();
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => T} compute
   * @returns {T}
   */
  _memo(key, compute) {
    if (!this._cache.has(key)) this._cache.set(key, compute());
    return this._cache.get(key);
  }

  /** True when git is available and `root` is inside a work tree (and `useGit` is on). */
  get isGit() {
    return this._memo('isGit', () => this.useGit && isGitRepo(this.root));
  }

  _tree() {
    return this._memo('tree', () => {
      const fromGit = this.isGit ? gitFiles(this.root) : null;
      const files = fromGit ? fromGit.files : walkFiles(this.root);
      const dirs = new Set(fromGit ? fromGit.dirs : []);
      for (const f of [...files, ...(fromGit ? fromGit.dirs : [])]) {
        for (let d = posix.dirname(f); d !== '.' && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
      }
      return { files, fileSet: new Set(files), dirs };
    });
  }

  /**
   * Files in the tree, sorted, relative to the root with '/'. Respects .gitignore; deleted
   * files are excluded; `.git` and `node_modules` are never listed.
   * @returns {string[]}
   */
  files() {
    return this._tree().files;
  }

  /**
   * Directories that contain at least one listed file (plus submodule directories), sorted.
   * @returns {string[]}
   */
  dirs() {
    return this._memo('dirs', () => [...this._tree().dirs].sort());
  }

  /**
   * Does this path, as written in an instruction file, exist in the tree?
   * Ignored files do not count; see `existsOnDisk`.
   * @param {string} p
   * @returns {boolean}
   */
  hasPath(p) {
    const n = normalizeRepoPath(p);
    if (n === null) return false;
    if (n === '') return true;
    const { fileSet, dirs } = this._tree();
    return fileSet.has(n) || dirs.has(n);
  }

  /**
   * Does the path exist on disk, ignored or not (`dist/`, `.env`)? Never leaves the root.
   * @param {string} p
   * @returns {boolean}
   */
  existsOnDisk(p) {
    const n = normalizeRepoPath(p);
    if (n === null) return false;
    const abs = join(this.root, n);
    const rel = relative(this.root, abs);
    return !rel.startsWith('..') && !isAbsolute(rel) && existsSync(abs);
  }

  /**
   * Is this path ignored by .gitignore (so it is legitimately absent from the tree, like
   * `dist/` or `.env`)? Asks git when available, else applies .gitignore files itself.
   * `node_modules` and `.git` always count as ignored.
   * @param {string} p
   * @returns {boolean}
   */
  isIgnored(p) {
    const n = normalizeRepoPath(p);
    if (!n) return false;
    const slash = p.endsWith('/');
    return this._memo(`ignored:${n}${slash ? '/' : ''}`, () => {
      const segs = n.split('/');
      if (segs.some((s) => s === 'node_modules' || s === '.git')) return true;
      if (this.isGit) {
        const r = gitStatus(this.root, ['check-ignore', '-q', '--', slash ? `${n}/` : n]);
        if (r.status === 0) return true;
        if (r.status === 1) return false;
      }
      return this._ignoredByFiles(segs, slash);
    });
  }

  /**
   * @param {string[]} segs
   * @param {boolean} lastIsDir
   * @returns {boolean}
   */
  _ignoredByFiles(segs, lastIsDir) {
    for (let i = 1; i <= segs.length; i++) {
      const sub = segs.slice(0, i).join('/');
      const isDir = i < segs.length || lastIsDir || this._tree().dirs.has(sub) || isDirOnDisk(join(this.root, sub));
      let ignored = false;
      for (let j = 0; j < i; j++) {
        const base = segs.slice(0, j).join('/');
        const rules = this._gitignoreAt(base);
        if (!rules.length) continue;
        const m = matchIgnore(rules, segs.slice(j, i).join('/'), isDir);
        if (m !== null) ignored = m;
      }
      if (ignored) return true;
    }
    return false;
  }

  /**
   * @param {string} dir
   * @returns {import('./gitignore.js').IgnoreRule[]}
   */
  _gitignoreAt(dir) {
    return this._memo(`gitignore:${dir}`, () => {
      const text = this._readText(dir ? `${dir}/.gitignore` : '.gitignore');
      return text ? parseGitignore(text) : [];
    });
  }

  /**
   * Parsed package.json inside `dir` (relative to the root, '' = root), or null.
   * @param {string} dir
   * @returns {any | null}
   */
  packageJsonAt(dir) {
    const n = dir === '' ? '' : normalizeRepoPath(dir);
    if (n === null) return null;
    return this._memo(`pkgAt:${n}`, () => this._readJson(n ? `${n}/package.json` : 'package.json'));
  }

  /**
   * Scripts of the package.json inside `dir`, or null if there is none.
   * @param {string} dir
   * @returns {Record<string, string> | null}
   */
  scriptsAt(dir) {
    const pkg = this.packageJsonAt(dir);
    return pkg ? stringRecord(pkg.scripts) : null;
  }

  /**
   * Makefile facts for `dir` (relative to the root, '' = root).
   * @param {string} dir
   * @returns {{ exists: boolean, targets: string[], opaque: boolean }}
   */
  makeAt(dir) {
    const n = dir === '' ? '' : normalizeRepoPath(dir);
    if (n === null) return { exists: false, targets: [], opaque: true };
    return this._memo(`makeAt:${n}`, () => {
      const name = MAKEFILES.find((f) => this._tree().fileSet.has(n ? `${n}/${f}` : f));
      const text = name ? this._readText(n ? `${n}/${name}` : name) : null;
      if (text === null) return { exists: false, targets: [], opaque: false };
      return { exists: true, targets: parseMakeTargets(text), opaque: isOpaqueMakefile(text) };
    });
  }

  /**
   * Parsed root package.json, or null if missing or invalid.
   * @returns {any | null}
   */
  packageJson() {
    return this._memo('pkg', () => this._readJson('package.json'));
  }

  /**
   * `scripts` of the root package.json (string values only).
   * @returns {Record<string, string>}
   */
  scripts() {
    return this._memo('scripts', () => stringRecord(this.packageJson()?.scripts));
  }

  /**
   * Parsed `packageManager` field, e.g. `{ name: 'pnpm', version: '9.1.0', raw }`.
   * @returns {{ name: string, version: string | null, raw: string } | null}
   */
  packageManager() {
    return parsePackageManager(this.packageJson()?.packageManager);
  }

  /**
   * `engines` of the root package.json (string values only).
   * @returns {Record<string, string>}
   */
  engines() {
    return this._memo('engines', () => stringRecord(this.packageJson()?.engines));
  }

  /**
   * Lockfiles present at the root.
   * @returns {{ file: string, manager: 'npm' | 'pnpm' | 'yarn' | 'bun' }[]}
   */
  lockfiles() {
    return this._memo('locks', () =>
      LOCKFILES.filter(([file]) => this._tree().fileSet.has(file)).map(([file, manager]) => ({
        file,
        manager,
      })),
    );
  }

  /**
   * Workspace glob patterns from package.json and pnpm-workspace.yaml.
   * @returns {string[]}
   */
  workspacePatterns() {
    return this._memo('wsPatterns', () => {
      const yaml = this._tree().fileSet.has('pnpm-workspace.yaml')
        ? this._readText('pnpm-workspace.yaml')
        : null;
      return workspacePatterns(this.packageJson(), yaml);
    });
  }

  /**
   * Workspace packages: directories that match a pattern and contain a package.json.
   * @returns {WorkspacePackage[]}
   */
  workspaces() {
    return this._memo('workspaces', () => {
      const patterns = this.workspacePatterns();
      if (patterns.length === 0) return [];
      const candidates = this.files()
        .filter((f) => f.endsWith('/package.json'))
        .map((f) => posix.dirname(f));
      return matchWorkspaceDirs(patterns, candidates).map((dir) => {
        const pkg = this._readJson(`${dir}/package.json`);
        return {
          dir,
          name: typeof pkg?.name === 'string' ? pkg.name : null,
          scripts: Object.keys(stringRecord(pkg?.scripts)).sort(),
        };
      });
    });
  }

  /**
   * Parsed pyproject.toml at `dir` ('' = root), or null when absent or not understood.
   * @param {string} dir
   * @returns {import('./python.js').PyProject | null}
   */
  pyprojectAt(dir) {
    return this._memo(`pyproject:${dir}`, () => {
      const rel = dir ? `${dir}/pyproject.toml` : 'pyproject.toml';
      if (!this._tree().fileSet.has(rel)) return null;
      const text = this._readText(rel);
      return text === null ? null : parsePyproject(text);
    });
  }

  /**
   * Is there a pyproject.toml at `dir` at all (even one the reader could not parse)?
   * @param {string} dir
   * @returns {boolean}
   */
  hasPyprojectAt(dir) {
    return this._tree().fileSet.has(dir ? `${dir}/pyproject.toml` : 'pyproject.toml');
  }

  /**
   * Requirements files (`requirements*.txt`, `*.in`) directly in `dir`.
   * @param {string} dir
   * @returns {string[]}  Repo-relative paths.
   */
  requirementFilesAt(dir) {
    return this._memo(`reqs:${dir}`, () =>
      this.files().filter(
        (f) => posix.dirname(f) === (dir || '.') && REQUIREMENTS_FILE.test(posix.basename(f)),
      ),
    );
  }

  /**
   * Text of a tracked file, or null. Never leaves the tree.
   * @param {string} rel
   * @returns {string | null}
   */
  textAt(rel) {
    return this._tree().fileSet.has(rel) ? this._readText(rel) : null;
  }

  /**
   * Root Makefile name (`Makefile`, `makefile` or `GNUmakefile`), or null.
   * @returns {string | null}
   */
  makefile() {
    return this._memo('makefile', () => MAKEFILES.find((f) => this._tree().fileSet.has(f)) ?? null);
  }

  /**
   * Explicit targets of the root Makefile, sorted. Empty if there is none.
   * @returns {string[]}
   */
  makeTargets() {
    return this._memo('makeTargets', () => {
      const name = this.makefile();
      const text = name ? this._readText(name) : null;
      return text ? parseMakeTargets(text) : [];
    });
  }

  /**
   * Renames recorded in git history, oldest first. Empty without git or without history.
   * @returns {{ from: string, to: string }[]}
   */
  renames() {
    return this._memo('renames', () => (this.isGit ? gitRenames(this.root).reverse() : []));
  }

  /**
   * Where did an old path go? Follows chains (a → b → c) and directory moves, and only
   * answers with a path that exists in the tree now.
   * @param {string} p
   * @returns {string | null}
   */
  findRenamed(p) {
    const n = normalizeRepoPath(p);
    if (!n) return null;
    const moved = this._memo('renameMap', () => {
      /** @type {Map<string, string>} */
      const map = new Map();
      for (const { from, to } of this.renames()) {
        for (const [k, v] of map) if (v === from) map.set(k, to);
        map.set(from, to);
      }
      return map;
    });
    const direct = moved.get(n);
    if (direct && this.hasPath(direct)) return direct;

    // Directory move: every file that used to live under `n` now lives under one new prefix.
    const prefix = `${n}/`;
    const targets = new Set();
    for (const [from, to] of moved) {
      if (!from.startsWith(prefix)) continue;
      const tail = from.slice(prefix.length);
      if (!to.endsWith(`/${tail}`)) {
        targets.clear();
        break;
      }
      targets.add(to.slice(0, to.length - tail.length - 1));
    }
    if (targets.size === 1) {
      const [dir] = targets;
      if (this.hasPath(dir)) return dir;
    }
    return null;
  }

  /**
   * @param {string} rel
   * @returns {any | null}
   */
  _readJson(rel) {
    const text = this._readText(rel);
    if (text === null) return null;
    try {
      const data = JSON.parse(text);
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} rel
   * @returns {string | null}
   */
  _readText(rel) {
    try {
      return readFileSync(join(this.root, rel), 'utf8');
    } catch {
      return null;
    }
  }
}

/** @param {string} abs */
function isDirOnDisk(abs) {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} [root]
 * @param {RepoContextOptions} [options]
 * @returns {RepoContext}
 */
export function createRepoContext(root, options) {
  return new RepoContext(root, options);
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function stringRecord(value) {
  /** @type {Record<string, string>} */
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}
