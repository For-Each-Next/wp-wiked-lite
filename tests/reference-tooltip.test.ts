/**
 * @file tests/reference-tooltip.test.ts
 * Purpose: tests / reference tooltip.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. rect
 * 3. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    calculatePreviewPlacement,
    type PreviewRect,
    selectPreviewRect,
} from "../src/features/editor/preview-position.ts";

function rect(
    left: number,
    top: number,
    width: number,
    height: number,
): PreviewRect {
    return {
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
    };
}

test("reference tooltips prefer space above their anchor", () => {
    const placement = calculatePreviewPlacement(
        rect(100, 300, 40, 20),
        { height: 100, width: 200 },
        { height: 800, width: 1000 },
    );

    assert.equal(placement.side, "above");
    assert.equal(placement.left, 94);
    assert.equal(placement.tailLeft, 26);
    assert.equal(placement.bridgeLeft, 0);
    assert.equal(placement.bridgeWidth, 200);
});

test("reference tooltips flip below near the viewport top", () => {
    const placement = calculatePreviewPlacement(
        rect(100, 20, 40, 20),
        { height: 100, width: 200 },
        { height: 800, width: 1000 },
    );

    assert.equal(placement.side, "below");
    assert.equal(placement.bridgeLeft, 0);
    assert.equal(placement.bridgeWidth, 200);
});

test("constrained tooltips use the larger side and cap their height", () => {
    const placement = calculatePreviewPlacement(
        rect(100, 200, 40, 20),
        { height: 300, width: 200 },
        { height: 350, width: 1000 },
    );

    assert.equal(placement.side, "above");
    assert.equal(placement.maxHeight, 178);
});

test("tooltip bodies and tails stay inside horizontal edges", () => {
    const left = calculatePreviewPlacement(
        rect(0, 300, 10, 20),
        { height: 100, width: 200 },
        { height: 800, width: 400 },
    );
    const right = calculatePreviewPlacement(
        rect(390, 300, 10, 20),
        { height: 100, width: 200 },
        { height: 800, width: 400 },
    );

    assert.equal(left.left, 12);
    assert.equal(left.tailLeft, 18);
    assert.equal(left.bridgeLeft, -12);
    assert.equal(left.bridgeWidth, 212);
    assert.equal(right.left, 188);
    assert.equal(right.tailLeft, 182);
    assert.equal(right.bridgeLeft, 0);
    assert.equal(right.bridgeWidth, 212);
});

test("tooltip hover bridges cover long reference lines", () => {
    const placement = calculatePreviewPlacement(
        rect(10, 300, 500, 20),
        { height: 100, width: 200 },
        { height: 800, width: 600 },
    );

    assert.equal(placement.side, "above");
    assert.equal(placement.left, 234);
    assert.equal(placement.bridgeLeft, -224);
    assert.equal(placement.bridgeWidth, 500);
});

test("wrapped references anchor to the line under the pointer", () => {
    const first = rect(10, 20, 80, 16);
    const second = rect(10, 40, 100, 16);

    assert.equal(selectPreviewRect([first, second], 48), second);
    assert.equal(selectPreviewRect([first, second], 70), first);
});

test("preview tails point at the activation position instead of the line midpoint", () => {
    for (const preferredSide of ["above", "below"] as const) {
        for (const pointerX of [100, 250, 420]) {
            const placement = calculatePreviewPlacement(
                rect(80, 300, 400, 20),
                { height: 100, width: 200 },
                { height: 800, width: 1000 },
                pointerX,
                preferredSide,
            );

            assert.equal(placement.side, preferredSide);
            assert.equal(placement.left + placement.tailLeft, pointerX);
        }
    }
});

test("preview tails point at the activation position when the body meets the frame edge", () => {
    const placement = calculatePreviewPlacement(
        rect(250, 300, 150, 20),
        { height: 100, width: 200 },
        { height: 800, width: 400 },
        350,
    );

    assert.equal(placement.left, 188);
    assert.equal(placement.left + placement.tailLeft, 350);

    for (const pointerX of [0, 400]) {
        const edge = calculatePreviewPlacement(
            rect(0, 300, 400, 20),
            { height: 100, width: 200 },
            { height: 800, width: 400 },
            pointerX,
        );
        assert.equal(edge.left + edge.tailLeft, pointerX === 0 ? 30 : 370);
    }
});

test("page previews flip above and constrain height when space below runs out", () => {
    const placement = calculatePreviewPlacement(
        rect(100, 300, 40, 20),
        { height: 400, width: 200 },
        { height: 400, width: 500 },
        110,
        "below",
    );

    assert.equal(placement.side, "above");
    assert.equal(placement.maxHeight, 278);
});

test("bidirectional line fragments use both pointer coordinates", () => {
    const left = rect(10, 20, 80, 16);
    const right = rect(150, 20, 100, 16);

    assert.equal(selectPreviewRect([left, right], 28, 180), right);
    assert.equal(selectPreviewRect([left, right], 28, 40), left);
    assert.equal(selectPreviewRect([], 28, 40), undefined);
});
