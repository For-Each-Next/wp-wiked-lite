/**
 * @file tests/reference-changes.test.ts
 * Purpose: tests / reference changes.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. apply
 * 3. citationEditor
 * 4. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceChangeTracker } from "../src/domain/reference-changes.ts";
import {
    buildReferenceFieldInsertion,
    buildReferenceFieldReplacement,
    buildReferenceFieldRename,
    buildReferenceFieldUpdate,
    buildReferencePreview,
    type ReferenceEditRange,
    type ReferenceReplacement,
} from "../src/domain/reference-preview.ts";
import { wikitext } from "../src/domain/wikitext/index.ts";

function apply(source: string, replacement: ReferenceReplacement): string {
    return (
        source.slice(0, replacement.start) +
        replacement.value +
        source.slice(replacement.end)
    );
}

function citationEditor(initial: string) {
    const tracker = new ReferenceChangeTracker();
    let source = initial;
    tracker.synchronize(source);
    function preview() {
        const citation = wikitext(source)
            .template.getAll()
            .find((call) => call.name.startsWith("cite"));
        assert.ok(citation);
        const preview = buildReferencePreview(
            source,
            citation.raw,
            null,
            citation.start,
        );
        assert.ok(preview?.citationRange);
        return preview;
    }
    function field(name: string) {
        const field = preview()
            .rows.flatMap((row) => row.fields)
            .find((field) => field.name === name);
        assert.ok(field?.range, `Expected field ${name} in ${source}`);
        return { ...field, range: field.range };
    }
    return {
        get source() {
            return source;
        },
        tracker,
        change(name: string) {
            const change = tracker.getChange(field(name).range);
            return change == null
                ? null
                : {
                      added: change.added,
                      originalValue: change.originalValue,
                      ...(change.originalName == null
                          ? {}
                          : { originalName: change.originalName }),
                  };
        },
        flags(name: string) {
            const change = tracker.getChange(field(name).range);
            return change == null
                ? null
                : {
                      nameChanged: change.nameChanged,
                      valueChanged: change.valueChanged,
                  };
        },
        edit(name: string, value: string) {
            const range = field(name).range;
            const replacement = buildReferenceFieldReplacement(
                source,
                range,
                value,
            );
            tracker.recordReplacement(source, replacement, {
                kind: "edit",
                range,
            });
            source = apply(source, replacement);
            tracker.synchronize(source);
        },
        insert(name: string, value: string, before?: string) {
            const citationRange = preview().citationRange!;
            const replacement = buildReferenceFieldInsertion(
                source,
                citationRange,
                name,
                value,
                before == null ? undefined : field(before).range,
            );
            assert.ok(replacement);
            tracker.recordReplacement(source, replacement, {
                kind: "insert",
                name,
                citationRange,
            });
            source = apply(source, replacement);
            tracker.synchronize(source);
        },
        rename(name: string, next: string) {
            const range = field(name).range;
            const citationRange = preview().citationRange!;
            const replacement = buildReferenceFieldRename(
                source,
                citationRange,
                range,
                next,
            );
            assert.ok(replacement);
            tracker.recordReplacement(source, replacement, {
                kind: "rename",
                range,
                citationRange,
            });
            source = apply(source, replacement);
            tracker.synchronize(source);
        },
        update(name: string, next: string, value: string) {
            const range = field(name).range;
            const citationRange = preview().citationRange!;
            const replacement = buildReferenceFieldUpdate(
                source,
                citationRange,
                range,
                next,
                value,
            );
            assert.ok(replacement);
            tracker.recordReplacement(source, replacement, {
                kind: "update",
                range,
                citationRange,
            });
            source = apply(source, replacement);
            tracker.synchronize(source);
        },
        reset(name: string) {
            const range = field(name).range;
            const replacement = tracker.getReset(range);
            assert.ok(replacement, `Expected reset for ${name} in ${source}`);
            tracker.recordReplacement(source, replacement, {
                kind: "reset",
                range,
            });
            source = apply(source, replacement);
            tracker.synchronize(source);
        },
        native(value: string) {
            source = value;
            tracker.synchronize(source);
        },
    };
}

test("repeated gadget edits retain the first original value and reset exact source bytes", () => {
    const initial =
        "Prefix {{cite web\n| title =  Original  \n| year = 2024\n}} suffix";
    const editor = citationEditor(initial);
    editor.edit("title", "Changed");
    editor.edit("title", "Changed again");
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.reset("title");
    assert.equal(editor.source, initial);
    assert.equal(editor.change("title"), null);
});

test("no-op edits do not mark fields and applying the original value clears a mark", () => {
    const editor = citationEditor("{{cite web|title=Original|year=2024}}");
    editor.edit("title", "Original");
    assert.equal(editor.change("title"), null);
    editor.edit("title", "Changed");
    editor.edit("title", "Original");
    assert.equal(editor.change("title"), null);
});

test("edits before and after other fields rebase marks without changing original values", () => {
    const editor = citationEditor(
        "{{cite web|title=Book|url=https://example.test|year=2024}}",
    );
    editor.edit("year", "2025–2026");
    editor.edit("title", "A much longer title");
    editor.edit("url", "https://other.test/long/path");
    assert.deepEqual(editor.change("year"), {
        added: false,
        originalValue: "2024",
    });
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Book",
    });
    editor.reset("title");
    editor.reset("year");
    assert.deepEqual(editor.change("url"), {
        added: false,
        originalValue: "https://example.test",
    });
    editor.reset("url");
    assert.equal(
        editor.source,
        "{{cite web|title=Book|url=https://example.test|year=2024}}",
    );
});

test("empty values remain marked and can reset while preserving surrounding whitespace", () => {
    const initial = "{{cite web\n| title= Original \n|year=2024\n}}";
    const editor = citationEditor(initial);
    editor.edit("title", "");
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.edit("title", "Later");
    editor.reset("title");
    assert.equal(editor.source, initial);
});

test("adding fields adjacent to modified fields retains all marks", () => {
    const editor = citationEditor("{{cite web|title=Original|year=2024}}");
    editor.edit("year", "2025");
    editor.insert("publisher", "Example");
    editor.edit("title", "Changed");
    editor.insert("author", "Name", "year");
    assert.deepEqual(editor.change("year"), {
        added: false,
        originalValue: "2024",
    });
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    assert.deepEqual(editor.change("publisher"), {
        added: true,
        originalValue: "",
    });
    assert.deepEqual(editor.change("author"), {
        added: true,
        originalValue: "",
    });
});

test("added fields reset independently after editing and inserting neighboring fields", () => {
    const orders = [
        ["publisher", "author", "year"],
        ["publisher", "year", "author"],
        ["author", "publisher", "year"],
        ["author", "year", "publisher"],
        ["year", "publisher", "author"],
        ["year", "author", "publisher"],
    ];
    for (const initial of [
        "{{cite web|title=Original}}",
        "{{cite web\n |title=Original\n}}",
        "{{cite web\n| title = Original}}",
    ]) {
        for (const order of orders) {
            const editor = citationEditor(initial);
            editor.insert("publisher", "Example");
            editor.edit("publisher", "Changed publisher");
            editor.insert("author", "Name", "publisher");
            editor.insert("year", "2024");
            for (const [index, name] of order.entries()) {
                assert.deepEqual(editor.change(name), {
                    added: true,
                    originalValue: "",
                });
                editor.reset(name);
                for (const remaining of order.slice(index + 1)) {
                    assert.deepEqual(editor.change(remaining), {
                        added: true,
                        originalValue: "",
                    });
                }
            }
            assert.equal(editor.source, initial);
        }
    }
});

test("empty newly added fields can be edited and reset", () => {
    for (const initial of [
        "{{cite web|title=Book}}",
        "{{cite web\n| title = Book\n}}",
    ]) {
        const editor = citationEditor(initial);
        editor.insert("publisher", "");
        assert.deepEqual(editor.change("publisher"), {
            added: true,
            originalValue: "",
        });
        editor.edit("publisher", "New value");
        editor.edit("publisher", "");
        assert.deepEqual(editor.change("publisher"), {
            added: true,
            originalValue: "",
        });
        editor.reset("publisher");
        assert.equal(editor.source, initial);
    }
});

test("cleared field marks survive additions that move trailing whitespace to another parameter", () => {
    const initial = "{{cite web\n|title=Original\n}}";
    const editor = citationEditor(initial);
    editor.edit("title", "");
    editor.insert("year", "2024");
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.reset("title");
    assert.equal(editor.source, "{{cite web\n|title=Original\n|year=2024\n}}");
    editor.reset("year");
    assert.equal(editor.source, initial);
});

test("blank newly added fields retain their own reset after neighboring additions", () => {
    const initial = "{{cite web\n|title=Book\n}}";
    const editor = citationEditor(initial);
    editor.insert("publisher", "");
    editor.insert("year", "2024");
    editor.insert("author", "Name", "publisher");
    assert.deepEqual(editor.change("publisher"), {
        added: true,
        originalValue: "",
    });
    editor.reset("publisher");
    assert.deepEqual(editor.change("year"), { added: true, originalValue: "" });
    assert.deepEqual(editor.change("author"), {
        added: true,
        originalValue: "",
    });
    editor.reset("year");
    editor.reset("author");
    assert.equal(editor.source, initial);
});

test("undo and redo restore gadget marks and original values for edits additions and reset", () => {
    const editor = citationEditor("{{cite web|title=Original}}");
    const original = editor.source;
    editor.edit("title", "Changed");
    const changed = editor.source;
    editor.insert("year", "2024");
    const added = editor.source;
    editor.reset("title");
    const reset = editor.source;
    editor.native(added);
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    assert.deepEqual(editor.change("year"), { added: true, originalValue: "" });
    editor.native(original);
    assert.equal(editor.change("title"), null);
    editor.native(changed);
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.native(added);
    editor.native(reset);
    assert.equal(editor.change("title"), null);
    assert.deepEqual(editor.change("year"), { added: true, originalValue: "" });
});

test("unrelated native changes rebase marks and touched fields discard stale resets", () => {
    const editor = citationEditor(
        "Before {{cite web|title=Original|year=2024}} after",
    );
    editor.edit("title", "Changed");
    const changed = editor.source;
    editor.native(editor.source.replace("Before", "A longer prefix"));
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.native(editor.source.replace("Changed", "User text"));
    assert.equal(editor.change("title"), null);
    editor.native(changed);
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.reset("title");
    assert.equal(
        editor.source,
        "Before {{cite web|title=Original|year=2024}} after",
    );
});

test("a branch after undo does not restore discarded future field history", () => {
    const editor = citationEditor("{{cite web|title=Original|year=2024}}");
    const original = editor.source;
    editor.edit("title", "Old future");
    const oldFuture = editor.source;
    editor.native(original);
    editor.edit("year", "2025");
    editor.native(oldFuture);
    assert.equal(editor.change("title"), null);
    assert.equal(editor.change("year"), null);
});

test("quoted and unquoted details reset their original bytes after repeated edits", () => {
    for (const initial of [
        "<ref details=Original>Note</ref>",
        '<ref details="  Original  ">Note</ref>',
        "<ref details='Original'>Note</ref>",
    ]) {
        let source = initial;
        const tracker = new ReferenceChangeTracker();
        for (const value of ['Changed "quotes"', "Later", ""]) {
            const range = buildReferencePreview(
                source,
                source,
                null,
                0,
            )?.detailsRange;
            assert.ok(range);
            const replacement = buildReferenceFieldReplacement(
                source,
                range,
                value,
            );
            tracker.recordReplacement(source, replacement, {
                kind: "edit",
                range,
            });
            source = apply(source, replacement);
            tracker.synchronize(source);
        }
        // Blank details are not rendered, so recover the empty attribute value range.
        const quote = source.includes('details="') ? '"' : "'";
        const start = source.indexOf(quote, source.indexOf("details=")) + 1;
        const end = source.indexOf(quote, start);
        const whitespace = source.slice(start, end);
        const empty: ReferenceEditRange = { start: end, end, quote };
        assert.equal(whitespace.trim(), "");
        assert.deepEqual(tracker.getChange(empty), {
            added: false,
            nameChanged: false,
            valueChanged: true,
            originalValue: "Original",
        });
        const replacement = tracker.getReset(empty);
        assert.ok(replacement);
        tracker.recordReplacement(source, replacement, {
            kind: "reset",
            range: empty,
        });
        assert.equal(apply(source, replacement), initial);
    }
});

test("raw notes and positional efn notes retain their original text through reset", () => {
    for (const initial of [
        "<ref>  Original  </ref>",
        "{{efn|  Original  |name=context}}",
    ]) {
        const tracker = new ReferenceChangeTracker();
        const range = buildReferencePreview(
            initial,
            initial,
            null,
            0,
        )?.noteRange;
        assert.ok(range);
        const replacement = buildReferenceFieldReplacement(
            initial,
            range,
            "A | B=C",
        );
        tracker.recordReplacement(initial, replacement, {
            kind: "edit",
            range,
        });
        const source = apply(initial, replacement);
        tracker.synchronize(source);
        const current = buildReferencePreview(
            source,
            source,
            null,
            0,
        )?.noteRange;
        assert.ok(current);
        assert.deepEqual(tracker.getChange(current), {
            added: false,
            nameChanged: false,
            valueChanged: true,
            originalValue: "Original",
        });
        const reset = tracker.getReset(current);
        assert.ok(reset);
        assert.equal(apply(source, reset), initial);
    }
});

test("long edit histories remain valid when the retained transition window advances", () => {
    const editor = citationEditor("{{cite web|title=Original}}");
    for (let index = 0; index < 520; index += 1) {
        editor.edit("title", `Change ${index}`);
    }
    const final = editor.source;
    editor.native("{{cite web|title=Change 518}}");
    assert.deepEqual(editor.change("title"), {
        added: false,
        originalValue: "Original",
    });
    editor.native(final);
    editor.reset("title");
    assert.equal(editor.source, "{{cite web|title=Original}}");
});

test("rename and value edits retain one original field baseline across repeated changes", () => {
    const initial = "{{cite web\n | title =  Original  \n |year=2024\n}}";
    const editor = citationEditor(initial);
    editor.edit("title", "Changed");
    editor.rename("title", "chapter");
    editor.edit("chapter", "Changed again");
    editor.rename("chapter", "work");
    assert.deepEqual(editor.change("work"), {
        added: false,
        originalName: "title",
        originalValue: "Original",
    });
    editor.insert("publisher", "Example");
    editor.reset("work");
    assert.equal(
        editor.source,
        "{{cite web\n | title =  Original  \n |year=2024\n |publisher=Example\n}}",
    );
    editor.reset("publisher");
    assert.equal(editor.source, initial);
});

test("renamed added fields remain independently removable after value edits", () => {
    const initial = "{{cite web|title=Original}}";
    const editor = citationEditor(initial);
    editor.insert("publisher", "Example");
    editor.rename("publisher", "work");
    editor.edit("work", "Changed");
    editor.insert("year", "2024");
    assert.deepEqual(editor.change("work"), { added: true, originalValue: "" });
    editor.reset("work");
    assert.deepEqual(editor.change("year"), { added: true, originalValue: "" });
    editor.reset("year");
    assert.equal(editor.source, initial);
});

test("implicit rename preserves sibling marks and reset restores original field meaning", () => {
    const editor = citationEditor("{{cite book|First|Second|Third}}");
    editor.edit("2", "Second changed");
    editor.edit("3", "Third changed");
    const beforeRename = editor.source;
    editor.rename("1", "author");
    const afterRename = editor.source;
    assert.deepEqual(editor.change("author"), {
        added: false,
        originalName: "1",
        originalValue: "First",
    });
    assert.deepEqual(editor.change("2"), {
        added: false,
        originalValue: "Second",
    });
    assert.deepEqual(editor.change("3"), {
        added: false,
        originalValue: "Third",
    });
    editor.native(beforeRename);
    assert.equal(
        editor.source,
        "{{cite book|First|Second changed|Third changed}}",
    );
    assert.equal(editor.change("1"), null);
    assert.deepEqual(editor.change("2"), {
        added: false,
        originalValue: "Second",
    });
    editor.native(afterRename);
    assert.deepEqual(editor.change("author"), {
        added: false,
        originalName: "1",
        originalValue: "First",
    });
    editor.reset("author");
    editor.reset("2");
    editor.reset("3");
    assert.equal(editor.source, "{{cite book|First|2=Second|3=Third}}");
});

test("renaming back removes a mark and undo redo restore rename state", () => {
    const editor = citationEditor("{{cite web|title=Original|year=2024}}");
    const original = editor.source;
    editor.rename("title", "chapter");
    const renamed = editor.source;
    editor.rename("chapter", "title");
    assert.equal(editor.source, original);
    assert.equal(editor.change("title"), null);
    editor.native(renamed);
    assert.deepEqual(editor.change("chapter"), {
        added: false,
        originalName: "title",
        originalValue: "Original",
    });
    editor.native(original);
    assert.equal(editor.change("title"), null);
});

test("blank renamed fields retain reset when adding another parameter", () => {
    const initial = "{{cite web\n|title=\n}}";
    const editor = citationEditor(initial);
    editor.rename("title", "chapter");
    editor.insert("year", "2024");
    assert.deepEqual(editor.change("chapter"), {
        added: false,
        originalName: "title",
        originalValue: "",
    });
    editor.reset("chapter");
    editor.reset("year");
    assert.equal(editor.source, initial);
});

test("change flags distinguish name-only value-only and combined edits against the first baseline", () => {
    const editor = citationEditor("{{cite web|title=Original}}");
    editor.rename("title", "chapter");
    assert.deepEqual(editor.flags("chapter"), {
        nameChanged: true,
        valueChanged: false,
    });
    editor.edit("chapter", "Changed");
    assert.deepEqual(editor.flags("chapter"), {
        nameChanged: true,
        valueChanged: true,
    });
    editor.rename("chapter", "title");
    assert.deepEqual(editor.flags("title"), {
        nameChanged: false,
        valueChanged: true,
    });
    editor.edit("title", "Original");
    assert.equal(editor.flags("title"), null);
    editor.insert("publisher", "");
    assert.deepEqual(editor.flags("publisher"), {
        nameChanged: true,
        valueChanged: false,
    });
    editor.edit("publisher", "Example");
    assert.deepEqual(editor.flags("publisher"), {
        nameChanged: true,
        valueChanged: true,
    });
});

test("atomic name and value updates reset both components and restore together through undo", () => {
    const initial = "{{cite web\n | title =  Original  \n |year=2024\n}}";
    const editor = citationEditor(initial);
    editor.edit("year", "2025");
    const before = editor.source;
    editor.update("title", "chapter", "Changed | text");
    const combined = editor.source;
    assert.deepEqual(editor.flags("chapter"), {
        nameChanged: true,
        valueChanged: true,
    });
    assert.deepEqual(editor.change("chapter"), {
        added: false,
        originalName: "title",
        originalValue: "Original",
    });
    assert.deepEqual(editor.flags("year"), {
        nameChanged: false,
        valueChanged: true,
    });
    editor.native(before);
    assert.equal(editor.change("title"), null);
    editor.native(combined);
    assert.deepEqual(editor.flags("chapter"), {
        nameChanged: true,
        valueChanged: true,
    });
    editor.update("chapter", "work", "Changed again");
    editor.reset("work");
    assert.equal(editor.source, before);
    editor.reset("year");
    assert.equal(editor.source, initial);
});

test("atomic updates preserve added-field removal and component no-ops", () => {
    const initial = "{{cite web|title=Original}}";
    const editor = citationEditor(initial);
    editor.update("title", "title", "Original");
    assert.equal(editor.flags("title"), null);
    editor.update("title", "title", "Changed");
    assert.deepEqual(editor.flags("title"), {
        nameChanged: false,
        valueChanged: true,
    });
    editor.update("title", "title", "Original");
    assert.equal(editor.flags("title"), null);
    editor.insert("publisher", "Example");
    editor.update("publisher", "work", "Other");
    assert.deepEqual(editor.flags("work"), {
        nameChanged: true,
        valueChanged: true,
    });
    editor.reset("work");
    assert.equal(editor.source, initial);
});
