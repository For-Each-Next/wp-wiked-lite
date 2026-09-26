/** Balanced template queries, local parsing, and serialization. */

import {
    findOpaqueRanges,
    type SourceRange,
    type WikitextOptions,
} from "./opaque-ranges.ts";
import { findWikitextTags, type WikitextTag } from "./tags.ts";

export interface ParsedTemplateCall {
    depth: number;
    end: number;
    name: string;
    params: ParsedTemplateParameter[];
    raw: string;
    start: number;
}

export interface ParsedTemplateParameter {
    end: number;
    name: string;
    positional: boolean;
    rawValue: string;
    start: number;
    value: string;
    valueEnd: number;
    valueStart: number;
}

export interface TopLevelRange {
    end: number;
    start: number;
    value: string;
}

interface TemplateRange extends SourceRange {
    depth: number;
}

interface NestingState {
    links: number;
    wikitext: Array<"parameter" | "template">;
}

const TEMPLATE_ARGUMENT_EXTENSION_TAGS = ["ref", "references"] as const;

/**
 * Finds balanced template ranges, including nested calls.
 *
 * @param source - Source text.
 * @param options - Literal tags to protect.
 * @returns Balanced template ranges, including nested calls.
 */
function findTemplateRanges(
    source: string,
    options: WikitextOptions = {},
): TemplateRange[] {
    const opaque = findOpaqueRanges(source, options);
    const stack: Array<{ depth: number; start: number }> = [];
    const ranges: TemplateRange[] = [];
    let opaqueIndex = 0;
    let index = 0;

    while (index < source.length - 1) {
        while (opaque[opaqueIndex]?.end <= index) {
            opaqueIndex += 1;
        }
        const hidden = opaque[opaqueIndex];
        if (hidden != null && index >= hidden.start) {
            index = hidden.end;
            opaqueIndex += 1;
            continue;
        }
        if (source.startsWith("{{{", index)) {
            index = skipBalancedParameter(source, index, opaque);
            continue;
        }
        if (source.startsWith("{{", index)) {
            stack.push({ depth: stack.length, start: index });
            index += 2;
            continue;
        }
        if (source.startsWith("}}", index) && stack.length > 0) {
            const open = stack.pop();
            if (open != null) {
                ranges.push({
                    ...open,
                    end: index + 2,
                });
            }
            index += 2;
            continue;
        }
        index += 1;
    }
    return ranges.sort((left, right) => left.start - right.start);
}

/**
 * Finds and parses balanced template calls, including nested calls.
 *
 * @param source - Source text.
 * @param options - Literal tags to protect.
 * @returns Parsed balanced template calls, including nested calls.
 */
export function findTemplateCalls(
    source: string,
    options: WikitextOptions = {},
): ParsedTemplateCall[] {
    return findTemplateRanges(source, options).map(function parseRange(range) {
        return {
            ...parseTemplateCall(
                source.slice(range.start, range.end),
                range.start,
                options,
            ),
            depth: range.depth,
        };
    });
}

/**
 * Splits text at separators outside nested wikitext constructs.
 *
 * @param source - Source text.
 * @param separator - Top-level separator.
 * @param options - Operation options.
 * @returns Split text at separators outside nested wikitext constructs.
 */
export function splitTopLevel(
    source: string,
    separator: string,
    options: WikitextOptions = {},
): string[] {
    return splitTopLevelRanges(source, separator, options).map(
        (part) => part.value,
    );
}

/**
 * Splits text into offset-bearing ranges outside nested constructs.
 *
 * @param source - Source text.
 * @param separator - Non-empty top-level separator.
 * @param options - Operation options.
 * @returns Split ranges relative to the supplied source.
 */
export function splitTopLevelRanges(
    source: string,
    separator: string,
    options: WikitextOptions = {},
): TopLevelRange[] {
    if (separator.length === 0) {
        throw new RangeError("The separator must not be empty.");
    }
    const protectedRanges = findSeparatorProtectedRanges(source, options);
    const parts: TopLevelRange[] = [];
    const state: NestingState = { links: 0, wikitext: [] };
    let protectedIndex = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        const hidden = protectedRanges[protectedIndex];
        if (hidden?.start === index) {
            index = hidden.end - 1;
            protectedIndex += 1;
            continue;
        }
        const skipped = updateNesting(source, index, state);
        if (skipped > 0) {
            index += skipped;
            continue;
        }
        if (
            source.startsWith(separator, index) &&
            state.links === 0 &&
            state.wikitext.length === 0
        ) {
            parts.push({
                end: index,
                start,
                value: source.slice(start, index),
            });
            index += separator.length - 1;
            start = index + 1;
        }
    }
    parts.push({ end: source.length, start, value: source.slice(start) });
    return parts;
}

function findSeparatorProtectedRanges(
    source: string,
    options: WikitextOptions,
): SourceRange[] {
    const opaque = findOpaqueRanges(source, options);
    const extensions = findWikitextTags(source, {
        ...(options.literalTags == null
            ? {}
            : { literalTags: options.literalTags }),
        tagNames: TEMPLATE_ARGUMENT_EXTENSION_TAGS,
    })
        .filter((tag) => isCompleteExtensionTag(source, tag))
        .map(({ end, start }) => ({ end, start }));
    return mergeSourceRanges([...opaque, ...extensions]);
}

