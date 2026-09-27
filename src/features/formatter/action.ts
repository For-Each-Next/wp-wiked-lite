/** Formatter dialog contribution; independent of editor discovery and editing. */

import type { EditorServices } from "../../app/editor-contracts.ts";
import { formatWikitext } from "../../domain/formatter.ts";
import {
    getEditorFeatureSettings,
    withEditorFeatureSettings,
    type EditorFeatureSettings,
} from "../../domain/formatter-settings.ts";
import { msg } from "../../i18n/index.ts";
import {
    createFormatterDialogComponent,
    type FormatterDialogSelection,
} from "./dialog.ts";
import {
    registerFormatterComponents,
    type ResourceLoaderRequire,
    type VueApp,
} from "../../platform/mediawiki/codex.ts";
import { dispatchNativeInput } from "../../platform/browser/events.ts";

const TEXTAREA_ID = "wpTextbox1";
const HOST_ID = "wiked-lite-dialog-host";

interface FormatterEditor {
    clearCache(): void;
    getFeatureSettings(): EditorFeatureSettings;
    getSelection(): { start: number; end: number };
    replace(start: number, end: number, value: string): void;
    setFeatureSettings(settings: EditorFeatureSettings): void;
}

/** Creates one action with per-integration dialog and session state. */
export function createFormatterAction(
    services: EditorServices,
    getController: (
        textarea: HTMLTextAreaElement,
    ) => FormatterEditor | undefined,
    setFeatureSettings: (
        textarea: HTMLTextAreaElement,
        settings: EditorFeatureSettings,
    ) => void = (textarea, settings) =>
        getController(textarea)?.setFeatureSettings(settings),
    getFeatureSettings: (
        textarea: HTMLTextAreaElement,
    ) => EditorFeatureSettings | undefined = (textarea) =>
        getController(textarea)?.getFeatureSettings(),
): () => Promise<void> {
    const sessionFormatterSettings = new WeakMap<
        HTMLTextAreaElement,
        FormatterDialogSelection
    >();
    let activeDialogCleanup: (() => void) | null = null;
    let latestRequest = 0;

    async function openFormatter(): Promise<void> {
        const request = ++latestRequest;
        const textarea = document.getElementById(TEXTAREA_ID);
        if (!(textarea instanceof HTMLTextAreaElement)) {
            services.notify({
                key: "editor-missing",
                message: msg("feedback.noEditor"),
                type: "warning",
            });
            return;
        }
        try {
            const range = getController(textarea)?.getSelection() ?? {
                end: textarea.selectionEnd,
                start: textarea.selectionStart,
            };
            activeDialogCleanup?.();
            const require = (await mw.loader.using([
                "vue",
                "@wikimedia/codex",
            ])) as ResourceLoaderRequire;
            if (request === latestRequest && textarea.isConnected) {
                mountFormatterDialog(require, textarea, range);
            }
        } catch (error) {
            if (request !== latestRequest) {
                return;
            }
            services.logger.error("dialog.open.failed", { error });
            services.notify({
                key: "dialog-open-failed",
                message: msg("feedback.openFailed"),
                type: "error",
            });
        }
    }

    function mountFormatterDialog(
        require: ResourceLoaderRequire,
        textarea: HTMLTextAreaElement,
        range: { end: number; start: number },
    ): void {
        const Vue = require("vue");
        const Codex = require("@wikimedia/codex");
        const host = document.createElement("div");
        let application: VueApp | null = null;
        host.id = HOST_ID;
        document.documentElement.append(host);

        function cleanup(): void {
            const mountedApplication = application;
            application = null;
            try {
                mountedApplication?.unmount();
            } finally {
                host.remove();
                if (activeDialogCleanup === cleanup) {
                    activeDialogCleanup = null;
                }
            }
        }

        try {
            const isChineseWikipedia =
                (mw.config.get("wgWikiID") ?? mw.config.get("wgDBname")) ===
                "zhwiki";
            const component = createFormatterDialogComponent(Vue, {
                canNormalizeConversion: isChineseWikipedia,
                supportsLinkHelpers:
                    services.getHighlightOptions().linkHelpers === true,
                initialSelection: getDialogInitialSelection(textarea),
                linkHelperDocumentationUrl: isChineseWikipedia
                    ? mw.util.getUrl("Category:内部链接助手模板")
                    : `https://zh.wikipedia.org/wiki/Category:${encodeURIComponent("内部链接助手模板")}`,
                linkModifierKey: /Mac|iPhone|iPad|iPod/iu.test(
                    document.defaultView?.navigator.platform ?? "",
                )
                    ? "Command"
                    : "Ctrl",
                redirectPolicyUrl: mw.util.getUrl("WP:DONOTFIXIT"),
                scope:
                    range.start !== range.end
                        ? "selection"
                        : services.isSectionEditing()
                          ? "section"
                          : "page",
                onClearCache() {
                    getController(textarea)?.clearCache();
                    services.notify({
                        key: "cache-cleared",
                        message: msg("feedback.cacheCleared"),
                        type: "success",
                    });
                },
                onClose(selection) {
                    if (selection != null) {
                        sessionFormatterSettings.set(textarea, selection);
                        setFeatureSettings(
                            textarea,
                            getEditorFeatureSettings(selection),
                        );
                    }
                    cleanup();
                },
                onError(error, operation) {
                    services.logger.error(`${operation}.failed`, { error });
                },
                onReset() {
                    services.resetFormatterSettings();
                    sessionFormatterSettings.delete(textarea);
                    services.notify({
                        key: "settings-reset",
                        message: msg("feedback.settingsReset"),
                        type: "success",
                    });
                },
                onSave(selection) {
                    services.saveFormatterSettings(selection);
                    services.notify({
                        key: "settings-saved",
                        message: msg("feedback.settingsSaved"),
                        type: "success",
                    });
                },
                onSubmit: (selection) =>
                    applyFormatting(textarea, selection, range),
            });
            application = Vue.createMwApp(component);
            registerFormatterComponents(application, Codex);
            application.mount(host);
            activeDialogCleanup = cleanup;
        } catch (error) {
            cleanup();
            throw error;
        }
    }

    function getDialogInitialSelection(
        textarea: HTMLTextAreaElement,
    ): FormatterDialogSelection {
        const saved =
            sessionFormatterSettings.get(textarea) ??
            services.loadFormatterSettings();
        const features = getFeatureSettings(textarea);
        return features == null
            ? saved
            : withEditorFeatureSettings(saved, features);
    }

    async function applyFormatting(
        textarea: HTMLTextAreaElement,
        selection: FormatterDialogSelection,
        range: { end: number; start: number },
    ): Promise<void> {
        const selected = range.start !== range.end;
        const originalSource = textarea.value;
        const source = selected
            ? originalSource.slice(range.start, range.end)
            : originalSource;
        let formatted = formatWikitext(source, selection.formatter).text;
        if (selection.resolveRedirects) {
            formatted = await services.resolveRedirects(formatted, {
                includeTemplates: selection.resolveTemplateRedirects,
            });
        }
        if (!textarea.isConnected || textarea.value !== originalSource) {
            throw new Error(
                "The source changed while formatting. Run the formatter again.",
            );
        }
        if (formatted !== source) {
            writeFormattedSource(textarea, range, formatted, selected);
        }
        notifyFormattingResult(formatted !== source, selected);
    }

    function writeFormattedSource(
        textarea: HTMLTextAreaElement,
        range: { end: number; start: number },
        formatted: string,
        selected: boolean,
    ): void {
        const controller = getController(textarea);
        const start = selected ? range.start : 0;
        const end = selected ? range.end : textarea.value.length;
        if (controller != null) {
            controller.replace(start, end, formatted);
            return;
        }
        textarea.setRangeText(formatted, start, end, "select");
        dispatchNativeInput(textarea);
        textarea.focus({ preventScroll: true });
    }

    function notifyFormattingResult(changed: boolean, selected: boolean): void {
        const message = !changed
            ? msg("feedback.noChanges")
            : msg(selected ? "feedback.selection" : "feedback.whole");
        services.notify({
            key: "format-result",
            message,
            type: changed ? "success" : "info",
        });
    }

    return openFormatter;
}
