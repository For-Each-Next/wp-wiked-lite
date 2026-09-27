/** Reference highlighting, relative template nesting, and inline citation colors. */

import {
    type HighlightRange as DecoratedRange,
    mergeSourceRanges,
} from "./highlight-partition.ts";
import type {
    ParsedTemplateCall,
    SourceRange,
    WikitextTag,
} from "./wikitext/index.ts";

export interface ReferenceHighlighting {
    decorations: DecoratedRange[];
    getTemplateDepth: (template: ParsedTemplateCall) => number;
    clipTemplateDecorations: (
        template: ParsedTemplateCall,
        ranges: DecoratedRange[],
    ) => DecoratedRange[];
}

interface ReferenceNestingContext {
    referenceBodies: SourceRange[];
    resetRegions: SourceRange[];
}

interface ReferenceColorUnit extends SourceRange {
    kind: "paired-tag" | "self-closing-tag" | "template";
}

interface TemplateNestingRegion extends SourceRange {
    baseDepth: number;
}

const REFERENCE_TEMPLATE_NAMES = new Set(["r", "sfn"]);
const EFN_PATTERN = /^efn(?:$|[- /])/u;

/** Reuses parsed tags and normalized template names for every reference rule. */
export function createReferenceHighlighting(
    source: string,
    tags: WikitextTag[],
    templateNames: ReadonlyMap<ParsedTemplateCall, string>,
    alternateColors: boolean,
): ReferenceHighlighting {
    const referenceTags = tags.filter((tag) => tag.name === "ref");
    const context = createReferenceNestingContext(
        tags,
        referenceTags,
        templateNames,
    );
    const nestingRegions = [
        ...context.resetRegions.map((range) => ({ ...range, baseDepth: 0 })),
        ...context.referenceBodies.map((range) => ({ ...range, baseDepth: 1 })),
    ];
    const innermostFirst = nestingRegions.toSorted(
        (left, right) => left.end - left.start - (right.end - right.start),
    );
    const templates = [...templateNames.keys()];
    return {
        decorations: [
            ...createReferenceNestingDecorations(context),
            ...createReferenceDecorations(source, referenceTags, context),
            // Notes use template shading; this marker controls only text size.
            ...[...templateNames]
                .filter(([, name]) => EFN_PATTERN.test(name))
                .flatMap(([template]) =>
                    clipOuterTemplateDecorations(
                        [
                            {
                                start: template.start,
                                end: template.end,
                                className: "wiked-lite-token--footnote",
                                priority: 30,
                            },
                        ],
                        template,
                        nestingRegions,
                    ),
                ),
            ...(alternateColors
                ? createAlternateReferenceDecorations(
                      source,
                      referenceTags,
                      templateNames,
                      context,
                  )
                : []),
        ],
        getTemplateDepth: (template) =>
            getEffectiveTemplateDepth(template, templates, innermostFirst),
        clipTemplateDecorations: (template, ranges) =>
            clipOuterTemplateDecorations(ranges, template, nestingRegions),
    };
}

/** Gives citation templates their reference palette and preview metadata. */
export function createReferenceTemplateDecoration(
    template: ParsedTemplateCall,
    name: string,
    depth: number,
): DecoratedRange | null {
    if (!REFERENCE_TEMPLATE_NAMES.has(name)) {
        return null;
    }
    return {
        end: template.end,
        start: template.start,
        className: "wiked-lite-token--reference",
        priority: 30 + depth,
        referenceSource: template.raw,
        referenceStart: template.start,
    };
}

function createReferenceNestingContext(
    tags: WikitextTag[],
    referenceTags: WikitextTag[],
    templateNames: ReadonlyMap<ParsedTemplateCall, string>,
): ReferenceNestingContext {
    const nativeRegions = tags
        .filter((tag) => tag.name === "references" && !tag.selfClosing)
        .map((tag) => ({ end: tag.contentEnd, start: tag.contentStart }));
    const templateRegions = getReferenceTemplateRegions(templateNames);
    const resetRegions = [...nativeRegions, ...templateRegions].filter(
        (region) => region.start < region.end,
    );
    const definitionTags = referenceTags.filter((tag) =>
        resetRegions.some((region) => containsRange(region, tag)),
    );
    const referenceBodies = definitionTags
        .filter((tag) => !tag.selfClosing && tag.contentStart < tag.contentEnd)
        .map((tag) => ({ end: tag.contentEnd, start: tag.contentStart }));
    return { referenceBodies, resetRegions };
}

function getReferenceTemplateRegions(
    templateNames: ReadonlyMap<ParsedTemplateCall, string>,
): SourceRange[] {
    return [...templateNames]
        .filter(([, name]) => name === "reflist")
        .flatMap(([template]) =>
            template.params
                .filter(
                    (parameter) =>
                        !parameter.positional &&
                        /^(?:list|refs)$/iu.test(parameter.name),
                )
                .map((parameter) => ({
                    end: parameter.valueEnd,
                    start: parameter.valueStart,
                })),
        );
}

