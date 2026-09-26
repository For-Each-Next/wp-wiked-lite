/** Build globals and Vue template context for wikEd Lite. */

import type * as Dialog from "../features/formatter/dialog.ts";
import type { LogLevel } from "../shared/logging.ts";

type RawTemplateContext = ReturnType<
    typeof Dialog.createFormatterDialogBindings
>;
type TemplateContext = {
    [Key in keyof RawTemplateContext]: RawTemplateContext[Key] extends {
        value: infer Value;
    }
        ? Value
        : RawTemplateContext[Key];
};

declare global {
    const __WIKED_LITE_STYLES__: string;
    const __WIKED_LITE_FORMATTER_DIALOG_TEMPLATE__: string;
    const __WIKED_LITE_FORMATTER_DIALOG_STYLES__: string;

    interface Window {
        wikEd?: {
            useWikEd?: boolean;
        };
        wikEdLiteConfig?: {
            highlightDelay?: number;
            logLevel?: LogLevel;
            /**
             * Optional source-length safety cap for live highlighting.
             * Omission uses the default limit of 1,024,768.
             */
            maxLiveHighlightLength?: number;
            referenceTooltipDelay?: number;
            pagePreviewDelay?: number;
        };
    }
}

declare module "@vue/runtime-core" {
    interface ComponentCustomProperties extends TemplateContext {}
}

export {};
