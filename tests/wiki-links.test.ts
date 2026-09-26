import assert from "node:assert/strict";
import test from "node:test";
import { decodeNamespaceCatalog } from "../src/domain/wiki-titles.ts";
import {
    applyTemplateRedirects,
    applyWikiLinkRedirects,
    collectTemplateTitles,
    collectWikiLinkTitles,
} from "../src/domain/wiki-links.ts";
import { lookupWikiLinks } from "../src/platform/mediawiki/wiki-links.ts";
import type {
    MagicWordAliases,
    TemplateMagicWordCatalog,
} from "../src/domain/magic-words.ts";

const EXAMPLE_NAMESPACE_CATALOG = decodeNamespaceCatalog("examplewiki", {
    query: {
        namespacealiases: [
            { alias: "Image", id: 6 },
            { alias: "TM", id: 10 },
        ],
        namespaces: {
            0: { id: 0, name: "" },
            6: { canonical: "File", id: 6, name: "Datei" },
            10: { canonical: "Template", id: 10, name: "Vorlage" },
            12: { canonical: "Help", id: 12, name: "Hilfe" },
            14: { canonical: "Category", id: 14, name: "Kategorie" },
        },
    },
});

const EN_NAMESPACE_CATALOG = decodeNamespaceCatalog("enwiki", {
    query: {
        namespacealiases: [],
        namespaces: {
            0: { id: 0, name: "" },
            6: { canonical: "File", id: 6, name: "File" },
            10: { canonical: "Template", id: 10, name: "Template" },
            12: { canonical: "Help", id: 12, name: "Help" },
            14: { canonical: "Category", id: 14, name: "Category" },
        },
    },
});
const ZH_NAMESPACE_CATALOG = decodeNamespaceCatalog("zhwiki", {
    query: {
        namespacealiases: [],
        namespaces: {
            0: { id: 0, name: "" },
            6: { canonical: "File", id: 6, name: "文件" },
            10: { canonical: "Template", id: 10, name: "模板" },
            14: { canonical: "Category", id: 14, name: "分类" },
        },
    },
});

const EXAMPLE_MAGIC_WORDS: TemplateMagicWordCatalog = Object.freeze({
    functions: aliases(["lokalfunktion：", "DEFAULTSORT:", "lc:", "#if:"]),
    invoke: aliases(),
    modifiers: Object.freeze({
        message: aliases(["msg:", "msgnw:", "nachricht:", "nachrichtnw:"]),
        raw: aliases(["raw:", "roh:"]),
        substitution: aliases([
            "subst:",
            "safesubst:",
            "ersetzen:",
            "sicherersetzen:",
        ]),
    }),
    variables: aliases(["CURRENTYEAR"], ["LOKALVARIABLE"]),
});
const EN_MAGIC_WORDS: TemplateMagicWordCatalog = Object.freeze({
    functions: aliases([], ["DEFAULTSORT:"]),
    invoke: aliases(["invoke:"]),
    modifiers: Object.freeze({
        message: aliases(["msg:", "msgnw:"]),
        raw: aliases(["raw:"]),
        substitution: aliases(["subst:", "safesubst:"]),
    }),
    variables: aliases(["CURRENTYEAR"]),
});
const ZH_MAGIC_WORDS: TemplateMagicWordCatalog = Object.freeze({
    functions: aliases(["默认排序:", "#调用:"]),
    invoke: aliases(["调用:"]),
    modifiers: Object.freeze({
        message: aliases(["訊息:"]),
        raw: aliases(["原始:"]),
        substitution: aliases(["替換:"]),
    }),
    variables: aliases(["页名"]),
});

test("wikilink lookup input is deduplicated", () => {
    assert.deepEqual(
        collectWikiLinkTitles("[[Foo]] [[Foo|label]] [[Bar#Part]]"),
        ["Foo", "Bar"],
    );
});

test("leading-colon links are still checked for missing targets", () => {
    assert.deepEqual(
        collectWikiLinkTitles(
            "[[:Missing#Section|label]] [[:Category:Absent]]",
        ),
        ["Missing", "Category:Absent"],
    );
});

