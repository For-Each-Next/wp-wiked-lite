/** Recognizes and safely formats Chinese language-conversion rules. */

import {
    type ParsedTemplateCall,
    type ParsedTemplateParameter,
    type SourceRange,
    type TopLevelRange,
    wikitext,
} from "./wikitext/index.ts";

const NOTE_TA_NAMES = new Set([
    "noteta",
    "ta",
    "noteat",
    "noteta/default",
    "note ta",
    "noteta-lite",
    "ta-lite",
    "tal",
]);

interface ConversionDeclaration {
    colon: number;
    key: SourceRange;
}

interface ConversionRuleList {
    finalSeparator: boolean;
    parts: TopLevelRange[];
    ruleCount: number;
}

export interface LanguageConversionRange extends SourceRange {
    bodyEnd: number;
    bodyStart: number;
}

type RuleListContainer = "language-conversion" | "noteta";

/** Returns whether a normalized template name is a NoteTA alias. */
export function isNoteTAName(name: string): boolean {
    const normalized = wikitext.template.normalizeName(name);
    return (
        NOTE_TA_NAMES.has(normalized) ||
        /^全文字[詞词][轉转][換换]$/u.test(normalized)
    );
}

/** Checks whether a NoteTA parameter can hold conversion rules. */
export function isNoteTAConversionParameter(
    parameter: ParsedTemplateParameter,
): boolean {
    const name = parameter.name.toLocaleLowerCase();
    return name === "t" || /^(?:[1-9]|[12]\d|30)$/u.test(name);
}

/**
 * Finds language-variant keys within one absolute source range.
 *
 * @param source - Complete source text.
 * @param start - Rule-list start.
 * @param end - Rule-list end.
 * @returns Absolute source ranges for recognized destination keys.
 */
export function findConversionKeyRanges(
    source: string,
    start: number,
    end: number,
): SourceRange[] {
    const body = source.slice(start, end);
    return splitConversionRanges(body, ";").flatMap(function findKey(part) {
        const declaration = findConversionDeclaration(part.value);
        return declaration == null
            ? []
            : [
                  {
                      end: start + part.start + declaration.key.end,
                      start: start + part.start + declaration.key.start,
                  },
              ];
    });
}

/**
 * Normalizes recognized conversion lists without rewriting rule values.
 *
 * Only padding and separator trivia change.
 * Colon-to-semicolon text stays byte-identical.
 */
export function normalizeChineseConversion(source: string): string {
    const protectedLanguageValues = protectRanges(
        source,
        findLanguageConversionValueRanges(source),
    );
    const noteTANormalized = protectedLanguageValues.restore(
        normalizeNoteTATemplates(protectedLanguageValues.text),
    );
    const protectedNoteTAValues = protectRanges(
        noteTANormalized,
        findNoteTAConversionValueRanges(noteTANormalized),
    );
    return protectedNoteTAValues.restore(
        normalizeLanguageConversionMarkup(protectedNoteTAValues.text),
    );
}

/**
 * Finds value ranges that general formatting must treat as opaque.
 *
 * Each range covers one colon through its top-level semicolon.
 */
export function findChineseConversionValueRanges(
    source: string,
): SourceRange[] {
    return mergeRanges([
        ...findLanguageConversionValueRanges(source),
        ...findNoteTAConversionValueRanges(source),
    ]);
}

/** Finds balanced top-level language-conversion constructs. */
export function findLanguageConversionRanges(
    source: string,
): LanguageConversionRange[] {
    const protectedRanges = mergeRanges([
        ...wikitext(source).opaque.getAll(),
        ...createTagMarkupRanges(source),
    ]);
    const ranges: LanguageConversionRange[] = [];
    let index = 0;
    while (index < source.length - 1) {
        const hidden = findContainingRange(protectedRanges, index);
        if (hidden != null) {
            index = hidden.end;
            continue;
        }
        if (!source.startsWith("-{", index)) {
            index += 1;
            continue;
        }
        const end = findLanguageConversionEnd(
            source,
            index + 2,
            protectedRanges,
        );
        if (end == null) {
            index += 2;
            continue;
        }
        ranges.push({
            bodyEnd: end - 2,
            bodyStart: index + 2,
            end,
            start: index,
        });
        index = end;
    }
    return ranges;
}

function findLanguageConversionValueRanges(source: string): SourceRange[] {
    return findLanguageConversionRanges(source).flatMap((range) =>
        findRuleValueRanges(
            source.slice(range.bodyStart, range.bodyEnd),
            range.bodyStart,
        ),
    );
}

