/**
 * @file src/domain/editor-selection.ts
 * Purpose: Content-model policy for choosing the source editing surface.
 *
 * Table of contents:
 * 1. CodeMirrorMode
 * 2. SourceEditorSelection
 * 3. Constants and state
 * 4. selectSourceEditor
 * 5. normalizeCodeMirrorMode
 * 6. getContentModelMode
 */

export type CodeMirrorMode = "css" | "javascript" | "json" | "lua" | "vue";

export type SourceEditorSelection =
    | { editor: "codemirror"; mode: CodeMirrorMode | null }
    | { editor: "none" }
    | { editor: "wiked-lite" };

const CODE_MIRROR_MODES = new Set<CodeMirrorMode>([
    "css",
    "javascript",
    "json",
    "lua",
    "vue",
]);

/**
 * Selects one editor for an action and MediaWiki content model.
 */
export function selectSourceEditor(
    contentModel: string,
    action: string,
    configuredMode = "",
    useCodeMirrorForOtherModels = false,
): SourceEditorSelection {
    if (action !== "edit" && action !== "submit") {
        return { editor: "none" };
    }
    if (contentModel === "wikitext") {
        return { editor: "wiked-lite" };
    }
    if (!useCodeMirrorForOtherModels) {
        return { editor: "none" };
    }
    return {
        editor: "codemirror",
        mode:
            normalizeCodeMirrorMode(configuredMode) ??
            getContentModelMode(contentModel),
    };
}

function normalizeCodeMirrorMode(mode: string): CodeMirrorMode | null {
    const normalized = mode.toLocaleLowerCase() as CodeMirrorMode;
    return CODE_MIRROR_MODES.has(normalized) ? normalized : null;
}

function getContentModelMode(contentModel: string): CodeMirrorMode | null {
    const model = contentModel.toLocaleLowerCase();
    if (model === "scribunto" || model === "lua") {
        return "lua";
    }
    if (model === "css" || model === "sanitized-css") {
        return "css";
    }
    if (model === "javascript") {
        return "javascript";
    }
    if (
        model.includes("json") ||
        model === "gadgetdefinition" ||
        model === "map-data" ||
        model === "tabular-data"
    ) {
        return "json";
    }
    return model === "vue" ? "vue" : null;
}
