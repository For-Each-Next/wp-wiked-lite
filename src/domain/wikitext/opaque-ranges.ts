/**
 * @file src/domain/wikitext/opaque-ranges.ts
 * Purpose: Opaque source ranges used by shared wikitext operations.
 *
 * Table of contents:
 * 1. Imports
 * 2. SourceRange
 * 3. WikitextOptions
 * 4. findOpaqueRanges
 * 5. isOffsetInRanges
 * 6. mergeRanges
 */

import { findWikitextComments } from "./comments.ts";
import { DEFAULT_LITERAL_TAGS, findWikitextTags } from "./tags.ts";

export interface SourceRange {
    end: number;
    start: number;
}

export interface WikitextOptions {
    literalTags?: readonly string[];
}

/**
 * Finds comments and literal tags that are opaque to the parser.
 *
 * @param source - Wikitext to scan.
 * @param options - Literal tags to protect.
 * @returns Non-overlapping opaque ranges in source order.
 */
export function findOpaqueRanges(
    source: string,
    options: WikitextOptions = {},
): SourceRange[] {
    const literalTags = options.literalTags ?? DEFAULT_LITERAL_TAGS;
    const comments = findWikitextComments(source);
    const tags = findWikitextTags(source, {
        literalTags,
        tagNames: literalTags,
    });
    const ranges = [
        ...comments.map(({ end, start }) => ({ end, start })),
        ...tags.map(({ end, start }) => ({ end, start })),
    ].toSorted((left, right) => left.start - right.start);
    return mergeRanges(ranges);
}

/**
 * Returns whether an offset falls within any source range.
 *
 * @param offset - Source offset.
 * @param ranges - Source ranges.
 * @returns Whether the offset is within a range.
 */
export function isOffsetInRanges(
    offset: number,
    ranges: readonly SourceRange[],
): boolean {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
    const merged: SourceRange[] = [];
    for (const range of ranges) {
        const previous = merged.at(-1);
        if (previous == null || range.start >= previous.end) {
            merged.push({ ...range });
        } else {
            previous.end = Math.max(previous.end, range.end);
        }
    }
    return merged;
}
