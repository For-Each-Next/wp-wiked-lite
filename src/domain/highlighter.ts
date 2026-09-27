/** Pure wikitext classification for the enhanced editor surface. */

import {
    formatNamespaceTitle,
    getNamespaceId,
    getNamespacePrefixes,
    type NamespaceSource,
    stripNamespacePrefix,
} from "./wiki-titles.ts";
import {
    type ParsedTemplateCall,
    type ParsedTemplateParameter,
    type ParsedWikitableCaption,
    type ParsedWikitableRow,
    type SourceRange,
    type TopLevelRange,
    wikitext,
    type WikitextTag,
} from "./wikitext/index.ts";
import {
    classifyTemplateHead,
    type MagicWordAliases,
    type TemplateHeadSyntax,
    type TemplateMagicWordCatalog,
} from "./magic-words.ts";
import {
    findConversionKeyRanges,
    findLanguageConversionRanges,
    isNoteTAConversionParameter,
    isNoteTAName,
} from "./conversion-rules.ts";
import {
    type HighlightRange as DecoratedRange,
    type HighlightSegment,
    mergeSourceRanges,
    partitionHighlightRanges,
} from "./highlight-partition.ts";
import {
    createReferenceHighlighting,
    createReferenceTemplateDecoration,
    type ReferenceHighlighting,
} from "./reference-highlighting.ts";

export type { HighlightSegment } from "./highlight-partition.ts";

export interface HighlightOptions {
    alternateReferenceColors?: boolean;
    databaseName?: string;
    imageOptions?: ImageOptionCatalog | null;
    linkHelpers?: boolean;
    namespaceSource?: NamespaceSource;
    templateMagicWords?: TemplateMagicWordCatalog | null;
}

export interface ImageOptionCatalog {
    literals: MagicWordAliases;
    named: MagicWordAliases;
    spaced: MagicWordAliases;
    underscored: MagicWordAliases;
}

interface EmphasisState {
    bold?: number;
    italic?: number;
}

interface CssScanState {
    comment: boolean;
    parentheses: number;
    quote: string;
}

interface TemplateDecorationContext {
    databaseName: string;
    linkHelpersEnabled: boolean;
    namespaceSource: NamespaceSource;
    references: ReferenceHighlighting;
    templateMagicWords: TemplateMagicWordCatalog | null;
}

