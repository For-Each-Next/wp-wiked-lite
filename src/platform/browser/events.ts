/** Dispatches a native edit notification for host tools. */

export function dispatchNativeInput(textarea: HTMLTextAreaElement): void {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
