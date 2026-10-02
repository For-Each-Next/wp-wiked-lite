/**
 * @file tests/editor-backend.test.ts
 * Purpose: Verifies exclusive backend ownership and independent cleanup.
 *
 * Table of contents:
 * 1. Imports
 * 2. backend
 * 3. Test scenarios
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    registerEditBoxBackend,
    type EditBoxBackend,
} from "../src/features/editor/edit-box-backend.ts";

function backend(): EditBoxBackend {
    return {
        focus() {},
        read() {
            return "source";
        },
        replaceSelection() {},
        write() {},
        writePreservingPosition() {},
    };
}

test("a second backend cannot displace an active editor", () => {
    const textarea = {} as HTMLTextAreaElement;
    const key = Symbol.for("mediawiki-gadgets.edit-box-backend");
    const target = textarea as unknown as Record<PropertyKey, unknown>;
    const first = backend();
    const disposeFirst = registerEditBoxBackend(textarea, first);
    assert.throws(
        () => registerEditBoxBackend(textarea, backend()),
        /active editor backend/u,
    );
    assert.equal(target[key], first);
    disposeFirst();
    const second = backend();
    const disposeSecond = registerEditBoxBackend(textarea, second);
    disposeFirst();
    assert.equal(target[key], second);
    disposeSecond();
    assert.equal(target[key], undefined);
});

test("cleanup preserves a backend installed by a different owner", () => {
    const textarea = {} as HTMLTextAreaElement;
    const key = Symbol.for("mediawiki-gadgets.edit-box-backend");
    const target = textarea as unknown as Record<PropertyKey, unknown>;
    const dispose = registerEditBoxBackend(textarea, backend());
    const replacement = backend();
    target[key] = replacement;
    dispose();
    assert.equal(target[key], replacement);
});
