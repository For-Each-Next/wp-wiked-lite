/** Renders highlighted source using text nodes exclusively. */

import {
    type HighlightOptions,
    highlightWikitext,
} from "../../domain/highlighter.ts";
import { classifyLinkCheck, type LinkCheckState } from "./feature-settings.ts";

const DEFAULT_MAX_LIVE_HIGHLIGHT_LENGTH = 1_024_768;

export function renderSegments(
    editor: HTMLElement,
    source: string,
    linkCheckState: LinkCheckState,
    options: HighlightOptions,
    enabled: boolean,
): void {
    const target = editor.ownerDocument;
    const limit =
        window.wikEdLiteConfig?.maxLiveHighlightLength ??
        DEFAULT_MAX_LIVE_HIGHLIGHT_LENGTH;
    if (!enabled || source.length > limit) {
        editor.replaceChildren(target.createTextNode(source));
        return;
    }
    editor.replaceChildren(
        createHighlightedFragment(target, source, linkCheckState, options),
    );
}

/** Shared source rendering for the editor and reference field values. */
export function createHighlightedFragment(
    target: Document,
    source: string,
    linkCheckState: LinkCheckState,
    options: HighlightOptions,
): DocumentFragment {
    const fragment = target.createDocumentFragment();
    appendHighlightedSegments(
        target,
        fragment,
        highlightWikitext(source, options),
        linkCheckState,
    );
    return fragment;
}

function appendHighlightedSegments(
    target: Document,
    fragment: DocumentFragment,
    segments: ReturnType<typeof highlightWikitext>,
    linkCheckState: LinkCheckState,
): void {
    for (const segment of segments) {
        if (segment.classNames.length === 0) {
            fragment.append(target.createTextNode(segment.text));
            continue;
        }
        const span = target.createElement("span");
        span.className = segment.classNames.join(" ");
        span.textContent = segment.text;
        if (segment.entity != null) {
            const title = getEntityTitle(segment.entity);
            if (title != null) {
                span.title = title;
            }
        } else {
            const title = segment.classNames
                .map((className) => SPECIAL_CHARACTER_TITLES[className])
                .find((value) => value != null);
            if (title != null) {
                span.title = title;
            }
        }
        if (segment.href != null) {
            span.dataset.href = segment.href;
        }
        if (segment.pagePreview != null) {
            span.dataset.pagePreviewTitle = segment.pagePreview.title;
            span.dataset.pagePreviewWiki = segment.pagePreview.wiki;
        }
        if (segment.missingTitle != null) {
            markLinkCheck(span, segment.missingTitle, linkCheckState);
        }
        if (segment.referenceSource != null) {
            span.dataset.reference = segment.referenceSource;
            if (segment.referenceStart != null) {
                span.dataset.referenceStart = String(segment.referenceStart);
            }
        }
        fragment.append(span);
    }
}

const SPECIAL_CHARACTER_TITLES: Readonly<Record<string, string>> = {
    "wiked-lite-token--tab": "U+0009 (tab)",
    "wiked-lite-token--en-space": "U+2002 (en space)",
    "wiked-lite-token--em-space": "U+2003 (em space)",
    "wiked-lite-token--thin-space": "U+2009 (thin space)",
    "wiked-lite-token--ideographic-space": "U+3000 (ideographic space)",
    "wiked-lite-token--soft-hyphen": "U+00AD (soft hyphen)",
    "wiked-lite-token--figure-dash": "U+2012 ‒ (figure dash)",
    "wiked-lite-token--en-dash": "U+2013 – (en dash)",
    "wiked-lite-token--em-dash": "U+2014 — (em dash)",
    "wiked-lite-token--horizontal-bar": "U+2015 ― (horizontal bar)",
    "wiked-lite-token--minus-sign": "U+2212 − (minus sign)",
};

function getEntityTitle(reference: string): string | null {
    const rendered = decodeCharacterReference(reference);
    if (rendered == null) {
        return null;
    }
    const codePoints = Array.from(
        rendered,
        (character) =>
            `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
    );
    return `${codePoints.join(" ")} ${rendered}`;
}

const COMMON_CHARACTER_REFERENCES: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    bull: "•",
    copy: "©",
    deg: "°",
    divide: "÷",
    emsp: "\u2003",
    ensp: "\u2002",
    euro: "€",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: "\u00A0",
    ndash: "–",
    para: "¶",
    plusmn: "±",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    reg: "®",
    rsquo: "’",
    sect: "§",
    shy: "\u00AD",
    thinsp: "\u2009",
    times: "×",
    trade: "™",
};

function decodeCharacterReference(reference: string): string | null {
    const decimal = /^&#([0-9]+);$/u.exec(reference);
    const hexadecimal = /^&#[xX]([0-9A-Fa-f]+);$/u.exec(reference);
    if (decimal != null || hexadecimal != null) {
        const codePoint = Number.parseInt(
            (decimal ?? hexadecimal)?.[1] ?? "",
            decimal == null ? 16 : 10,
        );
        return codePoint > 0 &&
            codePoint <= 0x10ffff &&
            (codePoint < 0xd800 || codePoint > 0xdfff)
            ? String.fromCodePoint(codePoint)
            : null;
    }
    const named = /^&([A-Za-z][A-Za-z0-9]*);$/u.exec(reference);
    return named != null && Object.hasOwn(COMMON_CHARACTER_REFERENCES, named[1])
        ? COMMON_CHARACTER_REFERENCES[named[1]]
        : null;
}

function markLinkCheck(
    span: HTMLElement,
    title: string,
    state: LinkCheckState,
): void {
    const status = classifyLinkCheck(title, state);
    if (status === "missing") {
        span.classList.add("wiked-lite-token--missing");
    } else if (status === "unchecked") {
        span.classList.add("wiked-lite-token--unchecked");
    }
}
