/** Resolves highlighted references into compact citation previews. */

import * as shortFootnotes from "./short-footnotes.ts";
import { type NamespaceSource, stripNamespacePrefix } from "./wiki-titles.ts";
import { type ParsedTemplateCall, wikitext } from "./wikitext/index.ts";

export interface ReferencePreview {
    /** Wikitext from this occurrence's details attribute, never its parent's. */
    details?: string;
    /** The named parent was absent from the supplied article source. */
    missingDefinition?: boolean;
    noteText?: string;
    referenceLabel: string;
    rows: ReferencePreviewRow[];
    templateName: string;
    /** Unqualified citation template title with its source casing preserved. */
    templateTitle?: string;
}

export interface ReferencePreviewField {
    displayValue?: string;
    href?: string;
    name: string;
    value: string;
}

export interface ReferencePreviewRow {
    fields: ReferencePreviewField[];
}

interface PersonPair {
    first?: number;
    last?: number;
}

interface ResolvedReference {
    details?: string;
    label: string;
    missingDefinition?: boolean;
    source: string;
}

const PERSON_PARAMETER_PATTERN = /^(.+-)?(last|first)(\d*)$/iu;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>{}[\]|"']+/u;

/**
 * Builds a preview for a ref tag or reference-like template.
 *
 * @param articleSource - Complete article wikitext.
 * @param referenceSource - Reference wikitext.
 * @param namespaceSource - Current-wiki namespace rules.
 * @returns Built preview for a ref tag or reference-like template.
 */
export function buildReferencePreview(
    articleSource: string,
    referenceSource: string,
    namespaceSource: NamespaceSource | null = null,
): ReferencePreview | null {
    const resolved = resolveReferenceSource(
        articleSource,
        referenceSource,
        namespaceSource,
    );
    const citation = findCitationTemplate(resolved.source, namespaceSource);
    const preview =
        citation === ""
            ? createNotePreview(resolved)
            : createCitationPreview(resolved, citation, namespaceSource);
    if (preview == null) {
        return null;
    }
    return {
        ...preview,
        ...(resolved.details == null ? {} : { details: resolved.details }),
        ...(resolved.missingDefinition ? { missingDefinition: true } : {}),
    };
}

function createNotePreview(
    resolved: ResolvedReference,
): ReferencePreview | null {
    const noteText = resolved.source.trim();
    return noteText === "" && resolved.details == null
        ? null
        : {
              ...(noteText === "" ? {} : { noteText }),
              referenceLabel: resolved.label,
              rows: [],
              templateName: "reference",
          };
}

function createCitationPreview(
    resolved: ResolvedReference,
    citation: string,
    namespaceSource: NamespaceSource | null,
): ReferencePreview {
    const parsed = wikitext(citation).template.parse();
    const entered = parsed.params.filter((parameter) => parameter.value !== "");
    const originalUrl = entered.findLast(
        (parameter) => parameter.name.toLowerCase() === "url",
    )?.value;
    const fields = entered.map(function buildField(parameter) {
        const field: ReferencePreviewField = {
            name: parameter.name,
            value: parameter.value,
        };
        if (parameter.name.toLowerCase() !== "archive-url") {
            return field;
        }
        const href = findHttpUrl(parameter.value);
        return {
            ...field,
            ...(href === "" ? {} : { href }),
            displayValue: shortenArchiveUrl(parameter.value, originalUrl),
        };
    });
    return {
        referenceLabel: resolved.label,
        rows: pairPersonFields(fields),
        templateName: normalizeTemplateName(parsed.name, namespaceSource),
        templateTitle: getTemplateTitle(parsed.name, namespaceSource),
    };
}

function resolveReferenceSource(
    article: string,
    reference: string,
    namespaceSource: NamespaceSource | null,
): ResolvedReference {
    const template = resolveTemplateReference(
        article,
        reference,
        namespaceSource,
    );
    if (template != null) {
        return template;
    }
    const ref = wikitext(reference)
        .reference.getAll()
        .find((tag) => tag.start === 0 && tag.end === reference.length);
    if (ref == null) {
        return { label: "", source: reference };
    }
    const label = ref.attributes.name ?? "";
    const details = ref.attributes.details?.trim();
    const occurrence = {
        label,
        ...(details ? { details } : {}),
    };
    if (!ref.selfClosing) {
        return { ...occurrence, source: ref.content };
    }
    const definition = wikitext(article).reference.getFirst(
        label,
        ref.attributes.group,
    );
    return {
        ...occurrence,
        ...(definition == null ? { missingDefinition: true } : {}),
        source: definition?.content ?? "",
    };
}

