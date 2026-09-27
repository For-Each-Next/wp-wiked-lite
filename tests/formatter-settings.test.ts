import assert from "node:assert/strict";
import test from "node:test";

import {
    createFormatterSettingsStore,
    FORMATTER_SETTINGS_STORAGE_KEY,
} from "../src/platform/browser/formatter-settings.ts";
import {
    createDefaultFormatterSettings,
    type FormatterSettings,
    getEditorFeatureSettings,
    withEditorFeatureSettings,
} from "../src/domain/formatter-settings.ts";

test("formatter settings round trip through local storage", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);
    const settings = createConfiguredSettings();

    assert.deepEqual(store.load(), createDefaultFormatterSettings());
    assert.equal(store.load().alternateReferenceColors, false);
    assert.equal(store.load().ctrlClickLinks, true);
    assert.equal(store.load().formatter.formatHtmlTags, false);
    assert.equal(store.load().linkPreviews, false);
    assert.equal(store.load().referenceEditing, true);
    assert.equal(store.load().referenceLightweightEditing, false);
    assert.equal(store.load().useCodeMirrorForOtherModels, false);
    store.save(settings);

    assert.deepEqual(store.load(), settings);
    assert.deepEqual(
        JSON.parse(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY) ?? ""),
        settings,
    );
});

test("clearing saved settings restores defaults and preserves unrelated data", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);
    storage.setItem("another-gadget.settings", "keep this value");
    store.save(createConfiguredSettings());

    store.clear();

    assert.equal(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY), null);
    assert.deepEqual(store.load(), createDefaultFormatterSettings());
    assert.equal(store.load().ctrlClickLinks, true);
    assert.equal(storage.getItem("another-gadget.settings"), "keep this value");
    assert.doesNotThrow(() => store.clear());
});

test("failed removal propagates its error and retains saved settings", () => {
    const failure = new Error("removal denied");
    const settings = createConfiguredSettings();
    const storage = new MemorySettingsStorage(JSON.stringify(settings));
    storage.removeItem = () => {
        throw failure;
    };
    const store = createFormatterSettingsStore(() => storage);

    assert.throws(
        () => store.clear(),
        (error) => error === failure,
    );
    assert.deepEqual(store.load(), settings);
});

test("indentation widths including zero and larger values round trip", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);

    for (const indentSpaces of [0, 2, 5, 12]) {
        const settings = createConfiguredSettings();
        settings.formatter.indentSpaces = indentSpaces;
        store.save(settings);

        assert.deepEqual(store.load(), settings);
    }
});

test("saving invalid indentation widths fails validation", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);

    for (const indentSpaces of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        const settings = createConfiguredSettings();
        settings.formatter.indentSpaces = indentSpaces;

        assert.throws(() => store.save(settings), /invalid/u);
    }
    assert.equal(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY), null);
});

test("missing link preview setting falls back to 0.1.0 defaults", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.linkPreviews;
    const storage = new MemorySettingsStorage(JSON.stringify(stored));
    const store = createFormatterSettingsStore(() => storage);

    assert.deepEqual(store.load(), createDefaultFormatterSettings());
});

test("saving an incomplete configuration fails validation", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);
    const settings = createConfiguredSettings();
    delete settings.formatter.skipFirstLevelIndentation;

    assert.throws(() => store.save(settings), /invalid/u);
    assert.equal(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY), null);
});

test("older settings retain their choices and enable syntax highlighting", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.syntaxHighlighting;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );
    assert.deepEqual(store.load(), { ...stored, syntaxHighlighting: true });
});

test("older settings retain their choices and enable modified link clicks", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.ctrlClickLinks;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );

    assert.deepEqual(store.load(), { ...stored, ctrlClickLinks: true });
});

test("older settings retain their choices and enable reference editing", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.referenceEditing;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );

    assert.deepEqual(store.load(), { ...stored, referenceEditing: true });
});

