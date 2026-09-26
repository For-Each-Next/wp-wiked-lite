import assert from "node:assert/strict";
import test from "node:test";
import { buildReferencePreview } from "../src/index.ts";
import { decodeNamespaceCatalog } from "../src/domain/wiki-titles.ts";

const EN_NAMESPACE_CATALOG = decodeNamespaceCatalog("enwiki", {
    query: {
        namespacealiases: [{ alias: "TM", id: 10 }],
        namespaces: {
            0: { id: 0, name: "" },
            10: { canonical: "Template", id: 10, name: "Template" },
        },
    },
});
const ZH_NAMESPACE_CATALOG = decodeNamespaceCatalog("zhwiki", {
    query: {
        namespacealiases: [{ alias: "T", id: 10 }],
        namespaces: {
            0: { id: 0, name: "" },
            10: { canonical: "Template", id: 10, name: "模板" },
        },
    },
});

const ORIGINAL_URL = "https://example.test/article";
const ARCHIVE_URL = `https://web.archive.org/web/202401/${ORIGINAL_URL}`;
const PAIRED_PREVIEW_ROWS = [
    {
        fields: [
            { name: "editor-last2", value: "Jones" },
            { name: "editor-first2", value: "Bea" },
        ],
    },
    { fields: [{ name: "title", value: "Page" }] },
    {
        fields: [
            { name: "last", value: "Doe" },
            { name: "first", value: "Jane" },
        ],
    },
    {
        fields: [
            {
                displayValue: "https://web.archive.org/web/202401/...",
                href: ARCHIVE_URL,
                name: "archive-url",
                value: ARCHIVE_URL,
            },
        ],
    },
    { fields: [{ name: "url", value: ORIGINAL_URL }] },
    { fields: [{ name: "custom-field", value: "kept" }] },
    { fields: [{ name: "translator-first", value: "Only" }] },
];

test("a short footnote resolves its bibliography citation", () => {
    const source = [
        "Dragonstomper was published.{{sfn|Weiss|2014|p=77}}",
        "==Bibliography==",
        "* {{cite book|last=Weiss|year=2014|title=Classic Home Video Games}}",
    ].join("\n");

    const preview = buildReferencePreview(source, "{{sfn|Weiss|2014|p=77}}");

    assert.equal(preview?.templateName, "cite book");
    assert.equal(preview?.referenceLabel, "Weiss, 2014");
    assert.deepEqual(preview?.rows, [
        { fields: [{ name: "last", value: "Weiss" }] },
        { fields: [{ name: "year", value: "2014" }] },
        {
            fields: [{ name: "title", value: "Classic Home Video Games" }],
        },
    ]);
});

test("a named ref reuse resolves its full citation", () => {
    const source = [
        '<ref name="source">' +
            "{{Cite web|URL=https://example.test|title=Page}}</ref>",
        '<ref name="source"/>',
    ].join("\n");

    const preview = buildReferencePreview(source, '<ref name="source"/>');

    assert.equal(preview?.templateName, "cite web");
    assert.equal(preview?.referenceLabel, "source");
    assert.deepEqual(preview?.rows, [
        { fields: [{ name: "URL", value: "https://example.test" }] },
        { fields: [{ name: "title", value: "Page" }] },
    ]);
});

test("sub-reference details belong to each occurrence and retain their wikitext", () => {
    const firstDetails =
        "{{URL|https://archive.org/details/example/page/90/mode/2up|地球冒险3}}. 攻略人行道 :90-93;";
    const secondDetails =
        "阿修罗. {{url|https://archive.org/details/UCG-2006/example/page/n59/mode/2up|Mother3 攻略透解 奇妙、有趣，还有发自内心的伤感……}} :58-63.";
    const definition =
        '<ref name="source" details="Definition pages">{{cite book|title=Book}}</ref>';
    const first = `<ref name="source" details="  ${firstDetails}  "/>`;
    const second = `<ref name="source" details="${secondDetails}"/>`;
    const plain = '<ref name="source"/>';
    const source = [definition, first, second, plain].join("\n");
    const citation = {
        referenceLabel: "source",
        rows: [{ fields: [{ name: "title", value: "Book" }] }],
        templateName: "cite book",
        templateTitle: "cite book",
    };

    assert.deepEqual(buildReferencePreview(source, definition), {
        ...citation,
        details: "Definition pages",
    });
    assert.deepEqual(buildReferencePreview(source, first), {
        ...citation,
        details: firstDetails,
    });
    assert.deepEqual(buildReferencePreview(source, second), {
        ...citation,
        details: secondDetails,
    });
    assert.deepEqual(buildReferencePreview(source, plain), citation);
});

