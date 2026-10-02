/**
 * @file src/platform/mediawiki/siteinfo-cache.ts
 * Purpose: Best-effort persistent cache for one wiki's siteinfo response.
 *
 * Table of contents:
 * 1. Constants and state
 * 2. SiteinfoStorage
 * 3. SiteinfoCache
 * 4. createSiteinfoCache
 * 5. availableStorage
 * 6. cacheKey
 * 7. readRecord
 */

const CACHE_PREFIX = "wiked-lite:siteinfo:";
const CACHE_VERSION = 1;
export const SITEINFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SiteinfoStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface SiteinfoCache {
    read(databaseName: string): unknown | null;
    write(databaseName: string, response: unknown): void;
    clear(databaseName: string): void;
}

/**
 * Creates an optional localStorage cache for decoded siteinfo callers.
 *
 * Callers should validate a response before writing it and decode it again
 * after reading. This adapter validates the saved envelope and basic response
 * shape; storage failures always fall back to a cache miss.
 */
export function createSiteinfoCache(
    storage: SiteinfoStorage | null = availableStorage(),
    now: () => number = Date.now,
): SiteinfoCache {
    function clear(databaseName: string): void {
        if (storage == null || databaseName.trim() === "") {
            return;
        }
        try {
            storage.removeItem(cacheKey(databaseName));
        } catch {
            // Browsers may disable localStorage or reject its operations.
        }
    }

    return Object.freeze({
        read(databaseName: string): unknown | null {
            if (storage == null || databaseName.trim() === "") {
                return null;
            }
            let serialized: string | null;
            try {
                serialized = storage.getItem(cacheKey(databaseName));
            } catch {
                return null;
            }
            if (serialized == null) {
                return null;
            }
            try {
                const entry = readRecord(JSON.parse(serialized));
                const response = readRecord(entry?.response);
                const savedAt = entry?.savedAt;
                const age = typeof savedAt === "number" ? now() - savedAt : NaN;
                if (
                    entry?.version !== CACHE_VERSION ||
                    response == null ||
                    readRecord(response.query) == null ||
                    !Number.isFinite(age) ||
                    age < 0 ||
                    age >= SITEINFO_CACHE_TTL_MS
                ) {
                    clear(databaseName);
                    return null;
                }
                return response;
            } catch {
                clear(databaseName);
                return null;
            }
        },
        write(databaseName: string, response: unknown): void {
            if (
                storage == null ||
                databaseName.trim() === "" ||
                readRecord(readRecord(response)?.query) == null
            ) {
                return;
            }
            const savedAt = now();
            if (!Number.isFinite(savedAt)) {
                return;
            }
            try {
                storage.setItem(
                    cacheKey(databaseName),
                    JSON.stringify({
                        response,
                        savedAt,
                        version: CACHE_VERSION,
                    }),
                );
            } catch {
                // A full, disabled, or inaccessible store must not block use.
            }
        },
        clear,
    });
}

function availableStorage(): SiteinfoStorage | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

function cacheKey(databaseName: string): string {
    return CACHE_PREFIX + databaseName;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value != null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}
