#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_LINES, DOCS_URL, HELP, parseCli, UsageError } from './args.js';
import { loadConfig } from './config.js';
import { discover, resolveTargets } from './discover.js';
import { INIT_TEMPLATE } from './init-template.js';
import { exitCodeFor, lint } from './lint.js';
import { formatAgent, formatGithub, formatJson, formatPretty, formatSarif } from './report/index.js';
import { visible } from './report/sanitize.js';
import { createRepoContext } from './repo/index.js';
import { findRule } from './rules/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * @typedef {object} CliIo
 * @property {{ write(s: string): unknown }} stdout
 * @property {{ write(s: string): unknown }} stderr
 * @property {string} cwd
 * @property {Record<string, string | undefined>} env
 * @property {boolean} [isTTY]  Is stdout a terminal? Controls color in the pretty format.
 */

/**
 * Run the CLI. Never calls `process.exit`; returns the exit code.
 * @param {string[]} argv  Arguments after the program name.
 * @param {CliIo} io
 * @returns {0 | 1 | 2}
 */
export function run(argv, io) {
  try {
    return runInner(argv, io);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    if (err instanceof UsageError) {
      // Messages can quote the checked repo (a config key, a file name), so show control characters instead of printing them.
      io.stderr.write(`agent-md-caregiver: ${visible(err.message, { keepLineBreaks: true })}\nTry --help for usage.\n`);
    } else {
      io.stderr.write(`agent-md-caregiver: internal error: ${visible(err.stack ?? err.message, { keepLineBreaks: true })}\n`);
    }
    return 2;
  }
}

/**
 * @param {string[]} argv
 * @param {CliIo} io
 * @returns {0 | 1 | 2}
 */
function runInner(argv, io) {
  const opts = parseCli(argv);

  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (opts.docs) {
    io.stdout.write(`${DOCS_URL}\n`);
    return 0;
  }
  if (opts.version) {
    io.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (opts.explain !== undefined) {
    const rule = findRule(opts.explain);
    if (!rule) throw new UsageError(`unknown rule "${opts.explain}"`);
    io.stdout.write(`${rule.explain}\n`);
    return 0;
  }

  const root = resolve(io.cwd, opts.root ?? '.');
  if (!existsSync(root)) throw new UsageError(`--root: no such directory: ${root}`);

  if (opts.init) {
    if (!opts.write) {
      io.stdout.write(INIT_TEMPLATE);
      return 0;
    }
    const target = join(root, 'AGENTS.md');
    if (existsSync(target)) throw new UsageError('AGENTS.md already exists; refusing to overwrite it');
    writeFileSync(target, INIT_TEMPLATE, { flag: 'wx' });
    io.stdout.write(`Created ${target}\n`);
    return 0;
  }

  const repo = createRepoContext(root);
  const files = opts.paths.length ? resolveTargets(repo, opts.paths, io.cwd) : discover(repo);
  const config = loadConfig(root);
  const result = lint(repo, files, {
    maxLines: opts.maxLines ?? config.maxLines ?? DEFAULT_MAX_LINES,
    ruleLevels: { ...config.rules, ...opts.ruleLevels },
  });

  if (opts.format === 'json') {
    io.stdout.write(formatJson(result, { version: pkg.version }));
  } else if (opts.format === 'sarif') {
    io.stdout.write(formatSarif(result, { version: pkg.version }));
  } else if (opts.format === 'agent') {
    io.stdout.write(formatAgent(result, repo, { version: pkg.version }));
  } else if (opts.format === 'github') {
    io.stdout.write(formatGithub(result));
  } else {
    const color = Boolean(io.isTTY) && !opts.noColor && !('NO_COLOR' in io.env);
    io.stdout.write(formatPretty(result, { color }));
  }
  return exitCodeFor(result.findings, opts.strict || Boolean(config.strict));
}

/** Entry point shared by `node src/cli.js` and the `bin` script. */
export function main() {
  process.exitCode = run(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    isTTY: process.stdout.isTTY,
  });
}

// Run when executed directly (`node src/cli.js`), not when imported.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