function findNoteTAConversionValueRanges(source: string): SourceRange[] {
    const ranges: SourceRange[] = [];
    for (const template of wikitext(source).template.getAll()) {
        if (!isNoteTAName(template.name)) {
            continue;
        }
        for (const parameter of template.params) {
            if (!isNoteTAConversionParameter(parameter)) {
                continue;
            }
            ranges.push(
                ...findRuleValueRanges(
                    source.slice(parameter.valueStart, parameter.valueEnd),
                    parameter.valueStart,
                ),
            );
        }
    }
    return ranges;
}

function normalizeLanguageConversionMarkup(source: string): string {
    return replaceRanges(
        source,
        findLanguageConversionRanges(source).map(function normalize(range) {
            const body = source.slice(range.bodyStart, range.bodyEnd);
            const list = parseConversionRuleList(body);
            const value =
                list == null
                    ? normalizeLanguageConversionMarkup(body)
                    : formatConversionRuleList(
                          body,
                          list,
                          "language-conversion",
                      );
            return {
                end: range.bodyEnd,
                start: range.bodyStart,
                value,
            };
        }),
    );
}

function normalizeNoteTATemplates(source: string): string {
    const templates = wikitext(source)
        .template.getAll()
        .filter((template) => template.depth === 0);
    return replaceRanges(
        source,
        templates.map((template) => ({
            end: template.end,
            start: template.start,
            value: normalizeTemplateParameters(template),
        })),
    );
}

function normalizeTemplateParameters(template: ParsedTemplateCall): string {
    const noteTA = isNoteTAName(template.name);
    const replacements = template.params.map(
        function normalizeParameter(parameter) {
            const list =
                noteTA && isNoteTAConversionParameter(parameter)
                    ? parseConversionRuleList(parameter.rawValue)
                    : undefined;
            const value =
                list == null
                    ? normalizeNoteTATemplates(parameter.rawValue)
                    : formatConversionRuleList(
                          parameter.rawValue,
                          list,
                          "noteta",
                      );
            return {
                end: parameter.valueEnd - template.start,
                start: parameter.valueStart - template.start,
                value,
            };
        },
    );
    return replaceRanges(template.raw, replacements);
}

function formatConversionRuleList(
    source: string,
    list: ConversionRuleList,
    container: RuleListContainer,
): string {
    const formatted: string[] = [];
    for (let index = 0; index < list.ruleCount; index += 1) {
        const part = list.parts[index];
        if (part == null) {
            return source;
        }
        formatted.push(
            index === 0 && container === "language-conversion"
                ? part.value.replace(/^[ \t]+/u, "")
                : index === 0
                  ? part.value
                  : normalizeSeparatorPrefix(part.value),
        );
        if (index < list.parts.length - 1) {
            formatted.push(";");
        }
    }
    if (list.finalSeparator) {
        const suffix = list.parts[list.ruleCount]?.value ?? "";
        formatted.push(
            container === "language-conversion"
                ? suffix.replace(/[ \t]+$/u, "")
                : suffix,
        );
        return formatted.join("");
    }
    return appendFinalSeparator(formatted.join(""), container);
}

function parseConversionRuleList(
    source: string,
): ConversionRuleList | undefined {
    const parts = splitConversionRanges(source, ";");
    const declarations = parts.map((part) =>
        findConversionDeclaration(part.value),
    );
    const finalSeparator =
        parts.length > 1 &&
        declarations.at(-1) == null &&
        /^\s*$/u.test(parts.at(-1)?.value ?? "");
    const ruleCount = finalSeparator ? parts.length - 1 : parts.length;
    if (
        ruleCount === 0 ||
        declarations.slice(0, ruleCount).some((item) => item == null) ||
        (!finalSeparator && declarations.at(-1) == null)
    ) {
        return undefined;
    }
    return { finalSeparator, parts, ruleCount };
}

function normalizeSeparatorPrefix(source: string): string {
    const whitespace = source.match(/^\s*/u)?.[0] ?? "";
    if (/\r|\n/u.test(whitespace)) {
        return source;
    }
    return ` ${source.slice(whitespace.length)}`;
}

