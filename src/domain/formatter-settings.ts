/** Formatter choices shared by the dialog and storage adapter. */

import type {
    FirstParameterLayout,
    FormatterOptions,
    SubsequentParameterLayout,
} from "./formatter.ts";

export interface FormatterSettings {
    alternateReferenceColors: boolean;
    ctrlClickLinks: boolean;
    fullPageReferencePreviews: boolean;
    formatter: FormatterOptions;
    highlightMissing: boolean;
    largeFont: boolean;
    linkPreviews: boolean;
    referencePreviews: boolean;
    resolveRedirects: boolean;
    resolveTemplateRedirects: boolean;
    smallReferenceText: boolean;
    syntaxHighlighting: boolean;
    useCodeMirrorForOtherModels: boolean;
}

export type EditorFeatureSettings = Pick<
    FormatterSettings,
    | "alternateReferenceColors"
    | "ctrlClickLinks"
    | "fullPageReferencePreviews"
    | "highlightMissing"
    | "largeFont"
    | "linkPreviews"
    | "referencePreviews"
    | "smallReferenceText"
    | "syntaxHighlighting"
>;

/** Creates choices used when no saved configuration is valid. */
export function createDefaultFormatterSettings(): FormatterSettings {
    return {
        alternateReferenceColors: false,
        ctrlClickLinks: true,
        fullPageReferencePreviews: false,
        formatter: {
            characterWidthRatio: "5:3",
            firstParameterLayout: "align-values",
            formatFirstParameter: false,
            formatHtmlTags: false,
            formatSubsequentParameters: false,
            indentBlockTemplates: false,
            indentSpaces: 2,
            normalizeConversion: false,
            skipFirstLevelIndentation: false,
            subsequentParameterLayout: "align-names",
        },
        highlightMissing: false,
        largeFont: false,
        linkPreviews: false,
        referencePreviews: true,
        resolveRedirects: false,
        resolveTemplateRedirects: false,
        smallReferenceText: true,
        syntaxHighlighting: true,
        useCodeMirrorForOtherModels: false,
    };
}

/** Copies editor behaviors from a formatter configuration. */
export function getEditorFeatureSettings(
    settings: FormatterSettings,
): EditorFeatureSettings {
    return {
        alternateReferenceColors: settings.alternateReferenceColors,
        ctrlClickLinks: settings.ctrlClickLinks,
        fullPageReferencePreviews: settings.fullPageReferencePreviews,
        highlightMissing: settings.highlightMissing,
        largeFont: settings.largeFont,
        linkPreviews: settings.linkPreviews,
        referencePreviews: settings.referencePreviews,
        smallReferenceText: settings.smallReferenceText,
        syntaxHighlighting: settings.syntaxHighlighting,
    };
}

/** Replaces editor behaviors while preserving formatter choices. */
export function withEditorFeatureSettings(
    settings: FormatterSettings,
    features: EditorFeatureSettings,
): FormatterSettings {
    return { ...settings, ...features };
}

/** Validates and copies one persisted formatter configuration. */
export function parseFormatterSettings(
    value: unknown,
): FormatterSettings | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const formatter = parseFormatterOptions(value.formatter);
    const features = parseEditorFeatures(value);
    if (formatter == null || features == null) {
        return undefined;
    }
    return { ...features, formatter };
}

function parseFormatterOptions(value: unknown): FormatterOptions | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    if (
        !isCharacterWidthRatio(value.characterWidthRatio) ||
        !isFirstParameterLayout(value.firstParameterLayout) ||
        typeof value.formatFirstParameter !== "boolean" ||
        (value.formatHtmlTags !== undefined &&
            typeof value.formatHtmlTags !== "boolean") ||
        typeof value.formatSubsequentParameters !== "boolean" ||
        typeof value.indentBlockTemplates !== "boolean" ||
        !isIndentSpaces(value.indentSpaces) ||
        typeof value.normalizeConversion !== "boolean" ||
        typeof value.skipFirstLevelIndentation !== "boolean" ||
        !isSubsequentParameterLayout(value.subsequentParameterLayout)
    ) {
        return undefined;
    }
    return {
        characterWidthRatio: value.characterWidthRatio,
        firstParameterLayout: value.firstParameterLayout,
        formatFirstParameter: value.formatFirstParameter,
        formatHtmlTags: value.formatHtmlTags === true,
        formatSubsequentParameters: value.formatSubsequentParameters,
        indentBlockTemplates: value.indentBlockTemplates,
        indentSpaces: value.indentSpaces,
        normalizeConversion: value.normalizeConversion,
        skipFirstLevelIndentation: value.skipFirstLevelIndentation,
        subsequentParameterLayout: value.subsequentParameterLayout,
    };
}

function parseEditorFeatures(
    value: Record<string, unknown>,
): Omit<FormatterSettings, "formatter"> | undefined {
    if (
        (value.alternateReferenceColors !== undefined &&
            typeof value.alternateReferenceColors !== "boolean") ||
        (value.ctrlClickLinks !== undefined &&
            typeof value.ctrlClickLinks !== "boolean") ||
        typeof value.fullPageReferencePreviews !== "boolean" ||
        typeof value.highlightMissing !== "boolean" ||
        typeof value.largeFont !== "boolean" ||
        typeof value.linkPreviews !== "boolean" ||
        typeof value.referencePreviews !== "boolean" ||
        typeof value.resolveRedirects !== "boolean" ||
        typeof value.resolveTemplateRedirects !== "boolean" ||
        typeof value.smallReferenceText !== "boolean" ||
        (value.syntaxHighlighting !== undefined &&
            typeof value.syntaxHighlighting !== "boolean") ||
        (value.useCodeMirrorForOtherModels !== undefined &&
            typeof value.useCodeMirrorForOtherModels !== "boolean")
    ) {
        return undefined;
    }
    return {
        // Preserve choices saved before alternate reference colors existed.
        alternateReferenceColors: value.alternateReferenceColors === true,
        // Modified link clicks were enabled before this setting existed.
        ctrlClickLinks: value.ctrlClickLinks !== false,
        fullPageReferencePreviews: value.fullPageReferencePreviews,
        highlightMissing: value.highlightMissing,
        largeFont: value.largeFont,
        linkPreviews: value.linkPreviews,
        referencePreviews: value.referencePreviews,
        resolveRedirects: value.resolveRedirects,
        resolveTemplateRedirects: value.resolveTemplateRedirects,
        smallReferenceText: value.smallReferenceText,
        // Preserve configurations saved before the highlighting toggle existed.
        syntaxHighlighting: value.syntaxHighlighting !== false,
        // Older configurations did not request CodeMirror for other models.
        useCodeMirrorForOtherModels: value.useCodeMirrorForOtherModels === true,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value != null && !Array.isArray(value);
}

function isFirstParameterLayout(value: unknown): value is FirstParameterLayout {
    return value === "align-values" || value === "compact";
}

function isSubsequentParameterLayout(
    value: unknown,
): value is SubsequentParameterLayout {
    return (
        value === "align-names" ||
        value === "align-names-and-values" ||
        value === "compact"
    );
}

function isCharacterWidthRatio(value: unknown): value is "2:1" | "5:3" {
    return value === "2:1" || value === "5:3";
}

function isIndentSpaces(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
