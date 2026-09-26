/** Lazy queries over source text. Each operation invokes one focused scanner. */

import { findWikitextComments } from "./comments.ts";
import { findWikilinkRanges } from "./links.ts";
import { findOpaqueRanges, type WikitextOptions } from "./opaque-ranges.ts";
import { findNamedRefTag, findRefTags } from "./references.ts";
import { findWikitableRanges, parseWikitable } from "./tables.ts";
import { findWikitextTags } from "./tags.ts";
import {
    findTemplateCalls,
    findTopLevelEquals,
    normalizeTemplateName,
    parseTemplateCall,
    splitTopLevel,
    splitTopLevelRanges,
} from "./templates.ts";

function queryWikitext(source: string, options: WikitextOptions = {}) {
    return {
        comment: { getAll: () => findWikitextComments(source) },
        link: { getAll: () => findWikilinkRanges(source, options) },
        opaque: { getAll: () => findOpaqueRanges(source, options) },
        reference: {
            getAll: () => findRefTags(source, options),
            getFirst: (name: string, group?: string) =>
                findNamedRefTag(source, name, group, options),
        },
        table: {
            getAll: () =>
                findWikitableRanges(source, options).map((range) =>
                    parseWikitable(
                        source.slice(range.start, range.end),
                        range.start,
                        options,
                    ),
                ),
        },
        tag: {
            getAll: (name?: string) =>
                findWikitextTags(source, {
                    ...options,
                    ...(name == null ? {} : { tagNames: [name] }),
                }),
        },
        template: {
            getAll: () => findTemplateCalls(source, options),
            parse: () =>
                parseTemplateCall(
                    source.trim(),
                    source.length - source.trimStart().length,
                    options,
                ),
        },
        findTopLevelEquals: () => findTopLevelEquals(source, options),
        split: (separator: string) => splitTopLevel(source, separator, options),
        splitRanges: (separator: string) =>
            splitTopLevelRanges(source, separator, options),
    };
}

export const wikitext = Object.assign(queryWikitext, {
    template: { normalizeName: normalizeTemplateName },
});

export type { SourceRange } from "./opaque-ranges.ts";
export type { ParsedWikitableCaption, ParsedWikitableRow } from "./tables.ts";
export type { WikitextTag } from "./tags.ts";
export type {
    ParsedTemplateCall,
    ParsedTemplateParameter,
    TopLevelRange,
} from "./templates.ts";
