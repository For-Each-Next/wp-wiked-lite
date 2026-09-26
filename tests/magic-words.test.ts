import assert from "node:assert/strict";
import test from "node:test";
import {
    classifyTemplateHead,
    type MagicWordAliases,
    type TemplateMagicWordCatalog,
} from "../src/domain/magic-words.ts";

function aliases(
    insensitive: string[] = [],
    sensitive: string[] = [],
): MagicWordAliases {
    return {
        caseInsensitive: new Set(
            insensitive.map((value) => value.toLowerCase()),
        ),
        caseSensitive: new Set(sensitive),
    };
}

const SITE_MAGIC_WORDS: TemplateMagicWordCatalog = {
    functions: aliases(["FORMATNUM", "if", "LOCAL："]),
    invoke: aliases(["invoke", "调用"]),
    modifiers: {
        message: aliases(["MSG:"]),
        raw: aliases(["RAW:"]),
        substitution: aliases(["SUBST:", "ERSETZEN："]),
    },
    variables: aliases([], ["CURRENTYEAR"]),
};

function classify(name: string, catalog = SITE_MAGIC_WORDS) {
    return classifyTemplateHead(name, false, catalog);
}

test("siteinfo variable and function aliases determine syntax", () => {
    assert.equal(classify("CURRENTYEAR").kind, "magic-word");
    assert.equal(classify("currentyear").kind, "template");
    assert.equal(classify("FORMATNUM:42").kind, "magic-word");
    assert.equal(classify("FORMATNUM：42").kind, "template");
    assert.equal(classify("#IF:1").kind, "magic-word");
    assert.equal(classify("#IF：1").kind, "template");
    assert.equal(classify("LOCAL：value").kind, "magic-word");
    assert.equal(classify("LOCAL:value").kind, "template");
});

test("localized invoke aliases map to module syntax", () => {
    const english = classify("#invoke:Example");
    const localized = classify("#调用:示例");
    assert.equal(english.kind, "magic-word");
    assert.equal(localized.kind, "magic-word");
    if (english.kind === "magic-word" && localized.kind === "magic-word") {
        assert.equal(english.invoke, true);
        assert.equal(localized.invoke, true);
    }
    assert.equal(classify("#调用：示例").kind, "template");
});

test("modifier matching preserves each alias separator", () => {
    assert.equal(classify("SUBST:Template:Example").modifiers.length, 1);
    assert.equal(classify("SUBST：Template:Example").modifiers.length, 0);
    assert.equal(classify("ERSETZEN：Template:Example").modifiers.length, 1);
    assert.equal(classify("ERSETZEN:Template:Example").modifiers.length, 0);
});

test("without siteinfo only leading-hash function grammar is recognized", () => {
    assert.equal(
        classifyTemplateHead("#custom:arg", false, null).kind,
        "magic-word",
    );
    assert.equal(
        classifyTemplateHead("CURRENTYEAR", false, null).kind,
        "template",
    );
    assert.equal(
        classifyTemplateHead("SUBST:Template:Example", false, null).modifiers
            .length,
        0,
    );
});
