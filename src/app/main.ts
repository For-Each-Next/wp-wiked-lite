/** Composition root: binds host adapters to editor use cases and UI. */

import { createEditorServices } from "./editor-services.ts";
import { createFormatterSettingsStore } from "../platform/browser/formatter-settings.ts";
import {
    getDatabaseName,
    getRevisionId,
    isSectionEditing,
} from "../platform/mediawiki/editor-context.ts";
import { createWikiNamespaceResolver } from "../platform/mediawiki/namespaces.ts";
import { createActionNotifier } from "../platform/mediawiki/notifications.ts";
import { loadPageRevisionSource } from "../platform/mediawiki/page-source.ts";
import { createPageSummaryLoader } from "../platform/mediawiki/page-summary.ts";
import { lookupWikiLinks } from "../platform/mediawiki/wiki-links.ts";
import { createLogger } from "../shared/logging.ts";
import { startEditorIntegration } from "./editor-integration.ts";

/** Starts editor discovery and the formatter portlet action. */
export function start(): void {
    const logger = createLogger("wiked-lite", {
        level: window.wikEdLiteConfig?.logLevel,
    });
    const mediaWikiLogger = logger.child("mediawiki");
    const databaseName = getDatabaseName();
    const namespaces = createWikiNamespaceResolver(
        databaseName,
        mediaWikiLogger.child("namespaces"),
    );
    const services = createEditorServices({
        databaseName,
        getRevisionId,
        isSectionEditing,
        logger: mediaWikiLogger,
        uiLogger: logger.child("ui"),
        notify: createActionNotifier("wiked-lite"),
        namespaces: {
            current: namespaces.current,
            load: () => namespaces.load(new mw.Api()),
        },
        settings: createFormatterSettingsStore(),
        lookupLinks: (titles) => lookupWikiLinks(new mw.Api(), titles),
        loadRevisionSource: (revisionId) =>
            loadPageRevisionSource(new mw.Api(), revisionId),
        loadPageSummary: (target) =>
            createPageSummaryLoader(
                window.location.origin,
                mw.util.wikiScript("api"),
            )(target),
    });
    startEditorIntegration(services);
}
