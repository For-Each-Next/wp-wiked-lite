import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

import { createDefaultFormatterSettings } from "../../src/domain/formatter-settings.ts";
import { FORMATTER_SETTINGS_STORAGE_KEY } from "../../src/platform/browser/formatter-settings.ts";

const gadgetArtifact = fileURLToPath(
    new URL("../../dist/wiked_lite.min.js", import.meta.url),
);
const longTitle = "A long article title with enough words to wrap ".repeat(4);
const previews = [
    {
        name: "article",
        source: `[[${longTitle.trim()}]]`,
        anchor: "[data-page-preview-title]",
        popup: ".wiked-lite-page-preview",
        tail: ".wiked-lite-page-preview__tail",
        above: "wiked-lite-page-preview--above",
    },
    {
        name: "reference",
        source: `<ref name="${longTitle.trim()}">A reference note.</ref>`,
        anchor: "[data-reference]",
        popup: ".wiked-lite-tooltip",
        tail: ".wiked-lite-tooltip__tail",
        above: "wiked-lite-tooltip--above",
    },
] as const;

for (const preview of previews) {
    test(`${preview.name} preview anchors its arrow at activation and stays still over the same source`, async ({
        page,
    }) => {
        const source = "\n".repeat(9) + preview.source;
        await mountPreviews(page, source, 600, 560);
        const frame = page.frameLocator(".wiked-lite-frame");
        const anchor = frame.locator(preview.anchor).first();
        const popup = frame.locator(preview.popup);
        const tail = popup.locator(preview.tail);
        const lines = await sourceLines(anchor);
        expect(lines.length).toBeGreaterThan(1);
        const line = lines[1]!;

        for (const fraction of [0.3, 0.7]) {
            const pointer = {
                x: line.left + line.width * fraction,
                y: line.top + line.height / 2,
            };
            await moveWithinFrame(page, pointer);
            await expect(popup).toBeVisible();
            await expect(tail).toBeVisible();
            await expect
                .poll(async () => {
                    const bounds = await tail.evaluate((element) =>
                        element.getBoundingClientRect().toJSON(),
                    );
                    return Math.abs(bounds.left + bounds.width / 2 - pointer.x);
                })
                .toBeLessThan(1);
            const placement = await popup.evaluate(
                (element, above) => ({
                    rect: element.getBoundingClientRect().toJSON(),
                    above: element.classList.contains(above),
                }),
                preview.above,
            );
            const gap = placement.above
                ? line.top - placement.rect.bottom
                : placement.rect.top - line.bottom;
            expect(gap).toBeCloseTo(10, 0);

            const openingBounds = await previewBounds(popup, preview.tail);
            await moveWithinFrame(page, {
                x: line.left + line.width * (1 - fraction),
                y: pointer.y,
            });
            await expect(popup).toBeVisible();
            expect(await previewBounds(popup, preview.tail)).toEqual(
                openingBounds,
            );

            if (preview.name === "reference") {
                const referenceSpans = frame.locator(preview.anchor);
                expect(await referenceSpans.count()).toBeGreaterThan(1);
                await expect(referenceSpans.last()).toHaveAttribute(
                    "data-reference-start",
                    (await anchor.getAttribute("data-reference-start"))!,
                );
                await referenceSpans.last().hover();
                await expect(popup).toBeVisible();
                expect(await previewBounds(popup, preview.tail)).toEqual(
                    openingBounds,
                );
            }

            await popup.hover();
            await expect(popup).toBeVisible();
            expect(await previewBounds(popup, preview.tail)).toEqual(
                openingBounds,
            );
            await frame.locator(".wiked-lite-editor").press("Escape");
            await expect(popup).toHaveCount(0);
            await page.mouse.move(0, 0);
        }
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    });

    test(`${preview.name} preview keeps its arrow and card inside a narrow iframe`, async ({
        page,
    }) => {
        const source = "\n".repeat(6) + preview.source;
        await mountPreviews(page, source, 340, 420);
        const frame = page.frameLocator(".wiked-lite-frame");
        const anchor = frame.locator(preview.anchor).first();
        const popup = frame.locator(preview.popup);
        const tail = popup.locator(preview.tail);
        const lines = await sourceLines(anchor);
        expect(lines.length).toBeGreaterThan(2);
        const line = lines[1]!;

        for (const x of [line.left + 2, line.right - 2]) {
            await moveWithinFrame(page, {
                x,
                y: line.top + line.height / 2,
            });
            await expect(popup).toBeVisible();
            await expect(tail).toBeVisible();
            const bounds = await popup.evaluate((element, tailSelector) => {
                const card = element.getBoundingClientRect();
                const arrow = element.querySelector(tailSelector)!;
                const tail = arrow.getBoundingClientRect();
                return {
                    card: card.toJSON(),
                    tail: tail.toJSON(),
                    width: window.innerWidth,
                    height: window.innerHeight,
                };
            }, preview.tail);
            expect(bounds.card.left).toBeGreaterThanOrEqual(11.5);
            expect(bounds.card.right).toBeLessThanOrEqual(bounds.width - 11.5);
            expect(bounds.card.top).toBeGreaterThanOrEqual(11.5);
            expect(bounds.card.bottom).toBeLessThanOrEqual(
                bounds.height - 11.5,
            );
            expect(bounds.tail.left).toBeGreaterThanOrEqual(bounds.card.left);
            expect(bounds.tail.right).toBeLessThanOrEqual(bounds.card.right);
            const arrowX = bounds.tail.left + bounds.tail.width / 2;
            const closestSafeX = Math.min(
                bounds.card.right - 18,
                Math.max(bounds.card.left + 18, x),
            );
            expect(arrowX).toBeCloseTo(closestSafeX, 0);
            await frame.locator(".wiked-lite-editor").press("Escape");
            await expect(popup).toHaveCount(0);
            await page.mouse.move(0, 0);
        }
        await expect(page.locator("#wpTextbox1")).toHaveValue(source);
    });
}

