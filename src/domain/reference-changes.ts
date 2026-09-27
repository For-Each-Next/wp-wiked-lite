/** Tracks reversible reference-field edits without retaining full source snapshots. */

import type {
    ReferenceEditRange,
    ReferenceReplacement,
} from "./reference-preview.ts";
import {
    type ParsedTemplateParameter,
    type SourceRange,
    wikitext,
} from "./wikitext/index.ts";

export interface ReferenceFieldChange {
    added: boolean;
    nameChanged: boolean;
    valueChanged: boolean;
    originalValue: string;
    originalName?: string;
}

export type ReferenceChangeTarget =
    | { kind: "edit"; range: ReferenceEditRange }
    | { kind: "insert"; name: string; citationRange: SourceRange }
    | { kind: "rename"; range: SourceRange; citationRange: SourceRange }
    | { kind: "update"; range: SourceRange; citationRange: SourceRange }
    | { kind: "reset"; range: SourceRange };

interface TrackedField extends Omit<
    ReferenceFieldChange,
    "nameChanged" | "valueChanged"
> {
    field: SourceRange;
    originalSource: string;
    span: SourceRange;
}

interface SourceDelta {
    inserted: string;
    removed: string;
    start: number;
}

interface ChangeState {
    fields: TrackedField[];
    fingerprint: string;
}

const MAX_TRANSITIONS = 500;
const MAX_DELTA_CHARACTERS = 2_000_000;

/** One tracker belongs to one enhanced editing surface. */
export class ReferenceChangeTracker {
    private source: string | null = null;
    private fields: TrackedField[] = [];
    private transitions: SourceDelta[] = [];
    private states: ChangeState[] = [];
    private cursor = 0;
    private deltaCharacters = 0;
    private parameterNames: Map<string, string> | null = null;

    synchronize(source: string): void {
        if (this.source === source) {
            return;
        }
        if (
            this.source == null ||
            (this.transitions.length === 0 && this.fields.length === 0)
        ) {
            this.source = source;
            this.parameterNames = null;
            this.states = [{ fields: [], fingerprint: fingerprint(source) }];
            return;
        }
        if (this.restoreKnownState(source)) {
            return;
        }
        const replacement = findSourceChange(this.source, source);
        const fields = this.fields.flatMap((field) => {
            const shifted = rebaseUntouched(field, replacement);
            return shifted == null ? [] : [shifted];
        });
        this.appendTransition(source, replacement, fields);
    }

    getChange(range: SourceRange): ReferenceFieldChange | null {
        const field = this.findField(range);
        return field == null
            ? null
            : {
                  added: field.added,
                  nameChanged:
                      field.added ||
                      (field.originalName != null &&
                          this.getParameterName(field.field) !==
                              field.originalName),
                  valueChanged:
                      this.source?.slice(field.field.start, field.field.end) !==
                      field.originalValue,
                  originalValue: field.originalValue,
                  ...(field.originalName == null
                      ? {}
                      : { originalName: field.originalName }),
              };
    }

    getReset(range: SourceRange): ReferenceReplacement | null {
        const field = this.findField(range);
        return field == null
            ? null
            : field.added && this.source != null
              ? buildAddedFieldReset(this.source, field)
              : { ...field.span, value: field.originalSource };
    }

