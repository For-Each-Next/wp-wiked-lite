/**
 * @file src/domain/reference-preview.ts
 * Purpose: Resolves highlighted references into compact citation previews.
 *
 * Table of contents:
 * 1. Imports
 * 2. ReferenceEditRange
 * 3. ReferenceReplacement
 * 4. ReferencePreview
 * 5. ReferencePreviewField
 * 6. ReferencePreviewRow
 * 7. PersonPair
 * 8. ResolvedReference
 * 9. Constants and state
 * 10. buildReferencePreview
 * 11. buildReferenceFieldReplacement
 * 12. buildReferenceFieldInsertion
 * 13. buildReferenceFieldUpdate
 * 14. isValidParameterValue
 * 15. buildReferenceFieldRename
 * 16. EditableField
 * 17. readEditableField
 * 18. renameFieldEdits
 * 19. combineFieldEdits
 * 20. readEditableCitation
 * 21. findParameterIndex
 * 22. isValidFieldName
 * 23. isValidRange
 * 24. escapeParameterPipes
 * 25. formatNewParameter
 * 26. createNotePreview
 * 27. createCitationPreview
 * 28. resolveReferenceSource
 * 29. resolveTemplateReference
 * 30. resolveExplanatoryFootnote
 * 31. findCitationTemplate
 * 32. trimRange
 * 33. findDetailsRange
 * 34. normalizeTemplateName
 * 35. getTemplateTitle
 * 36. pairPersonFields
 * 37. collectPersonPairs
 * 38. shortenArchiveUrl
 * 39. withoutHtmlComments
 * 40. findHttpUrl
 */

import * as shortFootnotes from "./short-footnotes.ts";
import { type NamespaceSource, stripNamespacePrefix } from "./wiki-titles.ts";
import {
    type ParsedTemplateCall,
    type ParsedTemplateParameter,
    type SourceRange,
    wikitext,
} from "./wikitext/index.ts";

export interface ReferenceEditRange extends SourceRange {
    /** Attribute quoting; undefined identifies ordinary wikitext. */
    quote?: '"' | "'" | "";
    /** Literal top-level pipes need escaping inside a template argument. */
    templateParameter?: true;
    /** Top-level equals must stay literal in unnamed template arguments. */
    positional?: true;
}

export interface ReferenceReplacement extends SourceRange {
    value: string;
}

export interface ReferencePreview {
    citationRange?: SourceRange;
    /** Wikitext from this occurrence's details attribute, never its parent's. */
    details?: string;
    detailsRange?: ReferenceEditRange;
    /** The named parent was absent from the supplied article source. */
    missingDefinition?: boolean;
    noteText?: string;
    noteRange?: ReferenceEditRange;
    referenceLabel: string;
    rows: ReferencePreviewRow[];
    templateName: string;
    /** Unqualified citation template title with its source casing preserved. */
    templateTitle?: string;
}

export interface ReferencePreviewField {
    displayValue?: string;
    /** More than one citation parameter has this exact, case-sensitive name. */
    duplicate?: true;
    href?: string;
    name: string;
    range?: ReferenceEditRange;
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
    detailsRange?: ReferenceEditRange;
    label: string;
    missingDefinition?: boolean;
    source: string;
    sourceStart?: number;
    sourceTemplateParameter?: true;
    sourcePositional?: true;
}

const PERSON_PARAMETER_PATTERN = /^(.+-)?(last|first)(\d*)$/iu;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>{}[\]|"']+/u;

/**
 * Builds a preview for a ref tag or reference-like template.
 *
 * @param articleSource - Complete article wikitext.
 * @param referenceSource - Reference wikitext.
 * @param namespaceSource - Current-wiki namespace rules.
 * @param referenceStart - Exact occurrence offset in editable article source.
 * @returns Built preview for a ref tag or reference-like template.
 */
