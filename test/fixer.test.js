"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  fixText,
  containsMultilineActionWhitespace,
  collapseValue,
} = require("../src/fixer");

test("your original bug: if/action/end split across lines in value attr", () => {
  const input = `<input
    type="number"
    name="para"
    id="para"
    value="{{ if .ancVisit.Para }}
      {{ .ancVisit.Para }}
    {{ end }}
    "
    class="w-full rounded-md" />`;

  const output = fixText(input);
  assert.match(
    output,
    /value="\{\{ if \.ancVisit\.Para \}\}\{\{ \.ancVisit\.Para \}\}\{\{ end \}\}"/
  );
  // Untouched siblings must survive exactly.
  assert.match(output, /class="w-full rounded-md"/);
});

test("single-line value is left untouched", () => {
  const input = `<input value="{{ .ancVisit.Para }}" />`;
  assert.equal(fixText(input), input);
});

test("multiline block OUTSIDE any attribute is left untouched", () => {
  const input = `{{ if .ShowSection }}
  <div class="foo">
    <p>Some content</p>
  </div>
{{ end }}`;
  assert.equal(fixText(input), input);
});

test("value already using trim markers is left untouched", () => {
  const input = `<input value="{{- if .X }}{{ .X }}{{- end -}}" />`;
  assert.equal(fixText(input), input);
});

test("mixed literal text + newline preserves meaningful spacing on fix", () => {
  const input = `<div data-count="Total:
  {{ .Count }}
  items"></div>`;
  const output = fixText(input);
  assert.match(output, /data-count="Total: \{\{ \.Count \}\} items"/);
});

test("Tailwind conditional class attribute preserves class-boundary spaces", () => {
  const input = `<div class="px-2
  {{ if .Active }}
    bg-teal-500
  {{ end }}
  "></div>`;
  const output = fixText(input);
  assert.match(
    output,
    /class="px-2 \{\{ if \.Active \}\} bg-teal-500 \{\{ end \}\}"/
  );
});