    recordReplacement(
        before: string,
        replacement: ReferenceReplacement,
        target: ReferenceChangeTarget,
    ): void {
        this.synchronize(before);
        if (!isValidRange(before, replacement)) {
            throw new RangeError(
                "The reference replacement is outside the source.",
            );
        }
        const after = applyReplacement(before, replacement);
        if (before === after) {
            return;
        }
        const previous =
            target.kind === "insert" ? null : this.findField(target.range);
        const renamed =
            target.kind === "rename" || target.kind === "update"
                ? {
                      before: citationParameters(before, target.citationRange),
                      after: citationParameters(after, {
                          start: target.citationRange.start,
                          end:
                              target.citationRange.end +
                              replacement.value.length -
                              (replacement.end - replacement.start),
                      }),
                  }
                : null;
        const fields = this.fields.flatMap((field) => {
            if (field === previous) {
                return [];
            }
            const shifted =
                renamed == null
                    ? rebaseUntouched(field, replacement, true, before, after)
                    : rebaseRenamedSibling(
                          field,
                          before,
                          after,
                          replacement,
                          renamed.before,
                          renamed.after,
                      );
            return shifted == null ? [] : [shifted];
        });
        const updated =
            target.kind === "edit"
                ? trackEditedField(
                      before,
                      after,
                      replacement,
                      target.range,
                      previous,
                  )
                : target.kind === "insert"
                  ? trackInsertedField(before, after, replacement, target)
                  : (target.kind === "rename" || target.kind === "update") &&
                      renamed != null
                    ? trackRenamedField(
                          before,
                          after,
                          target.range,
                          previous,
                          renamed.before,
                          renamed.after,
                      )
                    : null;
        if (
            updated != null &&
            (updated.added ||
                after.slice(updated.span.start, updated.span.end) !==
                    updated.originalSource)
        ) {
            fields.push(updated);
        }
        this.appendTransition(after, replacement, fields);
    }

    private findField(range: SourceRange): TrackedField | null {
        return (
            this.fields.find((field) => sameRange(field.field, range)) ?? null
        );
    }

    private getParameterName(range: SourceRange): string | undefined {
        this.parameterNames ??= collectParameterNames(this.source ?? "");
        return this.parameterNames.get(`${range.start}:${range.end}`);
    }

    private restoreKnownState(source: string): boolean {
        const expected = fingerprint(source);
        for (let distance = 1; distance < this.states.length; distance += 1) {
            for (const index of [
                this.cursor - distance,
                this.cursor + distance,
            ]) {
                const state = this.states[index];
                if (
                    state?.fingerprint !== expected ||
                    this.reconstructSource(index) !== source
                ) {
                    continue;
                }
                this.source = source;
                this.parameterNames = null;
                this.fields = state.fields;
                this.cursor = index;
                return true;
            }
        }
        return false;
    }

    private reconstructSource(index: number): string | null {
        let source = this.source;
        if (source == null) {
            return null;
        }
        const backwards = index < this.cursor;
        const direction = backwards ? -1 : 1;
        for (let cursor = this.cursor; cursor !== index; cursor += direction) {
            const delta = this.transitions[backwards ? cursor - 1 : cursor];
            const removed = backwards ? delta.inserted : delta.removed;
            const inserted = backwards ? delta.removed : delta.inserted;
            if (
                source.slice(delta.start, delta.start + removed.length) !==
                removed
            ) {
                return null;
            }
            source = applyReplacement(source, {
                start: delta.start,
                end: delta.start + removed.length,
                value: inserted,
            });
        }
        return source;
    }

    private appendTransition(
        source: string,
        replacement: ReferenceReplacement,
        fields: TrackedField[],
    ): void {
        const before = this.source ?? "";
        const discarded = this.transitions.splice(this.cursor);
        for (const delta of discarded) {
            this.deltaCharacters -=
                delta.inserted.length + delta.removed.length;
        }
        this.states.splice(this.cursor + 1);
        const delta = {
            inserted: replacement.value,
            removed: before.slice(replacement.start, replacement.end),
            start: replacement.start,
        };
        this.transitions.push(delta);
        this.deltaCharacters += delta.inserted.length + delta.removed.length;
        this.states.push({ fields, fingerprint: fingerprint(source) });
        this.cursor += 1;
        this.source = source;
        this.parameterNames = null;
        this.fields = fields;
        while (
            this.transitions.length > MAX_TRANSITIONS ||
            (this.deltaCharacters > MAX_DELTA_CHARACTERS &&
                this.transitions.length > 1)
        ) {
            const removed = this.transitions.shift();
            if (removed != null) {
                this.deltaCharacters -=
                    removed.inserted.length + removed.removed.length;
            }
            this.states.shift();
            this.cursor -= 1;
        }
    }
}

