# Architecture

**UI changes must follow [Wikimedia Codex: types and order of buttons](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html#types-and-order-of-buttons).**
Use one primary progressive action per group, normal secondary actions, quiet
tertiary actions, and neutral cancellation. Forward flows place the primary
action last in reading and keyboard order; stacked groups place it first.
Keep dialog actions at the inline end with 12px spacing, and separate irreversible
destructive actions from progressive actions. Use inline Codex messages for
actionable errors, accessible progress for pending work, and native MediaWiki
notifications for brief success feedback.

<!-- toc:start -->

## Contents

- [Scope](#scope)
- [Folder names and ownership](#folder-names-and-ownership)
- [Dependencies and startup](#dependencies-and-startup)
- [Editor ownership](#editor-ownership)
- [Reading path](#reading-path)
- [Editor interoperability](#editor-interoperability)

<!-- toc:end -->

## Scope

wikEd Lite is an independently installable source-editor gadget.
Its architecture separates runtime environments through explicit service contracts,
small startup modules, and independently testable editor features. This project
uses ordinary functions and TypeScript interfaces for dependency injection.

## Folder names and ownership

| Path                      | Responsibility                                                                 |
| ------------------------- | ------------------------------------------------------------------------------ |
| `src/app/`                | Browser entry point, composition root, and application orchestration.          |
| `src/domain/`             | Deterministic wikitext rules, models, scanners, highlighting, and formatting.  |
| `src/platform/mediawiki/` | MediaWiki API, page context, ResourceLoader, and native notifications.         |
| `src/platform/browser/`   | Browser storage and native event adapters.                                     |
| `src/features/editor/`    | Enhanced editing surface, synchronization, history, rendering, and previews.   |
| `src/features/formatter/` | Formatter action and its Codex dialog, template, and styles.                   |
| `src/shared/`             | Small host-independent capabilities such as logging and translation.           |
| `src/i18n/`               | Product message catalogs and interface-language selection.                     |
| `src/types/`              | Ambient host/build declarations.                                               |
| `tests/`                  | Offline unit and service tests; `tests/ui/` exercises actual browser behavior. |
| `scripts/`                | Build and release tools executed by Node.js.                                   |
| `docs/`                   | Architecture, configuration, and interaction reference.                        |
| `dist/`                   | Generated installation artifacts; excluded from Git.                           |

Use lowercase kebab-case for folders and TypeScript/CSS files. Name modules for
the capability they own (`page-summary.ts`, `history.ts`). Reserve `index.ts`
for an intentional public boundary. Tests use `*.test.ts`; browser scenarios use
`*.spec.ts`. Avoid unrelated helpers accumulating in `utils`, `helpers`, or
`common`; a wikitext scanner belongs to `domain/wikitext`, not a generic utility
folder. A new gadget can keep the same top-level roles and choose its own feature
names.

## Dependencies and startup

`app/browser.ts` invokes `start` in `app/main.ts`. The composition root creates
platform adapters and supplies them to application services and the editor.
Application orchestration uses callback ports, allowing API behavior to be
replaced with fixtures in tests. Consumer contracts belong with the application
or domain, so UI modules do not import response types from API implementations.

Domain and shared modules have no dependency on the browser UI, MediaWiki globals,
or application startup. Platform implementations can depend on those inner
contracts; features consume services and pure operations. Only the composition
root joins implementations and their consumers. The public `src/index.ts` exports
pure highlighter, formatter, and reference-preview operations without starting
the gadget.

The formatter dialog loads the host wiki's Vue and Codex through ResourceLoader.
Their npm packages provide local types and browser-test fixtures; the production
bundle does not embed another Vue or Codex runtime.

## Editor ownership

Editor integration discovers eligible native textareas. When enabled, it delegates
other content models to CodeMirror. The editor controller owns source
synchronization, history, and its lifecycle. Separate surface, DOM, and rendering
modules handle browser mechanics. Optional contributions own missing-link checks
and hover previews.
The formatter feature owns opening the dialog and applying an accepted operation.

Reference preview UI stays together in `features/editor/reference-tooltip.ts`,
including hover lifecycle, positioning, forms, icons, theme, and displayed values.
Keep its private helpers in that module instead of scattering tooltip-only code
across small files. Article and reference previews share frame-safe positioning
and hovered-line selection in `features/editor/preview-position.ts`.
`domain/reference-preview.ts` owns preview models and source
edit validation, while `domain/reference-changes.ts` tracks saved changes and
resets. `domain/reference-highlighting.ts` owns reference-specific highlight
ranges; the main highlighter composes them with the other syntax rules. These
domain modules remain independent of tooltip DOM and editor state.

Every edit immediately updates the native textarea. Removing an enhanced surface
restores that textarea and releases its event listeners, timers, observers, and
optional contributions. Asynchronous lookups discard stale results after source,
settings, cache, or lifecycle changes. Formatting protects opaque source ranges;
article text and translated content are rendered as text.

## Reading path

1. Read `app/browser.ts` and `app/main.ts` to see how startup and host dependencies
   are assembled.
2. Follow `app/editor-services.ts` and its ports to see a use case tested without
   MediaWiki globals or network access.
3. Read a small domain operation and its fixture tests, then a MediaWiki adapter
   and its response-validation tests.
4. Follow the editor integration into its controller and the formatter action
   into its dialog to see ownership and cleanup.
5. Read `package.json`, the lint configuration, and `.github/workflows/` for the
   same checks used locally, on pull requests, and before a release.

Keep domain rules, features, messages, metadata, artifact names, and licensing local
to this project. Keep the source tree small until additional features need new modules.

## Editor interoperability

The visible editor registers a textarea-local backend at
`Symbol.for("mediawiki-gadgets.edit-box-backend")`. Independent tools can read,
write, preserve position, replace a selection, and focus it without importing this
project. Every accepted update reaches the submitted textarea and undo history.
Mutations reject active IME composition and disposed editors before changing text.
Disposal unregisters the owned backend. Native input events remain supported.