test("article preview stays anchored across title fragments but reopens for another link occurrence", async ({
    page,
}) => {
    const source =
        "\n".repeat(9) + "[[Jean–Paul]]" + " ".repeat(12) + "[[Jean–Paul]]";
    await mountPreviews(page, source, 600, 560);
    const frame = page.frameLocator(".wiked-lite-frame");
    const fragments = frame.locator('[data-page-preview-title="Jean–Paul"]');
    await expect(fragments).toHaveText([
        "Jean",
        "–",
        "Paul",
        "Jean",
        "–",
        "Paul",
    ]);
    const popup = frame.locator(".wiked-lite-page-preview");
    const tailSelector = ".wiked-lite-page-preview__tail";

    await fragments.nth(0).hover();
    await expect(popup).toBeVisible();
    const originalCard = await popup.elementHandle();
    expect(originalCard).not.toBeNull();
    const openingBounds = await previewBounds(popup, tailSelector);
    await fragments.nth(2).hover();
    // A stale hover or hide timer must not replace the card after this move.
    await page.waitForTimeout(800);
    expect(await originalCard!.evaluate((element) => element.isConnected)).toBe(
        true,
    );
    expect(await previewBounds(popup, tailSelector)).toEqual(openingBounds);

    const nextPoint = await fragments.nth(3).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        };
    });
    await moveWithinFrame(page, nextPoint);
    expect(await originalCard!.evaluate((element) => element.isConnected)).toBe(
        false,
    );
    await page.waitForTimeout(300);
    await expect(popup).toHaveCount(0);
    await expect(popup).toBeVisible();
    const reopenedBounds = await previewBounds(popup, tailSelector);
    const arrowX = reopenedBounds.tail.left + reopenedBounds.tail.width / 2;
    expect(arrowX).toBeCloseTo(nextPoint.x, 0);
    expect(reopenedBounds).not.toEqual(openingBounds);
    await expect(page.locator("#wpTextbox1")).toHaveValue(source);
});

