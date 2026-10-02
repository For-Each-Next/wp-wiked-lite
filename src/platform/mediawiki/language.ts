/**
 * @file src/platform/mediawiki/language.ts
 * Purpose: Reads the host's interface language; catalog resolution remains pure.
 *
 * Table of contents:
 * 1. getInterfaceLanguage
 */

export function getInterfaceLanguage(): string {
    return typeof mw === "undefined"
        ? "en"
        : String(mw.config.get("wgUserLanguage") || "en");
}
