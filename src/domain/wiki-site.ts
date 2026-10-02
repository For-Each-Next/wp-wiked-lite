/**
 * @file src/domain/wiki-site.ts
 * Purpose: Site syntax required to highlight and safely transform wikitext.
 *
 * Table of contents:
 * 1. Imports
 * 2. WikiNamespaceState
 */

import type { NamespaceSource } from "./wiki-titles.ts";
import type { ImageOptionCatalog } from "./highlighter.ts";
import type { TemplateMagicWordCatalog } from "./magic-words.ts";

export interface WikiNamespaceState {
    /** Whether redirect rewrites preserve embed semantics. */
    redirectsSafe: boolean;
    source: NamespaceSource;
    /** Site syntax used to classify template-like constructs. */
    templateMagicWords: TemplateMagicWordCatalog | null;
    /** Localized file-link option names from magic-word siteinfo. */
    imageOptions: ImageOptionCatalog | null;
    /** Whether template redirects are safe to rewrite. */
    templateRedirectsSafe: boolean;
}
