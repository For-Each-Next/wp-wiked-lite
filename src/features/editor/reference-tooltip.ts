/**
 * @file src/features/editor/reference-tooltip.ts
 * Purpose: Interactive citation previews for the isolated editor surface.
 *
 * Table of contents:
 * 1. Imports
 * 2. ReferenceTooltipController
 * 3. ReferenceTooltipOptions
 * 4. ReferenceIconName
 * 5. ReferenceValuePresentation
 * 6. ReferenceFieldKind
 * 7. TooltipEditing
 * 8. Constants and state
 * 9. attachReferenceTooltips
 * 10. applyPlacement
 * 11. applyTooltipBridge
 * 12. applyPlacementSide
 * 13. createTooltip
 * 14. readReferenceInput
 * 15. referenceEditLabel
 * 16. referenceEditUnavailable
 * 17. setInlineSource
 * 18. readInlineSource
 * 19. createTooltipDetails
 * 20. createTooltipNote
 * 21. copyTooltipPresentation
 * 22. createTooltipRow
 * 23. createTooltipTitle
 * 24. createCitationTitle
 * 25. findReferenceAnchor
 * 26. isPagePreviewTarget
 * 27. sameReference
 * 28. normalizeDelay
 * 29. getDocumentView
 * 30. isVisibleRect
 * 31. clamp
 * 32. createReferenceIcon
 * 33. appendReferenceValue
 * 34. createReferenceSourceLink
 */

import {
    buildReferenceFieldInsertion,
    buildReferenceFieldReplacement,
    buildReferenceFieldUpdate,
    buildReferencePreview,
    type ReferenceEditRange,
    type ReferencePreview,
    type ReferencePreviewField,
    type ReferenceReplacement,
} from "../../domain/reference-preview.ts";
import type { SourceRange } from "../../domain/wikitext/index.ts";
import {
    ReferenceChangeTracker,
    type ReferenceChangeTarget,
    type ReferenceFieldChange,
} from "../../domain/reference-changes.ts";
import type { NamespaceSource } from "../../domain/wiki-titles.ts";
import type { HighlightOptions } from "../../domain/highlighter.ts";
import { msg } from "../../i18n/index.ts";
import { eventElement, readEditableText, setSelectionOffsets } from "./dom.ts";
import { handleSourceLinkClick } from "./links.ts";
import type { LinkCheckState } from "./feature-settings.ts";
import { createHighlightedFragment } from "./renderer.ts";
import {
    calculatePreviewPlacement,
    PREVIEW_ANCHOR_GAP,
    type PreviewPlacement,
    type PreviewRect,
    selectPreviewRect,
} from "./preview-position.ts";

export interface ReferenceTooltipController {
    beforeRender(preserve?: boolean): void;

    destroy(): void;

    dismiss(): void;

    isEditing(): boolean;

    refresh(): void;

    setEnabled(enabled: boolean): void;

    setEditingEnabled(enabled: boolean): void;

    setLightweightEditing(enabled: boolean): void;

    sourceChanged(): void;
}

export interface ReferenceTooltipOptions {
    delay?: number;
    editor: HTMLElement;
    enabled?: boolean;
    editingEnabled?: boolean;
    lightweightEditing?: boolean;
    overlay: HTMLElement;

    getFallbackSource?(): string | null;

    getHighlightOptions(): HighlightOptions;

    getLinkCheckState?(): LinkCheckState;

    getSource(): string;

    onEditingEnd?(): void;

    replace(start: number, end: number, value: string): void;
}

type ReferenceIconName = keyof typeof __WIKED_LITE_REFERENCE_ICONS__;

interface ReferenceValuePresentation {
    highlight: HighlightOptions;
    links: LinkCheckState;
}

type ReferenceFieldKind = "field" | "details" | "note";

interface TooltipEditing {
    lightweight: boolean;
    inline(
        element: HTMLElement,
        name: string,
        value: string,
        range?: ReferenceEditRange,
        kind?: ReferenceFieldKind,
        key?: HTMLElement,
    ): HTMLButtonElement;
    control(
        name: string,
        value: string,
        range?: ReferenceEditRange,
        remote?: boolean,
        kind?: ReferenceFieldKind,
    ): HTMLButtonElement;
    add(
        field?: ReferencePreviewField,
        placement?: "first" | "after",
    ): HTMLButtonElement;
    getChange(range?: SourceRange): ReferenceFieldChange | null;
}

const DEFAULT_DELAY = 700;
const HOVER_RESET_DISTANCE = 4;
const HIDE_DELAY = 200;
const REMOVE_DELAY = 200;

// Official Codex light-mode values are fallbacks for hosts without skin tokens.
// https://doc.wikimedia.org/codex/latest/design-tokens/color.html
const CODEX_COLORS = {
    "color-base": "#202122",
    "color-base--hover": "#404244",
    "color-emphasized": "#101418",
    "color-subtle": "#54595d",
    "color-disabled": "#a2a9b1",
    "color-warning": "#886425",
    "color-error": "#bf3c2c",
    "color-link": "#36c",
    "color-link--hover": "#3056a9",
    "color-link--active": "#233566",
    "background-color-base": "#fff",
    "background-color-transparent": "transparent",
    "background-color-button-quiet--hover": "rgba(0, 24, 73, 0.027)",
    "background-color-button-quiet--active": "rgba(0, 24, 73, 0.082)",
    "background-color-interactive-subtle": "#f8f9fa",
    "background-color-interactive-subtle--hover": "#eaecf0",
    "background-color-interactive-subtle--active": "#dadde3",
    "background-color-progressive-subtle": "#e8eeff",
    "border-color-base": "#a2a9b1",
    "border-color-muted": "#dadde3",
    "border-color-progressive": "#36c",
    "border-color-progressive--focus": "#36c",
    "box-shadow-color-alpha-base": "rgba(0, 0, 0, 0.06)",
};

/** Attaches one MediaWiki-style reference preview controller. */