const LINK_HELPER_PATTERN = /^(?:tsl|translink|link-[a-z0-9-]+)$/u;
const CSS_PROPERTY_NAME_PATTERN = /^(?:--|-(?!-))?[_\p{L}][-\p{L}\p{N}_]*$/u;
const TAG_ATTRIBUTE_PATTERN =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
const HIGHLIGHT_LITERAL_TAGS = [
    "chem",
    "graph",
    "hiero",
    "mapframe",
    "math",
    "nowiki",
    "poem",
    "pre",
    "score",
    "source",
    "syntaxhighlight",
    "templatedata",
    "templatestyles",
    "timeline",
] as const;
const LITERAL_TOKEN_CLASSES: Readonly<Record<string, string>> = {
    chem: "wiked-lite-token--math",
    graph: "wiked-lite-token--pre",
    hiero: "wiked-lite-token--score",
    math: "wiked-lite-token--math",
    nowiki: "wiked-lite-token--nowiki",
    poem: "wiked-lite-token--pre",
    pre: "wiked-lite-token--block-literal",
    score: "wiked-lite-token--score",
    source: "wiked-lite-token--block-literal",
    syntaxhighlight: "wiked-lite-token--block-literal",
    templatedata: "wiked-lite-token--pre",
    timeline: "wiked-lite-token--score",
};
const FILE_SIZE_OPTION_PATTERN = /^(?:(\d+)(?:x(\d+))?|x(\d+))[ \t]*px$/u;
const HTML_ENTITY_PATTERN =
    /&(?:#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/gu;
const SPECIAL_CHARACTER_PATTERN =
    /[\t\u00ad\u2002\u2003\u2009\u2012-\u2015\u2212\u3000]/gu;
const SPECIAL_CHARACTER_CLASSES: Readonly<Record<string, string>> = {
    "\t": "wiked-lite-token--tab",
    "\u00ad": "wiked-lite-token--soft-hyphen",
    "\u2002": "wiked-lite-token--en-space",
    "\u2003": "wiked-lite-token--em-space",
    "\u2009": "wiked-lite-token--thin-space",
    "\u2012": "wiked-lite-token--figure-dash",
    "\u2013": "wiked-lite-token--en-dash",
    "\u2014": "wiked-lite-token--em-dash",
    "\u2015": "wiked-lite-token--horizontal-bar",
    "\u2212": "wiked-lite-token--minus-sign",
    "\u3000": "wiked-lite-token--ideographic-space",
};
const EN_IMAGE_TEMPLATE_NAMES = normalizeNames([
    "Multiple image",
    "Auto images",
    "Autoimages",
    "Double image",
    "Double image stack",
    "Double images",
    "Doubleimage",
    "Dual image",
    "Four images",
    "Mehrere Bilder",
    "MImage",
    "Mim",
    "Mimg",
    "Mulitple images",
    "Multi image",
    "Multiimage",
    "Multimage",
    "Multimg",
    "Multiple iamge",
    "Multiple images",
    "Multiple video",
    "Multipleimage",
    "Multipleimages",
    "Multipic",
    "Triple image",
    "Tripleimage",
    "Vertical images list",
]);
const ZH_IMAGE_TEMPLATE_NAMES = normalizeNames([
    "Multiple image",
    "Auto images",
    "MI",
    "Multiple images",
    "Multipleimage",
    "並列圖像",
    "并列图像",
    "多个图像",
    "多图",
    "多图并列",
    "File2",
    "File",
    "Image",
    "图像",
    "圖片",
    "文件",
    "文件2",
    "FileTA",
    "ImageTA",
]);

/**
 * Classifies wikitext without creating or injecting HTML.
 *
 * @param source - Source text.
 * @param options - Operation options.
 * @returns Resulting values.
 */
export function highlightWikitext(
    source: string,
    options: HighlightOptions = {},
): HighlightSegment[] {
    const linkHelpers = options.linkHelpers === true;
    const namespaceSource = options.namespaceSource ?? "enwiki";
    const databaseName =
        options.databaseName ??
        (typeof namespaceSource === "string"
            ? namespaceSource
            : namespaceSource.databaseName);
    const query = createHighlightQuery(source);
    const tags = query.tag.getAll();
    const templateNames = new Map(
        query.template
            .getAll()
            .map((template) => [
                template,
                normalizeCurrentTemplateName(template.name, namespaceSource),
            ]),
    );
    const references = createReferenceHighlighting(
        source,
        tags,
        templateNames,
        options.alternateReferenceColors === true,
    );
    const ranges = [
        ...createOpaqueDecorations(source, tags),
        ...createTagDecorations(source, tags),
        ...createWikitableDecorations(source),
        ...createTemplateDecorations(source, templateNames, {
            databaseName,
            linkHelpersEnabled: linkHelpers,
            namespaceSource,
            references,
            templateMagicWords: options.templateMagicWords ?? null,
        }),
        ...references.decorations,
        ...createLinkDecorations(
            source,
            namespaceSource,
            options.imageOptions ?? null,
        ),
        ...createLanguageConversionDecorations(source, linkHelpers),
        ...createEmphasisDecorations(source),
        ...createListDecorations(source),
        ...createExternalLinkDecorations(source),
        ...createUrlDecorations(source),
        ...createHeadingDecorations(source),
        ...createEntityDecorations(source),
        ...createSpecialCharacterDecorations(source),
    ];
    return partitionHighlightRanges(source, ranges);
}

/**
 * Collects local targets from supported interlanguage-link helpers.
 *
 * @param source - Source text.
 * @param namespaceSource - Database-scoped namespace data.
 * @returns Unique local page targets.
 */
export function collectLinkHelperTitles(
    source: string,
    namespaceSource: NamespaceSource = "enwiki",
): string[] {
    const titles = createHighlightQuery(source)
        .template.getAll()
        .flatMap(function getTarget(template) {
            const name = normalizeCurrentTemplateName(
                template.name,
                namespaceSource,
            );
            const parameters = indexTemplateParameters(template);
            const descriptor = getLinkHelperDescriptor(name, parameters);
            const target = parameters.get(descriptor?.targetKey ?? "")?.value;
            const title =
                target == null ? undefined : normalizeMissingTitle(target);
            return title == null ? [] : [title.replaceAll("_", " ")];
        });
    return [...new Set(titles)];
}

function trimSourceRange(
    source: string,
    initialStart: number,
    initialEnd: number,
): SourceRange {
    let start = initialStart;
    let end = initialEnd;
    while (start < end && /\s/u.test(source[start] ?? "")) {
        start += 1;
    }
    while (start < end && /\s/u.test(source[end - 1] ?? "")) {
        end -= 1;
    }
    return { end, start };
}

function createOpaqueDecorations(
    source: string,
    tags: WikitextTag[],
): DecoratedRange[] {
    const query = createHighlightQuery(source);
    const literalRanges = tags
        .filter((tag) => tag.protectedContent)
        .map(function decorate(tag) {
            return {
                className:
                    LITERAL_TOKEN_CLASSES[tag.name] ?? "wiked-lite-token--pre",
                end: tag.end,
                priority: 100,
                start: tag.start,
            };
        });
    const comments = query.comment
        .getAll()
        .filter((comment) => !isInsideRange(comment, literalRanges))
        .map(function decorate(comment) {
            return {
                ...comment,
                className: "wiked-lite-token--comment",
                priority: 100,
            };
        });
    return [...literalRanges, ...comments];
}

function isInsideRange(inner: SourceRange, ranges: SourceRange[]): boolean {
    return ranges.some(
        (range) => range.start <= inner.start && inner.end <= range.end,
    );
}

function createTagDecorations(
    source: string,
    tags: WikitextTag[],
): DecoratedRange[] {
    const ancestors: SourceRange[] = [];
    const ranges: DecoratedRange[] = [];
    for (const tag of tags) {
        removeCompletedTagAncestors(ancestors, tag);
        const depth = ancestors.length;
        ranges.push(...decorateTag(source, tag, depth));
        if (tag.closed && !tag.selfClosing) {
            ancestors.push(tag);
        }
    }
    return ranges;
}

function removeCompletedTagAncestors(
    ancestors: SourceRange[],
    tag: SourceRange,
): void {
    while (ancestors.length > 0) {
        const parent = ancestors.at(-1);
        if (
            parent != null &&
            parent.start <= tag.start &&
            tag.end <= parent.end
        ) {
            return;
        }
        ancestors.pop();
    }
}

function decorateTag(
    source: string,
    tag: WikitextTag,
    depth: number,
): DecoratedRange[] {
    const visibleDepth = Math.min(depth, 4);
    const ranges: DecoratedRange[] = [
        {
            className: "wiked-lite-token--html-tag",
            end: tag.contentStart,
            priority: 40,
            start: tag.start,
        },
    ];
    if (
        tag.closed &&
        !tag.protectedContent &&
        tag.contentStart < tag.contentEnd &&
        depth <= 4
    ) {
        ranges.push({
            className: `wiked-lite-token--html-content-${visibleDepth}`,
            end: tag.contentEnd,
            priority: 30 + visibleDepth,
            start: tag.contentStart,
        });
    }
    if (!tag.selfClosing && tag.contentEnd < tag.end) {
        ranges.push({
            className: "wiked-lite-token--html-tag",
            end: tag.end,
            priority: 40,
            start: tag.contentEnd,
        });
    }
    return [
        ...ranges,
        ...createTagAttributeDecorations(source, tag.start, tag.contentStart),
    ];
}

function createTagAttributeDecorations(
    source: string,
    openingStart: number,
    openingEnd: number,
): DecoratedRange[] {
    const opening = source.slice(openingStart, openingEnd);
    const tagName = /^<\s*[\p{L}\p{N}:-]+/u.exec(opening)?.[0];
    if (tagName == null) {
        return [];
    }
    const attributesStart = openingStart + tagName.length;
    const attributes = source.slice(attributesStart, openingEnd - 1);
    return [...attributes.matchAll(TAG_ATTRIBUTE_PATTERN)].flatMap((match) =>
        decorateTagAttribute(source, attributesStart, match),
    );
}

function decorateTagAttribute(
    source: string,
    attributesStart: number,
    match: RegExpMatchArray,
): DecoratedRange[] {
    const enteredName = match[1];
    const name = enteredName?.toLocaleLowerCase();
    if (enteredName == null || (name !== "lang" && name !== "style")) {
        return [];
    }
    const nameStart = attributesStart + (match.index ?? 0);
    const nameRange: DecoratedRange = {
        className: "wiked-lite-token--parameter",
        end: nameStart + enteredName.length,
        priority: 101,
        start: nameStart,
    };
    const valueRange = getTagAttributeValueRange(attributesStart, match);
    return name !== "style" || valueRange == null
        ? [nameRange]
        : [
              nameRange,
              ...createCssPropertyDecorations(
                  source,
                  valueRange.start,
                  valueRange.end,
              ),
          ];
}

function getTagAttributeValueRange(
    attributesStart: number,
    match: RegExpMatchArray,
): SourceRange | null {
    const value = match[2] ?? match[3] ?? match[4];
    const equals = match[0].indexOf("=");
    if (value == null || equals < 0) {
        return null;
    }
    let valueOffset = equals + 1;
    while (/\s/u.test(match[0][valueOffset] ?? "")) {
        valueOffset += 1;
    }
    if (match[0][valueOffset] === '"' || match[0][valueOffset] === "'") {
        valueOffset += 1;
    }
    const start = attributesStart + (match.index ?? 0) + valueOffset;
    return { end: start + value.length, start };
}

function createWikitableDecorations(source: string): DecoratedRange[] {
    const attributeRanges = findWikitableAttributeRanges(source);
    return attributeRanges.flatMap(function decorateAttributes(range) {
        const attributes = trimSourceRange(source, range.start, range.end);
        const styleDecorations = createStyleAttributeValueDecorations(
            source,
            range.start,
            range.end,
        );
        return attributes.start === attributes.end
            ? styleDecorations
            : [
                  {
                      ...attributes,
                      className: "wiked-lite-token--table",
                      priority: 10,
                  },
                  ...styleDecorations,
              ];
    });
}

function findWikitableAttributeRanges(source: string): SourceRange[] {
    const query = createHighlightQuery(source);
    const attributeRanges: SourceRange[] = [];
    const parameterDelimiters = getTemplateParameterDelimiters(
        query.template.getAll(),
    );
    for (const table of query.table.getAll()) {
        attributeRanges.push({
            end: findLineContentEnd(source, table.start + 2),
            start: table.start + 2,
        });
        attributeRanges.push(
            ...getWikitableCaptionAttributeRanges(
                source,
                table.captions,
                parameterDelimiters,
            ),
        );
        attributeRanges.push(
            ...getWikitableRowAttributeRanges(
                source,
                table.rows,
                parameterDelimiters,
            ),
        );
    }
    return attributeRanges;
}

function getWikitableCaptionAttributeRanges(
    source: string,
    captions: ParsedWikitableCaption[],
    parameterDelimiters: ReadonlySet<number>,
): SourceRange[] {
    return captions.flatMap(function getRange(caption) {
        if (parameterDelimiters.has(caption.start)) {
            return [];
        }
        const range = getWikitablePayloadAttributeRange(
            source,
            caption.start + 2,
            caption.contentStart,
        );
        return range == null ? [] : [range];
    });
}

function getWikitableRowAttributeRanges(
    source: string,
    rows: ParsedWikitableRow[],
    parameterDelimiters: ReadonlySet<number>,
): SourceRange[] {
    const ranges: SourceRange[] = [];
    for (const row of rows) {
        if (
            source.startsWith("|-", row.start) &&
            !parameterDelimiters.has(row.start)
        ) {
            ranges.push({
                end: findLineContentEnd(source, row.start + 2),
                start: row.start + 2,
            });
        }
        for (const cell of row.cells) {
            if (parameterDelimiters.has(cell.start)) {
                continue;
            }
            const markerEnd = getWikitableCellMarkerEnd(source, cell.start);
            const range = getWikitablePayloadAttributeRange(
                source,
                markerEnd,
                cell.contentStart,
            );
            if (range != null) {
                ranges.push(range);
            }
        }
    }
    return ranges;
}

function getTemplateParameterDelimiters(
    templates: ParsedTemplateCall[],
): Set<number> {
    return new Set(
        templates
            .flatMap((template) => template.params)
            .map((parameter) => parameter.start - 1),
    );
}

function getWikitablePayloadAttributeRange(
    source: string,
    markerEnd: number,
    contentStart: number,
): SourceRange | null {
    if (contentStart <= markerEnd || source[contentStart - 1] !== "|") {
        return null;
    }
    return { end: contentStart - 1, start: markerEnd };
}

function getWikitableCellMarkerEnd(source: string, start: number): number {
    return (
        start +
        (source.startsWith("!!", start) || source.startsWith("||", start)
            ? 2
            : 1)
    );
}

function findLineContentEnd(source: string, start: number): number {
    const newline = source.indexOf("\n", start);
    if (newline < 0) {
        return source.length;
    }
    return source[newline - 1] === "\r" ? newline - 1 : newline;
}

function createStyleAttributeValueDecorations(
    source: string,
    attributesStart: number,
    attributesEnd: number,
): DecoratedRange[] {
    const attributes = source.slice(attributesStart, attributesEnd);
    const scanAttributes = maskCssWikitext(attributes);
    return [...scanAttributes.matchAll(TAG_ATTRIBUTE_PATTERN)].flatMap(
        function decorateStyleAttribute(match) {
            if (match[1]?.toLocaleLowerCase() !== "style") {
                return [];
            }
            const valueRange = getTagAttributeValueRange(
                attributesStart,
                match,
            );
            return valueRange == null
                ? []
                : createCssPropertyDecorations(
                      source,
                      valueRange.start,
                      valueRange.end,
                  );
        },
    );
}

function createCssPropertyDecorations(
    source: string,
    start: number,
    end: number,
): DecoratedRange[] {
    const style = source.slice(start, end);
    const scanStyle = maskCssWikitext(style);
    const separators = findCssTopLevelSeparators(scanStyle, ";");
    const boundaries = [-1, ...separators, style.length];
    const ranges: DecoratedRange[] = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const declarationStart = (boundaries[index] ?? -1) + 1;
        const declarationEnd = boundaries[index + 1] ?? style.length;
        const declaration = scanStyle.slice(declarationStart, declarationEnd);
        const colon = findCssTopLevelSeparators(declaration, ":")[0];
        if (colon == null) {
            continue;
        }
        const property = trimSourceRange(
            source,
            start + declarationStart,
            start + declarationStart + colon,
        );
        if (
            !CSS_PROPERTY_NAME_PATTERN.test(
                source.slice(property.start, property.end),
            )
        ) {
            continue;
        }
        ranges.push({
            ...property,
            className: "wiked-lite-token--language-variant",
            priority: 102,
        });
    }
    return ranges;
}

