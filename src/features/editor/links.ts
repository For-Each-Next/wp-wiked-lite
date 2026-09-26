/** Separates modified link clicks from editor selection gestures. */

import { eventElement } from "./dom.ts";

const CLICK_MOVEMENT_TOLERANCE = 4;

interface LinkNavigationController {
    destroy(): void;
    setEnabled(enabled: boolean): void;
}

/** Attaches link navigation while preserving native selection. */
export function attachModifiedLinkNavigation(
    editor: HTMLElement,
    enabled = true,
): LinkNavigationController {
    let pressed: MouseEvent | null = null;
    let link: HTMLElement | null = null;

    function reset(): void {
        pressed = null;
        link = null;
    }

    function begin(event: MouseEvent): void {
        reset();
        if (!enabled || !isModifiedClick(event) || hasSelection(editor)) {
            return;
        }
        link = getLink(event.target);
        if (link != null && editor.contains(link)) {
            pressed = event;
        }
    }

    function moved(event: MouseEvent): void {
        if (pressed != null && exceedsClickMovement(pressed, event)) {
            reset();
        }
    }

    function open(event: MouseEvent): void {
        const start = pressed;
        const target = link;
        reset();
        if (
            !enabled ||
            start == null ||
            target?.dataset.href == null ||
            getLink(event.target) !== target ||
            !isModifiedClick(event) ||
            exceedsClickMovement(start, event) ||
            hasSelection(editor)
        ) {
            return;
        }
        event.preventDefault();
        window.open(target.dataset.href, "_blank", "noopener,noreferrer");
    }

    editor.addEventListener("mousedown", begin);
    editor.addEventListener("mousemove", moved);
    editor.addEventListener("click", open);
    editor.addEventListener("mouseleave", reset);
    editor.addEventListener("dragstart", reset);
    editor.addEventListener("blur", reset);
    editor.addEventListener("keydown", reset);
    return {
        destroy(): void {
            enabled = false;
            reset();
            editor.removeEventListener("mousedown", begin);
            editor.removeEventListener("mousemove", moved);
            editor.removeEventListener("click", open);
            editor.removeEventListener("mouseleave", reset);
            editor.removeEventListener("dragstart", reset);
            editor.removeEventListener("blur", reset);
            editor.removeEventListener("keydown", reset);
        },
        setEnabled(value: boolean): void {
            enabled = value;
            reset();
        },
    };
}

function isModifiedClick(event: MouseEvent): boolean {
    return (
        !event.defaultPrevented &&
        event.button === 0 &&
        event.detail === 1 &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey
    );
}

function hasSelection(editor: HTMLElement): boolean {
    return editor.ownerDocument.getSelection()?.isCollapsed === false;
}

function exceedsClickMovement(start: MouseEvent, end: MouseEvent): boolean {
    return (
        Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) >
        CLICK_MOVEMENT_TOLERANCE
    );
}

function getLink(target: EventTarget | null): HTMLElement | null {
    return eventElement(target)?.closest<HTMLElement>("[data-href]") ?? null;
}