async function previewBounds(popup: Locator, tailSelector: string) {
    return popup.evaluate(
        (element, selector) => ({
            card: element.getBoundingClientRect().toJSON(),
            tail: element
                .querySelector(selector)!
                .getBoundingClientRect()
                .toJSON(),
        }),
        tailSelector,
    );
}

async function sourceLines(anchor: Locator): Promise<DOMRect[]> {
    return anchor.evaluate((element) =>
        Array.from(element.getClientRects())
            // A wrapping space can have its own narrow fragment on the same line.
            .filter((rect) => rect.width > 100)
            .map((rect) => rect.toJSON()),
    );
}

async function moveWithinFrame(
    page: Page,
    point: { x: number; y: number },
): Promise<void> {
    const frame = page.locator(".wiked-lite-frame");
    const bounds = await frame.boundingBox();
    expect(bounds).not.toBeNull();
    const border = await frame.evaluate((element) => ({
        left: (element as HTMLElement).clientLeft,
        top: (element as HTMLElement).clientTop,
    }));
    await page.mouse.move(
        bounds!.x + border.left + point.x,
        bounds!.y + border.top + point.y,
    );
}

async function mountPreviews(
    page: Page,
    source: string,
    width: number,
    height: number,
): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("https://example.test/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/w/api.php") {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    query: {
                        pages: [
                            {
                                pageid: 1,
                                title: url.searchParams.get("titles"),
                            },
                        ],
                    },
                }),
            });
        } else if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    title: "Example article",
                    extract:
                        "An article summary for checking preview placement.",
                }),
            });
        } else {
            await route.fulfill({
                contentType: "text/html",
                body: "<!doctype html>",
            });
        }
    });
    await page.goto("https://example.test/wiki/Sandbox?action=edit");
    await page.evaluate(
        ({ key, settings }) =>
            localStorage.setItem(key, JSON.stringify(settings)),
        {
            key: FORMATTER_SETTINGS_STORAGE_KEY,
            settings: {
                ...createDefaultFormatterSettings(),
                linkPreviews: true,
                smallReferenceText: false,
            },
        },
    );
    await page.setContent(
        '<form id="editform"><div id="p-cactions"></div>' +
            '<textarea id="wpTextbox1" name="wpTextbox1"></textarea></form>',
    );
    await page.locator("#wpTextbox1").fill(source);
    await page.evaluate(() => {
        const settings: Record<string, string> = {
            cmMode: "",
            wgAction: "edit",
            wgDBname: "examplewiki",
            wgPageContentModel: "wikitext",
            wgUserLanguage: "en",
            wgWikiID: "examplewiki",
        };
        const hook = { add() {}, remove() {} };
        (globalThis as any).mw = {
            Api: class {
                async get(): Promise<unknown> {
                    return {
                        query: {
                            functionhooks: [],
                            magicwords: [],
                            namespacealiases: [],
                            namespaces: {
                                0: { id: 0, name: "" },
                                6: { id: 6, name: "File" },
                                10: { id: 10, name: "Template" },
                                14: { id: 14, name: "Category" },
                            },
                            variables: [],
                        },
                    };
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
                    const link = document.createElement("a");
                    link.id = options.id;
                    link.textContent = options.text;
                    document.getElementById(portlet)?.append(link);
                    return link;
                },
                getUrl: (title: string) => `/wiki/${title}`,
                wikiScript: () => "/w/api.php",
            },
        };
        (globalThis as any).wikEdLiteConfig = { highlightDelay: 0 };
    });
    await page.addScriptTag({ path: gadgetArtifact });
    const frame = page.locator('.wiked-lite-frame[data-wiked-ready="true"]');
    await expect(frame).toBeVisible();
    await frame.evaluate(
        (element, dimensions) => {
            const frame = element as HTMLIFrameElement;
            frame.style.width = `${dimensions.width}px`;
            frame.style.height = `${dimensions.height}px`;
        },
        { width, height },
    );
}
