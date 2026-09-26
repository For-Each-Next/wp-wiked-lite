/** Optional editor presentation, navigation, and asynchronous previews. */

import type { EditorServices } from "../../app/editor-contracts.ts";
import {
    getEditorFeatureSettings,
    type EditorFeatureSettings,
} from "../../domain/formatter-settings.ts";
import { normalizeWikitextTitleKey } from "../../domain/wiki-titles.ts";
import {
    createEditorFeatureController,
    type EditorFeatureController,
    type MissingLinkResult,
} from "./feature-settings.ts";
import { attachModifiedLinkNavigation } from "./links.ts";
import { attachPagePreviews } from "./page-preview.ts";
import { attachReferenceTooltips } from "./reference-tooltip.ts";
import { renderSegments } from "./renderer.ts";
import type { EditorSurface } from "./surface.ts";

export interface EditorContributions {
    clearCache(): void;
    destroy(): void;
    dismiss(): void;
    getSettings(): EditorFeatureSettings;
    render(): void;
    setSettings(settings: EditorFeatureSettings): void;
    sourceChanged(): void;
}

/** The editing controller depends on this lifecycle, not individual features. */
export function createEditorContributions(
    textarea: HTMLTextAreaElement,
    surface: EditorSurface,
    services: EditorServices,
    invalidate: () => void,
): EditorContributions {
    const { editor, overlay } = surface;
    const nativeFontSize = editor.style.fontSize || "0.875rem";
    const initialSettings = getEditorFeatureSettings(
        services.loadFormatterSettings(),
    );
    let settings = initialSettings;
    let features: EditorFeatureController | null = null;
    let checkedTitles = new Set<string>();
    let missingTitles = new Set<string>();
    const navigation = attachModifiedLinkNavigation(
        editor,
        settings.syntaxHighlighting && settings.ctrlClickLinks,
    );
    const references = attachReferenceTooltips({
        delay: window.wikEdLiteConfig?.referenceTooltipDelay,
        editor,
        enabled: false,
        getFallbackSource: () => features?.getReferenceFallbackSource() ?? null,
        getHighlightOptions: () => ({
            ...services.getHighlightOptions(),
            alternateReferenceColors: settings.alternateReferenceColors,
        }),
        getSource: () => textarea.value,
        overlay,
    });
    const pages = attachPagePreviews({
        delay: window.wikEdLiteConfig?.pagePreviewDelay,
        editor,
        enabled: settings.syntaxHighlighting && settings.linkPreviews,
        load: services.loadPageSummary,
        overlay,
    });
    try {
        features = createEditorFeatureController({
            findMissingLinks: services.findMissingLinks,
            getSource: () => textarea.value,
            initialSettings,
            loadPageSource: services.loadPageSource,
            onError(error, operation) {
                services.logger.warn(`feature.${operation}.failed`, { error });
            },
            onLargeFont(large) {
                editor.classList.toggle("wiked-lite-editor--large-font", large);
                editor.style.fontSize = large
                    ? `calc(${nativeFontSize} * 1.2)`
                    : nativeFontSize;
            },
            onMissingLinks(result: MissingLinkResult) {
                checkedTitles = new Set(
                    [...result.checkedTitles].map(normalizeWikitextTitleKey),
                );
                missingTitles = new Set(
                    [...result.missingTitles].map(normalizeWikitextTitleKey),
                );
                if (result.linkClasses.length > 0) {
                    editor.style.setProperty(
                        "--wiked-lite-missing-link",
                        siteMissingLinkColor(result.linkClasses),
                    );
                }
                invalidate();
            },
            onReferencePreviews: references.setEnabled,
            onSmallReferenceText(enabled) {
                editor.classList.toggle(
                    "wiked-lite-editor--small-reference-text",
                    enabled,
                );
            },
            sectionEditing: services.isSectionEditing(),
        });
    } catch (error) {
        navigation.destroy();
        references.destroy();
        pages.destroy();
        throw error;
    }
    const coordinator = features;

    function dismiss(): void {
        references.dismiss();
        pages.dismiss();
    }

    return {
        clearCache() {
            references.dismiss();
            pages.clearCache();
            coordinator.clearCache();
        },
        destroy() {
            coordinator.destroy();
            navigation.destroy();
            references.destroy();
            pages.destroy();
        },
        dismiss,
        getSettings: () => coordinator.getSettings(),
        render() {
            dismiss();
            renderSegments(
                editor,
                textarea.value,
                {
                    checkedTitles,
                    enabled:
                        settings.syntaxHighlighting &&
                        settings.highlightMissing,
                    missingTitles,
                },
                {
                    ...services.getHighlightOptions(),
                    alternateReferenceColors: settings.alternateReferenceColors,
                },
                settings.syntaxHighlighting,
            );
            pages.refresh();
        },
        setSettings(next) {
            settings = { ...next };
            coordinator.setSettings(settings);
            navigation.setEnabled(
                settings.syntaxHighlighting && settings.ctrlClickLinks,
            );
            pages.setEnabled(
                settings.syntaxHighlighting && settings.linkPreviews,
            );
            invalidate();
        },
        sourceChanged() {
            dismiss();
            coordinator.sourceChanged();
        },
    };
}

function siteMissingLinkColor(linkClasses: string[]): string {
    const host =
        document.querySelector(".mw-parser-output") ??
        document.querySelector("#mw-content-text") ??
        document.body;
    if (host == null) {
        return "";
    }
    const probe = document.createElement("a");
    const classes = new Set(
        linkClasses.map((name) => String(name).trim()).filter(Boolean),
    );
    classes.add("new");
    probe.className = [...classes].join(" ");
    probe.href = "#";
    probe.textContent = "wikEd";
    probe.ariaHidden = "true";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    host.append(probe);
    const color = window.getComputedStyle(probe).color;
    probe.remove();
    return color;
}
