/**
 * @file tests/page-summary.test.ts
 * Purpose: tests / page summary.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. StubResponse
 * 3. RecordedRequest
 * 4. Test scenarios
 * 5. queryPage
 * 6. stubFetch
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    createPageSummaryLoader,
    fetchPageSummary,
} from "../src/platform/mediawiki/page-summary.ts";

interface StubResponse {
    data?: unknown;
    status: number;
}

interface RecordedRequest {
    init?: RequestInit;
    url: string;
}

test("preview routing uses the local script path or an anonymous foreign Wikipedia request", async () => {
    const requests: RecordedRequest[] = [];
    const load = createPageSummaryLoader(
        "https://wiki.example.test",
        "/custom/api.php",
        stubFetch(
            [
                {
                    status: 200,
                    data: {
                        query: { pages: [{ missing: true, title: "Local" }] },
                    },
                },
                {
                    status: 200,
                    data: {
                        query: { pages: [{ missing: true, title: "Foreign" }] },
                    },
                },
            ],
            requests,
        ),
    );

    assert.deepEqual(await load({ wiki: "local", title: "Local" }), {
        kind: "missing",
    });
    assert.deepEqual(await load({ wiki: "fr", title: "Foreign" }), {
        kind: "missing",
    });
    const local = new URL(requests[0]!.url);
    const foreign = new URL(requests[1]!.url);
    assert.equal(local.origin, "https://wiki.example.test");
    assert.equal(local.pathname, "/custom/api.php");
    assert.equal(local.searchParams.has("origin"), false);
    assert.equal(foreign.origin, "https://fr.wikipedia.org");
    assert.equal(foreign.pathname, "/w/api.php");
    assert.equal(foreign.searchParams.get("origin"), "*");
});

test("unsupported preview wiki names never trigger a request", async () => {
    const load = createPageSummaryLoader(
        "https://wiki.example.test",
        "/w/api.php",
        async () => assert.fail("Unsupported wikis must remain offline"),
    );

    assert.deepEqual(
        await load({ wiki: "https://example.test", title: "Page" }),
        {
            kind: "unavailable",
        },
    );
});

test("checks existence before requesting a fragment-free plain-text summary", async () => {
    const requests: RecordedRequest[] = [];
    const summary = await fetchPageSummary(
        "https://en.wikipedia.org",
        "Earth & Moon#History",
        stubFetch(
            [
                { status: 200, data: queryPage("Earth & Moon") },
                {
                    status: 200,
                    data: {
                        title: "Earth & Moon",
                        displaytitle: "<b>Unsafe display title</b>",
                        extract: "  Plain summary text.  ",
                        extract_html: "<script>unsafe()</script>",
                        description: "  Astronomy  ",
                        thumbnail: {
                            source: "//thumb.wikimedia.org/image.jpg",
                        },
                        content_urls: {
                            desktop: {
                                page: "https://en.wikipedia.org/wiki/Earth_%26_Moon",
                            },
                        },
                    },
                },
            ],
            requests,
        ),
    );

    assert.equal(requests.length, 2);
    const lookup = new URL(requests[0]?.url ?? "");
    assert.equal(lookup.origin, "https://en.wikipedia.org");
    assert.equal(lookup.pathname, "/w/api.php");
    assert.equal(lookup.searchParams.get("action"), "query");
    assert.equal(lookup.searchParams.get("formatversion"), "2");
    assert.equal(lookup.searchParams.get("redirects"), "1");
    assert.equal(lookup.searchParams.get("titles"), "Earth & Moon");
    assert.equal(lookup.searchParams.get("origin"), "*");
    assert.deepEqual(requests[0]?.init, { credentials: "same-origin" });
    assert.deepEqual(requests[1], {
        url: "https://en.wikipedia.org/api/rest_v1/page/summary/Earth%20%26%20Moon",
        init: { credentials: "same-origin" },
    });
    assert.deepEqual(summary, {
        kind: "summary",
        summary: {
            title: "Earth & Moon",
            extract: "Plain summary text.",
            description: "Astronomy",
            pageUrl: "https://en.wikipedia.org/wiki/Earth_%26_Moon",
        },
    });
});

test("missing and invalid titles return without a summary request", async () => {
    for (const page of [
        { ns: 0, title: "Missing", missing: true },
        { title: "Missing", invalid: true },
    ]) {
        const requests: RecordedRequest[] = [];
        assert.deepEqual(
            await fetchPageSummary(
                "https://en.wikipedia.org",
                "Missing",
                stubFetch(
                    [{ status: 200, data: { query: { pages: [page] } } }],
                    requests,
                ),
            ),
            { kind: "missing" },
        );
        assert.equal(requests.length, 1);
        assert.equal(new URL(requests[0]?.url ?? "").pathname, "/w/api.php");
    }
});

test("uses the resolved title after an Action API redirect", async () => {
    const requests: RecordedRequest[] = [];
    const result = await fetchPageSummary(
        "https://en.wikipedia.org",
        "Old title",
        stubFetch(
            [
                { status: 200, data: queryPage("New title") },
                {
                    status: 200,
                    data: { title: "New title", extract: "New summary" },
                },
            ],
            requests,
        ),
    );

    assert.equal(
        new URL(requests[0]?.url ?? "").searchParams.get("titles"),
        "Old title",
    );
    assert.equal(
        requests[1]?.url,
        "https://en.wikipedia.org/api/rest_v1/page/summary/New%20title",
    );
    assert.deepEqual(result, {
        kind: "summary",
        summary: {
            title: "New title",
            extract: "New summary",
            pageUrl: "https://en.wikipedia.org/wiki/New%20title",
        },
    });
});

test("unavailable extracts and empty titles do not create false missing pages", async () => {
    assert.deepEqual(
        await fetchPageSummary(
            "https://en.wikipedia.org",
            "Empty",
            stubFetch([
                { status: 200, data: queryPage("Empty") },
                { status: 200, data: { title: "Empty", extract: "  " } },
            ]),
        ),
        { kind: "unavailable" },
    );
    assert.deepEqual(
        await fetchPageSummary(
            "https://en.wikipedia.org",
            "#Section",
            stubFetch([]),
        ),
        { kind: "unavailable" },
    );
    assert.deepEqual(
        await fetchPageSummary(
            "https://en.wikipedia.org",
            "Unknown",
            stubFetch([{ status: 200, data: { query: { pages: [] } } }]),
        ),
        { kind: "unavailable" },
    );
});

test("supports a local API script path and discards unsafe page URLs", async () => {
    const requests: RecordedRequest[] = [];
    const summary = await fetchPageSummary(
        "https://en.wikipedia.org",
        "Safe title",
        stubFetch(
            [
                { status: 200, data: queryPage("Safe title") },
                {
                    status: 200,
                    data: {
                        title: "Safe title",
                        extract: "Summary",
                        thumbnail: { source: "javascript:alert(1)" },
                        content_urls: {
                            desktop: {
                                page: "https://attacker.example/wiki/Foo",
                            },
                        },
                    },
                },
            ],
            requests,
        ),
        "/custom/api.php",
    );

    const lookup = new URL(requests[0]?.url ?? "");
    assert.equal(lookup.pathname, "/custom/api.php");
    assert.equal(lookup.searchParams.has("origin"), false);
    assert.deepEqual(summary, {
        kind: "summary",
        summary: {
            title: "Safe title",
            extract: "Summary",
            pageUrl: "https://en.wikipedia.org/wiki/Safe%20title",
        },
    });
});

test("reports real failures and tolerates deletion between lookup and summary", async () => {
    await assert.rejects(
        () => fetchPageSummary("javascript:alert(1)", "Earth", stubFetch([])),
        /HTTP\(S\)/u,
    );
    await assert.rejects(
        () =>
            fetchPageSummary(
                "https://en.wikipedia.org",
                "Earth",
                stubFetch([]),
                "https://other.example/api.php",
            ),
        /same-origin/u,
    );
    await assert.rejects(
        () =>
            fetchPageSummary(
                "https://en.wikipedia.org",
                "Earth",
                stubFetch([{ status: 503 }]),
            ),
        /503/u,
    );
    await assert.rejects(
        () =>
            fetchPageSummary(
                "https://en.wikipedia.org",
                "Earth",
                stubFetch([
                    { status: 200, data: queryPage("Earth") },
                    { status: 503 },
                ]),
            ),
        /503/u,
    );
    assert.deepEqual(
        await fetchPageSummary(
            "https://en.wikipedia.org",
            "Earth",
            stubFetch([
                { status: 200, data: queryPage("Earth") },
                { status: 404 },
            ]),
        ),
        { kind: "missing" },
    );
    const networkError = new TypeError("Failed to fetch");
    await assert.rejects(
        () =>
            fetchPageSummary("https://en.wikipedia.org", "Earth", (() =>
                Promise.reject(networkError)) as typeof fetch),
        networkError,
    );
});

function queryPage(title: string): unknown {
    return {
        batchcomplete: true,
        query: { pages: [{ pageid: 1, ns: 0, title }] },
    };
}

function stubFetch(
    responses: StubResponse[],
    requests: RecordedRequest[] = [],
): typeof fetch {
    let index = 0;
    return ((url: string, init?: RequestInit) => {
        requests.push({ url, init });
        const response = responses[index];
        index += 1;
        if (response == null) {
            throw new Error("Unexpected extra request");
        }
        return Promise.resolve(
            new Response(
                response.data === undefined
                    ? null
                    : JSON.stringify(response.data),
                {
                    status: response.status,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
    }) as typeof fetch;
}
