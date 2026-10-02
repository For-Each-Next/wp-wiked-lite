/**
 * @file src/platform/browser/events.ts
 * Purpose: Dispatches a native edit notification for host tools.
 *
 * Table of contents:
 * 1. dispatchNativeInput
 */

export function dispatchNativeInput(textarea: HTMLTextAreaElement): void {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
