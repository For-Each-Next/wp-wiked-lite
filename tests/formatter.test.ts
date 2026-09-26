import assert from "node:assert/strict";
import test from "node:test";
import { formatWikitext } from "../src/domain/formatter.ts";

test("HTML tag formatting is an explicit opt-in", () => {
    const source = "< ref     name=222      /    >";
    assert.deepEqual(formatWikitext(source), { changed: false, text: source });
    assert.deepEqual(formatWikitext(source, { formatHtmlTags: false }), {
        changed: false,
        text: source,
    });
});

test("HTML formatting normalizes the requested reference tag examples", () => {
    const fixtures = [
        ["< ref     name=222      /    >", '<ref name="222" />'],
        [
            '< ref     name=222   style="key1 : a; key2:b "       >123</ ref>',
            '<ref name="222" style="key1: a; key2: b;">123</ref>',
        ],
    ];
    for (const [source, expected] of fixtures) {
        assert.deepEqual(formatWikitext(source, { formatHtmlTags: true }), {
            changed: true,
            text: expected,
        });
        assert.deepEqual(formatWikitext(expected, { formatHtmlTags: true }), {
            changed: false,
            text: expected,
        });
    }
});

test("HTML formatting preserves attribute order, duplicates, case, boolean attributes and quote styles", () => {
    const source =
        "< SPAN  CLASS = alpha  hidden data-X=one class=two title='a > b &quot;c&quot;' >Text</ SPAN >";
    assert.equal(
        formatWikitext(source, { formatHtmlTags: true }).text,
        '<SPAN CLASS="alpha" hidden data-X="one" class="two" title=\'a > b &quot;c&quot;\'>Text</SPAN>',
    );
    assert.equal(
        formatWikitext("< br  / > <hr  >", { formatHtmlTags: true }).text,
        "<br /> <hr>",
    );
});

test("HTML formatting retains templates and entities inside quoted attribute values", () => {
    const source =
        '< ref name=source details="{{URL|https://example.test/?a=1&amp;b=2|地球冒险3}}. 作者 :90-93" data-value="{{{value|a > b}}}" / >';
    const expected =
        '<ref name="source" details="{{URL|https://example.test/?a=1&amp;b=2|地球冒险3}}. 作者 :90-93" data-value="{{{value|a > b}}}" />';
    assert.equal(
        formatWikitext(source, { formatHtmlTags: true }).text,
        expected,
    );
});

test("HTML formatting recognizes standard links, images and disclosure tags", () => {
    const source =
        "< details open >< summary >Caption</ summary>< a href=https://example.test/path >< img src=image.png / ></ a ></ details>";
    assert.equal(
        formatWikitext(source, { formatHtmlTags: true }).text,
        '<details open><summary>Caption</summary><a href="https://example.test/path"><img src="image.png" /></a></details>',
    );
});

test("HTML formatting leaves malformed, dynamic and unknown tag syntax unchanged", () => {
    for (const source of [
        "<span class={{#if: x|a|b}}>text</span>",
        "<span {{attributes|class=x}}>text</span>",
        '<span a="x"bad=y>text</span>',
        "<span value=>text</span>",
        '<span name="unfinished>text</span>',
        "<span class=x",
        "<div class=foo<!--keep-->bar>Text</div>",
        '<div style="--value: foo<!--keep-->bar">Text</div>',
        "<custom-widget attr=value>text</custom-widget>",
        "1 < 2 and a < b > c",
    ]) {
        assert.equal(
            formatWikitext(source, { formatHtmlTags: true }).text,
            source,
        );
    }
});

test("HTML formatting protects comments and entire literal extension tags", () => {
    const source = [
        "<!-- < ref name=comment / > -->",
        "< nowiki  >< ref name=literal / ></ nowiki >",
        '<syntaxhighlight lang=html>< span style="key : x">code</ span></syntaxhighlight>',
        "<math>< ref name=formula / ></math>",
        "<ref name=visible />",
    ].join("\n");
    assert.equal(
        formatWikitext(source, { formatHtmlTags: true }).text,
        source.replace("<ref name=visible />", '<ref name="visible" />'),
    );
});

