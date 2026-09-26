/** Pure wikitext target collection and confirmed redirect rewriting. */

import {
    formatNamespaceTitle,
    getNamespaceId,
    type NamespaceSource,
    normalizeWikitextTitleKey,
} from "./wiki-titles.ts";
import { type ParsedTemplateCall, wikitext } from "./wikitext/index.ts";

import {
    classifyTemplateHead,
    type TemplateMagicWordCatalog,
} from "./magic-words.ts";

export interface WikiLinkLookup {
    missing: Set<string>;
    missingLinkClasses: string[];
    redirects: Map<string, string>;
}

/**
 * Collects unique non-local article targets.
 *
 * @param source - Source text.
 * @returns Collected unique non-local article targets.
 */
export function collectWikiLinkTitles(source: string): string[] {
    const titles = wikitext(source)
        .link.getAll()
        .flatMap(function getTitle(range) {
            const inner = source.slice(range.start + 2, range.end - 2);
            const targetPart = wikitext(inner).splitRanges("|")[0];
            if (targetPart == null) {
                return [];
            }
            const target = parseWikiLinkTarget(targetPart.value);
            return target == null ? [] : [target.title.replaceAll("_", " ")];
        });
    return [...new Set(titles)];
}

/**
 * Collects ordinary static template transclusions for redirect lookup.
 *
 * @param source - Source text.
 * @param namespaceSource - Database-scoped namespace data.
 * @param magicWords - Site-specific template-like syntax catalog.
 * @returns Unique template-namespace titles.
 */
export function collectTemplateTitles(
    source: string,
    namespaceSource: NamespaceSource = "enwiki",
    magicWords: TemplateMagicWordCatalog | null = null,
): string[] {
    const titles = getTemplateRedirectCandidates(
        source,
        namespaceSource,
        magicWords,
    ).map((candidate) => candidate.queryTitle.replaceAll("_", " "));
    return [...new Set(titles)];
}

/**
 * Rewrites exact wikilink targets with confirmed redirects.
 *
 * @param source - Source text.
 * @param redirects - Redirects value.
 * @param namespaceSource - Database-scoped namespace data.
 * @param magicWords - Site-specific template-like syntax catalog.
 * @returns Resulting text.
 */
export function applyWikiLinkRedirects(
    source: string,
    redirects: ReadonlyMap<string, string>,
    namespaceSource: NamespaceSource = "enwiki",
): string {
    return rewriteWikiLinks(source, { namespaceSource, redirects });
}

/**
 * Rewrites ordinary static template targets with confirmed redirects.
 *
 * Bare calls remain bare, while calls with an explicit local template
 * namespace retain their entered prefix.
 *
 * @param source - Source text.
 * @param redirects - Redirects value.
 * @param namespaceSource - Database-scoped namespace data.
 * @returns Resulting text.
 */
export function applyTemplateRedirects(
    source: string,
    redirects: ReadonlyMap<string, string>,
    namespaceSource: NamespaceSource = "enwiki",
    magicWords: TemplateMagicWordCatalog | null = null,
): string {
    const candidates = getTemplateRedirectCandidates(
        source,
        namespaceSource,
        magicWords,
    );
    const result: string[] = [];
    let cursor = 0;

    for (const candidate of candidates) {
        const target = redirects.get(
            normalizeWikitextTitleKey(candidate.queryTitle),
        );
        const replacement =
            target == null
                ? null
                : createTemplateReplacement(candidate, target, namespaceSource);
        if (replacement == null) {
            continue;
        }
        result.push(source.slice(cursor, candidate.start), replacement);
        cursor = candidate.end;
    }
    if (cursor === 0) {
        return source;
    }
    result.push(source.slice(cursor));
    return result.join("");
}

interface TemplateRedirectCandidate {
    end: number;
    explicitPrefix: string | null;
    prefixSpacing: string;
    queryTitle: string;
    start: number;
}