function maskCssWikitext(source: string): string {
    const query = createHighlightQuery(source);
    return maskSourceRanges(source, [
        ...query.opaque.getAll(),
        ...query.template.getAll(),
        ...query.link.getAll(),
        ...createTagMarkupRanges(source),
    ]);
}

function findCssTopLevelSeparators(
    source: string,
    separator: string,
): number[] {
    const separators: number[] = [];
    const state: CssScanState = { comment: false, parentheses: 0, quote: "" };
    for (let index = 0; index < source.length; index += 1) {
        const nextIndex = consumeCssProtectedSequence(source, index, state);
        if (nextIndex != null) {
            index = nextIndex - 1;
            continue;
        }
        const character = source[index] ?? "";
        if (character === "(") {
            state.parentheses += 1;
        } else if (character === ")") {
            state.parentheses = Math.max(0, state.parentheses - 1);
        } else if (character === separator && state.parentheses === 0) {
            separators.push(index);
        }
    }
    return separators;
}

function consumeCssProtectedSequence(
    source: string,
    index: number,
    state: CssScanState,
): number | undefined {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state.comment) {
        if (character === "*" && next === "/") {
            state.comment = false;
            return index + 2;
        }
        return index + 1;
    }
    if (state.quote !== "") {
        if (character === "\\") {
            return index + 2;
        }
        if (character === state.quote) {
            state.quote = "";
        }
        return index + 1;
    }
    if (character === "/" && next === "*") {
        state.comment = true;
        return index + 2;
    }
    if (character === '"' || character === "'") {
        state.quote = character;
        return index + 1;
    }
    return character === "\\" ? index + 2 : undefined;
}

function createTemplateDecorations(
    source: string,
    templateNames: ReadonlyMap<ParsedTemplateCall, string>,
    context: TemplateDecorationContext,
): DecoratedRange[] {
    return [...templateNames].flatMap(([template, name]) =>
        decorateTemplate(source, template, name, context),
    );
}

function decorateTemplate(
    source: string,
    template: ParsedTemplateCall,
    name: string,
    context: TemplateDecorationContext,
): DecoratedRange[] {
    const depth = context.references.getTemplateDepth(template);
    const linkHelperEnabled =
        context.linkHelpersEnabled || name === "tsl" || name === "translink";
    const ranges = [
        createTemplateMainDecoration(template, name, depth, context),
        ...createTemplateDelimiterDecorations(template, depth),
        ...createTemplateSyntaxDecorations(
            source,
            template,
            depth,
            context.namespaceSource,
            context.templateMagicWords,
        ),
        ...(linkHelperEnabled && isLinkHelperName(name)
            ? createLinkHelperDecorations(source, template, name)
            : []),
        ...createNoteTAConversionDecorations(
            source,
            template,
            name,
            context.linkHelpersEnabled,
        ),
    ];
    return context.references.clipTemplateDecorations(template, ranges);
}