test("sub-reference details accompany notes and resolve the matching group", () => {
    const definition =
        '<ref name="source" group="notes" details="Original pages">  Right note.  </ref>';
    const reference =
        '<ref name="source" group="notes" details="Pages 12–14"/>';
    const source = [
        '<ref name="source" group="other">Wrong note.</ref>',
        definition,
        reference,
    ].join("\n");

    assert.deepEqual(buildReferencePreview(source, definition), {
        details: "Original pages",
        noteText: "Right note.",
        referenceLabel: "source",
        rows: [],
        templateName: "reference",
    });
    assert.deepEqual(buildReferencePreview(source, reference), {
        details: "Pages 12–14",
        noteText: "Right note.",
        referenceLabel: "source",
        rows: [],
        templateName: "reference",
    });
});

test("missing definitions retain details and can be resolved from full-page source", () => {
    const reference =
        '<ref name="source" group="notes" details="{{URL|https://example.test|Chapter}} :58-63"/>';
    const otherGroup = '<ref name="source">Wrong group.</ref>';
    const partial = buildReferencePreview(otherGroup, reference);

    assert.deepEqual(partial, {
        details: "{{URL|https://example.test|Chapter}} :58-63",
        missingDefinition: true,
        referenceLabel: "source",
        rows: [],
        templateName: "reference",
    });
    assert.deepEqual(
        buildReferencePreview(
            `${otherGroup}<ref name="source" group="notes">Parent note.</ref>`,
            reference,
        ),
        {
            details: "{{URL|https://example.test|Chapter}} :58-63",
            noteText: "Parent note.",
            referenceLabel: "source",
            rows: [],
            templateName: "reference",
        },
    );
    assert.equal(buildReferencePreview("", '<ref name="source"/>'), null);
});

test("blank details do not alter previews and empty definitions are resolved", () => {
    const definition = '<ref name="source">Note.</ref>';
    assert.deepEqual(
        buildReferencePreview(
            definition,
            '<ref name="source" details=" \n "/>',
        ),
        buildReferencePreview(definition, '<ref name="source"/>'),
    );
    assert.equal(
        buildReferencePreview("", '<ref name="source" details=" \n "/>'),
        null,
    );
    const emptyDefinition = '<ref name="empty" details="Chapter 1"></ref>';
    const detailsOnly = {
        details: "Chapter 1",
        referenceLabel: "empty",
        rows: [],
        templateName: "reference",
    };
    assert.deepEqual(
        buildReferencePreview(emptyDefinition, emptyDefinition),
        detailsOnly,
    );
    assert.deepEqual(
        buildReferencePreview(
            emptyDefinition,
            '<ref name="empty" details="Chapter 1"/>',
        ),
        detailsOnly,
    );
});

test("sub-reference details preserve untrusted markup as text", () => {
    const details =
        '<img src=x onerror="alert(1)"> {{url|javascript:alert(2)|X}}';
    const reference = `<ref name="source" details='${details}'/>`;

    assert.deepEqual(buildReferencePreview("", reference), {
        details,
        missingDefinition: true,
        referenceLabel: "source",
        rows: [],
        templateName: "reference",
    });
});

test("a full ref preview parses only its inner content", () => {
    const reference = [
        '<ref name="source">Intro ',
        "{{Cite web|URL=https://example.test|title=Page}}",
        " after.</ref>",
    ].join("");

    const preview = buildReferencePreview(reference, reference);

    assert.equal(preview?.templateName, "cite web");
    assert.equal(preview?.referenceLabel, "source");
    assert.deepEqual(preview?.rows, [
        { fields: [{ name: "URL", value: "https://example.test" }] },
        { fields: [{ name: "title", value: "Page" }] },
    ]);
});

test("a plain reference previews its explanatory note text", () => {
    const reference = '<ref name="note">  Plain explanatory note.  </ref>';

    const preview = buildReferencePreview(reference, reference);

    assert.equal(preview?.templateName, "reference");
    assert.equal(preview?.referenceLabel, "note");
    assert.equal(preview?.noteText, "Plain explanatory note.");
    assert.deepEqual(preview?.rows, []);
});

test("an explanatory-footnote template previews its note", () => {
    const reference =
        "{{efn|An explanatory note with https://example.test|name=context}}";

    const preview = buildReferencePreview(reference, reference);

    assert.equal(preview?.templateName, "reference");
    assert.equal(preview?.referenceLabel, "context");
    assert.equal(
        preview?.noteText,
        "An explanatory note with https://example.test",
    );
});

test("pairs person fields and retains original and archive URLs", () => {
    const reference = [
        "{{cite web",
        "|editor-first2=Bea",
        "|title=Page",
        "|last=Doe",
        `|archive-url=${ARCHIVE_URL}`,
        "|first=Jane",
        "|editor-last2=Jones",
        `|url=${ORIGINAL_URL}`,
        "|custom-field=kept",
        "|translator-first=Only",
        "}}",
    ].join("");

    const preview = buildReferencePreview(reference, reference);

    assert.deepEqual(preview?.rows, PAIRED_PREVIEW_ROWS);
});

