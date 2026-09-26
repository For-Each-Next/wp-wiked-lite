/** Lifecycle policies for enhanced and native editor surfaces. */

import type { EditorSnapshot } from "./history.ts";

export interface CompositionSubmitPorts {
    dispatchInput(): void;

    isComposing(): boolean;

    readEditorSnapshot(): EditorSnapshot;

    recordSnapshot(snapshot: EditorSnapshot): void;

    writeNativeSource(source: string): void;
}

export interface NativeFocusPorts {
    focus(): void;

    isAvailable(): boolean;

    setSelection(start: number, end: number): void;
}

/**
 * Creates a submit handler that flushes an active composition.
 */
export function createCompositionSubmitHandler(
    ports: CompositionSubmitPorts,
): () => void {
    return function flushCompositionBeforeSubmit(): void {
        if (!ports.isComposing()) {
            return;
        }
        const snapshot = ports.readEditorSnapshot();
        ports.writeNativeSource(snapshot.source);
        ports.recordSnapshot(snapshot);
        ports.dispatchInput();
    };
}

/** Restores the last enhanced selection and focus to native source. */
export function restoreNativeSelectionAndFocus(
    ports: NativeFocusPorts,
    selection: { end: number; start: number } | null,
): void {
    if (selection == null || !ports.isAvailable()) {
        return;
    }
    ports.setSelection(selection.start, selection.end);
    ports.focus();
}
