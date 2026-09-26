import assert from "node:assert/strict";
import test from "node:test";

import { createEditorServices } from "../src/app/editor-services.ts";
import type { EditorServiceDependencies } from "../src/app/service-ports.ts";
import { createDefaultFormatterSettings } from "../src/domain/formatter-settings.ts";
import type { WikiNamespaceState } from "../src/domain/wiki-site.ts";
import { createLogger } from "../src/shared/logging.ts";
import { decodeNamespaceCatalog } from "../src/domain/wiki-titles.ts";

test("service creation stays offline and highlighting reads the latest site syntax", async () => {
    const initial = namespaceState({ redirectsSafe: false });
    const loaded = namespaceState();
    let current = initial;
    let requests = 0;
    const services = createEditorServices(
        dependencies({
            databaseName: "zhwiki",
            namespaces: {
                current: () => current,
                async load() {
                    requests += 1;
                    current = loaded;
                    return loaded;
                },
            },
        }),
    );

    assert.equal(requests, 0);
    assert.equal(
        services.getHighlightOptions().namespaceSource,
        initial.source,
    );
    assert.equal(services.getHighlightOptions().linkHelpers, true);
    await services.loadNamespaces();
    assert.equal(requests, 1);
    assert.equal(services.getHighlightOptions().namespaceSource, loaded.source);
});

test("missing-page checks deduplicate real targets and preserve lookup metadata", async () => {
    const requested: string[][] = [];
    const services = createEditorServices(
        dependencies({
            async lookupLinks(titles) {
                requested.push(titles);
                return {
                    missing: new Set(["Absent"]),
                    missingLinkClasses: ["new"],
                    redirects: new Map(),
                };
            },
        }),
    );

    const result = await services.findMissingLinks(
        "[[Present]] [[Present|again]] [[Absent#Section]] " +
            "<!-- [[Comment]] --><nowiki>[[Literal]]</nowiki>",
    );

    assert.deepEqual(requested, [["Present", "Absent"]]);
    assert.deepEqual(result.checkedTitles, new Set(["Present", "Absent"]));
    assert.deepEqual(result.missingTitles, new Set(["Absent"]));
    assert.deepEqual(result.linkClasses, ["new"]);
});

test("redirect resolution skips the network until namespace semantics are known", async () => {
    const state = namespaceState({ redirectsSafe: false });
    const services = createEditorServices(
        dependencies({
            namespaces: { current: () => state, load: async () => state },
            lookupLinks: async () =>
                assert.fail("An unsafe site must not query redirects"),
        }),
    );
    const source = "[[Old]] {{Old}}";

    assert.equal(
        await services.resolveRedirects(source, { includeTemplates: true }),
        source,
    );
});

test("missing magic words disable template rewrites while article redirects still work", async () => {
    const state = namespaceState({
        templateMagicWords: null,
        templateRedirectsSafe: false,
    });
    const requested: string[][] = [];
    const services = createEditorServices(
        dependencies({
            namespaces: { current: () => state, load: async () => state },
            async lookupLinks(titles) {
                requested.push(titles);
                return {
                    missing: new Set(),
                    missingLinkClasses: [],
                    redirects: new Map([
                        ["Old", "New"],
                        ["Template:Old", "Template:New"],
                    ]),
                };
            },
        }),
    );

    assert.equal(
        await services.resolveRedirects("[[Old]] {{Old}}", {
            includeTemplates: true,
        }),
        "[[New|Old]] {{Old}}",
    );
    assert.deepEqual(requested, [["Old"]]);
});

