/**
 * @file tests/editor-features.test.ts
 * Purpose: tests / editor features.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 * 3. testLiveLinkChecks
 * 4. testEditorPresentationSettings
 * 5. testReferenceSettings
 * 6. testOptionalWholePageSource
 * 7. FeatureHarness
 * 8. Deferred
 * 9. deferred
 * 10. missing
 * 11. settlePromises
 * 12. FakeTimer
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as settings from "../src/domain/formatter-settings.ts";
import {
    classifyLinkCheck,
    createEditorFeatureController,
    type EditorFeatureOptions,
    type EditorFeatureTimer,
    type MissingLinkResult,
} from "../src/features/editor/feature-settings.ts";

test(
    "live link checks debounce edits and ignore stale results",
    testLiveLinkChecks,
);

async function testLiveLinkChecks(): Promise<void> {
    const harness = new FeatureHarness();
    const controller = createEditorFeatureController(harness.options);
    const enabled = {
        ...harness.options.initialSettings,
        highlightMissing: true,
    };

    controller.setSettings(enabled);
    assert.deepEqual(harness.missingResults, [missing()]);
    assert.deepEqual(harness.timer.delays(), [0]);
    harness.timer.runNext();
    assert.deepEqual(harness.requestedSources, ["First"]);

    harness.source.value = "Second";
    controller.sourceChanged();
    assert.deepEqual(harness.timer.delays(), [500]);
    harness.requests[0].resolve(missing("Old"));
    await settlePromises();
    assert.deepEqual(harness.missingResults, [missing()]);

    harness.timer.runNext();
    harness.requests[1].resolve(missing("New"));
    await settlePromises();
    assert.deepEqual(harness.missingResults, [missing(), missing("New")]);

    controller.setSettings({ ...enabled, highlightMissing: false });
    assert.deepEqual(harness.missingResults.at(-1), missing());

    controller.setSettings(enabled);
    assert.deepEqual(harness.missingResults.at(-1), missing());
    harness.timer.runNext();
    controller.destroy();
    harness.requests[2].resolve(missing("Destroyed"));
    await settlePromises();
    controller.sourceChanged();
    assert.deepEqual(harness.missingResults.at(-1), missing());
    assert.deepEqual(harness.timer.delays(), []);
}

test("links distinguish checked, missing, and newly entered targets", () => {
    const acceptedState = {
        checkedTitles: new Set(["Existing page", "Missing page"]),
        enabled: true,
        missingTitles: new Set(["Missing page"]),
    };

    assert.equal(
        classifyLinkCheck(" Existing_page ", acceptedState),
        "checked",
    );
    assert.equal(classifyLinkCheck("Missing_page", acceptedState), "missing");
    assert.equal(classifyLinkCheck("New page", acceptedState), "unchecked");
    assert.equal(
        classifyLinkCheck("Missing page", {
            ...acceptedState,
            enabled: false,
        }),
        "disabled",
    );

    const replacedState = {
        checkedTitles: new Set(["New page"]),
        enabled: true,
        missingTitles: new Set(["New page"]),
    };
    assert.equal(classifyLinkCheck("New page", replacedState), "missing");
});

test("only current missing-link failures are reported", async () => {
    const harness = new FeatureHarness();
    const controller = createEditorFeatureController(harness.options);
    const enabled = {
        ...harness.options.initialSettings,
        highlightMissing: true,
    };
    controller.setSettings(enabled);
    harness.timer.runNext();
    const failure = new Error("lookup failed");
    harness.requests[0].reject(failure);
    await settlePromises();
    assert.deepEqual(harness.errors, [[failure, "links"]]);
    assert.deepEqual(harness.missingResults, [missing()]);

    harness.source.value = "Changed";
    controller.sourceChanged();
    harness.timer.runNext();
    controller.setSettings({ ...enabled, highlightMissing: false });
    harness.requests[1].reject(new Error("stale failure"));
    await settlePromises();
    assert.deepEqual(harness.errors, [[failure, "links"]]);
});

test("a failed refresh retains the last accepted link result", async () => {
    const harness = new FeatureHarness();
    const controller = createEditorFeatureController(harness.options);
    controller.setSettings({
        ...harness.options.initialSettings,
        highlightMissing: true,
    });
    harness.timer.runNext();
    harness.requests[0].resolve(missing("Stable"));
    await settlePromises();

    harness.source.value = "Changed";
    controller.sourceChanged();
    harness.timer.runNext();
    const failure = new Error("refresh failed");
    harness.requests[1].reject(failure);
    await settlePromises();

    assert.deepEqual(harness.missingResults, [missing(), missing("Stable")]);
    assert.deepEqual(harness.errors, [[failure, "links"]]);
});

test(
    "reference settings apply immediately and cache section source",
    testReferenceSettings,
);

test(
    "editor presentation settings apply immediately and only when changed",
    testEditorPresentationSettings,
);

function testEditorPresentationSettings(): void {
    const harness = new FeatureHarness();
    const controller = createEditorFeatureController({
        ...harness.options,
        initialSettings: {
            ...harness.options.initialSettings,
            largeFont: true,
            smallReferenceText: false,
        },
    });

    assert.deepEqual(harness.largeFontStates, [true]);
    assert.deepEqual(harness.smallReferenceTextStates, [false]);

    controller.setSettings(controller.getSettings());
    assert.deepEqual(harness.largeFontStates, [true]);
    assert.deepEqual(harness.smallReferenceTextStates, [false]);

    controller.setSettings({
        ...controller.getSettings(),
        largeFont: false,
        smallReferenceText: true,
    });
    assert.deepEqual(harness.largeFontStates, [true, false]);
    assert.deepEqual(harness.smallReferenceTextStates, [false, true]);
}

async function testReferenceSettings(): Promise<void> {
    const harness = new FeatureHarness(true);
    const controller = createEditorFeatureController(harness.options);

    controller.setSettings({
        ...harness.options.initialSettings,
        fullPageReferencePreviews: true,
        referencePreviews: false,
    });
    assert.deepEqual(harness.previewStates, [true, false]);
    assert.equal(harness.pageRequests.length, 0);
    assert.equal(controller.getReferenceFallbackSource(), null);
    assert.deepEqual(harness.timer.delays(), []);

    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: true,
    });
    assert.equal(harness.pageRequests.length, 1);
    harness.pageRequests[0].resolve("Whole page");
    await settlePromises();
    assert.equal(controller.getReferenceFallbackSource(), "Whole page");

    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: false,
    });
    assert.equal(controller.getReferenceFallbackSource(), null);
    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: true,
    });
    assert.equal(harness.pageRequests.length, 1);
    assert.equal(controller.getReferenceFallbackSource(), "Whole page");

    controller.setSettings({
        ...controller.getSettings(),
        fullPageReferencePreviews: false,
    });
    assert.equal(controller.getReferenceFallbackSource(), null);
    controller.setSettings({
        ...controller.getSettings(),
        fullPageReferencePreviews: true,
    });
    assert.equal(harness.pageRequests.length, 1);
}

test("disabled reference previews do not fetch whole-page source", () => {
    const sectionEdit = new FeatureHarness(true);
    const controller = createEditorFeatureController({
        ...sectionEdit.options,
        initialSettings: {
            ...sectionEdit.options.initialSettings,
            fullPageReferencePreviews: true,
            referencePreviews: false,
        },
    });

    assert.equal(sectionEdit.pageRequests.length, 0);
    assert.equal(controller.getReferenceFallbackSource(), null);
    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: true,
    });
    assert.equal(sectionEdit.pageRequests.length, 1);
});

test("plain text pauses lookups and previews while retaining their preferences", async () => {
    const harness = new FeatureHarness(true);
    const controller = createEditorFeatureController({
        ...harness.options,
        initialSettings: {
            ...harness.options.initialSettings,
            syntaxHighlighting: false,
            highlightMissing: true,
            fullPageReferencePreviews: true,
        },
    });
    controller.sourceChanged();
    controller.clearCache();
    assert.deepEqual(harness.timer.delays(), []);
    assert.equal(harness.pageRequests.length, 0);
    assert.deepEqual(harness.previewStates, [false]);
    assert.equal(controller.getSettings().referencePreviews, true);
    assert.equal(controller.getSettings().highlightMissing, true);

    controller.setSettings({
        ...controller.getSettings(),
        syntaxHighlighting: true,
    });
    assert.deepEqual(harness.timer.delays(), [0]);
    assert.equal(harness.pageRequests.length, 1);
    assert.deepEqual(harness.previewStates, [false, true]);
    harness.timer.runNext();
    controller.setSettings({
        ...controller.getSettings(),
        syntaxHighlighting: false,
    });
    harness.requests[0].resolve(missing("Stale"));
    await settlePromises();
    assert.deepEqual(harness.timer.delays(), []);
    assert.deepEqual(harness.missingResults.at(-1), missing());
    assert.deepEqual(harness.previewStates, [false, true, false]);
});

test("clear cache drops link and reference data and rejects earlier responses", async () => {
    const harness = new FeatureHarness(true);
    const controller = createEditorFeatureController({
        ...harness.options,
        initialSettings: {
            ...harness.options.initialSettings,
            highlightMissing: true,
            fullPageReferencePreviews: true,
        },
    });
    harness.timer.runNext();
    harness.requests[0].resolve(missing("Old"));
    harness.pageRequests[0].resolve("Old page");
    await settlePromises();
    assert.equal(controller.getReferenceFallbackSource(), "Old page");
    assert.deepEqual(harness.missingResults.at(-1), missing("Old"));

    controller.clearCache();
    assert.equal(controller.getReferenceFallbackSource(), null);
    assert.deepEqual(harness.missingResults.at(-1), missing());
    harness.timer.runNext();
    controller.clearCache();
    harness.timer.runNext();
    // The same source can have a newer response after a cache clear.
    harness.requests[1].resolve(missing("Stale"));
    harness.pageRequests[1].resolve("Stale page");
    await settlePromises();
    assert.equal(controller.getReferenceFallbackSource(), null);
    assert.deepEqual(harness.missingResults.at(-1), missing());
    // Completion of the old request must not release the current request lock.
    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: false,
    });
    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: true,
    });
    assert.equal(harness.pageRequests.length, 3);
    harness.requests[2].resolve(missing("Fresh"));
    harness.pageRequests[2].resolve("Fresh page");
    await settlePromises();
    assert.equal(controller.getReferenceFallbackSource(), "Fresh page");
    assert.deepEqual(harness.missingResults.at(-1), missing("Fresh"));
});

test("failures from before a cache clear cannot report or replace current data", async () => {
    const harness = new FeatureHarness(true);
    const controller = createEditorFeatureController({
        ...harness.options,
        initialSettings: {
            ...harness.options.initialSettings,
            highlightMissing: true,
            fullPageReferencePreviews: true,
        },
    });
    harness.timer.runNext();
    controller.clearCache();
    harness.requests[0].reject(new Error("Stale link failure"));
    harness.pageRequests[0].reject(new Error("Stale page failure"));
    await settlePromises();
    assert.deepEqual(harness.errors, []);
    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: false,
    });
    controller.setSettings({
        ...controller.getSettings(),
        referencePreviews: true,
    });
    assert.equal(harness.pageRequests.length, 2);
});

test(
    "whole-page source stays optional and reports failures",
    testOptionalWholePageSource,
);

async function testOptionalWholePageSource(): Promise<void> {
    const wholeEdit = new FeatureHarness(false);
    createEditorFeatureController({
        ...wholeEdit.options,
        initialSettings: {
            ...wholeEdit.options.initialSettings,
            fullPageReferencePreviews: true,
        },
    });
    assert.equal(wholeEdit.pageRequests.length, 0);

    const sectionEdit = new FeatureHarness(true);
    const controller = createEditorFeatureController({
        ...sectionEdit.options,
        initialSettings: {
            ...sectionEdit.options.initialSettings,
            fullPageReferencePreviews: true,
        },
    });
    const failure = new Error("API unavailable");
    sectionEdit.pageRequests[0].reject(failure);
    await settlePromises();

    assert.deepEqual(sectionEdit.errors, [[failure, "page-source"]]);
    assert.equal(controller.getReferenceFallbackSource(), null);
}

class FeatureHarness {
    readonly errors: Array<[unknown, "links" | "page-source"]> = [];
    readonly largeFontStates: boolean[] = [];
    readonly missingResults: MissingLinkResult[] = [];
    readonly options: EditorFeatureOptions;
    readonly pageRequests: Array<Deferred<string>> = [];
    readonly previewStates: boolean[] = [];
    readonly requestedSources: string[] = [];
    readonly requests: Array<Deferred<MissingLinkResult>> = [];
    readonly smallReferenceTextStates: boolean[] = [];
    readonly source = { value: "First" };
    readonly timer = new FakeTimer();

    constructor(sectionEditing = false) {
        const defaults = settings.createDefaultFormatterSettings();
        this.options = {
            findMissingLinks: (value) => this.findMissingLinks(value),
            getSource: () => this.source.value,
            initialSettings: settings.getEditorFeatureSettings(defaults),
            loadPageSource: () => this.loadPageSource(),
            onError: (error, operation) => this.errors.push([error, operation]),
            onLargeFont: (value) => this.largeFontStates.push(value),
            onMissingLinks: (result) => this.missingResults.push(result),
            onReferencePreviews: (value) => this.previewStates.push(value),
            onSmallReferenceText: (value) =>
                this.smallReferenceTextStates.push(value),
            sectionEditing,
            timer: this.timer,
        };
    }

    private findMissingLinks(value: string): Promise<MissingLinkResult> {
        this.requestedSources.push(value);
        const request = deferred<MissingLinkResult>();
        this.requests.push(request);
        return request.promise;
    }

    private loadPageSource(): Promise<string> {
        const request = deferred<string>();
        this.pageRequests.push(request);
        return request.promise;
    }
}

interface Deferred<T> {
    promise: Promise<T>;

    reject(reason: unknown): void;

    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let reject: (reason: unknown) => void =
        function rejectBeforeInitialization(): void {};
    let resolve: (value: T) => void =
        function resolveBeforeInitialization(): void {};
    const promise = new Promise<T>(function capture(onResolve, onReject) {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, reject, resolve };
}

function missing(...titles: string[]): MissingLinkResult {
    return {
        checkedTitles: new Set(titles),
        linkClasses: [],
        missingTitles: new Set(titles),
    };
}

async function settlePromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

class FakeTimer implements EditorFeatureTimer {
    private nextHandle = 1;
    private readonly pending = new Map<
        number,
        { callback(): void; delay: number }
    >();

    clear(handle: number): void {
        this.pending.delete(handle);
    }

    delays(): number[] {
        return [...this.pending.values()].map((item) => item.delay);
    }

    runNext(): void {
        const entry = this.pending.entries().next().value;
        if (entry == null) {
            throw new Error("No timer is pending.");
        }
        const [handle, item] = entry;
        this.pending.delete(handle);
        item.callback();
    }

    set(callback: () => void, delay: number): number {
        const handle = this.nextHandle;
        this.nextHandle += 1;
        this.pending.set(handle, { callback, delay });
        return handle;
    }
}
