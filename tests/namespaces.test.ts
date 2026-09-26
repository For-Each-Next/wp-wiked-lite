import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "../src/shared/logging.ts";
import { getNamespaceId } from "../src/domain/wiki-titles.ts";
import {
    createSiteinfoCache,
    SITEINFO_CACHE_TTL_MS,
} from "../src/platform/mediawiki/siteinfo-cache.ts";
import { createWikiNamespaceResolver } from "../src/platform/mediawiki/namespaces.ts";
import type { WikiNamespaceState } from "../src/domain/wiki-site.ts";

test("every wiki loads current namespace and magic-word aliases", async () => {
    for (const databaseName of ["enwiki", "zhwiki"] as const) {
        let requests = 0;
        const resolver = createWikiNamespaceResolver(databaseName);
        const state = await resolver.load({
            async get() {
                requests += 1;
                return createSiteinfo();
            },
        });

        assert.equal(requests, 1);
        assert.equal(state.redirectsSafe, true);
        assert.equal(state.templateRedirectsSafe, true);
        assert.ok(state.templateMagicWords != null);
        assert.equal(getNamespaceId(state.source, "Pattern"), 10);
        assert.equal(resolver.current(), state);
    }
});

test("other wikis load and cache namespace siteinfo", async () => {
    let request: Record<string, unknown> | undefined;
    let requests = 0;
    const resolver = createWikiNamespaceResolver("examplewiki");
    const api = {
        async get(parameters: Record<string, unknown>) {
            request = parameters;
            requests += 1;
            return createSiteinfo();
        },
    };

    assert.equal(resolver.current().redirectsSafe, false);
    assert.equal(resolver.current().templateRedirectsSafe, false);
    assert.equal(getNamespaceId(resolver.current().source, "Template"), 10);
    assert.equal(getNamespaceId(resolver.current().source, "File"), 6);
    assert.equal(getNamespaceId(resolver.current().source, "Category"), 14);
    assert.equal(getNamespaceId(resolver.current().source, "TM"), undefined);
    const first = resolver.load(api);
    const second = resolver.load(api);
    assert.equal(first, second);
    const state = await first;

    assertLoadedSiteinfo(state, request, requests);
    assert.equal(getNamespaceId(state.source, "Image"), 6);
    assert.equal(await resolver.load(api), state);
    assert.equal(requests, 1);
});

test("missing magic-word siteinfo keeps wikilink redirects safe", async () => {
    for (const property of ["magicwords", "variables", "functionhooks"]) {
        const response = createSiteinfo() as {
            query: Record<string, unknown>;
        };
        delete response.query[property];
        const resolver = createWikiNamespaceResolver("examplewiki");
        const state = await resolver.load({
            async get() {
                return response;
            },
        });

        assert.equal(state.redirectsSafe, true);
        assert.equal(state.templateRedirectsSafe, false);
        assert.equal(state.templateMagicWords, null);
        assert.equal(
            state.imageOptions?.named.caseInsensitive.has("alternativ") ??
                false,
            property !== "magicwords",
        );
        assert.equal(getNamespaceId(state.source, "Pattern"), 10);
    }
});

test("unmapped function hooks make template redirects unsafe", async () => {
    const resolver = createWikiNamespaceResolver("examplewiki");
    const response = createSiteinfo() as {
        query: { functionhooks: string[] };
    };
    response.query.functionhooks.push("missing-hook");

    const state = await resolver.load({
        async get() {
            return response;
        },
    });

    assert.equal(state.redirectsSafe, true);
    assert.equal(state.templateRedirectsSafe, false);
});

test("failed namespace loads retain a retryable safe fallback", async () => {
    let requests = 0;
    const warnings: unknown[][] = [];
    const resolver = createWikiNamespaceResolver(
        "brokenwiki",
        createWarningLogger(warnings),
    );
    const api = {
        async get() {
            requests += 1;
            throw new Error("offline");
        },
    };

    const first = await resolver.load(api);
    const second = await resolver.load(api);

    assert.equal(requests, 2);
    assert.equal(first.redirectsSafe, false);
    assert.equal(first.templateRedirectsSafe, false);
    assert.equal(first.templateMagicWords, null);
    assert.equal(getNamespaceId(first.source, "Template"), 10);
    assert.equal(getNamespaceId(first.source, "TM"), undefined);
    assert.equal(second, first);
    assert.equal(resolver.current(), first);
    assertFailedWarnings(warnings);
});

function assertFailedWarnings(warnings: unknown[][]): void {
    assert.deepEqual(
        warnings.map((values) => values.slice(0, 2)),
        [
            [
                "[wiked-lite] load.failed",
                {
                    databaseName: "brokenwiki",
                    error: { message: "[redacted]", name: "Error" },
                },
            ],
            [
                "[wiked-lite] load.failed",
                {
                    databaseName: "brokenwiki",
                    error: { message: "[redacted]", name: "Error" },
                },
            ],
        ],
    );
}

