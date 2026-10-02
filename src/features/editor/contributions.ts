/**
 * @file src/features/editor/contributions.ts
 * Purpose: Optional editor presentation, navigation, and asynchronous previews.
 *
 * Table of contents:
 * 1. Imports
 * 2. EditorContributions
 * 3. createEditorContributions
 * 4. siteMissingLinkColor
 */

import type { EditorServices } from "../../app/editor-contracts.ts";
import type { EditorFeatureSettings } from "../../domain/formatter-settings.ts";
import { normalizeWikitextTitleKey } from "../../domain/wiki-titles.ts";
import {
    createEditorFeatureController,
    type EditorFeatureController,
    type LinkCheckState,
    type MissingLinkResult,
} from "./feature-settings.ts";
import type { HighlightOptions } from "../../domain/highlighter.ts";
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
    replace: (start: number, end: number, value: string) => void,
    initialSettings: EditorFeatureSettings,
): EditorContributions {
    const { editor, overlay } = surface;
    const nativeFontSize = editor.style.fontSize || "0.875rem";
    let settings = initialSettings;
    let features: EditorFeatureController | null = null;
    let checkedTitles = new Set<string>();
    let missingTitles = new Set<string>();
    let pendingMetadataRender = false;
    let renderedSource: string | null = null;
    const navigation = attachModifiedLinkNavigation(
        editor,
        settings.syntaxHighlighting && settings.ctrlClickLinks,
    );
    const references = attachReferenceTooltips({
        delay: window.wikEdLiteConfig?.referenceTooltipDelay,
        editor,
        enabled: false,
        editingEnabled: settings.referenceEditing,
        lightweightEditing: settings.referenceLightweightEditing,
        getFallbackSource: () => features?.getReferenceFallbackSource() ?? null,
        getHighlightOptions,
        getLinkCheckState,
        getSource: () => textarea.value,
        onEditingEnd() {
            if (pendingMetadataRender) {
                pendingMetadataRender = false;
                invalidate();
            }
        },
        overlay,
        replace,
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
                // A background result must not remove an in-progress field draft.
                if (references.isEditing()) {
                    pendingMetadataRender = true;
                } else {
                    invalidate();
                }
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

    function getHighlightOptions(): HighlightOptions {
        return {
            ...services.getHighlightOptions(),
            alternateReferenceColors: settings.alternateReferenceColors,
        };
    }

    function getLinkCheckState(): LinkCheckState {
        return {
            checkedTitles,
            enabled: settings.syntaxHighlighting && settings.highlightMissing,
            missingTitles,
        };
    }

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
            if (references.isEditing() && renderedSource === textarea.value) {
                pendingMetadataRender = true;
                return;
            }
            pendingMetadataRender = false;
            references.beforeRender(renderedSource === textarea.value);
            pages.dismiss();
            renderSegments(
                editor,
                textarea.value,
                getLinkCheckState(),
                getHighlightOptions(),
                settings.syntaxHighlighting,
            );
            renderedSource = textarea.value;
            references.refresh();
            pages.refresh();
        },
        setSettings(next) {
            settings = { ...next };
            references.setEditingEnabled(settings.referenceEditing);
            references.setLightweightEditing(
                settings.referenceLightweightEditing,
            );
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
            references.sourceChanged();
            pages.dismiss();
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
