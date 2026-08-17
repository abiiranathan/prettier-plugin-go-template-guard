# prettier-plugin-go-template-guard

Wraps `prettier-plugin-go-template` and fixes one specific bug in its
output: when a Go template action (`{{ if .X }}...{{ end }}`) inside an
HTML attribute value gets reformatted onto multiple lines, the newlines
and indentation become part of the literal attribute value at render
time. This breaks a lot of code assumptions causing bugs.

**Before** (what `prettier-plugin-go-template` alone produces):

```html
<input
  value="{{ if .Attr }}
    {{ .Attr }}
  {{ end }}
  "
/>
```

This renders as `value="\n    \n    123\n    \n    "` instead of
`value="123"`.

**After** (this plugin):

```html
<input value="{{ if .Attr }}{{ .Attr }}{{ end }}" />
```

Attribute values with real text next to a template action keep their
meaningful spacing (e.g. Tailwind class boundaries, `"Total: 123
items"` wording) — only pure indentation/formatting whitespace is
collapsed. See [`src/fixer.js`](./src/fixer.js) for the exact rules.

## Why this exists

`prettier-plugin-go-template` formats `.html` files containing Go
`text/template`/`html/template` syntax. Like any HTML formatter, it's
free to wrap long attribute values onto multiple lines for
readability. That's harmless for element content, but Go's template
engine renders attribute values *verbatim* — so a value that looks
nicely indented in your editor renders with literal newlines and
spaces baked into the DOM at runtime. This plugin patches that one gap
without needing a fork or a patched copy of the upstream plugin.

## How it works

This is a thin wrapper, not a fork. It registers a new parser,
`go-template-guard`, whose `parse` step runs the *entire* file through
a normal, nested `prettier.format()` call using the real
`prettier-plugin-go-template` parser/printer (plus any other plugins
you've configured — Tailwind class sorting, `prettier-plugin-classnames`,
etc. — all forwarded through automatically), and then runs the
attribute-value fixer once over that fully-formatted result.

When nothing in a file is affected by the bug, output is byte-identical
to formatting with plain `prettier-plugin-go-template` — this plugin
never changes anything beyond the specific pattern it targets.

## Install

```bash
npm install --save-dev prettier-plugin-go-template-guard
```

`prettier` and `prettier-plugin-go-template` are peer dependencies, not
bundled — your project's existing versions are used.

## Configure

In your `.prettierrc.json`, swap the `parser` value from `go-template`
to `go-template-guard` in your `*.html` override, and add this plugin
to the `plugins` array (its position relative to your other plugins
doesn't matter — it's not itself a formatter, just a coordination
layer):

```json
{
  "tabWidth": 2,
  "useTabs": false,
  "printWidth": 100,
  "plugins": [
    "prettier-plugin-go-template-guard",
    "prettier-plugin-go-template",
    "prettier-plugin-tailwindcss",
    "prettier-plugin-classnames"
  ],
  "overrides": [
    {
      "files": ["*.html"],
      "options": {
        "parser": "go-template-guard",
        "goTemplateBracketSpacing": true,
        "bracketSameLine": true
      }
    },
    {
      "files": ["*.js", "*.ts"],
      "options": {
        "useTabs": true,
        "printWidth": 100,
        "singleQuote": true
      }
    }
  ]
}
```

`goTemplateBracketSpacing` and other `prettier-plugin-go-template`
options are still respected — they're read by the real plugin during
the nested inner format call, since this wrapper forwards `options`
straight through.

## Development

```bash
npm install
npm test
```

Tests are under `test/`:

- `fixer.test.js` covers the text-collapse logic in isolation (regex
  matching, whitespace collapsing, idempotency).
- `integration.test.js` runs the actual Prettier plugin end-to-end,
  including a regression test for a bug caught during development
  where the nested format call originally dropped the caller's other
  configured plugins.

## Limitations

- The fixer is a plain-text/regex pass over already-formatted output,
  not an HTML/AST parser — deliberately, since an AST parser would
  normalize whitespace on parse and hide the exact bug being fixed.
  This is fine for the attribute-value pattern it targets, but it
  means it doesn't understand HTML structure beyond attribute
  boundaries.
- Adds one extra full nested `prettier.format()` call per file
  compared to using `prettier-plugin-go-template` directly. This is a
  deliberate correctness/performance tradeoff — see the comment in
  [`index.js`](./index.js) for why.
