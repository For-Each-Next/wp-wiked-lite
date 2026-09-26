/** Plain-text article preview values, independent of their data source. */

export interface PageSummary {
    title: string;
    extract: string;
    description?: string;
    pageUrl: string;
}

export type PageSummaryResult =
    | { kind: "summary"; summary: PageSummary }
    | { kind: "missing" }
    | { kind: "unavailable" };
