/**
 * @file src/platform/mediawiki/codex.ts
 * Purpose: Minimal Vue and Codex contracts used by wikEd Lite.
 *
 * Table of contents:
 * 1. VueRef
 * 2. VueApp
 * 3. VueModule
 * 4. CodexComponents
 * 5. ResourceLoaderRequire
 * 6. registerFormatterComponents
 */

export interface VueRef<T> {
    value: T;
}

export interface VueApp {
    component(name: string, component: unknown): void;

    mount(host: HTMLElement): void;

    unmount(): void;
}

export interface VueModule {
    createMwApp(component: unknown): VueApp;

    defineComponent(component: unknown): unknown;

    ref<T>(value: T): VueRef<T>;

    onUnmounted?(cleanup: () => void): void;
}

export interface CodexComponents {
    CdxButton: unknown;
    CdxCheckbox: unknown;
    CdxDialog: unknown;
    CdxField: unknown;
    CdxMessage: unknown;
    CdxMenuButton: unknown;
    CdxProgressBar: unknown;
    CdxRadio: unknown;
    CdxTab: unknown;
    CdxTabs: unknown;
    CdxTextInput: unknown;
}

export interface ResourceLoaderRequire {
    (module: "vue"): VueModule;

    (module: "@wikimedia/codex"): CodexComponents;
}

/**
 * Registers the small Codex component set used by the formatter.
 *
 * @param app - App value.
 * @param Codex - Codex value.
 */
export function registerFormatterComponents(
    app: VueApp,
    Codex: CodexComponents,
): void {
    app.component("CdxButton", Codex.CdxButton);
    app.component("CdxCheckbox", Codex.CdxCheckbox);
    app.component("CdxDialog", Codex.CdxDialog);
    app.component("CdxField", Codex.CdxField);
    app.component("CdxMessage", Codex.CdxMessage);
    app.component("CdxMenuButton", Codex.CdxMenuButton);
    app.component("CdxProgressBar", Codex.CdxProgressBar);
    app.component("CdxRadio", Codex.CdxRadio);
    app.component("CdxTab", Codex.CdxTab);
    app.component("CdxTabs", Codex.CdxTabs);
    app.component("CdxTextInput", Codex.CdxTextInput);
}
