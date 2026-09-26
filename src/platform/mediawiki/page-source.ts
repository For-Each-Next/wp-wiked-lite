/** Read-only MediaWiki revision source access for section previews. */

export interface PageSourceApi {
    get(parameters: Record<string, unknown>): PromiseLike<unknown>;
}

/** Loads the exact main-slot source associated with one revision. */
export async function loadPageRevisionSource(
    api: PageSourceApi,
    revisionId: number,
): Promise<string> {
    if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
        throw new TypeError("A positive revision ID is required.");
    }
    const response = await api.get({
        action: "query",
        formatversion: 2,
        prop: "revisions",
        revids: revisionId,
        rvprop: "content",
        rvslots: "main",
    });
    const content = getRevisionContent(response);
    if (content == null) {
        throw new Error("MediaWiki omitted the requested revision source.");
    }
    return content;
}

function getRevisionContent(response: unknown): string | undefined {
    const query = asRecord(asRecord(response)?.query);
    const pages = query?.pages;
    const page = Array.isArray(pages) ? asRecord(pages[0]) : undefined;
    const revisions = page?.revisions;
    const revision = Array.isArray(revisions)
        ? asRecord(revisions[0])
        : undefined;
    const slots = asRecord(revision?.slots);
    const main = asRecord(slots?.main);
    const content = main?.content;
    return typeof content === "string" ? content : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value != null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}
