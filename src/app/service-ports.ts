/**
 * @file src/app/service-ports.ts
 * Purpose: Dependencies supplied by the host to editor use cases.
 *
 * Table of contents:
 * 1. Imports
 * 2. FormatterSettingsStore
 * 3. NamespaceProvider
 * 4. EditorServiceDependencies
 */

import type { EditorServices } from "./editor-contracts.ts";
import type { FormatterSettings } from "../domain/formatter-settings.ts";
import type { WikiLinkLookup } from "../domain/wiki-links.ts";
import type { WikiNamespaceState } from "../domain/wiki-site.ts";
import type { Logger } from "../shared/logging.ts";

export interface FormatterSettingsStore {
    clear(): void;
    load(): FormatterSettings;
    save(settings: FormatterSettings): void;
}

interface NamespaceProvider {
    current(): WikiNamespaceState;
    load(): Promise<WikiNamespaceState>;
}

export interface EditorServiceDependencies {
    databaseName: string;
    namespaces: NamespaceProvider;
    settings: FormatterSettingsStore;
    logger: Logger;
    uiLogger: Logger;
    notify: EditorServices["notify"];
    isSectionEditing: EditorServices["isSectionEditing"];
    getRevisionId(): number;
    loadRevisionSource(revisionId: number): Promise<string>;
    lookupLinks(titles: string[]): Promise<WikiLinkLookup>;
    loadPageSummary: EditorServices["loadPageSummary"];
}
