import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { gitFiles, gitRenames, isGitRepo } from './git.js';
import { parseMakeTargets } from './makefile.js';
import {
  LOCKFILES,
  matchWorkspaceDirs,
  parsePackageManager,
  workspacePatterns,
} from './package.js';
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
