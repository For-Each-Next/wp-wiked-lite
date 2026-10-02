/**
 * @file tests/reference-edit.test.ts
 * Purpose: tests / reference edit.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. applyReplacement
 * 3. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    buildReferenceFieldInsertion,
    buildReferenceFieldReplacement,
    buildReferenceFieldRename,
    buildReferenceFieldUpdate,
    buildReferencePreview,
    type ReferenceEditRange,
} from "../src/domain/reference-preview.ts";

function applyReplacement(
    source: string,
    replacement: { end: number; start: number; value: string },
): string {
    return (
        source.slice(0, replacement.start) +
        replacement.value +
        source.slice(replacement.end)
    );
}

test("empty editable notes and details keep a value range for editing and reset", () => {
    const note = "<ref> \n </ref>";
    const notePreview = buildReferencePreview(note, note, null, 0);
    assert.equal(notePreview?.noteText, "");
    assert.ok(notePreview?.noteRange);
    assert.equal(notePreview.noteRange.start, notePreview.noteRange.end);
    assert.equal(buildReferencePreview(note, note), null);

    const details = '<ref name="remote" details="  "/>';
    const detailsPreview = buildReferencePreview(details, details, null, 0);
    assert.equal(detailsPreview?.details, "");
    assert.ok(detailsPreview?.detailsRange);
    assert.equal(
        detailsPreview.detailsRange.start,
        detailsPreview.detailsRange.end,
    );
    assert.equal(detailsPreview.missingDefinition, true);
    assert.equal(buildReferencePreview(details, details), null);
});

test("citation fields target their exact duplicate occurrence and preserve whitespace", () => {
    const reference =
        "<ref>Intro {{cite web |title= Same |title= {{lang|en|Same}} \n|url=https://example.test}} tail</ref>";
    const source = `${reference}\n${reference}`;
    const start = reference.length + 1;
    const preview = buildReferencePreview(source, reference, null, start);
    const fields = preview?.rows.flatMap((row) => row.fields) ?? [];
    assert.deepEqual(
        fields.map((field) => field.value),
        ["Same", "{{lang|en|Same}}", "https://example.test"],
    );
    for (const field of fields) {
        assert.ok(field.range);
        assert.ok(field.range.start > start);
        assert.equal(
            source.slice(field.range.start, field.range.end),
            field.value,
        );
    }
    const range = fields[1].range!;
    const updated = applyReplacement(
        source,
        buildReferenceFieldReplacement(source, range, "Changed"),
    );
    assert.equal(
        updated,
        `${reference}\n${reference.replace("{{lang|en|Same}}", "Changed")}`,
    );
    assert.ok(preview?.citationRange);
    assert.equal(
        source.slice(preview.citationRange.start, preview.citationRange.end),
        "{{cite web |title= Same |title= {{lang|en|Same}} \n|url=https://example.test}}",
    );
});

test("editable previews expose blank existing fields with valid insertion ranges", () => {
    const reference = "{{cite book|title=Book|publisher= \n |year=}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const fields = preview?.rows.flatMap((row) => row.fields) ?? [];
    assert.equal(fields.length, 3);
    assert.equal(buildReferencePreview(reference, reference)?.rows.length, 1);
    for (const field of fields.slice(1)) {
        assert.equal(field.value, "");
        assert.ok(field.range);
        assert.equal(field.range.start, field.range.end);
        const replacement = buildReferenceFieldReplacement(
            reference,
            field.range,
            "Added",
        );
        assert.equal(
            applyReplacement(reference, replacement),
            reference.slice(0, field.range.start) +
                "Added" +
                reference.slice(field.range.end),
        );
    }
});

test("named reuses and r templates edit the matching local definition", () => {
    const wrong =
        '<ref name="book" group="other">{{cite book|title=Wrong}}</ref>';
    const definition = '<ref name="book">{{cite book|title=Right}}</ref>';
    for (const reference of ['<ref name="book"/>', "{{r|book}}"]) {
        const source = [wrong, definition, reference].join("\n");
        const preview = buildReferencePreview(
            source,
            reference,
            null,
            source.lastIndexOf(reference),
        );
        const field = preview?.rows[0].fields[0];
        assert.ok(field?.range);
        assert.equal(field.range.start, source.indexOf("Right"));
        assert.equal(source.slice(field.range.start, field.range.end), "Right");
    }
});

test("short footnotes retain the bibliography citation's source range", () => {
    const reference = "{{sfn|Doe|2024|p=3}}";
    const source = `${reference}\n* {{cite book|last=Doe|year=2024|title=Book}}`;
    const preview = buildReferencePreview(source, reference, null, 0);
    const title = preview?.rows
        .flatMap((row) => row.fields)
        .find((field) => field.name === "title");
    assert.deepEqual(title?.range, {
        start: source.indexOf("Book"),
        end: source.indexOf("Book") + 4,
        templateParameter: true,
    });
});

test("plain reference and explanatory footnote notes retain exact trimmed ranges", () => {
    for (const reference of [
        "<ref>  Note with {{lang|en|text}}.  </ref>",
        "{{efn|  Note with {{lang|en|text}}.  |name=context}}",
    ]) {
        const source = `Leading\n${reference}`;
        const preview = buildReferencePreview(source, reference, null, 8);
        assert.ok(preview?.noteRange);
        assert.equal(
            source.slice(preview.noteRange.start, preview.noteRange.end),
            preview.noteText,
        );
        const updated = applyReplacement(
            source,
            buildReferenceFieldReplacement(
                source,
                preview.noteRange,
                "Changed",
            ),
        );
        assert.equal(
            updated,
            source.replace("Note with {{lang|en|text}}.", "Changed"),
        );
    }
});

test("details target the current reuse while its absent parent stays unavailable", () => {
    const reference = '<ref name="external" details="  Pages 12–14  "/>';
    const source = `${reference}\n${reference}`;
    const local = buildReferencePreview(
        source,
        reference,
        null,
        reference.length + 1,
    );
    assert.equal(local?.missingDefinition, true);
    assert.deepEqual(local?.detailsRange, {
        start: source.lastIndexOf("Pages"),
        end: source.lastIndexOf("Pages") + "Pages 12–14".length,
        quote: '"',
    });
    const remote = buildReferencePreview(
        '<ref name="external">{{cite book|title=Remote}}</ref>',
        reference,
    );
    assert.equal(remote?.rows[0].fields[0].range, undefined);
    assert.equal(remote?.detailsRange, undefined);
    assert.equal(remote?.citationRange, undefined);
});

test("details editing respects quoted, unquoted and duplicate attributes", () => {
    for (const [reference, expected] of [
        [
            '<ref details="  Original  ">Note</ref>',
            "<ref details=\"  He said &quot;hi&quot; and 'bye'  \">Note</ref>",
        ],
        [
            "<ref details='Original'>Note</ref>",
            "<ref details='He said \"hi\" and &#39;bye&#39;'>Note</ref>",
        ],
        [
            "<ref details=Original/>",
            "<ref details=\"He said &quot;hi&quot; and 'bye'\"/>",
        ],
        [
            '<ref details="First" DETAILS="Original">Note</ref>',
            '<ref details="First" DETAILS="He said &quot;hi&quot; and \'bye\'">Note</ref>',
        ],
    ]) {
        const preview = buildReferencePreview(reference, reference, null, 0);
        assert.ok(preview?.detailsRange);
        assert.equal(
            reference.slice(
                preview.detailsRange.start,
                preview.detailsRange.end,
            ),
            "Original",
        );
        const replacement = buildReferenceFieldReplacement(
            reference,
            preview.detailsRange,
            "He said \"hi\" and 'bye'",
        );
        assert.equal(applyReplacement(reference, replacement), expected);
    }
});

test("range tracking is withheld for omitted, stale, or invalid occurrence offsets", () => {
    const reference = '<ref details="Page 2">{{cite book|title=Book}}</ref>';
    for (const offset of [undefined, -1, 0.5, 1, Number.NaN]) {
        const preview = buildReferencePreview(
            reference,
            reference,
            null,
            offset,
        );
        assert.equal(preview?.detailsRange, undefined);
        assert.equal(preview?.rows[0].fields[0].range, undefined);
        assert.equal(preview?.citationRange, undefined);
    }
    assert.throws(
        () =>
            buildReferenceFieldReplacement(
                reference,
                { start: -1, end: 2 } as ReferenceEditRange,
                "x",
            ),
        RangeError,
    );
});

test("new citation fields keep single-line and multiline layouts", () => {
    for (const [reference, expected] of [
        [
            "{{cite book|title=Book}}",
            "{{cite book|title=Book|publisher=Example}}",
        ],
        [
            "{{cite book\n |title=Book\n}}",
            "{{cite book\n |title=Book\n |publisher=Example\n}}",
        ],
        [
            "{{cite book\n  |title=Book\n  }}",
            "{{cite book\n  |title=Book\n  |publisher=Example\n  }}",
        ],
    ]) {
        const source = `Before ${reference} after`;
        const range = buildReferencePreview(
            source,
            reference,
            null,
            7,
        )?.citationRange;
        assert.ok(range);
        const replacement = buildReferenceFieldInsertion(
            source,
            range,
            " publisher ",
            "Example",
        );
        assert.ok(replacement);
        assert.equal(
            applyReplacement(source, replacement),
            `Before ${expected} after`,
        );
    }
});

test("new fields reject invalid names, duplicates and broken nesting while allowing nested wikitext", () => {
    const reference = "{{cite book|title=Book}}";
    const range = { start: 0, end: reference.length };
    for (const name of [
        "",
        "title",
        "a=b",
        "a|b",
        "a\nb",
        "{{title}}",
        "<tag>",
        "[field]",
    ]) {
        assert.equal(
            buildReferenceFieldInsertion(reference, range, name, "Value"),
            null,
        );
    }
    for (const value of ["x}}tail", "{{unfinished", "{{{unfinished"]) {
        assert.equal(
            buildReferenceFieldInsertion(reference, range, "publisher", value),
            null,
        );
    }
    for (const value of [
        "{{lang|en|Example}}",
        "[[Example|Label]]",
        "<nowiki>x|y</nowiki>",
        "<!--|-->text",
    ]) {
        const replacement = buildReferenceFieldInsertion(
            reference,
            range,
            "publisher",
            value,
        );
        assert.ok(replacement);
        assert.equal(
            applyReplacement(reference, replacement),
            `{{cite book|title=Book|publisher=${value}}}`,
        );
    }
});

test("field insertion before an existing field preserves its following position and layout", () => {
    for (const [reference, expected] of [
        [
            "{{cite book|title=Book|year=2024}}",
            "{{cite book|title=Book|publisher=Example|year=2024}}",
        ],
        [
            "{{cite book\n |title=Book\n |year=2024\n}}",
            "{{cite book\n |title=Book\n |publisher=Example\n |year=2024\n}}",
        ],
        [
            "{{cite book\n\t|title=Book\n\t|year=2024\n}}",
            "{{cite book\n\t|title=Book\n\t|publisher=Example\n\t|year=2024\n}}",
        ],
    ]) {
        const source = `Before ${reference} after`;
        const preview = buildReferencePreview(source, reference, null, 7);
        const field = preview?.rows
            .flatMap((row) => row.fields)
            .find((field) => field.name === "year");
        assert.ok(preview?.citationRange);
        assert.ok(field?.range);
        const replacement = buildReferenceFieldInsertion(
            source,
            preview.citationRange,
            "publisher",
            "Example",
            field.range,
        );
        assert.ok(replacement);
        assert.equal(
            applyReplacement(source, replacement),
            `Before ${expected} after`,
        );
    }
});

test("before-field insertion distinguishes duplicate values, blank fields and paired display order", () => {
    for (const [reference, name, expected] of [
        [
            "{{cite book|first=Same|title=Same|last=Same}}",
            "last",
            "{{cite book|first=Same|title=Same|publisher=Example|last=Same}}",
        ],
        [
            "{{cite book|first=Same|title=Same|last=Same}}",
            "first",
            "{{cite book|publisher=Example|first=Same|title=Same|last=Same}}",
        ],
        [
            "{{cite book\n |title=Book\n |year= \n |date=\n}}",
            "year",
            "{{cite book\n |title=Book\n |publisher= Example\n |year= \n |date=\n}}",
        ],
    ]) {
        const preview = buildReferencePreview(reference, reference, null, 0);
        const field = preview?.rows
            .flatMap((row) => row.fields)
            .find((field) => field.name === name);
        assert.ok(preview?.citationRange);
        assert.ok(field?.range);
        const replacement = buildReferenceFieldInsertion(
            reference,
            preview.citationRange,
            "publisher",
            "Example",
            field.range,
        );
        assert.ok(replacement);
        assert.equal(applyReplacement(reference, replacement), expected);
    }
    const reference = "{{cite book|title=Same|title=Same}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const field = preview?.rows[1].fields[0];
    assert.ok(preview?.citationRange);
    assert.ok(field?.range);
    const replacement = buildReferenceFieldInsertion(
        reference,
        preview.citationRange,
        "publisher",
        "Example",
        field.range,
    );
    assert.ok(replacement);
    assert.equal(
        applyReplacement(reference, replacement),
        "{{cite book|title=Same|publisher=Example|title=Same}}",
    );
});

test("before-field insertion rejects unmatched or stale target ranges", () => {
    const reference = "{{cite book|title=Book}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    assert.ok(preview?.citationRange);
    const field = preview.rows[0].fields[0];
    assert.ok(field.range);
    assert.equal(
        buildReferenceFieldInsertion(
            reference,
            preview.citationRange,
            "publisher",
            "Example",
            { start: field.range.start + 1, end: field.range.end },
        ),
        null,
    );
    assert.equal(
        buildReferenceFieldInsertion(
            reference,
            preview.citationRange,
            "title",
            "Other",
            field.range,
        ),
        null,
    );
});

test("after-field insertion follows the exact source parameter and preserves layout", () => {
    for (const [reference, targetIndex, expected] of [
        [
            "{{cite book|first=Same|title=Same|last=Same}}",
            0,
            "{{cite book|first=Same|publisher=Example|title=Same|last=Same}}",
        ],
        [
            "{{cite book|title=Same|title=Same|year=2024}}",
            1,
            "{{cite book|title=Same|title=Same|publisher=Example|year=2024}}",
        ],
        [
            "{{cite book\n |title=Book\n |year= \n |date=\n}}",
            1,
            "{{cite book\n |title=Book\n |year= \n |publisher=Example\n |date=\n}}",
        ],
        [
            "{{cite book|title=Book|year=2024}}",
            1,
            "{{cite book|title=Book|year=2024|publisher=Example}}",
        ],
        [
            "{{cite book\n  | title = Book\n  | year = 2024\n}}",
            1,
            "{{cite book\n  | title = Book\n  | year = 2024\n  | publisher = Example\n}}",
        ],
        [
            "{{cite book\n  | title = Book\n  | year = 2024}}",
            1,
            "{{cite book\n  | title = Book\n  | year = 2024\n  | publisher = Example}}",
        ],
    ] as const) {
        const source = `Before ${reference} after`;
        const preview = buildReferencePreview(source, reference, null, 7);
        const fields = preview?.rows
            .flatMap((row) => row.fields)
            .sort((a, b) => (a.range?.start ?? 0) - (b.range?.start ?? 0));
        const field = fields?.[targetIndex];
        assert.ok(preview?.citationRange);
        assert.ok(field?.range);
        const replacement = buildReferenceFieldInsertion(
            source,
            preview.citationRange,
            "publisher",
            "Example",
            field.range,
            "after",
        );
        assert.ok(replacement);
        assert.equal(
            applyReplacement(source, replacement),
            `Before ${expected} after`,
        );
    }
});

test("after-field insertion rejects a stale target instead of appending", () => {
    const reference = "{{cite book|title=Book}}";
    assert.equal(
        buildReferenceFieldInsertion(
            reference,
            { start: 0, end: reference.length },
            "publisher",
            "Example",
            { start: 0, end: 0 },
            "after",
        ),
        null,
    );
});

test("editing numeric citation fields preserves all surrounding multiline whitespace", () => {
    const reference = "{{Cite web\n| 1= xxx\n| 2= yyy\n}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const field = preview?.rows[0].fields[0];
    assert.equal(field?.name, "1");
    assert.equal(field.value, "xxx");
    assert.ok(field.range);
    assert.equal(reference.slice(field.range.start, field.range.end), "xxx");
    const replacement = buildReferenceFieldReplacement(
        reference,
        field.range,
        "Changed",
    );
    assert.equal(
        applyReplacement(reference, replacement),
        "{{Cite web\n| 1= Changed\n| 2= yyy\n}}",
    );
});

test("inserting fields follows nearby name and value spacing without rewriting existing fields", () => {
    const reference = "{{Cite web\n| 1= xxx\n| 2= yyy\n}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const before = preview?.rows[1].fields[0];
    assert.ok(preview?.citationRange);
    assert.ok(before?.range);
    const insertion = buildReferenceFieldInsertion(
        reference,
        preview.citationRange,
        "new",
        "value",
        before.range,
    );
    assert.ok(insertion);
    assert.equal(
        applyReplacement(reference, insertion),
        "{{Cite web\n| 1= xxx\n| new= value\n| 2= yyy\n}}",
    );
    const endInsertion = buildReferenceFieldInsertion(
        reference,
        preview.citationRange,
        "new",
        "value",
    );
    assert.ok(endInsertion);
    assert.equal(
        applyReplacement(reference, endInsertion),
        "{{Cite web\n| 1= xxx\n| 2= yyy\n| new= value\n}}",
    );
    const mixed = "{{cite book|first=A| title = B |year=2024}}";
    const mixedPreview = buildReferencePreview(mixed, mixed, null, 0);
    const title = mixedPreview?.rows[1].fields[0];
    assert.ok(mixedPreview?.citationRange);
    assert.ok(title?.range);
    const mixedInsertion = buildReferenceFieldInsertion(
        mixed,
        mixedPreview.citationRange,
        "publisher",
        "Example",
        title.range,
    );
    assert.ok(mixedInsertion);
    assert.equal(
        applyReplacement(mixed, mixedInsertion),
        "{{cite book|first=A| publisher = Example| title = B |year=2024}}",
    );
});

test("citation edits escape bare pipes while preserving nested and protected wikitext", () => {
    const reference = "{{cite web\n| title= Original\n}}";
    const field = buildReferencePreview(reference, reference, null, 0)?.rows[0]
        .fields[0];
    assert.ok(field?.range);
    const entered =
        "A | B {{lang|en|Text}} [[Page|Label]] <!-- | --> <nowiki>|</nowiki> <ref>note|part</ref> | End";
    const expected =
        "A {{!}} B {{lang|en|Text}} [[Page|Label]] <!-- | --> <nowiki>|</nowiki> <ref>note|part</ref> {{!}} End";
    const replacement = buildReferenceFieldReplacement(
        reference,
        field.range,
        entered,
    );
    assert.equal(
        applyReplacement(reference, replacement),
        `{{cite web\n| title= ${expected}\n}}`,
    );
});

test("new citation fields escape bare pipes without adding extra parameters", () => {
    const reference = "{{cite book|title=Book}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    assert.ok(preview?.citationRange);
    for (const [entered, expected] of [
        ["A | B", "A {{!}} B"],
        ["x|title=Other", "x{{!}}title=Other"],
        [
            "A | {{lang|en|B}} | [[Page|C]]",
            "A {{!}} {{lang|en|B}} {{!}} [[Page|C]]",
        ],
    ]) {
        const replacement = buildReferenceFieldInsertion(
            reference,
            preview.citationRange,
            "publisher",
            entered,
        );
        assert.ok(replacement);
        assert.equal(
            applyReplacement(reference, replacement),
            `{{cite book|title=Book|publisher=${expected}}}`,
        );
    }
});

test("pipe escaping applies to efn notes while leaving raw ref notes and details unchanged", () => {
    const note = "{{efn| Original |name=context}}";
    const notePreview = buildReferencePreview(note, note, null, 0);
    assert.ok(notePreview?.noteRange);
    const efnReplacement = buildReferenceFieldReplacement(
        note,
        notePreview.noteRange,
        "A | B",
    );
    assert.equal(
        applyReplacement(note, efnReplacement),
        "{{efn| A {{!}} B |name=context}}",
    );
    const reference = '<ref details="Original">Original</ref>';
    const preview = buildReferencePreview(reference, reference, null, 0);
    assert.ok(preview?.noteRange);
    assert.ok(preview.detailsRange);
    const refReplacement = buildReferenceFieldReplacement(
        reference,
        preview.noteRange,
        "A | B",
    );
    assert.equal(
        applyReplacement(reference, refReplacement),
        '<ref details="Original">A | B</ref>',
    );
    const detailsReplacement = buildReferenceFieldReplacement(
        reference,
        preview.detailsRange,
        "A | B",
    );
    assert.equal(
        applyReplacement(reference, detailsReplacement),
        '<ref details="A | B">Original</ref>',
    );
});

test("positional citation and efn values retain their numeric keys when editing adds equals", () => {
    for (const [reference, expected] of [
        [
            "{{cite book|  Original \n|title=Book}}",
            "{{cite book|  A&#61;B \n|title=Book}}",
        ],
        ["{{cite book|First| Original }}", "{{cite book|First| A&#61;B }}"],
        [
            "{{efn| Original \n|name=context}}",
            "{{efn| A&#61;B \n|name=context}}",
        ],
        [
            "{{cite book|Original|Second|Third}}",
            "{{cite book|A&#61;B|Second|Third}}",
        ],
    ]) {
        const preview = buildReferencePreview(reference, reference, null, 0);
        const range =
            preview?.noteRange ??
            preview?.rows
                .flatMap((row) => row.fields)
                .find((field) => field.value === "Original")?.range;
        assert.ok(range?.positional);
        const replacement = buildReferenceFieldReplacement(
            reference,
            range,
            "A=B",
        );
        const updated = applyReplacement(reference, replacement);
        assert.equal(updated, expected);
        const updatedPreview = buildReferencePreview(updated, updated, null, 0);
        assert.equal(
            updatedPreview?.noteText ??
                updatedPreview?.rows
                    .flatMap((row) => row.fields)
                    .find((field) => field.value.includes("&#61;"))?.value,
            "A&#61;B",
        );
        assert.deepEqual(
            updatedPreview?.rows
                .flatMap((row) => row.fields)
                .map((field) => field.name),
            preview?.rows
                .flatMap((row) => row.fields)
                .map((field) => field.name),
        );
    }
});

test("nested equals and existing named parameters do not add positional keys", () => {
    const reference = "{{efn| Original |name=context}}";
    const range = buildReferencePreview(
        reference,
        reference,
        null,
        0,
    )?.noteRange;
    assert.ok(range);
    const nested =
        "{{lang|en|A=B}} [[Page|C=D]] <nowiki>E=F</nowiki> <!-- G=H -->";
    assert.equal(
        applyReplacement(
            reference,
            buildReferenceFieldReplacement(reference, range, nested),
        ),
        `{{efn| ${nested} |name=context}}`,
    );
    for (const named of [
        "{{efn| 1= Original }}",
        "{{cite web|title= Original }}",
    ]) {
        const preview = buildReferencePreview(named, named, null, 0);
        const namedRange =
            preview?.noteRange ?? preview?.rows[0].fields[0].range;
        assert.ok(namedRange);
        assert.equal(namedRange.positional, undefined);
        assert.equal(
            applyReplacement(
                named,
                buildReferenceFieldReplacement(named, namedRange, "A=B"),
            ),
            named.replace("Original", "A=B"),
        );
    }
});

test("new fields reject values whose unclosed links would absorb subsequent parameters", () => {
    const reference = "{{cite book|title=Book|year=2024}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    assert.ok(preview?.citationRange);
    for (const value of [
        "[[oops|publisher=Injected",
        "[[oops",
        "[[Page|{{lang|en|Label}}",
    ]) {
        assert.equal(
            buildReferenceFieldInsertion(
                reference,
                preview.citationRange,
                "publisher",
                value,
            ),
            null,
        );
    }
});

test("bottom field insertion keeps multiline parameter layout with inline closing braces", () => {
    const reference = "{{cite book\n| title = Book\n| year = 2024}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    assert.ok(preview?.citationRange);
    const replacement = buildReferenceFieldInsertion(
        reference,
        preview.citationRange,
        "publisher",
        "Example",
    );
    assert.ok(replacement);
    assert.equal(
        applyReplacement(reference, replacement),
        "{{cite book\n| title = Book\n| year = 2024\n| publisher = Example}}",
    );
});

test("renaming a citation field preserves all name and value whitespace", () => {
    const reference = "{{cite web\n | title =  Book \n |year=2024\n}}";
    const source = `Prefix ${reference} suffix`;
    const preview = buildReferencePreview(source, reference, null, 7);
    const field = preview?.rows[0].fields[0];
    assert.ok(preview?.citationRange);
    assert.ok(field?.range);
    const replacement = buildReferenceFieldRename(
        source,
        preview.citationRange,
        field.range,
        " chapter ",
    );
    assert.ok(replacement);
    assert.equal(
        applyReplacement(source, replacement),
        source.replace(" title =", " chapter ="),
    );
});

test("renaming one exact duplicate can resolve it without changing other occurrences", () => {
    const reference =
        "{{cite book|last1=Doe|first1=Jane|last1=Roe|title=Book}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const field = preview?.rows
        .flatMap((row) => row.fields)
        .find((field) => field.value === "Roe");
    assert.ok(preview?.citationRange);
    assert.ok(field?.range);
    const replacement = buildReferenceFieldRename(
        reference,
        preview.citationRange,
        field.range,
        "last2",
    );
    assert.ok(replacement);
    assert.equal(
        applyReplacement(reference, replacement),
        reference.replace("last1=Roe", "last2=Roe"),
    );
    const noOp = buildReferenceFieldRename(
        reference,
        preview.citationRange,
        field.range,
        "last1",
    );
    assert.ok(noOp);
    assert.equal(applyReplacement(reference, noOp), reference);
    for (const name of [
        "",
        "title",
        "a=b",
        "a|b",
        "a\nb",
        "{{bad}}",
        "<bad>",
    ]) {
        assert.equal(
            buildReferenceFieldRename(
                reference,
                preview.citationRange,
                field.range,
                name,
            ),
            null,
        );
    }
});

test("renaming implicit parameters explicitly numbers subsequent implicit siblings", () => {
    const reference = "{{cite book| First |title=Book| Second | Third }}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const field = preview?.rows[0].fields[0];
    assert.ok(preview?.citationRange);
    assert.ok(field?.range);
    const replacement = buildReferenceFieldRename(
        reference,
        preview.citationRange,
        field.range,
        "author",
    );
    assert.ok(replacement);
    const source = applyReplacement(reference, replacement);
    assert.equal(
        source,
        "{{cite book|author= First |title=Book|2= Second |3= Third }}",
    );
    assert.deepEqual(
        buildReferencePreview(source, source)
            ?.rows.flatMap((row) => row.fields)
            .map(({ name, value }) => ({ name, value })),
        [
            { name: "author", value: "First" },
            { name: "title", value: "Book" },
            { name: "2", value: "Second" },
            { name: "3", value: "Third" },
        ],
    );
});

test("atomic citation updates preserve formatting while changing name and escaped value", () => {
    const reference = "{{cite web\n | title =  Original  \n |year=2024\n}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const range = preview?.rows[0].fields[0].range;
    assert.ok(preview?.citationRange);
    assert.ok(range);
    const replacement = buildReferenceFieldUpdate(
        reference,
        preview.citationRange,
        range,
        "chapter",
        "A | {{lang|en|B}}",
    );
    assert.ok(replacement);
    assert.equal(
        applyReplacement(reference, replacement),
        "{{cite web\n | chapter =  A {{!}} {{lang|en|B}}  \n |year=2024\n}}",
    );
    for (const [name, value] of [
        ["year", "Other"],
        ["", "Other"],
        ["chapter", "[[Unclosed"],
        ["chapter", "broken}}text"],
    ]) {
        assert.equal(
            buildReferenceFieldUpdate(
                reference,
                preview.citationRange,
                range,
                name,
                value,
            ),
            null,
        );
    }
});

test("atomic implicit updates preserve following numeric parameter identities", () => {
    const reference = "{{cite book|First|Second|Third}}";
    const preview = buildReferencePreview(reference, reference, null, 0);
    const range = preview?.rows[0].fields[0].range;
    assert.ok(preview?.citationRange);
    assert.ok(range);
    const replacement = buildReferenceFieldUpdate(
        reference,
        preview.citationRange,
        range,
        "author",
        "A=B | C",
    );
    assert.ok(replacement);
    assert.equal(
        applyReplacement(reference, replacement),
        "{{cite book|author=A=B {{!}} C|2=Second|3=Third}}",
    );
});

test("atomic updates compose empty and implicit fields at an exact article occurrence", () => {
    for (const [reference, name, value, expected] of [
        [
            "{{cite book||Second|Third}}",
            "author",
            "A=B",
            "{{cite book|author=A=B|2=Second|3=Third}}",
        ],
        [
            "{{cite book| \n|Second}}",
            "author",
            "A=B",
            "{{cite book|author= \nA=B|2=Second}}",
        ],
        [
            "{{cite book|First|Second}}",
            "1",
            "A=B",
            "{{cite book|A&#61;B|Second}}",
        ],
        [
            "{{cite book|First|Second}}",
            "author",
            "",
            "{{cite book|author=|2=Second}}",
        ],
        [
            "{{cite book|title=First|title=Second}}",
            "title",
            "Updated",
            "{{cite book|title=Updated|title=Second}}",
        ],
    ]) {
        const source = `${reference}\n${reference}\n${reference}`;
        const start = reference.length + 1;
        const preview = buildReferencePreview(source, reference, null, start);
        const range = preview?.rows[0].fields[0].range;
        assert.ok(preview?.citationRange);
        assert.ok(range);
        const replacement = buildReferenceFieldUpdate(
            source,
            preview.citationRange,
            range,
            name,
            value,
        );
        assert.ok(replacement);
        assert.equal(
            applyReplacement(source, replacement),
            `${reference}\n${expected}\n${reference}`,
        );
    }
});

test("citation mutations reject malformed source ranges before editing", () => {
    const reference = "{{cite book|title=Book}}";
    const field = buildReferencePreview(reference, reference, null, 0)?.rows[0]
        .fields[0];
    assert.ok(field?.range);
    for (const range of [
        { start: -1, end: reference.length },
        { start: 0.5, end: reference.length },
        { start: 0, end: reference.length + 1 },
        { start: reference.length, end: 0 },
        { start: 0, end: Number.NaN },
        { start: 1, end: reference.length },
    ]) {
        assert.equal(
            buildReferenceFieldInsertion(reference, range, "author", "Value"),
            null,
        );
        assert.equal(
            buildReferenceFieldRename(reference, range, field.range, "author"),
            null,
        );
        assert.equal(
            buildReferenceFieldUpdate(
                reference,
                range,
                field.range,
                "author",
                "Value",
            ),
            null,
        );
    }
});