test("reference editing follows current editor choices without altering saved settings", () => {
    const saved = createConfiguredSettings();
    const features = getEditorFeatureSettings(saved);

    assert.equal(features.referenceEditing, false);
    features.referenceEditing = true;
    assert.equal(saved.referenceEditing, false);
    assert.deepEqual(withEditorFeatureSettings(saved, features), {
        ...saved,
        referenceEditing: true,
    });
});

test("older settings retain their choices with lightweight editing disabled", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.referenceLightweightEditing;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );

    assert.deepEqual(store.load(), {
        ...stored,
        referenceLightweightEditing: false,
    });
});

test("lightweight editing follows current editor choices without altering saved settings", () => {
    const saved = createConfiguredSettings();
    const features = getEditorFeatureSettings(saved);

    assert.equal(features.referenceLightweightEditing, true);
    features.referenceLightweightEditing = false;
    assert.equal(saved.referenceLightweightEditing, true);
    assert.deepEqual(withEditorFeatureSettings(saved, features), {
        ...saved,
        referenceLightweightEditing: false,
    });
});

test("saving invalid lightweight editing choices fails validation", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);
    for (const referenceLightweightEditing of [
        null,
        0,
        1,
        "true",
        "false",
        {},
        [],
    ]) {
        const settings: unknown = {
            ...createConfiguredSettings(),
            referenceLightweightEditing,
        };
        assert.throws(
            () => store.save(settings as FormatterSettings),
            /invalid/u,
        );
    }
    assert.equal(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY), null);
});

test("saving invalid reference editing choices fails validation", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);
    for (const referenceEditing of [null, 0, 1, "true", "false", {}, []]) {
        const settings: unknown = {
            ...createConfiguredSettings(),
            referenceEditing,
        };
        assert.throws(
            () => store.save(settings as FormatterSettings),
            /invalid/u,
        );
    }
    assert.equal(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY), null);
});

test("modified link click choices follow the current editor settings", () => {
    const saved = createConfiguredSettings();
    const features = getEditorFeatureSettings(saved);

    assert.equal(features.ctrlClickLinks, false);
    features.ctrlClickLinks = true;
    assert.equal(saved.ctrlClickLinks, false);
    assert.deepEqual(withEditorFeatureSettings(saved, features), {
        ...saved,
        ctrlClickLinks: true,
    });
});

test("saving invalid modified link click choices fails validation", () => {
    const storage = new MemorySettingsStorage();
    const store = createFormatterSettingsStore(() => storage);

    for (const ctrlClickLinks of [null, 0, 1, "true", "false", {}, []]) {
        const settings: unknown = {
            ...createConfiguredSettings(),
            ctrlClickLinks,
        };

        assert.throws(
            () => store.save(settings as FormatterSettings),
            /invalid/u,
        );
    }
    assert.equal(storage.getItem(FORMATTER_SETTINGS_STORAGE_KEY), null);
});

test("older settings retain their choices without alternating reference colors", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.alternateReferenceColors;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );

    assert.deepEqual(store.load(), {
        ...stored,
        alternateReferenceColors: false,
    });
});

test("older settings leave CodeMirror disabled for other content models", () => {
    const stored: Partial<FormatterSettings> = createConfiguredSettings();
    delete stored.useCodeMirrorForOtherModels;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );

    assert.deepEqual(store.load(), {
        ...stored,
        useCodeMirrorForOtherModels: false,
    });
});

test("older settings retain their choices without formatting HTML tags", () => {
    const stored: Omit<FormatterSettings, "formatter"> & {
        formatter: Partial<FormatterSettings["formatter"]>;
    } = createConfiguredSettings();
    delete stored.formatter.formatHtmlTags;
    const store = createFormatterSettingsStore(
        () => new MemorySettingsStorage(JSON.stringify(stored)),
    );

    assert.deepEqual(store.load(), {
        ...stored,
        formatter: { ...stored.formatter, formatHtmlTags: false },
    });
});

