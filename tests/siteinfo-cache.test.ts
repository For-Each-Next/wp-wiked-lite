/**
 * @file tests/siteinfo-cache.test.ts
 * Purpose: tests / siteinfo cache.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 * 3. memoryStorage
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    createSiteinfoCache,
    SITEINFO_CACHE_TTL_MS,
    type SiteinfoStorage,
} from "../src/platform/mediawiki/siteinfo-cache.ts";

test("siteinfo cache persists by wiki for 24 hours", () => {
    const items = new Map<string, string>();
    let currentTime = 0;
    const cache = createSiteinfoCache(memoryStorage(items), () => currentTime);
    const firstResponse = { query: { namespaces: { 6: { name: "File" } } } };
    const secondResponse = { query: { namespaces: { 6: { name: "Asset" } } } };

    cache.write("firstwiki", firstResponse);
    currentTime = 60 * 60 * 1000;
    cache.write("secondwiki", secondResponse);

    assert.deepEqual(cache.read("firstwiki"), firstResponse);
    assert.deepEqual(cache.read("secondwiki"), secondResponse);
    assert.equal(items.size, 2);

    currentTime = SITEINFO_CACHE_TTL_MS;
    assert.equal(cache.read("firstwiki"), null);
    assert.deepEqual(cache.read("secondwiki"), secondResponse);
    assert.equal(items.size, 1);
});

test("siteinfo cache removes malformed, invalid, and future entries", () => {
    const items = new Map<string, string>();
    const cache = createSiteinfoCache(memoryStorage(items), () => 100);
    const response = { query: { namespaces: {} } };
    cache.write("examplewiki", response);
    const key = [...items.keys()][0];
    assert.ok(key != null);

    for (const invalid of [
        "{bad json",
        JSON.stringify({ version: 2, savedAt: 100, response }),
        JSON.stringify({ version: 1, savedAt: 101, response }),
        JSON.stringify({ version: 1, savedAt: 100, response: { query: [] } }),
    ]) {
        items.set(key, invalid);
        assert.equal(cache.read("examplewiki"), null);
        assert.equal(items.has(key), false);
    }

    cache.write("examplewiki", { query: null });
    assert.equal(items.size, 0);
});

test("siteinfo cache tolerates unavailable and throwing storage", () => {
    const response = { query: { namespaces: {} } };
    const unavailable = createSiteinfoCache(null);
    assert.equal(unavailable.read("examplewiki"), null);
    assert.doesNotThrow(() => unavailable.write("examplewiki", response));
    assert.doesNotThrow(() => unavailable.clear("examplewiki"));

    const throwing: SiteinfoStorage = {
        getItem() {
            throw new Error("storage denied");
        },
        setItem() {
            throw new Error("storage full");
        },
        removeItem() {
            throw new Error("storage denied");
        },
    };
    const cache = createSiteinfoCache(throwing);
    assert.equal(cache.read("examplewiki"), null);
    assert.doesNotThrow(() => cache.write("examplewiki", response));
    assert.doesNotThrow(() => cache.clear("examplewiki"));
});

function memoryStorage(items: Map<string, string>): SiteinfoStorage {
    return {
        getItem(key) {
            return items.get(key) ?? null;
        },
        setItem(key, value) {
            items.set(key, value);
        },
        removeItem(key) {
            items.delete(key);
        },
    };
}