test("HTML style formatting preserves strings, functions, data URLs and nested wikitext", () => {
    const source =
        '< span style=\'color:red; background : url("data:image/svg+xml;a:b;c"); content : "a;b:c"; width:calc(100% - var(--gap)); --tokens: [ a; b:c ]\' >text</ span>';
    const expected =
        '<span style=\'color: red; background: url("data:image/svg+xml;a:b;c"); content: "a;b:c"; width: calc(100% - var(--gap)); --tokens: [ a; b:c ];\'>text</span>';
    assert.equal(
        formatWikitext(source, { formatHtmlTags: true }).text,
        expected,
    );
    const dynamic =
        '<span style="color : {{color|red}} ; width:2em ">text</span>';
    assert.equal(
        formatWikitext(dynamic, { formatHtmlTags: true }).text,
        dynamic,
    );
});

test("HTML formatting preserves conversion-rule values while formatting surrounding tags", () => {
    const conversion =
        '-{zh-cn:< span style="color:red" >简体</ span>;zh-tw:< ref name=繁體 / >;}-';
    const source = `${conversion}< span class=outside >Text</ span>`;
    assert.equal(
        formatWikitext(source, { formatHtmlTags: true }).text,
        `${conversion}<span class="outside">Text</span>`,
    );
});

test("basic formatting protects comments and literal extension tags", () => {
    const source = [
        "==Heading==   ",
        "<!-- ==  keep  ==   -->",
        "<nowiki>==  keep  ==   </nowiki>",
        "*   item   ",
    ].join("\n");

    const result = formatWikitext(source);

    assert.equal(
        result.text,
        [
            "== Heading ==",
            "",
            "<!-- ==  keep  ==   -->",
            "<nowiki>==  keep  ==   </nowiki>",
            "* item",
        ].join("\n"),
    );
});

test("basic formatting separates headings but not DEFAULTSORT", () => {
    const source = [
        "==Heading==",
        "Paragraph.",
        "{{DEFAULTSORT:Example}}",
        "[[Category:Example]]",
    ].join("\n");

    assert.equal(
        formatWikitext(source).text,
        [
            "== Heading ==",
            "",
            "Paragraph.",
            "{{DEFAULTSORT:Example}}",
            "[[Category:Example]]",
        ].join("\n"),
    );
});

test("basic formatting preserves whitespace-only category sort keys", () => {
    const source = "[[Category:电子游戏专题| ]]";

    assert.deepEqual(formatWikitext(source), {
        changed: false,
        text: source,
    });
});

test("basic formatting separates every MediaWiki heading level", () => {
    for (let level = 1; level <= 6; level += 1) {
        const marks = "=".repeat(level);
        const source = `${marks}Heading${marks}\nParagraph.`;
        const expected = `${marks} Heading ${marks}\n\nParagraph.`;

        assert.equal(formatWikitext(source).text, expected);
        assert.deepEqual(formatWikitext(expected), {
            changed: false,
            text: expected,
        });
    }
});

test("basic formatting separates headings from preceding content", () => {
    const source = "Lead paragraph.\n==Heading==\nParagraph.";
    const expected = "Lead paragraph.\n\n== Heading ==\n\nParagraph.";

    assert.equal(formatWikitext(source).text, expected);
    assert.deepEqual(formatWikitext(expected), {
        changed: false,
        text: expected,
    });
});

test("adjacent headings share one separating blank line", () => {
    const source = "==First==\n===Second===";
    const expected = "== First ==\n\n=== Second ===\n\n";

    assert.equal(formatWikitext(source).text, expected);
    assert.deepEqual(formatWikitext(expected), {
        changed: false,
        text: expected,
    });
});

test("heading normalization does not cross line boundaries", () => {
    const source = "==\nHeading\n==\nParagraph.";

    assert.deepEqual(formatWikitext(source), {
        changed: false,
        text: source,
    });
});

test("heading normalization does not reinterpret delimiter runs", () => {
    for (let level = 1; level <= 6; level += 1) {
        const source = "=".repeat(level * 2);
        assert.deepEqual(formatWikitext(source), {
            changed: false,
            text: source,
        });
    }

    const levelSeven = "=======Heading=======";
    assert.deepEqual(formatWikitext(levelSeven), {
        changed: false,
        text: levelSeven,
    });
});

