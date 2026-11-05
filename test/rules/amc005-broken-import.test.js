import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { hasGit } from '../helpers/make-repo.js';
import { check } from '../helpers/lint-repo.js';

const TREE = { 'docs/guide.md': '', 'docs/my file.md': '', 'README.md': '', 'AGENTS.md': '' };
const run = (md, extra = {}, opts) => check('AMC005', { ...TREE, ...extra, 'CLAUDE.md': md }, { target: 'CLAUDE.md', ...opts });

describe('AMC005 fires', () => {
  test('missing @import: message, position, evidence', () => {
    const [f] = run('@AGENTS.md\n\n@docs/guid.md\n');
    assert.equal(f.ruleId, 'AMC005');
    assert.equal(f.severity, 'error');
    assert.equal(f.line, 3);
    assert.equal(f.col, 2);
    assert.equal(f.evidence, '@docs/guid.md');
    assert.equal(f.message, 'Import `docs/guid.md` does not exist');
    assert.equal(f.suggestion, 'Did you mean `docs/guide.md`?');
  });

  test('missing relative link and image', () => {
    const out = run('@AGENTS.md\nSee [setup](docs/setup.md) and ![x](img/logo.png).\n');
    assert.deepEqual(
      out.map((f) => [f.line, f.col, f.message]),
      [
        [2, 13, 'Link target `docs/setup.md` does not exist'],
        [2, 37, 'Link target `img/logo.png` does not exist'],
      ],
    );
  });

  test('no close match: generic advice', () => {
    assert.equal(run('@AGENTS.md\n@docs/missing.md')[0].suggestion, 'Fix the path or remove the import.');
    assert.equal(run('@AGENTS.md\n[x](nowhere/else.md)')[0].suggestion, 'Fix the link or remove it.');
  });

  test('inline-code @import counts as an import', () => {
    assert.equal(run('@AGENTS.md\nAlso `@docs/gone.md`.').length, 1);
  });

  test('CLAUDE.md that does not import the AGENTS.md next to it', () => {
    const [f] = run('# Claude notes\n\nUse tabs.\n', { 'AGENTS.md': '# Rules\n' });
    assert.equal(f.message, 'CLAUDE.md does not import AGENTS.md, so Claude Code never sees it');
    assert.equal(f.line, 1);
    assert.equal(f.col, 1);
    assert.equal(f.evidence, '# Claude notes');
    assert.equal(f.suggestion, 'Start CLAUDE.md with `@AGENTS.md` and keep only Claude-specific notes below it.');
  });

  test('also when CLAUDE.md is empty', () => {
    assert.equal(run('', { 'AGENTS.md': '# Rules\n' }).length, 1);
  });

  test('nested CLAUDE.md next to a nested AGENTS.md', () => {
    const files = { 'packages/a/AGENTS.md': '# a\n', 'packages/a/CLAUDE.md': 'own notes\n' };
    const out = check('AMC005', { ...TREE, ...files }, { target: 'packages/a/CLAUDE.md' });
    assert.deepEqual(out.map((f) => f.message), ['CLAUDE.md does not import packages/a/AGENTS.md, so Claude Code never sees it']);
  });

  test('importing a different file does not count', () => {
    assert.equal(run('@README.md\n', { 'AGENTS.md': '# Rules\n' }).length, 1);
  });

  test('an import in the root CLAUDE.md of a nested AGENTS.md is a different file', () => {
    assert.equal(run('@packages/a/AGENTS.md\n', { 'AGENTS.md': '# Rules\n', 'packages/a/AGENTS.md': '' }).length, 1);
  });
});

describe('AMC005 uses git history', { skip: !hasGit && 'git not installed' }, () => {
  test('a renamed import target is reported as a rename', () => {
    const out = check('AMC005', { ...TREE, 'docs/rules.md': 'rules '.repeat(50), 'CLAUDE.md': '@AGENTS.md\n@docs/rules.md\n' }, {
      target: 'CLAUDE.md',
      git: true,
      setup: (r) => {
        r.mv('docs/rules.md', 'docs/conventions.md');
        r.commit('rename');
      },
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].suggestion, 'Renamed to `docs/conventions.md` in git history. Update the import.');
  });
});

describe('AMC005 stays silent', () => {
  const silent = (md, extra, opts) => assert.deepEqual(run(md, extra, opts), [], md);

  test('imports and links that resolve', () => {
    silent('@AGENTS.md\n@docs/guide.md\n[g](docs/guide.md) [r](./README.md#top) ![i](README.md) [s](docs/my%20file.md) [d](docs/) [root](/README.md)');
  });

  test('URLs, anchors, mailto, protocol-relative', () => {
    silent('@AGENTS.md\n[a](https://x.dev/a.md) [b](#top) [c](mailto:a@b.co) [d](//cdn.x/a.js) <https://x.dev>');
  });

  test('a link target that .gitignore covers', () => {
    silent('@AGENTS.md\n[report](dist/report.html)', { '.gitignore': 'dist/\n' });
  });

  test('targets outside the repo cannot be checked', () => {
    silent('@AGENTS.md\n[x](../../shared/notes.md)');
  });

  test('placeholders, globs, non-shell contexts, ignore markers', () => {
    silent('@AGENTS.md\n[x](docs/<name>.md) [y](docs/*.md)');
    silent('@AGENTS.md\n> [x](docs/nope.md)');
    silent('@AGENTS.md\n<!-- amc-ignore-next-line -->\n[x](docs/nope.md)');
  });

  test('CLAUDE.md with no AGENTS.md next to it', () => {
    const out = check('AMC005', { 'CLAUDE.md': 'own notes\n' }, { target: 'CLAUDE.md' });
    assert.deepEqual(out, []);
  });

  test('CLAUDE.md that is an identical copy of AGENTS.md', () => {
    silent('# Rules\n', { 'AGENTS.md': '# Rules\n' });
  });

  test('CLAUDE.md that is a symlink to AGENTS.md', () => {
    const out = check('AMC005', { 'AGENTS.md': '# Rules\n' }, {
      target: 'CLAUDE.md',
      setup: (r) => symlinkSync('AGENTS.md', join(r.root, 'CLAUDE.md')),
    });
    assert.deepEqual(out, []);
  });

  test('AGENTS.md and other files are not subject to the CLAUDE.md check', () => {
    assert.deepEqual(check('AMC005', { 'AGENTS.md': 'own\n', 'CLAUDE.md': 'x' }, { target: 'AGENTS.md' }), []);
  });
});
