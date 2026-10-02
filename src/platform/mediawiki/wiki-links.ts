/**
 * @file src/platform/mediawiki/wiki-links.ts
 * Purpose: MediaWiki redirect and missing-page lookup, batched to API limits.
 *
 * Table of contents:
 * 1. Imports
 * 2. WikiLinkApi
 * 3. QueryPage
 * 4. QueryTitleMapping
 * 5. QueryResponse
 * 6. LookupMergeContext
 * 7. lookupWikiLinks
 * 8. mergeLookup
 * 9. mergeRequestedTitle
 * 10. buildTitleMap
 * 11. buildRedirectMap
 * 12. resolveTitleAlias
 * 13. appendTitleFragment
 * 14. stripTitleFragment
 * 15. getTitleFragment
 */

import type { WikiLinkLookup } from "../../domain/wiki-links.ts";
import { normalizeWikitextTitleKey } from "../../domain/wiki-titles.ts";

export interface WikiLinkApi {
    get(parameters: Record<string, unknown>): PromiseLike<unknown>;
}

interface QueryPage {
    invalid?: boolean;
    linkclasses?: string[];
    missing?: boolean;
    title: string;
}

interface QueryTitleMapping {
    from: string;
    to: string;
    tofragment?: string;
}

interface QueryResponse {
    query?: {
        converted?: QueryTitleMapping[];
        interwiki?: Array<{ title: string }>;
        normalized?: QueryTitleMapping[];
        pages?: QueryPage[];
        redirects?: QueryTitleMapping[];
    };
}

interface LookupMergeContext {
    aliases: ReadonlyMap<string, string>;
    interwiki: ReadonlySet<string>;
    pages: ReadonlyMap<string, QueryPage>;
    redirects: ReadonlyMap<string, string>;
}

/**
 * Looks up redirect targets and missing pages in API-sized batches.
 *
 * @param api - MediaWiki API client.
 * @param titles - Titles value.
 * @returns Operation result.
 */
export async function lookupWikiLinks(
    api: WikiLinkApi,
    titles: string[],
): Promise<WikiLinkLookup> {
    const lookup: WikiLinkLookup = {
        missing: new Set<string>(),
        missingLinkClasses: [],
        redirects: new Map<string, string>(),
    };
    for (let start = 0; start < titles.length; start += 50) {
        const batch = titles.slice(start, start + 50);
        const response = (await api.get({
            action: "query",
            converttitles: 1,
            formatversion: 2,
            inprop: "linkclasses",
            iwurl: 1,
            prop: "info",
            redirects: 1,
            titles: batch.join("|"),
        })) as QueryResponse;
        mergeLookup(lookup, batch, response.query);
    }
    return lookup;
}

function mergeLookup(
    target: WikiLinkLookup,
    requestedTitles: string[],
    query: QueryResponse["query"],
): void {
    const aliases = buildTitleMap([
        ...(query?.normalized ?? []),
        ...(query?.converted ?? []),
    ]);
    const redirects = buildRedirectMap(query?.redirects ?? []);
    const pages = new Map(
        (query?.pages ?? []).map((page) => [
            normalizeWikitextTitleKey(page.title),
            page,
        ]),
    );
    const interwiki = new Set(
        (query?.interwiki ?? []).map((page) =>
            normalizeWikitextTitleKey(page.title),
        ),
    );
    const context = { aliases, interwiki, pages, redirects };

    for (const enteredTitle of requestedTitles) {
        mergeRequestedTitle(target, enteredTitle, context);
    }
}

function mergeRequestedTitle(
    target: WikiLinkLookup,
    enteredTitle: string,
    context: LookupMergeContext,
): void {
    const enteredKey = normalizeWikitextTitleKey(enteredTitle);
    const convertedTitle = resolveTitleAlias(enteredTitle, context.aliases);
    const resolvedTitle = resolveTitleAlias(convertedTitle, context.redirects);
    if (
        normalizeWikitextTitleKey(convertedTitle) !==
        normalizeWikitextTitleKey(resolvedTitle)
    ) {
        target.redirects.set(enteredKey, resolvedTitle);
    }
    const resolvedKey = normalizeWikitextTitleKey(
        stripTitleFragment(resolvedTitle),
    );
    const page = context.pages.get(resolvedKey);
    if (
        context.interwiki.has(resolvedKey) ||
        (page != null && page.invalid !== true && page.missing !== true)
    ) {
        return;
    }
    target.missing.add(enteredKey);
    if (target.missingLinkClasses.length === 0 && page?.linkclasses != null) {
        target.missingLinkClasses = page.linkclasses
            .map((name) => String(name).trim())
            .filter(Boolean);
    }
}

function buildTitleMap(mappings: QueryTitleMapping[]): Map<string, string> {
    return new Map(
        mappings.map((mapping) => [
            normalizeWikitextTitleKey(mapping.from),
            mapping.to,
        ]),
    );
}

function buildRedirectMap(mappings: QueryTitleMapping[]): Map<string, string> {
    return new Map(
        mappings.map((mapping) => [
            normalizeWikitextTitleKey(mapping.from),
            appendTitleFragment(mapping.to, mapping.tofragment),
        ]),
    );
}

function resolveTitleAlias(
    title: string,
    aliases: ReadonlyMap<string, string>,
): string {
    let current = stripTitleFragment(title);
    let fragment = getTitleFragment(title);
    const visited = new Set<string>();
    let key = normalizeWikitextTitleKey(current);
    while (aliases.has(key) && !visited.has(key)) {
        visited.add(key);
        const mapped = aliases.get(key) ?? current;
        current = stripTitleFragment(mapped);
        fragment ||= getTitleFragment(mapped);
        key = normalizeWikitextTitleKey(current);
    }
    return `${current}${fragment}`;
}

function appendTitleFragment(title: string, fragment?: string): string {
    return fragment == null || fragment === ""
        ? title
        : `${stripTitleFragment(title)}#${fragment}`;
}

function stripTitleFragment(title: string): string {
    return title.split("#", 1)[0] ?? title;
}

function getTitleFragment(title: string): string {
    const fragmentStart = title.indexOf("#");
    return fragmentStart < 0 ? "" : title.slice(fragmentStart);
}
