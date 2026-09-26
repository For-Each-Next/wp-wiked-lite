/** Bounded edit history for the rerendered wikEd Lite surface. */

const MAX_HISTORY_ENTRIES = 500;

export interface EditorSnapshot {
    end: number;
    source: string;
    start: number;
}

interface EditRecord {
    after: { end: number; start: number };
    before: { end: number; start: number };
    inserted: string;
    removed: string;
    start: number;
}

export type HistoryDirection = "redo" | "undo";

interface HistoryShortcut {
    altKey: boolean;
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
}

/**
 * Retains undoable source changes across highlighted DOM replacement.
 */
export class EditorHistory {
    private readonly redoEntries: EditRecord[] = [];
    private source: string;
    private selection: { end: number; start: number };
    private readonly undoEntries: EditRecord[] = [];

    constructor(initial: EditorSnapshot) {
        this.source = initial.source;
        this.selection = getSelection(initial);
    }

    /** Records one source state after an editable input. */
    record(next: EditorSnapshot): void {
        if (next.source === this.source) {
            this.selection = getSelection(next);
            return;
        }
        const change = createEditRecord(
            this.source,
            next.source,
            this.selection,
            getSelection(next),
        );
        this.undoEntries.push(change);
        if (this.undoEntries.length > MAX_HISTORY_ENTRIES) {
            this.undoEntries.shift();
        }
        this.redoEntries.length = 0;
        this.source = next.source;
        this.selection = change.after;
    }

    /** Updates the selection for the current source state. */
    setSelection(start: number, end: number): void {
        this.selection = { end, start };
    }

    /** Restores the previous source state, when one is available. */
    undo(): EditorSnapshot | null {
        const change = this.undoEntries.pop();
        if (change == null) {
            return null;
        }
        this.source = replaceRange(
            this.source,
            change.start,
            change.inserted.length,
            change.removed,
        );
        this.selection = change.before;
        this.redoEntries.push(change);
        return this.snapshot();
    }

    /** Restores the next source state, when one is available. */
    redo(): EditorSnapshot | null {
        const change = this.redoEntries.pop();
        if (change == null) {
            return null;
        }
        this.source = replaceRange(
            this.source,
            change.start,
            change.removed.length,
            change.inserted,
        );
        this.selection = change.after;
        this.undoEntries.push(change);
        return this.snapshot();
    }

    private snapshot(): EditorSnapshot {
        return { ...this.selection, source: this.source };
    }
}

/** Identifies only standard undo and redo shortcuts. */
export function getHistoryDirection(
    event: HistoryShortcut,
): HistoryDirection | null {
    if (event.altKey || event.ctrlKey === event.metaKey) {
        return null;
    }
    const key = event.key.toLocaleLowerCase();
    if (key === "z") {
        return event.shiftKey ? "redo" : "undo";
    }
    if (key === "y" && event.ctrlKey && !event.shiftKey) {
        return "redo";
    }
    return null;
}

function createEditRecord(
    previous: string,
    next: string,
    before: { end: number; start: number },
    after: { end: number; start: number },
): EditRecord {
    const start = sharedPrefixLength(previous, next);
    const suffix = sharedSuffixLength(previous, next, start);
    return {
        after,
        before,
        inserted: next.slice(start, next.length - suffix),
        removed: previous.slice(start, previous.length - suffix),
        start,
    };
}

function sharedPrefixLength(left: string, right: string): number {
    const limit = Math.min(left.length, right.length);
    let length = 0;
    while (length < limit && left[length] === right[length]) {
        length += 1;
    }
    return length;
}

function sharedSuffixLength(
    left: string,
    right: string,
    prefix: number,
): number {
    const limit = Math.min(left.length, right.length) - prefix;
    let length = 0;
    while (
        length < limit &&
        left[left.length - length - 1] === right[right.length - length - 1]
    ) {
        length += 1;
    }
    return length;
}

function replaceRange(
    source: string,
    start: number,
    removedLength: number,
    inserted: string,
): string {
    return (
        source.slice(0, start) + inserted + source.slice(start + removedLength)
    );
}

function getSelection(snapshot: EditorSnapshot): {
    end: number;
    start: number;
} {
    return { end: snapshot.end, start: snapshot.start };
}
