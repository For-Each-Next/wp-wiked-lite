/**
 * @file src/domain/short-footnotes.ts
 * Purpose: Resolves {{sfn}} calls to matching bibliography citations.
 *
 * Table of contents:
 * 1. Imports
 * 2. TemplateNameNormalizer
 * 3. Constants and state
 * 4. TemplateCall
 * 5. TemplateDescriptor
 * 6. CitationCandidate
 * 7. ShortFootnoteUse
 * 8. findShortFootnoteCitation
 * 9. buildShortFootnoteUse
 * 10. buildCitationCandidate
 * 11. getCitationAuthors
 * 12. isCitationAuthorParameter
 * 13. getCitationYear
 * 14. matchesCitation
 * 15. getYear
 * 16. cleanDisplayValue
 * 17. normalizeValue
 * 18. findTemplateCalls
 * 19. createTemplateDescriptor
 * 20. normalizeName
 */

import { type ParsedTemplateCall, wikitext } from "./wikitext/index.ts";

/** Normalizes a transcluded template title for matching. */
export type TemplateNameNormalizer = (value: string) => string;

const DEFAULT_NORMALIZER: TemplateNameNormalizer = (value) =>
    wikitext.template.normalizeName(value);

interface TemplateCall {
    call: ParsedTemplateCall;
    descriptor: TemplateDescriptor;
}

interface TemplateDescriptor {
    name: string;
    named: Map<string, string>;
    positional: string[];
}

interface CitationCandidate {
    authors: string[];
    call: ParsedTemplateCall;
    ref: string;
    year: string;
}

interface ShortFootnoteUse {
    authors: string[];
    ref: string;
    year: string;
}

/**
 * Resolves one complete {{sfn}} call to its parsed bibliography citation.
 *
 * @param source - Source text.
 * @param shortFootnote - Short footnote value.
 * @returns The matching citation and its exact source offsets.
 */
export function findShortFootnoteCitation(
    source: string,
    shortFootnote: string,
    normalizeTemplateName: TemplateNameNormalizer = DEFAULT_NORMALIZER,
): ParsedTemplateCall | undefined {
    const useCall = findTemplateCalls(shortFootnote, normalizeTemplateName)[0];
    const use = useCall == null ? null : buildShortFootnoteUse(useCall);
    if (use == null) {
        return undefined;
    }
    for (const call of findTemplateCalls(source, normalizeTemplateName)) {
        const candidate = buildCitationCandidate(call);
        if (candidate != null && matchesCitation(use, candidate)) {
            return candidate.call;
        }
    }
    return undefined;
}

function buildShortFootnoteUse(call: TemplateCall): ShortFootnoteUse | null {
    if (call.descriptor.name !== "sfn") {
        return null;
    }
    const values = call.descriptor.positional;
    const yearIndex = values.findLastIndex((value) => getYear(value) !== "");
    if (yearIndex < 0) {
        return null;
    }
    return {
        authors: values.slice(0, yearIndex).map(normalizeValue).filter(Boolean),
        ref: normalizeValue(call.descriptor.named.get("ref") ?? ""),
        year: getYear(values[yearIndex]),
    };
}

function buildCitationCandidate(call: TemplateCall): CitationCandidate | null {
    if (!/^(?:cite(?:\s|$)|citation$)/u.test(call.descriptor.name)) {
        return null;
    }
    const authors = getCitationAuthors(call.descriptor);
    const year = getCitationYear(call.descriptor);
    if (authors.length === 0 || year === "") {
        return null;
    }
    return {
        authors,
        call: call.call,
        ref: normalizeValue(call.descriptor.named.get("ref") ?? ""),
        year,
    };
}

function getCitationAuthors(descriptor: TemplateDescriptor): string[] {
    const entries = [...descriptor.named];
    const authors = entries
        .filter(([name]) => isCitationAuthorParameter(name))
        .map(([_name, value]) => normalizeValue(value))
        .filter(Boolean);
    if (authors.length > 0) {
        return [...new Set(authors)];
    }
    return entries
        .filter(([name]) => /^(?:agency|organization|publisher)$/u.test(name))
        .map(([_name, value]) => normalizeValue(value))
        .filter(Boolean);
}

function isCitationAuthorParameter(name: string): boolean {
    return /^(?:last|surname|author|editor-last|editor-surname)\d*$/u.test(
        name,
    );
}

function getCitationYear(descriptor: TemplateDescriptor): string {
    const values = ["year", "date", "publication-date", "orig-year"];
    for (const name of values) {
        const year = getYear(descriptor.named.get(name) ?? "");
        if (year !== "") {
            return year;
        }
    }
    return "";
}

function matchesCitation(
    use: ShortFootnoteUse,
    candidate: CitationCandidate,
): boolean {
    if (use.ref !== "" && use.ref === candidate.ref) {
        return true;
    }
    return (
        use.year === candidate.year &&
        use.authors.length > 0 &&
        use.authors.every((author) => candidate.authors.includes(author))
    );
}

function getYear(value: string): string {
    return (
        value.match(/(?:^|\D)(\d{4}[a-z]?)(?:\D|$)/iu)?.[1].toLowerCase() ?? ""
    );
}

function cleanDisplayValue(value: string): string {
    return value.replace(/<!--[\s\S]*?-->/gu, "").trim();
}

function normalizeValue(value: string): string {
    return cleanDisplayValue(value)
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, "$2")
        .replace(/\[\[([^\]]+)\]\]/gu, "$1")
        .replace(/<[^>]*>/gu, " ")
        .replace(/'{2,5}/gu, "")
        .replace(/&nbsp;/giu, " ")
        .replace(/_/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();
}

function findTemplateCalls(
    source: string,
    normalizeTemplateName: TemplateNameNormalizer,
): TemplateCall[] {
    return wikitext(source)
        .template.getAll()
        .flatMap(function describe(call) {
            const descriptor = createTemplateDescriptor(
                call,
                normalizeTemplateName,
            );
            return descriptor == null ? [] : [{ call, descriptor }];
        });
}

function createTemplateDescriptor(
    call: ParsedTemplateCall,
    normalizeTemplateName: TemplateNameNormalizer,
): TemplateDescriptor | null {
    const name = normalizeTemplateName(call.name);
    if (name === "") {
        return null;
    }
    const named = new Map<string, string>();
    const positional: string[] = [];
    for (const param of call.params) {
        if (param.positional) {
            positional.push(param.value);
        } else {
            named.set(normalizeName(param.name), param.value);
        }
    }
    return { name, named, positional };
}

function normalizeName(value: string): string {
    return value
        .trim()
        .replace(/[_\s]+/gu, " ")
        .toLowerCase();
}