function resolveTemplateReference(
    article: string,
    reference: string,
    namespaceSource: NamespaceSource | null,
): ResolvedReference | null {
    if (!reference.startsWith("{{")) {
        return null;
    }
    const parsed = wikitext(reference).template.parse();
    const name = normalizeTemplateName(parsed.name, namespaceSource);
    if (name === "sfn") {
        const label = parsed.params
            .filter((parameter) => parameter.positional)
            .map((parameter) => parameter.value)
            .filter(Boolean)
            .join(", ");
        return {
            label,
            source: shortFootnotes.resolveShortFootnoteCitation(
                article,
                reference,
                (value) => normalizeTemplateName(value, namespaceSource),
            ),
        };
    }
    if (/^efn(?:$|[- /])/u.test(name)) {
        return resolveExplanatoryFootnote(parsed);
    }
    if (name !== "r") {
        return null;
    }
    const label = parsed.params.find(
        (parameter) => parameter.name === "1",
    )?.value;
    return {
        label: label ?? "",
        source: findNamedReferenceContent(article, label ?? ""),
    };
}

function resolveExplanatoryFootnote(
    parsed: ParsedTemplateCall,
): ResolvedReference {
    const note = parsed.params.find(
        (parameter) => parameter.name === "1",
    )?.value;
    const label = parsed.params.find(
        (parameter) => parameter.name.toLowerCase() === "name",
    )?.value;
    return { label: label ?? "", source: note ?? "" };
}

function findNamedReferenceContent(source: string, name: string): string {
    return wikitext(source).reference.getFirst(name)?.content ?? "";
}

function findCitationTemplate(
    source: string,
    namespaceSource: NamespaceSource | null,
): string {
    for (const template of wikitext(source).template.getAll()) {
        const name = normalizeTemplateName(template.name, namespaceSource);
        if (/^(?:cite(?:\s|$)|citation$)/u.test(name)) {
            return template.raw;
        }
    }
    return "";
}

function normalizeTemplateName(
    value: string,
    namespaceSource: NamespaceSource | null,
): string {
    return getTemplateTitle(value, namespaceSource).toLowerCase();
}

function getTemplateTitle(
    value: string,
    namespaceSource: NamespaceSource | null,
): string {
    const title =
        namespaceSource == null
            ? value.replace(/^\s*(?:template\s*:\s*)?/iu, "")
            : stripNamespacePrefix(value, namespaceSource, 10);
    return title.replaceAll("_", " ").trim().replace(/\s+/gu, " ");
}

function pairPersonFields(
    fields: ReferencePreviewField[],
): ReferencePreviewRow[] {
    const pairs = collectPersonPairs(fields);
    const replacements = new Map<number, ReferencePreviewField[]>();
    const consumed = new Set<number>();
    for (const pair of pairs.values()) {
        if (pair.first == null || pair.last == null) {
            continue;
        }
        const index = Math.min(pair.first, pair.last);
        consumed.add(pair.first);
        consumed.add(pair.last);
        replacements.set(index, [fields[pair.last], fields[pair.first]]);
    }
    return fields.flatMap(function pair(field, index) {
        const replacement = replacements.get(index);
        if (replacement != null) {
            return [{ fields: replacement }];
        }
        return consumed.has(index) ? [] : [{ fields: [field] }];
    });
}

function collectPersonPairs(
    fields: ReferencePreviewField[],
): Map<string, PersonPair> {
    const pairs = new Map<string, PersonPair>();
    fields.forEach(function collect(field, index) {
        const match = field.name.match(PERSON_PARAMETER_PATTERN);
        if (match == null) {
            return;
        }
        const prefix = (match[1] ?? "").toLowerCase();
        const side = match[2].toLowerCase() as keyof PersonPair;
        const key = `${prefix}\0${match[3]}`;
        const pair = pairs.get(key) ?? {};
        pair[side] ??= index;
        pairs.set(key, pair);
    });
    return pairs;
}

function shortenArchiveUrl(
    archiveUrl: string,
    originalUrl: string | undefined,
): string {
    const archive = withoutHtmlComments(archiveUrl);
    const original = withoutHtmlComments(originalUrl ?? "");
    if (archive === "" || original === "") {
        return archive;
    }
    if (archive.includes(original)) {
        return archive.replace(original, "...");
    }
    const originalScheme = original.match(/^https?:\/\//u)?.[0];
    if (originalScheme == null) {
        return archive;
    }
    const archivedScheme =
        originalScheme === "http://" ? "https://" : "http://";
    const archivedTarget =
        archivedScheme + original.slice(originalScheme.length);
    // Preserve the archive service URL and compare only its embedded target.
    const targetStart = archive.indexOf(
        archivedTarget,
        archive.search(HTTP_URL_PATTERN) + 1,
    );
    if (
        targetStart < 0 ||
        findHttpUrl(archive.slice(targetStart)) !== archivedTarget
    ) {
        return archive;
    }
    return (
        archive.slice(0, targetStart) +
        archivedScheme +
        "..." +
        archive.slice(targetStart + archivedTarget.length)
    );
}

function withoutHtmlComments(value: string): string {
    return value
        .replace(/<!--[\s\S]*?-->/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}

function findHttpUrl(value: string): string {
    return withoutHtmlComments(value).match(HTTP_URL_PATTERN)?.[0] ?? "";
}