function createReferenceNestingDecorations(
    context: ReferenceNestingContext,
): DecoratedRange[] {
    const referenceBodies = context.referenceBodies.flatMap((range) =>
        subtractDecoratedRanges(
            {
                ...range,
                className: "wiked-lite-token--template-1",
                priority: 30,
            },
            mergeSourceRanges(
                context.resetRegions.filter(
                    (region) =>
                        region.start < range.end &&
                        range.start < region.end &&
                        !containsRange(region, range),
                ),
            ),
        ),
    );
    return [
        ...context.resetRegions.map((range) => ({
            ...range,
            className: "wiked-lite-token--template-0",
            priority: 29,
        })),
        ...referenceBodies,
    ];
}

function createReferenceDecorations(
    source: string,
    referenceTags: WikitextTag[],
    context: ReferenceNestingContext,
): DecoratedRange[] {
    return referenceTags
        .filter(
            (tag) =>
                !context.resetRegions.some((region) =>
                    containsRange(region, tag),
                ),
        )
        .map(function decorate(tag) {
            const end = tag.closed ? tag.end : tag.contentStart;
            return {
                className: "wiked-lite-token--reference",
                end,
                priority: 80,
                referenceSource: source.slice(tag.start, end),
                referenceStart: tag.start,
                start: tag.start,
            };
        });
}

function containsRange(outer: SourceRange, inner: SourceRange): boolean {
    return outer.start <= inner.start && inner.end <= outer.end;
}

function createAlternateReferenceDecorations(
    source: string,
    referenceTags: WikitextTag[],
    templateNames: ReadonlyMap<ParsedTemplateCall, string>,
    context: ReferenceNestingContext,
): DecoratedRange[] {
    const units: ReferenceColorUnit[] = [
        ...referenceTags
            .filter((tag) => tag.closed)
            .map((tag) => ({
                end: tag.end,
                kind: tag.selfClosing
                    ? ("self-closing-tag" as const)
                    : ("paired-tag" as const),
                start: tag.start,
            })),
        ...[...templateNames]
            .filter(([, name]) => REFERENCE_TEMPLATE_NAMES.has(name))
            .map(([template]) => ({
                end: template.end,
                kind: "template" as const,
                start: template.start,
            })),
    ]
        .filter(
            (unit) =>
                !context.resetRegions.some((region) =>
                    containsRange(region, unit),
                ),
        )
        .sort(
            (left, right) => left.start - right.start || right.end - left.end,
        );
    const ranges: DecoratedRange[] = [];
    let previous: ReferenceColorUnit | undefined;
    let palette: "pink" | "blue" = "pink";
    for (const unit of units) {
        if (previous != null && unit.start < previous.end) {
            // Nested reference markup shares the containing reference's color.
            continue;
        }
        const consecutive =
            previous != null &&
            /^\s*$/u.test(source.slice(previous.end, unit.start));
        const joinsPrevious =
            previous?.kind === "self-closing-tag" &&
            unit.kind === "template" &&
            previous.end === unit.start;
        if (!consecutive) {
            palette = "pink";
        } else if (!joinsPrevious) {
            palette = palette === "pink" ? "blue" : "pink";
        }
        ranges.push({
            className: `wiked-lite-token--reference-${palette}`,
            end: unit.end,
            priority: 79,
            start: unit.start,
        });
        previous = unit;
    }
    return ranges;
}

function getEffectiveTemplateDepth(
    template: ParsedTemplateCall,
    templates: ParsedTemplateCall[],
    nestingRegions: TemplateNestingRegion[],
): number {
    const nesting = nestingRegions.find((region) =>
        containsRange(region, template),
    );
    if (nesting == null) {
        return template.depth;
    }
    const ancestors = templates.filter(
        (candidate) =>
            candidate !== template &&
            containsRange(nesting, candidate) &&
            candidate.start < template.start &&
            template.end < candidate.end,
    );
    return nesting.baseDepth + ancestors.length;
}

function clipOuterTemplateDecorations(
    ranges: DecoratedRange[],
    template: ParsedTemplateCall,
    resetRegions: SourceRange[],
): DecoratedRange[] {
    const childRegions = mergeSourceRanges(
        resetRegions.filter(
            (region) =>
                region.start < template.end &&
                template.start < region.end &&
                !containsRange(region, template),
        ),
    );
    if (childRegions.length === 0) {
        return ranges;
    }
    return ranges.flatMap((range) =>
        subtractDecoratedRanges(range, childRegions),
    );
}

function subtractDecoratedRanges(
    range: DecoratedRange,
    exclusions: SourceRange[],
): DecoratedRange[] {
    let pieces = [range];
    for (const exclusion of exclusions) {
        pieces = pieces.flatMap(function subtract(piece) {
            if (piece.end <= exclusion.start || exclusion.end <= piece.start) {
                return [piece];
            }
            const before =
                piece.start < exclusion.start
                    ? [{ ...piece, end: exclusion.start }]
                    : [];
            const after =
                exclusion.end < piece.end
                    ? [{ ...piece, start: exclusion.end }]
                    : [];
            return [...before, ...after];
        });
    }
    return pieces;
}