export function attachReferenceTooltips(
    options: ReferenceTooltipOptions,
): ReferenceTooltipController {
    const { editor, overlay } = options;
    const view = getDocumentView(editor.ownerDocument);
    const changes = new ReferenceChangeTracker();
    let candidate: HTMLElement | null = null;
    let popup: HTMLElement | null = null;
    let editForm: HTMLElement | null = null;
    let cancelInline: ((notify?: boolean) => void) | null = null;
    let pendingRefresh: {
        source: string;
        referenceStart: number;
        focus: boolean;
    } | null = null;
    let pointerX: number | undefined;
    let pointerY: number | undefined;
    let generation = 0;
    let showTimer = 0;
    let hideTimer = 0;
    let removeTimer = 0;
    let pendingPoint: { x: number; y: number } | null = null;
    let enabled = options.enabled ?? true;
    let editingEnabled = options.editingEnabled ?? true;
    let lightweightEditing = options.lightweightEditing ?? false;

    function clearTimers(): void {
        view.clearTimeout(showTimer);
        view.clearTimeout(hideTimer);
        view.clearTimeout(removeTimer);
        showTimer = 0;
        hideTimer = 0;
        removeTimer = 0;
    }

    function removePopup(notify = true): void {
        const wasEditing = editForm != null;
        const restoreFocus = popup?.contains(
            editor.ownerDocument.activeElement,
        );
        editForm = null;
        cancelInline = null;
        const previousPopup = popup;
        popup = null;
        previousPopup?.remove();
        if (restoreFocus) {
            editor.focus({ preventScroll: true });
        }
        if (wasEditing && notify) {
            options.onEditingEnd?.();
        }
    }

    function dismiss(): void {
        pendingRefresh = null;
        generation += 1;
        clearTimers();
        removePopup();
        candidate = null;
        pointerX = undefined;
        pointerY = undefined;
        pendingPoint = null;
    }

    function applyReplacement(replacement: ReferenceReplacement): void {
        const source = options.getSource();
        const referenceStart = Number(candidate?.dataset.referenceStart);
        if (candidate == null || !Number.isInteger(referenceStart)) {
            dismiss();
        } else {
            const delta =
                replacement.value.length -
                (replacement.end - replacement.start);
            pendingRefresh = {
                focus: true,
                source:
                    source.slice(0, replacement.start) +
                    replacement.value +
                    source.slice(replacement.end),
                referenceStart:
                    referenceStart >= replacement.end
                        ? referenceStart + delta
                        : referenceStart > replacement.start
                          ? replacement.start
                          : referenceStart,
            };
            generation += 1;
            clearTimers();
            removePopup(false);
        }
        options.replace(replacement.start, replacement.end, replacement.value);
        // The editor replacement restores its own focus after rendering.
        // Return it to the refreshed inspection so Save does not close it.
        popup?.focus({ preventScroll: true });
    }

    function commitReplacement(
        form: HTMLElement,
        sourceSnapshot: string,
        buildReplacement: () => ReferenceReplacement | null,
        target: ReferenceChangeTarget,
        error: HTMLElement,
    ): void {
        if (editForm !== form || !popup?.isConnected || !popup.contains(form)) {
            return;
        }
        if (options.getSource() !== sourceSnapshot) {
            dismiss();
            return;
        }
        let replacement;
        try {
            replacement = buildReplacement();
        } catch {
            replacement = null;
        }
        if (replacement == null) {
            error.textContent = msg("reference.invalidField");
            error.hidden = false;
            positionPopup();
            return;
        }
        changes.recordReplacement(sourceSnapshot, replacement, target);
        applyReplacement(replacement);
    }

    function commitFieldEdit(
        form: HTMLElement,
        sourceSnapshot: string,
        range: ReferenceEditRange,
        value: string,
        name: string,
        citationRange: SourceRange | undefined,
        error: HTMLElement,
    ): void {
        commitReplacement(
            form,
            sourceSnapshot,
            () =>
                citationRange == null
                    ? buildReferenceFieldReplacement(
                          sourceSnapshot,
                          range,
                          value,
                      )
                    : buildReferenceFieldUpdate(
                          sourceSnapshot,
                          citationRange,
                          range,
                          name,
                          value,
                      ),
            citationRange == null
                ? { kind: "edit", range }
                : { kind: "update", range, citationRange },
            error,
        );
    }

    function refresh(): void {
        const pending = pendingRefresh;
        if (pending == null) {
            return;
        }
        if (options.getSource() !== pending.source) {
            dismiss();
            return;
        }
        const anchors = Array.from(
            editor.querySelectorAll<HTMLElement>(
                "[data-reference][data-reference-start]",
            ),
        ).filter(
            (element) =>
                Number(element.dataset.referenceStart) ===
                pending.referenceStart,
        );
        candidate = anchors.reduce<HTMLElement | null>((nearest, anchor) => {
            const rect = selectPreviewRect(
                Array.from(anchor.getClientRects()),
                pointerY,
                pointerX,
            );
            if (
                rect == null ||
                !isVisibleRect(rect, view.innerWidth, view.innerHeight)
            ) {
                return nearest;
            }
            if (nearest == null || pointerY == null) {
                return nearest ?? anchor;
            }
            const nearestRect = selectPreviewRect(
                Array.from(nearest.getClientRects()),
                pointerY,
                pointerX,
            )!;
            const distance = (bounds: PreviewRect): number =>
                Math.max(bounds.top - pointerY!, pointerY! - bounds.bottom, 0);
            return distance(rect) < distance(nearestRect) ? anchor : nearest;
        }, null);
        pendingRefresh = null;
        if (candidate == null) {
            dismiss();
            return;
        }
        show(generation);
        if (popup != null && pending.focus) {
            popup.tabIndex = -1;
            popup.focus({ preventScroll: true });
            const refreshedPopup = popup;
            view.queueMicrotask(() => {
                if (popup === refreshedPopup) {
                    refreshedPopup.focus({ preventScroll: true });
                }
            });
        }
    }

    function keepOpen(): void {
        view.clearTimeout(hideTimer);
        view.clearTimeout(removeTimer);
        hideTimer = 0;
        removeTimer = 0;
        popup?.classList.remove("wiked-lite-tooltip--closing");
    }

    function startClosing(): void {
        if (
            editForm != null ||
            popup?.contains(editor.ownerDocument.activeElement)
        ) {
            return;
        }
        if (popup == null) {
            candidate = null;
            return;
        }
        popup.classList.add("wiked-lite-tooltip--closing");
        const delay = view.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : REMOVE_DELAY;
        removeTimer = view.setTimeout(dismiss, delay);
    }

    function scheduleHide(): void {
        if (
            editForm != null ||
            popup?.contains(editor.ownerDocument.activeElement)
        ) {
            return;
        }
        view.clearTimeout(hideTimer);
        hideTimer = view.setTimeout(startClosing, HIDE_DELAY);
    }

    function positionPopup(): void {
        if (candidate == null || !candidate.isConnected) {
            dismiss();
            return;
        }
        if (popup == null) {
            return;
        }
        const rect = selectPreviewRect(
            Array.from(candidate.getClientRects()),
            pointerY,
            pointerX,
        );
        if (
            rect == null ||
            !isVisibleRect(rect, view.innerWidth, view.innerHeight)
        ) {
            dismiss();
            return;
        }
        applyPlacement(
            popup,
            rect,
            view.innerWidth,
            view.innerHeight,
            pointerX,
        );
    }

    function show(expectedGeneration: number): void {
        if (
            !enabled ||
            candidate == null ||
            !candidate.isConnected ||
            generation !== expectedGeneration
        ) {
            return;
        }
        const source = candidate.dataset.reference ?? "";
        const articleSource = options.getSource();
        changes.synchronize(articleSource);
        const referenceStart = Number(candidate.dataset.referenceStart);
        const highlightOptions = options.getHighlightOptions();
        const namespaceSource = highlightOptions.namespaceSource ?? null;
        const localPreview = buildReferencePreview(
            articleSource,
            source,
            namespaceSource,
            editingEnabled && Number.isInteger(referenceStart)
                ? referenceStart
                : undefined,
        );
        const fallbackPreview =
            localPreview == null || localPreview.missingDefinition === true
                ? buildFallbackPreview(source, namespaceSource)
                : null;
        const preview =
            fallbackPreview == null
                ? localPreview
                : {
                      ...fallbackPreview,
                      detailsRange: localPreview?.detailsRange,
                      ...(localPreview?.details == null
                          ? {}
                          : { details: localPreview.details }),
                  };
        if (preview == null) {
            candidate = null;
            return;
        }
        popup = createTooltip(
            editor,
            preview,
            highlightOptions,
            options.getLinkCheckState?.() ?? {
                checkedTitles: new Set(),
                missingTitles: new Set(),
                enabled: false,
            },
            keepOpen,
            scheduleHide,
            editingEnabled
                ? {
                      lightweight: lightweightEditing,
                      inline: (element, name, value, range, kind, key) =>
                          attachInlineEditing(
                              element,
                              articleSource,
                              name,
                              value,
                              range,
                              preview.citationRange,
                              fallbackPreview != null,
                              kind,
                              key,
                          ),
                      control: (
                          name,
                          value,
                          range,
                          remote = fallbackPreview != null,
                          kind,
                      ) =>
                          createEditControl(
                              articleSource,
                              name,
                              value,
                              range,
                              remote,
                              kind,
                              preview.citationRange,
                          ),
                      add: (field, placement) =>
                          createAddControl(
                              articleSource,
                              preview.citationRange,
                              fallbackPreview != null,
                              field,
                              placement,
                          ),
                      getChange: (range) =>
                          range == null ? null : changes.getChange(range),
                  }
                : null,
        );
        popup.addEventListener("keydown", handleKeydown);
        popup.addEventListener("focusin", keepOpen);
        popup.addEventListener("focusout", (event) => {
            if (
                popup != null &&
                event.currentTarget === popup &&
                !popup.contains(event.relatedTarget as Node | null)
            ) {
                scheduleHide();
            }
        });
        overlay.append(popup);
        positionPopup();
    }

    function scheduleShow(event: PointerEvent): void {
        view.clearTimeout(showTimer);
        pendingPoint = { x: event.clientX, y: event.clientY };
        generation += 1;
        const expectedGeneration = generation;
        showTimer = view.setTimeout(() => {
            showTimer = 0;
            pendingPoint = null;
            show(expectedGeneration);
        }, normalizeDelay(options.delay));
    }

    function beginShow(anchor: HTMLElement, event: PointerEvent): void {
        if (editForm != null) {
            return;
        }
        const sameSource =
            candidate != null && sameReference(anchor, candidate);
        // Keep the activation anchor across highlighted spans of one reference.
        if (sameSource && popup != null) {
            keepOpen();
            return;
        }
        candidate = anchor;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (sameSource) {
            keepOpen();
            return;
        }
        clearTimers();
        removePopup();
        scheduleShow(event);
    }

    function handlePointerOver(event: PointerEvent): void {
        if (!enabled || editForm != null || event.pointerType === "touch") {
            return;
        }
        if (isPagePreviewTarget(editor, event.target)) {
            dismiss();
            return;
        }
        const anchor = findReferenceAnchor(editor, event.target);
        if (anchor != null) {
            beginShow(anchor, event);
        }
    }

    function handlePointerMove(event: PointerEvent): void {
        if (!enabled || editForm != null || event.pointerType === "touch") {
            return;
        }
        if (isPagePreviewTarget(editor, event.target)) {
            dismiss();
            return;
        }
        const anchor = findReferenceAnchor(editor, event.target);
        if (anchor == null || anchor !== candidate) {
            return;
        }
        if (popup != null) {
            keepOpen();
            return;
        }
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (showTimer === 0 || pendingPoint == null) {
            return;
        }
        if (
            Math.hypot(
                event.clientX - pendingPoint.x,
                event.clientY - pendingPoint.y,
            ) > HOVER_RESET_DISTANCE
        ) {
            scheduleShow(event);
        }
    }

    function handlePointerOut(event: PointerEvent): void {
        const from = findReferenceAnchor(editor, event.target);
        if (from == null) {
            return;
        }
        const to = findReferenceAnchor(editor, event.relatedTarget);
        if (sameReference(from, to)) {
            return;
        }
        view.clearTimeout(showTimer);
        showTimer = 0;
        pendingPoint = null;
        if (popup == null) {
            candidate = null;
        } else {
            scheduleHide();
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape" && !event.isComposing) {
            event.preventDefault();
            dismiss();
        }
    }

    function attachInlineEditing(
        element: HTMLElement,
        sourceSnapshot: string,
        name: string,
        value: string,
        range: ReferenceEditRange | undefined,
        citationRange: SourceRange | undefined,
        remote: boolean,
        kind: ReferenceFieldKind = "field",
        key?: HTMLElement,
    ): HTMLButtonElement {
        const target = editor.ownerDocument;
        const button = target.createElement("button");
        const label = referenceEditLabel(kind, name);
        button.type = "button";
        button.className =
            "wiked-lite-tooltip__edit wiked-lite-tooltip__inline-edit";
        button.textContent = "[✎]";
        button.setAttribute("aria-label", label);
        button.title = label;
        const elements = key == null ? [element] : [key, element];
        if (range == null || (key != null && citationRange == null)) {
            const unavailable = referenceEditUnavailable(kind, name, remote);
            for (const input of elements) {
                input.title = [input.title, unavailable]
                    .filter(Boolean)
                    .join("\n");
            }
            button.title = unavailable;
            button.setAttribute("aria-disabled", "true");
            button.setAttribute("aria-description", unavailable);
            return button;
        }
        for (const input of elements) {
            input.classList.add("wiked-lite-tooltip__inline-target");
        }
        button.addEventListener("click", () => {
            if (element.isContentEditable) {
                return;
            }
            if (popup == null || options.getSource() !== sourceSnapshot) {
                dismiss();
                return;
            }
            cancelInline?.(false);
            keepOpen();
            button.hidden = true;
            const form = target.createElement("span");
            const original = elements.map((input) => ({
                input,
                content: Array.from(input.childNodes),
            }));
            const error = target.createElement("span");
            const actions = target.createElement("span");
            form.className = "wiked-lite-tooltip__inline-editor";
            for (const input of elements) {
                input.contentEditable = "plaintext-only";
                input.setAttribute("role", "textbox");
                input.setAttribute(
                    "aria-label",
                    input === key ? msg("reference.fieldName") : label,
                );
                input.setAttribute("aria-multiline", String(input !== key));
                setInlineSource(input, input === key ? name : value);
            }
            error.className = "wiked-lite-tooltip__edit-error";
            error.role = "alert";
            error.hidden = true;
            actions.className = "wiked-lite-tooltip__edit-actions";
            const cancel = (notify = true): void => {
                if (editForm !== form) {
                    return;
                }
                for (const { input, content } of original) {
                    input.removeEventListener("input", updateReset);
                    input.removeAttribute("contenteditable");
                    input.removeAttribute("aria-multiline");
                    input.removeAttribute("role");
                    input.removeAttribute("aria-label");
                    input.replaceChildren(...content);
                }
                form.replaceWith(...elements);
                editForm = null;
                cancelInline = null;
                button.hidden = false;
                button.focus({ preventScroll: true });
                positionPopup();
                if (notify) {
                    options.onEditingEnd?.();
                }
            };
            const commit = (): void => {
                commitFieldEdit(
                    form,
                    sourceSnapshot,
                    range,
                    readInlineSource(element),
                    key == null ? name : readInlineSource(key),
                    kind === "field" ? citationRange : undefined,
                    error,
                );
            };
            const actionButtons = [];
            for (const [message, text, action] of [
                ["reference.editCancel", "[×]", cancel],
                ["reference.editApply", "[✓]", commit],
            ] as const) {
                const button = target.createElement("button");
                button.type = "button";
                button.textContent = text;
                button.setAttribute("aria-label", msg(message));
                button.title = msg(message);
                button.addEventListener("click", () => action());
                actionButtons.push(button);
            }
            const reset = createResetControl(
                sourceSnapshot,
                name,
                range,
                value,
                () => {
                    for (const input of elements) {
                        setInlineSource(input, input === key ? name : value);
                    }
                    error.hidden = true;
                    updateReset();
                    element.focus();
                    setSelectionOffsets(element, 0, value.length);
                },
            );
            const updateReset = (): void =>
                setResetEnabled(
                    reset,
                    changes.getChange(range) != null ||
                        readInlineSource(element) !== value ||
                        (key != null && readInlineSource(key) !== name),
                );
            for (const input of elements) {
                input.addEventListener("input", updateReset);
            }
            updateReset();
            actions.append(actionButtons[0], reset, actionButtons[1]);
            attachInlineKeys(form, commit, cancel);
            element.replaceWith(form);
            form.append(...elements, actions, error);
            editForm = form;
            cancelInline = cancel;
            positionPopup();
            element.focus();
            setSelectionOffsets(element, 0, value.length);
        });
        return button;
    }

    function attachInlineKeys(
        form: HTMLElement,
        commit: () => void,
        cancel: () => void,
    ): void {
        form.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
            } else if (
                event.key === "Enter" &&
                !event.shiftKey &&
                (event.target as HTMLElement).closest(
                    'input, textarea, [contenteditable="plaintext-only"]',
                ) != null
            ) {
                event.preventDefault();
                event.stopPropagation();
                commit();
            }
        });
    }

    function createEditControl(
        sourceSnapshot: string,
        name: string,
        value: string,
        range: ReferenceEditRange | undefined,
        remote: boolean,
        kind: ReferenceFieldKind = "field",
        citationRange?: SourceRange,
    ): HTMLButtonElement {
        const target = editor.ownerDocument;
        const button = target.createElement("button");
        const label = referenceEditLabel(kind, name);
        button.type = "button";
        button.className = "wiked-lite-tooltip__edit";
        button.append(
            createReferenceIcon(
                target,
                range != null && changes.getChange(range) != null
                    ? "cdxIconEditUndo"
                    : "cdxIconEdit",
            ),
        );
        button.setAttribute("aria-label", label);
        button.title = label;
        if (range == null) {
            button.title = referenceEditUnavailable(kind, name, remote);
            button.setAttribute("aria-disabled", "true");
            button.setAttribute("aria-description", button.title);
        }
        button.addEventListener("click", () => {
            if (range == null || popup == null) {
                return;
            }
            if (options.getSource() !== sourceSnapshot) {
                dismiss();
                return;
            }
            keepOpen();
            cancelInline?.(false);
            editForm?.remove();
            const form = target.createElement("div");
            const heading = target.createElement("label");
            const input = target.createElement("textarea");
            const nameInput =
                kind === "field" && citationRange != null
                    ? target.createElement("input")
                    : null;
            const error = target.createElement("p");
            const actions = target.createElement("div");
            const apply = target.createElement("button");
            const cancel = target.createElement("button");
            form.className = "wiked-lite-tooltip__edit-form";
            heading.textContent = label;
            input.className = "wiked-lite-tooltip__edit-input";
            input.setAttribute("aria-label", label);
            input.rows = 2;
            input.value = value;
            heading.append(input);
            if (nameInput != null) {
                const nameLabel = target.createElement("label");
                nameLabel.textContent = msg("reference.fieldName");
                nameInput.className = "wiked-lite-tooltip__edit-input";
                nameInput.value = name;
                nameInput.setAttribute(
                    "aria-label",
                    msg("reference.fieldName"),
                );
                nameLabel.append(nameInput);
                form.append(nameLabel);
            }
            error.className = "wiked-lite-tooltip__edit-error";
            error.role = "alert";
            error.hidden = true;
            actions.className = "wiked-lite-tooltip__edit-actions";
            apply.type = "button";
            apply.textContent = msg("reference.editApply");
            cancel.type = "button";
            cancel.textContent = msg("reference.editCancel");
            apply.addEventListener("click", () => {
                commitFieldEdit(
                    form,
                    sourceSnapshot,
                    range,
                    input.value,
                    nameInput?.value ?? name,
                    nameInput == null ? undefined : citationRange,
                    error,
                );
            });
            cancel.addEventListener("click", () => {
                form.remove();
                editForm = null;
                button.focus({ preventScroll: true });
                positionPopup();
                options.onEditingEnd?.();
            });
            actions.append(cancel);
            const reset = createResetControl(
                sourceSnapshot,
                name,
                range,
                value,
                () => {
                    input.value = value;
                    if (nameInput != null) {
                        nameInput.value = name;
                    }
                    error.hidden = true;
                    updateReset();
                    input.focus();
                    input.select();
                },
            );
            const updateReset = (): void =>
                setResetEnabled(
                    reset,
                    changes.getChange(range) != null ||
                        input.value !== value ||
                        (nameInput != null && nameInput.value !== name),
                );
            input.addEventListener("input", updateReset);
            nameInput?.addEventListener("input", updateReset);
            updateReset();
            actions.append(reset, apply);
            form.append(heading, error, actions);
            editForm = form;
            button
                .closest(
                    ".wiked-lite-tooltip__row, .wiked-lite-tooltip__details, .wiked-lite-tooltip__note",
                )
                ?.after(form);
            positionPopup();
            input.focus();
            input.select();
        });
        return button;
    }

    function createAddControl(
        sourceSnapshot: string,
        range: SourceRange | undefined,
        remote: boolean,
        field?: ReferencePreviewField,
        placement: "first" | "after" = "first",
    ): HTMLButtonElement {
        const target = editor.ownerDocument;
        const button = target.createElement("button");
        const label =
            placement === "first"
                ? msg("reference.addField")
                : msg("reference.addFieldAfter", { field: field!.name });
        const unavailable =
            range == null || (field != null && field.range == null);
        button.type = "button";
        button.className =
            placement === "first"
                ? "wiked-lite-tooltip__add"
                : "wiked-lite-tooltip__edit";
        if (lightweightEditing) {
            button.classList.add("wiked-lite-tooltip__inline-add");
            button.textContent = "[+]";
        } else {
            button.append(createReferenceIcon(target, "cdxIconAdd"));
        }
        if (placement === "first" && !lightweightEditing) {
            button.append(target.createTextNode(` ${label}`));
        }
        button.setAttribute("aria-label", label);
        button.title = unavailable
            ? placement === "first"
                ? msg(
                      remote
                          ? "reference.addUnavailable"
                          : "reference.addUnavailableSource",
                  )
                : msg(
                      remote
                          ? "reference.addAfterUnavailable"
                          : "reference.addAfterUnavailableSource",
                      { field: field!.name },
                  )
            : label;
        if (unavailable) {
            button.setAttribute("aria-disabled", "true");
            button.setAttribute("aria-description", button.title);
        }
        button.addEventListener("click", () => {
            if (range == null || unavailable || popup == null) {
                return;
            }
            if (options.getSource() !== sourceSnapshot) {
                dismiss();
                return;
            }
            keepOpen();
            cancelInline?.(false);
            editForm?.remove();
            const form = target.createElement("div");
            const nameLabel = target.createElement("label");
            const name = lightweightEditing
                ? target.createElement("div")
                : target.createElement("input");
            const valueLabel = target.createElement("label");
            const value = lightweightEditing
                ? target.createElement("div")
                : target.createElement("textarea");
            const error = target.createElement("p");
            const actions = target.createElement("div");
            const apply = target.createElement("button");
            const cancel = target.createElement("button");
            const reset = target.createElement("button");
            form.className = "wiked-lite-tooltip__edit-form";
            if (lightweightEditing) {
                form.classList.add("wiked-lite-tooltip__inline-draft");
            }
            nameLabel.textContent = msg("reference.fieldName");
            name.setAttribute("aria-label", msg("reference.fieldName"));
            nameLabel.append(name);
            valueLabel.textContent = msg("reference.fieldValue");
            value.setAttribute("aria-label", msg("reference.fieldValue"));
            valueLabel.append(value);
            if (lightweightEditing) {
                nameLabel.firstChild?.remove();
                valueLabel.firstChild?.remove();
                for (const input of [name, value]) {
                    input.contentEditable = "plaintext-only";
                    input.className = "wiked-lite-tooltip__inline-target";
                    input.setAttribute("role", "textbox");
                    input.setAttribute(
                        "aria-multiline",
                        String(input === value),
                    );
                    input.dataset.placeholder =
                        input.getAttribute("aria-label")!;
                }
                name.classList.add("wiked-lite-tooltip__key");
                value.classList.add("wiked-lite-tooltip__value");
            } else {
                name.className = "wiked-lite-tooltip__edit-input";
                value.className = "wiked-lite-tooltip__edit-input";
                (name as HTMLInputElement).type = "text";
                (name as HTMLInputElement).placeholder = msg(
                    "reference.fieldName",
                );
                (value as HTMLTextAreaElement).rows = 2;
                (value as HTMLTextAreaElement).placeholder = msg(
                    "reference.fieldValue",
                );
            }
            error.className = "wiked-lite-tooltip__edit-error";
            error.setAttribute("role", "alert");
            error.hidden = true;
            actions.className = "wiked-lite-tooltip__edit-actions";
            apply.type = "button";
            apply.textContent = msg("reference.editApply");
            cancel.type = "button";
            cancel.textContent = msg("reference.editCancel");
            reset.type = "button";
            reset.textContent = msg("reference.editReset");
            reset.setAttribute("aria-label", msg("reference.editReset"));
            const updateReset = (): void =>
                setResetEnabled(
                    reset,
                    readReferenceInput(name) !== "" ||
                        readReferenceInput(value) !== "",
                );
            name.addEventListener("input", updateReset);
            value.addEventListener("input", updateReset);
            updateReset();
            reset.addEventListener("click", () => {
                for (const input of [name, value]) {
                    if ("value" in input) {
                        input.value = "";
                    } else {
                        input.textContent = "";
                    }
                }
                error.hidden = true;
                updateReset();
                name.focus();
            });
            apply.addEventListener("click", () => {
                const fieldName = readReferenceInput(name);
                commitReplacement(
                    form,
                    sourceSnapshot,
                    () =>
                        buildReferenceFieldInsertion(
                            sourceSnapshot,
                            range,
                            fieldName,
                            readReferenceInput(value),
                            field?.range,
                            placement === "after" ? "after" : "before",
                        ),
                    {
                        kind: "insert",
                        name: fieldName.trim(),
                        citationRange: range,
                    },
                    error,
                );
            });
            const cancelDraft = (notify = true): void => {
                if (editForm !== form) {
                    return;
                }
                form.remove();
                editForm = null;
                cancelInline = null;
                button.focus({ preventScroll: true });
                positionPopup();
                if (notify) {
                    options.onEditingEnd?.();
                }
            };
            cancel.addEventListener("click", () => cancelDraft());
            actions.append(cancel, reset, apply);
            if (lightweightEditing) {
                cancel.textContent = "[×]";
                cancel.setAttribute("aria-label", msg("reference.editCancel"));
                cancel.title = msg("reference.editCancel");
                apply.textContent = "[✓]";
                apply.setAttribute("aria-label", msg("reference.editApply"));
                apply.title = msg("reference.editApply");
                reset.textContent = "[↶]";
                reset.title = msg("reference.editReset");
            }
            form.append(nameLabel, valueLabel, actions, error);
            editForm = form;
            if (lightweightEditing) {
                attachInlineKeys(
                    form,
                    () => apply.click(),
                    () => cancel.click(),
                );
                cancelInline = cancelDraft;
            }
            if (placement === "first") {
                button
                    .closest(".wiked-lite-tooltip__citation-title")
                    ?.after(form);
            } else {
                button.closest(".wiked-lite-tooltip__row")?.after(form);
            }
            positionPopup();
            name.focus();
        });
        return button;
    }

    function createResetControl(
        sourceSnapshot: string,
        name: string,
        range: SourceRange,
        originalValue: string,
        resetDraft: () => void,
    ): HTMLButtonElement {
        const change = changes.getChange(range);
        const button = editor.ownerDocument.createElement("button");
        button.type = "button";
        if (lightweightEditing) {
            button.textContent = "[↶]";
        } else {
            button.append(
                createReferenceIcon(editor.ownerDocument, "cdxIconUndo"),
                editor.ownerDocument.createTextNode(
                    ` ${msg("reference.editReset")}`,
                ),
            );
        }
        button.title = change?.added
            ? msg("reference.removeAddedField", { field: name })
            : msg("reference.resetField", {
                  value: change?.originalValue ?? originalValue,
              });
        button.setAttribute("aria-label", button.title);
        button.addEventListener("click", () => {
            if (button.disabled) {
                return;
            }
            if (options.getSource() !== sourceSnapshot) {
                dismiss();
                return;
            }
            if (change == null) {
                resetDraft();
                return;
            }
            const replacement = changes.getReset(range);
            if (replacement == null) {
                return;
            }
            changes.recordReplacement(sourceSnapshot, replacement, {
                kind: "reset",
                range,
            });
            applyReplacement(replacement);
        });
        return button;
    }

    function setResetEnabled(button: HTMLButtonElement, active: boolean): void {
        button.disabled = !active;
        button.setAttribute("aria-disabled", String(!active));
    }

    editor.addEventListener("pointerover", handlePointerOver);
    editor.addEventListener("pointermove", handlePointerMove);
    editor.addEventListener("pointerout", handlePointerOut);
    editor.addEventListener("scroll", positionPopup);
    editor.addEventListener("keydown", handleKeydown);
    view.addEventListener("resize", positionPopup);

    return {
        beforeRender(preserve = false) {
            const referenceStart = Number(candidate?.dataset.referenceStart);
            if (
                preserve &&
                pendingRefresh == null &&
                hideTimer === 0 &&
                removeTimer === 0 &&
                popup != null &&
                candidate != null &&
                Number.isInteger(referenceStart)
            ) {
                pendingRefresh = {
                    source: options.getSource(),
                    referenceStart,
                    focus: popup.contains(editor.ownerDocument.activeElement),
                };
                generation += 1;
                clearTimers();
            }
            if (
                pendingRefresh != null &&
                pendingRefresh.source === options.getSource()
            ) {
                removePopup(false);
            } else {
                dismiss();
            }
        },
        destroy() {
            dismiss();
            editor.removeEventListener("pointerover", handlePointerOver);
            editor.removeEventListener("pointermove", handlePointerMove);
            editor.removeEventListener("pointerout", handlePointerOut);
            editor.removeEventListener("scroll", positionPopup);
            editor.removeEventListener("keydown", handleKeydown);
            view.removeEventListener("resize", positionPopup);
        },
        dismiss,
        isEditing: () => editForm != null,
        refresh,
        setEnabled(value) {
            enabled = value;
            if (!enabled) {
                dismiss();
            }
        },
        setEditingEnabled(value) {
            if (editingEnabled !== value) {
                editingEnabled = value;
                dismiss();
            }
        },
        setLightweightEditing(value) {
            if (lightweightEditing !== value) {
                lightweightEditing = value;
                dismiss();
            }
        },
        sourceChanged() {
            changes.synchronize(options.getSource());
            if (pendingRefresh?.source !== options.getSource()) {
                dismiss();
            }
        },
    };

    function buildFallbackPreview(
        source: string,
        namespaceSource: NamespaceSource | null,
    ): ReferencePreview | null {
        const fallback = options.getFallbackSource?.();
        return fallback == null
            ? null
            : buildReferencePreview(fallback, source, namespaceSource);
    }
}

