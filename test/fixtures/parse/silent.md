# Things that must produce no claims

Visit [docs](https://example.com/a/b.md), [anchor](#top) and <https://x.dev/y>.
Globs like `src/**/*.ts` and `docs/*.md` are skipped.
Placeholders: `path/to/<name>.md`, `$HOME/x.js`, `npm run <script>`, `${DIR}/a.json`.
Product names: `Node.js`, `Next.js`. Prose: `and/or`, `CI/CD`. Slash command: `/init`.
Package names: `@types/node`, `@scope/pkg`. Versions: `node 20`, `python 3.12`.
Bare mentions: `npm`, `yarn`, `node`.

> Example in a quote: `npm run nope` and `ghost/file.md`.

```text
npm run in-text-fence
```

```json
{ "run": "npm run in-json" }
```

<!-- amc-ignore -->
```bash
npm run ignored-fence
```

<!-- amc-ignore-next-line -->
Run `npm run ignored-line` here.

<!-- amc-ignore -->
Run `npm run ignored-block-1`
and `npm run ignored-block-2`.

Inline ignore: `npm run ignored-inline` <!-- amc-ignore -->

<!--
`npm run in-html-comment`
-->
