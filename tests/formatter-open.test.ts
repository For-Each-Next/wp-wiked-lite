/**
 * @file tests/formatter-open.test.ts
 * Purpose: Formatter-action failure behavior at the ResourceLoader boundary.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 * 3. reportFormatterLoadFailure
 * 4. createServices
 * 5. installFormatterEnvironment
 * 6. installFormatterGlobals
 * 7. captureGlobals
 * 8. restoreGlobals
 * 9. createLogOutput
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createLogger, type LogOutput } from "../src/shared/logging.ts";

import type { ActionNotification } from "../src/shared/notifications.ts";
import type { EditorServices } from "../src/app/editor-contracts.ts";

import { createDefaultFormatterSettings } from "../src/domain/formatter-settings.ts";
import { createFormatterAction } from "../src/features/formatter/action.ts";

test(
    "reports rejected formatter dialog loads through injected ports",
    reportFormatterLoadFailure,
);

test("a superseded formatter load cannot mount a stale dialog or report a stale error", async () => {
    const errors: unknown[][] = [];
    const notifications: ActionNotification[] = [];
    const requests: Array<{
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
    }> = [];
    const restore = installFormatterEnvironment(
        [],
        () =>
            new Promise((resolve, reject) => {
                requests.push({ resolve, reject });
            }),
    );
    const openFormatter = createFormatterAction(
        createServices(errors, notifications),
        () => undefined,
    );

    try {
        const first = openFormatter();
        const second = openFormatter();
        const third = openFormatter();
        requests[0]!.resolve(() => {
            throw new Error("A superseded request must not mount");
        });
        requests[1]!.reject(new Error("A superseded request failed"));
        requests[2]!.reject(new Error("Current request failed"));
        await Promise.all([first, second, third]);
        assert.equal(errors.length, 1);
        assert.equal(notifications.length, 1);
    } finally {
        restore();
    }
});

for (const failure of [
    "component creation",
    "application creation",
    "registration",
    "mount",
    "unmount",
]) {
    test(`dialog ${failure} failures remove the host and permit another open`, async () => {
        const errors: unknown[][] = [];
        const notifications: ActionNotification[] = [];
        const hosts = new Set<object>();
        let shouldFail = true;
        let unmountCount = 0;
        const failAt = (stage: string) => {
            if (
                shouldFail &&
                (failure === stage ||
                    (failure === "unmount" && stage === "mount"))
            ) {
                throw new Error(`Failure during ${stage}`);
            }
        };
        const Vue = {
            defineComponent(component: unknown) {
                failAt("component creation");
                return component;
            },
            createMwApp() {
                failAt("application creation");
                return {
                    component() {
                        failAt("registration");
                    },
                    mount() {
                        failAt("mount");
                    },
                    unmount() {
                        unmountCount += 1;
                        failAt("unmount");
                    },
                };
            },
        };
        const restore = installFormatterEnvironment(
            [],
            async () => (name: string) => (name === "vue" ? Vue : {}),
            hosts,
        );
        const openFormatter = createFormatterAction(
            createServices(errors, notifications),
            () => undefined,
        );

        try {
            await openFormatter();
            assert.equal(hosts.size, 0);
            assert.equal(errors.length, 1);
            assert.equal(notifications.length, 1);
            assert.equal(
                unmountCount,
                failure === "component creation" ||
                    failure === "application creation"
                    ? 0
                    : 1,
            );
            shouldFail = false;
            await openFormatter();
            assert.equal(hosts.size, 1);
            assert.equal(errors.length, 1);
        } finally {
            restore();
        }
    });
}

async function reportFormatterLoadFailure(): Promise<void> {
    const errors: unknown[][] = [];
    const notifications: ActionNotification[] = [];
    const requestedModules: string[][] = [];
    const restore = installFormatterEnvironment(requestedModules);
    const services = createServices(errors, notifications);
    const openFormatter = createFormatterAction(services, () => undefined);

    try {
        await assert.doesNotReject(openFormatter);
    } finally {
        restore();
    }

    assert.deepEqual(requestedModules, [["vue", "@wikimedia/codex"]]);
    assert.match(
        String(errors[0]?.[0]),
        /\[wiked-lite-test\] dialog\.open\.failed$/u,
    );
    assert.deepEqual(notifications, [
        {
            key: "dialog-open-failed",
            message: "Could not open wikEd Lite. Open the tool again.",
            type: "error",
        },
    ]);
}

function createServices(
    errors: unknown[][],
    notifications: ActionNotification[],
): EditorServices {
    return {
        async findMissingLinks() {
            return {
                checkedTitles: new Set(),
                linkClasses: [],
                missingTitles: new Set(),
            };
        },
        getHighlightOptions() {
            return {};
        },
        isSectionEditing: () => false,
        loadFormatterSettings: createDefaultFormatterSettings,
        async loadNamespaces() {},
        async loadPageSource() {
            return "";
        },
        async loadPageSummary() {
            return { kind: "unavailable" };
        },
        logger: createLogger("wiked-lite-test", {
            level: "error",
            output: createLogOutput(errors),
        }),
        notify(notification) {
            notifications.push(notification);
        },
        resetFormatterSettings() {},
        async resolveRedirects(source) {
            return source;
        },
        saveFormatterSettings() {},
    };
}

function installFormatterEnvironment(
    requestedModules: string[][],
    load: () => Promise<unknown> = () =>
        Promise.reject(new Error("Codex unavailable")),
    hosts = new Set<object>(),
): () => void {
    class FakeTextArea {
        readonly marker = "textarea";
        readonly isConnected = true;
    }

    const textarea = new FakeTextArea();
    const properties = ["document", "HTMLTextAreaElement", "mw"] as const;
    const originals = captureGlobals(properties);
    installFormatterGlobals(
        FakeTextArea,
        textarea,
        requestedModules,
        load,
        hosts,
    );
    return () => restoreGlobals(properties, originals);
}

function installFormatterGlobals(
    TextArea: new () => object,
    textarea: object,
    requestedModules: string[][],
    load: () => Promise<unknown>,
    hosts: Set<object>,
): void {
    Object.defineProperty(globalThis, "HTMLTextAreaElement", {
        configurable: true,
        value: TextArea,
    });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement() {
                return {
                    id: "",
                    remove() {
                        hosts.delete(this);
                    },
                };
            },
            documentElement: {
                append(host: object) {
                    hosts.add(host);
                },
            },
            getElementById() {
                return textarea;
            },
        },
    });
    Object.defineProperty(globalThis, "mw", {
        configurable: true,
        value: {
            config: { get: () => undefined },
            util: { getUrl: (title: string) => `/wiki/${title}` },
            loader: {
                using(modules: string[]) {
                    requestedModules.push(modules);
                    return load();
                },
            },
        },
    });
}

function captureGlobals<const Name extends PropertyKey>(
    properties: readonly Name[],
): Map<Name, PropertyDescriptor | undefined> {
    return new Map(
        properties.map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
}

function restoreGlobals<const Name extends PropertyKey>(
    properties: readonly Name[],
    originals: ReadonlyMap<Name, PropertyDescriptor | undefined>,
): void {
    for (const name of properties) {
        const descriptor = originals.get(name);
        if (descriptor == null) {
            Reflect.deleteProperty(globalThis, name);
        } else {
            Object.defineProperty(globalThis, name, descriptor);
        }
    }
}

function createLogOutput(errors: unknown[][]): LogOutput {
    return {
        debug() {},
        error(...values) {
            errors.push(values);
        },
        info() {},
        warn() {},
    };
}