function applyPlacement(
    popup: HTMLElement,
    anchor: PreviewRect,
    viewportWidth: number,
    viewportHeight: number,
    pointerX?: number,
): void {
    const surface = popup.querySelector<HTMLElement>(
        ".wiked-lite-tooltip__surface",
    );
    if (surface == null) {
        return;
    }
    surface.style.removeProperty("max-height");
    const measuredHeight = popup.offsetHeight;
    const placement = calculatePreviewPlacement(
        anchor,
        { height: measuredHeight, width: popup.offsetWidth },
        { height: viewportHeight, width: viewportWidth },
        pointerX,
    );
    applyPlacementSide(popup, placement.side);
    popup.style.left = `${placement.left}px`;
    popup.style.setProperty(
        "--wiked-lite-tooltip-tail-left",
        `${placement.tailLeft}px`,
    );
    applyTooltipBridge(popup, placement);
    if (placement.maxHeight < measuredHeight) {
        surface.style.maxHeight = `${placement.maxHeight}px`;
    }
    const renderedHeight = popup.offsetHeight;
    const top =
        placement.side === "above"
            ? anchor.top - PREVIEW_ANCHOR_GAP - renderedHeight
            : anchor.bottom + PREVIEW_ANCHOR_GAP;
    popup.style.top = `${top}px`;
}