export function buildReferencePreview(
    articleSource: string,
    referenceSource: string,
    namespaceSource: NamespaceSource | null = null,
    referenceStart?: number,
): ReferencePreview | null {
    const editableStart =
        referenceStart != null &&
        Number.isInteger(referenceStart) &&
        referenceStart >= 0 &&
        articleSource.slice(
            referenceStart,
            referenceStart + referenceSource.length,
        ) === referenceSource
            ? referenceStart
            : undefined;
    const resolved = resolveReferenceSource(
        articleSource,
        referenceSource,
        namespaceSource,
        editableStart,
    );
    const citation = findCitationTemplate(resolved.source, namespaceSource);
    const preview =
        citation == null
            ? createNotePreview(resolved)
            : createCitationPreview(resolved, citation, namespaceSource);
    if (preview == null) {
        return null;
    }
    return {
        ...preview,
        ...(resolved.details == null ? {} : { details: resolved.details }),
        ...(resolved.detailsRange == null
            ? {}
            : { detailsRange: resolved.detailsRange }),
        ...(resolved.missingDefinition ? { missingDefinition: true } : {}),
    };
}

/** Prepares a field edit while keeping tag attributes syntactically intact. */
export function buildReferenceFieldReplacement(
    source: string,
    range: ReferenceEditRange,
    value: string,
): ReferenceReplacement {
    if (!isValidRange(source, range)) {
        throw new RangeError(
            "The reference field is outside the editable source.",
        );
    }
    if (source.slice(range.start, range.end) === value) {
        return { start: range.start, end: range.end, value };
    }
    const quote = range.quote;
    const parameterValue = range.templateParameter
        ? escapeParameterPipes(value)
        : value;
    const entered = range.positional
        ? wikitext(parameterValue).split("=").join("&#61;")
        : parameterValue;
    const replacement =
        quote === undefined
            ? entered
            : quote === "'"
              ? entered.replaceAll("'", "&#39;")
              : entered.replaceAll('"', "&quot;");
    return {
        start: range.start,
        end: range.end,
        value: quote === "" ? `"${replacement}"` : replacement,
    };
}

/** Adds one named citation parameter without accepting structural separators. */
export function buildReferenceFieldInsertion(
    source: string,
    citationRange: SourceRange,
    name: string,
    value: string,
    targetFieldRange?: SourceRange,
    placement: "before" | "after" = "before",
): ReferenceReplacement | null {
    const fieldName = name.trim();
    const citation = readEditableCitation(source, citationRange);
    if (
        !isValidFieldName(fieldName) ||
        citation == null ||
        citation.params.some((parameter) => parameter.name === fieldName)
    ) {
        return null;
    }
    const parameterValue = escapeParameterPipes(value);
    if (!isValidParameterValue(fieldName, parameterValue)) {
        return null;
    }
    const raw = citation.raw;
    if (targetFieldRange != null) {
        const index = findParameterIndex(
            citation,
            citationRange,
            targetFieldRange,
        );
        if (index < 0) {
            return null;
        }
        const before = citation.params[index + (placement === "after" ? 1 : 0)];
        if (before != null) {
            const pipe = before.start - 1;
            const lineStart = raw.lastIndexOf("\n", pipe) + 1;
            const indentation = raw.slice(lineStart, pipe);
            const separator = /^[\t ]*$/u.test(indentation)
                ? `\n${indentation}`
                : "";
            const point = citationRange.start + pipe;
            return {
                start: point,
                end: point,
                value: `${formatNewParameter(raw, citation.params, fieldName, parameterValue, before)}${separator}`,
            };
        }
    }
    const beforeClose = raw.slice(0, -2);
    const trailing = beforeClose.match(/\s*$/u)?.[0] ?? "";
    const lastLineParameter = citation.params.findLast((parameter) =>
        /\n[\t ]*$/u.test(raw.slice(0, parameter.start - 1)),
    );
    const multiline = trailing.includes("\n") || lastLineParameter != null;
    const indentation =
        lastLineParameter == null
            ? ""
            : (raw
                  .slice(0, lastLineParameter.start - 1)
                  .match(/\n([\t ]*)$/u)?.[1] ?? "");
    const point =
        citationRange.end - 2 - (trailing.includes("\n") ? trailing.length : 0);
    return {
        start: point,
        end: point,
        value: `${multiline ? `\n${indentation}` : ""}${formatNewParameter(raw, citation.params, fieldName, parameterValue)}`,
    };
}

