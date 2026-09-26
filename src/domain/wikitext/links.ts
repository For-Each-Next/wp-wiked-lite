/** Balanced internal-link syntax for shared wikitext operations. */

import {
    findOpaqueRanges,
    type SourceRange,
    type WikitextOptions,
} from "./opaque-ranges.ts";

export interface WikilinkRange extends SourceRange {
    depth: number;
}

/**
 * Finds balanced internal links, including nested link-like syntax.
 *
 * @param source - Wikitext to scan.
 * @param options - Literal tags to protect.
 * @returns Balanced internal-link ranges in source order.
 */
export function findWikilinkRanges(
    source: string,
    options: WikitextOptions = {},
): WikilinkRange[] {
    const opaque = findOpaqueRanges(source, options);
    const stack: Array<{ depth: number; start: number }> = [];
    const ranges: WikilinkRange[] = [];
    let opaqueIndex = 0;
    let index = 0;

    while (index < source.length - 1) {
        while (opaque[opaqueIndex]?.end <= index) {
            opaqueIndex += 1;
        }
        const hidden = opaque[opaqueIndex];
        if (hidden != null && index >= hidden.start) {
            index = hidden.end;
            continue;
        }
        if (source.startsWith("[[", index)) {
            stack.push({ depth: stack.length, start: index });
            index += 2;
            continue;
        }
        if (source.startsWith("]]", index) && stack.length > 0) {
            const opening = stack.pop();
            if (opening != null) {
                ranges.push({ ...opening, end: index + 2 });
            }
            index += 2;
            continue;
        }
        index += 1;
    }
    return ranges.toSorted(
        (left, right) => left.start - right.start || right.end - left.end,
    );
}
