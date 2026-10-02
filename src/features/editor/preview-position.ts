/**
 * @file src/features/editor/preview-position.ts
 * Purpose: Shared frame-safe geometry for article and reference hover previews.
 *
 * Table of contents:
 * 1. PreviewRect
 * 2. PreviewPlacement
 * 3. PreviewSize
 * 4. Constants and state
 * 5. calculatePreviewPlacement
 * 6. selectPreviewRect
 * 7. selectSide
 * 8. clamp
 */

export interface PreviewRect {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
}

export interface PreviewPlacement {
    bridgeLeft: number;
    bridgeWidth: number;
    left: number;
    maxHeight: number;
    side: "above" | "below";
    tailLeft: number;
}

interface PreviewSize {
    height: number;
    width: number;
}

const VIEWPORT_MARGIN = 12;
export const PREVIEW_ANCHOR_GAP = 10;
const DEFAULT_TAIL_CENTER = 26;
const MINIMUM_TAIL_INSET = 18;

/** Points at the activation position, keeping the body and tail in the frame. */
export function calculatePreviewPlacement(
    anchor: PreviewRect,
    preview: PreviewSize,
    viewport: PreviewSize,
    pointerX?: number,
    preferredSide: PreviewPlacement["side"] = "above",
): PreviewPlacement {
    const above = Math.max(
        0,
        anchor.top - VIEWPORT_MARGIN - PREVIEW_ANCHOR_GAP,
    );
    const below = Math.max(
        0,
        viewport.height - anchor.bottom - VIEWPORT_MARGIN - PREVIEW_ANCHOR_GAP,
    );
    const side = selectSide(preview.height, above, below, preferredSide);
    const targetX =
        pointerX == null
            ? anchor.left + anchor.width / 2
            : clamp(pointerX, anchor.left, anchor.right);
    const maximumLeft = viewport.width - preview.width - VIEWPORT_MARGIN;
    const left = clamp(
        targetX - DEFAULT_TAIL_CENTER,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, maximumLeft),
    );
    const tailLeft = clamp(
        targetX - left,
        MINIMUM_TAIL_INSET,
        Math.max(MINIMUM_TAIL_INSET, preview.width - MINIMUM_TAIL_INSET),
    );
    const bridgeLeft = Math.max(0, Math.min(left, anchor.left));
    const bridgeRight = Math.min(
        viewport.width,
        Math.max(left + preview.width, anchor.right),
    );
    return {
        bridgeLeft: bridgeLeft - left,
        bridgeWidth: bridgeRight - bridgeLeft,
        left,
        maxHeight: side === "above" ? above : below,
        side,
        tailLeft,
    };
}

/** Selects the hovered line, including separate fragments in bidirectional text. */
export function selectPreviewRect(
    rects: readonly PreviewRect[],
    pointerY?: number,
    pointerX?: number,
): PreviewRect | undefined {
    const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0);
    const line = visible.filter(
        (rect) =>
            pointerY != null && rect.top <= pointerY && pointerY <= rect.bottom,
    );
    return (
        line.find(
            (rect) =>
                pointerX != null &&
                rect.left <= pointerX &&
                pointerX <= rect.right,
        ) ??
        line[0] ??
        visible[0]
    );
}

function selectSide(
    height: number,
    above: number,
    below: number,
    preferred: PreviewPlacement["side"],
): PreviewPlacement["side"] {
    if (height <= (preferred === "above" ? above : below)) {
        return preferred;
    }
    if (height <= (preferred === "above" ? below : above)) {
        return preferred === "above" ? "below" : "above";
    }
    return above >= below ? "above" : "below";
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}
