import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DOCS_URL, HELP } from '../src/args.js';
import { run } from '../src/cli.js';
import { RULES } from '../src/rules/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = join(ROOT, 'docs');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** All Markdown pages of the site. */
function pages(dir = DOCS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  );
}

describe('docs site', () => {
  test('every rule has a page that contains its --explain text verbatim', () => {
    for (const rule of RULES) {
      const file = join(DOCS, 'rules', `${rule.id}.md`);
      assert.ok(existsSync(file), `docs/rules/${rule.id}.md is missing`);
      const page = readFileSync(file, 'utf8');
      assert.ok(page.includes(rule.explain), `${rule.id}: page is out of sync with --explain; regenerate it`);
      assert.match(page, new RegExp(`^title: ${rule.id} ${rule.name}$`, 'm'));
    }
    const index = readFileSync(join(DOCS, 'rules', 'index.md'), 'utf8');
    for (const rule of RULES) assert.ok(index.includes(`[${rule.id}](${rule.id}.md)`), `${rule.id} missing from the rules index`);
  });

  test('the CLI reference mentions every flag in --help', () => {
    const cli = readFileSync(join(DOCS, 'cli.md'), 'utf8');
    const flags = new Set([...HELP.split('Rules:')[0].matchAll(/(?:^|\s)(--[a-z][a-z-]*)/gm)].map((m) => m[1]));
    assert.ok(flags.size >= 10);
    for (const flag of flags) assert.ok(cli.includes(`\`${flag}`), `docs/cli.md does not document ${flag}`);
    for (const fmt of ['pretty', 'json', 'github', 'sarif', 'agent']) assert.ok(cli.includes(`\`${fmt}\``), fmt);
  });

  test('every page has front matter with a title (Jekyll skips pages without it)', () => {
    for (const file of pages()) {
      if (file.endsWith('docs/README.md')) continue;
      assert.match(readFileSync(file, 'utf8'), /^---\ntitle: .+\n/, file);
    }
  });

  test('relative links in the docs and the README resolve', () => {
    const files = [...pages(), join(ROOT, 'README.md')];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
      for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
        const path = resolve(dirname(file), target.split('#')[0]);
        assert.ok(existsSync(path), `${file.replace(ROOT, '')}: broken link ${target}`);
      }
    }
  });

  test('the site is configured and linked from the package and the README', () => {
    assert.ok(existsSync(join(DOCS, '_config.yml')));
    assert.equal(PKG.homepage, DOCS_URL);
    assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes(DOCS_URL));
  });
});

describe('--docs and --help point to the site', () => {
  /** @param {string[]} argv */
  const cli = (argv) => {
    let out = '';
    const code = run(argv, { stdout: { write: (s) => (out += s) }, stderr: { write() {} }, cwd: ROOT, env: {} });
    return { code, out };
  };

  test('--docs prints the URL and exits 0', () => {
    assert.deepEqual(cli(['--docs']), { code: 0, out: `${DOCS_URL}\n` });
  });

  test('--help ends with the docs URL', () => {
    assert.ok(cli(['--help']).out.trimEnd().endsWith(DOCS_URL));
  });
});
