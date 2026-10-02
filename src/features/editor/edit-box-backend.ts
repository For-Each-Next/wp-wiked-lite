/**
 * @file src/features/editor/edit-box-backend.ts
 * Purpose: Registers textarea-local operations for independently installed edit tools.
 *
 * Table of contents:
 * 1. EditBoxBackend
 * 2. Constants and state
 * 3. registerEditBoxBackend
 */

export interface EditBoxBackend {
    focus(): void;
    read(): string;
    replaceSelection(text: string): void;
    write(text: string): void;
    writePreservingPosition(text: string): void;
}

const BACKEND_KEY = Symbol.for("mediawiki-gadgets.edit-box-backend");

export function registerEditBoxBackend(
    textarea: HTMLTextAreaElement,
    backend: EditBoxBackend,
): () => void {
    const target = textarea as unknown as Record<PropertyKey, unknown>;
    if (target[BACKEND_KEY] != null) {
        throw new Error("This textarea already has an active editor backend.");
    }
    target[BACKEND_KEY] = backend;
    return () => {
        if (target[BACKEND_KEY] !== backend) return;
        delete target[BACKEND_KEY];
    };
}
