<!--
@file src/features/formatter/dialog.vue
Purpose: src / features / formatter / dialog module.

Table of contents:
1. Template
-->

<template>
    <cdx-dialog
        v-model:open="open"
        :close-button-label="msg('dialog.cancel')"
        :lang="interfaceLocale"
        :title="msg('dialog.title')"
        :fixed-height="704"
        class="wiked-lite-dialog"
        use-close-button
        @update:open="onOpenChange"
    >
        <!-- Native notifications can be inert while the modal is open. -->
        <div
            class="wiked-lite-dialog__sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            <span v-if="announcement" :key="announcement.id">{{
                announcement.message
            }}</span>
        </div>
        <fieldset
            ref="controls"
            class="wiked-lite-dialog__controls"
            :disabled="applying || savingSettings"
            :aria-busy="applying || savingSettings"
        >
            <legend class="wiked-lite-dialog__sr-only">
                {{ msg("dialog.title") }}
            </legend>
            <cdx-tabs
                v-model:active="activeTab"
                :framed="true"
                @update:active="onTabChange"
            >
                <cdx-tab
                    name="formatting"
                    :label="msg('dialog.formattingTab')"
                    :disabled="applying || savingSettings"
                >
                    <cdx-field
                        :is-fieldset="true"
                        class="wiked-lite-dialog__section"
                    >
                        <template #label>{{
                            msg("dialog.formattingOptions")
                        }}</template>
                        <cdx-checkbox v-model="formatHtmlTags">
                            {{ msg("dialog.formatHtmlTags") }}
                            <template #description>{{
                                msg("dialog.formatHtmlTagsDescription")
                            }}</template>
                        </cdx-checkbox>
                        <cdx-checkbox
                            v-if="canNormalizeConversion"
                            v-model="normalizeConversion"
                        >
                            {{ msg("dialog.normalizeConversion") }}
                            <template #description>{{
                                msg("dialog.normalizeConversionDescription")
                            }}</template>
                        </cdx-checkbox>
                    </cdx-field>
                    <cdx-field
                        :is-fieldset="true"
                        class="wiked-lite-dialog__section"
                    >
                        <template #label>{{
                            msg("dialog.redirectScope")
                        }}</template>
                        <template #description
                            >{{ msg("dialog.redirectDescription")
                            }}<a
                                :href="redirectPolicyUrl"
                                target="_blank"
                                rel="noopener noreferrer"
                                >{{ msg("dialog.redirectPolicy") }}</a
                            >{{
                                msg("dialog.redirectDescriptionEnd")
                            }}</template
                        >
                        <cdx-checkbox v-model="resolveRedirects">
                            {{ msg("dialog.resolveRedirects") }}
                        </cdx-checkbox>
                        <div
                            v-if="resolveRedirects"
                            class="wiked-lite-dialog__dependent"
                        >
                            <cdx-checkbox v-model="resolveTemplateRedirects">
                                {{ msg("dialog.resolveTemplateRedirects") }}
                            </cdx-checkbox>
                        </div>
                    </cdx-field>
                    <section
                        class="wiked-lite-dialog__section"
                        aria-labelledby="wiked-lite-template-layout"
                    >
                        <h3
                            id="wiked-lite-template-layout"
                            class="wiked-lite-dialog__heading"
                        >
                            {{ msg("dialog.templateLayout") }}
                        </h3>
                        <p class="wiked-lite-dialog__intro">
                            {{ msg("dialog.templatesDescription") }}
                        </p>
                        <div class="wiked-lite-dialog__section">
                            <cdx-checkbox v-model="indentBlockTemplates">
                                {{ msg("dialog.indentBlockTemplates") }}
                            </cdx-checkbox>
                            <div class="wiked-lite-dialog__dependent">
                                <cdx-field
                                    class="wiked-lite-dialog__indentation-width"
                                    :disabled="!indentBlockTemplates"
                                >
                                    <template #label>{{
                                        msg("dialog.indentSpaces")
                                    }}</template>
                                    <cdx-text-input
                                        v-model="indentSpaces"
                                        input-type="number"
                                        min="0"
                                        step="1"
                                        :disabled="
                                            !indentBlockTemplates ||
                                            applying ||
                                            savingSettings
                                        "
                                        @blur="onIndentSpacesBlur"
                                    />
                                </cdx-field>
                                <cdx-checkbox
                                    v-model="skipFirstLevelIndentation"
                                    :disabled="!indentBlockTemplates"
                                >
                                    {{
                                        msg("dialog.skipFirstLevelIndentation")
                                    }}
                                </cdx-checkbox>
                            </div>
                        </div>
                        <div
                            class="wiked-lite-dialog__columns wiked-lite-dialog__section"
                        >
                            <cdx-field :is-fieldset="true">
                                <template #label>{{
                                    msg("dialog.firstParameterGroup")
                                }}</template>
                                <cdx-radio
                                    :model-value="firstParameterMode"
                                    input-value="preserve"
                                    name="first-parameter-layout"
                                    @update:model-value="
                                        updateFirstParameterMode
                                    "
                                >
                                    {{ msg("dialog.preserve") }}
                                </cdx-radio>
                                <cdx-radio
                                    :model-value="firstParameterMode"
                                    input-value="align-values"
                                    name="first-parameter-layout"
                                    @update:model-value="
                                        updateFirstParameterMode
                                    "
                                >
                                    {{ msg("dialog.alignValues") }}
                                </cdx-radio>
                                <cdx-radio
                                    :model-value="firstParameterMode"
                                    input-value="compact"
                                    name="first-parameter-layout"
                                    @update:model-value="
                                        updateFirstParameterMode
                                    "
                                >
                                    {{ msg("dialog.compact") }}
                                </cdx-radio>
                            </cdx-field>
                            <cdx-field :is-fieldset="true">
                                <template #label>{{
                                    msg("dialog.subsequentParameterGroup")
                                }}</template>
                                <cdx-radio
                                    :model-value="subsequentParameterMode"
                                    input-value="preserve"
                                    name="subsequent-parameter-layout"
                                    @update:model-value="
                                        updateSubsequentParameterMode
                                    "
                                >
                                    {{ msg("dialog.preserve") }}
                                </cdx-radio>
                                <cdx-radio
                                    :model-value="subsequentParameterMode"
                                    input-value="align-names"
                                    name="subsequent-parameter-layout"
                                    @update:model-value="
                                        updateSubsequentParameterMode
                                    "
                                >
                                    {{ msg("dialog.alignNames") }}
                                </cdx-radio>
                                <cdx-radio
                                    :model-value="subsequentParameterMode"
                                    input-value="align-names-and-values"
                                    name="subsequent-parameter-layout"
                                    @update:model-value="
                                        updateSubsequentParameterMode
                                    "
                                >
                                    {{ msg("dialog.alignNamesAndValues") }}
                                </cdx-radio>
                                <cdx-radio
                                    :model-value="subsequentParameterMode"
                                    input-value="compact"
                                    name="subsequent-parameter-layout"
                                    @update:model-value="
                                        updateSubsequentParameterMode
                                    "
                                >
                                    {{ msg("dialog.compact") }}
                                </cdx-radio>
                            </cdx-field>
                        </div>
                        <cdx-field
                            v-if="hasAlignment()"
                            :is-fieldset="true"
                            class="wiked-lite-dialog__section"
                        >
                            <template #label>{{
                                msg("dialog.characterWidth")
                            }}</template>
                            <template #description>{{
                                msg("dialog.characterWidthDescription")
                            }}</template>
                            <cdx-radio
                                v-model="characterWidthRatio"
                                input-value="5:3"
                                name="character-width-ratio"
                                inline
                            >
                                {{ msg("dialog.characterWidthThreeToFive") }}
                            </cdx-radio>
                            <cdx-radio
                                v-model="characterWidthRatio"
                                input-value="2:1"
                                name="character-width-ratio"
                                inline
                            >
                                {{ msg("dialog.characterWidthOneToTwo") }}
                            </cdx-radio>
                        </cdx-field>
                        <figure
                            class="wiked-lite-dialog__example wiked-lite-dialog__section"
                        >
                            <figcaption>
                                <strong>{{ msg("dialog.example") }}</strong>
                            </figcaption>
                            <pre
                                dir="ltr"
                                tabindex="0"
                                :aria-label="msg('dialog.example')"
                            ><code>{{ templatePreview() }}</code></pre>
                        </figure>
                    </section>
                </cdx-tab>
                <cdx-tab
                    name="editor"
                    :label="msg('dialog.editorTab')"
                    :disabled="applying || savingSettings"
                >
                    <p class="wiked-lite-dialog__intro">
                        {{ msg("dialog.editorDescription") }}
                    </p>
                    <cdx-field
                        :is-fieldset="true"
                        class="wiked-lite-dialog__section"
                    >
                        <template #label>{{
                            msg("dialog.highlighting")
                        }}</template>
                        <cdx-checkbox v-model="syntaxHighlighting">
                            {{ msg("dialog.syntaxHighlighting") }}
                            <template #description>{{
                                msg("dialog.syntaxHighlightingDescription")
                            }}</template>
                        </cdx-checkbox>
                        <cdx-checkbox v-model="useCodeMirrorForOtherModels">
                            {{ msg("dialog.useCodeMirrorForOtherModels") }}
                            <template #description
                                >{{ msg("dialog.codeMirrorDescriptionBefore")
                                }}<a
                                    href="https://www.mediawiki.org/wiki/Extension:CodeMirror"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >CodeMirror</a
                                >{{
                                    msg("dialog.codeMirrorDescriptionAfter")
                                }}</template
                            >
                        </cdx-checkbox>
                    </cdx-field>
                    <cdx-field
                        :is-fieldset="true"
                        :disabled="!syntaxHighlighting"
                        class="wiked-lite-dialog__section"
                    >
                        <template #label>{{
                            msg("dialog.editorFeatures")
                        }}</template>
                        <cdx-checkbox v-model="largeFont">{{
                            msg("dialog.largeFont")
                        }}</cdx-checkbox>
                        <cdx-checkbox v-model="smallReferenceText">
                            {{ msg("dialog.smallReferenceText") }}
                            <template #description>{{
                                msg("dialog.smallReferenceTextDescription")
                            }}</template>
                        </cdx-checkbox>
                        <cdx-checkbox v-model="alternateReferenceColors">
                            {{ msg("dialog.alternateReferenceColors") }}
                        </cdx-checkbox>
                    </cdx-field>
                    <cdx-field
                        :is-fieldset="true"
                        :disabled="!syntaxHighlighting"
                        class="wiked-lite-dialog__section"
                    >
                        <template #label>{{
                            msg("dialog.linkPreviewGroup")
                        }}</template>
                        <template v-if="supportsLinkHelpers" #description
                            >{{ msg("dialog.linkPreviewGroupDescription")
                            }}<a
                                :href="linkHelperDocumentationUrl"
                                target="_blank"
                                rel="noopener noreferrer"
                                >{{ msg("dialog.linkHelperDocumentation") }}</a
                            >{{
                                msg("dialog.linkPreviewGroupDescriptionEnd")
                            }}</template
                        >
                        <cdx-checkbox v-model="ctrlClickLinks">
                            {{
                                msg("dialog.ctrlClickLinks", {
                                    modifier: linkModifierKey,
                                })
                            }}
                            <template v-if="supportsLinkHelpers" #description
                                >{{ msg("dialog.ctrlClickLinksDescription")
                                }}<a
                                    :href="linkHelperDocumentationUrl"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >{{
                                        msg("dialog.linkHelperDocumentation")
                                    }}</a
                                >{{
                                    msg("dialog.ctrlClickLinksDescriptionEnd")
                                }}</template
                            >
                        </cdx-checkbox>
                        <cdx-checkbox v-model="linkPreviews">
                            {{ msg("dialog.linkPreviews") }}
                            <template #description
                                >{{ msg("dialog.linkPreviewsDescription")
                                }}<a
                                    :href="linkHelperDocumentationUrl"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >{{
                                        msg("dialog.linkHelperDocumentation")
                                    }}</a
                                >{{
                                    msg("dialog.linkPreviewsDescriptionEnd")
                                }}</template
                            >
                        </cdx-checkbox>
                        <cdx-checkbox v-model="highlightMissing">
                            {{ msg("dialog.highlightMissing") }}
                            <template #description>{{
                                msg("dialog.highlightMissingDescription")
                            }}</template>
                        </cdx-checkbox>
                    </cdx-field>
                    <cdx-field
                        :is-fieldset="true"
                        :disabled="!syntaxHighlighting"
                        class="wiked-lite-dialog__section"
                    >
                        <template #label>{{
                            msg("dialog.referencePreviewGroup")
                        }}</template>
                        <cdx-checkbox v-model="referencePreviews">
                            {{ msg("dialog.referencePreviews") }}
                            <template #description>{{
                                msg("dialog.referencePreviewsDescription")
                            }}</template>
                        </cdx-checkbox>
                        <cdx-checkbox
                            v-model="fullPageReferencePreviews"
                            :disabled="
                                !syntaxHighlighting || !referencePreviews
                            "
                        >
                            {{ msg("dialog.fullPageReferencePreviews") }}
                            <template #description>{{
                                msg(
                                    "dialog.fullPageReferencePreviewsDescription",
                                )
                            }}</template>
                        </cdx-checkbox>
                        <cdx-checkbox
                            v-model="referenceEditing"
                            :disabled="
                                !syntaxHighlighting || !referencePreviews
                            "
                        >
                            {{ msg("dialog.referenceEditing") }}
                            <template #description>{{
                                msg("dialog.referenceEditingDescription")
                            }}</template>
                        </cdx-checkbox>
                        <div class="wiked-lite-dialog__dependent">
                            <cdx-checkbox
                                v-model="referenceLightweightEditing"
                                :disabled="
                                    !syntaxHighlighting ||
                                    !referencePreviews ||
                                    !referenceEditing
                                "
                            >
                                {{ msg("dialog.referenceLightweightEditing") }}
                                <template #description>{{
                                    msg(
                                        "dialog.referenceLightweightEditingDescription",
                                    )
                                }}</template>
                            </cdx-checkbox>
                        </div>
                    </cdx-field>
                </cdx-tab>
            </cdx-tabs>
        </fieldset>
        <template #footer>
            <div
                v-if="error || applying || savingSettings"
                class="wiked-lite-dialog__feedback"
            >
                <cdx-message v-if="error" type="error">{{ error }}</cdx-message>
                <div
                    v-if="applying || savingSettings"
                    role="status"
                    class="wiked-lite-dialog__progress"
                >
                    <span>{{
                        msg(savingSettings ? "dialog.saving" : "dialog.working")
                    }}</span>
                    <cdx-progress-bar
                        :aria-label="
                            msg(
                                savingSettings
                                    ? 'dialog.saving'
                                    : 'dialog.working',
                            )
                        "
                    />
                </div>
            </div>
            <div class="wiked-lite-dialog__footer-bar">
                <cdx-menu-button
                    v-if="!stackedActions"
                    v-model:selected="menuSelection"
                    :menu-items="menuItems"
                    :aria-label="msg('dialog.moreOptions')"
                    :disabled="applying || savingSettings"
                    class="wiked-lite-dialog__more"
                    weight="quiet"
                    @update:selected="onMenuAction"
                    >{{ msg("dialog.more") }}</cdx-menu-button
                >
                <div class="wiked-lite-dialog__actions">
                    <template v-for="action in actionOrder()" :key="action">
                        <cdx-menu-button
                            v-if="action === 'more'"
                            v-model:selected="menuSelection"
                            :menu-items="menuItems"
                            :aria-label="msg('dialog.moreOptions')"
                            :disabled="applying || savingSettings"
                            class="wiked-lite-dialog__more"
                            weight="quiet"
                            @update:selected="onMenuAction"
                            >{{ msg("dialog.more") }}</cdx-menu-button
                        >
                        <cdx-button
                            v-else
                            :class="
                                action === 'primary'
                                    ? 'wiked-lite-dialog__primary'
                                    : 'wiked-lite-dialog__cancel'
                            "
                            type="button"
                            :action="
                                action === 'primary' ? 'progressive' : 'default'
                            "
                            :weight="action === 'primary' ? 'primary' : 'quiet'"
                            :disabled="applying || savingSettings"
                            @click="action === 'primary' ? apply() : onClose()"
                        >
                            {{
                                action === "primary"
                                    ? primaryLabel()
                                    : msg("dialog.cancel")
                            }}
                        </cdx-button>
                    </template>
                </div>
            </div>
        </template>
    </cdx-dialog>
</template>
