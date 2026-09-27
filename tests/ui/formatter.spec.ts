import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { build } from "esbuild";

import { FORMATTER_SETTINGS_STORAGE_KEY } from "../../src/platform/browser/formatter-settings.ts";
import {
    createDefaultFormatterSettings,
    type FormatterSettings,
} from "../../src/domain/formatter-settings.ts";
import type { MediaWikiNotificationOptions } from "../../src/platform/mediawiki/notifications.ts";

interface NativeNotification {
    message: string;
    options: MediaWikiNotificationOptions;
}

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const initialSource = "==Heading==\nText   ";
let runtime: string;

test.beforeAll(async () => {
    const result = await build({
        absWorkingDir: projectRoot,
        stdin: {
            contents:
                'import * as Vue from "vue/dist/vue.esm-bundler.js"; import * as Codex from "@wikimedia/codex"; export const vue = {...Vue, createMwApp: Vue.createApp}; export const codex = Codex;',
            resolveDir: projectRoot,
        },
        bundle: true,
        format: "iife",
        globalName: "WikEdTestUI",
        define: {
            "process.env.NODE_ENV": '"production"',
            __VUE_OPTIONS_API__: "true",
            __VUE_PROD_DEVTOOLS__: "false",
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
        },
        write: false,
    });
    runtime = result.outputFiles[0].text;
});

