/** Classification for magic words that share template braces. */

import {
    type SourceRange,
    type TopLevelRange,
    wikitext,
} from "./wikitext/index.ts";

interface BaseTemplateHeadSyntax {
    modifiers: SourceRange[];
    separators: SourceRange[];
}

export interface MagicWordAliases {
    caseInsensitive: ReadonlySet<string>;
    caseSensitive: ReadonlySet<string>;
}

export interface TemplateMagicWordCatalog {
    functions: MagicWordAliases;
    invoke: MagicWordAliases;
    modifiers: Readonly<
        Record<"message" | "raw" | "substitution", MagicWordAliases>
    >;
    variables: MagicWordAliases;
}

export type TemplateHeadSyntax =
    | (BaseTemplateHeadSyntax & {
          argument?: SourceRange;
          invoke: boolean;
          kind: "magic-word";
          magicWord: SourceRange;
      })
    | (BaseTemplateHeadSyntax & {
          kind: "template";
          target: SourceRange;
      });

interface TemplateModifierState extends BaseTemplateHeadSyntax {
    allowLeadingWhitespace: boolean;
    magicWords: TemplateMagicWordCatalog | null;
    partIndex: number;
}

type TemplateModifier = "message" | "raw" | "substitution";

interface MagicWordCandidate {
    entered: string;
    part: TopLevelRange;
    range: SourceRange;
}

/**
 * Separates a template target from brace-based magic-word syntax.
 *
 * Siteinfo supplies the current wiki's localized magic-word aliases.
 * Leading-hash functions remain recognizable while it loads.
 *
 * @param name - Parsed text before the first top-level pipe.
 * @param hasParameters - Whether pipe-delimited arguments were entered.
 * @param magicWords - Aliases loaded from the current wiki's siteinfo.
 * @returns Relative syntax ranges within `name`.
 */
export function classifyTemplateHead(
    name: string,
    hasParameters: boolean,
    magicWords: TemplateMagicWordCatalog | null = null,
): TemplateHeadSyntax {
    const parts = splitMagicWordRanges(name);
    const substitution = readTemplateModifier(
        name,
        parts,
        emptyModifierState(magicWords),
        "substitution",
    );
    const variable = readMagicWord(name, parts, substitution);
    if (isVariableInvocation(variable, substitution, parts, hasParameters)) {
        return createMagicWordSyntax(
            name,
            variable.part,
            variable.range,
            false,
            substitution,
        );
    }
    return classifyFunctionOrTemplate(name, parts, substitution);
}

function classifyFunctionOrTemplate(
    name: string,
    parts: TopLevelRange[],
    substitution: TemplateModifierState,
): TemplateHeadSyntax {
    const message = readTemplateModifier(name, parts, substitution, "message");
    const state = readTemplateModifier(name, parts, message, "raw");
    const part = parts[state.partIndex] ?? {
        end: name.length,
        start: 0,
        value: name,
    };
    const magicWord = readMagicWord(name, parts, state);
    const hasColon = state.partIndex < parts.length - 1;
    const magic =
        magicWord != null &&
        hasColon &&
        isParserFunction(
            magicWord.entered,
            name[part.end] ?? "",
            state.magicWords,
        );
    return magic && magicWord != null
        ? createMagicWordSyntax(name, part, magicWord.range, hasColon, state)
        : createTemplateSyntax(name, part, state);
}

function isVariableInvocation(
    variable: MagicWordCandidate | null,
    state: TemplateModifierState,
    parts: TopLevelRange[],
    hasParameters: boolean,
): variable is MagicWordCandidate {
    return (
        variable != null &&
        state.partIndex === parts.length - 1 &&
        !hasParameters &&
        isParserVariable(variable.entered, state.magicWords)
    );
}

function emptyModifierState(
    magicWords: TemplateMagicWordCatalog | null,
): TemplateModifierState {
    return {
        allowLeadingWhitespace: false,
        magicWords,
        modifiers: [],
        partIndex: 0,
        separators: [],
    };
}

function readTemplateModifier(
    name: string,
    parts: TopLevelRange[],
    state: TemplateModifierState,
    kind: TemplateModifier,
): TemplateModifierState {
    const part = parts[state.partIndex];
    if (
        part == null ||
        state.partIndex >= parts.length - 1 ||
        !isModifierSeparator(name[part.end])
    ) {
        return state;
    }
    const range = readHeadRange(name, part, state.allowLeadingWhitespace);
    if (
        range == null ||
        !isTemplateModifier(
            name.slice(range.start, range.end),
            name[part.end] ?? "",
            kind,
            state.magicWords,
        )
    ) {
        return state;
    }
    return {
        allowLeadingWhitespace: kind === "substitution",
        magicWords: state.magicWords,
        modifiers: [...state.modifiers, range],
        partIndex: state.partIndex + 1,
        separators: [
            ...state.separators,
            { end: part.end + 1, start: part.end },
        ],
    };
}

