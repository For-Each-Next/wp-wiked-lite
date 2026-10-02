/**
 * @file src/shared/i18n.ts
 * Purpose: Typed plain-text translation with explicit locale selection.
 *
 * Table of contents:
 * 1. MessageCatalog
 * 2. MessageValues
 * 3. LocaleCatalog
 * 4. createI18n
 * 5. resolveLocale
 * 6. normalizeLocale
 */

type MessageCatalog = Record<string, string>;
type MessageValues = Record<string, string | number>;

export type LocaleCatalog<Source extends MessageCatalog> = {
    [Id in keyof Source]: string;
};

/** Translates named placeholders without interpreting values as markup. */
export function createI18n<Source extends MessageCatalog>(
    english: Source,
    translations: Record<string, LocaleCatalog<Source>>,
    locale = "en",
) {
    const catalogs: Record<string, MessageCatalog> = {
        en: english,
        ...translations,
    };
    const interfaceLocale = resolveLocale(locale, Object.keys(catalogs));
    return {
        interfaceLocale,
        msg(
            id: Extract<keyof Source, string>,
            values: MessageValues = {},
        ): string {
            const message =
                catalogs[interfaceLocale]?.[id] || english[id] || id;
            return message.replace(
                /\{([A-Za-z][A-Za-z0-9]*)\}/gu,
                (placeholder, key: string) =>
                    values[key] == null ? placeholder : String(values[key]),
            );
        },
    };
}

function resolveLocale(locale: string, availableLocales: string[]): string {
    const available = new Map(
        availableLocales.map((value) => [value.toLowerCase(), value]),
    );
    const normalized = normalizeLocale(locale).toLowerCase();
    return (
        available.get(normalized) ||
        available.get(normalized.split("-")[0]) ||
        "en"
    );
}

function normalizeLocale(locale: string): string {
    const value = String(locale || "en").replace(/_/gu, "-");
    if (/^zh(?:-(?:cn|hans|my|sg))?$/iu.test(value)) {
        return "zh-Hans";
    }
    if (/^zh-(?:hk|hant|mo|tw)$/iu.test(value)) {
        return "zh-Hant";
    }
    return value;
}