test("Codex tabs expose relevant controls and a live template example", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mountFormatter(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("wikEd Lite panel");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(
        page.getByRole("tab", { name: "Formatting", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
        page.getByRole("button", { name: "Format page", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("checkbox", {
            name: "Fix template aliases",
            exact: true,
        }),
    ).toBeHidden();
    await capture(page, "formatting-en");
    await page
        .getByRole("checkbox", {
            name: "Replace redirects with target page titles",
            exact: true,
        })
        .check();
    await expect(
        page.getByRole("checkbox", {
            name: "Fix template aliases",
            exact: true,
        }),
    ).toBeVisible();

    const formattingTab = page.getByRole("tab", {
        name: "Formatting",
        exact: true,
    });
    await formattingTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
        page.getByRole("tab", { name: "Highlighting settings", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(formattingTab).toHaveAttribute("aria-selected", "true");
    const example = dialog.locator("pre");
    const original = await example.innerText();
    await page
        .getByRole("radio", { name: "Align values", exact: true })
        .check();
    await page.getByRole("radio", { name: "Align names", exact: true }).check();
    await expect.poll(() => example.innerText()).not.toBe(original);
    await expect(
        page.getByRole("group", { name: /^Character width for alignment/ }),
    ).toBeVisible();
    const threeToFive = await example.innerText();
    await page.getByRole("radio", { name: "1:2", exact: true }).check();
    await expect.poll(() => example.innerText()).not.toBe(threeToFive);
    const tracks = (await example.innerText()).split("\n");
    expect(tracks).toHaveLength(12);
    expect(tracks[0]).toBe("{{Tracklists");
    expect(tracks[3]).toMatch(/title1.*春日来信.*note1.*length1/u);
    expect(tracks[8]).toMatch(/title1.*漫长的旅途.*note1.*length1/u);
    const indentation = page.getByRole("checkbox", {
        name: "Indent nested templates",
        exact: true,
    });
    const indentSpaces = page.getByRole("spinbutton", {
        name: "Spaces per indentation level",
        exact: true,
    });
    const skipFirstLevel = page.getByRole("checkbox", {
        name: "Leave the first nesting level unindented",
        exact: true,
    });
    await expect(indentation).not.toBeChecked();
    await expect(indentSpaces).toHaveValue("2");
    await expect(indentSpaces).toHaveAttribute("min", "0");
    await expect(indentSpaces).toBeDisabled();
    await expect(skipFirstLevel).toBeDisabled();
    await indentation.check();
    await indentSpaces.fill("12");
    expect(await example.innerText()).toMatch(
        /^ {24}\| heading\s*= Side A.*\| comment\s*= \.\.\.$/mu,
    );
    await skipFirstLevel.check();
    expect(await example.innerText()).toMatch(
        /^ {12}\| heading\s*= Side A.*\| comment\s*= \.\.\.$/mu,
    );
    await indentation.uncheck();
    await indentation.check();
    await expect(indentSpaces).toHaveValue("12");
    await expect(skipFirstLevel).toBeChecked();
    await indentSpaces.fill("0");
    await expect(skipFirstLevel).toBeEnabled();
    expect(await example.innerText()).toMatch(
        /^\| heading\s*= Side A.*\| comment\s*= \.\.\.$/mu,
    );
    await indentSpaces.fill("-1");
    await indentSpaces.blur();
    await expect(indentSpaces).toHaveValue("0");
    await indentSpaces.fill("");
    await indentSpaces.blur();
    await expect(indentSpaces).toHaveValue("2");
    await indentSpaces.fill("9007199254740991");
    await expect(example).toContainText("{{Tracklists");
    await indentSpaces.fill("2");
    const ids = await dialog
        .locator("[id]")
        .evaluateAll((elements) => elements.map((element) => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    await example.scrollIntoViewIfNeeded();
    await capture(page, "templates-en");

    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(
        page.getByText(
            "Change how the editor looks and shows previews. These options do not change the wikitext.",
            { exact: true },
        ),
    ).toBeInViewport();
    await expect(
        page.getByRole("button", { name: "Apply settings", exact: true }),
    ).toBeVisible();
    const groups = page
        .getByRole("tabpanel", {
            name: "Highlighting settings",
            exact: true,
        })
        .getByRole("group");
    const expectedGroups = [
        {
            name: "Syntax highlighting",
            controls: [
                "Use wikEd Lite to highlight wikitext pages",
                "Use CodeMirror for other content models",
            ],
        },
        {
            name: "Text and colors",
            controls: [
                "Use larger text",
                "Use smaller text for references and notes",
                "Alternate pink and blue for consecutive references",
            ],
        },
        {
            name: "Links",
            controls: [
                /^Hold (?:Ctrl|Command) and click link source to open a new tab$/u,
                "Show page previews on hover",
                "Automatically mark missing page titles in red",
            ],
        },
        {
            name: "Reference popups",
            controls: [
                "Reference tag inspection",
                "Read the full page source when editing a section",
                "Enable editing while inspecting references",
                "Use lightweight reference editing",
            ],
        },
    ];
    await expect(groups).toHaveCount(expectedGroups.length);
    for (const [index, expected] of expectedGroups.entries()) {
        const group = groups.nth(index);
        await expect(group).toHaveAccessibleName(expected.name);
        const controls = group.getByRole("checkbox");
        await expect(controls).toHaveCount(expected.controls.length);
        for (const [controlIndex, name] of expected.controls.entries()) {
            await expect(controls.nth(controlIndex)).toHaveAccessibleName(name);
        }
    }
    await capture(page, "editor-en");
    await page
        .getByRole("checkbox", {
            name: "Reference tag inspection",
            exact: true,
        })
        .uncheck();
    await expect(
        page.getByRole("checkbox", {
            name: "Read the full page source when editing a section",
            exact: true,
        }),
    ).toBeDisabled();
    await page
        .getByRole("button", { name: "More options", exact: true })
        .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await capture(page, "menu-en");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expectSuccessNotification(
        page,
        "cache-cleared",
        "Cache cleared. Data will reload as needed.",
    );
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue(initialSource);
    expect(errors).toEqual([]);
});

test("cancel and Escape discard display changes and restore keyboard focus", async ({
    page,
}) => {
    await mountFormatter(page);
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const before = await editor.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await page
        .getByRole("checkbox", { name: "Use larger text", exact: true })
        .check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
        await editor.evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe(before);
    await expect(page.locator("#wiked-lite-format")).toBeFocused();
    await page.locator("#wiked-lite-format").click();
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(
        page.getByRole("checkbox", { name: "Use larger text", exact: true }),
    ).not.toBeChecked();
});

test("overlapping formatter loads create one dialog and one cleanup owner", async ({
    page,
}) => {
    await mountFormatter(page, { open: false });
    await page.evaluate(() => {
        const original = mw.loader.using;
        const pending: Array<() => void> = [];
        (globalThis as any).__completeDialogLoads = () =>
            pending.splice(0).forEach((resolve) => resolve());
        mw.loader.using = ((modules: string[]) =>
            new Promise((resolve) => {
                pending.push(() => resolve(original(modules)));
            })) as unknown as typeof mw.loader.using;
    });
    await page.locator("#wiked-lite-format").click();
    await page.locator("#wiked-lite-format").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => (globalThis as any).__completeDialogLoads());
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator("#wiked-lite-dialog-host")).toHaveCount(1);

    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#wiked-lite-dialog-host")).toHaveCount(0);
});

test("editor settings apply without formatting and persist only when requested", async ({
    page,
}) => {
    await mountFormatter(page);
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    const codeMirror = page.getByRole("checkbox", {
        name: "Use CodeMirror for other content models",
        exact: true,
    });
    await expect(codeMirror).not.toBeChecked();
    await expect(
        page.getByRole("link", { name: "CodeMirror" }),
    ).toHaveAttribute(
        "href",
        "https://www.mediawiki.org/wiki/Extension:CodeMirror",
    );
    await codeMirror.check();
    await page
        .getByRole("checkbox", { name: "Use larger text", exact: true })
        .check();
    await page
        .getByRole("button", { name: "Apply settings", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue(initialSource);
    expect(await storedSettings(page)).toBeNull();
    await page.locator("#wiked-lite-format").click();
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(
        page.getByRole("checkbox", { name: "Use larger text", exact: true }),
    ).toBeChecked();
    await expect(codeMirror).toBeChecked();
    await codeMirror.uncheck();
    await page
        .getByRole("checkbox", { name: "Use larger text", exact: true })
        .uncheck();
    await chooseMore(page, "Save settings");
    await expectSuccessNotification(
        page,
        "settings-saved",
        "Settings saved in this browser.",
    );
    expect((await storedSettings(page))?.largeFont).toBe(false);
    expect((await storedSettings(page))?.useCodeMirrorForOtherModels).toBe(
        false,
    );
    // Choosing the same menu action again must work, too.
    await page
        .getByRole("checkbox", { name: "Use larger text", exact: true })
        .check();
    await codeMirror.check();
    await chooseMore(page, "Save settings");
    await expectSuccessNotification(
        page,
        "settings-saved",
        "Settings saved in this browser.",
        2,
    );
    expect((await storedSettings(page))?.largeFont).toBe(true);
    expect((await storedSettings(page))?.useCodeMirrorForOtherModels).toBe(
        true,
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(initialSource);
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    expect((await storedSettings(page))?.largeFont).toBe(true);
});

test("Ctrl/Cmd-click navigation can be disabled, saved, and re-enabled", async ({
    page,
}) => {
    const source = "A [[Example navigation target]] B";
    const setting = page.getByRole("checkbox", {
        name: /^Hold (?:Ctrl|Command) and click link source to open a new tab$/u,
        exact: true,
    });
    const openHighlighting = async () => {
        await page
            .getByRole("tab", { name: "Highlighting settings", exact: true })
            .click();
    };
    const apply = page.getByRole("button", {
        name: "Apply settings",
        exact: true,
    });
    const recordOpens = () =>
        page.evaluate(() => {
            const opened: string[] = [];
            (globalThis as any).__openedLinks = opened;
            window.open = (url) => {
                opened.push(String(url));
                return null;
            };
        });
    const clickLink = async () => {
        const link = page
            .frameLocator(".wiked-lite-frame")
            .locator(
                '.wiked-lite-editor [data-href="/wiki/Example_navigation_target"]',
            )
            .filter({ hasText: "Example navigation target" });
        await link.evaluate((element) =>
            element.ownerDocument.getSelection()?.removeAllRanges(),
        );
        await link.click({
            modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
        });
    };
    const openedLinks = () =>
        page.evaluate(() => (globalThis as any).__openedLinks);

    await mountFormatter(page, { source });
    await recordOpens();
    await openHighlighting();
    await expect(setting).toBeChecked();
    await setting.uncheck();
    await apply.click();
    await clickLink();
    expect(await openedLinks()).toEqual([]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);

    await page.locator("#wiked-lite-format").click();
    await openHighlighting();
    await expect(setting).not.toBeChecked();
    await chooseMore(page, "Save settings");
    expect((await storedSettings(page))?.ctrlClickLinks).toBe(false);

    await mountFormatter(page, { source });
    await recordOpens();
    await openHighlighting();
    await expect(setting).not.toBeChecked();
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await clickLink();
    expect(await openedLinks()).toEqual([]);

    await page.locator("#wiked-lite-format").click();
    await openHighlighting();
    await setting.check();
    const highlighting = page.getByRole("checkbox", {
        name: "Use wikEd Lite to highlight wikitext pages",
        exact: true,
    });
    await highlighting.uncheck();
    await expect(setting).toBeDisabled();
    await highlighting.check();
    await expect(setting).toBeChecked();
    await apply.click();
    await clickLink();
    expect(await openedLinks()).toEqual(["/wiki/Example_navigation_target"]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

for (const [platform, modifier] of [
    ["MacIntel", "Command"],
    ["Win32", "Ctrl"],
] as const) {
    test(`link navigation names ${modifier} on ${platform} and limits its description to Chinese Wikipedia`, async ({
        page,
    }) => {
        for (const wikiId of ["zhwiki", "examplewiki"]) {
            await mountFormatter(page, { locale: "en", platform, wikiId });
            await page
                .getByRole("tab", {
                    name: "Highlighting settings",
                    exact: true,
                })
                .click();
            await expect(
                page.getByRole("checkbox", {
                    name: `Hold ${modifier} and click link source to open a new tab`,
                    exact: true,
                }),
            ).toBeVisible();
            const description = page.getByText(
                "Also supports the foreign page title in interlanguage link templates.",
                { exact: true },
            );
            if (wikiId === "zhwiki") {
                await expect(description).toBeVisible();
            } else {
                await expect(description).toHaveCount(0);
            }
            const documentation = page.getByRole("link", {
                name: "interlanguage link templates",
                exact: true,
            });
            await expect(documentation).toHaveCount(
                wikiId === "zhwiki" ? 3 : 1,
            );
            for (const link of await documentation.all()) {
                await expect(link).toHaveAttribute(
                    "href",
                    wikiId === "zhwiki"
                        ? "/wiki/Category:内部链接助手模板"
                        : "https://zh.wikipedia.org/wiki/Category:%E5%86%85%E9%83%A8%E9%93%BE%E6%8E%A5%E5%8A%A9%E6%89%8B%E6%A8%A1%E6%9D%BF",
                );
                await expect(link).toHaveAttribute("target", "_blank");
                await expect(link).toHaveAttribute(
                    "rel",
                    "noopener noreferrer",
                );
            }
            await expect(page.getByRole("dialog")).not.toContainText(
                "{{link-en}}",
            );
            await expect(page.getByRole("dialog")).not.toContainText("{{tsl}}");
        }
    });
}

test("alternating reference backgrounds follow applied settings and survive saving", async ({
    page,
}) => {
    const source =
        '<ref>First</ref><ref name="second" />{{sfn|a}}<ref name="third">Third</ref>' +
        " prose {{efn|Note one}}{{efn|Note two}}" +
        " prose <ref>Mixed ref</ref>{{efn|Mixed note}}" +
        " prose {{efn|Outer note <ref>Nested ref</ref>}}{{efn|Next note}}";
    await mountFormatter(page, { source });
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const setting = page.getByRole("checkbox", {
        name: "Alternate pink and blue for consecutive references",
        exact: true,
    });
    const apply = page.getByRole("button", {
        name: "Apply settings",
        exact: true,
    });
    const openHighlighting = async () => {
        await page
            .getByRole("tab", { name: "Highlighting settings", exact: true })
            .click();
    };
    const styleAt = (text: string) =>
        editor.evaluate((element, offset) => {
            let remaining = offset;
            for (const node of element.childNodes) {
                const length = node.textContent?.length ?? 0;
                if (remaining < length) {
                    const style = getComputedStyle(
                        node instanceof Element ? node : element,
                    );
                    return {
                        background: style.backgroundColor,
                        color: style.color,
                    };
                }
                remaining -= length;
            }
            throw new Error("Reference text was not rendered");
        }, source.indexOf(text));

    await openHighlighting();
    await expect(setting).not.toBeChecked();
    const normal = await styleAt("First");
    const second = await styleAt("second");
    expect(normal.background).toBe("rgb(243, 225, 247)");
    expect(second.background).toBe(normal.background);
    const templateBackground = "rgb(246, 246, 246)";
    expect((await styleAt("Note one")).background).toBe(templateBackground);
    expect((await styleAt("Note two")).background).toBe(templateBackground);
    expect((await styleAt("Nested ref")).background).toBe(normal.background);
    await setting.check();
    await chooseMore(page, "Save settings");
    expect((await storedSettings(page))?.alternateReferenceColors).toBe(true);
    expect(await styleAt("second")).toEqual(second);
    await apply.click();
    await expect
        .poll(async () => (await styleAt("second")).background)
        .not.toBe(normal.background);
    const alternate = await styleAt("second");
    expect(alternate.background).toBe("rgb(230, 242, 255)");
    expect(alternate.color).toBe(second.color);
    expect((await styleAt("Note one")).background).toBe(templateBackground);
    expect((await styleAt("Note two")).background).toBe(templateBackground);
    expect((await styleAt("Mixed ref")).background).toBe(normal.background);
    expect((await styleAt("Mixed note")).background).toBe(templateBackground);
    expect((await styleAt("Outer note")).background).toBe(templateBackground);
    expect((await styleAt("Nested ref")).background).toBe(normal.background);
    expect((await styleAt("Next note")).background).toBe(templateBackground);
    expect((await styleAt("sfn")).background).toBe(alternate.background);
    expect((await styleAt("Third")).background).toBe(normal.background);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);

    await mountFormatter(page, { source });
    await openHighlighting();
    await expect(setting).toBeChecked();
    expect((await styleAt("second")).background).toBe(alternate.background);
    const highlighting = page.getByRole("checkbox", {
        name: "Use wikEd Lite to highlight wikitext pages",
        exact: true,
    });
    await highlighting.uncheck();
    await expect(setting).toBeDisabled();
    await apply.click();
    await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toBeVisible();
    await page.locator("#wiked-lite-format").click();
    await openHighlighting();
    await highlighting.check();
    await expect(setting).toBeChecked();
    await apply.click();
    await expect
        .poll(async () => (await styleAt("second")).background)
        .toBe(alternate.background);

    await page.locator("#wiked-lite-format").click();
    await openHighlighting();
    await setting.uncheck();
    await apply.click();
    await expect
        .poll(async () => (await styleAt("second")).background)
        .toBe(normal.background);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("Efn retains small template text while its embedded references alternate colors", async ({
    page,
}) => {
    const source =
        '游戏中的角色向玩家道别<ref name=":4" /><ref name="DREAM" ' +
        'details="{{URL|https://example.test/interview|55億年後になくなる地球}}. 完結編 :2" />' +
        "{{Efn|部分游戏内容译名综合参考自以下来源：" +
        "<ref>{{Cite web |title=MOTHER系列参战斗士 琉加 #37 {{!}} 任天堂明星大乱斗 特别版 " +
        "|url=https://example.test/fighter |language=zh-Hans}}</ref>" +
        '<ref name=":2" details="{{URL|https://example.test/guide|地球冒险3}}. 攻略人行道 :90-93" />' +
        '<ref name="UCG" details="阿修罗. {{url|https://example.test/mother3|Mother3 攻略透解}} :58-63" />' +
        "<ref>{{Cite journal |author=张永 |title=地球冒险3 接上期 " +
        "|url=https://example.test/journal |journal=掌机迷 |page=78-83}}</ref>}}。";
    await mountFormatter(page, {
        source,
        settings: {
            ...createDefaultFormatterSettings(),
            alternateReferenceColors: true,
        },
    });
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const pink = "rgb(243, 225, 247)";
    const blue = "rgb(230, 242, 255)";
    const gray = "rgb(246, 246, 246)";
    const expectedStyles = [
        [":4", pink],
        ["DREAM", blue],
        ["55億年後", blue],
        ["Efn", gray],
        ["部分游戏内容", gray],
        ["<ref>{{Cite web", pink],
        ["MOTHER系列", pink],
        ["任天堂明星", pink],
        ['<ref name=":2"', blue],
        ["攻略人行道", blue],
        ['<ref name="UCG"', pink],
        ["Mother3 攻略", pink],
        ["<ref>{{Cite journal", blue],
        ["掌机迷", blue],
        ["</ref>}}", blue],
        ["}}。", gray],
    ] as const;
    const styles = () =>
        editor.evaluate(
            (element, offsets) =>
                offsets.map((offset) => {
                    let remaining = offset;
                    for (const node of element.childNodes) {
                        const length = node.textContent?.length ?? 0;
                        if (remaining < length) {
                            const style = getComputedStyle(
                                node instanceof Element ? node : element,
                            );
                            return {
                                background: style.backgroundColor,
                                fontSize: Number.parseFloat(style.fontSize),
                            };
                        }
                        remaining -= length;
                    }
                    throw new Error("Explanatory note text was not rendered");
                }),
            expectedStyles.map(([text]) => source.indexOf(text)),
        );
    const editorFontSize = await editor.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
    );
    const smallStyles = await styles();
    for (const [index, [text, background]] of expectedStyles.entries()) {
        expect(smallStyles[index]?.background, text).toBe(background);
        expect(smallStyles[index]?.fontSize, text).toBeCloseTo(
            editorFontSize * 0.86,
            2,
        );
    }

    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await page
        .getByRole("checkbox", {
            name: "Use smaller text for references and notes",
            exact: true,
        })
        .uncheck();
    await page
        .getByRole("button", { name: "Apply settings", exact: true })
        .click();
    const fullStyles = await styles();
    for (const [index, [text, background]] of expectedStyles.entries()) {
        expect(fullStyles[index]?.background, text).toBe(background);
        expect(fullStyles[index]?.fontSize, text).toBe(editorFontSize);
    }
    await expect(editor).toHaveText(source);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("reference editing stays visible under its disabled parent and retains saved choices", async ({
    page,
}) => {
    const source = "<ref>{{cite book|title=Book}}</ref>";
    await mountFormatter(page, { source, open: false });
    const frame = page.frameLocator(".wiked-lite-frame");
    const editor = frame.locator(".wiked-lite-editor");
    const reference = editor.locator("[data-reference]").first();
    const tooltip = frame.locator(".wiked-lite-tooltip");
    const setting = page.getByRole("checkbox", {
        name: "Enable editing while inspecting references",
        exact: true,
    });
    const previews = page.getByRole("checkbox", {
        name: "Reference tag inspection",
        exact: true,
    });
    const highlighting = page.getByRole("checkbox", {
        name: "Use wikEd Lite to highlight wikitext pages",
        exact: true,
    });
    const lightweight = page.getByRole("checkbox", {
        name: "Use lightweight reference editing",
        exact: true,
    });
    const fullPage = page.getByRole("checkbox", {
        name: "Read the full page source when editing a section",
        exact: true,
    });
    const apply = page.getByRole("button", {
        name: "Apply settings",
        exact: true,
    });
    const openHighlighting = async () => {
        await page.locator("#wiked-lite-format").click();
        await page
            .getByRole("tab", { name: "Highlighting settings", exact: true })
            .click();
    };

    await reference.hover();
    await expect(
        tooltip.getByRole("button", {
            name: "Edit field 'title'",
            exact: true,
        }),
    ).toBeVisible();
    await editor.press("Escape");
    await openHighlighting();
    await expect(setting).toBeChecked();
    await expect(lightweight).not.toBeChecked();
    const parentBounds = await previews.boundingBox();
    const editingBounds = await setting.boundingBox();
    const fullPageBounds = await fullPage.boundingBox();
    const lightweightBounds = await lightweight.boundingBox();
    expect(parentBounds).not.toBeNull();
    expect(editingBounds).not.toBeNull();
    expect(fullPageBounds).not.toBeNull();
    expect(lightweightBounds).not.toBeNull();
    expect(editingBounds!.x).toBeCloseTo(parentBounds!.x, 0);
    expect(fullPageBounds!.x).toBeCloseTo(parentBounds!.x, 0);
    expect(lightweightBounds!.x).toBeGreaterThan(editingBounds!.x);
    await lightweight.check();
    await fullPage.check();
    await setting.uncheck();
    await expect(lightweight).toBeDisabled();
    await expect(lightweight).toBeChecked();
    await previews.uncheck();
    await expect(setting).toBeVisible();
    await expect(setting).toBeDisabled();
    await expect(fullPage).toBeVisible();
    await expect(fullPage).toBeDisabled();
    await expect(fullPage).toBeChecked();
    await expect(lightweight).toBeDisabled();
    await previews.check();
    await expect(setting).not.toBeChecked();
    await expect(fullPage).toBeEnabled();
    await expect(fullPage).toBeChecked();
    await highlighting.uncheck();
    await expect(setting).toBeDisabled();
    await highlighting.check();
    await expect(setting).toBeEnabled();
    await expect(setting).not.toBeChecked();
    await chooseMore(page, "Save settings");
    expect((await storedSettings(page))?.referenceEditing).toBe(false);
    expect((await storedSettings(page))?.referencePreviews).toBe(true);
    expect((await storedSettings(page))?.referenceLightweightEditing).toBe(
        true,
    );
    expect((await storedSettings(page))?.fullPageReferencePreviews).toBe(true);
    await apply.click();
    await reference.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Book");
    await expect(tooltip.getByRole("button")).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);

    await mountFormatter(page, { source, open: false });
    await reference.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Book");
    await expect(tooltip.getByRole("button")).toHaveCount(0);
    await editor.press("Escape");
    await openHighlighting();
    await expect(setting).not.toBeChecked();
    await chooseMore(page, "Reset settings");
    await expect(setting).toBeChecked();
    await expect(lightweight).not.toBeChecked();
    await expect(fullPage).not.toBeChecked();
    await apply.click();
    await reference.hover();
    await expect(
        tooltip.getByRole("button", {
            name: "Edit field 'title'",
            exact: true,
        }),
    ).toBeVisible();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("section sub-references combine local details with the full-page parent", async ({
    page,
}) => {
    const source = '<ref name="Parent" details="p. 48" />';
    await mountFormatter(page, {
        source,
        section: true,
        open: false,
        pageSource:
            '<ref name="Parent">{{cite book|title=Outside section}}</ref>\n' +
            source,
        settings: {
            ...createDefaultFormatterSettings(),
            fullPageReferencePreviews: true,
        },
    });
    const frame = page.frameLocator(".wiked-lite-frame");
    const reference = frame.locator("[data-reference]").first();
    const tooltip = frame.locator(".wiked-lite-tooltip");

    await reference.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Sub-reference content");
    await expect(tooltip).toContainText("p. 48");
    await expect(tooltip).toContainText("Outside section");
    await expect(tooltip.locator(".wiked-lite-tooltip__missing")).toHaveCount(
        0,
    );
    await expect(frame.locator(".wiked-lite-editor")).toHaveText(source);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("Reset settings removes saved choices and restores both tabs without applying them", async ({
    page,
}) => {
    const settings = createDefaultFormatterSettings();
    settings.largeFont = true;
    settings.linkPreviews = true;
    settings.resolveRedirects = true;
    settings.formatter.indentBlockTemplates = true;
    settings.formatter.indentSpaces = 4;
    settings.formatter.skipFirstLevelIndentation = true;
    await mountFormatter(page, { settings });
    await page.evaluate(() =>
        localStorage.setItem("another-gadget.settings", "keep this value"),
    );
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const initialFontSize = await editor.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    // Establish an applied session override before resetting its saved base.
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await page
        .getByRole("checkbox", {
            name: "Reference tag inspection",
            exact: true,
        })
        .uncheck();
    await page
        .getByRole("button", { name: "Apply settings", exact: true })
        .click();
    await page.locator("#wiked-lite-format").click();
    const indentation = page.getByRole("checkbox", {
        name: "Indent nested templates",
        exact: true,
    });
    const indentSpaces = page.getByRole("spinbutton", {
        name: "Spaces per indentation level",
        exact: true,
    });
    await indentSpaces.fill("12");
    await chooseMore(page, "Reset settings");

    await expectSuccessNotification(
        page,
        "settings-reset",
        "Settings reset. Saved settings were removed from this browser.",
    );
    expect(await storedSettings(page)).toBeNull();
    expect(
        await page.evaluate(() =>
            localStorage.getItem("another-gadget.settings"),
        ),
    ).toBe("keep this value");
    await expect(indentation).not.toBeChecked();
    await expect(indentSpaces).toHaveValue("2");
    await expect(indentSpaces).toBeDisabled();
    await expect(
        page.getByRole("checkbox", {
            name: "Leave the first nesting level unindented",
            exact: true,
        }),
    ).not.toBeChecked();
    await expect(
        page.getByRole("checkbox", {
            name: "Replace redirects with target page titles",
            exact: true,
        }),
    ).not.toBeChecked();
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(
        page.getByRole("checkbox", { name: "Use larger text", exact: true }),
    ).not.toBeChecked();
    await expect(
        page.getByRole("checkbox", {
            name: "Show page previews on hover",
            exact: true,
        }),
    ).not.toBeChecked();
    await expect(
        page.getByRole("checkbox", {
            name: "Reference tag inspection",
            exact: true,
        }),
    ).toBeChecked();
    await expect(page.locator("#wpTextbox1")).toHaveValue(initialSource);
    expect(
        await editor.evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe(initialFontSize);

    // Reopening keeps formatter defaults and reflects the unchanged editor.
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await page.locator("#wiked-lite-format").click();
    await expect(indentation).not.toBeChecked();
    await expect(indentSpaces).toHaveValue("2");
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(
        page.getByRole("checkbox", { name: "Use larger text", exact: true }),
    ).toBeChecked();
    await expect(
        page.getByRole("checkbox", {
            name: "Reference tag inspection",
            exact: true,
        }),
    ).not.toBeChecked();
    expect(await storedSettings(page)).toBeNull();
});

test("failed Reset settings preserves saved settings and the current draft", async ({
    page,
}) => {
    const settings = createDefaultFormatterSettings();
    settings.formatter.indentBlockTemplates = true;
    settings.formatter.indentSpaces = 4;
    await mountFormatter(page, { settings });
    const indentSpaces = page.getByRole("spinbutton", {
        name: "Spaces per indentation level",
        exact: true,
    });
    await indentSpaces.fill("12");
    await page.evaluate(() => {
        Storage.prototype.removeItem = () => {
            throw new Error("Fixture removal unavailable");
        };
    });
    await chooseMore(page, "Reset settings");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".cdx-message--error")).toContainText(
        "Could not reset settings. Try again.",
    );
    expect(await nativeNotifications(page)).toEqual([]);
    expect(await storedSettings(page)).toEqual(settings);
    await expect(indentSpaces).toHaveValue("12");
    await expect(indentSpaces).toBeEnabled();
    await expect(
        page.getByRole("checkbox", {
            name: "Indent nested templates",
            exact: true,
        }),
    ).toBeChecked();
    await expect(
        page.getByRole("button", { name: "Format page", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#wpTextbox1")).toHaveValue(initialSource);
});

test("format selection uses the range captured before dialog focus moves", async ({
    page,
}) => {
    const source = "[[ Selected ]]\n\n[[ Untouched ]]";
    await mountFormatter(page, { source, open: false });
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await editor.focus();
    await editor.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const walker = element.ownerDocument.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
        );
        let remaining = "[[ Selected ]]".length;
        while (walker.nextNode()) {
            const length = walker.currentNode.textContent?.length ?? 0;
            if (remaining <= length) {
                range.setEnd(walker.currentNode, remaining);
                break;
            }
            remaining -= length;
        }
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    });
    await page.locator("#wiked-lite-format").click();
    await page
        .getByRole("button", { name: "Format selection", exact: true })
        .click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "[[Selected]]\n\n[[ Untouched ]]",
    );
    expect(
        await page
            .locator("#editform")
            .evaluate((form: HTMLFormElement) =>
                new FormData(form).get("wpTextbox1"),
            ),
    ).toBe("[[Selected]]\n\n[[ Untouched ]]");
});

test("section edits name the formatting scope explicitly", async ({ page }) => {
    await mountFormatter(page, { section: true });
    await page
        .getByRole("button", { name: "Format section", exact: true })
        .click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "== Heading ==\n\nText",
    );
});

test("storage errors remain readable and formatting can continue without saving", async ({
    page,
}) => {
    await mountFormatter(page);
    await page.evaluate(() => {
        Storage.prototype.setItem = () => {
            throw new Error("Fixture storage unavailable");
        };
    });
    await chooseMore(page, "Save settings");
    const message = page.getByRole("dialog").locator(".cdx-message--error");
    await expect(message).toContainText(
        "You can still apply them for this edit.",
    );
    await expect(message).toBeInViewport();
    expect(await nativeNotifications(page)).toEqual([]);
    const styles = await message.evaluate((element) => {
        const style = getComputedStyle(element);
        return { padding: style.paddingTop, border: style.borderTopWidth };
    });
    expect(styles).toEqual({ padding: "12px", border: "1px" });
    await expect(page.locator("#wpTextbox1")).toHaveValue(initialSource);
    await page
        .getByRole("button", { name: "Format page", exact: true })
        .click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "== Heading ==\n\nText",
    );
});

test("pending redirect lookup locks the draft and announces progress", async ({
    page,
}) => {
    await mountFormatter(page, { source: "[[ Old ]]" });
    await page.evaluate(() => {
        (globalThis as any).mw.Api.prototype.get = () =>
            new Promise((resolve) => {
                (globalThis as any).__finishLookup = () =>
                    resolve({ query: { pages: [{ title: "Old" }] } });
            });
    });
    await page
        .getByRole("checkbox", {
            name: "Replace redirects with target page titles",
            exact: true,
        })
        .check();
    await page
        .getByRole("button", { name: "Format page", exact: true })
        .click();
    await expect(
        page.getByRole("button", { name: "Applying changes…", exact: true }),
    ).toBeDisabled();
    await expect(
        page.getByRole("checkbox", {
            name: "Replace redirects with target page titles",
            exact: true,
        }),
    ).toBeDisabled();
    await expect(page.getByRole("progressbar")).toHaveAccessibleName(
        "Applying changes…",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#wpTextbox1")).toHaveValue("[[ Old ]]");
    await page.evaluate(() => (globalThis as any).__finishLookup());
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue("[[Old]]");
});

test("a pending formatter lookup cannot overwrite newer native source", async ({
    page,
}) => {
    await mountFormatter(page, { source: "[[ Old ]]" });
    await page.evaluate(() => {
        (globalThis as any).mw.Api.prototype.get = () =>
            new Promise((resolve) => {
                (globalThis as any).__finishLookup = () =>
                    resolve({ query: { pages: [{ title: "Old" }] } });
            });
    });
    await page
        .getByRole("checkbox", {
            name: "Replace redirects with target page titles",
            exact: true,
        })
        .check();
    await page
        .getByRole("button", { name: "Format page", exact: true })
        .click();
    await expect(
        page.getByRole("button", { name: "Applying changes…", exact: true }),
    ).toBeDisabled();
    await page
        .locator("#wpTextbox1")
        .evaluate((textarea: HTMLTextAreaElement) => {
            textarea.value = "newer source from another tool";
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
    await page.evaluate(() => (globalThis as any).__finishLookup());

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Format page", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "newer source from another tool",
    );
});

for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    test(`${locale} keeps content and actions usable at a narrow width`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await mountFormatter(page, { locale });
        const dialog = page.getByRole("dialog");
        await expect(dialog).toHaveAttribute("lang", locale);
        for (const [index, name] of ["formatting", "editor"].entries()) {
            await page.getByRole("tab").nth(index).click();
            await expect(
                dialog.getByRole("tabpanel").locator("input, h3").first(),
            ).toBeInViewport();
            const size = await dialog.evaluate((element) => ({
                width: element.clientWidth,
                scroll: element.scrollWidth,
            }));
            expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
            const actions = dialog.locator(".cdx-dialog__footer button");
            for (const button of await actions.all()) {
                await expect(button).toBeInViewport();
            }
            await capture(page, `${name}-${locale}-mobile`);
        }
        await dialog.locator(".wiked-lite-dialog__more button").click();
        await expect(page.getByRole("menu")).toBeInViewport();
        await expect(page.getByRole("menu").getByRole("option")).toHaveCount(3);
        for (const item of await page
            .getByRole("menu")
            .getByRole("option")
            .all()) {
            await expect(item).toBeInViewport();
        }
        await capture(page, `menu-${locale}-mobile`);
    });
}

test("RTL layout keeps its reading direction and literal examples intact", async ({
    page,
}) => {
    await mountFormatter(page, { direction: "rtl" });
    const dialog = page.getByRole("dialog");
    await dialog.locator("pre").scrollIntoViewIfNeeded();
    expect(
        await dialog.evaluate((element) => getComputedStyle(element).direction),
    ).toBe("rtl");
    await expect(dialog.locator("pre")).toHaveAttribute("dir", "ltr");
    await capture(page, "templates-rtl");
});

for (const wikiId of ["enwiki", "zhwiki", "examplewiki"]) {
    test(`${wikiId} offers HTML formatting and both width ratios while gating conversion rules`, async ({
        page,
    }) => {
        const settings = createDefaultFormatterSettings();
        settings.formatter.normalizeConversion = true;
        const conversionSource = "-{ zh-cn:简体;zh-tw:繁體 }-";
        const source =
            `${conversionSource}\n< ref     name=222      /    >\n` +
            '< ref     name=222   style="key1 : a; key2:b "       >123</ ref>';
        await mountFormatter(page, { wikiId, settings, source });
        await expect(
            page.getByRole("group", {
                name: "Formatting options",
                exact: true,
            }),
        ).toBeVisible();
        const html = page.getByRole("checkbox", {
            name: "Format HTML tags",
            exact: true,
        });
        await expect(html).not.toBeChecked();
        await html.check();
        const conversion = page.getByRole("checkbox", {
            name: "Format language conversion rules",
            exact: true,
        });
        if (wikiId === "zhwiki") {
            await expect(conversion).toBeChecked();
        } else {
            await expect(conversion).toHaveCount(0);
        }
        await page
            .getByRole("radio", { name: "Align values", exact: true })
            .check();
        await page.getByRole("radio", { name: "3:5", exact: true }).check();
        await page.getByRole("radio", { name: "1:2", exact: true }).check();
        await chooseMore(page, "Save settings");
        expect(
            (await storedSettings(page))?.formatter.characterWidthRatio,
        ).toBe("2:1");
        expect(
            (await storedSettings(page))?.formatter.normalizeConversion,
        ).toBe(wikiId === "zhwiki");
        expect((await storedSettings(page))?.formatter.formatHtmlTags).toBe(
            true,
        );
        await page
            .getByRole("button", { name: "Format page", exact: true })
            .click();
        const converted =
            wikiId === "zhwiki"
                ? "-{zh-cn:简体; zh-tw:繁體;}-"
                : conversionSource;
        const expected =
            `${converted}\n<ref name="222" />\n` +
            '<ref name="222" style="key1: a; key2: b;">123</ref>';
        await expect(page.locator("#wpTextbox1")).toHaveValue(expected);
        await expect(
            page
                .frameLocator(".wiked-lite-frame")
                .locator(".wiked-lite-editor"),
        ).toHaveText(expected);
    });
}

test("disabling highlighting restores the native textarea and retains display choices", async ({
    page,
}) => {
    const settings = {
        ...createDefaultFormatterSettings(),
        largeFont: true,
    };
    await mountFormatter(page, { settings });
    const textarea = page.locator("#wpTextbox1");
    const nativeFontSize = await textarea.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const enhancedFontSize = await editor.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    const highlighting = page.getByRole("checkbox", {
        name: "Use wikEd Lite to highlight wikitext pages",
        exact: true,
    });
    const largeFont = page.getByRole("checkbox", {
        name: "Use larger text",
        exact: true,
    });
    await expect(editor.locator("span").first()).toBeVisible();
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await highlighting.uncheck();
    for (const name of ["Text and colors", "Links", "Reference popups"]) {
        const controls = page
            .getByRole("group", { name, exact: true })
            .getByRole("checkbox");
        for (const control of await controls.all()) {
            await expect(control).toBeDisabled();
        }
    }
    await expect(largeFont).toBeChecked();
    await expect(
        page.getByRole("checkbox", {
            name: "Use CodeMirror for other content models",
            exact: true,
        }),
    ).toBeEnabled();
    await expect(
        page.getByRole("checkbox", {
            name: "Reference tag inspection",
            exact: true,
        }),
    ).toBeChecked();
    await page
        .getByRole("button", { name: "Apply settings", exact: true })
        .click();
    await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(initialSource);
    expect(
        await textarea.evaluate(
            (element) => getComputedStyle(element).fontSize,
        ),
    ).toBe(nativeFontSize);
    await textarea.focus();
    await textarea.evaluate((element: HTMLTextAreaElement) => {
        element.setSelectionRange(element.value.length, element.value.length);
    });
    await textarea.press("!");
    await expect(textarea).toHaveValue(`${initialSource}!`);
    await page.locator("#wiked-lite-format").click();
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(highlighting).not.toBeChecked();
    await expect(largeFont).toBeDisabled();
    await expect(largeFont).toBeChecked();
    await chooseMore(page, "Reset settings");
    await expect(highlighting).toBeChecked();
    await expect(largeFont).not.toBeChecked();
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
    await expect(textarea).toBeVisible();
    await page.locator("#wiked-lite-format").click();
    await page
        .getByRole("tab", { name: "Highlighting settings", exact: true })
        .click();
    await expect(highlighting).not.toBeChecked();
    await expect(largeFont).toBeDisabled();
    await expect(largeFont).toBeChecked();
    await highlighting.check();
    await expect(largeFont).toBeEnabled();
    await expect(
        page.getByRole("checkbox", {
            name: "Reference tag inspection",
            exact: true,
        }),
    ).toBeEnabled();
    await page
        .getByRole("button", { name: "Apply settings", exact: true })
        .click();
    await expect(textarea).toBeHidden();
    await expect(textarea).toHaveValue(`${initialSource}!`);
    await expect(editor).toHaveText(`${initialSource}!`);
    await expect(editor.locator("span").first()).toBeVisible();
    expect(
        await editor.evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe(enhancedFontSize);
});

test("Clear cache refreshes missing titles and page summaries without changing source or settings", async ({
    page,
}) => {
    const source = "[[Cached]] [[Missing]]";
    const settings = {
        ...createDefaultFormatterSettings(),
        linkPreviews: true,
    };
    await mountFormatter(page, { source, settings, open: false });
    let missing = true;
    let summaries = 0;
    await page.route(/\/w\/api\.php(?:\?|$)/u, async (route) => {
        const title = new URL(route.request().url()).searchParams.get("titles");
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                query: {
                    pages: [
                        {
                            title,
                            ...(title === "Missing" && missing
                                ? { missing: true }
                                : { pageid: 1 }),
                        },
                    ],
                },
            }),
        });
    });
    await page.route("**/api/rest_v1/page/summary/**", async (route) => {
        summaries += 1;
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                title: "Cached",
                extract: `Summary ${summaries}`,
            }),
        });
    });
    const frame = page.frameLocator(".wiked-lite-frame");
    const absent = frame.locator('[data-page-preview-title="Missing"]');
    const cached = frame.locator('[data-page-preview-title="Cached"]');
    const extract = frame.locator(".wiked-lite-page-preview__extract");
    await absent.hover();
    await expect(absent).toHaveClass(/wiked-lite-token--page-missing/u);
    await cached.hover();
    await expect(extract).toHaveText("Summary 1");
    await page.mouse.move(2, 2);
    await expect(extract).toHaveCount(0);
    await cached.hover();
    await expect(extract).toHaveText("Summary 1");
    expect(summaries).toBe(1);

    missing = false;
    await page.locator("#wiked-lite-format").click();
    await chooseMore(page, "Clear cache");
    await expect(absent).not.toHaveClass(/wiked-lite-token--page-missing/u);
    await expectSuccessNotification(
        page,
        "cache-cleared",
        "Cache cleared. Data will reload as needed.",
    );
    expect(await storedSettings(page)).toEqual(settings);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await cached.hover();
    await expect(extract).toHaveText("Summary 2");
    await absent.hover();
    await expect(extract).toHaveText("Summary 3");
    await expect(absent).not.toHaveClass(/wiked-lite-token--page-missing/u);
});

test("page summaries requested before Clear cache cannot replace fresh cached results", async ({
    page,
}) => {
    await mountFormatter(page, {
        source: "[[Cached]]",
        open: false,
        settings: { ...createDefaultFormatterSettings(), linkPreviews: true },
    });
    let finishOld!: () => void;
    const oldResponse = new Promise<void>((resolve) => {
        finishOld = resolve;
    });
    let oldFinished = false;
    let summaries = 0;
    await page.route(/\/w\/api\.php(?:\?|$)/u, (route) =>
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                query: { pages: [{ title: "Cached", pageid: 1 }] },
            }),
        }),
    );
    await page.route("**/api/rest_v1/page/summary/**", async (route) => {
        summaries += 1;
        const stale = summaries === 1;
        if (stale) await oldResponse;
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                title: "Cached",
                extract: stale ? "Stale summary" : "Fresh summary",
            }),
        });
        if (stale) oldFinished = true;
    });
    const frame = page.frameLocator(".wiked-lite-frame");
    const title = frame.locator('[data-page-preview-title="Cached"]');
    const extract = frame.locator(".wiked-lite-page-preview__extract");
    await title.hover();
    await expect.poll(() => summaries).toBe(1);
    await page.locator("#wiked-lite-format").click();
    await chooseMore(page, "Clear cache");
    await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
    await title.hover();
    await expect(extract).toHaveText("Fresh summary");
    finishOld();
    await expect.poll(() => oldFinished).toBe(true);
    await page.mouse.move(2, 2);
    await expect(extract).toHaveCount(0);
    await title.hover();
    await expect(extract).toHaveText("Fresh summary");
    expect(summaries).toBe(2);
});

