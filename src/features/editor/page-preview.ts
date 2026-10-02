/**
 * @file src/features/editor/page-preview.ts
 * Purpose: Delayed page-summary cards for links in the isolated editor.
 *
 * Table of contents:
 * 1. Imports
 * 2. PagePreviewController
 * 3. PagePreviewOptions
 * 4. Constants and state
 * 5. attachPagePreviews
 * 6. createCard
 * 7. readTarget
 * 8. cacheKey
 * 9. findPreviewAnchor
 * 10. samePreviewSource
 * 11. containsTarget
 * 12. normalizeDelay
 */

import type {
    PageSummary,
    PageSummaryResult,
} from "../../domain/page-summary.ts";
import type { PagePreviewTarget } from "../../domain/highlight-partition.ts";
import { eventElement } from "./dom.ts";
import {
    calculatePreviewPlacement,
    PREVIEW_ANCHOR_GAP,
    selectPreviewRect,
} from "./preview-position.ts";

export interface PagePreviewController {
    clearCache(): void;
    destroy(): void;
    dismiss(): void;
    refresh(): void;
    setEnabled(enabled: boolean): void;
}

export interface PagePreviewOptions {
    editor: HTMLElement;
    overlay: HTMLElement;
    enabled?: boolean;
    delay?: number;
    load(target: PagePreviewTarget): Promise<PageSummaryResult>;
}

const DEFAULT_HOVER_DELAY = 700;
const PREFETCH_DELAY = 120;
const HIDE_DELAY = 220;
const MOVE_TOLERANCE = 4;