test("wikilink lookup ignores comments and literal tag contents", () => {
    assert.deepEqual(
        collectWikiLinkTitles(
            "<!-- [[Comment]] --><nowiki>[[Literal]]</nowiki> [[Visible]]",
        ),
        ["Visible"],
    );
});

test("wikilink lookup includes links nested in file captions", () => {
    assert.deepEqual(
        collectWikiLinkTitles("[[File:Old.svg|caption [[Foo]]]]"),
        ["File:Old.svg", "Foo"],
    );
});

test("template lookup collects local static transclusions", () => {
    assert.deepEqual(
        collectTemplateTitles(
            [
                "{{Old}}",
                "{{ Template:Second |x}}",
                "{{Vorlage:Third}}",
                "{{Example:Variant}}",
                "{{Outer|nested={{Inner}}}}",
                "{{Old}}",
            ].join(" "),
            EXAMPLE_NAMESPACE_CATALOG,
            EXAMPLE_MAGIC_WORDS,
        ),
        [
            "Vorlage:Old",
            "Vorlage:Second",
            "Vorlage:Third",
            "Vorlage:Example:Variant",
            "Vorlage:Outer",
            "Vorlage:Inner",
        ],
    );
});

test("template lookup excludes unsafe transclusion heads", () => {
    const source = [
        "{{subst:Old}}",
        "{{safesubst:Old}}",
        "{{msg:Old}}",
        "{{msgnw:Old}}",
        "{{raw:Old}}",
        "{{DEFAULTSORT:Old}}",
        "{{CURRENTYEAR}}",
        "{{lc:Old}}",
        "{{#if:x|Old}}",
        "{{{{{dynamic}}}}}",
        "{{Foo{{{suffix}}}}}",
        "{{:Article}}",
        "{{Help:Old}}",
        "{{File:Old.svg}}",
        "{{Old#fragment}}",
    ].join(" ");

    assert.deepEqual(
        collectTemplateTitles(
            source,
            EXAMPLE_NAMESPACE_CATALOG,
            EXAMPLE_MAGIC_WORDS,
        ),
        [],
    );
});

test("template redirects require a loaded magic-word catalog", () => {
    const source = "{{Old}} [[Old]]";
    const redirects = new Map([
        ["Pattern:Old", "Template:New"],
        ["Old", "Target"],
    ]);

    assert.deepEqual(
        collectTemplateTitles(source, EXAMPLE_NAMESPACE_CATALOG),
        [],
    );
    assert.equal(
        applyTemplateRedirects(source, redirects, EXAMPLE_NAMESPACE_CATALOG),
        source,
    );
    assert.equal(
        applyWikiLinkRedirects(source, redirects, EXAMPLE_NAMESPACE_CATALOG),
        "{{Old}} [[Target|Old]]",
    );
});

test("loaded aliases exclude localized template-like syntax", () => {
    const source =
        "{{lokalfunktion：x}} {{LOKALVARIABLE}} {{ersetzen:Old}} " +
        "{{Ordinary}} {{lokalvariable}}";

    assert.deepEqual(
        collectTemplateTitles(
            source,
            EXAMPLE_NAMESPACE_CATALOG,
            EXAMPLE_MAGIC_WORDS,
        ),
        ["Vorlage:Ordinary", "Vorlage:lokalvariable"],
    );
    const redirects = new Map([
        ["Vorlage:lokalfunktion：x", "Template:Wrong function"],
        ["Vorlage:LOKALVARIABLE", "Template:Wrong variable"],
        ["Vorlage:ersetzen:Old", "Template:Wrong modifier"],
        ["Vorlage:Ordinary", "Template:Target"],
        ["Vorlage:lokalvariable", "Template:Lower target"],
    ]);
    assert.equal(
        applyTemplateRedirects(
            source,
            redirects,
            EXAMPLE_NAMESPACE_CATALOG,
            EXAMPLE_MAGIC_WORDS,
        ),
        "{{lokalfunktion：x}} {{LOKALVARIABLE}} {{ersetzen:Old}} " +
            "{{Target}} {{Lower target}}",
    );
});