function createTemplateMainDecoration(
    template: ParsedTemplateCall,
    name: string,
    depth: number,
    context: TemplateDecorationContext,
): DecoratedRange {
    return (
        createReferenceTemplateDecoration(template, name, depth) ?? {
            end: template.end,
            start: template.start,
            className: isImageTemplate(name, context.databaseName)
                ? "wiked-lite-token--image-template"
                : `wiked-lite-token--template-${Math.min(depth, 4)}`,
            priority: 30 + depth,
        }
    );
}

function getTemplateTitle(
    value: string,
    namespaceSource: NamespaceSource,
): string {
    const title = value.trim();
    if (title.startsWith(":")) {
        return title.slice(1).trimStart();
    }
    const separator = title.indexOf(":");
    if (separator >= 0) {
        const enteredPrefix = title.slice(0, separator).trim();
        const namespaceId = getNamespaceId(namespaceSource, enteredPrefix);
        if (namespaceId != null) {
            const remainder = title.slice(separator + 1).trim();
            const prefix =
                getNamespacePrefixes(namespaceSource, namespaceId)[0] ??
                enteredPrefix;
            return prefix === "" ? remainder : `${prefix}:${remainder}`;
        }
    }
    return formatNamespaceTitle(title, namespaceSource, 10);
}

function getTemplateHref(
    value: string,
    namespaceSource: NamespaceSource,
): string {
    return `/wiki/${encodeTitle(getTemplateTitle(value, namespaceSource))}`;
}

function normalizeCurrentTemplateName(
    value: string,
    namespaceSource: NamespaceSource,
): string {
    return stripNamespacePrefix(value, namespaceSource, 10)
        .replaceAll("_", " ")
        .trim()
        .replace(/\s+/gu, " ")
        .toLowerCase();
}

function createTemplateDelimiterDecorations(
    template: ParsedTemplateCall,
    depth: number,
): DecoratedRange[] {
    const priority = 49 + depth;
    const ranges = [
        createDelimiterRange(template.start, template.start + 2, priority),
        createDelimiterRange(template.end - 2, template.end, priority),
    ];
    for (const parameter of template.params) {
        ranges.push(
            createDelimiterRange(
                parameter.start - 1,
                parameter.start,
                priority,
            ),
        );
        if (!parameter.positional) {
            ranges.push(
                createDelimiterRange(
                    parameter.valueStart - 1,
                    parameter.valueStart,
                    priority,
                ),
            );
        }
    }
    return ranges;
}

function createDelimiterRange(
    start: number,
    end: number,
    priority: number,
): DecoratedRange {
    return {
        className: "wiked-lite-token--template-delimiter",
        end,
        priority,
        start,
    };
}

function createTemplateSyntaxDecorations(
    source: string,
    template: ParsedTemplateCall,
    depth: number,
    namespaceSource: NamespaceSource,
    templateMagicWords: TemplateMagicWordCatalog | null,
): DecoratedRange[] {
    const priority = 50 + depth;
    const nameStart = source.indexOf(
        template.name,
        Math.min(template.start + 2, template.end),
    );
    const head =
        nameStart >= template.start && nameStart < template.end
            ? createTemplateHeadDecorations(
                  source,
                  classifyTemplateHead(
                      template.name,
                      template.params.length > 0,
                      templateMagicWords,
                  ),
                  nameStart,
                  priority,
                  namespaceSource,
              )
            : [];
    return [
        ...head,
        ...createTemplateParameterNameDecorations(source, template, priority),
    ];
}

function createTemplateParameterNameDecorations(
    source: string,
    template: ParsedTemplateCall,
    priority: number,
): DecoratedRange[] {
    const ranges: DecoratedRange[] = [];
    for (const parameter of template.params) {
        if (parameter.positional) {
            continue;
        }
        const nameEnd = Math.max(parameter.start, parameter.valueStart - 1);
        const parameterStart = source.indexOf(parameter.name, parameter.start);
        if (parameterStart < parameter.start || parameterStart >= nameEnd) {
            continue;
        }
        ranges.push({
            className: "wiked-lite-token--parameter",
            end: parameterStart + parameter.name.length,
            priority,
            start: parameterStart,
        });
    }
    return ranges;
}

function createTemplateHeadDecorations(
    source: string,
    syntax: TemplateHeadSyntax,
    nameStart: number,
    priority: number,
    namespaceSource: NamespaceSource,
): DecoratedRange[] {
    const ranges = createTemplateModifierDecorations(
        syntax,
        nameStart,
        priority,
    );
    if (syntax.kind === "template") {
        return [
            ...ranges,
            ...createTemplateTargetDecoration(
                source,
                syntax.target,
                nameStart,
                priority,
                namespaceSource,
            ),
        ];
    }
    return [
        ...ranges,
        ...createMagicWordDecorations(
            source,
            syntax,
            nameStart,
            priority,
            namespaceSource,
        ),
    ];
}

function createMagicWordDecorations(
    source: string,
    syntax: Extract<TemplateHeadSyntax, { kind: "magic-word" }>,
    nameStart: number,
    priority: number,
    namespaceSource: NamespaceSource,
): DecoratedRange[] {
    return [
        createParserFunctionDecoration(syntax.magicWord, nameStart, priority),
        ...createModuleNameDecoration(
            source,
            syntax.invoke ? syntax.argument : undefined,
            nameStart,
            priority,
            namespaceSource,
        ),
    ];
}

function createTemplateModifierDecorations(
    syntax: TemplateHeadSyntax,
    nameStart: number,
    priority: number,
): DecoratedRange[] {
    return [
        ...syntax.modifiers.map((range) =>
            createParserFunctionDecoration(range, nameStart, priority),
        ),
        ...syntax.separators.map((range) =>
            createParserFunctionDecoration(range, nameStart, priority),
        ),
    ];
}

function createParserFunctionDecoration(
    range: SourceRange,
    offset: number,
    priority: number,
): DecoratedRange {
    return {
        className: "wiked-lite-token--parser-function",
        end: offset + range.end,
        priority,
        start: offset + range.start,
    };
}

function createTemplateTargetDecoration(
    source: string,
    targetRange: SourceRange,
    nameStart: number,
    priority: number,
    namespaceSource: NamespaceSource,
): DecoratedRange[] {
    const target = source.slice(
        nameStart + targetRange.start,
        nameStart + targetRange.end,
    );
    return target === ""
        ? []
        : [
              {
                  className: "wiked-lite-token--template-name",
                  end: nameStart + targetRange.end,
                  href: getTemplateHref(target, namespaceSource),
                  priority,
                  start: nameStart + targetRange.start,
              },
          ];
}

function createModuleNameDecoration(
    source: string,
    module: SourceRange | undefined,
    nameStart: number,
    priority: number,
    namespaceSource: NamespaceSource,
): DecoratedRange[] {
    if (module == null) {
        return [];
    }
    const moduleName = source.slice(
        nameStart + module.start,
        nameStart + module.end,
    );
    const href = getModuleHref(moduleName, namespaceSource);
    return href == null
        ? []
        : [
              {
                  className: "wiked-lite-token--module-name",
                  end: nameStart + module.end,
                  href,
                  priority,
                  start: nameStart + module.start,
              },
          ];
}