test("heading separation stays idempotent at end of input", () => {
    const expected = "== Heading ==\n\n";
    for (const source of ["==Heading==", "==Heading==\n", expected]) {
        const once = formatWikitext(source).text;

        assert.equal(once, expected);
        assert.equal(formatWikitext(once).text, expected);
    }
});

test("first-line section headings do not gain a leading blank line", () => {
    const source = "===Section===\nSection text.";
    const expected = "=== Section ===\n\nSection text.";

    assert.equal(formatWikitext(source).text, expected);
    assert.deepEqual(formatWikitext(expected), {
        changed: false,
        text: expected,
    });
});

test("basic formatting normalizes wikitable syntax spacing", () => {
    const source = [
        '{|class="wikitable"',
        "|+Caption",
        '!Name!! scope="col"|Value',
        '|-style="font-size: smaller;"',
        "|1||[[Target|label]]",
        '| scope="row" |{{Sort|1|two}}',
        "|}",
    ].join("\n");
    const expected = [
        '{| class="wikitable"',
        "|+ Caption",
        '! Name !! scope="col" | Value',
        '|- style="font-size: smaller;"',
        "| 1 || [[Target|label]]",
        '| scope="row" | {{Sort|1|two}}',
        "|}",
    ].join("\n");

    assert.equal(formatWikitext(source).text, expected);
    assert.deepEqual(formatWikitext(expected), {
        changed: false,
        text: expected,
    });
});

test("wikitable spacing normalizes empty inline cells", () => {
    const source = ["{|", "!a!!", "|a||", "!a!!!!b", "|a||||b", "|}"].join(
        "\n",
    );
    const expected = [
        "{|",
        "! a !!",
        "| a ||",
        "! a !! !! b",
        "| a || || b",
        "|}",
    ].join("\n");

    assert.equal(formatWikitext(source).text, expected);
    assert.deepEqual(formatWikitext(expected), {
        changed: false,
        text: expected,
    });
    for (const line of expected.split("\n")) {
        assert.equal(line, line.trimEnd());
    }
});

test("wikitable spacing ignores table-like text in protected regions", () => {
    const source = [
        "<!-- {|class=comment -->",
        "<nowiki>",
        '{|class="wikitable"',
        "|cell",
        "|}",
        "</nowiki>",
    ].join("\n");

    assert.deepEqual(formatWikitext(source), {
        changed: false,
        text: source,
    });
});

test("explicit formatter options align templates", () => {
    const source = [
        "{{Cite web",
        "|url=https://example.test",
        "|long-name = Value",
        "}}",
    ].join("\n");

    const result = formatWikitext(source, {
        firstParameterLayout: "align-values",
        formatFirstParameter: true,
        indentBlockTemplates: true,
    });

    assert.match(result.text, / {2}\| url\s+= https:\/\/example\.test/u);
});

test("Chinese conversion normalization is opt in", () => {
    const source = "-{  zh-hans:简体 ;zh-hant:繁體  }-";

    assert.equal(formatWikitext(source).text, source);
    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        "-{zh-hans:简体 ; zh-hant:繁體;}-",
    );
});

test("conversion normalization preserves rule value bytes", () => {
    const source =
        "-{ zh-cn:  A<!-- x;y -->{{lang|en|B;C}}" +
        '<span title="d;e">D</span>  ;zh-tw:C ; }-';
    const expected =
        "-{zh-cn:  A<!-- x;y -->{{lang|en|B;C}}" +
        '<span title="d;e">D</span>  ; zh-tw:C ;}-';

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
    assert.deepEqual(formatWikitext(expected, { normalizeConversion: true }), {
        changed: false,
        text: expected,
    });
    assert.equal(
        formatWikitext("-{  zh-cn:123<!-- 455 -->333; zh-tw:dd  }-", {
            normalizeConversion: true,
        }).text,
        "-{zh-cn:123<!-- 455 -->333; zh-tw:dd;}-",
    );
});

test("conversion normalization retains multiline separator layouts", () => {
    const source = ["-{  zh-cn:first;", "    zh-tw:  second  ", "  }-"].join(
        "\n",
    );
    const expected = ["-{zh-cn:first;", "    zh-tw:  second;", "}-"].join("\n");

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
});

