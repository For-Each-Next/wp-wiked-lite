/**
 * @file src/features/editor/controller.ts
 * Purpose: Owns editing, native-source synchronization, history, and teardown.
 *
 * Table of contents:
 * 1. Imports
 * 2. createEditorController
 * 3. EditorController
 */

import { dispatchNativeInput } from "../../platform/browser/events.ts";
import { registerEditBoxBackend } from "./edit-box-backend.ts";
import type { EditorServices } from "../../app/editor-contracts.ts";
import type { EditorFeatureSettings } from "../../domain/formatter-settings.ts";
import {
    createEditorContributions,
    type EditorContributions,
} from "./contributions.ts";
import {
    createEditorSnapshot,
    getSelectionOffsets,
    readEditableText,
    restoreAttribute,
    setSelectionOffsets,
} from "./dom.ts";
import {
    EditorHistory,
    type EditorSnapshot,
    getHistoryDirection,
} from "./history.ts";
import {
    createCompositionSubmitHandler,
    restoreNativeSelectionAndFocus,
} from "./lifecycle.ts";
import {
    createEditorSurface,
    type EditorSurface,
    isEditorFrameAttached,
    isIncompatibleEditor,
} from "./surface.ts";

/** Creates a controller only after its isolated document is ready. */
export async function createEditorController(
    textarea: HTMLTextAreaElement,
    services: EditorServices,
    onDestroy: (controller: EditorController) => void,
    initialSettings: EditorFeatureSettings,
): Promise<EditorController> {
    const surface = await createEditorSurface(textarea);
    try {
        return new EditorController(
            textarea,
            surface,
            services,
            onDestroy,
            initialSettings,
        );
    } catch (error) {
        surface.frame.remove();
        throw error;
    }
}

export class EditorController {
    private readonly textarea: HTMLTextAreaElement;
    private readonly surface: EditorSurface;
    private readonly contributions: EditorContributions;
    private readonly history: EditorHistory;
    private readonly listeners = new AbortController();
    private readonly observer: MutationObserver;
    private readonly onDestroy: (controller: EditorController) => void;
    private readonly flushComposition: () => void;
    private readonly nativeAriaHidden: string | null;
    private readonly nativeTabIndex: string | null;
    private readonly hadNativeClass: boolean;
    private composing = false;
    private rendering = false;
    private applyingHistory = false;
    private dispatchingInput = false;
    private destroyed = false;
    private timer = 0;
    private unregisterBackend: (() => void) | undefined;

