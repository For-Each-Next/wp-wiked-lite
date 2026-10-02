# wikEd Lite contributor instructions

<!-- toc:start -->

## Contents

- [Scope and required reading](#scope-and-required-reading)
- [Structure and dependencies](#structure-and-dependencies)
- [UI and accessibility](#ui-and-accessibility)
- [Data and lifecycle](#data-and-lifecycle)
- [Project invariants](#project-invariants)
- [Verification and delivery](#verification-and-delivery)

<!-- toc:end -->

## Scope and required reading

This is an independently installable MediaWiki tool. Read [Contributing](CONTRIBUTING.md),
[architecture](docs/architecture.md), [UI guidelines](docs/ui-guidelines.md), and
[documentation conventions](docs/documentation.md) before changing their respective areas.

## Structure and dependencies

Keep startup and orchestration in `src/app/`, deterministic rules in `src/domain/`,
host integrations in `src/platform/`, and UI ownership in `src/features/`.
Use `src/shared/` for small host-independent capabilities, `src/i18n/` for messages,
and `src/types/` for declarations where needed. Keep `src/index.ts` free of startup
side effects. Inject external operations through typed contracts. Co-locate each UI
component's template-only Vue file, TypeScript behavior, and scoped CSS.

Use lowercase kebab-case module names. Keep each gadget self-contained; never import another
project at runtime, replace its globals, or modify its styles. Use explicit public editor
contracts when interoperating. Remove dead modules and retired browser/API shims; retain
validation, cancellation, conflict handling, and user-data recovery.

## UI and accessibility

Follow the [Wikimedia Codex style guide](https://doc.wikimedia.org/codex/latest/style-guide/overview.html)
and especially [Using links and buttons](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html).
Use links for navigation and buttons for actions. Apply the hierarchy, order, spacing,
focus, feedback, and responsive rules in [UI guidelines](docs/ui-guidelines.md).
Production Vue and Codex come from MediaWiki ResourceLoader.

## Data and lifecycle

Treat article text, remote responses, and translations as untrusted input. Render text with
text nodes or Vue interpolation. Release listeners, observers, timers, backend registrations,
and Vue mounts when their owner is disposed. Discard stale asynchronous results. Keep supported
message catalogs aligned. Automated tests remain offline and never modify live wiki services.

## Project invariants

Mirror every edit immediately to the native submitted textarea. Preserve selection and undo when another editor operation changes source; unregister owned backends on disposal. Protect comments and literal extension tags during formatting. Optional lookups must not block editing. Preserve Cacycle and Remember the dot attribution, CC0 project dedication, and MIT icon notices.

## Verification and delivery

Use Node.js `>=24.14.1` and `npm ci` with the tracked lockfile. Run
`npm run verify` for material changes. Generate `dist/` from source; never hand-edit it.
Regenerate and inspect screenshots after relevant UI edits. Keep three user READMEs aligned,
maintain file headings and contents lists, and record notable changes under Unreleased in
`CHANGELOG.md`. Preserve attribution and license boundaries. Publishing is a separate
maintainer action; local verification does not publish anything.