function isCompleteExtensionTag(source: string, tag: WikitextTag): boolean {
    if (!tag.closed || !hasStrictOpeningTag(source, tag)) {
        return false;
    }
    if (tag.selfClosing) {
        return true;
    }
    const closing = source.slice(tag.contentEnd, tag.end);
    const enteredName = closing.slice(2, 2 + tag.name.length);
    const tail = closing.slice(2 + tag.name.length);
    return enteredName.toLocaleLowerCase() === tag.name && /^\s*>$/u.test(tail);
}

function hasStrictOpeningTag(source: string, tag: WikitextTag): boolean {
    const opening = source.slice(tag.start, tag.contentStart);
    const enteredName = opening.slice(1, 1 + tag.name.length);
    const boundary = opening[1 + tag.name.length] ?? "";
    return (
        enteredName.toLocaleLowerCase() === tag.name && /[\s/>]/u.test(boundary)
    );
}

function mergeSourceRanges(ranges: SourceRange[]): SourceRange[] {
    const merged: SourceRange[] = [];
    for (const range of ranges.toSorted(
        (left, right) => left.start - right.start || right.end - left.end,
    )) {
        const previous = merged.at(-1);
        if (previous == null || previous.end < range.start) {
            merged.push({ ...range });
            continue;
        }
        previous.end = Math.max(previous.end, range.end);
    }
    return merged;
}

/**
 * Returns a top-level equals-sign position.
 *
 * @param source - Source text.
 * @param options - Operation options.
 * @returns A top-level equals-sign position.
 */
export function findTopLevelEquals(
    source: string,
    options: WikitextOptions = {},
): number {
    const parts = splitTopLevel(source, "=", options);
    return parts.length < 2 ? -1 : parts[0].length;
}

/**
 * Normalizes a template name for case-insensitive comparison.
 *
 * @param name - Name to process.
 * @returns Normalized template name for case-insensitive comparison.
 */
export function normalizeTemplateName(name: string): string {
    return name
        .replace(/^\s*(?:template\s*:\s*)?/iu, "")
        .replaceAll("_", " ")
        .trim()
        .replace(/\s+/gu, " ")
        .toLowerCase();
}

/**
 * Parses one complete template call.
 *
 * @param raw - Raw value.
 * @param start - Starting source offset.
 * @param options - Operation options.
 * @returns Parsed complete template call.
 */
export function parseTemplateCall(
    raw: string,
    start: number = 0,
    options: WikitextOptions = {},
): ParsedTemplateCall {
    const wrapped = raw.startsWith("{{") && raw.endsWith("}}");
    const innerStart = wrapped ? 2 : 0;
    const inner = wrapped ? raw.slice(2, -2) : raw;
    const parts = splitTopLevelRanges(inner, "|", options);
    const name = parts.shift()?.value.trim() ?? "";
    let positionalIndex = 0;
    const params = parts.map(function parsePart(part) {
        const separator = findTopLevelEquals(part.value, options);
        const partStart = start + innerStart + part.start;
        const partEnd = start + innerStart + part.end;
        if (separator < 0) {
            positionalIndex += 1;
            return {
                end: partEnd,
                name: String(positionalIndex),
                positional: true,
                rawValue: part.value,
                start: partStart,
                value: part.value.trim(),
                valueEnd: partEnd,
                valueStart: partStart,
            };
        }
        const valueStart = partStart + separator + 1;
        return {
            end: partEnd,
            name: part.value.slice(0, separator).trim(),
            positional: false,
            rawValue: part.value.slice(separator + 1),
            start: partStart,
            value: part.value.slice(separator + 1).trim(),
            valueEnd: partEnd,
            valueStart,
        };
    });
    return { depth: 0, end: start + raw.length, name, params, raw, start };
}

function updateNesting(
    source: string,
    index: number,
    state: NestingState,
): number {
    const top = state.wikitext.at(-1);
    if (top === "parameter" && source.startsWith("}}}", index)) {
        state.wikitext.pop();
        return 2;
    }
    if (top === "template" && source.startsWith("}}", index)) {
        state.wikitext.pop();
        return 1;
    }
    if (source.startsWith("{{{", index)) {
        state.wikitext.push("parameter");
        return 2;
    }
    if (source.startsWith("{{", index)) {
        state.wikitext.push("template");
        return 1;
    }
    if (source.startsWith("[[", index)) {
        state.links += 1;
        return 1;
    }
    if (source.startsWith("]]", index) && state.links > 0) {
        state.links -= 1;
        return 1;
    }
    return 0;
}

function skipBalancedParameter(
    source: string,
    start: number,
    opaque: readonly SourceRange[],
): number {
    const stack: Array<"parameter" | "template"> = ["parameter"];
    let opaqueIndex = opaque.findIndex((range) => range.end > start);
    let index = start + 3;
    while (index < source.length) {
        const hidden = opaque[opaqueIndex];
        if (hidden != null && index >= hidden.start) {
            index = hidden.end;
            opaqueIndex += 1;
            continue;
        }
        const top = stack.at(-1);
        if (top === "parameter" && source.startsWith("}}}", index)) {
            stack.pop();
            index += 3;
            if (stack.length === 0) {
                return index;
            }
            continue;
        }
        if (top === "template" && source.startsWith("}}", index)) {
            stack.pop();
            index += 2;
            continue;
        }
        if (source.startsWith("{{{", index)) {
            stack.push("parameter");
            index += 3;
            continue;
        }
        if (source.startsWith("{{", index)) {
            stack.push("template");
            index += 2;
            continue;
        }
        index += 1;
    }
    return source.length;
}
