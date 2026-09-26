import assert from "node:assert/strict";
import test from "node:test";
import { selectSourceEditor } from "../src/domain/editor-selection.ts";

test("wikEd Lite is selected only for wikitext edit actions", () => {
    assert.deepEqual(selectSourceEditor("wikitext", "edit"), {
        editor: "wiked-lite",
    });
    assert.deepEqual(selectSourceEditor("wikitext", "submit", "lua"), {
        editor: "wiked-lite",
    });
    assert.deepEqual(selectSourceEditor("wikitext", "view"), {
        editor: "none",
    });
});

test("non-wikitext models remain native unless CodeMirror is enabled", () => {
    const fixtures = [
        ["Scribunto", "lua"],
        ["css", "css"],
        ["sanitized-css", "css"],
        ["javascript", "javascript"],
        ["json", "json"],
        ["JsonConfig", "json"],
        ["GadgetDefinition", "json"],
        ["vue", "vue"],
        ["unknown-code-model", null],
    ] as const;

    for (const [contentModel, mode] of fixtures) {
        assert.deepEqual(selectSourceEditor(contentModel, "edit"), {
            editor: "none",
        });
        assert.deepEqual(selectSourceEditor(contentModel, "edit", "", true), {
            editor: "codemirror",
            mode,
        });
    }
});

test("MediaWiki's configured CodeMirror mode supports custom models", () => {
    assert.deepEqual(selectSourceEditor("custom-code", "edit", "Lua", true), {
        editor: "codemirror",
        mode: "lua",
    });
    assert.deepEqual(selectSourceEditor("custom-code", "view", "Lua", true), {
        editor: "none",
    });
});
