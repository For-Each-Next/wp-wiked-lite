/** Resolves overlapping highlights into lossless source segments. */

import type { SourceRange } from "./wikitext/index.ts";

export interface PagePreviewTarget {
    /** "local" or a lowercase two-letter Wikipedia language code. */
    wiki: string;
    title: string;
}

export interface HighlightSegment {
    classNames: string[];
    end: number;
    entity?: string;
    href?: string;
    missingTitle?: string;
    pagePreview?: PagePreviewTarget;
    referenceSource?: string;
    start: number;
    text: string;
}

export interface HighlightRange extends SourceRange {
    className: string;
    entity?: string;
    href?: string;
    missingTitle?: string;
    pagePreview?: PagePreviewTarget;
    priority: number;
    referenceSource?: string;
}

const NON_VISIBLE_LINK_TOKEN_CLASSES = new Set([
    "wiked-lite-token--html-tag",
    "wiked-lite-token--module-name",
    "wiked-lite-token--parameter",
    "wiked-lite-token--template-delimiter",
    "wiked-lite-token--template-name",
    "wiked-lite-token--wiki-markup",
]);
const SMALL_REFERENCE_TOKEN_CLASSES = new Set([
    "wiked-lite-token--reference",
    "wiked-lite-token--footnote",
]);

/** Produces ordered source segments from overlapping ranges. */
export function partitionHighlightRanges(
    source: string,
    ranges: HighlightRange[],
): HighlightSegment[] {
    const boundaries = new Set([0, source.length]);
    const starts = new Map<number, HighlightRange[]>();
    const ends = new Map<number, HighlightRange[]>();
    for (const range of ranges) {
        boundaries.add(range.start);
        boundaries.add(range.end);
        addRangeBoundary(starts, range.start, range);
        addRangeBoundary(ends, range.end, range);
    }
    const points = [...boundaries].sort((left, right) => left - right);
    const segments: HighlightSegment[] = [];
    const active = new Set<HighlightRange>();
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        starts.get(start)?.forEach((range) => active.add(range));
        ends.get(start)?.forEach((range) => active.delete(range));
        if (start !== end) {
            segments.push(createSegment(source, start, end, [...active]));
        }
    }
    return segments;
}

function addRangeBoundary(
    boundaries: Map<number, HighlightRange[]>,
    point: number,
    range: HighlightRange,
): void {
    const matches = boundaries.get(point) ?? [];
    matches.push(range);
    boundaries.set(point, matches);
}

function createSegment(
    source: string,
    start: number,
    end: number,
    ranges: HighlightRange[],
): HighlightSegment {
    const active = ranges
        .filter((range) => range.start <= start && range.end >= end)
        .sort((left, right) => right.priority - left.priority);
    const opaque = active.find((range) => range.priority === 100);
    const visible =
        opaque == null
            ? active
            : [...active.filter((range) => range.priority > 100), opaque];
    const classNames = [...new Set(visible.map((range) => range.className))];
    if (
        opaque?.className === "wiked-lite-token--comment" &&
        active.some((range) =>
            SMALL_REFERENCE_TOKEN_CLASSES.has(range.className),
        )
    ) {
        // Comments stay opaque and retain their own palette, while still
        // inheriting the editor's optional small reference/note text size.
        classNames.push("wiked-lite-token--small-reference-comment");
    }
    const pagePreview = visible.find(
        (range) => range.pagePreview != null,
    )?.pagePreview;
    return {
        classNames,
        end,
        entity: visible.find((range) => range.entity != null)?.entity,
        href: visible.find((range) => range.href != null)?.href,
        missingTitle: getVisibleMissingTitle(visible, classNames),
        ...(pagePreview == null ? {} : { pagePreview }),
        referenceSource: visible.find((range) => range.referenceSource != null)
            ?.referenceSource,
        start,
        text: source.slice(start, end),
    };
}

function getVisibleMissingTitle(
    ranges: HighlightRange[],
    classNames: string[],
): string | undefined {
    if (classNames.some((name) => NON_VISIBLE_LINK_TOKEN_CLASSES.has(name))) {
        return undefined;
    }
    return ranges.find((range) => range.missingTitle != null)?.missingTitle;
}