function applyTooltipBridge(
    popup: HTMLElement,
    placement: PreviewPlacement,
): void {
    popup.style.setProperty(
        "--wiked-lite-tooltip-bridge-left",
        `${placement.bridgeLeft}px`,
    );
    popup.style.setProperty(
        "--wiked-lite-tooltip-bridge-width",
        `${placement.bridgeWidth}px`,
    );
}

function applyPlacementSide(
    popup: HTMLElement,
    side: PreviewPlacement["side"],
): void {
    popup.classList.toggle("wiked-lite-tooltip--above", side === "above");
    popup.classList.toggle("wiked-lite-tooltip--below", side === "below");
}

function createTooltip(
    editor: HTMLElement,
    preview: ReferencePreview,
    highlightOptions: HighlightOptions,
    linkCheckState: LinkCheckState,
    onEnter: () => void,
    onLeave: () => void,
    editing: TooltipEditing | null,
): HTMLElement {
    const target = editor.ownerDocument;
    const tooltip = target.createElement("aside");
    const visual = target.createElement("div");
    const surface = target.createElement("div");
    const tail = target.createElement("span");
    const body = target.createElement("div");
    const presentation: ReferenceValuePresentation = {
        highlight: highlightOptions,
        links: linkCheckState,
    };
    tooltip.className = "wiked-lite-tooltip";
    tooltip.classList.toggle(
        "wiked-lite-tooltip--lightweight",
        editing?.lightweight === true,
    );
    tooltip.role = "note";
    visual.className = "wiked-lite-tooltip__visual";
    surface.className = "wiked-lite-tooltip__surface";
    tail.className = "wiked-lite-tooltip__tail";
    body.className = "wiked-lite-tooltip__body";
    copyTooltipPresentation(editor, tooltip);
    surface.append(createTooltipTitle(target, preview));
    if (preview.details != null) {
        const details = createTooltipDetails(
            target,
            preview.details,
            presentation,
            editing == null || editing.lightweight
                ? undefined
                : editing.control(
                      "details",
                      preview.details,
                      preview.detailsRange,
                      false,
                      "details",
                  ),
        );
        if (editing?.getChange(preview.detailsRange) != null) {
            details.classList.add("wiked-lite-tooltip__details--modified");
        }
        if (editing?.lightweight) {
            details.append(
                editing.inline(
                    details.querySelector<HTMLElement>(
                        ".wiked-lite-tooltip__code",
                    )!,
                    "details",
                    preview.details,
                    preview.detailsRange,
                    "details",
                ),
            );
        }
        surface.append(details);
    }
    if (preview.missingDefinition === true) {
        const missing = target.createElement("p");
        missing.className = "wiked-lite-tooltip__missing";
        missing.textContent = msg("reference.missingDefinition");
        surface.append(missing);
    }
    if (preview.noteText != null) {
        const heading = target.createElement("div");
        heading.className = "wiked-lite-tooltip__citation-title";
        heading.textContent = msg("reference.contentTitle");
        surface.append(heading);
        const note = createTooltipNote(target, preview.noteText, presentation);
        if (editing != null) {
            if (editing.lightweight) {
                heading.append(
                    editing.inline(
                        note,
                        "content",
                        preview.noteText,
                        preview.noteRange,
                        "note",
                    ),
                );
            } else {
                note.append(
                    editing.control(
                        "content",
                        preview.noteText,
                        preview.noteRange,
                        undefined,
                        "note",
                    ),
                );
            }
            if (editing.getChange(preview.noteRange) != null) {
                note.classList.add("wiked-lite-tooltip__note--modified");
            }
        }
        surface.append(note);
    } else if (preview.templateTitle != null) {
        const heading = createCitationTitle(target, preview.templateTitle);
        if (editing != null) {
            const firstField = preview.rows
                .flatMap((row) => row.fields)
                .sort(
                    (left, right) =>
                        (left.range?.start ?? Infinity) -
                        (right.range?.start ?? Infinity),
                )[0];
            heading.append(editing.add(firstField, "first"));
        }
        surface.append(heading);
        for (const row of preview.rows) {
            body.append(
                createTooltipRow(target, row.fields, presentation, editing),
            );
        }
        surface.append(body);
    }
    visual.append(tail, surface);
    tooltip.append(visual);
    tooltip.addEventListener("pointerenter", onEnter);
    tooltip.addEventListener("pointerleave", onLeave);
    return tooltip;
}