async function chooseMore(page: Page, name: string): Promise<void> {
    await page
        .getByRole("button", { name: "More options", exact: true })
        .click();
    await page
        .getByRole("menu")
        .getByRole("option", { name, exact: true })
        .click();
}

async function capture(page: Page, name: string): Promise<void> {
    const dir = process.env.WIKED_LITE_SCREENSHOT_DIR;
    if (dir) {
        await mkdir(dir, { recursive: true });
        await page.screenshot({
            path: `${dir}/${name}.png`,
            animations: "disabled",
        });
    }
}

async function storedSettings(page: Page): Promise<FormatterSettings | null> {
    return page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
        FORMATTER_SETTINGS_STORAGE_KEY,
    );
}

async function nativeNotifications(page: Page): Promise<NativeNotification[]> {
    return page.evaluate(() => (globalThis as any).__notifications);
}

async function expectSuccessNotification(
    page: Page,
    key: string,
    message: string,
    count = 1,
): Promise<void> {
    await expect
        .poll(() => nativeNotifications(page))
        .toEqual(
            Array.from({ length: count }, () => ({
                message,
                options: {
                    autoHide: true,
                    autoHideSeconds: "short",
                    tag: `wiked-lite:${key}`,
                    type: "success",
                },
            })),
        );
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const announcement = dialog
        .locator(".cdx-dialog__body")
        .getByRole("status");
    await expect(announcement).toHaveText(message);
    await expect(announcement).toHaveAttribute("aria-live", "polite");
    await expect(announcement).toHaveAttribute("aria-atomic", "true");
    await expect(announcement).toHaveClass(/wiked-lite-dialog__sr-only/u);
    expect(
        await announcement.evaluate(
            (element) =>
                element.closest('[inert], [aria-hidden="true"]') === null,
        ),
    ).toBe(true);
    await expect(
        dialog.locator(".cdx-dialog__footer .wiked-lite-dialog__feedback"),
    ).toHaveCount(0);
    await expect(page.locator(".mw-notification-area-overlay")).toBeEmpty();
}

