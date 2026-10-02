/**
 * @file src/platform/mediawiki/editor-context.ts
 * Purpose: Reads editor state exposed by the current MediaWiki page.
 *
 * Table of contents:
 * 1. getDatabaseName
 * 2. getRevisionId
 * 3. isSectionEditing
 */

export function getDatabaseName(): string {
    return String(mw.config.get("wgWikiID") ?? mw.config.get("wgDBname") ?? "");
}

export function getRevisionId(): number {
    return Number(mw.config.get("wgCurRevisionId"));
}

export function isSectionEditing(): boolean {
    if (mw.config.get("wgEditMessage") === "editingsection") {
        return true;
    }
    const section = document.querySelector<HTMLInputElement>(
        'input[name="wpSection"]',
    );
    return section != null && section.value !== "";
}
