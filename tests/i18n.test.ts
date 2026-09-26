import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createI18n } from "../src/shared/i18n.ts";

test("translations resolve MediaWiki variants and retain plain-text interpolation", () => {
    const english = { greeting: "Hello {name}", fallback: "{count} items" };
    const translations = {
        "zh-Hans": { greeting: "你好 {name}", fallback: "" },
        "zh-Hant": { greeting: "您好 {name}", fallback: "" },
    };
    for (const locale of ["zh", "zh_CN", "zh-sg", "zh-Hans"]) {
        assert.equal(
            createI18n(english, translations, locale).interfaceLocale,
            "zh-Hans",
        );
    }
    for (const locale of ["zh-tw", "zh_HK", "zh-Hant"]) {
        assert.equal(
            createI18n(english, translations, locale).interfaceLocale,
            "zh-Hant",
        );
    }
    const translate = createI18n(english, translations, "zh-hant");
    assert.equal(
        translate.msg("greeting", { name: "<script>{count}</script>" }),
        "您好 <script>{count}</script>",
    );
    assert.equal(translate.msg("fallback", { count: 0 }), "0 items");
    assert.equal(translate.msg("fallback"), "{count} items");
    assert.equal(
        createI18n(english, translations, "fr").msg("greeting"),
        "Hello {name}",
    );
});

test("every locale contains the same messages and interpolation placeholders", async () => {
    const catalogs = await Promise.all(
        ["en", "zh-Hans", "zh-Hant"].map(
            async (locale) =>
                JSON.parse(
                    await readFile(
                        new URL(`../src/i18n/${locale}.json`, import.meta.url),
                        "utf8",
                    ),
                ) as Record<string, string>,
        ),
    );
    const english = catalogs[0];
    for (const translated of catalogs.slice(1)) {
        assert.deepEqual(
            Object.keys(translated).sort(),
            Object.keys(english).sort(),
        );
        for (const key of Object.keys(english)) {
            assert.ok(translated[key].trim(), `${key} must have a translation`);
            const placeholders = (value: string) =>
                [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)]
                    .map((match) => match[1])
                    .sort();
            assert.deepEqual(
                placeholders(translated[key]),
                placeholders(english[key]),
                key,
            );
        }
    }
});