test("magic-word collisions remain ordinary template candidates", () => {
    assert.deepEqual(
        collectTemplateTitles(
            "{{CURRENTDAYNAME|x}} {{Template:CURRENTYEAR}} " +
                "{{defaultsort:key}}",
            EN_NAMESPACE_CATALOG,
            EN_MAGIC_WORDS,
        ),
        [
            "Template:CURRENTDAYNAME",
            "Template:CURRENTYEAR",
            "Template:defaultsort:key",
        ],
    );
});

test("template lookup uses current-wiki magic-word aliases", () => {
    assert.deepEqual(
        collectTemplateTitles(
            "{{替換:Old}} {{訊息:Old}} {{原始:Old}} " +
                "{{默认排序:Old}} {{页名}} {{#调用:Module|main}}",
            ZH_NAMESPACE_CATALOG,
            ZH_MAGIC_WORDS,
        ),
        [],
    );
});

test("dynamic outer heads do not hide ordinary nested calls", () => {
    assert.deepEqual(
        collectTemplateTitles(
            "{{ {{Old}} }} {{Prefix {{Inner}}}}",
            EN_NAMESPACE_CATALOG,
            EN_MAGIC_WORDS,
        ),
        ["Template:Old", "Template:Inner"],
    );
});

test("template lookup ignores comments and literal tag contents", () => {
    assert.deepEqual(
        collectTemplateTitles(
            "<!-- {{Comment}} --><nowiki>{{Literal}}</nowiki> " +
                "<pre>{{Pre}}</pre> {{Visible}}",
            EN_NAMESPACE_CATALOG,
            EN_MAGIC_WORDS,
        ),
        ["Template:Visible"],
    );
});

test("redirect rewriting preserves unpiped display text", () => {
    const redirects = new Map([
        ["Foo", "Target"],
        ["Foo bar", "Other target"],
    ]);

    assert.equal(
        applyWikiLinkRedirects("[[Foo]] [[Foo#Part]] [[Foo_bar]]", redirects),
        "[[Target|Foo]] [[Target#Part|Foo#Part]] " + "[[Other target|Foo bar]]",
    );
});

test("redirect rewriting keeps fragments and explicit labels", () => {
    const redirects = new Map([["Foo", "Target"]]);

    assert.equal(
        applyWikiLinkRedirects(
            "[[Foo|label]] [[Foo#Part|label with <nowiki>|</nowiki> pipe]]",
            redirects,
        ),
        "[[Target|label]] " +
            "[[Target#Part|label with <nowiki>|</nowiki> pipe]]",
    );
});

test("entered fragments override redirect target fragments", () => {
    const redirects = new Map([["Foo", "Target#Default"]]);

    assert.equal(
        applyWikiLinkRedirects(
            "[[Foo]] [[Foo#Entered]] [[Foo|label]]",
            redirects,
        ),
        "[[Target#Default|Foo]] [[Target#Entered|Foo#Entered]] " +
            "[[Target#Default|label]]",
    );
});

test("redirect rewriting preserves leading-colon link escapes", () => {
    const redirects = new Map([
        ["Foo", "Target"],
        ["Category:Old", "Category:New"],
    ]);
    assert.equal(
        applyWikiLinkRedirects(
            "[[:Foo]] [[:Category:Old]]",
            redirects,
            EN_NAMESPACE_CATALOG,
        ),
        "[[:Target|Foo]] [[:Category:New|Category:Old]]",
    );
});

test("redirect rewriting does not add labels to embedded links", () => {
    const redirects = new Map([
        ["Kategorie:Old", "Kategorie:New"],
        ["Datei:Old.svg", "Datei:New.svg"],
    ]);
    assert.equal(
        applyWikiLinkRedirects(
            "[[Kategorie:Old]] [[Datei:Old.svg]]",
            redirects,
            EXAMPLE_NAMESPACE_CATALOG,
        ),
        "[[Kategorie:New]] [[Datei:New.svg]]",
    );
});

