/** Wikitable range queries and local structure parsing. */

import {
    findOpaqueRanges,
    isOffsetInRanges,
    type SourceRange,
    type WikitextOptions,
} from "./opaque-ranges.ts";
import { parseTagAttributes } from "./tags.ts";
import { findTopLevelEquals, splitTopLevelRanges } from "./templates.ts";

export interface WikitableRange extends SourceRange {
    closed: boolean;
    depth: number;
}

export interface ParsedWikitableCaption extends SourceRange {
    attributes: Record<string, string>;
    content: string;
    contentEnd: number;
    contentStart: number;
    raw: string;
}

interface ParsedWikitableCell extends ParsedWikitableCaption {
    header: boolean;
}

export interface ParsedWikitableRow extends SourceRange {
    attributes: Record<string, string>;
    cells: ParsedWikitableCell[];
    raw: string;
}

export interface ParsedWikitable extends SourceRange {
    attributes: Record<string, string>;
    captions: ParsedWikitableCaption[];
    closed: boolean;
    raw: string;
    rows: ParsedWikitableRow[];
}

interface SourceLine extends SourceRange {
    contentEnd: number;
}

interface TableToken extends SourceRange {
    attributesSource?: string;
    header?: boolean;
    kind: "caption" | "cell" | "row";
    payloadEnd?: number;
    payloadStart?: number;
}

interface RowBuilder {
    attributes: Record<string, string>;
    cells: TableToken[];
    start: number;
}

interface ParsedTablePayload {
    attributes: Record<string, string>;
    contentStart: number;
}

/**
 * Finds balanced or unclosed line-oriented wikitable ranges.
 *
 * @param source - Wikitext to scan.
 * @param options - Literal tags to protect.
 * @returns Wikitable ranges in source order, outer tables first.
 */
export function findWikitableRanges(
    source: string,
    options: WikitextOptions = {},
): WikitableRange[] {
    const opaque = findOpaqueRanges(source, options);
    const stack: Array<{ depth: number; start: number }> = [];
    const ranges: WikitableRange[] = [];
    for (const line of readLines(source)) {
        const marker = skipHorizontalSpace(source, line.start, line.contentEnd);
        if (isOffsetInRanges(marker, opaque)) {
            continue;
        }
        if (source.startsWith("{|", marker)) {
            stack.push({ depth: stack.length, start: marker });
        } else if (source.startsWith("|}", marker) && stack.length > 0) {
            const opening = stack.pop();
            if (opening != null) {
                ranges.push({ ...opening, closed: true, end: line.end });
            }
        }
    }
    for (const opening of stack) {
        ranges.push({ ...opening, closed: false, end: source.length });
    }
    return ranges.toSorted(
        (left, right) => left.start - right.start || right.end - left.end,
    );
}

/**
 * Parses one complete or unclosed wikitable into rows and cells.
 *
 * @param raw - Raw wikitable source.
 * @param start - Starting source offset.
 * @param options - Literal tags protected in cell separators.
 * @returns Parsed wikitable structure with absolute offsets.
 */
export function parseWikitable(
    raw: string,
    start: number = 0,
    options: WikitextOptions = {},
): ParsedWikitable {
    const scanned = scanTable(raw, options);
    const rows: ParsedWikitableRow[] = [];
    const captions: ParsedWikitableCaption[] = [];
    let currentRow: RowBuilder | null = null;

    function finishRow(end: number): void {
        if (currentRow == null) {
            return;
        }
        rows.push(buildRow(raw, currentRow, end, start, options));
        currentRow = null;
    }

    for (const [index, token] of scanned.tokens.entries()) {
        const nextStart =
            scanned.tokens[index + 1]?.start ?? scanned.closeStart;
        if (token.kind === "caption") {
            finishRow(token.start);
            captions.push(
                buildTableContent(raw, token, nextStart, start, options),
            );
        } else if (token.kind === "row") {
            finishRow(token.start);
            currentRow = {
                attributes: parseTagAttributes(token.attributesSource ?? ""),
                cells: [],
                start: token.start,
            };
        } else {
            currentRow ??= { attributes: {}, cells: [], start: token.start };
            currentRow.cells.push({ ...token, end: nextStart });
        }
    }
    finishRow(scanned.closeStart);
    return {
        attributes: parseTagAttributes(scanned.attributesSource),
        captions,
        closed: scanned.closed,
        end: start + raw.length,
        raw,
        rows,
        start,
    };
}