/** Updates a citation field's name and value as a single source replacement. */
export function buildReferenceFieldUpdate(
    source: string,
    citationRange: SourceRange,
    fieldRange: SourceRange,
    name: string,
    value: string,
): ReferenceReplacement | null {
    const field = readEditableField(source, citationRange, fieldRange, name);
    if (field == null) {
        return null;
    }
    const parameter = field.citation.params[field.index];
    const replacement = buildReferenceFieldReplacement(
        source,
        {
            start: fieldRange.start,
            end: fieldRange.end,
            templateParameter: true,
            ...(parameter.positional && parameter.name === field.name
                ? { positional: true }
                : {}),
        },
        value,
    );
    if (!isValidParameterValue(field.name, replacement.value)) {
        return null;
    }
    return combineFieldEdits(
        source,
        [...renameFieldEdits(field, citationRange.start), replacement],
        fieldRange.start,
    );
}

function isValidParameterValue(name: string, value: string): boolean {
    const sentinel =
        name === "__wiked_lite_validation__"
            ? "__wiked_lite_validation_next__"
            : "__wiked_lite_validation__";
    const probe = `{{citation|${name}=${value}|${sentinel}=sentinel}}`;
    const parsed = wikitext(probe).template.getAll()[0];
    return (
        parsed?.raw === probe &&
        parsed.params.length === 2 &&
        parsed.params[0].name === name &&
        parsed.params[0].rawValue === value &&
        parsed.params[1].name === sentinel &&
        parsed.params[1].rawValue === "sentinel"
    );
}

/** Renames an exact citation parameter while preserving its value and siblings. */
export function buildReferenceFieldRename(
    source: string,
    citationRange: SourceRange,
    fieldRange: SourceRange,
    name: string,
): ReferenceReplacement | null {
    const field = readEditableField(source, citationRange, fieldRange, name);
    return field == null
        ? null
        : combineFieldEdits(
              source,
              renameFieldEdits(field, citationRange.start),
              fieldRange.start,
          );
}

interface EditableField {
    citation: ParsedTemplateCall;
    index: number;
    name: string;
}

function readEditableField(
    source: string,
    citationRange: SourceRange,
    fieldRange: SourceRange,
    name: string,
): EditableField | null {
    const fieldName = name.trim();
    const citation = readEditableCitation(source, citationRange);
    if (!isValidFieldName(fieldName) || citation == null) {
        return null;
    }
    const index = findParameterIndex(citation, citationRange, fieldRange);
    const parameter = citation.params[index];
    return parameter == null ||
        (parameter.name !== fieldName &&
            citation.params.some((other) => other.name === fieldName))
        ? null
        : { citation, index, name: fieldName };
}

function renameFieldEdits(
    { citation, index, name }: EditableField,
    citationStart: number,
): ReferenceReplacement[] {
    const parameter = citation.params[index];
    if (parameter.name === name) {
        return [];
    }
    if (!parameter.positional) {
        const key = citation.raw.slice(
            parameter.start,
            parameter.valueStart - 1,
        );
        return [
            { ...trimRange(key, citationStart + parameter.start), value: name },
        ];
    }
    // Naming one positional field must preserve all subsequent numeric keys.
    return citation.params
        .slice(index)
        .filter((other) => other.positional)
        .map((other) => ({
            start: citationStart + other.valueStart,
            end: citationStart + other.valueStart,
            value: `${other === parameter ? name : other.name}=`,
        }));
}

function combineFieldEdits(
    source: string,
    edits: ReferenceReplacement[],
    fallbackStart: number,
): ReferenceReplacement {
    const changed = edits
        .filter((edit) => source.slice(edit.start, edit.end) !== edit.value)
        .sort((left, right) => left.start - right.start);
    const start = changed[0]?.start ?? fallbackStart;
    let end = start;
    let value = "";
    for (const edit of changed) {
        value += source.slice(end, edit.start) + edit.value;
        end = edit.end;
    }
    return { start, end, value };
}

function readEditableCitation(
    source: string,
    range: SourceRange,
): ParsedTemplateCall | null {
    if (!isValidRange(source, range)) {
        return null;
    }
    const raw = source.slice(range.start, range.end);
    return (
        wikitext(raw)
            .template.getAll()
            .find((call) => call.start === 0 && call.end === raw.length) ?? null
    );
}

function findParameterIndex(
    citation: ParsedTemplateCall,
    citationRange: SourceRange,
    fieldRange: SourceRange,
): number {
    return citation.params.findIndex((parameter) => {
        const range = trimRange(
            parameter.rawValue,
            citationRange.start + parameter.valueStart,
        );
        return range.start === fieldRange.start && range.end === fieldRange.end;
    });
}

