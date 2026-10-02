/**
 * @file src/features/editor/surface.ts
 * Purpose: Creates and styles the isolated editable surface.
 *
 * Table of contents:
 * 1. Imports
 * 2. EditorSurface
 * 3. Constants and state
 * 4. createEditorSurface
 * 5. loadFrameDocument
 * 6. EditorFrameLoader
 * 7. isEditorFrameAttached
 * 8. copyTextareaPresentation
 * 9. findOpaqueBackground
 * 10. getEditorLabel
 * 11. isIncompatibleEditor
 */

import { installWikEdLiteFrameStyles } from "./styles.ts";

export interface EditorSurface {
    editor: HTMLElement;
    frame: HTMLIFrameElement;
    overlay: HTMLElement;
}

const EDITOR_FRAME_SOURCE =
    '<!doctype html><html><head><meta charset="UTF-8">' +
    "</head><body></body></html>";
const EDITOR_FRAME_LOAD_TIMEOUT = 5_000;

export async function createEditorSurface(
    textarea: HTMLTextAreaElement,
): Promise<EditorSurface> {
    const frame = document.createElement("iframe");
    const label = getEditorLabel(textarea);
    frame.className = "wiked-editor-frame";
    frame.classList.add("wiked-lite-frame");
    frame.title = label;
    frame.setAttribute("aria-label", label);
    frame.style.height = `${Math.max(textarea.offsetHeight, 256)}px`;
    try {
        const target = await loadFrameDocument(frame, textarea);
        const editor = target.createElement("main");
        const overlay = target.createElement("div");
        target.documentElement.lang =
            textarea.lang || document.documentElement.lang;
        target.body.className = "wiked-lite-frame-document";
        editor.className = "wiked-lite-editor";
        editor.contentEditable = "plaintext-only";
        editor.role = "textbox";
        editor.ariaMultiLine = "true";
        editor.ariaLabel = label;
        editor.spellcheck = textarea.spellcheck;
        overlay.className = "wiked-lite-frame-overlay";
        target.body.replaceChildren(editor, overlay);
        installWikEdLiteFrameStyles(target);
        copyTextareaPresentation(textarea, frame, editor);
        return { editor, frame, overlay };
    } catch (error) {
        frame.remove();
        throw error;
    }
}

function loadFrameDocument(
    frame: HTMLIFrameElement,
    textarea: HTMLTextAreaElement,
): Promise<Document> {
    return new Promise(function load(resolve, reject) {
        new EditorFrameLoader(frame, textarea, resolve, reject).start();
    });
}

class EditorFrameLoader {
    private readonly frame: HTMLIFrameElement;
    private readonly observer: MutationObserver;
    private readonly reject: (reason: unknown) => void;
    private readonly resolve: (target: Document) => void;
    private settled = false;
    private readonly textarea: HTMLTextAreaElement;
    private timeout = 0;

    constructor(
        frame: HTMLIFrameElement,
        textarea: HTMLTextAreaElement,
        resolve: (target: Document) => void,
        reject: (reason: unknown) => void,
    ) {
        this.frame = frame;
        this.reject = reject;
        this.resolve = resolve;
        this.textarea = textarea;
        this.observer = new MutationObserver(() => this.validateAttachment());
    }

    start(): void {
        try {
            this.timeout = window.setTimeout(() => {
                this.fail(
                    new Error("wikEd Lite timed out loading its editor frame."),
                );
            }, EDITOR_FRAME_LOAD_TIMEOUT);
            this.frame.addEventListener("load", this.initialize, {
                once: true,
            });
            this.frame.addEventListener("error", this.failFrameLoad, {
                once: true,
            });
            this.observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
            this.frame.srcdoc = EDITOR_FRAME_SOURCE;
            this.textarea.before(this.frame);
        } catch (error) {
            this.fail(error);
        }
    }

    private readonly initialize = (): void => {
        if (!isEditorFrameAttached(this.frame, this.textarea)) {
            this.fail(new Error("The source editor moved while loading."));
            return;
        }
        const target = this.frame.contentDocument;
        if (target == null) {
            this.fail(
                new Error("wikEd Lite could not access its editor frame."),
            );
            return;
        }
        this.settled = true;
        this.cleanup();
        this.resolve(target);
    };

