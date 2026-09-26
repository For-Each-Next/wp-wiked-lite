# Control panel design

The panel uses the wiki's Vue and Wikimedia Codex components, with framed tabs
and a small scoped stylesheet for spacing and layout. It does not bundle a separate UI
framework or fetch design assets. The following official guidance informed
the redesign; the implementation uses the project's locked Codex version for
local verification.

| Area                  | Implementation                                                                                                                                                                                                | Official guidance                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Information structure | Highlighting settings contains presentation and previews; Formatting combines cleanup, redirects, and template layout. These are independent topics, not sequential steps.                                    | [Tabs](https://doc.wikimedia.org/codex/latest/components/demos/tabs.html)                                                                                                                 |
| Dialog actions        | One progressive primary action, a quiet neutral Cancel action, and a close button. The primary label identifies the formatting scope or applies settings without formatting.                                  | [Dialog](https://doc.wikimedia.org/codex/latest/components/demos/dialog.html), [Using links and buttons](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html) |
| Occasional actions    | A quiet More menu groups Save settings, Clear cache, and destructive Reset settings. Success uses native notifications; errors and progress remain in the footer.                                             | [MenuButton](https://doc.wikimedia.org/codex/latest/components/demos/menu-button.html)                                                                                                    |
| Forms                 | Visible labels, semantic fieldsets, 24px section spacing, and 16px indentation for dependent controls. Related template fields stack below 640px.                                                             | [Constructing forms](https://doc.wikimedia.org/codex/latest/style-guide/constructing-forms.html)                                                                                          |
| Choices               | Checkboxes collect preferences for explicit submission. Conditional options retain their values when hidden. Alignment labels distinguish names from values, with a live example.                             | [Checkbox](https://doc.wikimedia.org/codex/latest/components/demos/checkbox.html), [Constructing forms](https://doc.wikimedia.org/codex/latest/style-guide/constructing-forms.html)       |
| Visual hierarchy      | Standard Codex controls and semantic skin tokens; quiet supporting text; a single primary action. The template example uses a flat surface without elevation.                                                 | [Colors](https://doc.wikimedia.org/codex/latest/style-guide/colors.html), [Typography](https://doc.wikimedia.org/codex/latest/style-guide/typography.html)                                |
| Wording               | Short sentence-case labels, explicit units, descriptive actions, complete translated sentences, and error messages that explain how to continue.                                                              | [Writing for copy](https://doc.wikimedia.org/codex/latest/style-guide/writing-for-copy.html), [Voice and tone](https://doc.wikimedia.org/codex/latest/style-guide/voice-and-tone.html)    |
| Accessibility         | Codex manages modal focus, tab keyboard navigation, control labels, and focus indicators. Errors and progress use accessible feedback components. Logical spacing supports RTL; example wikitext remains LTR. | [Accessibility](https://doc.wikimedia.org/codex/latest/style-guide/accessibility.html), [Bidirectionality](https://doc.wikimedia.org/codex/latest/style-guide/bidirectionality.html)      |

## Interaction contract

- Changes remain drafts until the primary action succeeds. Cancel, close, and
  Escape discard unapplied drafts. Applying Highlighting settings never invokes
  the formatter. Explicit Save settings and Clear cache actions are immediate;
  dismissing the panel does not undo them.
- Accepted settings remain available when reopening the panel in the same edit
  session. Persistence is optional and saves all tabs in browser-local storage.
- More → Save settings stores the current draft without formatting, applying it
  to the editor, or closing the panel. A storage failure leaves the draft open
  and does not prevent applying it for the current edit. Formatting failures
  likewise preserve the draft for retry.
- Saving settings and clearing the cache show brief native MediaWiki success
  notifications, with a visually hidden announcement inside the modal for screen
  readers. The dialog stays open, with errors and progress shown in its footer.
- More → Reset settings removes the saved configuration and restores the whole
  dialog draft to defaults. Save and Reset always cover both tabs. Reset leaves
  the current editor unchanged until the defaults are applied. Its menu item
  uses Codex's destructive treatment; the close action is quiet and neutral.
- The source range and action are captured before asynchronous work. Busy
  controls cannot submit twice or dismiss the dialog during an operation.
- Network-backed features remain opt-in. Redirect lookup runs only on an
  explicit formatting action. Editor lookups run in the background after the
  settings are accepted.
- Disabling syntax highlighting renders plain text and pauses link checks and
  previews while preserving their settings. Re-enabling it restores those
  features. Older saved configurations keep highlighting enabled.
- References includes an opt-in alternating-colors setting. Every second
  consecutive reference group uses a darker background, preserving text colors.
  A self-closing `<ref />` and its directly following reference template form one
  group. Standalone reference templates also alternate; prose resets the sequence.
- Subreference hover previews show the occurrence's `details` before its parent
  bibliography. Missing parent definitions do not hide those details; enabled
  whole-page reference loading can still resolve the parent from another section.
  Subreference content retains its raw wikitext with the editor's syntax
  highlighting, without template expansion.
- Clear cache acts immediately on page summaries, missing-page results, and
  whole-page reference source. Pending responses from before the clear are
  ignored. It does not reset preferences or namespace metadata.
- Formatting options includes **Format HTML tags** on every wiki, off by default.
  It normalizes tag spacing, attribute quoting, and inline `style` CSS while
  protecting comments, literal contents, and ambiguous or dynamic syntax.
- **Format language conversion rules** covers inline `-{...}-` rules and
  page-wide manual `NoteTA` rules. It is available only on zhwiki; saved
  preferences cannot enable it on other wikis.
- Nested-template indentation has an explicit checkbox and a numeric spaces-per-level
  field, defaulting to 2 and accepting nonnegative whole numbers. Disabling
  indentation retains the width and first-level opt-out for later use.
- The Tracklists example contains two nested `tracklist` templates for Side A and
  Side B, each with Chinese and English track titles to demonstrate indentation.
  The longer `heading` and `comment` parameter names demonstrate alignment.
  Ratios are displayed as Latin:Chinese (3:5 and 1:2) and are available on every
  wiki, including enwiki. Existing stored formatter values retain their
  Chinese:Latin convention for compatibility.
- Examples and translated content render as text. Every source change still
  passes through the existing editor replacement path and native textarea.

## Verification

Unit tests cover draft acceptance, dismissal, option preservation, asynchronous
snapshots, cache invalidation, and failure recovery. Offline browser tests mount
the actual Codex dialog and verify selected-range formatting, form submission,
focus restoration, keyboard tabs, menu actions, highlighting controls,
wiki-specific options, persistence, error presentation, RTL, and narrow layouts
in English, Simplified Chinese, and Traditional Chinese.