function isValidFieldName(name: string): boolean {
    return name !== "" && !/[=|{}[\]<>\r\n]/u.test(name);
}

function isValidRange(source: string, range: SourceRange): boolean {
    return (
        Number.isInteger(range.start) &&
        Number.isInteger(range.end) &&
        range.start >= 0 &&
        range.end >= range.start &&
        range.end <= source.length
    );
}

function escapeParameterPipes(value: string): string {
    return wikitext(value)
        .splitRanges("|")
        .map((part) => part.value)
        .join("{{!}}");
}

function formatNewParameter(
    source: string,
    parameters: ParsedTemplateParameter[],
    name: string,
    value: string,
    target?: ParsedTemplateParameter,
): string {
    const named = parameters.filter((parameter) => !parameter.positional);
    const style =
        target == null
            ? named.at(-1)
            : named.toSorted(
                  (left, right) =>
                      Math.abs(left.start - target.start) -
                      Math.abs(right.start - target.start),
              )[0];
    if (style == null) {
        return `|${name}=${value}`;
    }
    const key = source.slice(style.start, style.valueStart - 1);
    const beforeName = key.match(/^[\t ]*/u)?.[0] ?? "";
    const afterName = key.match(/[\t ]*$/u)?.[0] ?? "";
    const beforeValue = style.rawValue.match(/^[\t ]*/u)?.[0] ?? "";
    return `|${beforeName}${name}${afterName}=${beforeValue}${value}`;
}

function createNotePreview(
    resolved: ResolvedReference,
): ReferencePreview | null {
    const noteText = resolved.source.trim();
    return noteText === "" &&
        resolved.details == null &&
        resolved.sourceStart == null
        ? null
        : {
              ...(noteText === "" && resolved.sourceStart == null
                  ? {}
                  : { noteText }),
              ...(resolved.sourceStart == null
                  ? {}
                  : {
                        noteRange: {
                            ...trimRange(resolved.source, resolved.sourceStart),
                            ...(resolved.sourceTemplateParameter
                                ? { templateParameter: true }
                                : {}),
                            ...(resolved.sourcePositional
                                ? { positional: true }
                                : {}),
                        },
                    }),
              referenceLabel: resolved.label,
              rows: [],
              templateName: "reference",
          };
}