function aliases(
    caseInsensitive: string[] = [],
    caseSensitive: string[] = [],
): MagicWordAliases {
    return Object.freeze({
        caseInsensitive: new Set(
            caseInsensitive.map((value) => value.toLowerCase()),
        ),
        caseSensitive: new Set(caseSensitive),
    });
}

test("redirect rewriting keeps cross-namespace embeds unchanged", () => {
    const redirects = new Map([
        ["Category:Old", "Article"],
        ["File:Old.svg", "Category:New"],
    ]);

    assert.equal(
        applyWikiLinkRedirects(
            "[[Category:Old]] [[File:Old.svg|thumb|caption]]",
            redirects,
            EN_NAMESPACE_CATALOG,
        ),
        "[[Category:Old]] [[File:Old.svg|thumb|caption]]",
    );
});

test("redirect targets in embedded namespaces stay ordinary links", () => {
    const redirects = new Map([
        ["Foo", "Category:New"],
        ["Bar", "File:New.svg"],
    ]);

    assert.equal(
        applyWikiLinkRedirects(
            "[[Foo]] [[Bar|label]]",
            redirects,
            EN_NAMESPACE_CATALOG,
        ),
        "[[:Category:New|Foo]] [[:File:New.svg|label]]",
    );
});

test("redirect rewriting handles links nested in file captions", () => {
    const redirects = new Map([
        ["File:Old.svg", "File:New.svg"],
        ["Foo", "Target"],
    ]);

    assert.equal(
        applyWikiLinkRedirects(
            "[[File:Old.svg|caption [[Foo]]]]",
            redirects,
            EN_NAMESPACE_CATALOG,
        ),
        "[[File:New.svg|caption [[Target|Foo]]]]",
    );
});

test("redirect rewriting ignores comments and literal tag contents", () => {
    const redirects = new Map([["Foo", "Target"]]);
    const source =
        "<!-- [[Foo]] --><nowiki>[[Foo]]</nowiki>" +
        "<pre>[[Foo]]</pre> [[Foo]]";

    assert.equal(
        applyWikiLinkRedirects(source, redirects),
        "<!-- [[Foo]] --><nowiki>[[Foo]]</nowiki>" +
            "<pre>[[Foo]]</pre> [[Target|Foo]]",
    );
});

test("template redirect rewriting preserves entered namespace style", () => {
    const redirects = new Map([
        ["Vorlage:Old", "Template:New"],
        ["Vorlage:Second", "Template:New second"],
        ["Vorlage:Third", "Template:New third"],
    ]);

    assert.equal(
        applyTemplateRedirects(
            "{{ Old }} {{ Vorlage :  Second |x}} {{TM:Third}}",
            redirects,
            EXAMPLE_NAMESPACE_CATALOG,
            EXAMPLE_MAGIC_WORDS,
        ),
        "{{ New }} {{ Vorlage :  New second |x}} {{TM:New third}}",
    );
});

test("template redirect rewriting handles nested ordinary calls", () => {
    const redirects = new Map([
        ["Template:Outer", "Template:Outer target"],
        ["Template:Inner", "Template:Inner target"],
    ]);

    assert.equal(
        applyTemplateRedirects(
            "{{Outer|value={{Inner|x}}}}",
            redirects,
            EN_NAMESPACE_CATALOG,
            EN_MAGIC_WORDS,
        ),
        "{{Outer target|value={{Inner target|x}}}}",
    );
});

test("template redirect rewriting skips cross-namespace targets", () => {
    const redirects = new Map([
        ["Template:Article", "Article"],
        ["Template:Help", "Help:Target"],
        ["Template:Category", "Category:Target"],
        ["Template:Fragment", "Template:Target#Section"],
    ]);
    const source =
        "{{Article}} {{Help}} {{Category}} {{Fragment}} " +
        "{{:Article}} {{Help:Entered}} {{Old#Section}}";

    assert.equal(
        applyTemplateRedirects(
            source,
            redirects,
            EN_NAMESPACE_CATALOG,
            EN_MAGIC_WORDS,
        ),
        source,
    );
});