function scanTable(
    source: string,
    options: WikitextOptions,
): {
    attributesSource: string;
    closed: boolean;
    closeStart: number;
    tokens: TableToken[];
} {
    const lines = readLines(source);
    const tokens: TableToken[] = [];
    let attributesSource = "";
    let closeStart = source.length;
    let closed = false;
    let depth = 0;
    const opaque = findOpaqueRanges(source, options);

    for (const line of lines) {
        const marker = skipHorizontalSpace(source, line.start, line.contentEnd);
        if (isOffsetInRanges(marker, opaque)) {
            continue;
        }
        if (source.startsWith("{|", marker)) {
            depth += 1;
            if (depth === 1) {
                attributesSource = source.slice(marker + 2, line.contentEnd);
            }
            continue;
        }
        if (source.startsWith("|}", marker) && depth > 0) {
            depth -= 1;
            if (depth === 0) {
                closed = true;
                closeStart = marker;
            }
            continue;
        }
        if (depth !== 1) {
            continue;
        }
        if (source.startsWith("|-", marker)) {
            tokens.push({
                attributesSource: source.slice(marker + 2, line.contentEnd),
                end: line.end,
                kind: "row",
                start: marker,
            });
        } else if (source.startsWith("|+", marker)) {
            tokens.push({
                end: line.end,
                kind: "caption",
                payloadEnd: line.contentEnd,
                payloadStart: marker + 2,
                start: marker,
            });
        } else if (
            source[marker] === "!" ||
            (source[marker] === "|" &&
                !"}+-".includes(source[marker + 1] ?? ""))
        ) {
            tokens.push(...readCellTokens(source, line, marker, options));
        }
    }
    return { attributesSource, closed, closeStart, tokens };
}

function readCellTokens(
    source: string,
    line: SourceLine,
    marker: number,
    options: WikitextOptions,
): TableToken[] {
    const header = source[marker] === "!";
    const separator = header ? "!!" : "||";
    const payloadStart = marker + 1;
    const payload = source.slice(payloadStart, line.contentEnd);
    return splitTopLevelRanges(payload, separator, options).map(
        function makeToken(part, index) {
            return {
                end: payloadStart + part.end,
                header,
                kind: "cell" as const,
                payloadEnd: payloadStart + part.end,
                payloadStart: payloadStart + part.start,
                start:
                    index === 0
                        ? marker
                        : payloadStart + part.start - separator.length,
            };
        },
    );
}

function buildTableContent(
    source: string,
    token: TableToken,
    end: number,
    base: number,
    options: WikitextOptions,
): ParsedWikitableCaption {
    const payload = parseTablePayload(source, token, options);
    const contentEnd = trimTrailingLineBreak(source, end);
    return {
        attributes: payload.attributes,
        content: source.slice(payload.contentStart, contentEnd),
        contentEnd: base + contentEnd,
        contentStart: base + payload.contentStart,
        end: base + end,
        raw: source.slice(token.start, end),
        start: base + token.start,
    };
}

function buildRow(
    source: string,
    row: RowBuilder,
    end: number,
    base: number,
    options: WikitextOptions,
): ParsedWikitableRow {
    return {
        attributes: row.attributes,
        cells: row.cells.map((cell) => ({
            ...buildTableContent(source, cell, cell.end, base, options),
            header: cell.header ?? false,
        })),
        end: base + end,
        raw: source.slice(row.start, end),
        start: base + row.start,
    };
}

function parseTablePayload(
    source: string,
    token: TableToken,
    options: WikitextOptions,
): ParsedTablePayload {
    const payloadStart = token.payloadStart ?? token.end;
    const payloadEnd = token.payloadEnd ?? payloadStart;
    const payload = source.slice(payloadStart, payloadEnd);
    const attributeParts = splitTopLevelRanges(payload, "|", options);
    const hasAttributes =
        attributeParts.length > 1 &&
        findTopLevelEquals(attributeParts[0]?.value ?? "", options) >= 0;
    const contentStart = hasAttributes
        ? payloadStart + (attributeParts[1]?.start ?? payload.length)
        : payloadStart;
    return {
        attributes: hasAttributes
            ? parseTagAttributes(attributeParts[0]?.value ?? "")
            : {},
        contentStart,
    };
}

function readLines(source: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    while (start < source.length) {
        const newline = source.indexOf("\n", start);
        const end = newline < 0 ? source.length : newline + 1;
        const contentEnd =
            source[end - 1] === "\n"
                ? end - (source[end - 2] === "\r" ? 2 : 1)
                : end;
        lines.push({ contentEnd, end, start });
        start = end;
    }
    return lines;
}

function skipHorizontalSpace(
    source: string,
    start: number,
    end: number,
): number {
    let index = start;
    while (index < end && /[\t ]/u.test(source[index] ?? "")) {
        index += 1;
    }
    return index;
}

function trimTrailingLineBreak(source: string, end: number): number {
    if (source[end - 1] !== "\n") {
        return end;
    }
    return end - (source[end - 2] === "\r" ? 2 : 1);
}