function readReferenceInput(
    input: HTMLDivElement | HTMLInputElement | HTMLTextAreaElement,
): string {
    return "value" in input ? input.value : readInlineSource(input);
}

function referenceEditLabel(kind: ReferenceFieldKind, name: string): string {
    return kind === "details"
        ? msg("reference.editDetails")
        : kind === "note"
          ? msg("reference.editContent")
          : msg("reference.editField", { field: name });
}

function referenceEditUnavailable(
    kind: ReferenceFieldKind,
    name: string,
    remote: boolean,
): string {
    return kind === "field"
        ? msg(
              remote
                  ? "reference.editUnavailable"
                  : "reference.editUnavailableSource",
              { field: name },
          )
        : msg(
              remote
                  ? "reference.editContentUnavailable"
                  : "reference.editContentUnavailableSource",
          );
}

function setInlineSource(input: HTMLElement, value: string): void {
    // Inline editing uses a final line break as a caret placeholder. Keep an
    // extra one when the source itself ends in a newline so it stays editable.
    input.textContent = value.endsWith("\n") ? `${value}\n` : value;
}

function readInlineSource(input: HTMLElement): string {
    const value = readEditableText(input);
    // Discard the browser's terminal caret placeholder, not a source newline.
    return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function createTooltipDetails(
    target: Document,
    text: string,
    presentation: ReferenceValuePresentation,
    edit?: HTMLButtonElement,
): HTMLElement {
    const details = target.createElement("div");
    const label = target.createElement("strong");
    const code = target.createElement("div");
    details.className = "wiked-lite-tooltip__details";
    label.className = "wiked-lite-tooltip__details-label";
    code.className = "wiked-lite-tooltip__code";
    label.textContent = msg("reference.details");
    appendReferenceValue(code, { value: text }, presentation);
    details.append(label, code);
    if (edit != null) {
        const actions = target.createElement("span");
        actions.className = "wiked-lite-tooltip__actions";
        actions.append(edit);
        details.append(actions);
    }
    return details;
}

function createTooltipNote(
    target: Document,
    text: string,
    presentation: ReferenceValuePresentation,
): HTMLElement {
    const note = target.createElement("div");
    note.className = "wiked-lite-tooltip__note";
    appendReferenceValue(note, { value: text }, presentation);
    return note;
}

function copyTooltipPresentation(
    editor: HTMLElement,
    tooltip: HTMLElement,
): void {
    const view = editor.ownerDocument.defaultView;
    if (view == null) {
        return;
    }
    const style = view.getComputedStyle(editor);
    const target = editor.ownerDocument;
    const host = target.defaultView?.frameElement ?? target.documentElement;
    const hostStyle = host.ownerDocument.defaultView?.getComputedStyle(host);
    for (const [name, fallback] of Object.entries(CODEX_COLORS)) {
        const property = `--${name}`;
        // Older skins expose progressive colors before the link token aliases.
        const alias = name.startsWith("color-link")
            ? `--${name.replace("color-link", "color-progressive")}`
            : property;
        tooltip.style.setProperty(
            property,
            hostStyle?.getPropertyValue(property).trim() ||
                hostStyle?.getPropertyValue(alias).trim() ||
                fallback,
        );
    }
    if (hostStyle != null) {
        tooltip.style.colorScheme = hostStyle.colorScheme;
    }
    tooltip.style.setProperty("--wiked-lite-foreground", style.color);
    tooltip.style.setProperty("--wiked-lite-background", style.backgroundColor);
    const missingLink = style.getPropertyValue("--wiked-lite-missing-link");
    if (missingLink) {
        tooltip.style.setProperty("--wiked-lite-missing-link", missingLink);
    }
    const editorFontSize = Number.parseFloat(style.fontSize);
    if (Number.isFinite(editorFontSize)) {
        tooltip.style.fontSize = `${editorFontSize * 0.82}px`;
    }
}

function createTooltipRow(
    target: Document,
    fields: ReferencePreviewField[],
    presentation: ReferenceValuePresentation,
    editing: TooltipEditing | null,
): HTMLElement {
    const row = target.createElement("div");
    row.className = "wiked-lite-tooltip__row";
    for (const field of fields) {
        const key = target.createElement("div");
        const value = target.createElement("div");
        key.className = "wiked-lite-tooltip__key";
        value.className = "wiked-lite-tooltip__value";
        key.textContent = field.name;
        appendReferenceValue(value, field, presentation);
        if (field.duplicate === true) {
            const warning = target.createElement("span");
            const label = msg("reference.duplicateField", {
                field: field.name,
            });
            warning.className = "wiked-lite-tooltip__duplicate";
            warning.role = "img";
            warning.setAttribute("aria-label", label);
            warning.title = label;
            key.title = label;
            if (editing?.lightweight) {
                warning.textContent = "⚠︎";
            } else {
                warning.append(createReferenceIcon(target, "cdxIconAlert"));
            }
            key.prepend(warning);
        }
        row.append(key, value);
        if (editing != null) {
            const actions = target.createElement("span");
            actions.className = "wiked-lite-tooltip__actions";
            actions.append(
                editing.lightweight
                    ? editing.inline(
                          value,
                          field.name,
                          field.value,
                          field.range,
                          "field",
                          key,
                      )
                    : editing.control(field.name, field.value, field.range),
            );
            actions.append(editing.add(field, "after"));
            const change = editing.getChange(field.range);
            if (change?.nameChanged) {
                key.classList.add("wiked-lite-tooltip__key--modified");
            }
            if (change?.valueChanged) {
                value.classList.add("wiked-lite-tooltip__value--modified");
            }
            row.append(actions);
        }
    }
    return row;
}

function createTooltipTitle(
    target: Document,
    preview: ReferencePreview,
): HTMLElement {
    const title = target.createElement("div");
    title.className = "wiked-lite-tooltip__title";
    title.textContent = msg("reference.title");
    if (preview.referenceLabel) {
        const name = target.createElement("code");
        name.textContent = preview.referenceLabel;
        title.append(
            target.createTextNode(msg("reference.namePrefix")),
            name,
            target.createTextNode(msg("reference.nameSuffix")),
        );
    }
    return title;
}

function createCitationTitle(
    target: Document,
    templateTitle: string,
): HTMLElement {
    const title = target.createElement("div");
    title.className = "wiked-lite-tooltip__citation-title";
    const link = target.createElement("a");
    link.className = "wiked-lite-tooltip__link";
    link.href = `/wiki/${encodeURIComponent(
        `Template:${templateTitle.replaceAll(" ", "_")}`,
    )}`;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.addEventListener("click", (event) =>
        handleSourceLinkClick(event, link),
    );
    link.textContent = templateTitle.replace(/^./u, (character) =>
        character.toLocaleUpperCase(),
    );
    title.append(
        target.createTextNode("{{"),
        link,
        target.createTextNode("}}"),
    );
    return title;
}

function findReferenceAnchor(
    editor: HTMLElement,
    eventTarget: EventTarget | null,
): HTMLElement | null {
    const element = eventElement(eventTarget);
    const anchor = element?.closest<HTMLElement>("[data-reference]") ?? null;
    return anchor != null && editor.contains(anchor) ? anchor : null;
}

function isPagePreviewTarget(
    editor: HTMLElement,
    eventTarget: EventTarget | null,
): boolean {
    const target = eventElement(eventTarget);
    const link = target?.closest("[data-page-preview-title]");
    return link != null && editor.contains(link);
}

function sameReference(left: HTMLElement, right: HTMLElement | null): boolean {
    return (
        right != null &&
        left.dataset.reference === right.dataset.reference &&
        left.dataset.referenceStart === right.dataset.referenceStart
    );
}

function normalizeDelay(value: number | undefined): number {
    if (value == null || !Number.isFinite(value)) {
        return DEFAULT_DELAY;
    }
    return clamp(value, 0, 5000);
}

function getDocumentView(target: Document): Window {
    const view = target.defaultView;
    if (view == null) {
        throw new Error("The editor document has no browsing context.");
    }
    return view;
}

function isVisibleRect(
    rect: PreviewRect,
    width: number,
    height: number,
): boolean {
    return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < height &&
        rect.left < width
    );
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

/** Small Codex glyphs for reference actions, supplied as build-time SVG data. */
function createReferenceIcon(
    target: Document,
    name: ReferenceIconName,
): SVGSVGElement {
    const namespace = "http://www.w3.org/2000/svg";
    const data = __WIKED_LITE_REFERENCE_ICONS__[name];
    const icon = target.createElementNS(namespace, "svg");
    const path = target.createElementNS(namespace, "path");
    icon.classList.add("wiked-lite-tooltip__icon");
    icon.dataset.icon = name;
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    path.setAttribute("d", data.path);
    icon.append(path);
    if (data.rtlPath != null) {
        const rtlPath = target.createElementNS(namespace, "path");
        path.classList.add("wiked-lite-tooltip__icon-ltr");
        rtlPath.classList.add("wiked-lite-tooltip__icon-rtl");
        rtlPath.setAttribute("d", data.rtlPath);
        icon.append(rtlPath);
    } else if (data.flipInRtl) {
        icon.classList.add("wiked-lite-tooltip__icon--flip-rtl");
    }
    return icon;
}

/** Displays reference source with the editor's syntax and checked-link colors. */
function appendReferenceValue(
    container: HTMLElement,
    field: Pick<ReferencePreviewField, "value" | "displayValue" | "href">,
    presentation: ReferenceValuePresentation,
): void {
    const target = container.ownerDocument;
    const fragment = createHighlightedFragment(
        target,
        field.displayValue ?? field.value,
        presentation.links,
        presentation.highlight,
    );
    if (field.href != null) {
        const link = createReferenceSourceLink(target, field.href);
        if (link != null) {
            link.append(fragment);
            container.append(link);
            return;
        }
    }
    for (const span of fragment.querySelectorAll<HTMLElement>("[data-href]")) {
        const link = createReferenceSourceLink(target, span.dataset.href ?? "");
        if (link == null) {
            continue;
        }
        span.replaceWith(link);
        link.append(span);
    }
    container.append(fragment);
}

function createReferenceSourceLink(
    target: Document,
    href: string,
): HTMLAnchorElement | null {
    let url: URL;
    try {
        url = new URL(href, target.baseURI);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
    }
    const link = target.createElement("a");
    link.className = "wiked-lite-tooltip__source-link";
    link.href = url.href;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.addEventListener("click", (event) =>
        handleSourceLinkClick(event, link),
    );
    return link;
}
