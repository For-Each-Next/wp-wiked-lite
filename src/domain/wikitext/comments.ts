/** HTML-comment syntax queries for shared wikitext operations. */

export interface WikitextComment {
    closed: boolean;
    content: string;
    contentEnd: number;
    contentStart: number;
    end: number;
    raw: string;
    start: number;
}

/**
 * Finds HTML comments, including an unclosed final comment.
 *
 * @param source - Wikitext to scan.
 * @returns HTML comments in source order.
 */
export function findWikitextComments(source: string): WikitextComment[] {
    const comments: WikitextComment[] = [];
    let start = source.indexOf("<!--");
    while (start >= 0) {
        const closingStart = source.indexOf("-->", start + 4);
        const closed = closingStart >= 0;
        const contentStart = start + 4;
        const contentEnd = closed ? closingStart : source.length;
        const end = closed ? closingStart + 3 : source.length;
        comments.push({
            closed,
            content: source.slice(contentStart, contentEnd),
            contentEnd,
            contentStart,
            end,
            raw: source.slice(start, end),
            start,
        });
        if (!closed) {
            break;
        }
        start = source.indexOf("<!--", end);
    }
    return comments;
}