function appendFinalSeparator(
    source: string,
    container: RuleListContainer,
): string {
    if (container === "noteta") {
        const suffix = source.match(/\s*$/u)?.[0] ?? "";
        return `${source.slice(0, source.length - suffix.length)};${suffix}`;
    }
    const withoutOuterPadding = source.replace(/[ \t]+$/u, "");
    const newlineLayout = withoutOuterPadding.match(
        /[ \t]*(?:\r?\n[ \t]*)+$/u,
    )?.[0];
    if (newlineLayout == null) {
        return `${withoutOuterPadding};`;
    }
    const valueEnd = withoutOuterPadding.length - newlineLayout.length;
    return (
        withoutOuterPadding.slice(0, valueEnd) +
        ";" +
        newlineLayout.replace(/[ \t]+$/u, "")
    );
}

function findRuleValueRanges(source: string, offset: number): SourceRange[] {
    const list = parseConversionRuleList(source);
    if (list == null) {
        return [];
    }
    return list.parts
        .slice(0, list.ruleCount)
        .flatMap(function findValue(part, index) {
            const declaration = findConversionDeclaration(part.value);
            if (declaration == null) {
                return [];
            }
            const separatorLength = index < list.parts.length - 1 ? 1 : 0;
            return [
                {
                    end: offset + part.end + separatorLength,
                    start: offset + part.start + declaration.colon,
                },
            ];
        });
}

function findConversionDeclaration(
    declaration: string,
): ConversionDeclaration | undefined {
    const ordinary = findConversionDestination(declaration, 0);
    const arrow = findConversionArrow(declaration);
    if (arrow == null || (ordinary != null && ordinary.colon < arrow.start)) {
        return ordinary;
    }
    return findConversionDestination(declaration, arrow.end) ?? ordinary;
}

function findConversionDestination(
    declaration: string,
    destinationStart: number,
): ConversionDeclaration | undefined {
    const destination = declaration.slice(destinationStart);
    const colon = getFirstTopLevelSeparator(destination, ":");
    if (colon == null) {
        return undefined;
    }
    const keySource = destination.slice(0, colon);
    const keyPart = splitConversionRanges(keySource, "|").at(-1);
    if (keyPart == null) {
        return undefined;
    }
    const keyStart = destinationStart + keyPart.start;
    const enteredKey = declaration.slice(
        keyStart,
        destinationStart + keyPart.end,
    );
    const maskedKey = maskRanges(
        enteredKey,
        wikitext(enteredKey).comment.getAll(),
    );
    const key = trimRange(maskedKey, 0, maskedKey.length);
    const value = maskedKey.slice(key.start, key.end);
    if (!/^[\p{L}\p{N}_-]+$/u.test(value)) {
        return undefined;
    }
    return {
        colon: destinationStart + colon,
        key: { end: keyStart + key.end, start: keyStart + key.start },
    };
}

function findConversionArrow(declaration: string): SourceRange | undefined {
    const masked = maskConversionSyntax(declaration);
    const query = wikitext(masked);
    const literalArrows = query
        .splitRanges("=")
        .slice(0, -1)
        .flatMap((part) =>
            declaration[part.end + 1] === ">"
                ? [{ end: part.end + 2, start: part.end }]
                : [],
        );
    const encodedArrows = query.template
        .getAll()
        .flatMap((template) =>
            template.depth === 0 &&
            wikitext.template.normalizeName(template.name) === "=" &&
            declaration[template.end] === ">"
                ? [{ end: template.end + 1, start: template.start }]
                : [],
        );
    return [...literalArrows, ...encodedArrows].toSorted(
        (left, right) => left.start - right.start,
    )[0];
}

function getFirstTopLevelSeparator(
    source: string,
    separator: string,
): number | undefined {
    const parts = splitConversionRanges(source, separator);
    return parts.length > 1 ? parts[0]?.end : undefined;
}

function splitConversionRanges(
    source: string,
    separator: string,
): TopLevelRange[] {
    const masked = maskConversionSyntax(source);
    return wikitext(masked)
        .splitRanges(separator)
        .map((range) => ({
            ...range,
            value: source.slice(range.start, range.end),
        }));
}

function maskConversionSyntax(source: string): string {
    return maskRanges(source, [
        ...wikitext(source).opaque.getAll(),
        ...createTagMarkupRanges(source),
        ...findLanguageConversionRanges(source),
    ]);
}

function createTagMarkupRanges(source: string): SourceRange[] {
    return wikitext(source)
        .tag.getAll()
        .flatMap(function getMarkup(tag) {
            const ranges: SourceRange[] = [
                { end: tag.contentStart, start: tag.start },
            ];
            if (!tag.selfClosing && tag.contentEnd < tag.end) {
                ranges.push({ end: tag.end, start: tag.contentEnd });
            }
            return ranges;
        });
}

