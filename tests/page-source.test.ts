import assert from "node:assert/strict";
import test from "node:test";

import * as pageSource from "../src/platform/mediawiki/page-source.ts";

test("loads exact modern main-slot revision source", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const source = await pageSource.loadPageRevisionSource(
        createApi(
            {
                query: {
                    pages: [
                        {
                            revisions: [
                                { slots: { main: { content: "Page text" } } },
                            ],
                        },
                    ],
                },
            },
            requests,
        ),
        42,
    );

    assert.equal(source, "Page text");
    assert.deepEqual(requests, [
        {
            action: "query",
            formatversion: 2,
            prop: "revisions",
            revids: 42,
            rvprop: "content",
            rvslots: "main",
        },
    ]);
});

test("rejects invalid IDs and omitted revision source", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const api = createApi({ query: { pages: [] } }, requests);

    await assert.rejects(
        () => pageSource.loadPageRevisionSource(api, 0),
        /positive/u,
    );
    await assert.rejects(
        () => pageSource.loadPageRevisionSource(api, 9),
        /omitted/u,
    );
    assert.equal(requests.length, 1);
});

function createApi(
    response: unknown,
    requests: Array<Record<string, unknown>> = [],
): {
    get(parameters: Record<string, unknown>): Promise<unknown>;
} {
    return {
        get(parameters) {
            requests.push(parameters);
            return Promise.resolve(response);
        },
    };
}