test("conversion normalization supports NoteTA aliases", () => {
    const fixtures = [
        [
            "{{NoteTA|1= zh-cn:one;zh-tw:two |G1=zh-cn:no;zh-tw:change}}",
            "{{NoteTA|1= zh-cn:one; zh-tw:two; |G1=zh-cn:no;zh-tw:change}}",
        ],
        [
            "{{TA-lite|t= zh-cn:one ;zh-tw:two; }}",
            "{{TA-lite|t= zh-cn:one ; zh-tw:two; }}",
        ],
        [
            "{{全文字词转换| zh-cn:one;zh-tw:two }}",
            "{{全文字词转换| zh-cn:one; zh-tw:two; }}",
        ],
    ] as const;

    for (const [source, expected] of fixtures) {
        assert.equal(
            formatWikitext(source, { normalizeConversion: true }).text,
            expected,
        );
        assert.equal(
            formatWikitext(expected, { normalizeConversion: true }).text,
            expected,
        );
    }
});

test("NoteTA preserves parameter padding and limits conversion slots", () => {
    const exactFixtures = [
        ["{{NoteTA|25= xxx=>zh-tw:xx }}", "{{NoteTA|25= xxx=>zh-tw:xx; }}"],
        ["{{NoteTA|1= 种 }}", "{{NoteTA|1= 种 }}"],
        ["{{NoteTA|1= 种; }}", "{{NoteTA|1= 种; }}"],
    ] as const;
    for (const [entered, expectedText] of exactFixtures) {
        assert.equal(
            formatWikitext(entered, { normalizeConversion: true }).text,
            expectedText,
        );
    }
    const source =
        "{{NoteTA|25= xxx=>zh-tw:xx |30=zh-cn:a;zh-tw:b " +
        "|31=zh-cn:no;zh-tw:no |T= zh-cn:t;zh-tw:t " +
        "|G=zh-cn:g;zh-tw:g |d=zh-cn:d;zh-tw:d |1= 种 |2= 种; }}";
    const expected =
        "{{NoteTA|25= xxx=>zh-tw:xx; |30=zh-cn:a; zh-tw:b; " +
        "|31=zh-cn:no;zh-tw:no |T= zh-cn:t; zh-tw:t; " +
        "|G=zh-cn:g;zh-tw:g |d=zh-cn:d;zh-tw:d |1= 种 |2= 种; }}";

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
});

test("outer rules preserve nested conversion syntax", () => {
    const source =
        "-{ zh-cn:outer -{  zh-cn:inner;zh-tw:nested  }-;" + "zh-tw:outer }-";
    const expected =
        "-{zh-cn:outer -{  zh-cn:inner;zh-tw:nested  }-; " + "zh-tw:outer;}-";

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
});

test("recognized NoteTA rules do not normalize nested definitions", () => {
    const source =
        "{{NoteTA|1= zh-cn:-{  zh-cn:x;zh-tw:y  }- " +
        "{{NoteTA|1= zh-cn:a;zh-tw:b }};zh-tw:outer }}";
    const expected =
        "{{NoteTA|1= zh-cn:-{  zh-cn:x;zh-tw:y  }- " +
        "{{NoteTA|1= zh-cn:a;zh-tw:b }}; zh-tw:outer; }}";

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
});

test("recognized language rules do not normalize a nested NoteTA", () => {
    const source = "-{ zh-cn:{{NoteTA|1= zh-cn:a;zh-tw:b }};zh-tw:outer }-";
    const expected = "-{zh-cn:{{NoteTA|1= zh-cn:a;zh-tw:b }}; zh-tw:outer;}-";

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
});

test("conversion normalization ignores literals and non-rules", () => {
    const source = [
        "<nowiki>-{ zh-cn:one;zh-tw:two }-</nowiki>",
        "{{NoteTA|1=H|G1= zh-cn:one;zh-tw:two }}",
        "-{H|zh-cn:<nowiki>a;b:c</nowiki>;zh-tw:two}-",
    ].join("\n");
    const expected = [
        "<nowiki>-{ zh-cn:one;zh-tw:two }-</nowiki>",
        "{{NoteTA|1=H|G1= zh-cn:one;zh-tw:two }}",
        "-{H|zh-cn:<nowiki>a;b:c</nowiki>; zh-tw:two;}-",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { normalizeConversion: true }).text,
        expected,
    );
});

