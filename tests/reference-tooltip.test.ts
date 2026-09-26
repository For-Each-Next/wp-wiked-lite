import assert from "node:assert/strict";
import test from "node:test";
import {
    calculateReferenceTooltipPlacement,
    type ReferenceTooltipRect,
    selectReferenceTooltipRect,
} from "../src/features/editor/reference-tooltip.ts";

function rect(
    left: number,
    top: number,
    width: number,
    height: number,
): ReferenceTooltipRect {
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
    const placement = calculateReferenceTooltipPlacement(
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
    const placement = calculateReferenceTooltipPlacement(
        rect(100, 20, 40, 20),
        { height: 100, width: 200 },
        { height: 800, width: 1000 },
    );

    assert.equal(placement.side, "below");
    assert.equal(placement.bridgeLeft, 0);
    assert.equal(placement.bridgeWidth, 200);
});

test("constrained tooltips use the larger side and cap their height", () => {
    const placement = calculateReferenceTooltipPlacement(
        rect(100, 200, 40, 20),
        { height: 300, width: 200 },
        { height: 350, width: 1000 },
    );

    assert.equal(placement.side, "above");
    assert.equal(placement.maxHeight, 178);
});

test("tooltip bodies and tails stay inside horizontal edges", () => {
    const left = calculateReferenceTooltipPlacement(
        rect(0, 300, 10, 20),
        { height: 100, width: 200 },
        { height: 800, width: 400 },
    );
    const right = calculateReferenceTooltipPlacement(
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
    const placement = calculateReferenceTooltipPlacement(
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

    assert.equal(selectReferenceTooltipRect([first, second], 48), second);
    assert.equal(selectReferenceTooltipRect([first, second], 70), first);
});
