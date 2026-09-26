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
        if (enabled) {
            await page.evaluate(
                ({ key, settings }) =>
                    localStorage.setItem(key, JSON.stringify(settings)),
                {
                    key: FORMATTER_SETTINGS_STORAGE_KEY,
                    settings: {
                        ...createDefaultFormatterSettings(),
                        useCodeMirrorForOtherModels: true,
                    },
                },
            );
        }
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
    const documentation = title.getByRole("link", {
        name: "Cite web",
        exact: true,
    });
    await expect(title).toHaveText("{{Cite web}} (source)");
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
    await documentation.click();
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
    await expect(details.getByRole("link")).toHaveCount(0);
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
    await expect(popup.getByRole("link")).toHaveCount(0);
    await expect(popup.locator(".wiked-lite-token--template-name")).toHaveCount(
        2,
    );
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

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
