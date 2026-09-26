/** Read-only Page Content Service summaries for link previews. */

import type { PageSummaryResult } from "../../domain/page-summary.ts";
import type { PagePreviewTarget } from "../../domain/highlight-partition.ts";

/** Binds local previews to the host wiki and supported foreign Wikipedia sites. */
export function createPageSummaryLoader(
    localOrigin: string,
    localApiEndpoint: string,
    fetcher: typeof fetch = fetch,
): (target: PagePreviewTarget) => Promise<PageSummaryResult> {
    return (target) => {
        const origin =
            target.wiki === "local"
                ? localOrigin
                : /^[a-z]{2}$/u.test(target.wiki)
                  ? `https://${target.wiki}.wikipedia.org`
                  : null;
        if (origin == null) {
            return Promise.resolve({ kind: "unavailable" });
        }
        const endpoint = target.wiki === "local" ? localApiEndpoint : undefined;
        return fetchPageSummary(origin, target.title, fetcher, endpoint);
    };
}

/** Loads a plain-text summary from one wiki's stable PCS endpoint. */
export async function fetchPageSummary(
    origin: string,
    title: string,
    fetcher: typeof fetch = fetch,
    apiEndpoint?: string,
): Promise<PageSummaryResult> {
    const wiki = new URL(origin);
    if (!isWebUrl(wiki) || wiki.username !== "" || wiki.password !== "") {
        throw new TypeError("A HTTP(S) wiki origin is required.");
    }
    const requestedTitle = title.split("#", 1)[0]?.trim() ?? "";
    if (requestedTitle === "") {
        return { kind: "unavailable" };
    }
    // PCS reports a missing page with HTTP 404, which browsers still print as
    // a failed network request even when the response is handled. Query the
    // Action API first so an expected missing title produces only HTTP 200.
    const queryUrl = new URL(
        apiEndpoint ?? `${wiki.origin}/w/api.php`,
        wiki.origin,
    );
    if (
        !isWebUrl(queryUrl) ||
        queryUrl.origin !== wiki.origin ||
        queryUrl.username !== "" ||
        queryUrl.password !== ""
    ) {
        throw new TypeError("A same-origin HTTP(S) API endpoint is required.");
    }
    queryUrl.searchParams.set("action", "query");
    queryUrl.searchParams.set("format", "json");
    queryUrl.searchParams.set("formatversion", "2");
    queryUrl.searchParams.set("redirects", "1");
    queryUrl.searchParams.set("titles", requestedTitle);
    if (apiEndpoint == null) {
        // Foreign Wikipedia requests are anonymous CORS calls. Local requests
        // use the wiki's script URL and retain the editor's session.
        queryUrl.searchParams.set("origin", "*");
    }
    const queryResponse = await fetcher(queryUrl.href, {
        credentials: "same-origin",
    });
    if (!queryResponse.ok) {
        throw new Error(
            `Page existence request failed (${queryResponse.status}).`,
        );
    }
    const query = asRecord(asRecord(await queryResponse.json())?.query);
    const pages = query?.pages;
    if (!Array.isArray(pages) || pages.length !== 1) {
        return { kind: "unavailable" };
    }
    const page = asRecord(pages[0]);
    if (page?.missing === true || page?.invalid === true) {
        return { kind: "missing" };
    }
    const resolvedTitle = getNonemptyText(page?.title);
    if (resolvedTitle == null) {
        return { kind: "unavailable" };
    }
    const encodedTitle = encodeURIComponent(resolvedTitle);
    const requestUrl = `${wiki.origin}/api/rest_v1/page/summary/${encodedTitle}`;
    const response = await fetcher(requestUrl, { credentials: "same-origin" });
    if (response.status === 404) {
        return { kind: "missing" };
    }
    if (response.status === 204) {
        return { kind: "unavailable" };
    }
    if (!response.ok) {
        throw new Error(`Page summary request failed (${response.status}).`);
    }
    const data = asRecord(await response.json());
    const summaryTitle = getNonemptyText(data?.title);
    const extract = getNonemptyText(data?.extract);
    if (summaryTitle == null || extract == null) {
        return { kind: "unavailable" };
    }

    const pageUrl = getSafeUrl(
        asRecord(asRecord(data?.content_urls)?.desktop)?.page,
        wiki.origin,
    );
    const description = getNonemptyText(data?.description);
    return {
        kind: "summary",
        summary: {
            title: summaryTitle,
            extract,
            ...(description == null ? {} : { description }),
            pageUrl:
                pageUrl?.startsWith(`${wiki.origin}/`) === true
                    ? pageUrl
                    : `${wiki.origin}/wiki/${encodedTitle}`,
        },
    };
}

function getNonemptyText(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    return value.trim() || undefined;
}

function getSafeUrl(value: unknown, origin: string): string | undefined {
    if (typeof value !== "string" || value.trim() === "") {
        return undefined;
    }
    try {
        const url = new URL(value, origin);
        return isWebUrl(url) && url.username === "" && url.password === ""
            ? url.href
            : undefined;
    } catch {
        return undefined;
    }
}

function isWebUrl(url: URL): boolean {
    return url.protocol === "https:" || url.protocol === "http:";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value != null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}