test("complete reference tags remain positional in efn notes", () => {
    const source =
        '{{efn|見以下文獻：<ref name="Gould, 2026" />' +
        '<ref name="Hon, 2026" /><ref name="Meghan G, 2026" />' +
        '<ref name="Seigh, 2026" />}}';

    assert.deepEqual(formatWikitext(source), {
        changed: false,
        text: source,
    });
    assert.equal(
        formatWikitext('{{other|Text<ref name="source" />}}').text,
        '{{other|Text<ref name="source" />}}',
    );
    assert.equal(
        formatWikitext('{{efn|name=context|1=Text<ref name="source" />}}').text,
        '{{efn|name=context|1=Text<ref name="source" />}}',
    );
});

test("numbers efn notes containing unclosed reference tags", () => {
    const source = '{{efn|Text<ref name="source">}}';
    const expected = source.replace("{{efn|", "{{efn|1=");

    assert.equal(formatWikitext(source).text, expected);
    assert.deepEqual(formatWikitext(expected), {
        changed: false,
        text: expected,
    });
});

test("nested template pipes and closers follow structural depth", () => {
    const source = [
        "{{Infobox country",
        "  | other_symbol = {{columns",
        "  | col1 = [[File:Gyomei_kokuji.svg|75px]] <br /> " + "[[大日本國璽]]",
        "  | col2 = [[File:Emblem of the Government of Japan " +
            "(yellow).svg|75px]] <br />[[桐紋|五七桐花紋]]",
        "}}",
        "  | image_map = Japan.svg",
        "}}",
    ].join("\n");

    const result = formatWikitext(source, { indentBlockTemplates: true });

    assert.equal(
        result.text,
        [
            "{{Infobox country",
            "  | other_symbol = {{columns",
            "    | col1 = [[File:Gyomei_kokuji.svg|75px]] <br /> " +
                "[[大日本國璽]]",
            "    | col2 = [[File:Emblem of the Government of Japan " +
                "(yellow).svg|75px]] <br />[[桐紋|五七桐花紋]]",
            "  }}",
            "  | image_map = Japan.svg",
            "}}",
        ].join("\n"),
    );
});

test("deeper block templates indent pipes and closers by depth", () => {
    const source = [
        "{{outer",
        "| middle = {{middle",
        "| inner = {{inner",
        "| leaf = value",
        "   }}",
        "| middle_after = value",
        "\t}}",
        "| outer_after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | middle = {{middle",
            "    | inner = {{inner",
            "      | leaf = value",
            "    }}",
            "    | middle_after = value",
            "  }}",
            "  | outer_after = value",
            "}}",
        ].join("\n"),
    );
});

test("block indentation can leave the first template level unindented", () => {
    const source = [
        "{{outer",
        "  | middle = {{middle",
        "| inner = {{inner",
        "   | leaf = value",
        "      }}",
        "| middle_after = value",
        "  }}",
        "  | outer_after = value",
        "}}",
    ].join("\n");
    const expected = [
        "{{outer",
        "| middle = {{middle",
        "  | inner = {{inner",
        "    | leaf = value",
        "  }}",
        "  | middle_after = value",
        "}}",
        "| outer_after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            indentBlockTemplates: true,
            skipFirstLevelIndentation: true,
        }).text,
        expected,
    );
    assert.deepEqual(
        formatWikitext(expected, {
            indentBlockTemplates: true,
            skipFirstLevelIndentation: true,
        }),
        { changed: false, text: expected },
    );
});

test("first-level indentation remains enabled by default", () => {
    const source = ["{{outer", "| value = text", "}}"].join("\n");
    const expected = ["{{outer", "  | value = text", "}}"].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        expected,
    );
    assert.equal(
        formatWikitext(source, {
            indentBlockTemplates: true,
            skipFirstLevelIndentation: false,
        }).text,
        expected,
    );
});

test("block template indentation accepts zero and larger integer widths", () => {
    const source = [
        "{{outer",
        "| nested = {{inner",
        "| value = text",
        "}}",
        "}}",
    ].join("\n");

    for (const indentSpaces of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12]) {
        const indent = " ".repeat(indentSpaces);
        const expected = [
            "{{outer",
            `${indent}| nested = {{inner`,
            `${indent}${indent}| value = text`,
            `${indent}}}`,
            "}}",
        ].join("\n");

        assert.equal(
            formatWikitext(source, {
                indentBlockTemplates: true,
                indentSpaces,
            }).text,
            expected,
        );
    }
});