    private readonly failFrameLoad = (): void => {
        this.fail(new Error("wikEd Lite could not load its editor frame."));
    };

    private validateAttachment(): void {
        if (!isEditorFrameAttached(this.frame, this.textarea)) {
            this.fail(
                new Error("The source editor was removed while loading."),
            );
        }
    }

    private fail(reason: unknown): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        this.cleanup();
        this.reject(reason);
    }

    private cleanup(): void {
        window.clearTimeout(this.timeout);
        this.observer.disconnect();
        this.frame.removeEventListener("load", this.initialize);
        this.frame.removeEventListener("error", this.failFrameLoad);
    }
}

export function isEditorFrameAttached(
    frame: HTMLIFrameElement,
    textarea: HTMLTextAreaElement,
): boolean {
    return (
        frame.isConnected &&
        textarea.isConnected &&
        frame.parentNode === textarea.parentNode &&
        frame.nextSibling === textarea
    );
}

function copyTextareaPresentation(
    textarea: HTMLTextAreaElement,
    frame: HTMLIFrameElement,
    editor: HTMLElement,
): void {
    const style = window.getComputedStyle(textarea);
    const background = findOpaqueBackground(textarea, style);
    const direction = textarea.dir || style.direction;
    editor.dir = direction;
    editor.lang = frame.contentDocument?.documentElement.lang ?? "";
    editor.ownerDocument.documentElement.dir = direction;
    editor.ownerDocument.body.dir = direction;
    frame.style.border = style.border;
    frame.style.borderRadius = style.borderRadius;
    frame.style.resize = style.resize;
    frame.style.setProperty("--wiked-lite-background", background);
    frame.style.setProperty("--wiked-lite-foreground", style.color);
    editor.style.fontFamily = style.fontFamily;
    editor.style.fontSize = style.fontSize;
    editor.style.fontWeight = style.fontWeight;
    editor.style.letterSpacing = style.letterSpacing;
    editor.style.lineHeight = style.lineHeight;
    editor.style.padding = style.padding;
    editor.style.tabSize = style.tabSize;
    editor.style.setProperty("--wiked-lite-foreground", style.color);
    editor.style.setProperty(
        "--wiked-lite-caret",
        style.caretColor === "auto" ? style.color : style.caretColor,
    );
    editor.style.setProperty("--wiked-lite-background", background);
    editor.ownerDocument.body.style.setProperty(
        "--wiked-lite-background",
        background,
    );
}

function findOpaqueBackground(
    element: HTMLElement,
    computedStyle: CSSStyleDeclaration,
): string {
    let current: HTMLElement | null = element;
    let style = computedStyle;
    while (current != null) {
        const color = style.backgroundColor;
        if (
            color !== "" &&
            color !== "transparent" &&
            color !== "rgba(0, 0, 0, 0)"
        ) {
            return color;
        }
        current = current.parentElement;
        if (current != null) {
            style = window.getComputedStyle(current);
        }
    }
    return "rgb(255, 255, 255)";
}

function getEditorLabel(textarea: HTMLTextAreaElement): string {
    return (
        textarea.getAttribute("aria-label") ??
        textarea.labels?.[0]?.textContent?.trim() ??
        "Wikitext editor"
    );
}

export function isIncompatibleEditor(
    textarea: HTMLTextAreaElement,
    ignoreWikEdLiteClass = false,
): boolean {
    if (window.wikEd?.useWikEd === true) {
        return true;
    }
    const hadWikEdLiteClass =
        ignoreWikEdLiteClass &&
        textarea.classList.contains("wiked-lite-native");
    if (hadWikEdLiteClass) {
        textarea.classList.remove("wiked-lite-native");
    }
    try {
        const style = window.getComputedStyle(textarea);
        return style.display === "none" || style.visibility === "hidden";
    } finally {
        if (hadWikEdLiteClass) {
            textarea.classList.add("wiked-lite-native");
        }
    }
}