function getTemplateRedirectCandidates(
    source: string,
    namespaceSource: NamespaceSource,
    magicWords: TemplateMagicWordCatalog | null,
): TemplateRedirectCandidate[] {
    if (magicWords == null) {
        return [];
    }
    return wikitext(source)
        .template.getAll()
        .flatMap(function collectCandidate(template) {
            const candidate = getTemplateRedirectCandidate(
                template,
                namespaceSource,
                magicWords,
            );
            return candidate == null ? [] : [candidate];
        });
}

function getTemplateRedirectCandidate(
    template: ParsedTemplateCall,
    namespaceSource: NamespaceSource,
    magicWords: TemplateMagicWordCatalog | null,
): TemplateRedirectCandidate | null {
    const inner = template.raw.slice(2, -2);
    const parts = wikitext(inner).splitRanges("|");
    const head = parts[0];
    if (head == null) {
        return null;
    }
    const syntax = classifyTemplateHead(
        head.value,
        parts.length > 1,
        magicWords,
    );
    if (syntax.kind !== "template" || syntax.modifiers.length > 0) {
        return null;
    }
    const entered = head.value.slice(syntax.target.start, syntax.target.end);
    const target = parseTemplateTarget(entered, namespaceSource);
    if (target == null) {
        return null;
    }
    const start = template.start + 2 + head.start + syntax.target.start;
    return { ...target, end: start + entered.length, start };
}

function parseTemplateTarget(
    entered: string,
    namespaceSource: NamespaceSource,
): Omit<TemplateRedirectCandidate, "end" | "start"> | null {
    if (!isStaticTemplateTitle(entered) || entered.startsWith(":")) {
        return null;
    }
    const separator = entered.indexOf(":");
    if (separator < 0) {
        return createBareTemplateTarget(entered, namespaceSource);
    }
    const prefix = entered.slice(0, separator).trim();
    const namespaceId = getNamespaceId(namespaceSource, prefix);
    if (namespaceId != null && namespaceId !== 10) {
        return null;
    }
    if (namespaceId !== 10) {
        return createBareTemplateTarget(entered, namespaceSource);
    }
    const remainder = entered.slice(separator + 1);
    const title = remainder.trim();
    if (!isStaticTemplateTitle(title)) {
        return null;
    }
    return {
        explicitPrefix: entered.slice(0, separator + 1),
        prefixSpacing: remainder.slice(
            0,
            remainder.length - remainder.trimStart().length,
        ),
        queryTitle: formatNamespaceTitle(title, namespaceSource, 10),
    };
}

function createBareTemplateTarget(
    entered: string,
    namespaceSource: NamespaceSource,
): Omit<TemplateRedirectCandidate, "end" | "start"> {
    return {
        explicitPrefix: null,
        prefixSpacing: "",
        queryTitle: formatNamespaceTitle(entered, namespaceSource, 10),
    };
}