function getModuleHref(
    value: string,
    namespaceSource: NamespaceSource,
): string | undefined {
    const prefix = getNamespacePrefixes(namespaceSource, 828)[0];
    if (value === "" || /[#<>{}[\]|\n\r]/u.test(value) || prefix == null) {
        return undefined;
    }
    const title = `${prefix}:${value}`;
    return `/wiki/${encodeTitle(title)}`;
}

function isImageTemplate(name: string, databaseName: string): boolean {
    if (databaseName === "enwiki") {
        return EN_IMAGE_TEMPLATE_NAMES.has(name);
    }
    return databaseName === "zhwiki" && ZH_IMAGE_TEMPLATE_NAMES.has(name);
}

function createLinkHelperDecorations(
    source: string,
    template: ParsedTemplateCall,
    name: string,
): DecoratedRange[] {
    const parameters = indexTemplateParameters(template);
    const descriptor = getLinkHelperDescriptor(name, parameters);
    if (descriptor == null) {
        return [];
    }
    const foreign = getForeignLinkTarget(name, parameters);
    const target = parameters.get(descriptor.targetKey);
    if (target == null || target.value === "") {
        return [];
    }
    const href = `/wiki/${encodeTitle(target.value)}`;
    const targetClass =
        descriptor.displayKey === ""
            ? "wiked-lite-token--link-helper"
            : "wiked-lite-token--link";
    const targetRange = decorateParameterValue(
        source,
        target,
        targetClass,
        href,
        normalizeMissingTitle(target.value),
        createPagePreviewTarget("local", target.value),
    );
    const display = parameters.get(descriptor.displayKey);
    const displayRange =
        display == null
            ? null
            : decorateParameterValue(
                  source,
                  display,
                  "wiked-lite-token--link-helper",
                  href,
              );
    const foreignTitle =
        foreign == null || foreign.key === descriptor.targetKey
            ? undefined
            : parameters.get(foreign.key);
    const foreignRange =
        foreignTitle == null || foreign == null
            ? null
            : decorateParameterValue(
                  source,
                  foreignTitle,
                  name === "tsl" || name === "translink"
                      ? "wiked-lite-token--foreign-title"
                      : "wiked-lite-token--link-helper",
                  getForeignPageHref(foreign.wiki, foreignTitle.value),
                  undefined,
                  createPagePreviewTarget(foreign.wiki, foreignTitle.value),
              );
    return [targetRange, displayRange, foreignRange].filter(isDecoratedRange);
}

function getForeignLinkTarget(
    name: string,
    parameters: ReadonlyMap<string, ParsedTemplateParameter>,
): { key: "2"; wiki: string } | null {
    if (name === "link-wd") {
        return null;
    }
    const code =
        /^link-([a-z]{2})$/u.exec(name)?.[1] ??
        (name === "tsl" || name === "translink"
            ? parameters.get("1")?.value.trim().toLowerCase()
            : undefined);
    return code != null && /^[a-z]{2}$/u.test(code)
        ? { key: "2", wiki: code }
        : null;
}

function getForeignPageHref(wiki: string, entered: string): string | undefined {
    if (/[<>{}[\]|\p{Cc}]/u.test(entered)) {
        return undefined;
    }
    const fragmentStart = entered.indexOf("#");
    const title = normalizeMissingTitle(entered);
    if (title == null) {
        return undefined;
    }
    const fragment =
        fragmentStart < 0
            ? ""
            : `#${encodeTitle(entered.slice(fragmentStart + 1))}`;
    return `https://${wiki}.wikipedia.org/wiki/${encodeTitle(title)}${fragment}`;
}

function indexTemplateParameters(
    template: ParsedTemplateCall,
): Map<string, ParsedTemplateParameter> {
    return new Map(
        template.params.map((parameter) => [
            parameter.name.toLowerCase(),
            parameter,
        ]),
    );
}

function getLinkHelperDescriptor(
    name: string,
    parameters: ReadonlyMap<string, ParsedTemplateParameter>,
): { displayKey: string; targetKey: string } | null {
    const has = (key: string) => (parameters.get(key)?.value ?? "") !== "";
    if (name === "tsl" || name === "translink") {
        return {
            displayKey: has("4") ? "4" : "",
            targetKey: has("3") ? "3" : "2",
        };
    }
    if (name === "link-wikidata" || name === "link-wd") {
        return {
            displayKey: has("2") ? "2" : "",
            targetKey: has("title") ? "title" : "page",
        };
    }
    if (/^(?:ill|illm|interlanguage link multi)$/u.test(name)) {
        return { displayKey: has("lt") ? "lt" : "", targetKey: "1" };
    }
    if (!isLinkHelperName(name)) {
        return null;
    }
    return {
        displayKey: has("d") ? "d" : has("3") ? "3" : "",
        targetKey: "1",
    };
}

function isLinkHelperName(name: string): boolean {
    return (
        name === "le" ||
        name === "lj" ||
        name === "link-wikidata" ||
        name === "link-wd" ||
        /^(?:ill|illm|interlanguage link multi)$/u.test(name) ||
        /^(?:internal link helper|ilh)\/[a-z0-9-]+$/u.test(name) ||
        LINK_HELPER_PATTERN.test(name) ||
        /^[a-z0-9-]+-link$/u.test(name)
    );
}

function decorateParameterValue(
    source: string,
    parameter: ParsedTemplateParameter,
    className: string,
    href?: string,
    missingTitle?: string,
    pagePreview?: DecoratedRange["pagePreview"],
): DecoratedRange | null {
    if (parameter.value === "") {
        return null;
    }
    const start = source.indexOf(parameter.value, parameter.valueStart);
    if (start < parameter.valueStart || start >= parameter.valueEnd) {
        return null;
    }
    return {
        className,
        end: start + parameter.value.length,
        href,
        missingTitle,
        pagePreview,
        priority: 45,
        start,
    };
}

function isDecoratedRange(
    range: DecoratedRange | null,
): range is DecoratedRange {
    return range != null;
}

function createLinkDecorations(
    source: string,
    namespaceSource: NamespaceSource,
    imageOptions: ImageOptionCatalog | null,
): DecoratedRange[] {
    return createHighlightQuery(source)
        .link.getAll()
        .flatMap((range) =>
            decorateLink(source, range, namespaceSource, imageOptions),
        );
}

function decorateLink(
    source: string,
    range: SourceRange,
    namespaceSource: NamespaceSource,
    imageOptions: ImageOptionCatalog | null,
): DecoratedRange[] {
    const contentStart = range.start + 2;
    const contentEnd = range.end - 2;
    const inner = source.slice(contentStart, contentEnd);
    const parts = splitHighlightRanges(inner, "|");
    const target = parts[0]?.value.trim() ?? "";
    const namespaceId = getLinkNamespaceId(target, namespaceSource);
    const className = getLinkClass(namespaceId);
    const href = `/wiki/${encodeTitle(target.replace(/^:/u, ""))}`;
    const ranges: DecoratedRange[] = [
        { ...range, className, href, priority: 20 },
        ...createLinkMarkupDecorations(contentStart, contentEnd, range, parts),
        ...createLinkTargetDecorations(
            source,
            contentStart,
            parts,
            target,
            className,
        ),
        ...createEmbeddedLinkDecorations(
            source,
            contentStart,
            parts,
            namespaceId,
            imageOptions,
        ),
    ];
    ranges.push(
        createLinkTextDecoration(contentStart, contentEnd, parts, namespaceId),
    );
    return ranges;
}

function createLinkTargetDecorations(
    source: string,
    contentStart: number,
    parts: TopLevelRange[],
    target: string,
    className: string,
): DecoratedRange[] {
    const targetRange = parts[0];
    const missingTitle = normalizeMissingTitle(target);
    if (targetRange == null || missingTitle == null) {
        return [];
    }
    const range = trimSourceRange(
        source,
        contentStart + targetRange.start,
        contentStart + targetRange.end,
    );
    return range.start === range.end
        ? []
        : [
              {
                  ...range,
                  className,
                  missingTitle,
                  pagePreview:
                      className === "wiked-lite-token--link"
                          ? { wiki: "local", title: missingTitle }
                          : undefined,
                  priority: 22,
              },
          ];
}

function createEmbeddedLinkDecorations(
    source: string,
    contentStart: number,
    parts: TopLevelRange[],
    namespaceId: number | undefined,
    imageOptions: ImageOptionCatalog | null,
): DecoratedRange[] {
    const targetRange = parts[0];
    if (namespaceId !== 6 || targetRange == null) {
        return [];
    }
    return [
        {
            className: "wiked-lite-token--file",
            end: contentStart + targetRange.end,
            priority: 25,
            start: contentStart + targetRange.start,
        },
        ...createFileOptionDecorations(
            source,
            contentStart,
            parts,
            imageOptions,
        ),
    ];
}

function createFileOptionDecorations(
    source: string,
    contentStart: number,
    parts: TopLevelRange[],
    imageOptions: ImageOptionCatalog | null,
): DecoratedRange[] {
    return parts
        .slice(1)
        .flatMap((part) =>
            decorateFileOption(source, contentStart, part, imageOptions),
        );
}

function decorateFileOption(
    source: string,
    contentStart: number,
    part: TopLevelRange,
    imageOptions: ImageOptionCatalog | null,
): DecoratedRange[] {
    const optionStart = contentStart + part.start;
    const optionRange = trimSourceRange(
        source,
        optionStart,
        contentStart + part.end,
    );
    const option = source.slice(optionRange.start, optionRange.end);
    if (
        matchesImageOptionAlias(option, imageOptions?.literals) ||
        isFileSizeOption(option)
    ) {
        return [createParameterRange(optionRange)];
    }
    const spacedKey = getFileSpacedOptionKey(option, imageOptions?.spaced);
    if (spacedKey != null) {
        return [
            createParameterRange({
                end: optionRange.start + spacedKey.length,
                start: optionRange.start,
            }),
        ];
    }
    const named = decorateNamedFileOption(
        option,
        optionRange,
        imageOptions?.named,
    );
    return named.length > 0
        ? named
        : decorateUnderscoredFileOption(
              option,
              optionRange,
              imageOptions?.underscored,
          );
}

function isFileSizeOption(option: string): boolean {
    const match = FILE_SIZE_OPTION_PATTERN.exec(option);
    return match != null && match.slice(1).every(isPositiveFileDimension);
}

function isPositiveFileDimension(dimension: string | undefined): boolean {
    return dimension == null || Number(dimension) > 0;
}

function decorateNamedFileOption(
    option: string,
    optionRange: SourceRange,
    aliases: MagicWordAliases | undefined,
): DecoratedRange[] {
    const equals = getFirstTopLevelSeparator(option, "=") ?? -1;
    if (equals < 0) {
        return [];
    }
    const name = option.slice(0, equals);
    if (!matchesImageOptionAlias(name, aliases)) {
        return [];
    }
    const nameRange = {
        end: optionRange.start + equals,
        start: optionRange.start,
    };
    return [
        createParameterRange(nameRange),
        createDelimiterRange(
            optionRange.start + equals,
            optionRange.start + equals + 1,
            49,
        ),
    ];
}

function getFileSpacedOptionKey(
    option: string,
    aliases: MagicWordAliases | undefined,
): string | undefined {
    for (
        let separator = option.indexOf(" ");
        separator >= 0;
        separator = option.indexOf(" ", separator + 1)
    ) {
        const key = option.slice(0, separator);
        if (
            option[separator + 1] != null &&
            option[separator + 1] !== " " &&
            matchesImageOptionAlias(key, aliases)
        ) {
            return key;
        }
    }
    return undefined;
}

function decorateUnderscoredFileOption(
    option: string,
    optionRange: SourceRange,
    aliases: MagicWordAliases | undefined,
): DecoratedRange[] {
    for (
        let separator = option.lastIndexOf("_");
        separator > 0;
        separator = option.lastIndexOf("_", separator - 1)
    ) {
        if (
            separator === option.length - 1 ||
            !matchesImageOptionAlias(option.slice(0, separator), aliases)
        ) {
            continue;
        }
        return [
            createParameterRange({
                end: optionRange.start + separator,
                start: optionRange.start,
            }),
            createDelimiterRange(
                optionRange.start + separator,
                optionRange.start + separator + 1,
                49,
            ),
        ];
    }
    return [];
}

function matchesImageOptionAlias(
    value: string,
    aliases: MagicWordAliases | undefined,
): boolean {
    return (
        aliases?.caseSensitive.has(value) === true ||
        aliases?.caseInsensitive.has(value.toLowerCase()) === true
    );
}

function createParameterRange(range: SourceRange): DecoratedRange {
    return {
        ...range,
        className: "wiked-lite-token--parameter",
        priority: 50,
    };
}

function createLinkMarkupDecorations(
    contentStart: number,
    contentEnd: number,
    range: SourceRange,
    parts: TopLevelRange[],
): DecoratedRange[] {
    const ranges = [
        createMarkupRange(range.start, contentStart),
        createMarkupRange(contentEnd, range.end),
    ];
    for (let index = 1; index < parts.length; index += 1) {
        const previous = parts[index - 1];
        const current = parts[index];
        if (previous != null && current != null) {
            ranges.push(
                createMarkupRange(
                    contentStart + previous.end,
                    contentStart + current.start,
                ),
            );
        }
    }
    return ranges;
}

function createLinkTextDecoration(
    contentStart: number,
    contentEnd: number,
    parts: TopLevelRange[],
    namespaceId: number | undefined,
): DecoratedRange {
    const targetRange = parts[0];
    const displayRange =
        namespaceId === 6 || namespaceId === 14
            ? targetRange
            : parts.length > 1
              ? parts[1]
              : targetRange;
    return {
        className: "wiked-lite-token--link-text",
        missingTitle:
            namespaceId !== 6 && namespaceId !== 14 && parts.length > 1
                ? normalizeMissingTitle(targetRange?.value.trim() ?? "")
                : undefined,
        end:
            displayRange == null ? contentEnd : contentStart + displayRange.end,
        priority: 21,
        start:
            displayRange == null
                ? contentStart
                : contentStart + displayRange.start,
    };
}

function normalizeMissingTitle(target: string): string | undefined {
    const title = target.replace(/^:/u, "").split("#", 1)[0]?.trim();
    return title === "" ? undefined : title;
}

function createPagePreviewTarget(
    wiki: string,
    entered: string,
): DecoratedRange["pagePreview"] {
    const title = normalizeMissingTitle(entered);
    return title == null ? undefined : { wiki, title };
}

function createMarkupRange(start: number, end: number): DecoratedRange {
    return {
        className: "wiked-lite-token--wiki-markup",
        end,
        priority: 40,
        start,
    };
}

function getLinkClass(namespaceId: number | undefined): string {
    if (namespaceId === 6) {
        return "wiked-lite-token--file-link";
    }
    return namespaceId === 14
        ? "wiked-lite-token--category"
        : "wiked-lite-token--link";
}

function getLinkNamespaceId(
    rawTarget: string,
    namespaceSource: NamespaceSource,
): number | undefined {
    if (rawTarget.startsWith(":")) {
        return undefined;
    }
    const title = rawTarget.split("#", 1)[0] ?? "";
    const colon = title.indexOf(":");
    if (colon < 0) {
        return undefined;
    }
    return getNamespaceId(namespaceSource, title.slice(0, colon));
}

function createLanguageConversionDecorations(
    source: string,
    enabled: boolean,
): DecoratedRange[] {
    if (!enabled) {
        return [];
    }
    return findLanguageConversionRanges(source).flatMap(
        function decorate(range) {
            return [
                {
                    className: "wiked-lite-token--language-conversion",
                    end: range.end,
                    priority: 35,
                    start: range.start,
                },
                ...decorateLanguageVariants(
                    source,
                    range.bodyStart,
                    range.bodyEnd,
                ),
            ];
        },
    );
}

function createNoteTAConversionDecorations(
    source: string,
    template: ParsedTemplateCall,
    name: string,
    enabled: boolean,
): DecoratedRange[] {
    if (!enabled || !isNoteTAName(name)) {
        return [];
    }
    return template.params.flatMap(function decorate(parameter) {
        if (!isNoteTAConversionParameter(parameter)) {
            return [];
        }
        const range = decorateParameterValue(
            source,
            parameter,
            "wiked-lite-token--language-conversion",
        );
        if (range == null) {
            return [];
        }
        const variants = decorateLanguageVariants(
            source,
            range.start,
            range.end,
        );
        return variants.length === 0 ? [] : [range, ...variants];
    });
}

function decorateLanguageVariants(
    source: string,
    start: number,
    end: number,
): DecoratedRange[] {
    return findConversionKeyRanges(source, start, end).map((range) => ({
        ...range,
        className: "wiked-lite-token--language-variant",
        priority: 55,
    }));
}

function getFirstTopLevelSeparator(
    source: string,
    separator: string,
): number | undefined {
    const parts = splitHighlightRanges(source, separator);
    return parts.length > 1 ? parts[0]?.end : undefined;
}

function splitHighlightRanges(
    source: string,
    separator: string,
): TopLevelRange[] {
    const query = createHighlightQuery(source);
    const masked = maskSourceRanges(source, [
        ...query.opaque.getAll(),
        ...createTagMarkupRanges(source),
    ]);
    return createHighlightQuery(masked)
        .splitRanges(separator)
        .map((range) => ({
            ...range,
            value: source.slice(range.start, range.end),
        }));
}

function createTagMarkupRanges(source: string): SourceRange[] {
    return createHighlightQuery(source)
        .tag.getAll()
        .flatMap(function getMarkup(tag) {
            const ranges: SourceRange[] = [
                { end: tag.contentStart, start: tag.start },
            ];
            if (!tag.selfClosing && tag.contentEnd < tag.end) {
                ranges.push({ end: tag.end, start: tag.contentEnd });
            }
            return ranges;
        });
}

function maskSourceRanges(source: string, ranges: SourceRange[]): string {
    let cursor = 0;
    let masked = "";
    for (const range of mergeSourceRanges(ranges)) {
        masked += source.slice(cursor, range.start);
        masked += " ".repeat(range.end - range.start);
        cursor = range.end;
    }
    return masked + source.slice(cursor);
}

function createUrlDecorations(source: string): DecoratedRange[] {
    const pattern = /https?:\/\/[^\s<>\]}|]+/giu;
    return [...source.matchAll(pattern)].map(function decorate(match) {
        const start = match.index;
        return {
            className: "wiked-lite-token--url",
            end: start + match[0].length,
            href: match[0],
            priority: 5,
            start,
        };
    });
}