test("invalid block indentation widths fall back to two spaces", () => {
    const source = ["{{outer", "| value = text", "}}"].join("\n");
    const expected = ["{{outer", "  | value = text", "}}"].join("\n");

    for (const indentSpaces of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        assert.equal(
            formatWikitext(source, {
                indentBlockTemplates: true,
                indentSpaces,
            }).text,
            expected,
        );
    }
});

test("equals alignment is independent for each nested template", () => {
    const source = [
        "{{outer",
        "| a = one",
        "| nested = {{inner",
        "| x = two",
        "| longer = three",
        "}}",
        "| outer_longest_name = four",
        "}}",
    ].join("\n");
    const lines = formatWikitext(source, {
        firstParameterLayout: "align-values",
        formatFirstParameter: true,
        indentBlockTemplates: true,
    }).text.split("\n");

    assert.equal(lines[1].indexOf("="), lines[2].indexOf("="));
    assert.equal(lines[1].indexOf("="), lines[6].indexOf("="));
    assert.equal(lines[3].indexOf("="), lines[4].indexOf("="));
    assert.ok(lines[3].indexOf("=") < lines[1].indexOf("="));
});

test("equals alignment ignores marks and counts non-ASCII width", () => {
    const combiningName = "e\u0301";
    const source = [
        "{{outer",
        `| ${combiningName} = one`,
        "| aa = two",
        "| Ａ = three",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            characterWidthRatio: "5:3",
            firstParameterLayout: "align-values",
            formatFirstParameter: true,
            indentBlockTemplates: true,
        }).text,
        [
            "{{outer",
            `  | ${combiningName}  = one`,
            "  | aa = two",
            "  | Ａ  = three",
            "}}",
        ].join("\n"),
    );
});

test("block formatting leaves table pipes unchanged", () => {
    const source = [
        "{{Infobox",
        "| data = table follows",
        '{| class="wikitable"',
        "|-",
        "| name = cell",
        "|}",
        "| after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{Infobox",
            "  | data = table follows",
            '{| class="wikitable"',
            "|-",
            "| name = cell",
            "|}",
            "  | after = value",
            "}}",
        ].join("\n"),
    );
});

test("block formatting leaves templates inside tables unchanged", () => {
    const source = [
        '{| class="wikitable"',
        "| {{cell template",
        "| short = one",
        "| longer_name = two",
        "}}",
        "|}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            firstParameterLayout: "align-values",
            formatFirstParameter: true,
            indentBlockTemplates: true,
        }).text,
        source,
    );
});

test("nested template closers inside tables keep entered indentation", () => {
    const source = [
        "{{outer",
        "| data = table",
        '{| class="wikitable"',
        "| {{inner",
        "| value = cell",
        "     }}",
        "|}",
        "| after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | data = table",
            '{| class="wikitable"',
            "| {{inner",
            "| value = cell",
            "     }}",
            "|}",
            "  | after = value",
            "}}",
        ].join("\n"),
    );
});

test("block formatting preserves continuations and aligns closers", () => {
    const source = [
        "{{outer",
        "| nested = {{inner",
        "| text = first line",
        "  second line with [[A|B]]",
        "     }}",
        "| after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | nested = {{inner",
            "    | text = first line",
            "  second line with [[A|B]]",
            "  }}",
            "  | after = value",
            "}}",
        ].join("\n"),
    );
});