test("archive previews shorten targets that differ only by HTTP scheme", () => {
    const target =
        "www.gamespot.com/articles/nintendo-says-64dd-delayed/1100-2466742/";
    const archivePrefix = "https://web.archive.org/web/20180208123826/";
    for (const [originalScheme, archivedScheme] of [
        ["http://", "https://"],
        ["https://", "http://"],
    ]) {
        const originalUrl = originalScheme + target;
        const archiveUrl = archivePrefix + archivedScheme + target;
        const reference = `{{cite web|url=${originalUrl}|archive-url=${archiveUrl}}}`;

        assert.deepEqual(buildReferencePreview(reference, reference)?.rows, [
            { fields: [{ name: "url", value: originalUrl }] },
            {
                fields: [
                    {
                        name: "archive-url",
                        value: archiveUrl,
                        href: archiveUrl,
                        displayValue: archivePrefix + archivedScheme + "...",
                    },
                ],
            },
        ]);
    }
});

test("archive previews retain targets with differences beyond their HTTP scheme", () => {
    const originalUrl = "http://example.test/article";
    for (const archivedTarget of [
        "https://other.test/article",
        "https://example.test/other",
        "https://example.test/article/child",
        "https://example.test/article?version=2",
        "https://example.test/article#section",
        "https://example.test/article-longer",
        "ftp://example.test/article",
    ]) {
        const archiveUrl = `https://web.archive.org/web/202401/${archivedTarget}`;
        const reference = `{{cite web|url=${originalUrl}|archive-url=${archiveUrl}}}`;

        assert.deepEqual(buildReferencePreview(reference, reference)?.rows[1], {
            fields: [
                {
                    name: "archive-url",
                    value: archiveUrl,
                    href: archiveUrl,
                    displayValue: archiveUrl,
                },
            ],
        });
    }
});

test("a grouped reuse resolves the definition in the same group", () => {
    const source = [
        '<ref name="source" group="other">{{cite book|title=Wrong}}</ref>',
        '<ref name="source" group="notes">' +
            "{{cite web|title=Right|url=https://example.test}}</ref>",
    ].join("\n");

    const preview = buildReferencePreview(
        source,
        '<ref name="source" group="notes"/>',
    );

    assert.equal(preview?.templateName, "cite web");
});

test("citation previews scope namespace aliases to the selected wiki", () => {
    const english = "<ref>{{TM:Cite web|title=English}}</ref>";
    const chinese = "<ref>{{T:Cite web|title=Chinese}}</ref>";

    assert.equal(
        buildReferencePreview(english, english, EN_NAMESPACE_CATALOG)
            ?.templateName,
        "cite web",
    );
    assert.equal(
        buildReferencePreview(english, english, ZH_NAMESPACE_CATALOG)
            ?.templateName,
        "reference",
    );
    assert.equal(
        buildReferencePreview(chinese, chinese, ZH_NAMESPACE_CATALOG)
            ?.templateName,
        "cite web",
    );
    assert.equal(
        buildReferencePreview(chinese, chinese, EN_NAMESPACE_CATALOG)
            ?.templateName,
        "reference",
    );
});

test("citation documentation titles preserve casing and strip local namespace aliases", () => {
    for (const [name, namespaces] of [
        ["Cite AV media", null],
        ["Template:Cite_AV_media", null],
        ["TM:Cite AV media", EN_NAMESPACE_CATALOG],
        ["模板:Cite AV media", ZH_NAMESPACE_CATALOG],
        ["T:Cite AV media", ZH_NAMESPACE_CATALOG],
    ] as const) {
        const reference = `{{${name}|title=Video}}`;
        const preview = buildReferencePreview(reference, reference, namespaces);

        assert.equal(preview?.templateName, "cite av media");
        assert.equal(preview?.templateTitle, "Cite AV media");
    }
    assert.equal(
        buildReferencePreview("", "<ref>Plain note.</ref>")?.templateTitle,
        undefined,
    );
});

test("reference-like templates use current-wiki namespace aliases", () => {
    const source = [
        '<ref name="source">{{T:Cite web|title=Named}}</ref>',
        "* {{T:Cite book|last=Ma|year=2025|title=Book}}",
    ].join("\n");

    const named = buildReferencePreview(
        source,
        "{{T:R|source}}",
        ZH_NAMESPACE_CATALOG,
    );
    const short = buildReferencePreview(
        source,
        "{{T:sfn|Ma|2025}}",
        ZH_NAMESPACE_CATALOG,
    );
    const note = buildReferencePreview(
        source,
        "{{T:efn|Localized note|name=context}}",
        ZH_NAMESPACE_CATALOG,
    );
    const crossWiki = buildReferencePreview(
        source,
        "{{T:efn|Localized note|name=context}}",
        EN_NAMESPACE_CATALOG,
    );

    assert.equal(named?.templateName, "cite web");
    assert.equal(named?.referenceLabel, "source");
    assert.equal(short?.templateName, "cite book");
    assert.equal(short?.referenceLabel, "Ma, 2025");
    assert.equal(note?.templateName, "reference");
    assert.equal(note?.referenceLabel, "context");
    assert.equal(note?.noteText, "Localized note");
    assert.equal(crossWiki?.referenceLabel, "");
    assert.equal(crossWiki?.noteText, "{{T:efn|Localized note|name=context}}");
});