function createEntityDecorations(source: string): DecoratedRange[] {
    return [...source.matchAll(HTML_ENTITY_PATTERN)].flatMap(
        function decorate(match) {
            const start = match.index;
            const end = start + match[0].length;
            return [
                {
                    className: "wiked-lite-token--parser-function",
                    end,
                    priority: 60,
                    start,
                },
                {
                    className: "wiked-lite-token--entity",
                    end,
                    entity: match[0],
                    priority: 61,
                    start,
                },
            ];
        },
    );
}

function createSpecialCharacterDecorations(source: string): DecoratedRange[] {
    return [...source.matchAll(SPECIAL_CHARACTER_PATTERN)].map(
        function decorate(match) {
            const start = match.index;
            return {
                className: SPECIAL_CHARACTER_CLASSES[match[0]],
                end: start + match[0].length,
                priority: 105,
                start,
            };
        },
    );
}

function createExternalLinkDecorations(source: string): DecoratedRange[] {
    return findBracketedExternalLinks(source).flatMap(function decorate(link) {
        const ranges: DecoratedRange[] = [
            {
                ...link.target,
                className: "wiked-lite-token--url",
                href: link.href,
                priority: 5,
            },
        ];
        if (link.label.start < link.label.end) {
            ranges.push({
                ...link.label,
                className: "wiked-lite-token--url",
                href: link.href,
                priority: 5,
            });
        }
        return ranges;
    });
}