test("invalid stored settings fall back to defaults", () => {
    const invalidValues = [
        "{broken",
        ...createInvalidSettings().map((settings) => JSON.stringify(settings)),
    ];

    for (const serialized of invalidValues) {
        const storage = new MemorySettingsStorage(serialized);
        const store = createFormatterSettingsStore(() => storage);

        assert.deepEqual(store.load(), createDefaultFormatterSettings());
    }
});

function createInvalidSettings(): unknown[] {
    const valid = createConfiguredSettings();
    return [
        { ...valid, formatter: { ...valid.formatter, formatHtmlTags: "yes" } },
        { ...valid, formatter: { ...valid.formatter, formatHtmlTags: null } },
        {
            ...valid,
            formatter: { ...valid.formatter, indentSpaces: -1 },
        },
        {
            ...valid,
            formatter: { ...valid.formatter, indentSpaces: 1.5 },
        },
        {
            ...valid,
            formatter: {
                ...valid.formatter,
                indentSpaces: Number.MAX_SAFE_INTEGER + 1,
            },
        },
        {
            ...valid,
            formatter: {
                ...valid.formatter,
                subsequentParameterLayout: "unknown",
            },
        },
        {
            ...valid,
            formatter: {
                ...valid.formatter,
                skipFirstLevelIndentation: undefined,
            },
        },
        { ...valid, smallReferenceText: undefined },
        { ...valid, linkPreviews: "yes" },
        { ...valid, referenceEditing: "yes" },
        { ...valid, referenceEditing: null },
        { ...valid, referenceLightweightEditing: "yes" },
        { ...valid, referenceLightweightEditing: null },
        { ...valid, syntaxHighlighting: "no" },
        { ...valid, alternateReferenceColors: "yes" },
        { ...valid, alternateReferenceColors: null },
        { ...valid, useCodeMirrorForOtherModels: "yes" },
        ...[null, 0, 1, "true", "false", {}, []].map((ctrlClickLinks) => ({
            ...valid,
            ctrlClickLinks,
        })),
    ];
}

test("unavailable storage never blocks formatter defaults", () => {
    const unavailable = createFormatterSettingsStore(() => undefined);
    const inaccessible = createFormatterSettingsStore(() => {
        throw new Error("storage denied");
    });

    assert.deepEqual(unavailable.load(), createDefaultFormatterSettings());
    assert.deepEqual(inaccessible.load(), createDefaultFormatterSettings());
    assert.throws(
        () => unavailable.save(createDefaultFormatterSettings()),
        /unavailable/u,
    );
    assert.throws(
        () => inaccessible.save(createDefaultFormatterSettings()),
        /storage denied/u,
    );
    assert.throws(() => unavailable.clear(), /unavailable/u);
    assert.throws(() => inaccessible.clear(), /storage denied/u);
});

function createConfiguredSettings(): FormatterSettings {
    return {
        alternateReferenceColors: true,
        ctrlClickLinks: false,
        fullPageReferencePreviews: true,
        formatter: {
            characterWidthRatio: "2:1",
            firstParameterLayout: "compact",
            formatFirstParameter: true,
            formatHtmlTags: true,
            formatSubsequentParameters: true,
            indentBlockTemplates: true,
            indentSpaces: 4,
            normalizeConversion: true,
            skipFirstLevelIndentation: true,
            subsequentParameterLayout: "align-names-and-values",
        },
        highlightMissing: true,
        largeFont: true,
        linkPreviews: true,
        referenceEditing: false,
        referenceLightweightEditing: true,
        referencePreviews: false,
        resolveRedirects: true,
        resolveTemplateRedirects: true,
        smallReferenceText: false,
        syntaxHighlighting: false,
        useCodeMirrorForOtherModels: true,
    };
}

class MemorySettingsStorage {
    private readonly values = new Map<string, string>();

    constructor(value: string | null = null) {
        if (value != null) {
            this.values.set(FORMATTER_SETTINGS_STORAGE_KEY, value);
        }
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}
