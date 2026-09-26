/** Localized wikEd Lite messages. */

import en from "./en.json" with { type: "json" };
import zhHans from "./zh-Hans.json" with { type: "json" };
import zhHant from "./zh-Hant.json" with { type: "json" };
import { createI18n, type LocaleCatalog } from "../shared/i18n.ts";
import { getInterfaceLanguage } from "../platform/mediawiki/language.ts";

const simplifiedChinese: LocaleCatalog<typeof en> = zhHans;
const traditionalChinese: LocaleCatalog<typeof en> = zhHant;
const i18n = createI18n(
    en,
    {
        "zh-Hans": simplifiedChinese,
        "zh-Hant": traditionalChinese,
    },
    getInterfaceLanguage(),
);

export const interfaceLocale = i18n.interfaceLocale;
export const msg = i18n.msg;
