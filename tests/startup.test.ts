import assert from "node:assert/strict";
import test from "node:test";

test("startup defers host utilities until the editor and ResourceLoader are ready", async (context) => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = new Map<string, PropertyDescriptor | undefined>();
    let waitsForDocument = false;
    const stubs = {
        window: {
            wikEdLiteConfig: { logLevel: "silent" },
            location: { origin: "https://wiki.example.test" },
        },
        document: {
            readyState: "loading",
            addEventListener() {
                waitsForDocument = true;
            },
        },
        mw: {
            config: { get: () => undefined },
            loader: {
                using: async () =>
                    assert.fail(
                        "ResourceLoader must wait for document readiness",
                    ),
            },
        },
    };
    for (const [key, value] of Object.entries(stubs)) {
        previous.set(key, Object.getOwnPropertyDescriptor(globals, key));
        Object.defineProperty(globals, key, {
            configurable: true,
            value,
            writable: true,
        });
    }
    context.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor == null) {
                delete globals[key];
            } else {
                Object.defineProperty(globals, key, descriptor);
            }
        }
    });

    const { start } = await import("../src/app/main.ts");
    assert.doesNotThrow(start);
    assert.equal(waitsForDocument, true);
});
