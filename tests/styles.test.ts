import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
    new URL("../src/features/editor/styles.css", import.meta.url),
    "utf8",
);
test("highlight colors use the wikEd Lite palette", () => {
    assert.match(
        styles,
        /\.wiked-lite-token--html-tag\s*\{[^}]*rgb\(232, 232, 232\)/su,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--reference\s*\{[^}]*rgb\(243, 225, 247\)/su,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--footnote\s*\{[^}]*rgb\(230, 242, 255\)/su,
    );
    const nestedReferencePattern = new RegExp(
        String.raw`\.wiked-lite-token--footnote` +
            String.raw`\.wiked-lite-token--reference\s*\{` +
            String.raw`[^}]*rgb\(243, 225, 247\)`,
        "su",
    );
    assert.match(styles, nestedReferencePattern);
    assert.match(
        styles,
        /\.wiked-lite-token--math\s*\{[^}]*rgb\(232, 240, 255\)/su,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--nowiki\s*\{[^}]*rgb\(248, 232, 232\)/su,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--file[^}]*rgba\(199, 255, 149, 0\.75\)/su,
    );
});

test("reference text is small only in its editor state", () => {
    const rule = getStyleRule(
        ".wiked-lite-editor--small-reference-text " +
            ".wiked-lite-token--reference,\n" +
            ".wiked-lite-editor--small-reference-text " +
            ".wiked-lite-token--footnote,\n" +
            ".wiked-lite-editor--small-reference-text " +
            ".wiked-lite-token--small-reference-comment",
        true,
    );

    assert.match(rule, /font-size:\s*0\.86em/u);
    assert.doesNotMatch(
        styles,

        /(?:^|\n)\.wiked-lite-token--reference,\n\.wiked-lite-token--footnote\s*\{/u,
    );
    assert.doesNotMatch(styles, /--reference\s+\.wiked-lite-token--footnote/u);
    assert.doesNotMatch(styles, /--footnote\s+\.wiked-lite-token--reference/u);
});

test("large-font state scales the copied native editor size", () => {
    const baseRule = getStyleRule(".wiked-lite-editor", true);

    assert.match(baseRule, /font-size:\s*0\.875rem/u);
    assert.doesNotMatch(styles, /--wiked-lite-native-font-size/u);
});

test("unchecked links use the copied editor foreground color", () => {
    const rule = getStyleRule(".wiked-lite-token--unchecked");

    assert.match(rule, /color:\s*var\(--wiked-lite-foreground/u);
    assert.match(rule, /!important/u);
});

test("magic words and module names retain wikEd colors", () => {
    assert.match(
        styles,
        /\.wiked-lite-token--parser-function\s*\{[^}]*rgb\(255, 0, 0\)/su,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--module-name,[^}]*rgb\(85, 0, 153\)/su,
    );
});

test("list markers use magic-word red on the first depth grey", () => {
    const rule = getStyleRule(".wiked-lite-token--list");

    assert.match(rule, /color:\s*rgb\(255, 0, 0\)/u);
    assert.match(rule, /background:\s*rgb\(246, 246, 246\)/u);
});

test("HTML content backgrounds darken with nesting depth", () => {
    const depthColors = [
        [246, "96"],
        [228, "88"],
        [218, "83.5"],
    ] as const;
    for (const [depth, [color, backgroundWeight]] of depthColors.entries()) {
        const rule = getStyleRule(`.wiked-lite-token--html-content-${depth}`);
        assert.match(
            rule,
            new RegExp(
                `background:\\s*rgb\\(${color}, ${color}, ${color}\\)`,
                "u",
            ),
        );
        assert.ok(
            rule.includes(`var(--wiked-lite-background) ${backgroundWeight}%`),
        );
        assert.match(rule, /var\(--wiked-lite-foreground\)/u);
    }
    const cappedRule = getStyleRule(
        ".wiked-lite-token--html-content-3,\n" +
            ".wiked-lite-token--html-content-4",
        true,
    );
    assert.match(cappedRule, /rgb\(208, 208, 208\)/u);
    assert.ok(cappedRule.includes("var(--wiked-lite-background) 79%"));
    assert.match(cappedRule, /var\(--wiked-lite-foreground\)/u);
    assert.ok(
        styles.lastIndexOf(".wiked-lite-token--html-content-4") <
            styles.indexOf(".wiked-lite-token--html-tag"),
    );
});

test("heading underlines and language variants retain text styling", () => {
    const headingRules = [
        [
            ".wiked-lite-token--heading-2.wiked-lite-token--heading-text",
            "double",
        ],
        [
            ".wiked-lite-token--heading-3.wiked-lite-token--heading-text",
            "solid",
        ],
    ] as const;

    for (const [selector, decorationStyle] of headingRules) {
        const rule = getStyleRule(selector);

        assert.match(rule, /text-decoration-line:\s*underline/u);
        assert.match(
            rule,
            new RegExp(`text-decoration-style:\\s*${decorationStyle}`, "u"),
        );
        assert.match(rule, /text-underline-offset:\s*0\.2em/u);
    }
    assert.match(
        getStyleRule(".wiked-lite-token--language-variant"),
        /font-style:\s*italic/u,
    );
});

test("iframe styles include emphasis and reference popovers", () => {
    assert.match(styles, /\.wiked-lite-frame\s*\{/u);
    assert.match(
        styles,
        /\.wiked-lite-frame:not\(\[data-wiked-ready="true"\]\)/u,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--bold\s*\{[^}]*font-weight:\s*bold/su,
    );
    assert.match(
        styles,
        /\.wiked-lite-token--italic\s*\{[^}]*font-style:\s*italic/su,
    );
    assert.match(styles, /\.wiked-lite-tooltip__tail\s*\{/u);
    assert.match(
        styles,
        /\.wiked-lite-tooltip__surface\s*\{[^}]*max-height:\s*44vh/su,
    );
    assert.match(styles, /\.wiked-lite-tooltip__note\s*\{/u);
});

test("special-character tips do not paint extra glyphs or guides", () => {
    assert.doesNotMatch(styles, /data:image\/svg\+xml/u);
    for (const name of [
        "tab",
        "en-space",
        "em-space",
        "thin-space",
        "ideographic-space",
        "soft-hyphen",
        "figure-dash",
        "en-dash",
        "em-dash",
        "horizontal-bar",
        "minus-sign",
    ]) {
        assert.doesNotMatch(
            styles,
            new RegExp(
                String.raw`\.wiked-lite-token--${name}::(?:before|after)`,
                "u",
            ),
        );
    }
});

test("reference popovers bridge the anchor gap while visuals animate", () => {
    const bridge = getStyleRule(".wiked-lite-tooltip::before");
    const aboveBridge = getStyleRule(".wiked-lite-tooltip--above::before");
    const belowBridge = getStyleRule(".wiked-lite-tooltip--below::before");
    const aboveVisual = getStyleRule(
        ".wiked-lite-tooltip--above .wiked-lite-tooltip__visual",
    );
    const belowVisual = getStyleRule(
        ".wiked-lite-tooltip--below .wiked-lite-tooltip__visual",
    );

    assert.match(bridge, /height:\s*10px/u);
    assert.match(bridge, /pointer-events:\s*auto/u);
    assert.match(aboveBridge, /top:\s*100%/u);
    assert.match(belowBridge, /bottom:\s*100%/u);
    assert.match(aboveVisual, /animation:\s*wiked-lite-tooltip-in-down/u);
    assert.match(belowVisual, /animation:\s*wiked-lite-tooltip-in-up/u);
});

function getStyleRule(selector: string, last = false): string {
    const normalizedStyles = styles.replace(/\s+/gu, " ");
    const opening = `${selector.replace(/\s+/gu, " ")} {`;
    const start = last
        ? normalizedStyles.lastIndexOf(opening)
        : normalizedStyles.indexOf(opening);
    const end = normalizedStyles.indexOf("}", start + opening.length);

    assert.notEqual(start, -1, `Missing stylesheet rule ${selector}`);
    assert.notEqual(end, -1, `Unclosed stylesheet rule ${selector}`);
    return normalizedStyles.slice(start + opening.length, end);
}
