/**
 * @file src/features/editor/styles.ts
 * Purpose: Installs the build-injected wikEd Lite stylesheet once.
 *
 * Table of contents:
 * 1. Constants and state
 * 2. installWikEdLiteStyles
 * 3. installWikEdLiteFrameStyles
 * 4. getEditorStyles
 */

let installed = false;
let styleNonce = "";

/** Adds package styles through MediaWiki's nonce-aware helper. */
export function installWikEdLiteStyles(additionalStyles: string): void {
    if (installed) {
        return;
    }
    const sheet = mw.util.addCSS(`${getEditorStyles()}\n${additionalStyles}`);
    const owner = sheet.ownerNode;
    if (owner instanceof HTMLStyleElement) {
        styleNonce = owner.nonce;
    }
    installed = true;
}

/** Adds editor and token styles to the isolated editing document. */
export function installWikEdLiteFrameStyles(target: Document): void {
    const style = target.createElement("style");
    style.dataset.wikedLite = "editor";
    if (styleNonce !== "") {
        style.nonce = styleNonce;
    }
    style.textContent = getEditorStyles();
    target.head.append(style);
}

function getEditorStyles(): string {
    return typeof __WIKED_LITE_STYLES__ === "undefined"
        ? ""
        : __WIKED_LITE_STYLES__;
}