function isStaticTemplateTitle(value: string): boolean {
    return value !== "" && !/[#<>[\]{}|\t\r\n]/u.test(value);
}

function createTemplateReplacement(
    candidate: TemplateRedirectCandidate,
    redirectTarget: string,
    namespaceSource: NamespaceSource,
): string | null {
    const title = parseRedirectTemplateTitle(redirectTarget, namespaceSource);
    if (title == null) {
        return null;
    }
    return candidate.explicitPrefix == null
        ? title
        : `${candidate.explicitPrefix}${candidate.prefixSpacing}${title}`;
}

function parseRedirectTemplateTitle(
    value: string,
    namespaceSource: NamespaceSource,
): string | null {
    const target = value.trim();
    if (!isStaticTemplateTitle(target)) {
        return null;
    }
    const separator = target.indexOf(":");
    if (separator < 0) {
        return null;
    }
    const prefix = target.slice(0, separator).trim();
    if (getNamespaceId(namespaceSource, prefix) !== 10) {
        return null;
    }
    const title = target.slice(separator + 1).trim();
    return isStaticTemplateTitle(title) ? title : null;
}

function rewriteWikiLinks(
    source: string,
    context: WikiLinkRewriteContext,
): string {
    const links = wikitext(source)
        .link.getAll()
        .filter((range) => range.depth === 0);
    const result: string[] = [];
    let cursor = 0;

    for (const range of links) {
        result.push(source.slice(cursor, range.start));
        result.push(
            rewriteWikiLink(source.slice(range.start, range.end), context),
        );
        cursor = range.end;
    }
    result.push(source.slice(cursor));
    return result.join("");
}

interface WikiLinkRewriteContext {
    namespaceSource: NamespaceSource;
    redirects: ReadonlyMap<string, string>;
}

interface WikiLinkTarget {
    escaped: boolean;
    fragment: string;
    title: string;
}

interface WikiLinkEmbedding {
    entered: boolean;
    prefix: string;
}

function rewriteWikiLink(
    link: string,
    context: WikiLinkRewriteContext,
): string {
    const inner = rewriteWikiLinks(link.slice(2, -2), context);
    const rewrittenLink = `[[${inner}]]`;
    const parts = wikitext(inner).splitRanges("|");
    const targetPart = parts[0];
    if (targetPart == null) {
        return rewrittenLink;
    }
    const entered = parseWikiLinkTarget(targetPart.value);
    if (entered == null) {
        return rewrittenLink;
    }
    const target = context.redirects.get(
        normalizeWikitextTitleKey(entered.title),
    );
    if (target == null) {
        return rewrittenLink;
    }
    const targetTitle = stripTitleFragment(target);
    const targetFragment = entered.fragment || getTitleFragment(target);
    const embedding = getWikiLinkEmbedding(
        entered,
        targetTitle,
        context.namespaceSource,
    );
    if (embedding == null) {
        return rewrittenLink;
    }
    const rewrittenTarget =
        `${embedding.prefix}${targetTitle}` + targetFragment;
    const tail = inner.slice(targetPart.end);
    if (tail !== "" || embedding.entered) {
        return `[[${rewrittenTarget}${tail}]]`;
    }
    const label = `${entered.title}${entered.fragment}`.replaceAll("_", " ");
    return `[[${rewrittenTarget}|${label}]]`;
}

function getWikiLinkEmbedding(
    entered: WikiLinkTarget,
    targetTitle: string,
    namespaceSource: NamespaceSource,
): WikiLinkEmbedding | null {
    const enteredNamespace = getEmbeddedLinkNamespaceId(
        entered,
        namespaceSource,
    );
    const targetNamespace = getEmbeddedNamespaceId(
        targetTitle,
        namespaceSource,
    );
    if (enteredNamespace != null && enteredNamespace !== targetNamespace) {
        return null;
    }
    const needsEscape = entered.escaped || targetNamespace != null;
    return {
        entered: enteredNamespace != null,
        prefix: needsEscape && enteredNamespace == null ? ":" : "",
    };
}

function parseWikiLinkTarget(value: string): WikiLinkTarget | null {
    let target = value.trim();
    const escaped = target.startsWith(":");
    if (escaped) {
        target = target.slice(1).trimStart();
    }
    const fragmentStart = target.indexOf("#");
    const title = (
        fragmentStart < 0 ? target : target.slice(0, fragmentStart)
    ).trim();
    if (title === "") {
        return null;
    }
    const fragment = fragmentStart < 0 ? "" : target.slice(fragmentStart);
    return { escaped, fragment, title };
}

function getEmbeddedLinkNamespaceId(
    target: WikiLinkTarget,
    namespaceSource: NamespaceSource,
): number | undefined {
    if (target.escaped) {
        return undefined;
    }
    return getEmbeddedNamespaceId(target.title, namespaceSource);
}

function getEmbeddedNamespaceId(
    title: string,
    namespaceSource: NamespaceSource,
): number | undefined {
    const separator = title.indexOf(":");
    if (separator < 0) {
        return undefined;
    }
    const namespaceId = getNamespaceId(
        namespaceSource,
        title.slice(0, separator),
    );
    return namespaceId === 6 || namespaceId === 14 ? namespaceId : undefined;
}

function stripTitleFragment(title: string): string {
    return title.split("#", 1)[0] ?? title;
}

function getTitleFragment(title: string): string {
    const fragmentStart = title.indexOf("#");
    return fragmentStart < 0 ? "" : title.slice(fragmentStart);
}