function createTemplateSyntax(
    name: string,
    part: TopLevelRange,
    state: TemplateModifierState,
): TemplateHeadSyntax {
    return {
        kind: "template",
        modifiers: state.modifiers,
        separators: state.separators,
        target: trimRange(name, {
            end: name.length,
            start: part.start,
        }),
    };
}

function createMagicWordSyntax(
    name: string,
    part: TopLevelRange,
    magicWord: SourceRange,
    hasColon: boolean,
    state: TemplateModifierState,
): TemplateHeadSyntax {
    const argument = hasColon
        ? trimRange(name, { end: name.length, start: part.end + 1 })
        : undefined;
    const separators = [...state.separators];
    if (hasColon) {
        separators.push({ end: part.end + 1, start: part.end });
    }
    return {
        argument,
        invoke: isInvoke(
            name.slice(magicWord.start, magicWord.end),
            hasColon ? (name[part.end] ?? "") : "",
            state.magicWords,
        ),
        kind: "magic-word",
        magicWord,
        modifiers: state.modifiers,
        separators,
    };
}

function isParserVariable(
    value: string,
    magicWords: TemplateMagicWordCatalog | null,
): boolean {
    return matchesAliases(value, magicWords?.variables);
}

function isParserFunction(
    value: string,
    separator: string,
    magicWords: TemplateMagicWordCatalog | null,
): boolean {
    return magicWords == null
        ? separator === ":" && value.startsWith("#")
        : matchesCallableAlias(value, separator, magicWords.functions) ||
              (value.startsWith("#") &&
                  matchesCallableAlias(
                      value.slice(1),
                      separator,
                      magicWords.functions,
                  )) ||
              isInvoke(value, separator, magicWords);
}

function isInvoke(
    value: string,
    separator: string,
    magicWords: TemplateMagicWordCatalog | null,
): boolean {
    return (
        value.startsWith("#") &&
        matchesCallableAlias(value.slice(1), separator, magicWords?.invoke)
    );
}

function isTemplateModifier(
    value: string,
    separator: string,
    kind: TemplateModifier,
    magicWords: TemplateMagicWordCatalog | null,
): boolean {
    return matchesCallableAlias(value, separator, magicWords?.modifiers[kind]);
}

function isModifierSeparator(value: string | undefined): boolean {
    return value === ":" || value === "：";
}

function matchesAliases(
    value: string,
    aliases: MagicWordAliases | undefined,
): boolean {
    return (
        aliases?.caseSensitive.has(value) === true ||
        aliases?.caseInsensitive.has(value.toLowerCase()) === true
    );
}

function matchesCallableAlias(
    value: string,
    separator: string,
    aliases: MagicWordAliases | undefined,
): boolean {
    return (
        matchesAliases(value + separator, aliases) ||
        (separator === ":" && matchesAliases(value, aliases))
    );
}

function readMagicWord(
    name: string,
    parts: TopLevelRange[],
    state: TemplateModifierState,
): MagicWordCandidate | null {
    const part = parts[state.partIndex];
    if (part == null) {
        return null;
    }
    const range = readHeadRange(name, part, state.allowLeadingWhitespace);
    if (range == null) {
        return null;
    }
    return {
        entered: name.slice(range.start, range.end),
        part,
        range,
    };
}

function readHeadRange(
    value: string,
    range: SourceRange,
    allowLeadingWhitespace: boolean,
): SourceRange | null {
    let { start } = range;
    if (allowLeadingWhitespace) {
        while (start < range.end && /\s/u.test(value[start] ?? "")) {
            start += 1;
        }
    }
    if (
        start === range.end ||
        /\s/u.test(value[start] ?? "") ||
        /\s/u.test(value[range.end - 1] ?? "")
    ) {
        return null;
    }
    return { end: range.end, start };
}

function splitMagicWordRanges(value: string): TopLevelRange[] {
    return wikitext(value)
        .splitRanges(":")
        .flatMap((asciiPart) =>
            wikitext(asciiPart.value)
                .splitRanges("：")
                .map((widePart) => ({
                    end: asciiPart.start + widePart.end,
                    start: asciiPart.start + widePart.start,
                    value: widePart.value,
                })),
        );
}

function trimRange(value: string, range: SourceRange): SourceRange {
    let { end, start } = range;
    while (start < end && /\s/u.test(value[start] ?? "")) {
        start += 1;
    }
    while (start < end && /\s/u.test(value[end - 1] ?? "")) {
        end -= 1;
    }
    return { end, start };
}
