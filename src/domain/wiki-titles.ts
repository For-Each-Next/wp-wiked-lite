/** Database-scoped MediaWiki namespace prefixes used in wikitext. */

type NamespacePrefixMap = Readonly<Record<number, readonly string[]>>;

type NamespaceIdMap = Readonly<Record<string, number>>;

/** Namespace aliases decoded for one MediaWiki database. */
export interface NamespaceCatalog {
    readonly databaseName: string;
    readonly namespaceIds: NamespaceIdMap;
    readonly namespacePrefixes: NamespacePrefixMap;
}

type NamespaceDatabaseName = string;

export type NamespaceSource = NamespaceDatabaseName | NamespaceCatalog;

const EMPTY_NAMESPACE_PREFIXES: readonly string[] = Object.freeze([]);
const CANONICAL_FALLBACK_PREFIXES: NamespacePrefixMap = Object.freeze({
    0: Object.freeze([""]),
    6: Object.freeze(["File"]),
    10: Object.freeze(["Template"]),
    14: Object.freeze(["Category"]),
});
const CANONICAL_FALLBACK_IDS = createNamespaceIds(CANONICAL_FALLBACK_PREFIXES);

/**
 * Decodes one namespace catalog from a MediaWiki siteinfo response.
 *
 * The caller remains responsible for requesting `namespaces` and
 * `namespacealiases`. The `name` and `alias` fields are accepted.
 *
 * @param databaseName - Database that supplied the response.
 * @param response - MediaWiki `action=query&meta=siteinfo` response.
 * @returns Immutable namespace catalog.
 */
export function decodeNamespaceCatalog(
    databaseName: string,
    response: unknown,
): NamespaceCatalog {
    const namespacePrefixes = decodeNamespacePrefixes(response);
    return Object.freeze({
        databaseName,
        namespaceIds: createNamespaceIds(namespacePrefixes),
        namespacePrefixes,
    });
}

/**
 * Normalizes a namespace prefix like MediaWiki's `wgNamespaceIds` keys.
 *
 * @param prefix - Entered namespace prefix without a colon.
 * @returns Case-folded prefix with spaces and underscores normalized.
 */
function normalizeNamespacePrefix(prefix: string): string {
    return prefix
        .trim()
        .replace(/[_\s]+/gu, "_")
        .toLowerCase();
}

/**
 * Normalizes only syntax-equivalent structure in a wikitext title key.
 *
 * Title casing remains intact because case rules are wiki-specific.
 * Callers should follow explicit API `normalized` and `converted`
 * mappings instead of case-folding whole titles.
 *
 * @param title - Entered title.
 * @returns Trimmed title with underscores represented as spaces.
 */
export function normalizeWikitextTitleKey(title: string): string {
    return title.replaceAll("_", " ").trim();
}

/**
 * Gets the namespace ID for a database-scoped prefix.
 *
 * @param source - Decoded catalog or a database name using the fallback.
 * @param prefix - Namespace prefix without a colon.
 * @returns Namespace ID when configured for the database.
 */
export function getNamespaceId(
    source: NamespaceSource,
    prefix: string,
): number | undefined {
    return getNamespaceIds(source)[normalizeNamespacePrefix(prefix)];
}

/**
 * Gets every configured prefix for one namespace.
 *
 * @param source - Decoded catalog or a database name using the fallback.
 * @param namespaceId - MediaWiki namespace ID.
 * @returns Current name, canonical name when different, and aliases.
 */
export function getNamespacePrefixes(
    source: NamespaceSource,
    namespaceId: number,
): readonly string[] {
    const prefixes: NamespacePrefixMap =
        typeof source === "string"
            ? CANONICAL_FALLBACK_PREFIXES
            : source.namespacePrefixes;
    return prefixes[namespaceId] ?? EMPTY_NAMESPACE_PREFIXES;
}

/**
 * Gets a reverse map compatible with `wgNamespaceIds` keys.
 *
 * @param source - Decoded catalog or a database name using the fallback.
 * @returns Normalized namespace prefixes keyed to namespace IDs.
 */
function getNamespaceIds(
    source: NamespaceSource,
): Readonly<Record<string, number>> {
    return typeof source === "string"
        ? CANONICAL_FALLBACK_IDS
        : source.namespaceIds;
}

/**
 * Removes a matching database-scoped namespace prefix from a title.
 *
 * @param value - Title with or without a namespace prefix.
 * @param source - Decoded catalog or a database name using the fallback.
 * @param namespaceId - Namespace ID to remove.
 * @returns Trimmed title without a matching prefix.
 */