test("closer indentation is limited to standalone template lines", () => {
    const annotatedSource = [
        "{{outer",
        "| nested = {{inner",
        "| value = one",
        "   }}<!-- keep entered indentation -->",
        "| after = two",
        "}}",
    ].join("\n");
    const alignedOnlySource = [
        "{{outer",
        "| nested = {{inner",
        "| value = one",
        "\t}}",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(annotatedSource, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | nested = {{inner",
            "    | value = one",
            "   }}<!-- keep entered indentation -->",
            "  | after = two",
            "}}",
        ].join("\n"),
    );
    assert.equal(
        formatWikitext(alignedOnlySource, {
            firstParameterLayout: "align-values",
            formatFirstParameter: true,
        }).text.split("\n")[3],
        "\t}}",
    );
});

test("block indentation treats opaque fake syntax as byte-identical", () => {
    const nowiki = ["<nowiki>{{fake", "| fake = nowiki", "}}</nowiki>"].join(
        "\n",
    );
    const syntaxHighlight = [
        '<syntaxhighlight lang="wikitext">',
        "{{fake",
        "| fake = code",
        "}}",
        "</syntaxhighlight>",
    ].join("\n");
    const comment = ["<!-- {{fake", "| fake = comment", "}} -->"].join("\n");
    const source = [
        "{{outer",
        `| literal = ${nowiki}`,
        `| code = ${syntaxHighlight}`,
        `| note = ${comment}`,
        "| after = value",
        "}}",
    ].join("\n");
    const result = formatWikitext(source, {
        indentBlockTemplates: true,
    }).text;

    assert.equal(
        result,
        [
            "{{outer",
            `  | literal = ${nowiki}`,
            `  | code = ${syntaxHighlight}`,
            `  | note = ${comment}`,
            "  | after = value",
            "}}",
        ].join("\n"),
    );
    for (const opaque of [nowiki, syntaxHighlight, comment]) {
        assert.ok(result.includes(opaque));
    }
});

test("templates inside variables do not close the owning template", () => {
    const source = [
        "{{outer",
        "| value = {{{parameter|{{fake|x=y}}}}}",
        "| after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | value = {{{parameter|{{fake|x=y}}}}}",
            "  | after = value",
            "}}",
        ].join("\n"),
    );
});

test("variable defaults stay unchanged inside block templates", () => {
    const source = [
        "{{outer",
        "| value = {{{parameter|",
        "{{fake",
        "| default = entered",
        "     }}",
        "}}}",
        "| after = value",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | value = {{{parameter|",
            "{{fake",
            "| default = entered",
            "     }}",
            "}}}",
            "  | after = value",
            "}}",
        ].join("\n"),
    );
});

test("unfinished block templates retain live nesting depth", () => {
    const source = [
        "{{outer",
        "| first = one",
        "| nested = {{inner",
        "| child = two",
        "}}",
        "| after = three",
    ].join("\n");

    assert.equal(
        formatWikitext(source, { indentBlockTemplates: true }).text,
        [
            "{{outer",
            "  | first = one",
            "  | nested = {{inner",
            "    | child = two",
            "  }}",
            "  | after = three",
        ].join("\n"),
    );
});

const nestedMatrixSource = [
    "{{xx",
    "| p1 = a | p2 = {{embedded x",
    "| pp1 = ... | pp2=..",
    "| pp21_loooong = ... | pp22 = ..",
    "| longxx+",
    "}}",
    "| longer = value | q = {{embedded x",
    "| pp1 = ... | pp2=..",
    "| longxx+",
    "}}",
    "}}",
].join("\n");

const nestedMatrixExpected = [
    "{{xx",
    "  | p1     = a     | p2 = {{embedded x",
    "    | pp1          = ... | pp2  = ..",
    "    | pp21_loooong = ... | pp22 = ..",
    "    | longxx+",
    "  }}",
    "  | longer = value | q  = {{embedded x",
    "    | pp1 = ... | pp2 = ..",
    "    | longxx+",
    "  }}",
    "}}",
].join("\n");

test("matrix alignment is independent for each nested template call", () => {
    const options = {
        characterWidthRatio: "5:3" as const,
        firstParameterLayout: "align-values" as const,
        formatFirstParameter: true,
        formatSubsequentParameters: true,
        indentBlockTemplates: true,
        subsequentParameterLayout: "align-names-and-values" as const,
    };
    assert.equal(
        formatWikitext(nestedMatrixSource, options).text,
        nestedMatrixExpected,
    );
    assert.deepEqual(formatWikitext(nestedMatrixExpected, options), {
        changed: false,
        text: nestedMatrixExpected,
    });
});

test("parameter-column modes have distinct alignment", () => {
    const source = [
        "{{matrix",
        "| a=one | bb=two | positional",
        "| longer=three | cccc=four | last=five",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            firstParameterLayout: "compact",
            formatFirstParameter: true,
            formatSubsequentParameters: true,
            indentBlockTemplates: true,
            subsequentParameterLayout: "align-names",
        }).text,
        [
            "{{matrix",
            "  | a = one        | bb = two    | positional",
            "  | longer = three | cccc = four | last = five",
            "}}",
        ].join("\n"),
    );
    assert.equal(
        formatWikitext(source, {
            firstParameterLayout: "compact",
            formatFirstParameter: true,
            formatSubsequentParameters: true,
            indentBlockTemplates: true,
            subsequentParameterLayout: "align-names-and-values",
        }).text,
        [
            "{{matrix",
            "  | a = one        | bb   = two  | positional",
            "  | longer = three | cccc = four | last = five",
            "}}",
        ].join("\n"),
    );
});

test("compact later parameters remove review-table matrix padding", () => {
    const source = [
        "{{VG Reviews",
        "| na = true | X360       = yes        | PS3 = yes",
        "| rev1 = Example | rev1_X360  = 29/30",
        "| rev10 = Example | rev10_X360 = B",
        "}}",
    ].join("\n");
    const options = {
        firstParameterLayout: "align-values" as const,
        formatFirstParameter: true,
        formatSubsequentParameters: true,
        indentBlockTemplates: true,
        subsequentParameterLayout: "compact" as const,
    };
    const expected = [
        "{{VG Reviews",
        "  | na    = true | X360 = yes | PS3 = yes",
        "  | rev1  = Example | rev1_X360 = 29/30",
        "  | rev10 = Example | rev10_X360 = B",
        "}}",
    ].join("\n");

    assert.equal(formatWikitext(source, options).text, expected);
    assert.deepEqual(formatWikitext(expected, options), {
        changed: false,
        text: expected,
    });
});

test("preserved layouts keep entered spacing while indenting", () => {
    const source = [
        "{{matrix",
        "     |   first=one     | second   =two",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            formatFirstParameter: false,
            formatSubsequentParameters: false,
            indentBlockTemplates: true,
        }).text,
        ["{{matrix", "  |   first=one     | second   =two", "}}"].join("\n"),
    );
});