function findBracketedExternalLinks(source: string): Array<{
    end: number;
    href: string;
    label: SourceRange;
    start: number;
    target: SourceRange;
}> {
    const pattern = /\[(?:https?:)?\/\/[^\s<>\]]+(?:[^\S\n]+[^\]\n]*)?\]/giu;
    return [...source.matchAll(pattern)].map(function parse(match) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const targetStart = start + 1;
        const targetEnd = findExternalLinkTargetEnd(source, targetStart, end);
        return {
            end,
            href: source.slice(targetStart, targetEnd),
            label: trimSourceRange(source, targetEnd, end - 1),
            start,
            target: { end: targetEnd, start: targetStart },
        };
    });
}

function findExternalLinkTargetEnd(
    source: string,
    start: number,
    end: number,
): number {
    let cursor = start;
    while (cursor < end - 1 && !/\s/u.test(source[cursor] ?? "")) {
        cursor += 1;
    }
    return cursor;
}

function createListDecorations(source: string): DecoratedRange[] {
    const markers = findListMarkers(source);
    const ranges: DecoratedRange[] = markers.map(function decorate(match) {
        const start = match.index ?? 0;
        return {
            className: "wiked-lite-token--list",
            end: start + match[0].length,
            priority: 10,
            start,
        };
    });
    const scanSource = createListScanSource(source, markers);
    for (const marker of markers) {
        if (!marker[0].includes(";")) {
            continue;
        }
        const markerEnd = (marker.index ?? 0) + marker[0].length;
        const lineEnd = scanSource.indexOf("\n", markerEnd);
        const end = lineEnd < 0 ? scanSource.length : lineEnd;
        const separator = findDefinitionSeparator(scanSource, markerEnd, end);
        if (separator != null) {
            ranges.push({
                className: "wiked-lite-token--list",
                end: separator + 1,
                priority: 10,
                start: separator,
            });
        }
    }
    return ranges;
}

