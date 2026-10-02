/**
 * @file src/domain/page-summary.ts
 * Purpose: Plain-text article preview values, independent of their data source.
 *
 * Table of contents:
 * 1. PageSummary
 * 2. PageSummaryResult
 */

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
