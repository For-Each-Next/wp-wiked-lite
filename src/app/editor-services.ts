/** Editor use cases. All host and network access arrives through ports. */

import type { EditorServices } from "./editor-contracts.ts";
import { collectLinkHelperTitles } from "../domain/highlighter.ts";
import {
    applyTemplateRedirects,
    applyWikiLinkRedirects,
    collectTemplateTitles,
    collectWikiLinkTitles,
} from "../domain/wiki-links.ts";
import type { WikiNamespaceState } from "../domain/wiki-site.ts";
import type { EditorServiceDependencies } from "./service-ports.ts";

/** Creates the operations available to the editor without touching the host. */
export function createEditorServices(
    dependencies: EditorServiceDependencies,
): EditorServices {
    const { databaseName, namespaces, settings } = dependencies;
    return {
        findMissingLinks: (source) => findMissingLinks(source, dependencies),
        getHighlightOptions() {
            const siteinfo = namespaces.current();
            return {
                databaseName,
                imageOptions: siteinfo.imageOptions,
                linkHelpers: databaseName === "zhwiki",
                namespaceSource: siteinfo.source,
                templateMagicWords: siteinfo.templateMagicWords,
            };
        },
        isSectionEditing: dependencies.isSectionEditing,
        loadFormatterSettings: () => settings.load(),
        async loadNamespaces() {
            await namespaces.load();
        },
        logger: dependencies.uiLogger,
        loadPageSource: () => loadCurrentPageSource(dependencies),
        loadPageSummary: dependencies.loadPageSummary,
        notify: dependencies.notify,
        resolveRedirects: (source, options) =>
            resolveRedirects(source, options, dependencies),
        resetFormatterSettings: () => settings.clear(),
        saveFormatterSettings: (value) => settings.save(value),
    };
}

async function loadCurrentPageSource({
    getRevisionId,
    loadRevisionSource,
    logger,
}: EditorServiceDependencies): Promise<string> {
    const revisionId = getRevisionId();
    const stopTimer = logger.startTimer("page-source.load", { revisionId });
    try {
        const source = await loadRevisionSource(revisionId);
        stopTimer({ characterCount: source.length });
        return source;
    } catch (error) {
        logger.warn("page-source.load.failed", { error, revisionId });
        stopTimer({ outcome: "failed" });
        throw error;
    }
}

async function findMissingLinks(
    source: string,
    {
        databaseName,
        namespaces,
        lookupLinks,
        logger,
    }: EditorServiceDependencies,
): ReturnType<EditorServices["findMissingLinks"]> {
    const titles = collectWikiLinkTitles(source);
    if (databaseName === "zhwiki") {
        titles.push(
            ...collectLinkHelperTitles(source, namespaces.current().source),
        );
    }
    const checkedTitles = new Set(titles);
    const stopTimer = logger.startTimer("links.lookup", {
        itemCount: checkedTitles.size,
    });
    try {
        const result = await lookupLinks([...checkedTitles]);
        stopTimer({ missingCount: result.missing.size });
        return {
            checkedTitles,
            linkClasses: result.missingLinkClasses,
            missingTitles: result.missing,
        };
    } catch (error) {
        logger.warn("links.lookup.failed", {
            error,
            itemCount: checkedTitles.size,
        });
        stopTimer({ outcome: "failed" });
        throw error;
    }
}

async function resolveRedirects(
    source: string,
    options: { includeTemplates: boolean },
    { namespaces, lookupLinks, logger }: EditorServiceDependencies,
): Promise<string> {
    const state = await namespaces.load();
    if (!state.redirectsSafe) {
        logger.info("redirects.skipped", { reason: "unsafe-namespaces" });
        return source;
    }
    if (options.includeTemplates && !state.templateRedirectsSafe) {
        logger.info("redirects.templates.skipped", {
            reason: "unsafe-magic-words",
        });
    }
    const includeTemplates =
        options.includeTemplates && state.templateRedirectsSafe;
    const titles = collectRedirectTitles(source, includeTemplates, state);
    const stopTimer = logger.startTimer("redirects.lookup", {
        itemCount: titles.length,
    });
    try {
        const result = await lookupLinks(titles);
        const linksUpdated = applyWikiLinkRedirects(
            source,
            result.redirects,
            state.source,
        );
        const updated = includeTemplates
            ? applyTemplateRedirects(
                  linksUpdated,
                  result.redirects,
                  state.source,
                  state.templateMagicWords,
              )
            : linksUpdated;
        stopTimer({ redirectCount: result.redirects.size });
        return updated;
    } catch (error) {
        logger.warn("redirects.lookup.failed", {
            error,
            itemCount: titles.length,
        });
        stopTimer({ outcome: "failed" });
        throw error;
    }
}

function collectRedirectTitles(
    source: string,
    includeTemplates: boolean,
    state: WikiNamespaceState,
): string[] {
    const titles = collectWikiLinkTitles(source);
    if (includeTemplates) {
        titles.push(
            ...collectTemplateTitles(
                source,
                state.source,
                state.templateMagicWords,
            ),
        );
    }
    return [...new Set(titles)];
}
