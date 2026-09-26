/** Side-effect-free public wikEd Lite operations. */

export { formatWikitext } from "./domain/formatter.ts";
export { highlightWikitext } from "./domain/highlighter.ts";
export {
    buildReferencePreview,
    type ReferencePreview,
    type ReferencePreviewField,
    type ReferencePreviewRow,
} from "./domain/reference-preview.ts";
export type {
    FirstParameterLayout,
    FormatterOptions,
    FormatterResult,
    SubsequentParameterLayout,
} from "./domain/formatter.ts";