test("template redirect rewriting leaves protected source untouched", () => {
    const redirects = new Map([["Template:Old", "Template:New"]]);
    const source =
        "<!-- {{Old}} --><nowiki>{{Old}}</nowiki>" +
        "<pre>{{Old}}</pre> {{Old}}";

    assert.equal(
        applyTemplateRedirects(
            source,
            redirects,
            EN_NAMESPACE_CATALOG,
            EN_MAGIC_WORDS,
        ),
        "<!-- {{Old}} --><nowiki>{{Old}}</nowiki>" +
            "<pre>{{Old}}</pre> {{New}}",
    );
});

test("redirect lookup retains target fragments", async () => {
    const api = {
        async get() {
            return {
                query: {
                    pages: [{ title: "Target" }],
                    redirects: [
                        {
                            from: "Foo",
                            to: "Target",
                            tofragment: "Default",
                        },
                    ],
                },
            };
        },
    };

    const lookup = await lookupWikiLinks(api, ["Foo"]);

    assert.deepEqual([...lookup.redirects], [["Foo", "Target#Default"]]);
    assert.deepEqual([...lookup.missing], []);
});

test("redirect lookup keeps the MediaWiki title batch limit", async () => {
    const batchSizes: number[] = [];
    const api = {
        async get(parameters: Record<string, unknown>) {
            const titles = String(parameters.titles).split("|");
            batchSizes.push(titles.length);
            return {
                query: {
                    pages: titles.map((title) => ({ title })),
                },
            };
        },
    };
    const titles = Array.from({ length: 101 }, (_, index) => `Page ${index}`);

    await lookupWikiLinks(api, titles);

    assert.deepEqual(batchSizes, [50, 50, 1]);
});

test("API title mappings do not conflate case-distinct pages", async () => {
    const api = {
        async get() {
            return {
                query: {
                    normalized: [{ from: "foo", to: "Foo" }],
                    pages: [{ title: "Target" }, { title: "FOO" }],
                    redirects: [{ from: "Foo", to: "Target" }],
                },
            };
        },
    };

    const lookup = await lookupWikiLinks(api, ["foo", "FOO"]);

    assert.deepEqual([...lookup.redirects], [["foo", "Target"]]);
    assert.deepEqual([...lookup.missing], []);
    assert.equal(
        applyWikiLinkRedirects("[[foo]] [[FOO]]", lookup.redirects),
        "[[Target|foo]] [[FOO]]",
    );
});

test("missing title lookup preserves case-distinct page keys", async () => {
    const api = {
        async get() {
            return {
                query: {
                    pages: [{ missing: true, title: "Foo" }, { title: "FOO" }],
                },
            };
        },
    };

    const lookup = await lookupWikiLinks(api, ["Foo", "FOO"]);

    assert.deepEqual([...lookup.missing], ["Foo"]);
});

test("Chinese conversion recognizes an existing local page", async () => {
    let request: Record<string, unknown> | undefined;
    const api = {
        async get(parameters: Record<string, unknown>) {
            request = parameters;
            return {
                query: {
                    converted: [{ from: "软件包维护者", to: "軟體包維護者" }],
                    pages: [{ title: "軟體包維護者" }],
                },
            };
        },
    };

    const lookup = await lookupWikiLinks(api, ["软件包维护者"]);

    assert.equal(request?.converttitles, 1);
    assert.equal(request?.inprop, "linkclasses");
    assert.equal(request?.iwurl, 1);
    assert.equal(request?.prop, "info");
    assert.deepEqual([...lookup.missing], []);
    assert.deepEqual([...lookup.redirects], []);
});

test("missing converted titles map back to the entered link", async () => {
    const api = {
        async get() {
            return {
                query: {
                    converted: [{ from: "不存在页面", to: "不存在頁面" }],
                    pages: [
                        {
                            linkclasses: ["new"],
                            missing: true,
                            title: "不存在頁面",
                        },
                    ],
                },
            };
        },
    };

    const lookup = await lookupWikiLinks(api, ["不存在页面"]);

    assert.deepEqual([...lookup.missing], ["不存在页面"]);
    assert.deepEqual(lookup.missingLinkClasses, ["new"]);
});