function trackEditedField(
    before: string,
    after: string,
    replacement: ReferenceReplacement,
    range: ReferenceEditRange,
    previous: TrackedField | null,
): TrackedField | null {
    if (!isValidRange(before, range)) {
        return null;
    }
    const container = findValueContainer(before, range);
    const updatedContainer =
        range.quote === "" &&
        replacement.value.startsWith('"') &&
        replacement.value.endsWith('"')
            ? {
                  start: replacement.start + 1,
                  end: replacement.start + replacement.value.length - 1,
              }
            : rebaseContainingRange(container, replacement);
    if (previous?.added) {
        const field = trimmedRange(after, updatedContainer);
        return { ...previous, field, span: field };
    }
    const span = previous?.span ?? {
        start: replacement.start,
        end: replacement.end,
    };
    const start = Math.min(span.start, replacement.start);
    const end = Math.max(span.end, replacement.end);
    const originalSource =
        before.slice(start, span.start) +
        (previous?.originalSource ?? before.slice(span.start, span.end)) +
        before.slice(span.end, end);
    return {
        added: false,
        ...(previous?.originalName == null
            ? {}
            : { originalName: previous.originalName }),
        field: trimmedRange(after, updatedContainer),
        originalSource,
        originalValue:
            previous?.originalValue ?? before.slice(range.start, range.end),
        span: {
            start,
            end:
                end +
                replacement.value.length -
                (replacement.end - replacement.start),
        },
    };
}

function citationParameters(
    source: string,
    range: SourceRange,
): ParsedTemplateParameter[] {
    return wikitext(source.slice(range.start, range.end))
        .template.parse()
        .params.map((parameter) => ({
            ...parameter,
            start: parameter.start + range.start,
            end: parameter.end + range.start,
            valueStart: parameter.valueStart + range.start,
            valueEnd: parameter.valueEnd + range.start,
        }));
}

function trackRenamedField(
    before: string,
    after: string,
    range: SourceRange,
    previous: TrackedField | null,
    oldParameters: ParsedTemplateParameter[],
    newParameters: ParsedTemplateParameter[],
): TrackedField | null {
    const index = oldParameters.findIndex((parameter) =>
        sameRange(
            trimmedRange(before, {
                start: parameter.valueStart,
                end: parameter.valueEnd,
            }),
            range,
        ),
    );
    const original = oldParameters[index];
    const current = newParameters[index];
    if (original == null || current == null) {
        return null;
    }
    const field = trimmedRange(after, {
        start: current.valueStart,
        end: current.valueEnd,
    });
    if (previous?.added) {
        return { ...previous, field, span: field };
    }
    const valueEnd = original.valueStart + original.rawValue.trimEnd().length;
    const oldEnd = Math.max(valueEnd, previous?.span.end ?? valueEnd);
    const originalSource =
        previous == null
            ? before.slice(original.start, oldEnd)
            : before.slice(original.start, previous.span.start) +
              previous.originalSource +
              before.slice(previous.span.end, oldEnd);
    return {
        added: false,
        field,
        originalName: previous?.originalName ?? original.name,
        originalSource,
        originalValue:
            previous?.originalValue ?? before.slice(range.start, range.end),
        span: {
            start: current.start,
            end: oldEnd + current.valueEnd - original.valueEnd,
        },
    };
}

function collectParameterNames(source: string): Map<string, string> {
    const names = new Map<string, string>();
    for (const template of wikitext(source).template.getAll()) {
        for (const parameter of template.params) {
            const range = trimmedRange(source, {
                start: parameter.valueStart,
                end: parameter.valueEnd,
            });
            const key = `${range.start}:${range.end}`;
            if (!names.has(key)) {
                names.set(key, parameter.name);
            }
        }
    }
    return names;
}

