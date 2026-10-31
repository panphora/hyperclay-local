/**
 * merge-tags.js — extra mergeable script-tag recognizers for hyper-morph.
 *
 * hyper-morph's built-in recognizer handles `merge="<name>"` tags with
 * relaxed JSON. This adds the Hyperclay rules-tag family (hypercms and
 * hyper-html-api): `script[data-rules-name][data-rules-version]`, whose
 * bodies use the rules dialect (unquoted selector barewords become strings).
 * Identity is the version plus the sorted name-token list, so token order
 * never matters and differing schema versions never pair. Parsing goes
 * through hyper-morph's parseRulesRelaxed, the canonical port of the
 * engine's parseRelaxed, so the tags merge exactly as they load.
 *
 * Pass as `scripts: { mergeTags: mergeTagRecognizers }` on morph configs.
 */

import { HyperMorph } from "../vendor/hyper-morph.vendor.js";

export const mergeTagRecognizers = [
  {
    match: (el) => el.hasAttribute("data-rules-name"),
    identity: (el) => {
      const names = (el.getAttribute("data-rules-name") || "")
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(" ");
      if (!names) return null;
      return (
        "rules:" + (el.getAttribute("data-rules-version") || "") + ":" + names
      );
    },
    parse: HyperMorph.parseRulesRelaxed,
  },
];

export default mergeTagRecognizers;
