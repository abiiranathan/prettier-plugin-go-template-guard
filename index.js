"use strict";

const prettier = require("prettier");
const goTemplatePlugin = require("prettier-plugin-go-template");
const { fixText } = require("./src/fixer");

const INNER_PARSER_NAME = "go-template";
const GUARD_PARSER_NAME = "go-template-guard";
const GUARD_AST_FORMAT = "go-template-guard";

/**
 * Rather than trying to hook into prettier-plugin-go-template's Doc
 * printing mid-recursion (which depends on internal, undocumented
 * details of Prettier's AST-walking that aren't guaranteed stable
 * across versions -- confirmed by testing that path.stack depth does
 * NOT reliably identify the root print call), this plugin instead
 * runs the ENTIRE inner go-template format as one self-contained
 * nested `prettier.format` call inside our own parser's `parse` step,
 * then runs the attribute fixer once over that complete, final
 * string. Our own printer is then trivial: the "AST" is just the
 * already-fixed string, and printing it is a no-op passthrough.
 *
 * This trades a small amount of overhead (one extra full nested
 * format pass) for correctness that doesn't depend on Prettier's
 * internal recursion structure.
 */
const guardParser = {
  astFormat: GUARD_AST_FORMAT,

  /**
   * @param {string} text - The original, unformatted source text.
   * @param {object} options - Prettier options for this run, including
   *   whatever `plugins` array the caller configured (e.g. Tailwind
   *   class sorting, classnames merging) -- these MUST be forwarded to
   *   the nested inner format call below, or those plugins silently
   *   never run. This was caught by testing against the user's actual
   *   plugin stack rather than assumed to work.
   * @returns {Promise<{fixed: string}>} A trivial AST node holding
   *   the fully formatted-and-fixed text.
   */
  async parse(text, options) {
    // Forward every plugin the caller configured EXCEPT this plugin
    // itself, to avoid recursively re-entering go-template-guard. Every
    // other plugin (prettier-plugin-go-template itself if the caller
    // listed it, prettier-plugin-tailwindcss, prettier-plugin-
    // classnames, etc.) is preserved so those still run on this
    // nested pass exactly as they would on a normal format call.
    const forwardedPlugins = (options.plugins || []).filter(
      (p) => p !== module.exports && p !== "prettier-plugin-go-template-guard"
    );
    if (!forwardedPlugins.includes(goTemplatePlugin)) {
      forwardedPlugins.push(goTemplatePlugin);
    }

    const formatted = await prettier.format(text, {
      ...options,
      parser: INNER_PARSER_NAME,
      plugins: forwardedPlugins,
    });
    return { fixed: fixText(formatted) };
  },

  locStart() {
    return 0;
  },
  locEnd(node) {
    return node.fixed.length;
  },
};

/**
 * Trivial printer: the "AST" produced by guardParser.parse is already
 * the final, fixed text, so printing it is just returning that string.
 */
const guardPrinter = {
  print(path) {
    return path.node.fixed;
  },
};

module.exports = {
  languages: [
    {
      name: "go-template-guard",
      parsers: [GUARD_PARSER_NAME],
      // Intentionally NOT declaring extensions/filenames here so this
      // plugin never auto-attaches to files by itself -- it is only
      // ever selected explicitly via `"parser": "go-template-guard"`
      // in an override, keeping it opt-in and unambiguous alongside
      // the original plugin.
    },
  ],
  parsers: {
    [GUARD_PARSER_NAME]: guardParser,
  },
  printers: {
    [GUARD_AST_FORMAT]: guardPrinter,
  },
};
