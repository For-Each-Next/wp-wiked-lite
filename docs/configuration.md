# Configuration

**UI changes must follow [Wikimedia Codex: types and order of buttons](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html#types-and-order-of-buttons).**
Use one primary progressive action per group, normal secondary actions, quiet
tertiary actions, and neutral cancellation. Forward flows place the primary
action last in reading and keyboard order; stacked groups place it first.
Keep dialog actions at the inline end with 12px spacing, and separate irreversible
destructive actions from progressive actions. Use inline Codex messages for
actionable errors, accessible progress for pending work, and native MediaWiki
notifications for brief success feedback.

Open **wikEd Lite panel** from the page tools. **Highlighting settings** controls
highlighting, text size, and optional lookups; **Formatting** changes source text.
The primary action accepts settings for the current edit. Cancel, close, and
Escape discard unapplied drafts.

Highlighting settings has four groups, in order: **Syntax highlighting**,
**Text and colors**, **Links**, and **Reference popups**. The first group selects
wikEd Lite for wikitext and CodeMirror for other content models. The remaining
groups control wikEd Lite's display and inspection features.

Turning off **Use wikEd Lite to highlight wikitext pages** removes its editor
frame and restores the native textarea. The three display groups are disabled,
including larger text, while retaining their preferences. Applying the option
again restores the enhanced editor with those preferences and the current source.

Under **Syntax highlighting**, **Use CodeMirror for other content models** is
off by default. wikEd Lite enhances only wikitext; when this setting is off, it
loads no enhanced editor for other models. Turn it on and use **More → Save
settings** to load [CodeMirror](https://www.mediawiki.org/wiki/Extension:CodeMirror)
on later edits of other content models. The panel is available on wikitext edit
pages.

**More → Save settings** stores the draft in this browser for later sessions.
Apply it separately to the current edit. **More → Clear cache** immediately clears
link, summary, and whole-page reference results while preserving source and
preferences. It also invalidates pending results.

**More → Reset settings** deletes all saved wikEd Lite settings from this browser
and restores the dialog defaults. Save and Reset always cover both tabs. Reset
leaves the current editor and source unchanged until you apply the defaults.

Under **Links**, Ctrl-click navigation (Command-click on Mac) is on by default. Turn it off
to disable opening editor links with Ctrl-click or Command-click on Mac. Apply
the choice to the current edit; use **More → Save settings** to retain it for
later sessions. This option requires syntax highlighting.
In supported interlanguage templates such as `{{tsl}}`, `{{Translink}}`, and
`{{link-en}}`, clicking the foreign page title opens that language's Wikipedia;
the local title and display label still open the local page.

Under **Formatting options**, **Format HTML tags** is available on every wiki
and off by default. It normalizes tag spacing, quotes unquoted attribute values,
and tidies inline CSS in `style` attributes. Comments, literal extension contents,
and ambiguous or dynamic syntax remain protected. **Format language conversion
rules** is available only on zhwiki and covers inline `-{...}-` rules and
page-wide manual `NoteTA` rules.

Under **Text and colors**, **Alternate pink and blue for consecutive references**
is off by default. References start pink. Enable this setting to alternate pink
and blue backgrounds within consecutive groups. Text colors stay unchanged. For example,
`<ref>...</ref><ref name="a" />{{sfn|a}}<ref name="b">...</ref>` has three groups:
the middle `<ref name="a" />{{sfn|a}}` shares the blue background. A supported
reference template immediately following a self-closing `<ref />` belongs to
that group; subsequent and standalone reference templates also alternate.
Intervening prose starts a new sequence. `{{Efn}}` and its supported variants use
ordinary template shading and retain the optional small reference text size.
They do not count as reference color groups; consecutive references inside a note
alternate from pink independently of references before the note.

Reference hover previews show a subreference's `details` before its parent
bibliography. Those details remain visible when the parent definition is missing.
When whole-page reference loading is enabled during section editing, the preview
also looks for the parent in the full page source.
Subreference content displays its raw wikitext using the editor's syntax
highlighting rules. Templates remain source text and are not expanded.
Citation preview headings link to the citation template's documentation page.
Archive URLs are shortened when they embed the original URL, including when
only HTTP versus HTTPS differs; clicking still opens the full archive address.

## Runtime options

Set `window.wikEdLiteConfig` before loading the gadget:

```js
window.wikEdLiteConfig = {
  maxLiveHighlightLength: 1_024_768,
  referenceTooltipDelay: 700,
  pagePreviewDelay: 700,
  logLevel: "warn",
};
```

| Option                   | Meaning                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `maxLiveHighlightLength` | Source-length ceiling for live highlighting. Longer text stays editable as plain text. `Infinity` removes the ceiling. |
| `highlightDelay`         | Delay in milliseconds before refreshing highlighting after an edit.                                                    |
| `referenceTooltipDelay`  | Settled pointer-hover delay in milliseconds before showing a reference preview.                                        |
| `pagePreviewDelay`       | Settled pointer-hover delay in milliseconds before showing a page preview.                                             |
| `logLevel`               | `silent`, `error`, `warn`, `info`, or `debug`; defaults to `warn`.                                                     |

Page-summary loading starts after a short hover and results are cached for the
editing session. Missing-page checks and whole-page reference loading are
optional. Namespace metadata uses a 24-hour browser cache. Failed optional
requests preserve editing and section-local reference analysis.

Redirect replacement runs only during an explicit formatting action. Language
conversion formatting is available only on zhwiki. Template alignment choices are
available on every wiki. See [control-panel behavior](control-panel.md) for the
full interaction contract.
