/**
 * @file tests/logging.test.ts
 * Purpose: tests / logging.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 * 3. output
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../src/shared/logging.ts";

test("structured logs redact source, titles, credentials, URLs and exception messages", () => {
    const captured: unknown[][] = [];
    const logger = createLogger("wiki", {
        level: "warn",
        output: output(captured),
    });

    logger.child("editor").warn("lookup.failed", {
        source: "Private article text",
        title: "Private page",
        token: "secret token",
        nested: { password: "secret password", count: 2 },
        error: new Error("Private request failed"),
        reason: "Connection to https://example.test/private failed",
    });

    assert.deepEqual(captured, [
        [
            "[wiki][editor] lookup.failed",
            {
                source: "[redacted]",
                title: "[redacted]",
                token: "[redacted]",
                nested: { password: "[redacted]", count: 2 },
                error: { name: "Error", message: "[redacted]" },
                reason: "Connection to [url] failed",
            },
        ],
    ]);
});

test("log levels filter messages and timers stop exactly once", () => {
    const captured: unknown[][] = [];
    const logger = createLogger("wiki", {
        level: "warn",
        output: output(captured),
    });
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("visible");
    assert.deepEqual(captured, [["[wiki] visible"]]);

    let now = 10;
    const debug = createLogger("wiki", {
        level: "debug",
        now: () => now,
        output: output(captured),
    });
    const stop = debug.startTimer("load", { itemCount: 3 });
    now = 25;
    stop({ outcome: "success" });
    stop({ outcome: "duplicate" });
    assert.deepEqual(captured[1], [
        "[wiki] load.completed",
        {
            initial: { itemCount: 3 },
            completion: { outcome: "success" },
            durationMs: 15,
        },
    ]);
    assert.equal(captured.length, 2);
});

function output(captured: unknown[][]) {
    const capture = (...values: unknown[]) => {
        captured.push(values);
    };
    return { debug: capture, error: capture, info: capture, warn: capture };
}