/** Attaches a hover controller without changing the editor's source text. */
export function attachPagePreviews(
    options: PagePreviewOptions,
): PagePreviewController {
    const { editor, overlay } = options;
    const view = editor.ownerDocument.defaultView ?? window;
    const cache = new Map<string, PageSummaryResult>();
    const inFlight = new Map<string, Promise<PageSummaryResult>>();
    let enabled = options.enabled ?? false;
    let anchor: HTMLElement | null = null;
    let card: HTMLElement | null = null;
    let hoverX = 0;
    let hoverY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let generation = 0;
    let prefetchTimer = 0;
    let showTimer = 0;
    let hideTimer = 0;

    function clearTimers(): void {
        view.clearTimeout(prefetchTimer);
        view.clearTimeout(showTimer);
        view.clearTimeout(hideTimer);
        prefetchTimer = 0;
        showTimer = 0;
        hideTimer = 0;
    }

    function dismiss(): void {
        generation += 1;
        clearTimers();
        card?.remove();
        card = null;
        anchor = null;
    }

    function refresh(): void {
        for (const element of editor.querySelectorAll<HTMLElement>(
            "[data-page-preview-title]",
        )) {
            const target = readTarget(element);
            const missing =
                target != null &&
                !element.classList.contains(
                    "wiked-lite-token--foreign-title",
                ) &&
                cache.get(cacheKey(target))?.kind === "missing";
            element.classList.toggle(
                "wiked-lite-token--page-missing",
                enabled && missing,
            );
        }
    }

    function lookup(target: PagePreviewTarget): Promise<PageSummaryResult> {
        const key = cacheKey(target);
        const saved = cache.get(key);
        if (saved != null) {
            return Promise.resolve(saved);
        }
        const existing = inFlight.get(key);
        if (existing != null) {
            return existing;
        }
        const request = options.load(target).then(
            (result) => {
                // A cleared or replaced request must not repopulate the cache.
                if (inFlight.get(key) !== request) {
                    return result;
                }
                cache.set(key, result);
                inFlight.delete(key);
                if (enabled && result.kind === "missing") {
                    refresh();
                }
                return result;
            },
            (error: unknown) => {
                if (inFlight.get(key) === request) {
                    inFlight.delete(key);
                }
                throw error;
            },
        );
        inFlight.set(key, request);
        return request;
    }

    function position(): void {
        if (card == null || anchor == null || !anchor.isConnected) {
            return;
        }
        const rect = selectPreviewRect(
            Array.from(anchor.getClientRects()),
            pointerY,
            pointerX,
        );
        if (
            rect == null ||
            rect.bottom <= 0 ||
            rect.right <= 0 ||
            rect.top >= view.innerHeight ||
            rect.left >= view.innerWidth
        ) {
            dismiss();
            return;
        }
        const surface = card.querySelector<HTMLElement>(
            ".wiked-lite-page-preview__surface",
        )!;
        surface.style.removeProperty("max-height");
        const height = card.offsetHeight;
        const placement = calculatePreviewPlacement(
            rect,
            { width: card.offsetWidth, height },
            { width: view.innerWidth, height: view.innerHeight },
            pointerX,
            "below",
        );
        card.classList.toggle(
            "wiked-lite-page-preview--above",
            placement.side === "above",
        );
        card.classList.toggle(
            "wiked-lite-page-preview--below",
            placement.side === "below",
        );
        card.style.left = `${placement.left}px`;
        card.style.setProperty(
            "--wiked-lite-page-preview-tail-left",
            `${placement.tailLeft}px`,
        );
        card.style.setProperty(
            "--wiked-lite-page-preview-bridge-left",
            `${placement.bridgeLeft}px`,
        );
        card.style.setProperty(
            "--wiked-lite-page-preview-bridge-width",
            `${placement.bridgeWidth}px`,
        );
        if (placement.maxHeight < height) {
            surface.style.maxHeight = `${placement.maxHeight}px`;
        }
        card.style.top = `${
            placement.side === "above"
                ? rect.top - PREVIEW_ANCHOR_GAP - card.offsetHeight
                : rect.bottom + PREVIEW_ANCHOR_GAP
        }px`;
    }

    function show(expectedGeneration: number): void {
        showTimer = 0;
        const current = anchor;
        const target = current == null ? null : readTarget(current);
        if (
            !enabled ||
            target == null ||
            !current?.isConnected ||
            generation !== expectedGeneration
        ) {
            return;
        }
        void lookup(target)
            .then((result) => {
                if (
                    result.kind !== "summary" ||
                    !enabled ||
                    anchor !== current ||
                    !current.isConnected ||
                    generation !== expectedGeneration
                ) {
                    return;
                }
                card?.remove();
                card = createCard(editor.ownerDocument, result.summary, target);
                card.addEventListener("pointerenter", keepOpen);
                card.addEventListener("pointerleave", scheduleHide);
                overlay.append(card);
                position();
            })
            .catch(() => {
                // A summary endpoint may not be available on every MediaWiki site.
            });
    }

    function prefetch(expectedGeneration: number): void {
        prefetchTimer = 0;
        const current = anchor;
        const target = current == null ? null : readTarget(current);
        if (
            !enabled ||
            target == null ||
            !current?.isConnected ||
            generation !== expectedGeneration
        ) {
            return;
        }
        void lookup(target).catch(() => {
            // A summary endpoint may not be available on every MediaWiki site.
        });
    }

    function scheduleHover(): void {
        view.clearTimeout(prefetchTimer);
        view.clearTimeout(showTimer);
        const expectedGeneration = ++generation;
        prefetchTimer = view.setTimeout(
            () => prefetch(expectedGeneration),
            PREFETCH_DELAY,
        );
        const delay = normalizeDelay(options.delay);
        showTimer = view.setTimeout(() => show(expectedGeneration), delay);
    }

    function keepOpen(): void {
        view.clearTimeout(hideTimer);
        hideTimer = 0;
    }

    function scheduleHide(): void {
        view.clearTimeout(hideTimer);
        hideTimer = view.setTimeout(dismiss, HIDE_DELAY);
    }

    function handleOver(event: PointerEvent): void {
        if (!enabled || event.pointerType === "touch") {
            return;
        }
        const next = findPreviewAnchor(editor, event.target);
        if (next == null) {
            return;
        }
        if (
            next === anchor ||
            (card != null && samePreviewSource(next, anchor))
        ) {
            keepOpen();
            if (card == null) {
                pointerX = event.clientX;
                pointerY = event.clientY;
            }
            return;
        }
        dismiss();
        anchor = next;
        pointerX = event.clientX;
        pointerY = event.clientY;
        hoverX = event.clientX;
        hoverY = event.clientY;
        scheduleHover();
    }

    function handleMove(event: PointerEvent): void {
        if (
            !enabled ||
            event.pointerType === "touch" ||
            anchor == null ||
            findPreviewAnchor(editor, event.target) !== anchor
        ) {
            return;
        }
        if (card != null) {
            keepOpen();
            return;
        }
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (
            Math.hypot(event.clientX - hoverX, event.clientY - hoverY) <=
            MOVE_TOLERANCE
        ) {
            return;
        }
        hoverX = event.clientX;
        hoverY = event.clientY;
        scheduleHover();
    }

    function handleOut(event: PointerEvent): void {
        const from = findPreviewAnchor(editor, event.target);
        if (
            from == null ||
            (from !== anchor &&
                (card == null || !samePreviewSource(from, anchor)))
        ) {
            return;
        }
        const to = findPreviewAnchor(editor, event.relatedTarget);
        if (
            to === anchor ||
            (card != null &&
                (samePreviewSource(to, anchor) ||
                    containsTarget(card, event.relatedTarget)))
        ) {
            return;
        }
        if (card == null) {
            dismiss();
        } else {
            scheduleHide();
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            dismiss();
        }
    }

    editor.addEventListener("pointerover", handleOver);
    editor.addEventListener("pointermove", handleMove);
    editor.addEventListener("pointerout", handleOut);
    editor.addEventListener("scroll", position);
    editor.addEventListener("keydown", handleKeydown);
    view.addEventListener("resize", position);

    return {
        clearCache(): void {
            dismiss();
            cache.clear();
            inFlight.clear();
            refresh();
        },
        destroy(): void {
            dismiss();
            editor.removeEventListener("pointerover", handleOver);
            editor.removeEventListener("pointermove", handleMove);
            editor.removeEventListener("pointerout", handleOut);
            editor.removeEventListener("scroll", position);
            editor.removeEventListener("keydown", handleKeydown);
            view.removeEventListener("resize", position);
        },
        dismiss,
        refresh,
        setEnabled(value: boolean): void {
            enabled = value;
            if (!enabled) {
                dismiss();
            }
            refresh();
        },
    };
}