    constructor(
        textarea: HTMLTextAreaElement,
        surface: EditorSurface,
        services: EditorServices,
        onDestroy: (controller: EditorController) => void,
        initialSettings: EditorFeatureSettings,
    ) {
        this.textarea = textarea;
        this.surface = surface;
        this.onDestroy = onDestroy;
        this.nativeAriaHidden = textarea.getAttribute("aria-hidden");
        this.nativeTabIndex = textarea.getAttribute("tabindex");
        this.hadNativeClass = textarea.classList.contains("wiked-lite-native");
        this.history = new EditorHistory(this.nativeSnapshot());
        this.contributions = createEditorContributions(
            textarea,
            surface,
            services,
            () => this.refresh(),
            (start, end, value) => this.replace(start, end, value),
            initialSettings,
        );
        this.flushComposition = createCompositionSubmitHandler({
            dispatchInput: () => this.dispatchInput(),
            isComposing: () => this.composing,
            readEditorSnapshot: () =>
                createEditorSnapshot(
                    surface.editor,
                    readEditableText(surface.editor),
                ),
            recordSnapshot: (snapshot) => this.history.record(snapshot),
            writeNativeSource(source) {
                textarea.value = source;
            },
        });
        this.observer = new MutationObserver(() => {
            if (!this.isAttached()) {
                this.destroy();
            }
        });
        try {
            this.attach();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    clearCache(): void {
        this.contributions.clearCache();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }
        const { editor, frame } = this.surface;
        const focusedSelection =
            editor.ownerDocument.activeElement === editor ||
            this.surface.overlay.contains(editor.ownerDocument.activeElement)
                ? this.getSelection()
                : null;
        this.destroyed = true;
        this.unregisterBackend?.();
        this.cancelRender();
        this.listeners.abort();
        this.observer.disconnect();
        try {
            this.flushComposition();
        } finally {
            try {
                this.contributions.destroy();
            } finally {
                restoreAttribute(
                    this.textarea,
                    "aria-hidden",
                    this.nativeAriaHidden,
                );
                restoreAttribute(
                    this.textarea,
                    "tabindex",
                    this.nativeTabIndex,
                );
                if (!this.hadNativeClass) {
                    this.textarea.classList.remove("wiked-lite-native");
                }
                frame.remove();
                this.onDestroy(this);
                restoreNativeSelectionAndFocus(
                    {
                        focus: () =>
                            this.textarea.focus({ preventScroll: true }),
                        isAvailable: () =>
                            this.textarea.isConnected &&
                            !isIncompatibleEditor(this.textarea),
                        setSelection: (start, end) =>
                            this.textarea.setSelectionRange(start, end),
                    },
                    focusedSelection,
                );
            }
        }
    }

    getFeatureSettings(): EditorFeatureSettings {
        return this.contributions.getSettings();
    }

    getSelection(): { end: number; start: number } {
        return getSelectionOffsets(this.surface.editor);
    }

    isAttached(): boolean {
        return (
            !this.destroyed &&
            isEditorFrameAttached(this.surface.frame, this.textarea)
        );
    }

    refresh(): void {
        this.cancelRender();
        if (!this.composing && !this.destroyed) {
            this.timer = window.setTimeout(
                () => this.render(),
                window.wikEdLiteConfig?.highlightDelay ?? 100,
            );
        }
    }

    replace(start: number, end: number, value: string, collapse = false): void {
        this.assertWritable();
        this.preserveSelection();
        this.textarea.setRangeText(
            value,
            start,
            end,
            collapse ? "end" : "select",
        );
        this.history.record(this.nativeSnapshot());
        this.dispatchInput();
        this.render(false);
        this.surface.editor.focus({ preventScroll: true });
    }

    setFeatureSettings(settings: EditorFeatureSettings): void {
        this.contributions.setSettings(settings);
    }

    private attach(): void {
        const { editor, frame } = this.surface;
        const hadNativeFocus = document.activeElement === this.textarea;
        const options = { signal: this.listeners.signal };
        editor.addEventListener(
            "beforeinput",
            () => this.preserveSelection(),
            options,
        );
        editor.addEventListener("input", () => this.synchronize(), options);
        editor.addEventListener(
            "compositionstart",
            () => {
                this.cancelRender();
                this.contributions.dismiss();
                this.preserveSelection();
                this.composing = true;
            },
            options,
        );
        editor.addEventListener(
            "compositionend",
            () => {
                this.composing = false;
                this.synchronize();
            },
            options,
        );
        editor.addEventListener(
            "keydown",
            (event) => this.handleHistoryShortcut(event),
            options,
        );
        this.textarea.addEventListener(
            "input",
            () => this.updateFromNative(),
            options,
        );
        this.textarea.form?.addEventListener("submit", this.flushComposition, {
            ...options,
            capture: true,
        });
        this.render(false);
        frame.dataset.wikedReady = "true";
        if (hadNativeFocus) {
            editor.focus({ preventScroll: true });
        }
        this.textarea.classList.add("wiked-lite-native");
        this.textarea.setAttribute("aria-hidden", "true");
        this.textarea.setAttribute("tabindex", "-1");
        this.unregisterBackend = registerEditBoxBackend(this.textarea, {
            focus: () => editor.focus({ preventScroll: true }),
            read: () => this.textarea.value,
            replaceSelection: (text) => {
                const { start, end } = this.getSelection();
                this.replace(start, end, text, true);
            },
            write: (text) => this.writeFromTool(text, false),
            writePreservingPosition: (text) => this.writeFromTool(text, true),
        });
        this.observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    private writeFromTool(text: string, preservePosition: boolean): void {
        this.assertWritable();
        this.preserveSelection();
        const editor = this.surface.editor;
        const left = editor.scrollLeft;
        const top = editor.scrollTop;
        const selection = preservePosition
            ? this.getSelection()
            : { start: text.length, end: text.length };
        this.textarea.value = text;
        this.textarea.setSelectionRange(
            Math.min(selection.start, text.length),
            Math.min(selection.end, text.length),
        );
        this.history.record(this.nativeSnapshot());
        this.dispatchInput();
        this.contributions.sourceChanged();
        this.render(false);
        if (preservePosition) {
            editor.scrollLeft = left;
            editor.scrollTop = top;
        }
    }

    private assertWritable(): void {
        if (this.destroyed) {
            throw new Error("The source editor has been closed.");
        }
        if (this.composing) {
            throw new Error(
                "Finish composing text before applying an editor action.",
            );
        }
    }

    private cancelRender(): void {
        window.clearTimeout(this.timer);
        this.timer = 0;
    }

    private render(preserveSelection = true): void {
        this.cancelRender();
        if (this.composing || this.destroyed) {
            return;
        }
        const selection = preserveSelection
            ? this.getSelection()
            : this.nativeSnapshot();
        this.rendering = true;
        try {
            this.contributions.render();
            setSelectionOffsets(
                this.surface.editor,
                selection.start,
                selection.end,
            );
        } finally {
            this.rendering = false;
        }
    }

    private preserveSelection(): void {
        if (!this.rendering && !this.composing && !this.applyingHistory) {
            const { start, end } = this.getSelection();
            this.history.setSelection(start, end);
        }
    }

    private synchronize(): void {
        if (this.rendering || this.destroyed) {
            return;
        }
        this.contributions.dismiss();
        // Keep form submission current even between IME composition updates.
        this.textarea.value = readEditableText(this.surface.editor);
        if (this.composing) {
            return;
        }
        this.history.record(
            createEditorSnapshot(this.surface.editor, this.textarea.value),
        );
        this.dispatchInput();
        this.refresh();
    }

    private updateFromNative(): void {
        if (this.rendering || this.applyingHistory || this.destroyed) {
            return;
        }
        if (!this.dispatchingInput) {
            this.history.record(this.nativeSnapshot());
        }
        if (this.composing) {
            this.contributions.dismiss();
        } else {
            this.contributions.sourceChanged();
            this.refresh();
        }
    }

    private dispatchInput(): void {
        this.dispatchingInput = true;
        try {
            dispatchNativeInput(this.textarea);
        } finally {
            this.dispatchingInput = false;
        }
    }

    private handleHistoryShortcut(event: KeyboardEvent): void {
        const direction = getHistoryDirection(event);
        if (
            direction == null ||
            event.isComposing ||
            this.composing ||
            this.surface.editor.ownerDocument.activeElement !==
                this.surface.editor
        ) {
            return;
        }
        const snapshot =
            direction === "undo" ? this.history.undo() : this.history.redo();
        if (snapshot == null) {
            return;
        }
        event.preventDefault();
        this.applyingHistory = true;
        try {
            this.textarea.value = snapshot.source;
            this.textarea.setSelectionRange(snapshot.start, snapshot.end);
            this.dispatchInput();
            this.contributions.sourceChanged();
            this.render(false);
            this.surface.editor.focus({ preventScroll: true });
        } finally {
            this.applyingHistory = false;
        }
    }

    private nativeSnapshot(): EditorSnapshot {
        return {
            source: this.textarea.value,
            start: this.textarea.selectionStart,
            end: this.textarea.selectionEnd,
        };
    }
}
