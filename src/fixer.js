"use strict";

/**
 * fixer.js
 *
 * Operates on already-formatted HTML/Go-template text (i.e. the output
 * of prettier-plugin-go-template) and fixes the one specific pattern
 * that plugin's formatter introduces: a Go template action ({{ ... }})
 * inside an HTML attribute value, reformatted onto multiple lines,
 * which renders as literal whitespace in the final attribute value.
 *
 * This is a plain-text, regex-based fixer, deliberately NOT an HTML/AST
 * parser, matching the approach (and reasoning) of the original Python
 * scanner: an AST-based HTML parser normalizes whitespace on parse,
 * which would hide the exact bug being fixed, and Go's html/template
 * doesn't build a browser-style DOM either.
 */

// Matches: whitespace-name="...content..."  or  name='...content...'
// Attribute name allows letters, digits, -, _, :, @, . to also catch
// Alpine/Vue/HTMX-style attributes (@click, x-bind:class, hx-target,
// v-model.lazy), since the bug isn't attribute-specific.
//
// The value group alternates between "a whole {{ }} action" and "any
// other single character that isn't the closing quote". The action
// alternative MUST come first and MUST be tried as a whole unit before
// falling back to the single-char alternative -- otherwise a quote
// character *inside* an action (e.g. {{ eq .X "daily" }} in an
// attribute delimited by ") gets matched by the single-char branch one
// character at a time and is indistinguishable from the real closing
// quote, truncating the match early. Matching the action atomically
// first means its internal quotes are consumed as part of that action
// token and never considered as candidates for the closing delimiter.
const ATTR_RE =
  /(?<name>[a-zA-Z_:@][-a-zA-Z0-9_:.@]*)\s*=\s*(?<quote>["'])(?<value>(?:\{\{-?.*?-?\}\}|\\.|(?!\k<quote>).)*)\k<quote>/gs;

// A Go template action: {{ ... }}, including trim markers {{- ... -}}.
// Non-greedy so back-to-back actions in one attribute don't over-match.
const ACTION_RE = /\{\{-?.*?-?\}\}/gs;

/**
 * Returns true if the attribute value contains a template action
 * surrounded by, or separated by, whitespace that includes a newline
 * falling OUTSIDE {{ }} action delimiters (i.e. in the literal HTML
 * text Go emits verbatim). A newline INSIDE an action's own delimiters
 * (e.g. `{{\n  if .X\n}}`) is harmless Go template syntax and does not
 * trigger this check.
 *
 * @param {string} value - The raw attribute value text.
 * @returns {boolean}
 */
function containsMultilineActionWhitespace(value) {
  if (!value.includes("{{")) return false;
  if (!value.includes("\n")) return false;

  let pos = 0;
  const re = new RegExp(ACTION_RE.source, "gs");
  let m;
  while ((m = re.exec(value)) !== null) {
    const literalSpan = value.slice(pos, m.index);
    if (literalSpan.includes("\n")) return true;
    pos = m.index + m[0].length;
  }
  const trailingLiteral = value.slice(pos);
  if (trailingLiteral.includes("\n")) return true;

  return false;
}

/**
 * Collapses a run of literal (non-action) text from an attribute value
 * down to one line, preserving meaning:
 *
 *   - A literal span that is PURE whitespace (only spaces/newlines/
 *     tabs -- e.g. the indentation between {{ if }} and {{ .X }}) is
 *     removed entirely, since it exists only for source readability.
 *   - A literal span containing real text touching whitespace on
 *     either side (e.g. "Total:\n  " before an action, "px-2\n  "
 *     before a class name) has its whitespace runs collapsed to a
 *     single space each, preserving a leading/trailing space if one
 *     was present in the source, since that spacing is very likely
 *     load-bearing (Tailwind class separators, "Total: 123" wording).
 *
 * @param {string} literal
 * @returns {string}
 */
function collapseLiteralSpan(literal) {
  if (literal.trim() === "") {
    return "";
  }

  const leadingWs = literal.slice(0, literal.length - literal.trimStart().length);
  const trailingWs = literal.slice(literal.trimEnd().length);
  let core = literal.trim();
  core = core.replace(/\s+/g, " ");

  let result = core;
  if (leadingWs) result = " " + result;
  if (trailingWs) result = result + " ";
  return result;
}

/**
 * Rewrites a malformed attribute value into a single-line equivalent.
 * Whitespace INSIDE an action's own text is left untouched (harmless
 * Go template syntax). Whitespace OUTSIDE actions is collapsed per
 * collapseLiteralSpan: pure indentation is dropped, whitespace
 * adjacent to real text is preserved as a single space.
 *
 * @param {string} value
 * @returns {string}
 */
function collapseValue(value) {
  const literals = [];
  const actions = [];
  let pos = 0;

  const re = new RegExp(ACTION_RE.source, "gs");
  let m;
  while ((m = re.exec(value)) !== null) {
    literals.push(value.slice(pos, m.index));
    actions.push(m[0]);
    pos = m.index + m[0].length;
  }
  literals.push(value.slice(pos)); // trailing literal, possibly empty

  const outParts = [];
  for (let i = 0; i < literals.length; i++) {
    const collapsed = collapseLiteralSpan(literals[i]);
    if (collapsed) outParts.push(collapsed);
    if (i < actions.length) outParts.push(actions[i]);
  }

  return outParts.join("").trim();
}

/**
 * Scans `text` for attribute values matching the malformed pattern and
 * returns a new string with every match collapsed via collapseValue.
 * Safe to call on text with zero matches (returns it unchanged).
 *
 * This is the single entry point used by the Prettier printer wrapper.
 * Uses the regex `d` (hasIndices) flag to get exact start/end offsets
 * for the named `value` capture group, rather than reconstructing them
 * by hand -- reconstructing offsets from quote positions is fragile
 * against escaped quotes and was dropped in favor of this.
 *
 * @param {string} text - Formatted HTML/Go-template source.
 * @returns {string}
 */
function fixText(text) {
  const re = new RegExp(ATTR_RE.source, "gsd");
  let result = "";
  let lastEnd = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const { value } = m.groups;
    const [valueStart, valueEnd] = m.indices.groups.value;

    if (containsMultilineActionWhitespace(value)) {
      result += text.slice(lastEnd, valueStart);
      result += collapseValue(value);
      lastEnd = valueEnd;
    }
  }
  result += text.slice(lastEnd);

  return result;
}

module.exports = {
  containsMultilineActionWhitespace,
  collapseLiteralSpan,
  collapseValue,
  fixText,
  ATTR_RE,
  ACTION_RE,
};
