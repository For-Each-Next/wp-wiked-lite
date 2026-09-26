/**
 * Shared Codex component types used in Vue templates.
 */

type CodexModule = typeof import("@wikimedia/codex");
type OpenTemplateSlot = (scope: unknown) => unknown;
type OpenTemplateSlots = {
    [name: string]: OpenTemplateSlot | undefined;
};
type ComponentWithOpenSlots<Component> = Component & {
    new (): {
        $slots: OpenTemplateSlots;
    };
};

declare module "@vue/runtime-core" {
    interface GlobalComponents {
        CdxButton: CodexModule["CdxButton"];
        CdxCheckbox: CodexModule["CdxCheckbox"];
        CdxDialog: ComponentWithOpenSlots<CodexModule["CdxDialog"]>;
        CdxField: ComponentWithOpenSlots<CodexModule["CdxField"]>;
        CdxMenuButton: CodexModule["CdxMenuButton"];
        CdxMessage: CodexModule["CdxMessage"];
        CdxProgressBar: CodexModule["CdxProgressBar"];
        CdxRadio: CodexModule["CdxRadio"];
        CdxTab: CodexModule["CdxTab"];
        CdxTabs: CodexModule["CdxTabs"];
        CdxTextInput: CodexModule["CdxTextInput"];
    }
}

export {};
