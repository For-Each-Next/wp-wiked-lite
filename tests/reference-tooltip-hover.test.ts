/**
 * @file tests/reference-tooltip-hover.test.ts
 * Purpose: tests / reference tooltip hover.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 * 3. createHoverHarness
 * 4. FakeClock
 * 5. FakeElement
 * 6. FakeEditor
 */

import assert from "node:assert/strict";
import test from "node:test";

import { attachReferenceTooltips } from "../src/features/editor/reference-tooltip.ts";

test("reference preview waits 700 ms for a settled hover by default", () => {
    const hover = createHoverHarness();

    hover.editor.emit("pointerover", hover.anchor, 10, 10);
    hover.clock.advance(699);
    assert.equal(hover.sourceReads(), 0);
    hover.clock.advance(1);
    assert.equal(hover.sourceReads(), 1);
    hover.controller.destroy();
});

test("material movement within one reference restarts the pending delay", () => {
    const hover = createHoverHarness();

    hover.editor.emit("pointerover", hover.anchor, 10, 10);
    hover.clock.advance(500);
    hover.editor.emit("pointermove", hover.anchor, 13, 10);
    hover.clock.advance(190);
    hover.editor.emit("pointermove", hover.anchor, 15, 10);
    hover.clock.advance(10);
    assert.equal(hover.sourceReads(), 0);
    hover.clock.advance(689);
    assert.equal(hover.sourceReads(), 0);
    hover.clock.advance(1);
    assert.equal(hover.sourceReads(), 1);
    hover.controller.destroy();
});

test("explicit hover delay overrides the default", () => {
    const hover = createHoverHarness(25);

    hover.editor.emit("pointerover", hover.anchor, 0, 0);
    hover.clock.advance(24);
    assert.equal(hover.sourceReads(), 0);
    hover.clock.advance(1);
    assert.equal(hover.sourceReads(), 1);
    hover.controller.destroy();
});

test("page-preview links take priority within a reference", () => {
    const hover = createHoverHarness();

    hover.editor.emit("pointerover", hover.link, 0, 0);
    hover.clock.advance(800);
    assert.equal(hover.sourceReads(), 0);

    hover.editor.emit("pointerover", hover.anchor, 0, 0);
    hover.clock.advance(300);
    hover.editor.emit("pointermove", hover.link, 1, 0);
    hover.clock.advance(800);
    assert.equal(hover.sourceReads(), 0);

    hover.editor.emit("pointerover", hover.anchor, 0, 0);
    hover.clock.advance(700);
    assert.equal(hover.sourceReads(), 1);
    hover.controller.destroy();
});

test("leaving or destroying a reference cancels pending previews", () => {
    const hover = createHoverHarness();

    hover.editor.emit("pointerover", hover.anchor, 0, 0);
    hover.clock.advance(300);
    hover.editor.emit("pointerout", hover.anchor, 0, 0);
    hover.clock.advance(700);
    assert.equal(hover.sourceReads(), 0);

    hover.editor.emit("pointerover", hover.anchor, 0, 0);
    hover.controller.destroy();
    hover.clock.advance(700);
    assert.equal(hover.sourceReads(), 0);
});

function createHoverHarness(delay?: number): {
    anchor: FakeElement;
    clock: FakeClock;
    controller: ReturnType<typeof attachReferenceTooltips>;
    editor: FakeEditor;
    link: FakeElement;
    sourceReads(): number;
} {
    const clock = new FakeClock();
    const anchor = new FakeElement("reference");
    const link = new FakeElement("page-link", anchor);
    const editor = new FakeEditor(clock, [anchor, link]);
    let reads = 0;
    const controller = attachReferenceTooltips({
        delay,
        editor: editor as unknown as HTMLElement,
        enabled: true,
        getHighlightOptions: () => ({}),
        getSource() {
            reads += 1;
            return "";
        },
        replace() {
            throw new Error("An empty reference must not be editable.");
        },
        overlay: {
            append() {
                throw new Error("An empty reference must not create a popup.");
            },
        } as unknown as HTMLElement,
    });
    return {
        anchor,
        clock,
        controller,
        editor,
        link,
        sourceReads: () => reads,
    };
}

class FakeClock {
    private currentTime = 0;
    private nextId = 1;
    private readonly timers = new Map<number, { at: number; run(): void }>();

    addEventListener(): void {}

    removeEventListener(): void {}

    setTimeout(run: () => void, delay: number): number {
        const id = this.nextId++;
        this.timers.set(id, { at: this.currentTime + delay, run });
        return id;
    }

    clearTimeout(id: number): void {
        this.timers.delete(id);
    }

    advance(milliseconds: number): void {
        const end = this.currentTime + milliseconds;
        while (true) {
            const due = [...this.timers]
                .filter(([, timer]) => timer.at <= end)
                .sort(
                    (left, right) =>
                        left[1].at - right[1].at || left[0] - right[0],
                )[0];
            if (due == null) {
                break;
            }
            this.currentTime = due[1].at;
            this.timers.delete(due[0]);
            due[1].run();
        }
        this.currentTime = end;
    }
}

class FakeElement {
    readonly nodeType = 1;
    readonly isConnected = true;
    readonly dataset: { reference?: string };
    private readonly kind: "reference" | "page-link";
    private readonly reference?: FakeElement;

    constructor(kind: "reference" | "page-link", reference?: FakeElement) {
        this.kind = kind;
        this.reference = reference;
        this.dataset = kind === "reference" ? { reference: "" } : {};
    }

    closest(selector: string): FakeElement | null {
        if (selector === "[data-reference]") {
            return this.kind === "reference" ? this : (this.reference ?? null);
        }
        if (selector === "[data-page-preview-title]") {
            return this.kind === "page-link" ? this : null;
        }
        return null;
    }
}

class FakeEditor {
    readonly ownerDocument: { defaultView: FakeClock };
    private readonly listeners = new Map<
        string,
        Set<(event: PointerEvent) => void>
    >();
    private readonly elements: FakeElement[];

    constructor(clock: FakeClock, elements: FakeElement[]) {
        this.ownerDocument = { defaultView: clock };
        this.elements = elements;
    }

    addEventListener(
        type: string,
        listener: (event: PointerEvent) => void,
    ): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(
        type: string,
        listener: (event: PointerEvent) => void,
    ): void {
        this.listeners.get(type)?.delete(listener);
    }

    contains(element: FakeElement): boolean {
        return this.elements.includes(element);
    }

    emit(
        type: string,
        target: FakeElement,
        clientX: number,
        clientY: number,
    ): void {
        const event = {
            clientX,
            clientY,
            pointerType: "mouse",
            relatedTarget: null,
            target,
        } as unknown as PointerEvent;
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}
