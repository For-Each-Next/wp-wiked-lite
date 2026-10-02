/**
 * @file tests/editor-history.test.ts
 * Purpose: tests / editor history.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    EditorHistory,
    getHistoryDirection,
} from "../src/features/editor/history.ts";

test("edit history restores source and selection across rerenders", () => {
    const history = new EditorHistory({ end: 3, source: "abc", start: 3 });
    history.setSelection(1, 1);
    history.record({ end: 2, source: "aXbc", start: 2 });

    assert.deepEqual(history.undo(), {
        end: 1,
        source: "abc",
        start: 1,
    });
    assert.deepEqual(history.redo(), {
        end: 2,
        source: "aXbc",
        start: 2,
    });
});

test("a new edit clears the redo branch", () => {
    const history = new EditorHistory({ end: 1, source: "a", start: 1 });
    history.record({ end: 2, source: "ab", start: 2 });
    assert.equal(history.undo()?.source, "a");

    history.record({ end: 2, source: "ac", start: 2 });

    assert.equal(history.redo(), null);
    assert.equal(history.undo()?.source, "a");
});

test("only platform undo and redo shortcuts are intercepted", () => {
    const shortcut = (key: string, overrides = {}) =>
        getHistoryDirection({
            altKey: false,
            ctrlKey: true,
            key,
            metaKey: false,
            shiftKey: false,
            ...overrides,
        });

    assert.equal(shortcut("z"), "undo");
    assert.equal(shortcut("Z", { shiftKey: true }), "redo");
    assert.equal(shortcut("y"), "redo");
    assert.equal(
        shortcut("z", { ctrlKey: false, metaKey: true, shiftKey: true }),
        "redo",
    );
    assert.equal(shortcut("f"), null);
    assert.equal(shortcut("z", { altKey: true }), null);
    assert.equal(shortcut("z", { ctrlKey: false }), null);
    assert.equal(shortcut("z", { metaKey: true }), null);
});
