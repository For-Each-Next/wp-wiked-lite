/** Native-reference queries built on generic tag syntax. */

import { findWikitextTags, type WikitextTag } from "./tags.ts";
import type { WikitextOptions } from "./opaque-ranges.ts";

export interface RefTag extends WikitextTag {
    closed: true;
    name: "ref";
}

/**
 * Finds complete native ref tags and their exact content ranges.
 *
 * @param source - Wikitext to scan.
 * @param options - Literal tags to protect.
 * @returns Complete native ref tags in source order.
 */
export function findRefTags(
    source: string,
    options: WikitextOptions = {},
): RefTag[] {
    return findWikitextTags(source, {
        literalTags: options.literalTags,
        tagNames: ["ref"],
    }).filter(isCompleteRefTag);
}

/**
 * Finds a full named-reference definition in the matching group.
 *
 * @param source - Wikitext to scan.
 * @param name - Reference name to match.
 * @param group - Reference group, or ungrouped when omitted.
 * @param options - Literal tags to protect.
 * @returns Matching full reference definition, when present.
 */
export function findNamedRefTag(
    source: string,
    name: string,
    group?: string,
    options: WikitextOptions = {},
): RefTag | undefined {
    if (name === "") {
        return undefined;
    }
    const expectedGroup = group ?? "";
    return findRefTags(source, options).find(function matches(tag) {
        return (
            !tag.selfClosing &&
            tag.attributes.name === name &&
            (tag.attributes.group ?? "") === expectedGroup
        );
    });
}

function isCompleteRefTag(tag: WikitextTag): tag is RefTag {
    return tag.name === "ref" && tag.closed;
}
