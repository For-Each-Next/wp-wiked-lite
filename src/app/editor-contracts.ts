/**
 * @file src/app/editor-contracts.ts
 * Purpose: Contracts between the wikEd Lite composition root and editor UI.
 *
 * Table of contents:
 * 1. Imports
 * 2. EditorServices
 */

import type { ActionNotifier } from "../shared/notifications.ts";
import type { Logger } from "../shared/logging.ts";

import type { HighlightOptions } from "../domain/highlighter.ts";
import type { PagePreviewTarget } from "../domain/highlight-partition.ts";
import type { FormatterSettings } from "../domain/formatter-settings.ts";
import type { PageSummaryResult } from "../domain/page-summary.ts";

export interface EditorServices {
    logger: Logger;
    notify: ActionNotifier;

    findMissingLinks(source: string): Promise<{
        checkedTitles: Set<string>;
        linkClasses: string[];
        missingTitles: Set<string>;
    }>;

    getHighlightOptions(): HighlightOptions;

    isSectionEditing(): boolean;

    loadFormatterSettings(): FormatterSettings;

    loadNamespaces(): Promise<void>;

    loadPageSource(): Promise<string>;

    loadPageSummary(target: PagePreviewTarget): Promise<PageSummaryResult>;

    resolveRedirects(
        source: string,
        options: { includeTemplates: boolean },
    ): Promise<string>;

    resetFormatterSettings(): void;

    saveFormatterSettings(settings: FormatterSettings): void;
}