export function stripNamespacePrefix(
    value: string,
    source: NamespaceSource,
    namespaceId: number,
): string {
    const title = value.trim();
    const entered = readEnteredNamespacePrefix(title);
    if (entered == null) {
        return title;
    }
    if (getNamespaceId(source, entered.prefix) !== namespaceId) {
        return title;
    }
    return title.slice(entered.separator + 1).trim();
}

/**
 * Formats a title with the database's current namespace name.
 *
 * @param value - Title with or without a matching namespace prefix.
 * @param source - Decoded catalog or a database name using the fallback.
 * @param namespaceId - Namespace ID to apply.
 * @returns Title formatted with the current namespace name.
 */
export function formatNamespaceTitle(
    value: string,
    source: NamespaceSource,
    namespaceId: number,
): string {
    const prefixes = getNamespacePrefixes(source, namespaceId);
    const prefix = prefixes[0];
    if (prefix == null) {
        const databaseName =
            typeof source === "string" ? source : source.databaseName;
        throw new RangeError(
            `Unknown ${databaseName} namespace ID: ${namespaceId}`,
        );
    }
    const title = stripNamespacePrefix(value, source, namespaceId);
    return prefix === "" ? title : `${prefix}:${title}`;
}

function decodeNamespacePrefixes(response: unknown): NamespacePrefixMap {
    const query = readRecord(readRecord(response)?.query);
    const namespaces = readRecord(query?.namespaces);
    const aliases = query?.namespacealiases;
    if (namespaces == null || !Array.isArray(aliases)) {
        throw invalidSiteinfoError();
    }
    const result = Object.create(null) as Record<number, readonly string[]>;
    for (const [enteredId, value] of Object.entries(namespaces)) {
        const namespace = readRecord(value);
        const namespaceId = readNamespaceId(namespace?.id, enteredId);
        const name = readNamespaceName(namespace);
        if (namespaceId == null || name == null) {
            throw invalidSiteinfoError();
        }
        const canonical = readOptionalString(namespace?.canonical);
        const configuredAliases = readNamespaceAliases(aliases, namespaceId);
        result[namespaceId] = Object.freeze(
            uniquePrefixes([name, canonical, ...configuredAliases]),
        );
    }
    return Object.freeze(result);
}

function readNamespaceAliases(
    values: unknown[],
    namespaceId: number,
): string[] {
    const aliases: string[] = [];
    for (const value of values) {
        const alias = readRecord(value);
        const aliasId = readNamespaceId(alias?.id);
        const name = readNamespaceName(alias);
        if (aliasId == null || name == null) {
            throw invalidSiteinfoError();
        }
        if (aliasId === namespaceId) {
            aliases.push(name);
        }
    }
    return aliases;
}

function readNamespaceId(value: unknown, fallback?: string): number | null {
    const namespaceId = typeof value === "number" ? value : Number(fallback);
    return Number.isInteger(namespaceId) ? namespaceId : null;
}

function readNamespaceName(
    value: Record<string, unknown> | null | undefined,
): string | null {
    if (value == null) {
        return null;
    }
    const name = value.name ?? value.alias;
    return typeof name === "string" ? name : null;
}

function readOptionalString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value != null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function invalidSiteinfoError(): TypeError {
    return new TypeError("Invalid MediaWiki namespace siteinfo response.");
}

function uniquePrefixes(prefixes: readonly string[]): string[] {
    const seen = new Set<string>();
    return prefixes.filter(function isFirst(prefix, index) {
        const normalized = normalizeNamespacePrefix(prefix);
        if ((prefix === "" && index > 0) || seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });
}

function createNamespaceIds(
    prefixes: NamespacePrefixMap,
): Readonly<Record<string, number>> {
    const namespaceIds = Object.create(null) as Record<string, number>;
    for (const [namespaceId, values] of Object.entries(prefixes)) {
        for (const prefix of values) {
            namespaceIds[normalizeNamespacePrefix(prefix)] =
                Number(namespaceId);
        }
    }
    return Object.freeze(namespaceIds);
}

function readEnteredNamespacePrefix(
    value: string,
): { prefix: string; separator: number } | null {
    const title = value.trim();
    let start = title.startsWith(":") ? 1 : 0;
    while (/\s/u.test(title[start] ?? "")) {
        start += 1;
    }
    const separator = title.indexOf(":", start);
    if (separator < 0) {
        return null;
    }
    return { prefix: title.slice(start, separator), separator };
}