async function mountFormatter(
    page: Page,
    options: {
        locale?: string;
        direction?: string;
        source?: string;
        pageSource?: string;
        section?: boolean;
        open?: boolean;
        platform?: string;
        wikiId?: string;
        settings?: FormatterSettings;
    } = {},
): Promise<void> {
    // Every request is served locally; the fixture never contacts a wiki.
    await page.route("**/*", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await page.goto("https://example.test/wiki/Sandbox?action=edit");
    if (options.settings) {
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: options.settings,
            },
        );
    }
    await page.setContent(
        '<form id="editform"><div id="p-cactions"></div><textarea id="wpTextbox1" name="wpTextbox1" aria-label="Wikitext editor"></textarea></form><div class="mw-notification-area-overlay" role="status"></div>',
    );
    await page.locator("#wpTextbox1").fill(options.source ?? initialSource);
    await page.addScriptTag({ content: runtime });
    await page.addStyleTag({
        path: `${projectRoot}node_modules/@wikimedia/codex/dist/codex.style-bidi.css`,
    });
    await page.addStyleTag({
        content:
            "body { font: 16px/1.6 sans-serif; margin: 24px; } #p-cactions { margin-bottom: 16px; }",
    });
    await page.evaluate(
        ({ locale, direction, section, wikiId, pageSource, platform }) => {
            if (platform != null) {
                Object.defineProperty(navigator, "platform", {
                    configurable: true,
                    value: platform,
                });
            }
            document.documentElement.lang = locale;
            document.documentElement.dir = direction;
            const settings: Record<string, unknown> = {
                wgAction: "edit",
                wgPageContentModel: "wikitext",
                wgUserLanguage: locale,
                wgDBname: wikiId,
                wgWikiID: wikiId,
                wgPageName: "Sandbox",
                wgCurRevisionId: pageSource == null ? 0 : 123,
                wgNamespaceNumber: 0,
                wgTitle: "Sandbox",
                wgSection: section ? "1" : undefined,
            };
            if (section) {
                const field = document.createElement("input");
                field.name = "wpSection";
                field.value = "1";
                document.getElementById("editform")?.append(field);
            }
            const hook = {
                add() {
                    return hook;
                },
                remove() {
                    return hook;
                },
            };
            const notifications: NativeNotification[] = [];
            (globalThis as any).__notifications = notifications;
            (globalThis as any).mw = {
                Api: class {
                    async get(parameters: Record<string, unknown>) {
                        if (
                            parameters.prop === "revisions" &&
                            pageSource != null
                        ) {
                            return {
                                query: {
                                    pages: [
                                        {
                                            revisions: [
                                                {
                                                    slots: {
                                                        main: {
                                                            content: pageSource,
                                                        },
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            };
                        }
                        if (parameters.meta === "siteinfo")
                            return {
                                query: {
                                    namespaces: {},
                                    namespacealiases: [],
                                    magicwords: [],
                                    functionhooks: [],
                                    variables: [],
                                },
                            };
                        throw new Error(
                            "Unexpected API request in offline formatter fixture",
                        );
                    }
                },
                config: { get: (key: string) => settings[key] },
                hook: () => hook,
                loader: {
                    using: async () => (name: string) =>
                        name === "vue"
                            ? (globalThis as any).WikEdTestUI.vue
                            : (globalThis as any).WikEdTestUI.codex,
                },
                notify(message: string, options: MediaWikiNotificationOptions) {
                    notifications.push({ message, options });
                },
                util: {
                    addCSS(css: string) {
                        const style = document.createElement("style");
                        style.textContent = css;
                        document.head.append(style);
                        return { ownerNode: style };
                    },
                    addPortletLink(
                        portlet: string,
                        options: {
                            id: string;
                            text: string;
                            href: string;
                            tooltip: string;
                        },
                    ) {
                        const link = document.createElement("a");
                        link.id = options.id;
                        link.textContent = options.text;
                        link.href = options.href;
                        link.title = options.tooltip;
                        document.getElementById(portlet)?.append(link);
                        return link;
                    },
                    getUrl: (title: string) => `/wiki/${title}`,
                    wikiScript: () => "/w/api.php",
                },
            };
            (globalThis as any).wikEdLiteConfig = { highlightDelay: 0 };
        },
        {
            locale: options.locale ?? "en",
            direction: options.direction ?? "ltr",
            section: options.section ?? false,
            wikiId: options.wikiId ?? "examplewiki",
            pageSource: options.pageSource,
            platform: options.platform,
        },
    );
    await page.addScriptTag({
        content: await readFile(`${projectRoot}dist/wiked_lite.min.js`, "utf8"),
    });
    await expect(
        page.locator('.wiked-lite-frame[data-wiked-ready="true"]'),
    ).toBeVisible();
    if (options.open !== false) {
        await page.locator("#wiked-lite-format").click();
        await expect(page.getByRole("dialog")).toBeVisible();
    }
}