function rebaseRenamedSibling(
    field: TrackedField,
    before: string,
    after: string,
    replacement: ReferenceReplacement,
    oldParameters: ParsedTemplateParameter[],
    newParameters: ParsedTemplateParameter[],
): TrackedField | null {
    const index = oldParameters.findIndex(
        (parameter) =>
            field.field.start >= parameter.valueStart &&
            field.field.end <= parameter.valueEnd,
    );
    const original = oldParameters[index];
    const current = newParameters[index];
    if (original == null || current == null) {
        return rebaseUntouched(field, replacement, true, before, after);
    }
    if (original.rawValue !== current.rawValue) {
        return null;
    }
    const delta = current.valueStart - original.valueStart;
    return {
        ...field,
        field: {
            start: field.field.start + delta,
            end: field.field.end + delta,
        },
        span: { start: field.span.start + delta, end: field.span.end + delta },
    };
}

function trackInsertedField(
    before: string,
    after: string,
    replacement: ReferenceReplacement,
    target: Extract<ReferenceChangeTarget, { kind: "insert" }>,
): TrackedField | null {
    const citationStart = target.citationRange.start;
    const citationEnd =
        target.citationRange.end +
        replacement.value.length -
        (replacement.end - replacement.start);
    const citation = wikitext(
        after.slice(citationStart, citationEnd),
    ).template.parse();
    const parameter = citation.params.find(
        (parameter) =>
            parameter.name === target.name.trim() &&
            citationStart + parameter.start - 1 >= replacement.start &&
            citationStart + parameter.start - 1 <
                replacement.start + replacement.value.length,
    );
    if (parameter == null) {
        return null;
    }
    const field = trimmedRange(after, {
        start: citationStart + parameter.valueStart,
        end: citationStart + parameter.valueEnd,
    });
    return {
        added: true,
        field,
        originalSource: before.slice(replacement.start, replacement.end),
        originalValue: "",
        span: field,
    };
}

function findValueContainer(
    source: string,
    range: ReferenceEditRange,
): SourceRange {
    if (range.quote != null) {
        if (range.quote === "") {
            return { start: range.start, end: range.end };
        }
        const start = source.lastIndexOf(range.quote, range.start - 1) + 1;
        const end = source.indexOf(range.quote, range.end);
        if (start > 0 && end >= range.end) {
            return { start, end };
        }
    }
    for (const template of wikitext(source).template.getAll()) {
        for (const parameter of template.params) {
            const container = {
                start: parameter.valueStart,
                end: parameter.valueEnd,
            };
            if (sameRange(trimmedRange(source, container), range)) {
                return container;
            }
        }
    }
    for (const reference of wikitext(source).reference.getAll()) {
        const container = {
            start: reference.contentStart,
            end: reference.contentEnd,
        };
        if (sameRange(trimmedRange(source, container), range)) {
            return container;
        }
    }
    return { start: range.start, end: range.end };
}

function rebaseUntouched(
    field: TrackedField,
    replacement: ReferenceReplacement,
    allowBoundaryInsert = false,
    before?: string,
    after?: string,
): TrackedField | null {
    if (touches(field.span, replacement, allowBoundaryInsert)) {
        return null;
    }
    const delta =
        replacement.value.length - (replacement.end - replacement.start);
    const shifted = {
        ...field,
        field: shiftRange(field.field, replacement, delta),
        span: shiftRange(field.span, replacement, delta),
    };
    if (
        allowBoundaryInsert &&
        field.field.start === field.field.end &&
        before != null &&
        after != null
    ) {
        const relocated = relocateBlankParameter(
            before,
            after,
            field.field,
            replacement,
        );
        if (relocated != null) {
            shifted.field = relocated;
            if (field.added) {
                shifted.span = relocated;
            }
        }
    }
    return shifted;
}

function relocateBlankParameter(
    before: string,
    after: string,
    range: SourceRange,
    replacement: ReferenceReplacement,
): SourceRange | null {
    const parameter = wikitext(before)
        .template.getAll()
        .flatMap((template) => template.params)
        .find(
            (parameter) =>
                parameter.value === "" &&
                sameRange(
                    trimmedRange(before, {
                        start: parameter.valueStart,
                        end: parameter.valueEnd,
                    }),
                    range,
                ),
        );
    if (parameter == null) {
        return null;
    }
    const delta =
        replacement.value.length - (replacement.end - replacement.start);
    const start =
        parameter.start >= replacement.end
            ? parameter.start + delta
            : parameter.start;
    const updated = wikitext(after)
        .template.getAll()
        .flatMap((template) => template.params)
        .find(
            (candidate) =>
                candidate.start === start &&
                candidate.name === parameter.name &&
                candidate.value === "",
        );
    return updated == null
        ? null
        : trimmedRange(after, {
              start: updated.valueStart,
              end: updated.valueEnd,
          });
}