function createCitationPreview(
    resolved: ResolvedReference,
    citation: ParsedTemplateCall,
    namespaceSource: NamespaceSource | null,
): ReferencePreview {
    const nameCounts = new Map<string, number>();
    for (const parameter of citation.params) {
        nameCounts.set(
            parameter.name,
            (nameCounts.get(parameter.name) ?? 0) + 1,
        );
    }
    const entered = citation.params.filter(
        (parameter) =>
            parameter.value !== "" ||
            resolved.sourceStart != null ||
            (nameCounts.get(parameter.name) ?? 0) > 1,
    );
    const originalUrl = entered.findLast(
        (parameter) => parameter.name.toLowerCase() === "url",
    )?.value;
    const fields = entered.map(function buildField(parameter) {
        const field: ReferencePreviewField = {
            name: parameter.name,
            value: parameter.value,
            ...((nameCounts.get(parameter.name) ?? 0) > 1
                ? { duplicate: true as const }
                : {}),
            ...(resolved.sourceStart == null
                ? {}
                : {
                      range: {
                          ...trimRange(
                              parameter.rawValue,
                              resolved.sourceStart + parameter.valueStart,
                          ),
                          templateParameter: true,
                          ...(parameter.positional ? { positional: true } : {}),
                      },
                  }),
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
        ...(resolved.sourceStart == null
            ? {}
            : {
                  citationRange: {
                      start: resolved.sourceStart + citation.start,
                      end: resolved.sourceStart + citation.end,
                  },
              }),
        referenceLabel: resolved.label,
        rows: pairPersonFields(fields),
        templateName: normalizeTemplateName(citation.name, namespaceSource),
        templateTitle: getTemplateTitle(citation.name, namespaceSource),
    };
}

function resolveReferenceSource(
    article: string,
    reference: string,
    namespaceSource: NamespaceSource | null,
    referenceStart?: number,
): ResolvedReference {
    const template = resolveTemplateReference(
        article,
        reference,
        namespaceSource,
        referenceStart,
    );
    if (template != null) {
        return template;
    }
    const ref = wikitext(reference)
        .reference.getAll()
        .find((tag) => tag.start === 0 && tag.end === reference.length);
    if (ref == null) {
        return { label: "", source: reference, sourceStart: referenceStart };
    }
    const label = ref.attributes.name ?? "";
    const details = ref.attributes.details?.trim();
    const showDetails =
        details != null && (details !== "" || referenceStart != null);
    const occurrence = {
        label,
        ...(showDetails ? { details } : {}),
        ...(showDetails && referenceStart != null
            ? {
                  detailsRange: findDetailsRange(
                      reference.slice(0, ref.contentStart),
                      referenceStart,
                  ),
              }
            : {}),
    };
    if (!ref.selfClosing) {
        return {
            ...occurrence,
            source: ref.content,
            sourceStart:
                referenceStart == null
                    ? undefined
                    : referenceStart + ref.contentStart,
        };
    }
    const definition = wikitext(article).reference.getFirst(
        label,
        ref.attributes.group,
    );
    return {
        ...occurrence,
        ...(definition == null ? { missingDefinition: true } : {}),
        source: definition?.content ?? "",
        sourceStart:
            referenceStart == null ? undefined : definition?.contentStart,
    };
}

function resolveTemplateReference(
    article: string,
    reference: string,
    namespaceSource: NamespaceSource | null,
    referenceStart?: number,
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
        const citation = shortFootnotes.findShortFootnoteCitation(
            article,
            reference,
            (value) => normalizeTemplateName(value, namespaceSource),
        );
        return {
            label,
            source: citation?.raw ?? "",
            sourceStart: referenceStart == null ? undefined : citation?.start,
        };
    }
    if (/^efn(?:$|[- /])/u.test(name)) {
        return resolveExplanatoryFootnote(parsed, referenceStart);
    }
    if (name !== "r") {
        return null;
    }
    const label = parsed.params.find(
        (parameter) => parameter.name === "1",
    )?.value;
    const definition = wikitext(article).reference.getFirst(label ?? "");
    return {
        label: label ?? "",
        source: definition?.content ?? "",
        sourceStart:
            referenceStart == null ? undefined : definition?.contentStart,
    };
}

function resolveExplanatoryFootnote(
    parsed: ParsedTemplateCall,
    referenceStart?: number,
): ResolvedReference {
    const note = parsed.params.find((parameter) => parameter.name === "1");
    const label = parsed.params.find(
        (parameter) => parameter.name.toLowerCase() === "name",
    )?.value;
    return {
        label: label ?? "",
        source: note?.rawValue ?? "",
        sourceStart:
            referenceStart == null || note == null
                ? undefined
                : referenceStart + note.valueStart,
        sourceTemplateParameter: true,
        ...(note?.positional ? { sourcePositional: true } : {}),
    };
}

function findCitationTemplate(
    source: string,
    namespaceSource: NamespaceSource | null,
): ParsedTemplateCall | undefined {
    for (const template of wikitext(source).template.getAll()) {
        const name = normalizeTemplateName(template.name, namespaceSource);
        if (/^(?:cite(?:\s|$)|citation$)/u.test(name)) {
            return template;
        }
    }
    return undefined;
}

function trimRange(value: string, start: number): ReferenceEditRange {
    const leading = value.length - value.trimStart().length;
    return {
        start: start + leading,
        end: start + Math.max(leading, value.trimEnd().length),
    };
}

function findDetailsRange(
    opening: string,
    referenceStart: number,
): ReferenceEditRange | undefined {
    const pattern =
        /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/dgu;
    let range: ReferenceEditRange | undefined;
    for (const match of opening.replace(/\/\s*>$/u, ">").matchAll(pattern)) {
        if (match[1].toLowerCase() !== "details") {
            continue;
        }
        const group = match[2] != null ? 2 : match[3] != null ? 3 : 4;
        const offset = match.indices?.[group]?.[0];
        range =
            offset == null
                ? undefined
                : {
                      ...trimRange(match[group], referenceStart + offset),
                      quote: group === 2 ? '"' : group === 3 ? "'" : "",
                  };
    }
    return range;
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
