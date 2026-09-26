/** Source text and selection operations for the editable DOM. */

import type { EditorSnapshot } from "./history.ts";

export function eventElement(target: EventTarget | null): Element | null {
    if (target == null || !("nodeType" in target)) {
        return null;
    }
    const node = target as Node;
    return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

export function readEditableText(editor: HTMLElement): string {
    return readNodeText(editor);
}

function readNodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue ?? "";
    }
    if (node.nodeName === "BR") {
        return "\n";
    }
    let text = "";
    for (const child of node.childNodes) {
        text += readNodeText(child);
        if (isEditableLine(child) && !text.endsWith("\n")) {
            text += "\n";
        }
    }
    return text;
}

function isEditableLine(node: Node): boolean {
    return node.nodeName === "DIV" || node.nodeName === "P";
}

export function getSelectionOffsets(editor: HTMLElement): {
    end: number;
    start: number;
} {
    const selection = editor.ownerDocument.getSelection();
    if (selection == null || selection.rangeCount === 0) {
        return { end: 0, start: 0 };
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) {
        return { end: 0, start: 0 };
    }
    return {
        end: measureOffset(editor, range.endContainer, range.endOffset),
        start: measureOffset(editor, range.startContainer, range.startOffset),
    };
}

export function createEditorSnapshot(
    editor: HTMLElement,
    source: string,
): EditorSnapshot {
    return { ...getSelectionOffsets(editor), source };
}

function measureOffset(root: Node, node: Node, offset: number): number {
    const range = root.ownerDocument?.createRange();
    if (range == null) {
        return 0;
    }
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
}

export function setSelectionOffsets(
    editor: HTMLElement,
    start: number,
    end: number,
): void {
    const range = editor.ownerDocument.createRange();
    const startPoint = findTextPoint(editor, start);
    const endPoint = findTextPoint(editor, end);
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const selection = editor.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function findTextPoint(
    root: Node,
    requested: number,
): { node: Node; offset: number } {
    let remaining = Math.max(0, requested);
    const textNodes = collectTextNodes(root);
    for (const node of textNodes) {
        const length = node.nodeValue?.length ?? 0;
        if (remaining <= length) {
            return { node, offset: remaining };
        }
        remaining -= length;
    }
    const last = textNodes.at(-1) ?? root;
    return { node: last, offset: last.nodeValue?.length ?? 0 };
}

function collectTextNodes(root: Node): Node[] {
    const nodes: Node[] = [];
    for (const child of root.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            nodes.push(child);
        } else {
            nodes.push(...collectTextNodes(child));
        }
    }
    return nodes;
}

export function restoreAttribute(
    element: HTMLElement,
    name: string,
    value: string | null,
): void {
    if (value == null) {
        element.removeAttribute(name);
        return;
    }
    element.setAttribute(name, value);
}
