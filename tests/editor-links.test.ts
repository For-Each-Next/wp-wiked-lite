import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { attachModifiedLinkNavigation } from "../src/features/editor/links.ts";

test("modified navigation supports Ctrl and Cmd while preserving selection gestures", (t) => {
    const navigation = createNavigationHarness(t);

    navigation.click();
    assert.deepEqual(navigation.opened, []);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
        const event = navigation.click(modifier);
        assert.equal(event.defaultPrevented, true);
    }
    assert.deepEqual(navigation.opened, [
        ["/wiki/Target", "_blank", "noopener,noreferrer"],
        ["/wiki/Target", "_blank", "noopener,noreferrer"],
    ]);

    navigation.setSelection(true);
    navigation.click({ ctrlKey: true });
    navigation.setSelection(false);
    navigation.emit("mousedown", { ctrlKey: true });
    navigation.setSelection(true);
    navigation.emit("click", { ctrlKey: true });
    navigation.setSelection(false);
    navigation.emit("mousedown", { ctrlKey: true });
    navigation.emit("mousemove", { clientX: 10 });
    navigation.emit("click", { ctrlKey: true });
    navigation.emit("mousedown", { metaKey: true });
    navigation.emit("dragstart");
    navigation.emit("click", { metaKey: true });
    assert.equal(navigation.opened.length, 2);
});

test("navigation settings take effect immediately and cancel pending gestures", (t) => {
    const navigation = createNavigationHarness(t, false);

    const disabled = navigation.click({ ctrlKey: true });
    assert.equal(disabled.defaultPrevented, false);
    assert.deepEqual(navigation.opened, []);

    navigation.controller.setEnabled(true);
    navigation.click({ metaKey: true });
    assert.equal(navigation.opened.length, 1);

    navigation.emit("mousedown", { ctrlKey: true });
    navigation.controller.setEnabled(false);
    navigation.controller.setEnabled(true);
    navigation.emit("click", { ctrlKey: true });
    assert.equal(navigation.opened.length, 1);

    navigation.controller.setEnabled(false);
    navigation.click({ metaKey: true });
    assert.equal(navigation.opened.length, 1);
    navigation.controller.setEnabled(true);
    navigation.click({ ctrlKey: true });
    assert.equal(navigation.opened.length, 2);
});

test("destroying link navigation releases listeners and pending gestures", (t) => {
    const navigation = createNavigationHarness(t);

    navigation.emit("mousedown", { ctrlKey: true });
    navigation.controller.destroy();
    navigation.emit("click", { ctrlKey: true });
    navigation.controller.setEnabled(true);
    navigation.click({ metaKey: true });
    assert.deepEqual(navigation.opened, []);
    assert.equal(navigation.listenerCount(), 0);
});

function createNavigationHarness(t: TestContext, enabled = true) {
    const opened: unknown[][] = [];
    const originalWindow = Object.getOwnPropertyDescriptor(
        globalThis,
        "window",
    );
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            open(...args: unknown[]) {
                opened.push(args);
            },
        },
    });
    t.after(() => {
        if (originalWindow == null) {
            Reflect.deleteProperty(globalThis, "window");
        } else {
            Object.defineProperty(globalThis, "window", originalWindow);
        }
    });
    const link = {
        nodeType: 1,
        dataset: { href: "/wiki/Target" },
        closest: () => link,
    } as unknown as HTMLElement;
    let selected = false;
    const listeners = new Map<string, Set<(event: MouseEvent) => void>>();
    const editor = {
        ownerDocument: {
            getSelection: () => ({ isCollapsed: !selected }),
        },
        contains: (element: HTMLElement) => element === link,
        addEventListener(type: string, listener: (event: MouseEvent) => void) {
            const registered = listeners.get(type) ?? new Set();
            registered.add(listener);
            listeners.set(type, registered);
        },
        removeEventListener(
            type: string,
            listener: (event: MouseEvent) => void,
        ) {
            listeners.get(type)?.delete(listener);
        },
    } as unknown as HTMLElement;
    const controller = attachModifiedLinkNavigation(editor, enabled);
    t.after(() => controller.destroy());

    function emit(type: string, properties: MouseEventInit = {}): MouseEvent {
        const event = {
            altKey: false,
            button: 0,
            clientX: 0,
            clientY: 0,
            ctrlKey: false,
            defaultPrevented: false,
            detail: 1,
            metaKey: false,
            shiftKey: false,
            target: link,
            preventDefault() {
                event.defaultPrevented = true;
            },
            ...properties,
        };
        for (const listener of listeners.get(type) ?? []) {
            listener(event as unknown as MouseEvent);
        }
        return event as unknown as MouseEvent;
    }

    return {
        controller,
        emit,
        opened,
        click(properties: MouseEventInit = {}) {
            emit("mousedown", properties);
            return emit("click", properties);
        },
        listenerCount: () =>
            [...listeners.values()].reduce(
                (sum, entries) => sum + entries.size,
                0,
            ),
        setSelection(value: boolean) {
            selected = value;
        },
    };
}
