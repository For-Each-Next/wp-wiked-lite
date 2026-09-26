/** Live editor behaviors controlled by persisted formatter settings. */

import { normalizeWikitextTitleKey } from "../../domain/wiki-titles.ts";
import type { EditorFeatureSettings } from "../../domain/formatter-settings.ts";

export interface MissingLinkResult {
    checkedTitles: Set<string>;
    linkClasses: string[];
    missingTitles: Set<string>;
}

export interface LinkCheckState {
    checkedTitles: ReadonlySet<string>;
    enabled: boolean;
    missingTitles: ReadonlySet<string>;
}

export type LinkCheckStatus = "checked" | "disabled" | "missing" | "unchecked";

export interface EditorFeatureController {
    clearCache(): void;
    destroy(): void;

    getReferenceFallbackSource(): string | null;

    getSettings(): EditorFeatureSettings;

    setSettings(settings: EditorFeatureSettings): void;

    sourceChanged(): void;
}

export interface EditorFeatureOptions {
    delay?: number;
    initialSettings: EditorFeatureSettings;
    sectionEditing: boolean;
    timer?: EditorFeatureTimer;

    findMissingLinks(source: string): Promise<MissingLinkResult>;

    getSource(): string;

    loadPageSource(): Promise<string>;

    onError(error: unknown, operation: "links" | "page-source"): void;

    onLargeFont(enabled: boolean): void;

    onMissingLinks(result: MissingLinkResult): void;

    onReferencePreviews(enabled: boolean): void;

    onSmallReferenceText(enabled: boolean): void;
}

export interface EditorFeatureTimer {
    clear(handle: number): void;

    set(callback: () => void, delay: number): number;
}

const DEFAULT_LOOKUP_DELAY = 500;

/** Coordinates optional network-backed editor features. */
export function createEditorFeatureController(
    options: EditorFeatureOptions,
): EditorFeatureController {
    return new EditorFeatureCoordinator(options);
}

/** Classifies one link against the most recently accepted lookup. */
export function classifyLinkCheck(
    title: string,
    state: LinkCheckState,
): LinkCheckStatus {
    if (!state.enabled) {
        return "disabled";
    }
    const key = normalizeWikitextTitleKey(title);
    if (state.missingTitles.has(key)) {
        return "missing";
    }
    return state.checkedTitles.has(key) ? "checked" : "unchecked";
}

class EditorFeatureCoordinator implements EditorFeatureController {
    private destroyed = false;
    private lookupGeneration = 0;
    private lookupTimer = 0;
    private readonly options: EditorFeatureOptions;
    private pageSource: string | null = null;
    private pageSourceRequest: Promise<void> | null = null;
    private pageSourceGeneration = 0;
    private settings: EditorFeatureSettings;
    private readonly timer: EditorFeatureTimer;

    constructor(options: EditorFeatureOptions) {
        this.options = options;
        this.timer = options.timer ?? createWindowTimer();
        this.settings = { ...options.initialSettings };
        options.onLargeFont(this.settings.largeFont);
        options.onReferencePreviews(
            this.settings.syntaxHighlighting && this.settings.referencePreviews,
        );
        options.onSmallReferenceText(this.settings.smallReferenceText);
        if (
            this.settings.syntaxHighlighting &&
            this.settings.highlightMissing
        ) {
            this.scheduleLookup(0);
        }
        this.requestPageSource();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelLookup();
    }

    clearCache(): void {
        if (this.destroyed) {
            return;
        }
        this.cancelLookup();
        this.pageSourceGeneration += 1;
        this.pageSource = null;
        this.pageSourceRequest = null;
        this.options.onMissingLinks(createEmptyMissingLinkResult());
        if (
            this.settings.syntaxHighlighting &&
            this.settings.highlightMissing
        ) {
            this.scheduleLookup(0);
        }
        this.requestPageSource();
    }

    getReferenceFallbackSource(): string | null {
        return this.settings.syntaxHighlighting &&
            this.settings.referencePreviews &&
            this.settings.fullPageReferencePreviews
            ? this.pageSource
            : null;
    }

    getSettings(): EditorFeatureSettings {
        return { ...this.settings };
    }