test("multiple malformed attributes in the same document are all fixed", () => {
  const input = `<input value="{{ if .X }}
  {{ .X }}
{{ end }}" />
<div data-count="Total:
  {{ .Count }}
  items"></div>`;
  const output = fixText(input);
  assert.doesNotMatch(output, /value="\{\{ if \.X \}\}\n/);
  assert.doesNotMatch(output, /data-count="Total:\n/);
  assert.match(output, /value="\{\{ if \.X \}\}\{\{ \.X \}\}\{\{ end \}\}"/);
  assert.match(output, /data-count="Total: \{\{ \.Count \}\} items"/);
});

test("containsMultilineActionWhitespace: newline inside action delimiters is NOT flagged", () => {
  const value = "{{\n  if .X\n}}{{ .X }}{{\n  end\n}}";
  assert.equal(containsMultilineActionWhitespace(value), false);
});

test("collapseValue is idempotent on already-collapsed input", () => {
  const value = "{{ if .X }}{{ .X }}{{ end }}";
  assert.equal(collapseValue(value), value);
});

test("fixText is a no-op on text with no attributes at all", () => {
  const input = "just some {{ .Plain }} template text, no quotes nearby";
  assert.equal(fixText(input), input);
});

test("fixText handles empty string", () => {
  assert.equal(fixText(""), "");
});

test("single quoted attribute values are also handled", () => {
  const input = `<input value='{{ if .X }}
  {{ .X }}
{{ end }}' />`;
  const output = fixText(input);
  assert.match(output, /value='\{\{ if \.X \}\}\{\{ \.X \}\}\{\{ end \}\}'/);
});

test("if/else with a double-quoted Go string literal inside a double-quoted attribute", () => {
  // Regression test: the action's internal "daily" must not be mistaken
  // for the attribute's own closing quote.
  const input = `<div
    class="{{ if and (eq .reportType "daily") (gt .maxDays 14) }}
      grid-cols-1
    {{ else }}
      grid-cols-1 lg:grid-cols-2
    {{ end }} mb-4 grid gap-4 print:grid-cols-1">`;

  const output = fixText(input);
  assert.match(
    output,
    /class="\{\{ if and \(eq \.reportType "daily"\) \(gt \.maxDays 14\) \}\} grid-cols-1 \{\{ else \}\} grid-cols-1 lg:grid-cols-2 \{\{ end \}\} mb-4 grid gap-4 print:grid-cols-1"/
  );
});

test("if/else if/else chain (multiple branches) all collapse correctly", () => {
  const input = `<div class="{{ if eq .Status "draft" }}
  bg-gray-200
{{ else if eq .Status "pending" }}
  bg-yellow-200
{{ else }}
  bg-green-200
{{ end }}"></div>`;

  const output = fixText(input);
  assert.match(
    output,
    /class="\{\{ if eq \.Status "draft" \}\} bg-gray-200 \{\{ else if eq \.Status "pending" \}\} bg-yellow-200 \{\{ else \}\} bg-green-200 \{\{ end \}\}"/
  );
});

test("double-quoted Go string literal inside a single-quoted attribute", () => {
  const input = `<div class='{{ if eq .X "y" }}
  a
{{ end }}'></div>`;
  const output = fixText(input);
  assert.match(output, /class='\{\{ if eq \.X "y" \}\} a \{\{ end \}\}'/);
});

test("single-quoted Go string literal inside a double-quoted attribute", () => {
  const input = `<div class="{{ if eq .X 'y' }}
  a
{{ end }}"></div>`;
  const output = fixText(input);
  assert.match(output, /class="\{\{ if eq \.X 'y' \}\} a \{\{ end \}\}"/);
});

test("Go raw backtick string literal containing double quotes inside double-quoted attribute", () => {
  const input = `<div class="{{ if eq .Mode \`json "quoted"\` }}
    font-mono
  {{ end }}"></div>`;

  const output = fixText(input);
  assert.match(
    output,
    /class="\{\{ if eq \.Mode `json "quoted"` \}\} font-mono \{\{ end \}\}"/
  );
});

test("Go string literal with escaped quotes inside action", () => {
  const input = `<div data-msg="{{ if .HasError }}
    {{ printf "An error occurred: \\"%s\\"" .Error }}
  {{ end }}"></div>`;

  const output = fixText(input);
  assert.match(
    output,
    /data-msg="\{\{ if \.HasError \}\}\{\{ printf "An error occurred: \\"%s\\"" \.Error \}\}\{\{ end \}\}"/
  );
});

test("Go template comment containing quotes inside multiline attribute", () => {
  const input = `<div class="{{/* comment with "unescaped quote" inside */}}
    {{ if .Active }}
      active
    {{ end }}
  "></div>`;

  const output = fixText(input);
  assert.match(
    output,
    /class="\{\{\/\* comment with "unescaped quote" inside \*\/\}\}\{\{ if \.Active \}\} active \{\{ end \}\}"/
  );
});

test("Go action containing delimiter `}}` inside string literal", () => {
  const input = `<div data-template="{{ if .Show }}
    {{ printf "pattern: }}" }}
  {{ end }}"></div>`;

  const output = fixText(input);
  assert.match(
    output,
    /data-template="\{\{ if \.Show \}\}\{\{ printf "pattern: \}\}" \}\}\{\{ end \}\}"/
  );
});

test("Go rune literal containing double quote inside double-quoted attribute", () => {
  const input = `<div class="{{ if eq .Char '"' }}
    has-double-quote
  {{ end }}"></div>`;

  const output = fixText(input);
  assert.match(
    output,
    /class="\{\{ if eq \.Char '"' \}\} has-double-quote \{\{ end \}\}"/
  );
});

test("attribute with escaped quote (`\\\"`) does not prematurely terminate match", () => {
  const input = `<input
    placeholder="Search \\"quotes\\" here
    {{ if .Query }}
      for: {{ .Query }}
    {{ end }}"
  />`;

  const output = fixText(input);
  assert.match(
    output,
    /placeholder="Search \\"quotes\\" here \{\{ if \.Query \}\} for: \{\{ \.Query \}\}\{\{ end \}\}"/
  );
});

test("preceding attribute with internal quotes does not desynchronize subsequent multiline attribute", () => {
  const input = `<button
    x-data='{ "isOpen": false, "label": "test" }'
    @click="isOpen = !isOpen"
    class="{{ if eq .Variant "primary" }}
      bg-blue-500
    {{ else }}
      bg-gray-500
    {{ end }}"
  >Click</button>`;

  const output = fixText(input);
  assert.match(output, /x-data='\{ "isOpen": false, "label": "test" \}'/);
  assert.match(output, /@click="isOpen = !isOpen"/);
  assert.match(
    output,
    /class="\{\{ if eq \.Variant "primary" \}\} bg-blue-500 \{\{ else \}\} bg-gray-500 \{\{ end \}\}"/
  );
});

test("trim markers (`{{-` and `-}}`) containing internal quotes", () => {
  const input = `<span class="{{- if eq .Type "badge" -}}
    inline-flex items-center
  {{- end -}}"></span>`;

  const output = fixText(input);
  assert.match(
    output,
    /class="\{\{- if eq \.Type "badge" -\}\} inline-flex items-center \{\{- end -\}\}"/
  );
});