function findListMarkers(source: string): RegExpMatchArray[] {
    return [...source.matchAll(/^[^\S\n]*[#*:;]+/gmu)];
}

function createListScanSource(
    source: string,
    markers: RegExpMatchArray[],
): string {
    const query = createHighlightQuery(source);
    const markerStarts = markers.map((marker) => marker.index ?? 0);
    const nestedTemplates = query.template
        .getAll()
        .filter(
            (template) =>
                !markerStarts.some(
                    (start) => template.start < start && start < template.end,
                ),
        );
    return maskSourceRanges(source, [
        ...query.comment.getAll(),
        ...query.opaque.getAll(),
        ...nestedTemplates,
        ...query.link.getAll(),
        ...query.tag.getAll(),
        ...findBracketedExternalLinks(source),
    ]);
}

function findDefinitionSeparator(
    source: string,
    start: number,
    end: number,
): number | undefined {
    let fallback: number | undefined;
    let separator = source.indexOf(":", start);
    while (separator >= 0 && separator < end) {
        if (isUrlSchemeColon(source, start, separator)) {
            separator = source.indexOf(":", separator + 1);
            continue;
        }
        if (isSpacedDefinitionSeparator(source, separator)) {
            return separator;
        }
        fallback ??= separator;
        separator = source.indexOf(":", separator + 1);
    }
    return fallback;
}

function isSpacedDefinitionSeparator(source: string, colon: number): boolean {
    return (
        /[^\S\n]/u.test(source[colon - 1] ?? "") ||
        /[^\S\n]/u.test(source[colon + 1] ?? "")
    );
}

function isUrlSchemeColon(
    source: string,
    lineStart: number,
    colon: number,
): boolean {
    if (source.slice(colon + 1, colon + 3) !== "//") {
        return false;
    }
    const before = source.slice(lineStart, colon);
    return /(?:^|\s)[a-z][a-z\d+.-]*$/iu.test(before);
}

function createEmphasisDecorations(source: string): DecoratedRange[] {
    const query = createHighlightQuery(source);
    const protectedRanges = mergeSourceRanges([
        ...query.comment.getAll(),
        ...query.opaque.getAll(),
        ...createTagMarkupRanges(source),
        ...createTemplateEmphasisExclusions(source, query.template.getAll()),
        ...createLinkEmphasisExclusions(source, query.link.getAll()),
    ]);
    const ranges: DecoratedRange[] = [];
    const state: EmphasisState = {};
    let protectedIndex = 0;
    for (const match of source.matchAll(/'{2,}|\n/gu)) {
        if (match[0] === "\n") {
            resetEmphasisState(state);
            continue;
        }
        const markerStart = match.index ?? 0;
        while (protectedRanges[protectedIndex]?.end <= markerStart) {
            protectedIndex += 1;
        }
        decorateEmphasisMarker(
            markerStart,
            match[0].length,
            state,
            protectedRanges[protectedIndex],
            ranges,
        );
    }
    return ranges;
}

function createTemplateEmphasisExclusions(
    source: string,
    templates: ParsedTemplateCall[],
): SourceRange[] {
    return templates.flatMap(function protectTemplateSyntax(template) {
        const ranges: SourceRange[] = [];
        const nameStart = source.indexOf(template.name, template.start + 2);
        if (nameStart >= 0 && nameStart < template.end) {
            ranges.push({
                end: nameStart + template.name.length,
                start: nameStart,
            });
        }
        for (const parameter of template.params) {
            if (!parameter.positional) {
                ranges.push({
                    end: parameter.valueStart,
                    start: parameter.start,
                });
            }
        }
        return ranges;
    });
}

function createLinkEmphasisExclusions(
    source: string,
    links: SourceRange[],
): SourceRange[] {
    return links.flatMap(function protectLinkTarget(link) {
        const contentStart = link.start + 2;
        const inner = source.slice(contentStart, link.end - 2);
        const target = splitHighlightRanges(inner, "|")[0];
        return target == null
            ? []
            : [
                  {
                      end: contentStart + target.end,
                      start: contentStart + target.start,
                  },
              ];
    });
}

function decorateEmphasisMarker(
    markerStart: number,
    length: number,
    state: EmphasisState,
    protectedRange: SourceRange | undefined,
    ranges: DecoratedRange[],
): void {
    if (
        (length !== 2 && length !== 3 && length !== 5) ||
        (protectedRange != null &&
            protectedRange.start <= markerStart &&
            markerStart < protectedRange.end)
    ) {
        return;
    }
    const markerEnd = markerStart + length;
    ranges.push(createMarkupRange(markerStart, markerEnd));
    toggleEmphasis(state, length, markerEnd, markerStart, ranges);
}

function resetEmphasisState(state: EmphasisState): void {
    delete state.bold;
    delete state.italic;
}

function toggleEmphasis(
    state: EmphasisState,
    markerLength: number,
    contentStart: number,
    contentEnd: number,
    ranges: DecoratedRange[],
): void {
    if (markerLength === 3 || markerLength === 5) {
        toggleEmphasisStyle(state, "bold", contentStart, contentEnd, ranges);
    }
    if (markerLength === 2 || markerLength === 5) {
        toggleEmphasisStyle(state, "italic", contentStart, contentEnd, ranges);
    }
}

function toggleEmphasisStyle(
    state: EmphasisState,
    style: keyof EmphasisState,
    contentStart: number,
    contentEnd: number,
    ranges: DecoratedRange[],
): void {
    const start = state[style];
    if (start == null) {
        state[style] = contentStart;
        return;
    }
    ranges.push({
        className: `wiked-lite-token--${style}`,
        end: contentEnd,
        priority: 15,
        start,
    });
    delete state[style];
}

function createHeadingDecorations(source: string): DecoratedRange[] {
    const pattern = /^(={1,6})([^\n]+?)\1[^\S\n]*$/gmu;
    return [...source.matchAll(pattern)].flatMap(function decorate(match) {
        const start = match.index;
        const level = match[1].length;
        const range = {
            end: start + match[0].length,
            start,
        };
        const ranges: DecoratedRange[] = [
            {
                ...range,
                className: "wiked-lite-token--heading",
                priority: 10,
            },
            {
                ...range,
                className: `wiked-lite-token--heading-${level}`,
                priority: 11,
            },
        ];
        return [
            ...ranges,
            ...createHeadingTextDecoration(source, match, level),
        ];
    });
}

function createHeadingTextDecoration(
    source: string,
    match: RegExpMatchArray,
    level: number,
): DecoratedRange[] {
    if (level !== 2 && level !== 3) {
        return [];
    }
    const contentStart = (match.index ?? 0) + (match[1]?.length ?? 0);
    const content = match[2] ?? "";
    const range = trimSourceRange(
        source,
        contentStart,
        contentStart + content.length,
    );
    return range.start === range.end
        ? []
        : [
              {
                  ...range,
                  className: "wiked-lite-token--heading-text",
                  priority: 12,
              },
          ];
}

function encodeTitle(title: string): string {
    return encodeURIComponent(title.replaceAll(" ", "_")).replaceAll(
        "%2F",
        "/",
    );
}

function createHighlightQuery(source: string) {
    return wikitext(source, { literalTags: HIGHLIGHT_LITERAL_TAGS });
}

function normalizeNames(names: string[]): Set<string> {
    return new Set(names.map((name) => wikitext.template.normalizeName(name)));
}