    setSettings(next: EditorFeatureSettings): void {
        if (this.destroyed) {
            return;
        }
        const previous = this.settings;
        this.settings = { ...next };
        if (previous.largeFont !== this.settings.largeFont) {
            this.options.onLargeFont(this.settings.largeFont);
        }
        const previewsEnabled =
            this.settings.syntaxHighlighting && this.settings.referencePreviews;
        if (
            (previous.syntaxHighlighting && previous.referencePreviews) !==
            previewsEnabled
        ) {
            this.options.onReferencePreviews(previewsEnabled);
        }
        if (previous.smallReferenceText !== this.settings.smallReferenceText) {
            this.options.onSmallReferenceText(this.settings.smallReferenceText);
        }
        this.updateMissingLinkSetting(
            previous.syntaxHighlighting && previous.highlightMissing,
        );
        if (
            this.settings.syntaxHighlighting &&
            this.settings.referencePreviews &&
            this.settings.fullPageReferencePreviews &&
            (!previous.syntaxHighlighting ||
                !previous.referencePreviews ||
                !previous.fullPageReferencePreviews)
        ) {
            this.requestPageSource();
        }
    }

    sourceChanged(): void {
        if (
            !this.destroyed &&
            this.settings.syntaxHighlighting &&
            this.settings.highlightMissing
        ) {
            this.scheduleLookup(this.options.delay ?? DEFAULT_LOOKUP_DELAY);
        }
    }

    private cancelLookup(): void {
        this.lookupGeneration += 1;
        this.timer.clear(this.lookupTimer);
        this.lookupTimer = 0;
    }

    private isCurrentLookup(source: string, generation: number): boolean {
        return (
            !this.destroyed &&
            this.settings.syntaxHighlighting &&
            this.settings.highlightMissing &&
            generation === this.lookupGeneration &&
            source === this.options.getSource()
        );
    }

    private requestPageSource(): void {
        if (!this.shouldRequestPageSource()) {
            return;
        }
        const generation = this.pageSourceGeneration;
        this.pageSourceRequest = this.options
            .loadPageSource()
            .then((source) => {
                if (
                    !this.destroyed &&
                    generation === this.pageSourceGeneration
                ) {
                    this.pageSource = source;
                }
            })
            .catch((error) => {
                if (generation === this.pageSourceGeneration) {
                    this.reportPageSourceError(error);
                }
            })
            .finally(() => {
                if (generation === this.pageSourceGeneration) {
                    this.pageSourceRequest = null;
                }
            });
    }

    private runLookup(source: string, generation: number): void {
        void this.options.findMissingLinks(source).then(
            (result) => this.acceptLookup(source, generation, result),
            (error: unknown) =>
                this.reportLookupError(source, generation, error),
        );
    }

    private scheduleLookup(delay: number): void {
        this.cancelLookup();
        const generation = this.lookupGeneration;
        const source = this.options.getSource();
        this.lookupTimer = this.timer.set(() => {
            this.lookupTimer = 0;
            this.runLookup(source, generation);
        }, delay);
    }

    private shouldRequestPageSource(): boolean {
        return (
            !this.destroyed &&
            this.settings.syntaxHighlighting &&
            this.settings.referencePreviews &&
            this.settings.fullPageReferencePreviews &&
            this.options.sectionEditing &&
            this.pageSource == null &&
            this.pageSourceRequest == null
        );
    }

    private acceptLookup(
        source: string,
        generation: number,
        result: MissingLinkResult,
    ): void {
        if (this.isCurrentLookup(source, generation)) {
            this.options.onMissingLinks(result);
        }
    }

    private reportLookupError(
        source: string,
        generation: number,
        error: unknown,
    ): void {
        if (this.isCurrentLookup(source, generation)) {
            this.options.onError(error, "links");
        }
    }

    private reportPageSourceError(error: unknown): void {
        if (
            !this.destroyed &&
            this.settings.syntaxHighlighting &&
            this.settings.referencePreviews &&
            this.settings.fullPageReferencePreviews
        ) {
            this.options.onError(error, "page-source");
        }
    }

    private updateMissingLinkSetting(wasEnabled: boolean): void {
        const enabled =
            this.settings.syntaxHighlighting && this.settings.highlightMissing;
        if (!enabled && wasEnabled) {
            this.cancelLookup();
            this.options.onMissingLinks(createEmptyMissingLinkResult());
        } else if (enabled && !wasEnabled) {
            this.options.onMissingLinks(createEmptyMissingLinkResult());
            this.scheduleLookup(0);
        }
    }
}

function createEmptyMissingLinkResult(): MissingLinkResult {
    return {
        checkedTitles: new Set(),
        linkClasses: [],
        missingTitles: new Set(),
    };
}

function createWindowTimer(): EditorFeatureTimer {
    return {
        clear: (handle) => window.clearTimeout(handle),
        set: (callback, delay) => window.setTimeout(callback, delay),
    };
}