function rebaseContainingRange(
    range: SourceRange,
    replacement: ReferenceReplacement,
): SourceRange {
    const delta =
        replacement.value.length - (replacement.end - replacement.start);
    return {
        start: Math.min(range.start, replacement.start),
        end: Math.max(range.end, replacement.end) + delta,
    };
}

function shiftRange(
    range: SourceRange,
    replacement: ReferenceReplacement,
    delta: number,
): SourceRange {
    if (
        range.start === range.end &&
        range.start === replacement.start &&
        replacement.start === replacement.end
    ) {
        return range;
    }
    return range.start >= replacement.end
        ? { start: range.start + delta, end: range.end + delta }
        : range;
}

function touches(
    range: SourceRange,
    replacement: ReferenceReplacement,
    allowBoundaryInsert: boolean,
): boolean {
    if (replacement.start === replacement.end) {
        if (allowBoundaryInsert) {
            return (
                replacement.start > range.start && replacement.start < range.end
            );
        }
        return (
            replacement.start >= range.start && replacement.start <= range.end
        );
    }
    return range.start === range.end
        ? replacement.start <= range.start && replacement.end >= range.end
        : replacement.start < range.end && replacement.end > range.start;
}

function buildAddedFieldReset(
    source: string,
    field: TrackedField,
): ReferenceReplacement | null {
    for (const template of wikitext(source).template.getAll()) {
        for (const parameter of template.params) {
            const container = {
                start: parameter.valueStart,
                end: parameter.valueEnd,
            };
            if (!sameRange(trimmedRange(source, container), field.field)) {
                continue;
            }
            const pipe = parameter.start - 1;
            const lineStart = source.lastIndexOf("\n", pipe) + 1;
            if (
                lineStart > 0 &&
                /^[\t ]*$/u.test(source.slice(lineStart, pipe))
            ) {
                const valueEnd =
                    parameter.valueStart + parameter.rawValue.trimEnd().length;
                const trailing = source.slice(valueEnd, parameter.end);
                const newline = trailing.indexOf("\n");
                if (newline >= 0) {
                    return {
                        start: lineStart,
                        end: valueEnd + newline + 1,
                        value: "",
                    };
                }
                const start =
                    source[lineStart - 2] === "\r"
                        ? lineStart - 2
                        : lineStart - 1;
                return { start, end: parameter.end, value: "" };
            }
            return { start: pipe, end: parameter.end, value: "" };
        }
    }
    return null;
}

function trimmedRange(source: string, range: SourceRange): SourceRange {
    const value = source.slice(range.start, range.end);
    const leading = value.length - value.trimStart().length;
    return {
        start: range.start + leading,
        end: range.start + Math.max(leading, value.trimEnd().length),
    };
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
    return left.start === right.start && left.end === right.end;
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

function applyReplacement(
    source: string,
    replacement: ReferenceReplacement,
): string {
    return (
        source.slice(0, replacement.start) +
        replacement.value +
        source.slice(replacement.end)
    );
}

function findSourceChange(before: string, after: string): ReferenceReplacement {
    let start = 0;
    while (
        start < before.length &&
        start < after.length &&
        before[start] === after[start]
    ) {
        start += 1;
    }
    let oldEnd = before.length;
    let newEnd = after.length;
    while (
        oldEnd > start &&
        newEnd > start &&
        before[oldEnd - 1] === after[newEnd - 1]
    ) {
        oldEnd -= 1;
        newEnd -= 1;
    }
    return { start, end: oldEnd, value: after.slice(start, newEnd) };
}

function fingerprint(source: string): string {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    }
    return `${source.length}:${hash >>> 0}`;
}