test("loaded site syntax enables requested template redirects without changing protected text", async () => {
    const initial = namespaceState({ redirectsSafe: false });
    const loaded = namespaceState();
    const requested: string[][] = [];
    const services = createEditorServices(
        dependencies({
            namespaces: { current: () => initial, load: async () => loaded },
            async lookupLinks(titles) {
                requested.push(titles);
                return {
                    missing: new Set(),
                    missingLinkClasses: [],
                    redirects: new Map([
                        ["Old", "New"],
                        ["Template:Old", "Template:New"],
                    ]),
                };
            },
        }),
    );

    assert.equal(
        await services.resolveRedirects(
            "[[Old]] {{Old}} <!-- {{Old}} --><nowiki>[[Old]]</nowiki>",
            { includeTemplates: true },
        ),
        "[[New|Old]] {{New}} <!-- {{Old}} --><nowiki>[[Old]]</nowiki>",
    );
    assert.deepEqual(requested, [["Old", "Template:Old"]]);
});

test("revision loads use the current revision and propagate failures to the editor", async () => {
    let revisionId = 12;
    const requested: number[] = [];
    const failure = new Error("offline");
    const services = createEditorServices(
        dependencies({
            getRevisionId: () => revisionId,
            async loadRevisionSource(id) {
                requested.push(id);
                if (id === 13) {
                    throw failure;
                }
                return "Full page source";
            },
            lookupLinks: async () => {
                throw failure;
            },
        }),
    );

    assert.equal(await services.loadPageSource(), "Full page source");
    revisionId = 13;
    await assert.rejects(
        services.loadPageSource(),
        (error) => error === failure,
    );
    await assert.rejects(
        services.findMissingLinks("[[Old]]"),
        (error) => error === failure,
    );
    await assert.rejects(
        services.resolveRedirects("[[Old]]", { includeTemplates: false }),
        (error) => error === failure,
    );
    assert.deepEqual(requested, [12, 13]);
});

test("resetting settings deletes saved configuration and propagates storage failures", () => {
    let clearCalls = 0;
    const failure = new Error("Storage is unavailable");
    const services = createEditorServices(
        dependencies({
            settings: {
                clear() {
                    clearCalls += 1;
                    if (clearCalls > 1) {
                        throw failure;
                    }
                },
                load: createDefaultFormatterSettings,
                save() {
                    assert.fail(
                        "Reset must delete saved settings, not save defaults",
                    );
                },
            },
        }),
    );

    services.resetFormatterSettings();
    assert.equal(clearCalls, 1);
    assert.throws(() => services.resetFormatterSettings(), failure);
    assert.equal(clearCalls, 2);
});

function dependencies(
    overrides: Partial<EditorServiceDependencies> = {},
): EditorServiceDependencies {
    const state = namespaceState();
    const logger = createLogger("test", { level: "silent" });
    return {
        databaseName: "enwiki",
        namespaces: { current: () => state, load: async () => state },
        settings: {
            clear() {},
            load: createDefaultFormatterSettings,
            save() {},
        },
        logger,
        uiLogger: logger,
        notify() {},
        isSectionEditing: () => false,
        getRevisionId: () => 12,
        loadRevisionSource: async () => "Full page source",
        lookupLinks: async () => ({
            missing: new Set(),
            missingLinkClasses: [],
            redirects: new Map(),
        }),
        loadPageSummary: async () => ({ kind: "unavailable" }),
        ...overrides,
    };
}

function namespaceState(
    overrides: Partial<WikiNamespaceState> = {},
): WikiNamespaceState {
    const aliases = {
        caseInsensitive: new Set<string>(),
        caseSensitive: new Set<string>(),
    };
    return {
        source: decodeNamespaceCatalog("enwiki", {
            query: {
                namespacealiases: [],
                namespaces: {
                    0: { id: 0, name: "" },
                    6: { canonical: "File", id: 6, name: "File" },
                    10: { canonical: "Template", id: 10, name: "Template" },
                    14: { canonical: "Category", id: 14, name: "Category" },
                },
            },
        }),
        redirectsSafe: true,
        templateRedirectsSafe: true,
        templateMagicWords: {
            functions: aliases,
            invoke: aliases,
            variables: aliases,
            modifiers: {
                message: aliases,
                raw: aliases,
                substitution: aliases,
            },
        },
        imageOptions: null,
        ...overrides,
    };
}
