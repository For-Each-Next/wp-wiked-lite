import { expect, test as base } from "@playwright/test";

/** Every browser request must be handled by an explicit local test fixture. */
export const test = base.extend({
    context: async ({ context }, use) => {
        const unexpectedRequests: string[] = [];
        await context.route("**/*", async (route) => {
            unexpectedRequests.push(route.request().url());
            await route.abort("blockedbyclient");
        });
        await use(context);
        expect(
            unexpectedRequests,
            "Unexpected network requests in offline tests",
        ).toEqual([]);
    },
});

export { expect };