test("first-parameter alignment preserves later parameters", () => {
    const source = [
        "{{matrix",
        "| short=a | second=entered",
        "| much_longer = value | very_long_second=unchanged",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            firstParameterLayout: "align-values",
            formatFirstParameter: true,
            formatSubsequentParameters: false,
            indentBlockTemplates: true,
        }).text,
        [
            "{{matrix",
            "  | short       = a | second=entered",
            "  | much_longer = value | very_long_second=unchanged",
            "}}",
        ].join("\n"),
    );
});

test("matrix alignment keeps positional cells free of equals signs", () => {
    const source = [
        "{{matrix",
        "| a=x | second=y",
        "| positional | longer_second=z",
        "}}",
    ].join("\n");

    assert.equal(
        formatWikitext(source, {
            firstParameterLayout: "align-values",
            formatFirstParameter: true,
            formatSubsequentParameters: true,
            indentBlockTemplates: true,
            subsequentParameterLayout: "align-names-and-values",
        }).text,
        [
            "{{matrix",
            "  | a = x      | second        = y",
            "  | positional | longer_second = z",
            "}}",
        ].join("\n"),
    );
});

test("matrix alignment ignores separators in nested wikitext", () => {
    const source = [
        "{{matrix",
        "| a = [[A|label]] | b = {{inner|x=y}}",
        "| longer = {{{value|x=y}}} | c = <nowiki>a|b=c</nowiki>",
        "}}",
    ].join("\n");
    const result = formatWikitext(source, {
        firstParameterLayout: "align-values",
        formatFirstParameter: true,
        formatSubsequentParameters: true,
        indentBlockTemplates: true,
        subsequentParameterLayout: "align-names-and-values",
    }).text;

    assert.match(result, /\[\[A\|label\]\]/u);
    assert.match(result, /\{\{inner\|x=y\}\}/u);
    assert.match(result, /\{\{\{value\|x=y\}\}\}/u);
    assert.match(result, /<nowiki>a\|b=c<\/nowiki>/u);
    assert.deepEqual(
        formatWikitext(result, {
            firstParameterLayout: "align-values",
            formatFirstParameter: true,
            formatSubsequentParameters: true,
            indentBlockTemplates: true,
            subsequentParameterLayout: "align-names-and-values",
        }),
        { changed: false, text: result },
    );
});
