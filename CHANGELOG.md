# Changelog

<!-- toc:start -->

## Contents

- [Unreleased](#unreleased)
- [\[0.2.2\] - 2026-10-03](#022---2026-10-03)
  - [Changed](#changed)
- [\[0.2.1\] - 2026-10-02](#021---2026-10-02)
  - [Changed](#changed-1)
- [\[0.2.0\] - 2026-09-27](#020---2026-09-27)
  - [Added](#added)
  - [Changed](#changed-2)
  - [Fixed](#fixed)
- [\[0.1.0\] - 2026-09-27](#010---2026-09-27)
  - [Added](#added-1)

<!-- toc:end -->

## Unreleased

## [0.2.2] - 2026-10-03

### Changed

- Add an independent editor contract that preserves source, selection, viewport, and undo history.
- Reject external edits during active text composition and protect backend ownership on cleanup.
- Use semantic Codex dialog-launch buttons and consistent readable/userscript artifact headers.
- Harmonize three-language user guides, contributor documentation, and file contents checks.
- Recreate documentation screenshots from BanG Dream! article revision 94028176.

## [0.2.1] - 2026-10-02

### Changed

- Dialog actions follow Codex hierarchy in reading and keyboard order.
- Contributor and developer guides require Codex button types and ordering.
- Offline documentation screenshots use a reproducible 1024 × 768 viewport.

## [0.2.0] - 2026-09-27

### Added

- Reference tooltips edit citation names, values, notes, and subreference details,
  with native textarea sync, Undo/Redo, and preserved spacing.
- Citation fields can be added before the first parameter or after an existing
  one. Duplicate names are rejected.
- Bare pipes become `{{!}}` without altering nested templates, wikilinks,
  comments, or literal tags.
- Edit/add forms offer Cancel, Reset, and Save. Changed fields are highlighted;
  saving or resetting keeps the tooltip open.
- Reset restores original fields or removes newly added fields.
- Optional lightweight editing uses text controls. Enter saves, Shift+Enter adds
  a line break, and Escape cancels. Off by default.
- Saved preferences control reference editing independently of inspection.
  Remote fields are read-only; local subreference details remain editable.
- Duplicate citation parameters show an alert and explanation.
- Reference values use syntax colors, bold link aliases, and optional
  missing-link colors.
- Ctrl/Cmd-click opens wiki links and external URLs in both tooltip modes.

### Changed

- Reference tooltip links keep their syntax colors without hover underlines or
  pointer cursors; Ctrl/Cmd-click still opens their targets.
- Reference backgrounds start pink; optional consecutive colors alternate pink
  and blue, replacing darker purple and blue variants.
- Article previews gain arrows. Both popups anchor to the mouse when opened,
  stay fixed over the same source, and fit within the editor frame.
- Reference UI, forms, icons, theme, and values share `reference-tooltip.ts`;
  parsing and source edits remain independent of the UI.
- Pure reference highlighting has a dedicated domain module. Highlighting reuses
  tag scans.
- Reference forms share validation and save paths; editor and tooltip rendering
  share highlight options and link-check state.
- Formatter preferences share snapshot and reset logic.
- Highlighting settings group Syntax highlighting, Text and colors, Links, and
  Reference popups.
- Disabling highlighting restores the native textarea while retaining display
  preferences.
- Tooltip headings distinguish reference names, subreference content, and
  citation fields. Popup colors follow Codex theme tokens.
- Gadget and userscript builds credit `@wikimedia/codex-icons` and include its
  full MIT notice; project-owned material remains CC0.

### Fixed

- Detached Save controls from closed reference forms can no longer apply edits.
- `{{Efn}}` and supported variants use ordinary template shading while retaining
  the optional small reference text size.
- Consecutive references inside notes alternate pink and blue when enabled,
  starting a fresh sequence from pink.

## [0.1.0] - 2026-09-27

Initial release.

### Added

- Live wikitext highlighting with Undo/Redo, plain-text editing, and native
  textarea synchronization.
- Selection, section, and whole-page formatting with template layout controls
  and protection for comments and literal extension tags.
- Optional redirect cleanup, missing-link checks, and page/reference previews.
- Chinese conversion-rule cleanup on Chinese Wikipedia.
- A Codex settings dialog with browser-local preferences and English,
  Simplified Chinese, and Traditional Chinese interfaces.
- CodeMirror integration for other editable content models.
- Standalone MediaWiki gadget and userscript build artifacts.
- Application, domain, platform, and feature modules with contributor and
  architecture documentation.
- Automated formatting, lint, type, unused-code, unit, and offline browser checks.
  Browser-test output is temporary and removed after each run.
- CI validation and tagged releases with generated artifacts and release notes.
