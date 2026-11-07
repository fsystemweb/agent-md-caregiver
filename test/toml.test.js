import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parsePyproject } from '../src/repo/python.js';
import { inlineTableKeys, namesUnder, parseToml, splitDotted } from '../src/repo/toml.js';

describe('toml reader', () => {
  test('tables, keys, comments, multi-line arrays and strings', () => {
    const t = parseToml(
      [
        '# top',
        'name = "x" # trailing',
        '[project]',
        'dependencies = [',
        '  "pytest>=8", # dev',
        '  "a#b",',
        ']',
        'description = """',
        'multi [ line',
        '"""',
        '[[tool.x.items]]',
        'k = 1',
      ].join('\n'),
    );
    assert.equal(t.tables.get('').get('name'), '"x"');
    assert.match(t.tables.get('project').get('dependencies'), /pytest>=8.*a#b/);
    assert.ok(t.tables.has('tool.x.items'));
  });

  test('quoted and dotted names', () => {
    assert.deepEqual(splitDotted('tool."my.tool".x'), ['tool', 'my.tool', 'x']);
    assert.equal(splitDotted('a..b'), null);
    assert.equal([...parseToml('[tool."a.b"]\nx=1').tables.keys()].includes('tool.a.b'), true);
  });

  test('returns null on anything odd instead of guessing', () => {
    assert.equal(parseToml('this is not toml'), null);
    assert.equal(parseToml('a = [1, 2'), null);
    assert.equal(parseToml('[unclosed\nx=1'), null);
    assert.equal(parseToml('s = """never closed'), null);
  });

  test('namesUnder: keys plus sub-tables, null when absent', () => {
    const t = parseToml('[tool.poe.tasks]\ntest = "pytest"\nfmt.cmd = "ruff"\n[tool.poe.tasks.lint]\ncmd = "x"\n');
    assert.deepEqual(namesUnder(t, 'tool.poe.tasks'), ['fmt', 'lint', 'test']);
    assert.equal(namesUnder(t, 'tool.nope'), null);
  });

  test('inlineTableKeys', () => {
    assert.deepEqual(inlineTableKeys('{ a = "x", b = { c = 1, d = 2 }, "e.f" = [1, 2] }'), ['a', 'b', 'e.f']);
    assert.equal(inlineTableKeys('"nope"'), null);
  });
});

describe('pyproject facts', () => {
  test('project, tools, scripts and poe tasks', () => {
    const p = parsePyproject(
      '[project]\nname="a"\nscripts = { inline-one = "a:b" }\n[project.scripts]\nserve = "a:main"\n[tool.uv]\n[tool.poe.tasks]\ntest = "pytest"\n',
    );
    assert.equal(p.project, true);
    assert.deepEqual([...p.tools].sort(), ['poe', 'uv']);
    assert.deepEqual(p.scripts, ['inline-one', 'serve']);
    assert.deepEqual(p.poeTasks, ['test']);
  });

  test('no poe, no project', () => {
    const p = parsePyproject('[tool.black]\nline-length = 100\n');
    assert.equal(p.project, false);
    assert.equal(p.poeTasks, null);
  });

  test('unreadable file', () => {
    assert.equal(parsePyproject('{{{'), null);
  });
});