function assertLoadedSiteinfo(
    state: WikiNamespaceState,
    request: Record<string, unknown> | undefined,
    requests: number,
): void {
    assert.deepEqual(request, {
        action: "query",
        formatversion: "2",
        meta: "siteinfo",
        siprop:
            "namespaces|namespacealiases|magicwords|variables|" +
            "functionhooks",
    });
    assert.equal(requests, 1);
    assert.equal(state.redirectsSafe, true);
    assert.equal(state.templateRedirectsSafe, true);
    assert.ok(state.templateMagicWords != null);
    assert.equal(
        state.templateMagicWords.functions.caseInsensitive.has(
            "lokalfunktion:",
        ),
        true,
    );
    assert.equal(
        state.templateMagicWords.variables.caseSensitive.has("LOKALVARIABLE"),
        true,
    );
    assert.equal(
        state.templateMagicWords.modifiers.substitution.caseInsensitive.has(
            "ersetzen:",
        ),
        true,
    );
    assert.equal(
        state.templateMagicWords.invoke.caseInsensitive.has("aufrufen"),
        true,
    );
    assert.equal(
        state.imageOptions?.named.caseInsensitive.has("alternativ"),
        true,
    );
    assert.equal(
        state.imageOptions?.literals.caseInsensitive.has("miniatur"),
        true,
    );
    assert.equal(
        state.imageOptions?.underscored.caseInsensitive.has("seite"),
        true,
    );
}

test("fresh siteinfo cache hydrates without a request and expires after 24 hours", async () => {
    let now = 10_000;
    const saved = new Map<string, string>();
    const storage = {
        getItem(key: string) {
            return saved.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            saved.set(key, value);
        },
        removeItem(key: string) {
            saved.delete(key);
        },
    };
    const cache = createSiteinfoCache(storage, () => now);
    const first = createWikiNamespaceResolver("examplewiki", undefined, cache);
    await first.load({
        async get() {
            return createSiteinfo();
        },
    });
    const cached = createWikiNamespaceResolver("examplewiki", undefined, cache);
    assert.equal(getNamespaceId(cached.current().source, "Pattern"), 10);
    assert.equal(cached.current().templateRedirectsSafe, true);
    let requests = 0;
    await cached.load({
        async get() {
            requests += 1;
            return createSiteinfo();
        },
    });
    assert.equal(requests, 0);

    now += SITEINFO_CACHE_TTL_MS;
    const expired = createWikiNamespaceResolver(
        "examplewiki",
        undefined,
        cache,
    );
    assert.equal(expired.current().redirectsSafe, false);
    await expired.load({
        async get() {
            requests += 1;
            return createSiteinfo();
        },
    });
    assert.equal(requests, 1);
    assert.equal(expired.current().redirectsSafe, true);
});

function createWarningLogger(warnings: unknown[][]) {
    return createLogger("wiked-lite", {
        level: "warn",
        output: {
            debug() {},
            error() {},
            info() {},
            warn(...values) {
                warnings.push(values);
            },
        },
    });
}

function createSiteinfo(): unknown {
    const query: Record<string, unknown> = {
        namespacealiases: [{ alias: "Image", id: 6 }],
        namespaces: {
            0: { id: 0, name: "" },
            6: { canonical: "File", id: 6, name: "Asset" },
            10: { canonical: "Template", id: 10, name: "Pattern" },
            14: {
                canonical: "Category",
                id: 14,
                name: "Grouping",
            },
        },
    };
    Object.assign(query, {
        functionhooks: ["local-function", "invoke"],
        magicwords: [
            magicWord("subst", ["SUBST:", "ERSETZEN:"]),
            magicWord("safesubst", ["SAFESUBST:", "SICHERERSETZEN:"]),
            magicWord("msg", ["MSG:", "NACHRICHT:"]),
            magicWord("msgnw", ["MSGNW:", "NACHRICHTNW:"]),
            magicWord("raw", ["RAW:", "ROH:"]),
            magicWord("local-function", ["local-function:", "lokalfunktion:"]),
            magicWord("invoke", ["invoke", "aufrufen"]),
            magicWord("local-variable", ["LOKALVARIABLE"], true),
            magicWord("img_thumbnail", ["thumb", "miniatur"]),
            magicWord("img_alt", ["alt=$1", "alternativ=$1"]),
            magicWord("img_page", ["page_$1", "seite_$1"]),
        ],
        variables: ["local-variable"],
    });
    return { query };
}

function magicWord(
    name: string,
    aliases: string[],
    caseSensitive = false,
): Record<string, unknown> {
    return {
        aliases,
        "case-sensitive": caseSensitive,
        name,
    };
}