function findLanguageConversionEnd(
    source: string,
    start: number,
    protectedRanges: SourceRange[],
): number | undefined {
    const state = {
        conversions: 0,
        links: 0,
        wikitext: [] as Array<"parameter" | "template">,
    };
    let index = start;
    while (index < source.length - 1) {
        const hidden = findContainingRange(protectedRanges, index);
        if (hidden != null) {
            index = hidden.end;
            continue;
        }
        if (state.links === 0 && state.wikitext.length === 0) {
            if (source.startsWith("-{", index)) {
                state.conversions += 1;
                index += 2;
                continue;
            }
            if (source.startsWith("}-", index)) {
                if (state.conversions === 0) {
                    return index + 2;
                }
                state.conversions -= 1;
                index += 2;
                continue;
            }
        }
        index += updateNesting(source, index, state);
    }
    return undefined;
}

function updateNesting(
    source: string,
    index: number,
    state: {
        links: number;
        wikitext: Array<"parameter" | "template">;
    },
): number {
    const active = state.wikitext.at(-1);
    if (active === "parameter" && source.startsWith("}}}", index)) {
        state.wikitext.pop();
        return 3;
    }
    if (active === "template" && source.startsWith("}}", index)) {
        state.wikitext.pop();
        return 2;
    }
    if (source.startsWith("{{{", index)) {
        state.wikitext.push("parameter");
        return 3;
    }
    if (source.startsWith("{{", index)) {
        state.wikitext.push("template");
        return 2;
    }
    if (source.startsWith("[[", index)) {
        state.links += 1;
        return 2;
    }
    if (source.startsWith("]]", index) && state.links > 0) {
        state.links -= 1;
        return 2;
    }
    return 1;
}

function trimRange(source: string, start: number, end: number): SourceRange {
    let trimmedStart = start;
    let trimmedEnd = end;
    while (
        trimmedStart < trimmedEnd &&
        /\s/u.test(source[trimmedStart] ?? "")
    ) {
        trimmedStart += 1;
    }
    while (
        trimmedEnd > trimmedStart &&
        /\s/u.test(source[trimmedEnd - 1] ?? "")
    ) {
        trimmedEnd -= 1;
    }
    return { end: trimmedEnd, start: trimmedStart };
}

function maskRanges(source: string, ranges: SourceRange[]): string {
    let cursor = 0;
    let masked = "";
    for (const range of mergeRanges(ranges)) {
        masked += source.slice(cursor, range.start);
        masked += " ".repeat(range.end - range.start);
        cursor = range.end;
    }
    return masked + source.slice(cursor);
}

function protectRanges(
    source: string,
    ranges: SourceRange[],
): {
    restore(value: string): string;
    text: string;
} {
    const values = new Map<string, string>();
    let text = source;
    for (const [index, range] of mergeRanges(ranges).toReversed().entries()) {
        const marker = createProtectionMarker(source, index);
        values.set(marker, source.slice(range.start, range.end));
        text = text.slice(0, range.start) + marker + text.slice(range.end);
    }
    return {
        restore(value) {
            let restored = value;
            for (const [marker, original] of values) {
                restored = restored.replaceAll(marker, original);
            }
            return restored;
        },
        text,
    };
}

function createProtectionMarker(source: string, index: number): string {
    let marker = `\uE000WIKED-LITE-CONVERSION-${index}\uE001`;
    while (source.includes(marker)) {
        marker = `\uE000${marker}\uE001`;
    }
    return marker;
}

function findContainingRange(
    ranges: SourceRange[],
    index: number,
): SourceRange | undefined {
    let start = 0;
    let end = ranges.length - 1;
    while (start <= end) {
        const middle = Math.floor((start + end) / 2);
        const range = ranges[middle];
        if (range == null) {
            return undefined;
        }
        if (index < range.start) {
            end = middle - 1;
        } else if (index >= range.end) {
            start = middle + 1;
        } else {
            return range;
        }
    }
    return undefined;
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
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

function replaceRanges(
    source: string,
    replacements: Array<SourceRange & { value: string }>,
): string {
    let result = source;
    for (const replacement of replacements.toSorted(
        (left, right) => right.start - left.start,
    )) {
        result =
            result.slice(0, replacement.start) +
            replacement.value +
            result.slice(replacement.end);
    }
    return result;
}
