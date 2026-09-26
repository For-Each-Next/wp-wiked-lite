/** Current-wiki namespace and magic-word discovery through siteinfo. */

import type { Logger } from "../../shared/logging.ts";
import {
    decodeNamespaceCatalog,
    getNamespacePrefixes,
    type NamespaceCatalog,
    type NamespaceSource,
} from "../../domain/wiki-titles.ts";
import { type ImageOptionCatalog } from "../../domain/highlighter.ts";
import type { WikiNamespaceState } from "../../domain/wiki-site.ts";

import type {
    MagicWordAliases,
    TemplateMagicWordCatalog,
} from "../../domain/magic-words.ts";
import { createSiteinfoCache, type SiteinfoCache } from "./siteinfo-cache.ts";

interface WikiNamespaceApi {
    get(parameters: Record<string, unknown>): PromiseLike<unknown>;
}

export interface WikiNamespaceResolver {
    current(): WikiNamespaceState;

    load(api: WikiNamespaceApi): Promise<WikiNamespaceState>;
}

const CANONICAL_FALLBACK_SOURCE = decodeNamespaceCatalog("unknownwiki", {
    query: {
        namespacealiases: [],
        namespaces: {
            0: { canonical: "", id: 0, name: "" },
            6: { canonical: "File", id: 6, name: "File" },
            10: { canonical: "Template", id: 10, name: "Template" },
            14: { canonical: "Category", id: 14, name: "Category" },
        },
    },
});
const FALLBACK_STATE = createState(
    CANONICAL_FALLBACK_SOURCE,
    false,
    null,
    null,
);

interface LoadedSiteinfo {
    source: NamespaceCatalog;
    templateMagicWords: TemplateMagicWordCatalog | null;
    imageOptions: ImageOptionCatalog | null;
}

interface MagicWordRecord {
    aliases: string[];
    caseSensitive: boolean;
}

const MODIFIER_MAGIC_WORDS = Object.freeze({
    message: ["msg", "msgnw"],
    raw: ["raw"],
    substitution: ["subst", "safesubst"],
} as const);

/**
 * Creates a namespace resolver for one MediaWiki database. A fresh browser
 * cache is decoded before the editor mounts; otherwise siteinfo is requested
 * in the background. Failed requests leave redirect rewriting disabled and
 * may be retried.
 *
 * @param databaseName - Current MediaWiki database name.
 * @returns Namespace resolver.
 */
export function createWikiNamespaceResolver(
    databaseName: string,
    logger?: Logger,
    cache: SiteinfoCache = createSiteinfoCache(),
): WikiNamespaceResolver {
    let state = readCachedState(databaseName, cache) ?? FALLBACK_STATE;
    let pending: Promise<WikiNamespaceState> | null = null;

    return Object.freeze({
        current(): WikiNamespaceState {
            return state;
        },
        load(api: WikiNamespaceApi): Promise<WikiNamespaceState> {
            if (state.redirectsSafe && state.templateRedirectsSafe) {
                return Promise.resolve(state);
            }
            if (pending != null) {
                return pending;
            }
            pending = loadSiteinfo(api, databaseName)
                .then(function useCatalog(siteinfo) {
                    state = createState(
                        siteinfo.source,
                        true,
                        siteinfo.templateMagicWords,
                        siteinfo.imageOptions,
                    );
                    if (siteinfo.templateMagicWords != null) {
                        cache.write(databaseName, siteinfo.response);
                    }
                    return state;
                })
                .catch(function retainFallback(error) {
                    logger?.warn("load.failed", { databaseName, error });
                    return state;
                })
                .finally(function clearPending() {
                    pending = null;
                });
            return pending;
        },
    });
}

function readCachedState(
    databaseName: string,
    cache: SiteinfoCache,
): WikiNamespaceState | null {
    const response = cache.read(databaseName);
    if (response == null) {
        return null;
    }
    try {
        const siteinfo = decodeSiteinfo(response, databaseName);
        if (siteinfo.templateMagicWords == null) {
            cache.clear(databaseName);
            return null;
        }
        return createState(
            siteinfo.source,
            true,
            siteinfo.templateMagicWords,
            siteinfo.imageOptions,
        );
    } catch {
        cache.clear(databaseName);
        return null;
    }
}

async function loadSiteinfo(
    api: WikiNamespaceApi,
    databaseName: string,
): Promise<LoadedSiteinfo & { response: unknown }> {
    const response = await api.get({
        action: "query",
        formatversion: "2",
        meta: "siteinfo",
        siprop:
            "namespaces|namespacealiases|magicwords|variables|" +
            "functionhooks",
    });
    return { ...decodeSiteinfo(response, databaseName), response };
}

function decodeSiteinfo(
    response: unknown,
    databaseName: string,
): LoadedSiteinfo {
    const source = decodeNamespaceCatalog(databaseName, response);
    for (const namespaceId of [6, 10, 14]) {
        if (getNamespacePrefixes(source, namespaceId).length === 0) {
            const message =
                `Missing namespace ${namespaceId} ` + `for ${databaseName}.`;
            throw new TypeError(message);
        }
    }
    const query = readRecord(readRecord(response)?.query);
    const records = decodeMagicWordRecords(query?.magicwords);
    return {
        source,
        templateMagicWords: decodeTemplateMagicWords(query, records),
        imageOptions: decodeImageOptions(records),
    };
}

