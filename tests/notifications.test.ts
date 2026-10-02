/**
 * @file tests/notifications.test.ts
 * Purpose: tests / notifications.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    createActionNotifier,
    type MediaWikiNotificationOptions,
} from "../src/platform/mediawiki/notifications.ts";

test("notification adapter maps warning types and keeps errors visible", () => {
    const captured: Array<{
        message: string;
        options: MediaWikiNotificationOptions;
    }> = [];
    const notify = createActionNotifier("wikEd Lite", (message, options) => {
        captured.push({ message, options });
    });

    notify({
        key: "Save Failed",
        message: "Could not save settings.",
        type: "error",
    });
    notify({
        key: "Lookup",
        message: "Some previews are unavailable.",
        type: "warning",
    });
    notify({ key: "Format", message: "Formatted.", type: "success" });

    assert.deepEqual(captured, [
        {
            message: "Could not save settings.",
            options: {
                autoHide: false,
                tag: "wiked-lite:save-failed",
                type: "error",
            },
        },
        {
            message: "Some previews are unavailable.",
            options: {
                autoHide: true,
                autoHideSeconds: "long",
                tag: "wiked-lite:lookup",
                type: "warn",
            },
        },
        {
            message: "Formatted.",
            options: {
                autoHide: true,
                autoHideSeconds: "short",
                tag: "wiked-lite:format",
                type: "success",
            },
        },
    ]);
});