function createCard(
    document: Document,
    summary: PageSummary,
    previewTarget: PagePreviewTarget,
): HTMLElement {
    const card = document.createElement("aside");
    card.className = "wiked-lite-page-preview";
    card.role = "tooltip";
    const surface = document.createElement("div");
    surface.className = "wiked-lite-page-preview__surface";
    const tail = document.createElement("span");
    tail.className = "wiked-lite-page-preview__tail";
    tail.setAttribute("aria-hidden", "true");
    card.append(surface, tail);
    const title = document.createElement("a");
    title.className = "wiked-lite-page-preview__title";
    title.href = summary.pageUrl;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent =
        previewTarget.wiki === "local"
            ? summary.title
            : `${previewTarget.wiki}:${previewTarget.title}`;
    surface.append(title);
    if (summary.description != null && summary.description !== "") {
        const description = document.createElement("div");
        description.className = "wiked-lite-page-preview__description";
        description.textContent = summary.description;
        surface.append(description);
    }
    const extract = document.createElement("p");
    extract.className = "wiked-lite-page-preview__extract";
    extract.textContent = summary.extract;
    surface.append(extract);
    return card;
}

function readTarget(anchor: HTMLElement): PagePreviewTarget | null {
    const title = anchor.dataset.pagePreviewTitle?.trim();
    const wiki = anchor.dataset.pagePreviewWiki;
    return title != null &&
        title !== "" &&
        title.length <= 500 &&
        (wiki === "local" || (wiki != null && /^[a-z]{2}$/u.test(wiki)))
        ? { title, wiki }
        : null;
}

function cacheKey(target: PagePreviewTarget): string {
    return `${target.wiki}\u0000${target.title}`;
}

function findPreviewAnchor(
    editor: HTMLElement,
    target: EventTarget | null,
): HTMLElement | null {
    const anchor =
        eventElement(target)?.closest<HTMLElement>(
            "[data-page-preview-title]",
        ) ?? null;
    return anchor != null && editor.contains(anchor) ? anchor : null;
}

/** Highlighted characters can split one title into adjacent preview spans. */
function samePreviewSource(
    left: HTMLElement | null,
    right: HTMLElement | null,
): boolean {
    if (left == null || right == null) {
        return false;
    }
    if (left === right) {
        return true;
    }
    const matches = (element: HTMLElement): boolean =>
        element.dataset.pagePreviewTitle === left.dataset.pagePreviewTitle &&
        element.dataset.pagePreviewWiki === left.dataset.pagePreviewWiki;
    if (!matches(right)) {
        return false;
    }
    for (const direction of ["previousSibling", "nextSibling"] as const) {
        let sibling = left[direction];
        while (sibling?.nodeType === 1) {
            if (!matches(sibling as HTMLElement)) {
                break;
            }
            if (sibling === right) {
                return true;
            }
            sibling = sibling[direction];
        }
    }
    return false;
}

function containsTarget(
    parent: HTMLElement,
    target: EventTarget | null,
): boolean {
    return (
        target != null &&
        "nodeType" in target &&
        parent.contains(target as Node)
    );
}

function normalizeDelay(value: number | undefined): number {
    return Number.isFinite(value) && value != null
        ? Math.max(0, value)
        : DEFAULT_HOVER_DELAY;
}