function decodeTemplateMagicWords(
    query: Record<string, unknown> | null,
    records: ReadonlyMap<string, MagicWordRecord> | null,
): TemplateMagicWordCatalog | null {
    const variableIds = readStringList(query?.variables);
    const functionIds = readStringList(query?.functionhooks);
    if (records == null || variableIds == null || functionIds == null) {
        return null;
    }
    const variables = createAliasCatalog(variableIds, records);
    const functions = createAliasCatalog(functionIds, records);
    const modifiers = decodeModifierAliases(records);
    const invoke =
        functionIds.includes("invoke") && records.has("invoke")
            ? createAliasCatalog(["invoke"], records)
            : emptyAliases();
    if (
        variables == null ||
        functions == null ||
        modifiers == null ||
        invoke == null
    ) {
        return null;
    }
    return Object.freeze({ functions, invoke, modifiers, variables });
}

function decodeImageOptions(
    records: ReadonlyMap<string, MagicWordRecord> | null,
): ImageOptionCatalog | null {
    if (records == null) {
        return null;
    }
    const literals = emptyAliasSets();
    const named = emptyAliasSets();
    const spaced = emptyAliasSets();
    const underscored = emptyAliasSets();
    for (const [id, record] of records) {
        if (!id.startsWith("img_")) {
            continue;
        }
        for (const alias of record.aliases) {
            let target = literals;
            let key = alias;
            if (alias.endsWith("=$1")) {
                target = named;
                key = alias.slice(0, -3);
            } else if (alias.endsWith(" $1")) {
                target = spaced;
                key = alias.slice(0, -3);
            } else if (alias.endsWith("_$1")) {
                target = underscored;
                key = alias.slice(0, -3);
            } else if (alias.includes("$1")) {
                continue;
            }
            if (key !== "") {
                const aliases = record.caseSensitive
                    ? target.caseSensitive
                    : target.caseInsensitive;
                aliases.add(record.caseSensitive ? key : key.toLowerCase());
            }
        }
    }
    return Object.freeze({
        literals: freezeAliases(literals),
        named: freezeAliases(named),
        spaced: freezeAliases(spaced),
        underscored: freezeAliases(underscored),
    });
}

function decodeMagicWordRecords(
    value: unknown,
): Map<string, MagicWordRecord> | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const records = new Map<string, MagicWordRecord>();
    for (const item of value) {
        const record = readRecord(item);
        const name = readNonemptyString(record?.name);
        const aliases = readStringList(record?.aliases);
        const caseSensitive = record?.["case-sensitive"];
        if (
            name == null ||
            aliases == null ||
            aliases.length === 0 ||
            typeof caseSensitive !== "boolean" ||
            records.has(name)
        ) {
            return null;
        }
        records.set(name, { aliases, caseSensitive });
    }
    return records;
}

function decodeModifierAliases(
    records: ReadonlyMap<string, MagicWordRecord>,
): TemplateMagicWordCatalog["modifiers"] | null {
    const message = createAliasCatalog(MODIFIER_MAGIC_WORDS.message, records);
    const raw = createAliasCatalog(MODIFIER_MAGIC_WORDS.raw, records);
    const substitution = createAliasCatalog(
        MODIFIER_MAGIC_WORDS.substitution,
        records,
    );
    return message == null || raw == null || substitution == null
        ? null
        : Object.freeze({ message, raw, substitution });
}

function createAliasCatalog(
    ids: readonly string[],
    records: ReadonlyMap<string, MagicWordRecord>,
): MagicWordAliases | null {
    const aliases = emptyAliasSets();
    for (const id of ids) {
        const record = records.get(id);
        if (record == null) {
            return null;
        }
        const target = record.caseSensitive
            ? aliases.caseSensitive
            : aliases.caseInsensitive;
        for (const entered of record.aliases) {
            target.add(record.caseSensitive ? entered : entered.toLowerCase());
        }
    }
    return freezeAliases(aliases);
}

function emptyAliasSets(): {
    caseInsensitive: Set<string>;
    caseSensitive: Set<string>;
} {
    return { caseInsensitive: new Set(), caseSensitive: new Set() };
}

function emptyAliases(): MagicWordAliases {
    return freezeAliases(emptyAliasSets());
}

function freezeAliases(aliases: {
    caseInsensitive: Set<string>;
    caseSensitive: Set<string>;
}): MagicWordAliases {
    return Object.freeze(aliases);
}

function readStringList(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const result = value.map(readNonemptyString);
    return result.includes(null) ? null : (result as string[]);
}

function readNonemptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value != null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function createState(
    source: NamespaceSource,
    redirectsSafe: boolean,
    templateMagicWords: TemplateMagicWordCatalog | null,
    imageOptions: ImageOptionCatalog | null,
): WikiNamespaceState {
    return Object.freeze({
        redirectsSafe,
        source,
        templateMagicWords,
        imageOptions,
        templateRedirectsSafe: templateMagicWords != null,
    });
}
