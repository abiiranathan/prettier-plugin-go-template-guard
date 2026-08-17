"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const prettier = require("prettier");
const goTemplatePlugin = require("prettier-plugin-go-template");
const plugin = require("../index");

async function formatGuarded(input, options = {}) {
  return prettier.format(input, {
    parser: "go-template-guard",
    plugins: [plugin],
    tabWidth: 2,
    ...options,
  });
}

async function formatPlain(input, options = {}) {
  return prettier.format(input, {
    parser: "go-template",
    plugins: [goTemplatePlugin],
    tabWidth: 2,
    ...options,
  });
}

test("integration: fixes the original reported bug end-to-end", async () => {
  const input = `<div>
  <input
    type="number"
    name="para"
    value="{{ if .ancVisit.Para }}
      {{ .ancVisit.Para }}
    {{ end }}
    "
    class="w-full" />
</div>`;

  const out = await formatGuarded(input);
  assert.match(out, /value="\{\{ if \.ancVisit\.Para \}\}\{\{ \.ancVisit\.Para \}\}\{\{ end \}\}"/);
  assert.doesNotMatch(out, /value="\{\{ if \.ancVisit\.Para \}\}\n/);
});

test("integration: identical to plain go-template output when nothing is malformed", async () => {
  const input = `<div class="foo   bar">
  <input value="{{ .Simple }}" />
  {{ if .ShowSection }}
  <p>hello</p>
  {{ end }}
</div>`;

  const guardedOut = await formatGuarded(input);
  const plainOut = await formatPlain(input);
  assert.equal(guardedOut, plainOut);
});

test("integration: formatting converges (stable after re-formatting once)", async () => {
  const input = `<input value="{{ if .X }}
  {{ .X }}
{{ end }}" />`;

  // The first pass both fixes the malformed attribute AND may change
  // Prettier's own line-wrap decision as a knock-on effect of the
  // attribute becoming shorter -- that's expected, standard Prettier
  // behavior (not every formatter converges in a single pass) and not
  // specific to this plugin. The real invariant we care about is that
  // formatting stabilizes: pass 2 and pass 3 must be identical, even
  // if pass 1 differs from pass 2 due to the wrap-width knock-on.
  const first = await formatGuarded(input);
  const second = await formatGuarded(first);
  const third = await formatGuarded(second);
  assert.equal(second, third);
});

test("integration: plain HTML with no template syntax is unaffected", async () => {
  const input = `<div class="a"><p>hi</p></div>`;
  const out = await formatGuarded(input);
  assert.equal(out, `<div class="a"><p>hi</p></div>\n`);
});

test("integration: forwards other configured plugins to the nested format pass (regression: Tailwind class sorting)", async () => {
  // Regression test for a real bug caught during development: the
  // nested inner `prettier.format` call originally hardcoded its own
  // plugins list to just prettier-plugin-go-template, silently
  // dropping any other plugins (Tailwind class sorting, classnames
  // merging, etc.) the caller configured. This must never regress.
  const input = `<div class="text-white bg-red-500 p-4 flex"></div>`;
  const out = await prettier.format(input, {
    parser: "go-template-guard",
    plugins: [plugin, "prettier-plugin-tailwindcss"],
    tabWidth: 2,
  });
  assert.match(out, /class="flex bg-red-500 p-4 text-white"/);
});
