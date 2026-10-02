/**
 * @file tests/editor-lifecycle.test.ts
 * Purpose: Native-source editor lifecycle behavior.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    createCompositionSubmitHandler,
    restoreNativeSelectionAndFocus,
} from "../src/features/editor/lifecycle.ts";

test("submitting during composition flushes native source first", () => {
    const events: string[] = [];
    const snapshots: Array<{ end: number; source: string; start: number }> = [];
    let nativeSource = "stale source";
    const flushComposition = createCompositionSubmitHandler({
        dispatchInput() {
            events.push("input");
        },
        isComposing: () => true,
        readEditorSnapshot() {
            events.push("read");
            return { end: 11, source: "new 文本", start: 4 };
        },
        recordSnapshot(snapshot) {
            events.push("history");
            snapshots.push(snapshot);
        },
        writeNativeSource(source) {
            events.push("write");
            nativeSource = source;
        },
    });

    flushComposition();
    const submittedSource = nativeSource;

    assert.equal(submittedSource, "new 文本");
    assert.deepEqual(snapshots, [{ end: 11, source: "new 文本", start: 4 }]);
    assert.deepEqual(events, ["read", "write", "history", "input"]);
});

test("teardown restores native selection and focus", () => {
    const events: Array<string | [number, number]> = [];

    restoreNativeSelectionAndFocus(
        {
            focus() {
                events.push("focus");
            },
            isAvailable: () => true,
            setSelection(start, end) {
                events.push([start, end]);
            },
        },
        { end: 9, start: 3 },
    );

    assert.deepEqual(events, [[3, 9], "focus"]);
});

test("inactive lifecycle paths do not mutate native state", () => {
    let mutationCount = 0;
    const flushComposition = createCompositionSubmitHandler({
        dispatchInput() {
            mutationCount += 1;
        },
        isComposing: () => false,
        readEditorSnapshot() {
            mutationCount += 1;
            return { end: 0, source: "unused", start: 0 };
        },
        recordSnapshot() {
            mutationCount += 1;
        },
        writeNativeSource() {
            mutationCount += 1;
        },
    });
    const focusPorts = {
        focus() {
            mutationCount += 1;
        },
        isAvailable: () => false,
        setSelection() {
            mutationCount += 1;
        },
    };

    flushComposition();
    restoreNativeSelectionAndFocus(focusPorts, { end: 1, start: 0 });
    restoreNativeSelectionAndFocus(focusPorts, null);

    assert.equal(mutationCount, 0);
});
