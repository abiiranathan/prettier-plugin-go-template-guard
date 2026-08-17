"use strict";

/**
 * fixer.js
 *
 * Operates on formatted HTML/Go-template text and collapses Go template
 * actions inside HTML attributes that were reformatted onto multiple lines.
 */

// Matches Go template strings, raw strings, runes, and comments inside actions
const GO_STRINGS_AND_COMMENTS =
  /(?:"(?:\\.|[^"\\])*"|`[^`]*`|'\\?.?'|\/\*[\s\S]*?\*\/|\/\/[^\n]*)/.source;

// A robust Go template action regex that correctly skips internal strings/comments
const ACTION_SOURCE =
  /\{\{-?\s*(?:GO_STR|[\s\S])*?-?\}\}/.source.replace(
    "GO_STR",
    GO_STRINGS_AND_COMMENTS
  );

const ACTION_RE = new RegExp(ACTION_SOURCE, "gs");

// Matches HTML/Alpine/Vue/HTMX attribute name="value" or name='value'
// The value group matches complete {{ ... }} actions atomically, escaped chars,
// or any character except the closing quote delimiter.
const ATTR_RE = new RegExp(
  `(?<name>[a-zA-Z_:@][-a-zA-Z0-9_:.@]*)` +
  `\\s*=\\s*` +
  `(?<quote>["'])` +
  `(?<value>(?:${ACTION_SOURCE}|\\\\.|(?!\\k<quote>)[\\s\\S])*?)` +
  `\\k<quote>`,
  "gs"
);

/**
 * Returns true if the attribute value contains a template action
 * surrounded by, or separated by, whitespace that includes a newline
 * falling OUTSIDE {{ }} action delimiters.
 *
 * @param {string} value - Raw attribute value text.
 * @returns {boolean}
 */
function containsMultilineActionWhitespace(value) {
  if (!value.includes("{{") || !value.includes("\n")) return false;

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
 * Collapses literal (non-action) text runs inside an attribute value.
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
  let core = literal.trim().replace(/\s+/g, " ");

  if (leadingWs) core = " " + core;
  if (trailingWs) core = core + " ";
  return core;
}

/**
 * Rewrites a multiline attribute value into a single-line equivalent.
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
  literals.push(value.slice(pos));

  const outParts = [];
  for (let i = 0; i < literals.length; i++) {
    const collapsed = collapseLiteralSpan(literals[i]);
    if (collapsed) outParts.push(collapsed);
    if (i < actions.length) outParts.push(actions[i]);
  }

  return outParts.join("").trim();
}

/**
 * Scans `text` for attribute values matching the multiline pattern and
 * collapses them.
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
