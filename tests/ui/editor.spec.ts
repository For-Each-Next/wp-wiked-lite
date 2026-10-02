/**
 * @file tests/ui/editor.spec.ts
 * Purpose: tests / ui / editor.spec module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 * 4. assertEditorMirrors
 * 5. mountLightweightEditor
 * 6. expectTooltipIcon
 * 7. expectTooltipTextarea
 * 8. expectTooltipInlineSource
 * 9. openedLinks
 * 10. installPageExistenceFixture
 * 11. setCaretAtTokenEdge
 * 12. getCaretSourceOffset
 * 13. mountEditor
 * 14. installMediaWikiFixture
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

import { FORMATTER_SETTINGS_STORAGE_KEY } from "../../src/platform/browser/formatter-settings.ts";
import { createDefaultFormatterSettings } from "../../src/domain/formatter-settings.ts";

const gadgetArtifact = fileURLToPath(
    new URL("../../dist/wiked_lite.min.js", import.meta.url),
);
const userscriptArtifact = fileURLToPath(
    new URL("../../dist/wiked_lite.user.js", import.meta.url),
);
const initialSource = "== Heading ==\nA [[Link]]";

test("independent edit tools share selection, history, source and teardown", async ({
    page,
}) => {
    await mountEditor(page, "Before selected after");
    const frame = page.frameLocator(".wiked-lite-frame");
    const editor = frame.locator(".wiked-lite-editor");
    await editor.focus();
    await editor.evaluate((element) => {
        const walker = element.ownerDocument.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
        );
        const range = element.ownerDocument.createRange();
        let offset = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const end = offset + (node.textContent?.length ?? 0);
            if (offset <= 7 && end >= 7) range.setStart(node, 7 - offset);
            if (offset <= 15 && end >= 15) {
                range.setEnd(node, 15 - offset);
                break;
            }
            offset = end;
        }
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    });
    await page.evaluate(() => {
        const textarea = document.querySelector(
            "#wpTextbox1",
        ) as HTMLTextAreaElement;
        const backend = (textarea as any)[
            Symbol.for("mediawiki-gadgets.edit-box-backend")
        ];
        backend.replaceSelection("citation");
        backend.focus();
    });
    await expect(editor).toHaveText("Before citation after");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "Before citation after",
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).toHaveText("Before selected after");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(editor).toHaveText("Before citation after");
    expect(await getCaretSourceOffset(editor)).toBe(15);
    expect(
        await editor.evaluate(
            (element) => element.ownerDocument.getSelection()?.isCollapsed,
        ),
    ).toBe(true);
    await page.evaluate(() => {
        const textarea = document.querySelector(
            "#wpTextbox1",
        ) as HTMLTextAreaElement;
        const backend = (textarea as any)[
            Symbol.for("mediawiki-gadgets.edit-box-backend")
        ];
        backend.writePreservingPosition("Changed source");
        if (backend.read() !== textarea.value)
            throw new Error("Source is not synchronized");
    });
    await expect(editor).toHaveText("Changed source");
    await page
        .locator(".wiked-lite-frame")
        .evaluate((element) => element.remove());
    await expect
        .poll(() =>
            page.evaluate(() => {
                const textarea = document.querySelector(
                    "#wpTextbox1",
                ) as HTMLTextAreaElement;
                return (
                    (textarea as any)[
                        Symbol.for("mediawiki-gadgets.edit-box-backend")
                    ] === undefined
                );
            }),
        )
        .toBe(true);
    await expect(page.locator("#wpTextbox1")).toHaveValue("Changed source");
});

test("editor backend preserves the visible scrolling surface", async ({
    page,
}) => {
    const source = Array.from(
        { length: 180 },
        (_, index) => "Line " + index + " ".repeat(10),
    ).join("\n");
    await mountEditor(page, source);
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await editor.evaluate((element) => {
        element.scrollTop = 450;
    });
    const top = await editor.evaluate((element) => element.scrollTop);
    expect(top).toBeGreaterThan(0);
    await page.evaluate(() => {
        const textarea = document.querySelector(
            "#wpTextbox1",
        ) as HTMLTextAreaElement;
        const backend = (textarea as any)[
            Symbol.for("mediawiki-gadgets.edit-box-backend")
        ];
        backend.writePreservingPosition(
            textarea.value.replace("Line 1", "Edited 1"),
        );
    });
    expect(await editor.evaluate((element) => element.scrollTop)).toBe(top);
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source.replace("Line 1", "Edited 1"),
    );
});

test("editor actions preserve an active IME composition", async ({ page }) => {
    await mountEditor(page, "Original");
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await editor.dispatchEvent("compositionstart");
    const result = await page.evaluate(() => {
        const textarea = document.querySelector(
            "#wpTextbox1",
        ) as HTMLTextAreaElement;
        const backend = (textarea as any)[
            Symbol.for("mediawiki-gadgets.edit-box-backend")
        ];
        const errors: string[] = [];
        for (const operation of [
            () => backend.write("replacement"),
            () => backend.replaceSelection("citation"),
        ]) {
            try {
                operation();
            } catch (error) {
                errors.push((error as Error).message);
            }
        }
        return { errors, source: textarea.value };
    });
    expect(result.source).toBe("Original");
    expect(result.errors).toHaveLength(2);
    await editor.dispatchEvent("compositionend");
    await expect(editor).toHaveText("Original");
    await expect(page.locator("#wpTextbox1")).toHaveValue("Original");
});

for (const [name, artifact] of [
    ["gadget", gadgetArtifact],
    ["userscript", userscriptArtifact],
] as const) {
    test(`${name} mirrors iframe edits into MediaWiki's textarea`, async ({
        page,
    }) => {
        await assertEditorMirrors(page, artifact);
    });
}

for (const enabled of [false, true]) {
    test(`other content models ${enabled ? "load" : "skip"} CodeMirror according to saved settings`, async ({
        page,
    }) => {
        await page.route("https://example.test/**", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            }),
        );
        await page.goto(
            "https://example.test/wiki/MediaWiki:Common.css?action=edit",
        );
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: {
                    ...createDefaultFormatterSettings(),
                    syntaxHighlighting: false,
                    useCodeMirrorForOtherModels: enabled,
                },
            },
        );
        await page.setContent(
            '<form id="editform"><div id="p-cactions"></div><textarea id="wpTextbox1" name="wpTextbox1"></textarea></form>',
        );
        await installMediaWikiFixture(page, "examplewiki");
        await page.evaluate(() => {
            const mediaWiki = (globalThis as any).mw;
            const getConfig = mediaWiki.config.get;
            (globalThis as any).__modelLookups = 0;
            (globalThis as any).__codeMirrorModules = [];
            (globalThis as any).__codeMirrorStarted = false;
            mediaWiki.config.get = (key: string) => {
                if (key === "wgPageContentModel") {
                    (globalThis as any).__modelLookups += 1;
                    return "css";
                }
                return getConfig(key);
            };
            mediaWiki.loader.using = async (modules: string[]) => {
                (globalThis as any).__codeMirrorModules.push(modules);
                return (module: string) =>
                    module === "ext.CodeMirror"
                        ? class {
                              textarea: HTMLTextAreaElement;

                              constructor(textarea: HTMLTextAreaElement) {
                                  this.textarea = textarea;
                              }

                              initialize() {
                                  (globalThis as any).__codeMirrorStarted =
                                      true;
                              }

                              toggle() {}
                          }
                        : { css: () => ({}) };
            };
        });

        await page.addScriptTag({ path: gadgetArtifact });
        await expect
            .poll(() => page.evaluate(() => (globalThis as any).__modelLookups))
            .toBeGreaterThan(0);
        if (enabled) {
            await expect
                .poll(() =>
                    page.evaluate(
                        () => (globalThis as any).__codeMirrorStarted,
                    ),
                )
                .toBe(true);
        }
        expect(
            await page.evaluate(() => (globalThis as any).__codeMirrorModules),
        ).toEqual(enabled ? [["ext.CodeMirror", "ext.CodeMirror.modes"]] : []);
        await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
        await expect(page.locator("#wiked-lite-format")).toHaveCount(0);
    });
}

test("saved disabled highlighting keeps the native editor across content hooks", async ({
    page,
}) => {
    await page.route("https://example.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await page.goto("https://example.test/wiki/Sandbox?action=edit");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                largeFont: true,
                syntaxHighlighting: false,
            },
        },
    );
    await page.setContent(
        '<form id="editform"><div id="p-cactions"></div>' +
            '<textarea id="wpTextbox1" name="wpTextbox1" ' +
            'aria-label="Wikitext editor" tabindex="3" style="font-size: 14px"></textarea></form>',
    );
    await page.locator("#wpTextbox1").fill(initialSource);
    await installMediaWikiFixture(page, "examplewiki");
    await page.evaluate(() => {
        const callbacks: Array<() => void> = [];
        (globalThis as any).__editorHooks = callbacks;
        (globalThis as any).mw.hook = () => ({
            add(callback: () => void) {
                callbacks.push(callback);
            },
        });
    });
    await page.addScriptTag({ path: gadgetArtifact });
    await expect(page.locator("#wiked-lite-format")).toHaveCount(1);
    const native = page.locator("#wpTextbox1");
    await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
    await expect(native).toBeVisible();
    await expect(native).toHaveCSS("font-size", "14px");
    await expect(native).toHaveAttribute("tabindex", "3");
    expect(await native.getAttribute("aria-hidden")).toBeNull();
    await native.fill("Native [[editing]] remains available");
    await page.evaluate(() => {
        for (const callback of (globalThis as any).__editorHooks) {
            callback();
        }
    });
    await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
    await expect(native).toBeVisible();
    expect(
        await page
            .locator("#editform")
            .evaluate((form) =>
                new FormData(form as HTMLFormElement).get("wpTextbox1"),
            ),
    ).toBe("Native [[editing]] remains available");
});

async function assertEditorMirrors(
    page: Page,
    artifact: string,
): Promise<void> {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await mountEditor(page, initialSource, artifact);

    const frame = page.locator('.wiked-lite-frame[data-wiked-ready="true"]');
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await expect(frame).toBeVisible();
    await expect(editor).toHaveText(initialSource);
    await expect(
        page
            .frameLocator(".wiked-lite-frame")
            .locator(".wiked-lite-token--heading")
            .first(),
    ).toBeVisible();
    await expect(page.locator("#wiked-lite-format")).toHaveCount(1);

    await editor.focus();
    await editor.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    });
    await editor.press("!");

    await expect(page.locator("#wpTextbox1")).toHaveValue(`${initialSource}!`);
    const submittedSource = await page.evaluate(() => {
        const form = document.querySelector<HTMLFormElement>("#editform");
        return form == null ? null : new FormData(form).get("wpTextbox1");
    });
    expect(submittedSource).toBe(`${initialSource}!`);
    expect(pageErrors).toEqual([]);
}

test("IME updates remain submitted source while rendering waits for composition", async ({
    page,
}) => {
    await mountEditor(page, initialSource);
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await editor.focus();
    await editor.evaluate((element) => {
        element.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
        );
        element.textContent = "正在编辑 [[Link]]";
        (globalThis as any).__compositionText = element.firstChild;
        element.dispatchEvent(
            new InputEvent("input", {
                bubbles: true,
                inputType: "insertCompositionText",
                isComposing: true,
            }),
        );
    });
    await expect(page.locator("#wpTextbox1")).toHaveValue("正在编辑 [[Link]]");
    expect(
        await page
            .locator("#editform")
            .evaluate((form) =>
                new FormData(form as HTMLFormElement).get("wpTextbox1"),
            ),
    ).toBe("正在编辑 [[Link]]");
    await page.waitForTimeout(150);
    expect(
        await editor.evaluate(
            (element) =>
                element.firstChild === (globalThis as any).__compositionText,
        ),
    ).toBe(true);

    await editor.dispatchEvent("compositionend");
    await expect(
        editor.locator("[data-href]").filter({ hasText: "Link" }),
    ).toHaveCount(1);
    await expect(page.locator("#wpTextbox1")).toHaveValue("正在编辑 [[Link]]");
});

test("teardown restores native focus and composition and disconnects old listeners", async ({
    page,
}) => {
    await mountEditor(page, initialSource);
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await editor.focus();
    await editor.evaluate((element) => {
        element.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
        );
        element.textContent = "final 文本";
        const range = element.ownerDocument.createRange();
        range.setStart(element.firstChild!, 6);
        range.collapse(true);
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    });
    await page.evaluate(() => {
        const frame =
            document.querySelector<HTMLIFrameElement>(".wiked-lite-frame")!;
        (globalThis as any).__detachedEditor =
            frame.contentDocument!.querySelector(".wiked-lite-editor");
        document
            .querySelector("#wpTextbox1")!
            .before(document.createElement("div"));
    });

    const native = page.locator("#wpTextbox1");
    await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
    await expect(native).toBeVisible();
    await expect(native).toBeFocused();
    await expect(native).toHaveValue("final 文本");
    expect(await native.getAttribute("aria-hidden")).toBeNull();
    expect(await native.getAttribute("tabindex")).toBeNull();
    expect(
        await native.evaluate(
            (element: HTMLTextAreaElement) => element.selectionStart,
        ),
    ).toBe(6);

    await page.evaluate(() => {
        const stale = (globalThis as any).__detachedEditor as HTMLElement;
        stale.textContent = "stale detached source";
        stale.dispatchEvent(new Event("compositionend", { bubbles: true }));
        stale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(native).toHaveValue("final 文本");
});

test("editor links open only on a deliberate modified click", async ({
    page,
}) => {
    const source = "A [[Example navigation target]] B";
    await mountEditor(page, source);
    await page.evaluate(() => {
        const opened: unknown[][] = [];
        (globalThis as any).__openedLinks = opened;
        window.open = function recordOpen(...args): null {
            opened.push(args);
            return null;
        };
    });
    const link = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor [data-href]")
        .filter({ hasText: "Example navigation target" });
    await expect(link).toHaveCount(1);
    const modifier = process.platform === "darwin" ? "Meta" : "Control";

    await link.click();
    await link.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    });
    await link.click({ modifiers: [modifier] });
    expect(await openedLinks(page)).toEqual([]);

    await link.evaluate((element) => {
        element.ownerDocument.getSelection()?.removeAllRanges();
    });
    await link.click({ modifiers: [modifier] });
    expect(await openedLinks(page)).toEqual([
        ["/wiki/Example_navigation_target", "_blank", "noopener,noreferrer"],
    ]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

for (const enabled of [true, false]) {
    test(`local and foreign helper links respect ${enabled ? "enabled" : "disabled"} navigation`, async ({
        page,
    }) => {
        const source =
            "{{Tsl|en|Game map#Early years|本地條目|顯示}} " +
            "{{link-en|Local page|Foreign page#History}}";
        await page.route("https://example.test/**", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            }),
        );
        await page.goto("https://example.test/wiki/Sandbox");
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: {
                    ...createDefaultFormatterSettings(),
                    ctrlClickLinks: enabled,
                },
            },
        );
        await mountEditor(page, source, gadgetArtifact, "zhwiki");
        await page.evaluate(() => {
            const opened: unknown[][] = [];
            (globalThis as any).__openedLinks = opened;
            window.open = (...args): null => {
                opened.push(args);
                return null;
            };
        });

        const editor = page
            .frameLocator(".wiked-lite-frame")
            .locator(".wiked-lite-editor");
        const targets = [
            [
                "Game map#Early years",
                "https://en.wikipedia.org/wiki/Game_map#Early_years",
            ],
            ["本地條目", "/wiki/%E6%9C%AC%E5%9C%B0%E6%A2%9D%E7%9B%AE"],
            ["顯示", "/wiki/%E6%9C%AC%E5%9C%B0%E6%A2%9D%E7%9B%AE"],
            ["Local page", "/wiki/Local_page"],
            [
                "Foreign page#History",
                "https://en.wikipedia.org/wiki/Foreign_page#History",
            ],
        ] as const;
        const expected: string[][] = [];
        for (const [text, href] of targets) {
            const link = editor
                .locator("[data-href]")
                .filter({ hasText: text });
            await expect(link).toHaveCount(1);
            await expect(link).toHaveAttribute("data-href", href);
            for (const modifier of ["ctrlKey", "metaKey"] as const) {
                await link.evaluate((element, modifier) => {
                    element.ownerDocument.getSelection()?.removeAllRanges();
                    const options = {
                        bubbles: true,
                        cancelable: true,
                        button: 0,
                        detail: 1,
                        [modifier]: true,
                    };
                    element.dispatchEvent(new MouseEvent("mousedown", options));
                    element.dispatchEvent(new MouseEvent("click", options));
                }, modifier);
                if (enabled) {
                    expected.push([href, "_blank", "noopener,noreferrer"]);
                }
                expect(await openedLinks(page)).toEqual(expected);
            }
        }
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    });
}

test("editor refreshes localized syntax after siteinfo loads", async ({
    page,
}) => {
    const source =
        "[[Datei:Example.svg|miniatur|alternativ=Map]] " +
        "{{lokalfunktion:Foo}}";
    await mountEditor(page, source);

    await expect
        .poll(() => page.evaluate(() => (globalThis as any).__siteinfoRequests))
        .toBe(1);
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await expect(
        editor.locator(".wiked-lite-token--file").filter({ hasText: "Datei" }),
    ).toBeVisible();
    await expect(
        editor
            .locator(".wiked-lite-token--parameter")
            .filter({ hasText: "miniatur" }),
    ).toBeVisible();
    await expect(
        editor
            .locator(".wiked-lite-token--parameter")
            .filter({ hasText: "alternativ" }),
    ).toBeVisible();
    await expect(
        editor
            .locator(".wiked-lite-token--parser-function")
            .filter({ hasText: "lokalfunktion" }),
    ).toBeVisible();
});

test("entities and special characters keep tooltips without visual markers", async ({
    page,
}) => {
    const specialCharacters = [
        ["tab", "\t", "U+0009 (tab)"],
        ["en-space", "\u2002", "U+2002 (en space)"],
        ["em-space", "\u2003", "U+2003 (em space)"],
        ["thin-space", "\u2009", "U+2009 (thin space)"],
        ["ideographic-space", "\u3000", "U+3000 (ideographic space)"],
        ["soft-hyphen", "\u00ad", "U+00AD (soft hyphen)"],
        ["figure-dash", "\u2012", "U+2012 ‒ (figure dash)"],
        ["en-dash", "–", "U+2013 – (en dash)"],
        ["em-dash", "—", "U+2014 — (em dash)"],
        ["horizontal-bar", "\u2015", "U+2015 ― (horizontal bar)"],
        ["minus-sign", "\u2212", "U+2212 − (minus sign)"],
    ] as const;
    const source =
        "A&nbsp;B &#124;|" +
        specialCharacters.map(([, character]) => character).join("|");
    await mountEditor(page, source);

    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const entities = editor.locator(".wiked-lite-token--entity");
    await expect(entities).toHaveCount(2);
    await expect(entities.nth(0)).toHaveText("&nbsp;");
    await expect(entities.nth(0)).toHaveAttribute("title", "U+00A0 \u00A0");
    await expect(entities.nth(1)).toHaveText("&#124;");
    await expect(entities.nth(1)).toHaveAttribute("title", "U+007C |");
    for (const [marker, character, title] of specialCharacters) {
        const token = editor.locator(`.wiked-lite-token--${marker}`);
        await expect(token).toHaveText(character);
        await expect(token).toHaveAttribute("title", title);
        const paint = await token.evaluate((element) => {
            const before = getComputedStyle(element, "::before");
            const after = getComputedStyle(element, "::after");
            return {
                beforeContent: before.content,
                beforeImage: before.backgroundImage,
                afterBorder: after.borderBottomStyle,
                afterContent: after.content,
            };
        });
        expect(paint.beforeImage).toBe("none");
        expect(paint.beforeContent).not.toBe('""');
        expect(paint.afterContent).not.toBe('""');
        expect(paint.afterBorder).toBe("none");
    }
    expect(await editor.evaluate((element) => element.textContent)).toBe(
        source,
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    const submittedSource = await page.evaluate(() => {
        const form = document.querySelector<HTMLFormElement>("#editform");
        return form == null ? null : new FormData(form).get("wpTextbox1");
    });
    expect(submittedSource).toBe(source);
});

test("arrow keys cross each tipped dash or space in one press", async ({
    page,
}) => {
    const source = "A–B—C\u2002D";
    await mountEditor(page, source);
    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    await editor.focus();

    for (const [className, character] of [
        ["en-dash", "–"],
        ["em-dash", "—"],
        ["en-space", "\u2002"],
    ] as const) {
        const token = editor.locator(`.wiked-lite-token--${className}`);
        await expect(token).toHaveText(character);
        const offset = source.indexOf(character);

        await setCaretAtTokenEdge(token, false);
        await page.keyboard.press("ArrowRight");
        expect(await getCaretSourceOffset(editor)).toBe(offset + 1);

        await setCaretAtTokenEdge(token, true);
        await page.keyboard.press("ArrowLeft");
        expect(await getCaretSourceOffset(editor)).toBe(offset);
    }
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("a comment inside a reference uses the reference's small text size", async ({
    page,
}) => {
    const source =
        '<ref name="IGN: 64DD">{{cite web ' +
        "|url=http://www.ign.com/articles/1997/06/03/four-games-to-launch-with-japanese-64dd " +
        "|access-date=2014-08-31 |title=Four Games To Launch With Japanese 64DD " +
        "|author=<!--Not stated--> |date=1997-06-02 |work=[[IGN]] " +
        "|publisher=[[Ziff Davis]] " +
        "|archive-url=https://web.archive.org/web/20150427192100/http://www.ign.com/articles/1997/06/03/four-games-to-launch-with-japanese-64dd " +
        "|archive-date=2015-04-27 |url-status=live}}</ref> <!--Outside-->";
    await mountEditor(page, source);

    const editor = page
        .frameLocator(".wiked-lite-frame")
        .locator(".wiked-lite-editor");
    const inner = editor
        .locator(".wiked-lite-token--comment")
        .filter({ hasText: "Not stated" });
    const outer = editor
        .locator(".wiked-lite-token--comment")
        .filter({ hasText: "Outside" });
    const reference = editor
        .locator(".wiked-lite-token--reference")
        .filter({ hasText: "cite web" })
        .first();
    const innerSize = await inner.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    const referenceSize = await reference.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    const outerSize = await outer.evaluate(
        (element) => getComputedStyle(element).fontSize,
    );
    expect(innerSize).toBe(referenceSize);
    expect(Number.parseFloat(innerSize)).toBeLessThan(
        Number.parseFloat(outerSize),
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("citation tooltips link template documentation and retain full archive destinations", async ({
    page,
    context,
}) => {
    let documentationReferer: string | undefined;
    await context.route("https://example.test/**", async (route) => {
        if (route.request().url().includes("Template%3A")) {
            documentationReferer = route.request().headers().referer;
        }
        await route.fulfill({
            contentType: "text/html",
            body: "Template documentation",
        });
    });
    await page.goto("https://example.test/wiki/Sandbox");
    const originalUrl =
        "http://www.gamespot.com/articles/nintendo-says-64dd-delayed/1100-2466742/";
    const archiveUrl =
        "https://web.archive.org/web/20180208123826/" +
        originalUrl.replace(/^http:/u, "https:");
    const source =
        `<ref name="source">{{Cite web|url=${originalUrl}|archive-url=${archiveUrl}}}</ref>\n` +
        '<ref name="note">Plain explanatory note.</ref>';
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    await frame
        .locator("[data-reference^='<ref name=\"source\"']")
        .first()
        .hover();
    const popup = frame.locator(".wiked-lite-tooltip");
    const title = popup.locator(".wiked-lite-tooltip__title");
    const citationTitle = popup.locator(".wiked-lite-tooltip__citation-title");
    const documentation = citationTitle.getByRole("link", {
        name: "Cite web",
        exact: true,
    });
    await expect(title).toHaveText("Reference (source)");
    await expect(title.locator("code")).toHaveText("source");
    await expect(citationTitle).toContainText("{{Cite web}}");
    await expect(documentation).toHaveAttribute(
        "href",
        "/wiki/Template%3ACite_web",
    );
    await expect(documentation).toHaveAttribute("target", "_blank");
    await expect(documentation).toHaveAttribute("rel", "noopener noreferrer");
    const archive = popup
        .locator(".wiked-lite-tooltip__row")
        .filter({ hasText: /^archive-url/u })
        .getByRole("link");
    await expect(archive).toHaveText(
        "https://web.archive.org/web/20180208123826/https://...",
    );
    await expect(archive).toHaveAttribute("href", archiveUrl);

    const opened = context.waitForEvent("page");
    await documentation.click({ modifiers: ["ControlOrMeta"] });
    const documentationPage = await opened;
    await expect(documentationPage).toHaveURL(
        "https://example.test/wiki/Template%3ACite_web",
    );
    expect(await documentationPage.evaluate(() => window.opener)).toBeNull();
    expect(documentationReferer).toBeUndefined();
    await documentationPage.close();

    await frame.locator(".wiked-lite-editor").press("Escape");
    await expect(popup).toHaveCount(0);
    await frame
        .locator("[data-reference^='<ref name=\"note\"']")
        .first()
        .hover();
    await expect(title).toHaveText("Reference (note)");
    await expect(citationTitle).toContainText("Reference content");
    await expect(title.getByRole("link")).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("sub-reference tooltips show raw details with editor syntax highlighting", async ({
    page,
}) => {
    const ucgUrl =
        "https://archive.org/details/UCG-2006/%E6%B8%B8%E6%88%8F%E6%9C%BA%E5%AE%9E%E7%94%A8%E6%8A%80%E6%9C%AF%20152%202006.6A/page/n59/mode/2up";
    const gameUrl =
        "https://archive.org/details/game-software-2006/%E7%94%B5%E5%AD%90%E6%B8%B8%E6%88%8F%E8%BD%AF%E4%BB%B6_2006%E5%B9%B4%E7%AC%AC10%E6%9C%9F_%E6%80%BB%E7%AC%AC181%E6%9C%9F/page/90/mode/2up";
    const title = "Mother3 攻略透解 奇妙、有趣，还有发自内心的伤感……";
    const source =
        '<ref name="UCG">{{Cite journal|title=游戏机实用技术|volume=152}}</ref>\n' +
        `<ref name="UCG" details="阿修罗. {{url|${ucgUrl}|${title}}} :58-63" />` +
        `<ref name=":2" details="{{URL|${gameUrl}|地球冒险3}}. 攻略人行道 :90-93" />`;
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const popup = frame.locator(".wiked-lite-tooltip");
    const details = popup.locator(".wiked-lite-tooltip__details");
    const code = details.locator(".wiked-lite-tooltip__code");
    await frame
        .locator("[data-reference^='<ref name=\"UCG\" details=']")
        .first()
        .hover();
    await expect(details).toContainText("Sub-reference content");
    await expect(code).toHaveText(`阿修罗. {{url|${ucgUrl}|${title}}} :58-63`);
    const templateName = code.locator(".wiked-lite-token--template-name");
    await expect(templateName).toHaveText("url");
    expect(
        await templateName.evaluate(
            (element) => getComputedStyle(element).color,
        ),
    ).toBe(
        await frame
            .locator(".wiked-lite-editor .wiked-lite-token--template-name")
            .filter({ hasText: /^url$/iu })
            .first()
            .evaluate((element) => getComputedStyle(element).color),
    );
    await expect(code.locator(".wiked-lite-token--url")).toHaveText(ucgUrl);
    await expect(
        details.locator(`a[href="${ucgUrl}"]`).first(),
    ).toHaveAttribute("target", "_blank");
    await expect(popup.locator(".wiked-lite-tooltip__body")).toContainText(
        "游戏机实用技术",
    );
    await expect(popup.locator(".wiked-lite-tooltip__missing")).toHaveCount(0);

    await frame
        .locator("[data-reference^='<ref name=\":2\" details=']")
        .first()
        .hover();
    await expect(code).toHaveText(
        `{{URL|${gameUrl}|地球冒险3}}. 攻略人行道 :90-93`,
    );
    await expect(code.locator(".wiked-lite-token--template-name")).toHaveText(
        "URL",
    );
    await expect(popup.locator(".wiked-lite-tooltip__missing")).toHaveText(
        "The main reference was not found in the available source.",
    );
    await expect(popup).not.toContainText("阿修罗");
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("sub-reference popup highlights source without interpreting HTML or templates", async ({
    page,
}) => {
    const details =
        "&lt;img src=x onerror=alert(1)&gt; {{URL|javascript:alert(1)|unsafe}} " +
        "{{URL|https://example.org/|&lt;b&gt;safe label&lt;/b&gt;}} &quot;quoted&quot; <b>raw</b>";
    const source = `<ref name="Missing" details="${details}" />`;
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    await frame.locator("[data-reference]").first().hover();
    const popup = frame.locator(".wiked-lite-tooltip");
    await expect(popup.locator(".wiked-lite-tooltip__code")).toHaveText(
        details,
    );
    await expect(popup.locator("img, script, b")).toHaveCount(0);
    await expect(
        popup.locator('a[href="https://example.org/"]').first(),
    ).toBeVisible();
    expect(
        await popup
            .getByRole("link")
            .evaluateAll((links) =>
                links.every((link) =>
                    /^(?:https?:)?\//u.test(link.getAttribute("href") ?? ""),
                ),
            ),
    ).toBe(true);
    await expect(popup.locator(".wiked-lite-token--template-name")).toHaveCount(
        2,
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

for (const referenceEditing of [true, false]) {
    test(`duplicate citation parameters warn before their names with tooltip editing ${referenceEditing ? "enabled" : "disabled"}`, async ({
        page,
    }) => {
        const source =
            "<ref>{{Cite book|last1=Jackson|last1=Jason|title=Unique title}}</ref>";
        await page.route("https://example.test/**", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            }),
        );
        await page.goto("https://example.test/wiki/Sandbox");
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: {
                    ...createDefaultFormatterSettings(),
                    referenceEditing,
                },
            },
        );
        await mountEditor(page, source);
        const frame = page.frameLocator(".wiked-lite-frame");
        const anchor = frame
            .locator(".wiked-lite-editor [data-reference]")
            .first();
        const popup = frame.locator(".wiked-lite-tooltip");
        await anchor.hover();
        const warnings = popup.locator(".wiked-lite-tooltip__duplicate");
        await expect(warnings).toHaveCount(2);
        const duplicateKeys = popup
            .locator(".wiked-lite-tooltip__key")
            .filter({ hasText: /^last1$/u });
        await expect(duplicateKeys).toHaveCount(2);
        for (let index = 0; index < 2; index += 1) {
            await expect(warnings.nth(index)).toHaveAttribute(
                "title",
                "Duplicate parameter name “last1”",
            );
            await expect(warnings.nth(index)).toHaveAttribute("role", "img");
            await expect(warnings.nth(index)).toHaveAttribute(
                "aria-label",
                "Duplicate parameter name “last1”",
            );
            await expect(duplicateKeys.nth(index)).toHaveAttribute(
                "title",
                "Duplicate parameter name “last1”",
            );
            await expectTooltipIcon(warnings.nth(index), "cdxIconAlert");
            expect(
                await duplicateKeys.nth(index).evaluate((element) => {
                    const warning = element.querySelector(
                        ".wiked-lite-tooltip__duplicate",
                    )!;
                    const walker = element.ownerDocument.createTreeWalker(
                        element,
                        NodeFilter.SHOW_TEXT,
                    );
                    while (walker.nextNode() != null) {
                        if (
                            walker.currentNode.textContent?.trim() === "last1"
                        ) {
                            const range = element.ownerDocument.createRange();
                            range.selectNode(walker.currentNode);
                            return (
                                warning.getBoundingClientRect().right <=
                                range.getBoundingClientRect().left + 0.5
                            );
                        }
                    }
                    return false;
                }),
            ).toBe(true);
        }
        await expect(
            popup
                .locator(".wiked-lite-tooltip__key")
                .filter({ hasText: /^title$/u })
                .locator(".wiked-lite-tooltip__duplicate"),
        ).toHaveCount(0);
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
        const edits = popup.getByRole("button", {
            name: "Edit field 'last1'",
            exact: true,
        });
        await expect(edits).toHaveCount(referenceEditing ? 2 : 0);
        if (!referenceEditing) {
            return;
        }
        await edits.nth(1).click();
        const field = popup.getByRole("textbox", {
            name: "Edit field 'last1'",
            exact: true,
        });
        await expect(field).toHaveValue("Jason");
        await field.fill("Johnson");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("|last1=Jason", "|last1=Johnson"),
        );
        await anchor.hover();
        await expect(warnings).toHaveCount(2);
        await edits.first().click();
        await expect(field).toHaveValue("Jackson");
        await popup
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
    });
}

test("tooltip colors follow current host Codex tokens without changing syntax colors", async ({
    page,
}) => {
    const source =
        '<ref name="theme">{{Cite book|title=Theme title|last1=Jackson|last1=Jason}}</ref>\n' +
        '<ref name="theme" details="{{t|value}}" />';
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const editor = frame.locator(".wiked-lite-editor");
    const anchor = editor.locator("[data-reference*='details=']").first();
    const popup = frame.locator(".wiked-lite-tooltip");
    const readSyntaxColors = () =>
        editor.evaluate((element) => {
            const style = getComputedStyle(element);
            const template = element.querySelector(
                ".wiked-lite-token--template-name",
            )!;
            return {
                foreground: style.color,
                background: style.backgroundColor,
                template: getComputedStyle(template).color,
            };
        });
    const syntaxColors = await readSyntaxColors();
    const themes = [
        {
            "--color-base": "rgb(12, 34, 56)",
            "--color-subtle": "rgb(67, 89, 101)",
            "--color-emphasized": "rgb(23, 45, 67)",
            "--color-warning": "rgb(146, 85, 5)",
            "--color-progressive": "rgb(21, 96, 172)",
            "--color-link": "rgb(31, 106, 182)",
            "--background-color-base": "rgb(242, 246, 250)",
            "--background-color-progressive-subtle": "rgb(223, 231, 245)",
            "--border-color-base": "rgb(111, 122, 133)",
            "--border-color-progressive": "rgb(51, 116, 192)",
        },
        {
            "--color-base": "rgb(232, 224, 216)",
            "--color-subtle": "rgb(198, 187, 176)",
            "--color-emphasized": "rgb(252, 242, 232)",
            "--color-warning": "rgb(239, 180, 74)",
            "--color-progressive": "rgb(125, 182, 239)",
            "--color-link": "rgb(135, 192, 249)",
            "--background-color-base": "rgb(31, 35, 39)",
            "--background-color-progressive-subtle": "rgb(42, 53, 67)",
            "--border-color-base": "rgb(137, 126, 115)",
            "--border-color-progressive": "rgb(145, 202, 229)",
        },
    ];

    for (const [index, theme] of themes.entries()) {
        await page.evaluate((tokens) => {
            for (const [name, value] of Object.entries(tokens)) {
                document.documentElement.style.setProperty(name, value);
            }
        }, theme);
        await page.mouse.move(0, 0);
        await anchor.hover();
        await expect(popup).toHaveCSS("color", theme["--color-base"]);
        const surface = popup.locator(".wiked-lite-tooltip__surface");
        await expect(surface).toHaveCSS(
            "background-color",
            theme["--background-color-base"],
        );
        await expect(surface).toHaveCSS(
            "border-top-color",
            theme["--border-color-base"],
        );
        await expect(popup.locator(".wiked-lite-tooltip__tail")).toHaveCSS(
            "background-color",
            theme["--background-color-base"],
        );
        await expect(popup.locator(".wiked-lite-tooltip__title")).toHaveCSS(
            "color",
            theme["--color-emphasized"],
        );
        await expect(
            popup.locator(".wiked-lite-tooltip__key").first(),
        ).toHaveCSS("color", theme["--color-emphasized"]);
        await expect(
            popup.locator(".wiked-lite-tooltip__value").first(),
        ).toHaveCSS("color", syntaxColors.foreground);
        await expect(
            popup.locator(".wiked-lite-tooltip__duplicate").first(),
        ).toHaveCSS("color", theme["--color-warning"]);
        await expect(popup.locator(".wiked-lite-tooltip__title")).toHaveText(
            "Reference (theme)",
        );
        await expect(
            popup
                .locator(".wiked-lite-tooltip__citation-title")
                .getByRole("link"),
        ).toHaveCSS("color", theme["--color-link"]);
        const code = popup.locator(".wiked-lite-tooltip__code");
        await expect(code).toHaveCSS("color", syntaxColors.foreground);
        await expect(code).toHaveCSS(
            "background-color",
            syntaxColors.background,
        );
        await expect(
            code.locator(".wiked-lite-token--template-name"),
        ).toHaveCSS("color", syntaxColors.template);
        const edit = popup.getByRole("button", {
            name: "Edit field 'title'",
            exact: true,
        });
        await expect(edit).toHaveCSS("color", theme["--color-base"]);
        await expect(
            popup.getByRole("button", { name: "Add a new field", exact: true }),
        ).toHaveCSS("color", theme["--color-base"]);
        await edit.click();
        const field = popup.getByRole("textbox", {
            name: "Edit field 'title'",
            exact: true,
        });
        await expect(field).toHaveCSS("color", theme["--color-base"]);
        await expect(field).toHaveCSS(
            "background-color",
            theme["--background-color-base"],
        );
        await expect(field).toHaveCSS(
            "border-top-color",
            theme["--border-color-base"],
        );
        if (index > 0) {
            await expect(
                popup.getByRole("button", {
                    name: 'Restore original value "Theme title"',
                    exact: true,
                }),
            ).toHaveCSS("color", theme["--color-base"]);
        }
        await field.fill(`Themed edit ${index + 1}`);
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("Theme title", `Themed edit ${index + 1}`),
        );
        await anchor.hover();
        await expect(
            popup.locator(".wiked-lite-tooltip__value--modified"),
        ).toHaveCSS(
            "background-color",
            theme["--background-color-progressive-subtle"],
        );
        expect(await readSyntaxColors()).toEqual(syntaxColors);
        await editor.press("Escape");
        await expect(popup).toHaveCount(0);
    }
});

for (const lightweight of [false, true]) {
    test(`reference values retain raw wikitext and editor link colors (${lightweight ? "lightweight" : "normal"})`, async ({
        page,
    }) => {
        const source =
            '<ref name="palette">{{Cite book|title=[[Airi|艾莉]]|publisher=[[Present|Present label]]|url=https://example.org/article}}</ref>';
        await page.route("https://example.test/**", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            }),
        );
        await page.goto("https://example.test/wiki/Sandbox");
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: {
                    ...createDefaultFormatterSettings(),
                    referenceLightweightEditing: lightweight,
                    highlightMissing: true,
                },
            },
        );
        await page.setContent(
            '<form id="editform"><div id="p-cactions"></div><textarea id="wpTextbox1" name="wpTextbox1"></textarea></form>',
        );
        await page.locator("#wpTextbox1").fill(source);
        await installMediaWikiFixture(page, "examplewiki");
        await page.evaluate(() => {
            const opened: unknown[][] = [];
            (globalThis as any).__openedLinks = opened;
            window.open = (...args): null => {
                opened.push(args);
                return null;
            };
            const mediaWiki = (globalThis as any).mw;
            const get = mediaWiki.Api.prototype.get;
            mediaWiki.Api.prototype.get = async (
                parameters: Record<string, unknown>,
            ) => {
                if (parameters.prop !== "info") {
                    return get(parameters);
                }
                if (String(parameters.titles).includes("Later")) {
                    await new Promise<void>((resolve) => {
                        (globalThis as any).__releaseLaterLinkCheck = resolve;
                    });
                    return {
                        query: {
                            pages: [{ ns: 0, title: "Later", missing: true }],
                        },
                    };
                }
                return {
                    query: {
                        pages: [
                            { ns: 0, title: "Airi", missing: true },
                            { ns: 0, title: "Present", pageid: 2 },
                        ],
                    },
                };
            };
        });
        await page.addScriptTag({ path: gadgetArtifact });
        const frame = page.frameLocator(".wiked-lite-frame");
        const editor = frame.locator(".wiked-lite-editor");
        await expect(
            editor.locator(".wiked-lite-token--missing").first(),
        ).toBeVisible();
        await editor.locator("[data-reference]").first().hover();
        const popup = frame.locator(".wiked-lite-tooltip");
        const title = popup.locator(".wiked-lite-tooltip__value").first();
        await expect(title).toHaveText("[[Airi|艾莉]]");
        const alias = title.locator(".wiked-lite-token--link-text");
        await expect(alias).toHaveText("艾莉");
        await expect(alias).toHaveCSS("font-weight", "600");
        const missingColor = await editor
            .locator(".wiked-lite-token--missing")
            .first()
            .evaluate((element) => getComputedStyle(element).color);
        await expect(alias).toHaveCSS("color", missingColor);
        await expect(
            title
                .locator(".wiked-lite-token--link")
                .filter({ hasText: /^Airi$/u }),
        ).toHaveCSS("color", missingColor);
        const present = popup.locator(".wiked-lite-tooltip__value").nth(1);
        const presentAlias = present.locator(".wiked-lite-token--link-text");
        const normalColor = await editor
            .locator(".wiked-lite-token--link-text")
            .filter({ hasText: "Present label" })
            .evaluate((element) => getComputedStyle(element).color);
        await expect(presentAlias).toHaveCSS("color", normalColor);
        expect(normalColor).not.toBe(missingColor);
        const wikiLink = title.getByRole("link", {
            name: "Airi",
            exact: true,
        });
        const externalLink = popup
            .locator(".wiked-lite-tooltip__value")
            .getByRole("link", {
                name: "https://example.org/article",
                exact: true,
            });
        const expected: unknown[][] = [];
        for (const [link, href] of [
            [wikiLink, "https://example.test/wiki/Airi"],
            [externalLink, "https://example.org/article"],
        ] as const) {
            await expect(link).toHaveAttribute("href", href);
            await expect(link).toHaveAttribute("target", "_blank");
            await link.click();
            expect(await openedLinks(page)).toEqual(expected);
            for (const modifier of ["ctrlKey", "metaKey"] as const) {
                await link.evaluate((element, modifier) => {
                    element.ownerDocument.getSelection()?.removeAllRanges();
                    const options = {
                        bubbles: true,
                        cancelable: true,
                        button: 0,
                        detail: 1,
                        [modifier]: true,
                    };
                    element.dispatchEvent(new MouseEvent("mousedown", options));
                    element.dispatchEvent(new MouseEvent("click", options));
                }, modifier);
                expected.push([href, "_blank", "noopener,noreferrer"]);
                expect(await openedLinks(page)).toEqual(expected);
            }
        }
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
        await popup
            .getByRole("button", {
                name: "Edit field 'title'",
                exact: true,
            })
            .click();
        await popup
            .getByRole("textbox", { name: "Edit field 'title'", exact: true })
            .fill("[[Later|新标签]]");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(popup).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    () => typeof (globalThis as any).__releaseLaterLinkCheck,
                ),
            )
            .toBe("function");
        await page.evaluate(() =>
            (globalThis as any).__releaseLaterLinkCheck(),
        );
        await expect(
            popup
                .locator(".wiked-lite-tooltip__value")
                .first()
                .locator(".wiked-lite-token--link-text"),
        ).toHaveCSS("color", missingColor);
        await expect(popup).toBeVisible();
        await expect(popup).toBeFocused();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("[[Airi|艾莉]]", "[[Later|新标签]]"),
        );
    });
}

test("lightweight reference inspection edits values and names in place with keyboard commits", async ({
    page,
}) => {
    const source =
        '<ref name="inline">{{Cite web|title=Original|url=https://example.org/}}</ref>';
    await mountLightweightEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const anchor = frame.locator(".wiked-lite-editor [data-reference]").first();
    const popup = frame.locator(".wiked-lite-tooltip");
    await anchor.hover();
    const value = popup
        .locator(".wiked-lite-tooltip__value")
        .filter({ hasText: /^Original$/u });
    const edit = popup.getByRole("button", {
        name: "Edit field 'title'",
        exact: true,
    });
    await expect(edit).toHaveText("[✎]");
    await expect(edit.locator("svg, img")).toHaveCount(0);
    const rowActions = popup
        .locator(".wiked-lite-tooltip__actions")
        .first()
        .getByRole("button");
    await expect(rowActions).toHaveCount(2);
    await expect(rowActions.nth(0)).toHaveAccessibleName("Edit field 'title'");
    await expect(rowActions.nth(1)).toHaveAccessibleName(
        "Add a field after 'title'",
    );
    await expect(
        popup.locator(".wiked-lite-tooltip__value").getByRole("link"),
    ).toHaveAttribute("href", "https://example.org/");
    await value.click();
    await expect(popup.getByRole("textbox")).toHaveCount(0);
    await value.dblclick();
    await popup.locator(".wiked-lite-tooltip__key").first().dblclick();
    await expect(popup.getByRole("textbox")).toHaveCount(0);
    const displayedSource = await value.elementHandle();
    const displayedKey = await popup
        .locator(".wiked-lite-tooltip__key")
        .first()
        .elementHandle();
    expect(displayedSource).not.toBeNull();
    await edit.click();
    const input = popup.getByRole("textbox", {
        name: "Edit field 'title'",
        exact: true,
    });
    await expect(input).toHaveText("Original");
    await expect(edit).toBeHidden();
    await expectTooltipInlineSource(input);
    const name = popup.getByRole("textbox", {
        name: "Field name",
        exact: true,
    });
    await expect(name).toHaveText("title");
    await expectTooltipInlineSource(name);
    expect(
        await name.evaluate(
            (element, original) => element === original,
            displayedKey!,
        ),
    ).toBe(true);
    const group = popup.locator(".wiked-lite-tooltip__inline-editor");
    await expect(group).toHaveCount(1);
    await expect(group).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(group).toHaveCSS("text-decoration-line", "none");
    expect(
        await input.evaluate(
            (element, source) => element === source,
            displayedSource!,
        ),
    ).toBe(true);
    await expect(popup.locator("input, textarea")).toHaveCount(0);
    const inlineActions = popup.locator(
        ".wiked-lite-tooltip__edit-actions button",
    );
    await expect(inlineActions).toHaveText(["[×]", "[↶]", "[✓]"]);
    expect(
        await input.evaluate((element) =>
            element.nextElementSibling?.classList.contains(
                "wiked-lite-tooltip__edit-actions",
            ),
        ),
    ).toBe(true);
    await expect(popup.locator(".wiked-lite-tooltip__edit-actions")).toHaveCSS(
        "display",
        "inline",
    );
    for (const action of await inlineActions.all()) {
        await expect(action).toHaveCSS("border-top-width", "0px");
        await expect(action).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
    const reset = inlineActions.nth(1);
    await expect(reset).toBeDisabled();
    await input.fill("Draft");
    await name.fill("draft-name");
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(input).toHaveText("Original");
    await expect(name).toHaveText("title");
    await expect(reset).toBeDisabled();
    await name.fill("discarded");
    await input.fill("Discarded draft");
    await input.press("Escape");
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await expect(popup.getByRole("textbox")).toHaveCount(0);
    await expect(edit).toBeFocused();
    await edit.press("Enter");
    await expect(name).toHaveText("title");
    await expect(input).toHaveText("Original");
    await expect(
        popup.locator(
            ".wiked-lite-tooltip__row .wiked-lite-tooltip__inline-editor",
        ),
    ).toHaveCount(1);
    await input.fill("First");
    await input.press("Shift+Enter");
    await input.pressSequentially("Second");
    await expect(input).toHaveText("First\nSecond", { useInnerText: true });
    await input.press("Enter");
    const changed = source.replace("title=Original", "title=First\nSecond");
    await expect(page.locator("#wpTextbox1")).toHaveValue(changed);
    await anchor.hover();
    await edit.press("Space");
    await expect(name).toHaveText("title");
    await expectTooltipInlineSource(name);
    await name.fill("url");
    await name.press("Enter");
    await expect(popup.getByRole("alert")).toHaveText(
        "Enter a valid, unused field name and a well-formed wikitext value.",
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(changed);
    await name.fill("caption");
    await input.fill("First\nUpdated together");
    await name.press("Enter");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        changed.replace(
            "|title=First\nSecond",
            "|caption=First\nUpdated together",
        ),
    );
    await anchor.hover();
    await popup
        .getByRole("button", { name: "Edit field 'caption'", exact: true })
        .click();
    await popup
        .getByRole("button", {
            name: 'Restore original value "Original"',
            exact: true,
        })
        .click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("lightweight add buttons insert after a field or before the first field on commit", async ({
    page,
}) => {
    const source = "<ref>{{Cite book|title=Book}}</ref>";
    await mountLightweightEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const anchor = frame.locator(".wiked-lite-editor [data-reference]").first();
    const popup = frame.locator(".wiked-lite-tooltip");
    await anchor.hover();
    const before = popup.getByRole("button", {
        name: "Add a field after 'title'",
        exact: true,
    });
    await expect(before).toHaveText("[+]");
    await before.click();
    await expect(
        popup.locator(".wiked-lite-tooltip__inline-draft"),
    ).toHaveCount(1);
    const name = popup.getByRole("textbox", {
        name: "Field name",
        exact: true,
    });
    const value = popup.getByRole("textbox", {
        name: "Field value",
        exact: true,
    });
    await expect(name).toHaveText("");
    await expect(value).toHaveText("");
    await expectTooltipInlineSource(name);
    await expectTooltipInlineSource(value);
    await expect(popup.locator("input, textarea")).toHaveCount(0);
    const reset = popup.getByRole("button", { name: "Reset", exact: true });
    await expect(reset).toHaveText("[↶]");
    await expect(reset).toBeDisabled();
    await name.fill("draft");
    await value.fill("discard");
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(name).toHaveText("");
    await expect(value).toHaveText("");
    await expect(reset).toBeDisabled();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await value.fill("Draft publisher");
    await value.press("Enter");
    await expect(popup.getByRole("alert")).toBeVisible();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await name.fill("publisher");
    await value.press("Enter");
    const inserted =
        "<ref>{{Cite book|title=Book|publisher=Draft publisher}}</ref>";
    await expect(page.locator("#wpTextbox1")).toHaveValue(inserted);
    await anchor.hover();
    const append = popup.getByRole("button", {
        name: "Add a new field",
        exact: true,
    });
    await expect(append).toHaveText("[+]");
    await append.click();
    await name.fill("year");
    await value.fill("2026");
    await value.press("Escape");
    await expect(
        popup.locator(".wiked-lite-tooltip__inline-draft"),
    ).toHaveCount(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue(inserted);
    await append.click();
    await name.fill("year");
    await value.fill("2026");
    await value.press("Enter");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        inserted.replace("|title=Book", "|year=2026|title=Book"),
    );
});

test("lightweight note and sub-reference content edit in place and Escape cancels", async ({
    page,
}) => {
    const source =
        '<ref name="note">Original note.</ref>\n<ref name="note" details="p. 1" />';
    await mountLightweightEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const popup = frame.locator(".wiked-lite-tooltip");
    await frame
        .locator(".wiked-lite-editor [data-reference*='details=']")
        .first()
        .hover();
    await expect(popup.locator(".wiked-lite-tooltip__title")).toHaveText(
        "Reference (note)",
    );
    await expect(
        popup.locator(".wiked-lite-tooltip__citation-title"),
    ).toContainText("Reference content");
    await popup
        .getByRole("button", {
            name: "Edit sub-reference content",
            exact: true,
        })
        .click();
    const details = popup.getByRole("textbox", {
        name: "Edit sub-reference content",
        exact: true,
    });
    await expectTooltipInlineSource(details);
    await details.fill("discard");
    await details.press("Escape");
    await expect(popup.locator(".wiked-lite-tooltip__code")).toHaveText("p. 1");
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await popup
        .getByRole("button", {
            name: "Edit sub-reference content",
            exact: true,
        })
        .click();
    await details.fill("p. 2");
    await details.press("Enter");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source.replace("p. 1", "p. 2"),
    );
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    await popup
        .getByRole("button", { name: "Edit reference content", exact: true })
        .click();
    const note = popup.getByRole("textbox", {
        name: "Edit reference content",
        exact: true,
    });
    await expectTooltipInlineSource(note);
    await note.fill("Updated note.");
    await note.press("Enter");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source
            .replace("p. 1", "p. 2")
            .replace("Original note.", "Updated note."),
    );
});

test("lightweight source keeps literal HTML as text and waits for IME completion", async ({
    page,
}) => {
    const source = '<ref name="note">Original note.</ref>';
    const replacement = "<b>literal</b> & 中文";
    await mountLightweightEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    const popup = frame.locator(".wiked-lite-tooltip");
    await popup
        .getByRole("button", { name: "Edit reference content", exact: true })
        .click();
    const note = popup.getByRole("textbox", {
        name: "Edit reference content",
        exact: true,
    });
    await note.fill(replacement);
    await expect(note).toHaveText(replacement);
    await expect(note.locator("b")).toHaveCount(0);
    await note.dispatchEvent("compositionstart");
    for (const key of ["Enter", "Escape"]) {
        await note.dispatchEvent("keydown", {
            key,
            code: key,
            isComposing: true,
        });
        await expect(note).toBeVisible();
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    }
    await note.dispatchEvent("compositionend");
    await note.press("Enter");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source.replace("Original note.", replacement),
    );
    await expect(popup.locator(".wiked-lite-tooltip__note")).toHaveText(
        replacement,
    );
    await expect(popup.locator("b, img, script")).toHaveCount(0);
});

for (const entry of [
    "trailing newlines",
    "multiline insertion",
    "delete everything",
]) {
    test(`lightweight source preserves exact text after ${entry}`, async ({
        page,
    }) => {
        const source = "<ref>Original note.</ref>";
        await mountLightweightEditor(page, source);
        const frame = page.frameLocator(".wiked-lite-frame");
        await frame
            .locator(".wiked-lite-editor [data-reference]")
            .first()
            .hover();
        const popup = frame.locator(".wiked-lite-tooltip");
        await popup
            .getByRole("button", {
                name: "Edit reference content",
                exact: true,
            })
            .click();
        const note = popup.getByRole("textbox", {
            name: "Edit reference content",
            exact: true,
        });
        let replacement = "";
        if (entry === "delete everything") {
            await note.press("ControlOrMeta+A");
            await note.press("Backspace");
        } else if (entry === "multiline insertion") {
            replacement = "A\nB\n";
            await note.fill(replacement);
        } else {
            replacement = "First\nSecond\n\n";
            await note.fill("First");
            await note.press("Shift+Enter");
            await note.pressSequentially("Second");
            await note.press("Shift+Enter");
            await note.press("Shift+Enter");
        }
        await note.press("Enter");
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            `<ref>${replacement}</ref>`,
        );
    });
}

test("tooltip field edits target the hovered duplicate reference and support undo", async ({
    page,
}) => {
    const reference = "<ref>{{Cite web|title=Original title}}</ref>";
    const separator = "\n".repeat(10);
    const source = `${reference}${separator}${reference}`;
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const editor = frame.locator(".wiked-lite-editor");
    const references = editor.locator("[data-reference]");
    const popup = frame.locator(".wiked-lite-tooltip");

    await references.first().hover();
    await expect(popup).toBeVisible();
    await references.last().hover();
    const pencil = popup.getByRole("button", {
        name: "Edit field 'title'",
        exact: true,
    });
    await expectTooltipIcon(pencil, "cdxIconEdit");
    await expect(pencil).toHaveAttribute("title", "Edit field 'title'");
    const valueBounds = await popup
        .locator(".wiked-lite-tooltip__value")
        .boundingBox();
    const pencilBounds = await pencil.boundingBox();
    expect(valueBounds).not.toBeNull();
    expect(pencilBounds).not.toBeNull();
    expect(pencilBounds!.x).toBeGreaterThanOrEqual(
        valueBounds!.x + valueBounds!.width,
    );
    const addAfter = popup.getByRole("button", {
        name: "Add a field after 'title'",
        exact: true,
    });
    await expectTooltipIcon(addAfter, "cdxIconAdd");
    const addBounds = await addAfter.boundingBox();
    expect(addBounds).not.toBeNull();
    expect(addBounds!.x).toBeGreaterThanOrEqual(
        valueBounds!.x + valueBounds!.width,
    );
    await pencil.click();
    const field = popup.getByRole("textbox", {
        name: "Edit field 'title'",
        exact: true,
    });
    await expect(field).toHaveValue("Original title");
    await expectTooltipTextarea(field);
    const nameInput = popup.getByRole("textbox", {
        name: "Field name",
        exact: true,
    });
    await expect(nameInput).toHaveValue("title");
    await expect(field).toBeFocused();
    expect(
        await field.evaluate((element) => {
            const input = element as HTMLTextAreaElement;
            return [input.selectionStart, input.selectionEnd];
        }),
    ).toEqual([0, "Original title".length]);
    const resetDraft = popup.getByRole("button", {
        name: 'Restore original value "Original title"',
        exact: true,
    });
    await expect(resetDraft).toBeDisabled();
    await nameInput.fill("caption");
    await expect(resetDraft).toBeEnabled();
    await resetDraft.click();
    await expect(nameInput).toHaveValue("title");
    await expect(resetDraft).toBeDisabled();
    await field.fill("Changed | title {{lang|en|word}} [[Target|label]]");
    await popup.getByRole("button", { name: "Save", exact: true }).click();

    const editedReference = reference.replace(
        "Original title",
        "Changed {{!}} title {{lang|en|word}} [[Target|label]]",
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        `${reference}${separator}${editedReference}`,
    );
    expect(
        await page
            .locator("#editform")
            .evaluate((form) =>
                new FormData(form as HTMLFormElement).get("wpTextbox1"),
            ),
    ).toBe(`${reference}${separator}${editedReference}`);
    await expect(popup).toBeVisible();
    await expect(popup).toBeFocused();
    await expect(popup.locator(".wiked-lite-tooltip__value")).toContainText(
        "Changed",
    );
    await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("normal citation forms edit name and value together and mark only changed parts", async ({
    page,
}) => {
    const source = "<ref>{{Cite book|title=Original}}</ref>";
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const anchor = frame.locator(".wiked-lite-editor [data-reference]").first();
    const popup = frame.locator(".wiked-lite-tooltip");
    await anchor.hover();
    await popup
        .getByRole("button", { name: "Edit field 'title'", exact: true })
        .click();
    const actions = popup.locator(".wiked-lite-tooltip__edit-actions button");
    await expect(actions).toHaveCount(3);
    await expect(actions.nth(0)).toHaveText("Cancel");
    await expect(actions.nth(1)).toContainText("Reset");
    await expect(actions.nth(2)).toHaveText("Save");
    await popup
        .getByRole("textbox", { name: "Field name", exact: true })
        .fill("caption");
    await actions.nth(2).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source.replace("|title=", "|caption="),
    );
    await anchor.hover();
    await expect(
        popup.locator(".wiked-lite-tooltip__key--modified"),
    ).toHaveText("caption");
    await expect(
        popup.locator(".wiked-lite-tooltip__value--modified"),
    ).toHaveCount(0);
    await popup
        .getByRole("button", { name: "Edit field 'caption'", exact: true })
        .click();
    await popup
        .getByRole("textbox", { name: "Edit field 'caption'", exact: true })
        .fill("Changed");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{Cite book|caption=Changed}}</ref>",
    );
    await anchor.hover();
    await expect(
        popup.locator(".wiked-lite-tooltip__key--modified"),
    ).toHaveText("caption");
    await expect(
        popup.locator(".wiked-lite-tooltip__value--modified"),
    ).toHaveText("Changed");
});

test("empty citation templates retain their heading and accept a first field", async ({
    page,
}) => {
    await mountEditor(page, "<ref>{{Cite web}}</ref>");
    const frame = page.frameLocator(".wiked-lite-frame");
    const popup = frame.locator(".wiked-lite-tooltip");
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    await expect(popup.locator(".wiked-lite-tooltip__title")).toHaveText(
        "Reference",
    );
    await expect(
        popup.locator(".wiked-lite-tooltip__citation-title"),
    ).toContainText("{{Cite web}}");
    await popup
        .getByRole("button", { name: "Add a new field", exact: true })
        .click();
    await popup
        .getByRole("textbox", { name: "Field name", exact: true })
        .fill("title");
    await popup
        .getByRole("textbox", { name: "Field value", exact: true })
        .fill("First title");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{Cite web|title=First title}}</ref>",
    );
    await expect(popup.locator(".wiked-lite-tooltip__value")).toHaveText(
        "First title",
    );
});

for (const lightweight of [false, true]) {
    test(`Save and Reset keep a reused reference open with fresh fields (${lightweight ? "lightweight" : "normal"})`, async ({
        page,
    }) => {
        const source =
            '<ref name="shared">{{Cite web|title=Original}}</ref>' +
            "\n".repeat(8) +
            '<ref name="shared" details="p. 7" />';
        if (lightweight) {
            await mountLightweightEditor(page, source);
        } else {
            await mountEditor(page, source);
        }
        const frame = page.frameLocator(".wiked-lite-frame");
        const popup = frame.locator(".wiked-lite-tooltip");
        await frame
            .locator(".wiked-lite-editor [data-reference*='details=']")
            .first()
            .hover();
        const openTitle = async (): Promise<void> => {
            await popup
                .getByRole("button", {
                    name: "Edit field 'title'",
                    exact: true,
                })
                .click();
        };
        await openTitle();
        await popup
            .getByRole("textbox", { name: "Edit field 'title'", exact: true })
            .fill("A substantially longer title");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("Original", "A substantially longer title"),
        );
        await expect(popup).toBeVisible();
        await expect(popup).toBeFocused();
        await expect(popup.locator(".wiked-lite-tooltip__code")).toHaveText(
            "p. 7",
        );
        await expect(popup.locator(".wiked-lite-tooltip__value")).toHaveText(
            "A substantially longer title",
        );
        await openTitle();
        await popup
            .getByRole("button", {
                name: 'Restore original value "Original"',
                exact: true,
            })
            .click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
        await expect(popup).toBeVisible();
        await expect(popup).toBeFocused();
        await expect(popup.locator(".wiked-lite-tooltip__code")).toHaveText(
            "p. 7",
        );
        await expect(popup.locator(".wiked-lite-tooltip__value")).toHaveText(
            "Original",
        );
        await openTitle();
        const title = popup.getByRole("textbox", {
            name: "Edit field 'title'",
            exact: true,
        });
        if (lightweight) {
            await expect(title).toHaveText("Original");
        } else {
            await expect(title).toHaveValue("Original");
        }
    });
}

test("modified tooltip fields retain their original value for reset and history", async ({
    page,
}) => {
    const source = "<ref>{{Cite web|title=Original title}}</ref>";
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const editor = frame.locator(".wiked-lite-editor");
    const popup = frame.locator(".wiked-lite-tooltip");
    const modified = popup.locator(".wiked-lite-tooltip__value--modified");
    const edit = popup.getByRole("button", {
        name: "Edit field 'title'",
        exact: true,
    });
    const restore = popup.getByRole("button", {
        name: 'Restore original value "Original title"',
        exact: true,
    });
    await editor.locator("[data-reference]").first().hover();
    await expect(modified).toHaveCount(0);
    await expect(restore).toHaveCount(0);

    for (const title of ["First revision", "Second revision"]) {
        await edit.click();
        if (title === "Second revision") {
            await expectTooltipIcon(restore, "cdxIconUndo");
            await expect(restore).toHaveAttribute(
                "title",
                'Restore original value "Original title"',
            );
        } else {
            await expect(restore).toBeDisabled();
        }
        await popup
            .getByRole("textbox", { name: "Edit field 'title'", exact: true })
            .fill(title);
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("Original title", title),
        );
        await editor.locator("[data-reference]").first().hover();
        await expect(modified).toHaveCount(1);
        expect(
            await modified.evaluate(
                (element) => getComputedStyle(element).backgroundColor,
            ),
        ).not.toBe("rgba(0, 0, 0, 0)");
        await expect(restore).toHaveCount(0);
        await expectTooltipIcon(edit, "cdxIconEditUndo");
    }

    await edit.click();
    await expectTooltipIcon(restore, "cdxIconUndo");
    await restore.click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await editor.locator("[data-reference]").first().hover();
    await expect(modified).toHaveCount(0);
    await expect(restore).toHaveCount(0);
    await expectTooltipIcon(edit, "cdxIconEdit");
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await editor.press(`${modifier}+z`);
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source.replace("Original title", "Second revision"),
    );
    await editor.locator("[data-reference]").first().hover();
    await expect(modified).toHaveCount(1);
    await expect(restore).toHaveCount(0);
    await expectTooltipIcon(edit, "cdxIconEditUndo");
    await edit.click();
    await expectTooltipIcon(restore, "cdxIconUndo");
    await popup.getByRole("button", { name: "Cancel", exact: true }).click();
    await editor.press(`${modifier}+Shift+z`);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await editor.locator("[data-reference]").first().hover();
    await expect(modified).toHaveCount(0);
    await expect(restore).toHaveCount(0);
});

test("tooltip field edits keep paired names separate and retain complete archive URLs", async ({
    page,
}) => {
    const originalUrl = "https://example.org/a-long-article";
    const archiveUrl = `https://web.archive.org/web/20200101000000/${originalUrl}`;
    const replacementArchiveUrl = `https://web.archive.org/web/20250927000000/${originalUrl}`;
    let source =
        `<ref>{{Cite web|first=Jane|last=Doe|title=Article|url=${originalUrl}` +
        `|archive-url=${archiveUrl}}}</ref>`;
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const popup = frame.locator(".wiked-lite-tooltip");

    for (const [name, original, replacement] of [
        ["first", "Jane", "Janet"],
        ["last", "Doe", "Smith"],
        ["archive-url", archiveUrl, replacementArchiveUrl],
    ] as const) {
        await frame
            .locator(".wiked-lite-editor [data-reference]")
            .first()
            .hover();
        await popup
            .getByRole("button", { name: `Edit field '${name}'`, exact: true })
            .click();
        const field = popup.getByRole("textbox", {
            name: `Edit field '${name}'`,
            exact: true,
        });
        await expect(field).toHaveValue(original);
        await field.fill(replacement);
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        source = source.replace(
            `|${name}=${original}`,
            `|${name}=${replacement}`,
        );
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    }
});

test("tooltip field editors trim displayed values and preserve multiline template spacing", async ({
    page,
}) => {
    const source = "<ref>{{Cite web\n| 1= xxx\n| 2= yyy\n}}</ref>";
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    const popup = frame.locator(".wiked-lite-tooltip");
    await popup
        .getByRole("button", { name: "Edit field '1'", exact: true })
        .click();
    const field = popup.getByRole("textbox", {
        name: "Edit field '1'",
        exact: true,
    });
    await expect(field).toHaveValue("xxx");
    await field.fill("changed");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{Cite web\n| 1= changed\n| 2= yyy\n}}</ref>",
    );
});

test("tooltip details edits preserve quoted attributes and render entered HTML as text", async ({
    page,
}) => {
    const source =
        '<ref name="book">A plain book note.</ref>\n' +
        '<ref name="book" details="pp. 1–2" />';
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const popup = frame.locator(".wiked-lite-tooltip");
    const subReference = frame.locator(
        ".wiked-lite-editor [data-reference*='details=']",
    );
    await subReference.first().hover();
    await popup
        .getByRole("button", {
            name: "Edit sub-reference content",
            exact: true,
        })
        .click();
    const field = popup.getByRole("textbox", {
        name: "Edit sub-reference content",
        exact: true,
    });
    await expect(field).toHaveValue("pp. 1–2");
    await expectTooltipTextarea(field);
    const details = `He said "yes" and 'no'. | <b>raw</b> {{t|x=y}}`;
    await field.fill(details);
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    const encodedDetails = details.replaceAll('"', "&quot;");
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        source.replace("pp. 1–2", encodedDetails),
    );
    await subReference.first().hover();
    await expect(popup.locator(".wiked-lite-tooltip__code")).toHaveText(
        encodedDetails,
    );
    await expect(popup.locator("b, img, script")).toHaveCount(0);
    await expect(
        popup.locator(".wiked-lite-tooltip__details--modified"),
    ).toHaveCount(1);
    await popup
        .getByRole("button", {
            name: "Edit sub-reference content",
            exact: true,
        })
        .click();
    await popup
        .getByRole("button", {
            name: 'Restore original value "pp. 1–2"',
            exact: true,
        })
        .click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("tooltip note edits support Save, Cancel, and Escape", async ({
    page,
}) => {
    const source = '<ref name="note">Plain explanatory note.</ref>';
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const editor = frame.locator(".wiked-lite-editor");
    const popup = frame.locator(".wiked-lite-tooltip");

    for (const cancellation of ["button", "Escape"]) {
        await editor.locator("[data-reference]").first().hover();
        await popup
            .getByRole("button", {
                name: "Edit reference content",
                exact: true,
            })
            .click();
        const field = popup.getByRole("textbox", {
            name: "Edit reference content",
            exact: true,
        });
        await expect(field).toHaveValue("Plain explanatory note.");
        await expectTooltipTextarea(field);
        await field.fill("Discard this draft.");
        if (cancellation === "button") {
            await popup
                .getByRole("button", { name: "Cancel", exact: true })
                .click();
        } else {
            await field.press("Escape");
        }
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
        await editor.press("Escape");
        await expect(popup).toHaveCount(0);
    }
    await editor.locator("[data-reference]").first().hover();
    await popup
        .getByRole("button", { name: "Edit reference content", exact: true })
        .click();
    await popup
        .getByRole("textbox", { name: "Edit reference content", exact: true })
        .fill("Updated note | with {{t|value}}.");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    const updatedSource = source.replace(
        "Plain explanatory note.",
        "Updated note | with {{t|value}}.",
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(updatedSource);
    await editor.locator("[data-reference]").first().hover();
    await expect(
        popup.locator(".wiked-lite-tooltip__note--modified"),
    ).toHaveCount(1);
    await popup
        .getByRole("button", { name: "Edit reference content", exact: true })
        .click();
    await popup
        .getByRole("button", {
            name: 'Restore original value "Plain explanatory note."',
            exact: true,
        })
        .click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("malformed citation tooltips edit their raw reference content", async ({
    page,
}) => {
    const source = "<ref>{{cite web|title=broken</ref>";
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    const anchor = frame.locator(".wiked-lite-editor [data-reference]").first();
    const popup = frame.locator(".wiked-lite-tooltip");
    await anchor.hover();
    await expect(
        popup.getByRole("button", { name: "Edit field 'title'", exact: true }),
    ).toHaveCount(0);
    await popup
        .getByRole("button", { name: "Edit reference content", exact: true })
        .click();
    const field = popup.getByRole("textbox", {
        name: "Edit reference content",
        exact: true,
    });
    await expect(field).toHaveValue("{{cite web|title=broken");
    await field.fill("{{cite web|title=Repaired}}");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{cite web|title=Repaired}}</ref>",
    );
    await anchor.hover();
    await expect(
        popup.getByRole("button", { name: "Edit field 'title'", exact: true }),
    ).toBeVisible();
});

for (const scenario of [
    {
        field: "content",
        editLabel: "Edit reference content",
        source: '<ref name="note">Original note.</ref>',
        original: "Original note.",
        anchor: "[data-reference]",
        modifiedClass: "wiked-lite-tooltip__note--modified",
    },
    {
        field: "details",
        editLabel: "Edit sub-reference content",
        source:
            '<ref name="book">{{Cite book|title=Book title}}</ref>\n' +
            '<ref name="book" details="pp. 1–2" />',
        original: "pp. 1–2",
        anchor: "[data-reference*='details=']",
        modifiedClass: "wiked-lite-tooltip__details--modified",
    },
]) {
    test(`cleared tooltip ${scenario.field} remains editable and can restore its original value`, async ({
        page,
    }) => {
        await mountEditor(page, scenario.source);
        const frame = page.frameLocator(".wiked-lite-frame");
        const anchor = frame
            .locator(`.wiked-lite-editor ${scenario.anchor}`)
            .first();
        const popup = frame.locator(".wiked-lite-tooltip");
        const edit = popup.getByRole("button", {
            name: scenario.editLabel,
            exact: true,
        });
        const field = popup.getByRole("textbox", {
            name: scenario.editLabel,
            exact: true,
        });
        await anchor.hover();
        await edit.click();
        await field.fill("");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        const clearedSource = scenario.source.replace(scenario.original, "");
        await expect(page.locator("#wpTextbox1")).toHaveValue(clearedSource);
        await anchor.hover();
        await expect(popup.locator(`.${scenario.modifiedClass}`)).toHaveCount(
            1,
        );
        await edit.click();
        await expect(field).toHaveValue("");
        await expectTooltipTextarea(field);
        await popup
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(clearedSource);
        await anchor.hover();
        await edit.click();
        await popup
            .getByRole("button", {
                name: `Restore original value "${scenario.original}"`,
                exact: true,
            })
            .click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(scenario.source);
    });
}

test("tooltip drafts close on external source changes and cannot apply stale edits", async ({
    page,
}) => {
    const source = "<ref>{{Cite web|title=Original title}}</ref>";
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    const popup = frame.locator(".wiked-lite-tooltip");
    await popup
        .getByRole("button", { name: "Edit field 'title'", exact: true })
        .click();
    await popup
        .getByRole("textbox", { name: "Edit field 'title'", exact: true })
        .fill("Stale draft");
    const staleApply = await popup
        .getByRole("button", { name: "Save", exact: true })
        .elementHandle();
    expect(staleApply).not.toBeNull();
    const changedSource = source.replace("Original title", "External update");
    await page.locator("#wpTextbox1").evaluate((element, source) => {
        (element as HTMLTextAreaElement).value = source;
        element.dispatchEvent(new Event("input", { bubbles: true }));
    }, changedSource);
    await expect(popup).toHaveCount(0);
    await expect(frame.locator(".wiked-lite-editor")).toHaveText(changedSource);
    await staleApply!.evaluate((element) =>
        (element as HTMLButtonElement).click(),
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(changedSource);
});

for (const draft of ["edit", "add"] as const) {
    for (const dismissal of ["cancel", "replace", "teardown"] as const) {
        test(`detached ${draft} Save cannot change unchanged source after ${dismissal}`, async ({
            page,
        }) => {
            const source = "<ref>{{Cite web|title=Original title}}</ref>";
            await mountEditor(page, source);
            const frame = page.frameLocator(".wiked-lite-frame");
            const popup = frame.locator(".wiked-lite-tooltip");
            await frame
                .locator(".wiked-lite-editor [data-reference]")
                .first()
                .hover();
            await popup
                .getByRole("button", {
                    name:
                        draft === "edit"
                            ? "Edit field 'title'"
                            : "Add a new field",
                    exact: true,
                })
                .click();
            if (draft === "add") {
                await popup
                    .getByRole("textbox", { name: "Field name", exact: true })
                    .fill("publisher");
            }
            await popup
                .getByRole("textbox", {
                    name:
                        draft === "edit" ? "Edit field 'title'" : "Field value",
                    exact: true,
                })
                .fill("Discarded draft");
            await popup
                .getByRole("button", { name: "Save", exact: true })
                .evaluate((element) => {
                    (
                        element.ownerDocument.defaultView!.parent as any
                    ).__detachedSave = element;
                });
            if (dismissal === "cancel") {
                await popup
                    .getByRole("button", { name: "Cancel", exact: true })
                    .click();
            } else if (dismissal === "replace") {
                await popup
                    .getByRole("button", {
                        name:
                            draft === "edit"
                                ? "Add a new field"
                                : "Edit field 'title'",
                        exact: true,
                    })
                    .click();
            } else {
                await page.locator("#wpTextbox1").evaluate((element) => {
                    element.before(element.ownerDocument.createElement("div"));
                });
                await expect(page.locator(".wiked-lite-frame")).toHaveCount(0);
            }
            await expect(page.locator("#wpTextbox1")).toHaveValue(source);
            await page.evaluate(() => {
                const save = (globalThis as any)
                    .__detachedSave as HTMLButtonElement;
                if (save.isConnected) {
                    throw new Error(
                        "The discarded Save button is still attached.",
                    );
                }
                save.click();
            });
            await expect(page.locator("#wpTextbox1")).toHaveValue(source);
            if (dismissal === "replace") {
                await expect(
                    popup.getByRole("button", { name: "Save", exact: true }),
                ).toBeVisible();
            }
        });
    }
}

test("tooltip drafts survive background link checks until the edit closes", async ({
    page,
}) => {
    const source =
        "[[Missing article]] <ref>{{Cite web|title=Original title}}</ref>";
    await page.route("https://example.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                highlightMissing: true,
            },
        },
    );
    await page.setContent(
        '<form id="editform"><div id="p-cactions"></div>' +
            '<textarea id="wpTextbox1" name="wpTextbox1"></textarea></form>',
    );
    await page.locator("#wpTextbox1").fill(source);
    await installMediaWikiFixture(page, "examplewiki");
    await page.evaluate(() => {
        const mediaWiki = (globalThis as any).mw;
        const get = mediaWiki.Api.prototype.get;
        (globalThis as any).__linkRequests = 0;
        mediaWiki.Api.prototype.get = async (
            parameters: Record<string, unknown>,
        ) => {
            if (parameters.prop !== "info") {
                return get(parameters);
            }
            (globalThis as any).__linkRequests += 1;
            await new Promise<void>((resolve) => {
                (globalThis as any).__releaseLinkCheck = resolve;
            });
            return {
                query: {
                    pages: [{ ns: 0, title: "Missing article", missing: true }],
                },
            };
        };
    });
    try {
        await page.addScriptTag({ path: gadgetArtifact });
        await expect
            .poll(() => page.evaluate(() => (globalThis as any).__linkRequests))
            .toBe(1);
        const frame = page.frameLocator(".wiked-lite-frame");
        const editor = frame.locator(".wiked-lite-editor");
        await editor.locator("[data-reference]").first().hover();
        const popup = frame.locator(".wiked-lite-tooltip");
        await popup
            .getByRole("button", { name: "Edit field 'title'", exact: true })
            .click();
        const field = popup.getByRole("textbox", {
            name: "Edit field 'title'",
            exact: true,
        });
        await field.fill("Draft kept during lookup");
        await page.evaluate(() => (globalThis as any).__releaseLinkCheck());
        await page.waitForTimeout(150);
        await expect(field).toBeFocused();
        await expect(field).toHaveValue("Draft kept during lookup");
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
        await popup
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        await expect(editor.locator(".wiked-lite-token--missing")).toHaveText(
            "Missing article",
        );
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    } finally {
        await page.evaluate(() => (globalThis as any).__releaseLinkCheck?.());
    }
});

test("tooltip citations add fields from the heading or after existing fields and reject duplicates", async ({
    page,
}) => {
    const source = "<ref>{{Cite web|title=Original title}}</ref>";
    await mountEditor(page, source);
    const frame = page.frameLocator(".wiked-lite-frame");
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    const popup = frame.locator(".wiked-lite-tooltip");
    const add = popup.getByRole("button", {
        name: "Add a new field",
        exact: true,
    });
    await expectTooltipIcon(add, "cdxIconAdd");
    await add.click();
    const name = popup.getByRole("textbox", {
        name: "Field name",
        exact: true,
    });
    const value = popup.getByRole("textbox", {
        name: "Field value",
        exact: true,
    });
    await expectTooltipTextarea(value);
    await name.fill("title");
    await value.fill("New | publisher {{lang|en|name}} [[Publisher|label]]");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(popup.getByRole("alert")).toHaveText(
        "Enter a valid, unused field name and a well-formed wikitext value.",
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    await name.fill("publisher");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{Cite web|publisher=New {{!}} publisher {{lang|en|name}} [[Publisher|label]]|title=Original title}}</ref>",
    );
    await expect(popup).toBeVisible();
    await expect(popup).toBeFocused();
    await expect(popup.getByRole("textbox")).toHaveCount(0);
    const addAfter = popup.getByRole("button", {
        name: "Add a field after 'title'",
        exact: true,
    });
    await expectTooltipIcon(addAfter, "cdxIconAdd");
    await addAfter.click();
    await popup
        .getByRole("textbox", { name: "Field name", exact: true })
        .fill("author");
    await popup
        .getByRole("textbox", { name: "Field value", exact: true })
        .fill("Jane Doe");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{Cite web|publisher=New {{!}} publisher {{lang|en|name}} [[Publisher|label]]|title=Original title|author=Jane Doe}}</ref>",
    );
    await frame.locator(".wiked-lite-editor [data-reference]").first().hover();
    await expect(
        popup.locator(".wiked-lite-tooltip__value--modified"),
    ).toHaveCount(2);
    const removePublisher = popup.getByRole("button", {
        name: "Remove added field 'publisher'",
        exact: true,
    });
    await expect(removePublisher).toHaveCount(0);
    const editPublisher = popup.getByRole("button", {
        name: "Edit field 'publisher'",
        exact: true,
    });
    await expectTooltipIcon(editPublisher, "cdxIconEditUndo");
    await editPublisher.click();
    await expectTooltipIcon(removePublisher, "cdxIconUndo");
    await expect(removePublisher).toHaveAttribute(
        "title",
        "Remove added field 'publisher'",
    );
    await removePublisher.click();
    await expect(page.locator("#wpTextbox1")).toHaveValue(
        "<ref>{{Cite web|title=Original title|author=Jane Doe}}</ref>",
    );
});

for (const lightweight of [false, true]) {
    test(`section tooltip fields from full-page source are unavailable while local details remain editable (${lightweight ? "lightweight" : "normal"})`, async ({
        page,
    }) => {
        const source =
            'Section text <ref name="remote" details="pp. 1–2" />' +
            "\n".repeat(10) +
            '<ref name="local">{{Cite book|title=Local title}}</ref>';
        const fullSource =
            '<ref name="remote">{{Cite book|title=Outside this section|first=Jane|last=Doe}}</ref>\n' +
            source;
        await page.route("https://example.test/**", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            }),
        );
        await page.goto(
            "https://example.test/wiki/Sandbox?action=edit&section=1",
        );
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: {
                    ...createDefaultFormatterSettings(),
                    fullPageReferencePreviews: true,
                    referenceLightweightEditing: lightweight,
                },
            },
        );
        await page.setContent(
            '<form id="editform"><div id="p-cactions"></div>' +
                '<input type="hidden" name="wpSection" value="1">' +
                '<textarea id="wpTextbox1" name="wpTextbox1"></textarea></form>',
        );
        await page.locator("#wpTextbox1").fill(source);
        await installMediaWikiFixture(page, "examplewiki");
        await page.evaluate((fullSource) => {
            const mediaWiki = (globalThis as any).mw;
            const getConfig = mediaWiki.config.get;
            const get = mediaWiki.Api.prototype.get;
            (globalThis as any).__revisionRequests = [];
            mediaWiki.config.get = (key: string) =>
                key === "wgCurRevisionId" ? 123 : getConfig(key);
            mediaWiki.Api.prototype.get = async (
                parameters: Record<string, unknown>,
            ) => {
                if (parameters.prop !== "revisions") {
                    return get(parameters);
                }
                (globalThis as any).__revisionRequests.push(parameters);
                return {
                    query: {
                        pages: [
                            {
                                revisions: [
                                    {
                                        slots: {
                                            main: { content: fullSource },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                };
            };
        }, fullSource);
        await page.addScriptTag({ path: gadgetArtifact });
        await expect(
            page.locator('.wiked-lite-frame[data-wiked-ready="true"]'),
        ).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    () => (globalThis as any).__revisionRequests.length,
                ),
            )
            .toBe(1);
        expect(
            await page.evaluate(
                () => (globalThis as any).__revisionRequests[0],
            ),
        ).toMatchObject({
            action: "query",
            revids: 123,
            rvprop: "content",
            rvslots: "main",
        });
        const frame = page.frameLocator(".wiked-lite-frame");
        await frame
            .locator(".wiked-lite-editor [data-reference]")
            .first()
            .hover();
        const popup = frame.locator(".wiked-lite-tooltip");
        await expect(popup).toContainText("Outside this section");
        const remoteValue = popup.locator(".wiked-lite-tooltip__value").filter({
            hasText: "Outside this section",
        });
        await expect(remoteValue).toHaveClass("wiked-lite-tooltip__value");
        await expect(remoteValue).not.toHaveAttribute("aria-disabled", "true");
        const remotePresentation = await remoteValue.evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, opacity: style.opacity };
        });
        expect(remotePresentation.opacity).toBe("1");
        const unavailable = popup.getByRole("button", {
            name: "Edit field 'title'",
            exact: true,
        });
        if (lightweight) {
            await expect(unavailable).toHaveText("[✎]");
            await expect(unavailable.locator("svg, img")).toHaveCount(0);
        } else {
            await expectTooltipIcon(unavailable, "cdxIconEdit");
        }
        await expect(unavailable).toHaveAttribute("aria-disabled", "true");
        await expect(unavailable).toHaveAttribute(
            "title",
            "Cannot edit field 'title': it is defined outside the section being edited.",
        );
        await unavailable.dispatchEvent("click");
        await expect(popup.getByRole("textbox")).toHaveCount(0);
        const unavailableAdd = popup.getByRole("button", {
            name: "Add a new field",
            exact: true,
        });
        await expect(unavailableAdd).toHaveAttribute("aria-disabled", "true");
        await unavailableAdd.dispatchEvent("click");
        await expect(popup.getByRole("textbox")).toHaveCount(0);
        const unavailableAddAfter = popup.getByRole("button", {
            name: "Add a field after 'title'",
            exact: true,
        });
        await expect(unavailableAddAfter).toHaveAttribute(
            "aria-disabled",
            "true",
        );
        await unavailableAddAfter.dispatchEvent("click");
        await expect(popup.getByRole("textbox")).toHaveCount(0);
        const detailsPencil = popup.getByRole("button", {
            name: "Edit sub-reference content",
            exact: true,
        });
        await expect(detailsPencil).toBeEnabled();
        expect(
            await unavailable.evaluate(
                (element) => getComputedStyle(element).color,
            ),
        ).not.toBe(
            await detailsPencil.evaluate(
                (element) => getComputedStyle(element).color,
            ),
        );
        await detailsPencil.click();
        await popup
            .getByRole("textbox", {
                name: "Edit sub-reference content",
                exact: true,
            })
            .fill("pp. 3–4");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("pp. 1–2", "pp. 3–4"),
        );
        await expect(popup).toBeVisible();
        await expect(popup).toBeFocused();
        await detailsPencil.click();
        await popup
            .getByRole("textbox", {
                name: "Edit sub-reference content",
                exact: true,
            })
            .fill("");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(
            source.replace("pp. 1–2", ""),
        );
        await frame
            .locator(".wiked-lite-editor [data-reference]")
            .first()
            .hover();
        await expect(detailsPencil).toBeEnabled();
        await expect(unavailable).toHaveAttribute("aria-disabled", "true");
        await detailsPencil.click();
        await popup
            .getByRole("button", {
                name: 'Restore original value "pp. 1–2"',
                exact: true,
            })
            .click();
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
        await frame
            .locator(
                ".wiked-lite-editor [data-reference^='<ref name=\"local\"']",
            )
            .first()
            .hover();
        const localValue = popup.locator(".wiked-lite-tooltip__value");
        await expect(localValue).toHaveText("Local title");
        expect(
            await localValue.evaluate((element) => {
                const style = getComputedStyle(element);
                return { color: style.color, opacity: style.opacity };
            }),
        ).toEqual(remotePresentation);
    });
}

test("page previews wait for a settled title hover and preserve wikitext", async ({
    page,
}) => {
    const source = "[[Example page|Shown label]]";
    let summaryRequests = 0;
    await page.route("https://example.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith("/api/rest_v1/page/summary/")) {
            summaryRequests += 1;
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    title: "Example page",
                    description: "Sample article",
                    extract: "A preview loaded after the pointer settles.",
                    content_urls: {
                        desktop: {
                            page: "https://example.test/wiki/Example_page",
                        },
                    },
                }),
            });
            return;
        }
        await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html>",
        });
    });
    await installPageExistenceFixture(page);
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
            },
        },
    );
    await mountEditor(page, source);

    const frame = page.frameLocator(".wiked-lite-frame");
    const title = frame.locator('[data-page-preview-title="Example page"]');
    const card = frame.locator(".wiked-lite-page-preview");
    await expect(title).toHaveText("Example page");
    await title.hover();
    await page.waitForTimeout(300);
    await expect(card).toHaveCount(0);

    const bounds = await title.boundingBox();
    if (bounds == null) {
        throw new Error("Page preview title is not visible");
    }
    await page.mouse.move(
        bounds.x + bounds.width / 2 + 6,
        bounds.y + bounds.height / 2,
    );
    await page.waitForTimeout(450);
    await expect(card).toHaveCount(0);

    await expect(card).toBeVisible({ timeout: 650 });
    await expect(
        card.locator(".wiked-lite-page-preview__title"),
    ).toHaveAttribute("href", "https://example.test/wiki/Example_page");
    await expect(card.locator(".wiked-lite-page-preview__extract")).toHaveText(
        "A preview loaded after the pointer settles.",
    );
    expect(summaryRequests).toBe(1);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("link-en previews use English and local summary endpoints", async ({
    page,
}) => {
    const source = "{{link-en|Local title|English title|Local label}}";
    const requests: string[] = [];
    await page.route("https://example.test/**", async (route) => {
        const url = route.request().url();
        if (new URL(url).pathname.startsWith("/api/rest_v1/page/summary/")) {
            requests.push(url);
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    title: "Local title",
                    extract: "A local page summary.",
                    content_urls: {
                        desktop: {
                            page: "https://example.test/wiki/Local_title",
                        },
                    },
                }),
            });
            return;
        }
        await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html>",
        });
    });
    await page.route("https://en.wikipedia.org/**", async (route) => {
        requests.push(route.request().url());
        await route.fulfill({
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({
                title: "English title",
                extract: "An English page summary.",
                content_urls: {
                    desktop: {
                        page: "https://en.wikipedia.org/wiki/English_title",
                    },
                },
            }),
        });
    });
    await installPageExistenceFixture(page);
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
            },
        },
    );
    await mountEditor(page, source, gadgetArtifact, "zhwiki");

    const frame = page.frameLocator(".wiked-lite-frame");
    const card = frame.locator(".wiked-lite-page-preview");
    const english = frame.locator('[data-page-preview-wiki="en"]');
    const local = frame.locator('[data-page-preview-wiki="local"]');
    await expect(english).toHaveAttribute(
        "data-page-preview-title",
        "English title",
    );
    await expect(local).toHaveAttribute(
        "data-page-preview-title",
        "Local title",
    );

    await english.hover();
    await expect(card.locator(".wiked-lite-page-preview__title")).toHaveText(
        "en:English title",
    );
    expect(requests).toEqual([
        "https://en.wikipedia.org/api/rest_v1/page/summary/English%20title",
    ]);

    await page.mouse.move(2, 2);
    await expect(card).toHaveCount(0);
    await local.hover();
    await expect(card.locator(".wiked-lite-page-preview__title")).toHaveText(
        "Local title",
    );
    expect(requests).toEqual([
        "https://en.wikipedia.org/api/rest_v1/page/summary/English%20title",
        "https://example.test/api/rest_v1/page/summary/Local%20title",
    ]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("Translink previews its Japanese title from Japanese Wikipedia", async ({
    page,
}) => {
    const source = "{{Translink|ja|ポーキー・ミンチ|波奇·明奇}}";
    const expectedUrl = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent("ポーキー・ミンチ")}`;
    const requests: string[] = [];
    await page.route("https://example.test/**", async (route) => {
        if (
            new URL(route.request().url()).pathname.startsWith(
                "/api/rest_v1/page/summary/",
            )
        ) {
            throw new Error("Japanese title used the local summary endpoint");
        }
        await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html>",
        });
    });
    await page.route("https://ja.wikipedia.org/**", async (route) => {
        requests.push(route.request().url());
        await route.fulfill({
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({
                title: "ポーキー・ミンチ",
                extract: "日本語版の記事の概要。",
                content_urls: {
                    desktop: {
                        page: "https://ja.wikipedia.org/wiki/ポーキー・ミンチ",
                    },
                },
            }),
        });
    });
    await installPageExistenceFixture(page);
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
            },
        },
    );
    await mountEditor(page, source, gadgetArtifact, "zhwiki");

    const frame = page.frameLocator(".wiked-lite-frame");
    const japaneseTitle = frame.locator('[data-page-preview-wiki="ja"]');
    const localTitle = frame.locator('[data-page-preview-wiki="local"]');
    const card = frame.locator(".wiked-lite-page-preview");
    await expect(japaneseTitle).toHaveAttribute(
        "data-page-preview-title",
        "ポーキー・ミンチ",
    );
    await expect(localTitle).toHaveAttribute(
        "data-page-preview-title",
        "波奇·明奇",
    );
    await japaneseTitle.hover();
    await expect(card.locator(".wiked-lite-page-preview__title")).toHaveText(
        "ja:ポーキー・ミンチ",
    );
    await expect(card.locator(".wiked-lite-page-preview__extract")).toHaveText(
        "日本語版の記事の概要。",
    );
    expect(requests).toEqual([expectedUrl]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("Translink with only one title previews that title locally", async ({
    page,
}) => {
    const source = "{{Translink|en|CPU}}";
    const requests: string[] = [];
    await page.route("https://example.test/**", async (route) => {
        const url = route.request().url();
        if (new URL(url).pathname.startsWith("/api/rest_v1/page/summary/")) {
            requests.push(url);
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    title: "CPU",
                    extract: "Local CPU page.",
                }),
            });
            return;
        }
        await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html>",
        });
    });
    await page.route("https://en.wikipedia.org/**", async () => {
        throw new Error("A single Translink title is not an English page");
    });
    await installPageExistenceFixture(page);
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
            },
        },
    );
    await mountEditor(page, source, gadgetArtifact, "zhwiki");

    const frame = page.frameLocator(".wiked-lite-frame");
    const cpu = frame.locator('[data-page-preview-title="CPU"]');
    await expect(cpu).toHaveAttribute("data-page-preview-wiki", "local");
    await cpu.hover();
    await expect(frame.locator(".wiked-lite-page-preview__title")).toHaveText(
        "CPU",
    );
    expect(requests).toEqual([
        "https://example.test/api/rest_v1/page/summary/CPU",
    ]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

for (const wikiId of ["zhwiki", "examplewiki"]) {
    test(`foreign Translink preview on ${wikiId} identifies its wiki without a fragment`, async ({
        page,
    }) => {
        const source =
            "{{Translink|en|EarthBound fandom#Starmen.net|地球冒险粉丝社群|Starmen.net}}";
        const requests: string[] = [];
        let thumbnailRequests = 0;
        await page.route("https://example.test/**", async (route) => {
            await route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            });
        });
        await page.route("https://upload.wikimedia.org/**", async (route) => {
            thumbnailRequests += 1;
            await route.fulfill({ status: 204, body: "" });
        });
        await page.route("https://en.wikipedia.org/**", async (route) => {
            requests.push(route.request().url());
            await route.fulfill({
                contentType: "application/json",
                headers: { "access-control-allow-origin": "*" },
                body: JSON.stringify({
                    title: "EarthBound fandom",
                    extract: "An English article summary.",
                    thumbnail: {
                        source: "https://upload.wikimedia.org/example.jpg",
                    },
                    content_urls: {
                        desktop: {
                            page: "https://en.wikipedia.org/wiki/EarthBound_fandom",
                        },
                    },
                }),
            });
        });
        await installPageExistenceFixture(page);
        await page.goto("https://example.test/wiki/Sandbox");
        await page.evaluate(
            ({ key, settings }) =>
                localStorage.setItem(key, JSON.stringify(settings)),
            {
                key: FORMATTER_SETTINGS_STORAGE_KEY,
                settings: {
                    ...createDefaultFormatterSettings(),
                    linkPreviews: true,
                },
            },
        );
        await mountEditor(page, source, gadgetArtifact, wikiId);

        const frame = page.frameLocator(".wiked-lite-frame");
        const foreignTitle = frame.locator('[data-page-preview-wiki="en"]');
        const cardTitle = frame.locator(".wiked-lite-page-preview__title");
        await expect(foreignTitle).toHaveText("EarthBound fandom#Starmen.net");
        await expect(foreignTitle).toHaveAttribute(
            "data-page-preview-title",
            "EarthBound fandom",
        );
        const bodyColor = await frame
            .locator(".wiked-lite-editor")
            .evaluate((element) => getComputedStyle(element).color);
        await expect
            .poll(() =>
                foreignTitle.evaluate(
                    (element) => getComputedStyle(element).color,
                ),
            )
            .toBe(bodyColor);
        await expect
            .poll(() =>
                frame
                    .locator('[data-page-preview-wiki="local"]')
                    .evaluate((element) => getComputedStyle(element).color),
            )
            .toBe("rgb(0, 0, 170)");
        await foreignTitle.hover();
        await expect(cardTitle).toHaveText("en:EarthBound fandom");
        await expect(cardTitle).toHaveAttribute(
            "href",
            "https://en.wikipedia.org/wiki/EarthBound_fandom",
        );
        await expect(frame.locator(".wiked-lite-page-preview img")).toHaveCount(
            0,
        );
        expect(thumbnailRequests).toBe(0);
        expect(requests).toEqual([
            "https://en.wikipedia.org/api/rest_v1/page/summary/EarthBound%20fandom",
        ]);
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    });
}

test("a missing foreign Translink title stays neutral after hover", async ({
    page,
}) => {
    const source =
        "{{Translink|en|Timekeeping in games#Turn-based|游戏中的计时系统|回合制战斗}}";
    const requests: string[] = [];
    await page.route("https://example.test/**", async (route) => {
        await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html>",
        });
    });
    await page.route("https://en.wikipedia.org/**", async (route) => {
        requests.push(route.request().url());
        await route.fulfill({ status: 404, body: "" });
    });
    const existenceRequests = await installPageExistenceFixture(page, [
        "Timekeeping in games",
    ]);
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
            },
        },
    );
    await mountEditor(page, source, gadgetArtifact, "zhwiki");

    const frame = page.frameLocator(".wiked-lite-frame");
    const foreignTitle = frame.locator('[data-page-preview-wiki="en"]');
    await expect(foreignTitle).toHaveText("Timekeeping in games#Turn-based");
    await expect(foreignTitle).toHaveAttribute(
        "data-page-preview-title",
        "Timekeeping in games",
    );
    const bodyColor = await frame
        .locator(".wiked-lite-editor")
        .evaluate((element) => getComputedStyle(element).color);
    await expect
        .poll(() =>
            foreignTitle.evaluate((element) => getComputedStyle(element).color),
        )
        .toBe(bodyColor);
    await expect
        .poll(() =>
            frame
                .locator('[data-page-preview-wiki="local"]')
                .evaluate((element) => getComputedStyle(element).color),
        )
        .toBe("rgb(0, 0, 170)");

    await foreignTitle.hover();
    await expect.poll(() => existenceRequests.length).toBe(1);
    await expect(foreignTitle).not.toHaveClass(
        /wiked-lite-token--page-missing/u,
    );
    await expect
        .poll(() =>
            foreignTitle.evaluate((element) => getComputedStyle(element).color),
        )
        .toBe(bodyColor);
    await expect(frame.locator(".wiked-lite-page-preview")).toHaveCount(0);
    expect(existenceRequests).toEqual([
        "https://en.wikipedia.org/w/api.php:Timekeeping in games",
    ]);
    expect(requests).toEqual([]);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

test("a missing page summary colors the title red without repeated requests", async ({
    page,
}) => {
    const source = "[[地球冒险3 猪王的末日]]";
    let summaryRequests = 0;
    await page.route("https://example.test/**", async (route) => {
        if (
            new URL(route.request().url()).pathname.startsWith(
                "/api/rest_v1/page/summary/",
            )
        ) {
            summaryRequests += 1;
            await route.fulfill({ status: 404, body: "" });
            return;
        }
        await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html>",
        });
    });
    const existenceRequests = await installPageExistenceFixture(page, [
        "地球冒险3 猪王的末日",
    ]);
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
            },
        },
    );
    await mountEditor(page, source);

    const frame = page.frameLocator(".wiked-lite-frame");
    const title = frame.locator(
        '[data-page-preview-title="地球冒险3 猪王的末日"]',
    );
    const card = frame.locator(".wiked-lite-page-preview");
    expect(
        await title.evaluate((element) => getComputedStyle(element).color),
    ).not.toBe("rgb(186, 0, 0)");
    await title.hover();
    await expect(title).toHaveClass(/wiked-lite-token--page-missing/u);
    await expect
        .poll(() =>
            title.evaluate((element) => getComputedStyle(element).color),
        )
        .toBe("rgb(186, 0, 0)");
    await expect(card).toHaveCount(0);
    expect(existenceRequests).toEqual([
        "https://example.test/w/api.php:地球冒险3 猪王的末日",
    ]);
    expect(summaryRequests).toBe(0);

    await page.mouse.move(2, 2);
    await title.hover();
    await page.waitForTimeout(800);
    await expect(card).toHaveCount(0);
    expect(existenceRequests).toHaveLength(1);
    expect(summaryRequests).toBe(0);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

async function mountLightweightEditor(
    page: Page,
    source: string,
): Promise<void> {
    await page.route("https://example.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await page.goto("https://example.test/wiki/Sandbox");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                referenceLightweightEditing: true,
            },
        },
    );
    await mountEditor(page, source);
}

async function expectTooltipIcon(button: Locator, name: string): Promise<void> {
    const icon = button.locator("svg.wiked-lite-tooltip__icon");
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("data-icon", name);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    const dimensions = await icon.evaluate((element) => {
        const style = getComputedStyle(element);
        const tooltip = element.closest(".wiked-lite-tooltip")!;
        return {
            width: Number.parseFloat(style.width),
            height: Number.parseFloat(style.height),
            fontSize: Number.parseFloat(style.fontSize),
            tooltipFontSize: Number.parseFloat(
                getComputedStyle(tooltip).fontSize,
            ),
        };
    });
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.width).toBeCloseTo(dimensions.fontSize * 0.85, 1);
    expect(dimensions.height).toBeCloseTo(dimensions.fontSize * 0.85, 1);
    expect(dimensions.width).toBeLessThanOrEqual(
        dimensions.tooltipFontSize * 1.15,
    );
}

async function expectTooltipTextarea(field: Locator): Promise<void> {
    const dimensions = await field.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            tagName: element.tagName,
            rows: (element as HTMLTextAreaElement).rows,
            minHeight: Number.parseFloat(style.minHeight),
            lineHeight: Number.parseFloat(style.lineHeight),
        };
    });
    expect(dimensions.tagName).toBe("TEXTAREA");
    expect(dimensions.rows).toBeGreaterThanOrEqual(2);
    expect(dimensions.minHeight).toBeGreaterThanOrEqual(
        dimensions.lineHeight * 2,
    );
}

async function expectTooltipInlineSource(field: Locator): Promise<void> {
    await expect(field).toHaveAttribute("contenteditable", "plaintext-only");
    await expect(field).toHaveCSS("display", "inline");
    await expect(field).toHaveCSS("border-top-width", "0px");
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(await field.evaluate((element) => element.tagName)).toBe("DIV");
}

async function openedLinks(page: Page): Promise<unknown[][]> {
    return page.evaluate(() => (globalThis as any).__openedLinks);
}

async function installPageExistenceFixture(
    page: Page,
    missingTitles: string[] = [],
): Promise<string[]> {
    const requests: string[] = [];
    await page.route(/\/w\/api\.php(?:\?|$)/u, async (route) => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get("action")).toBe("query");
        expect(url.searchParams.get("formatversion")).toBe("2");
        expect(url.searchParams.get("redirects")).toBe("1");
        expect(url.searchParams.get("origin")).toBe(
            url.origin === "https://example.test" ? null : "*",
        );
        const title = url.searchParams.get("titles") ?? "";
        requests.push(`${url.origin}${url.pathname}:${title}`);
        await route.fulfill({
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({
                batchcomplete: true,
                query: {
                    pages: [
                        missingTitles.includes(title)
                            ? { ns: 0, title, missing: true }
                            : { pageid: 1, ns: 0, title },
                    ],
                },
            }),
        });
    });
    return requests;
}

async function setCaretAtTokenEdge(
    token: Locator,
    atEnd: boolean,
): Promise<void> {
    await token.evaluate((element, atEnd) => {
        const text = element.firstChild;
        if (text?.nodeType !== Node.TEXT_NODE) {
            throw new Error("Expected a marked character text node");
        }
        const range = element.ownerDocument.createRange();
        range.setStart(text, atEnd ? (text.textContent?.length ?? 0) : 0);
        range.collapse(true);
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }, atEnd);
}

async function getCaretSourceOffset(editor: Locator): Promise<number> {
    return editor.evaluate((element) => {
        const selection = element.ownerDocument.getSelection();
        if (selection?.anchorNode == null) {
            throw new Error("Expected editor caret");
        }
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length;
    });
}

async function mountEditor(
    page: Page,
    source: string,
    artifact = gadgetArtifact,
    wikiId = "examplewiki",
): Promise<void> {
    await page.setContent(
        '<form id="editform"><div id="p-cactions"></div>' +
            '<textarea id="wpTextbox1" name="wpTextbox1" ' +
            'aria-label="Wikitext editor"></textarea></form>',
    );
    await page.locator("#wpTextbox1").fill(source);
    await installMediaWikiFixture(page, wikiId);
    if (artifact === userscriptArtifact) {
        const code = await readFile(artifact, "utf8");
        await page.evaluate((source) => {
            new Function("window", "mw", source)(window, undefined);
        }, code);
    } else {
        await page.addScriptTag({ path: artifact });
    }
    await expect(
        page.locator('.wiked-lite-frame[data-wiked-ready="true"]'),
    ).toBeVisible();
}

async function installMediaWikiFixture(
    page: Page,
    wikiId: string,
): Promise<void> {
    await page.evaluate((wikiId) => {
        const settings: Record<string, string> = {
            cmMode: "",
            wgAction: "edit",
            wgDBname: wikiId,
            wgPageContentModel: "wikitext",
            wgUserLanguage: "en",
            wgWikiID: wikiId,
        };
        const magicWord = (name: string, aliases: string[]) => ({
            aliases,
            "case-sensitive": false,
            name,
        });
        const siteinfo = {
            query: {
                functionhooks: ["local-function"],
                magicwords: [
                    magicWord("subst", ["subst:"]),
                    magicWord("safesubst", ["safesubst:"]),
                    magicWord("msg", ["msg:"]),
                    magicWord("msgnw", ["msgnw:"]),
                    magicWord("raw", ["raw:"]),
                    magicWord("local-function", ["lokalfunktion:"]),
                    magicWord("img_thumbnail", ["miniatur"]),
                    magicWord("img_alt", ["alternativ=$1"]),
                ],
                namespacealiases: [{ alias: "Bild", id: 6 }],
                namespaces: {
                    0: { id: 0, name: "" },
                    6: { canonical: "File", id: 6, name: "Datei" },
                    10: { canonical: "Template", id: 10, name: "Vorlage" },
                    14: { canonical: "Category", id: 14, name: "Kategorie" },
                },
                variables: [],
            },
        };
        const hook = {
            add() {
                return hook;
            },
            remove() {
                return hook;
            },
        };
        (globalThis as any).mw = {
            Api: class {
                async get(
                    parameters: Record<string, unknown>,
                ): Promise<unknown> {
                    if (
                        parameters.action === "query" &&
                        parameters.meta === "siteinfo"
                    ) {
                        (globalThis as any).__siteinfoRequests += 1;
                        await new Promise((resolve) => setTimeout(resolve, 20));
                        return siteinfo;
                    }
                    throw new Error("Unexpected MediaWiki API request");
                }
            },
            config: { get: (key: string) => settings[key] },
            hook: () => hook,
            loader: { using: async () => undefined },
            notify() {},
            util: {
                addCSS(css: string) {
                    const style = document.createElement("style");
                    style.textContent = css;
                    document.head.append(style);
                    return { ownerNode: style };
                },
                addPortletLink(
                    portlet: string,
                    options: { id: string; text: string },
                ) {
                    const parent = document.getElementById(portlet);
                    if (parent == null) {
                        return null;
                    }
                    const link = document.createElement("a");
                    link.id = options.id;
                    link.textContent = options.text;
                    parent.append(link);
                    return link;
                },
                getUrl: (title: string) => `/wiki/${title}`,
                wikiScript: () => "/w/api.php",
            },
        };
        (globalThis as any).__siteinfoRequests = 0;
        (globalThis as any).wikEdLiteConfig = { highlightDelay: 0 };
    }, wikiId);
}
