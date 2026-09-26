# Contributing

Use Node.js 24.14.1 or newer, as declared in `package.json`. CI checks the
24.14.1 baseline. Install the exact tracked dependency tree with `npm ci`;
install Chromium with `npx playwright install chromium` for browser tests.

## Development loop

| Command           | Purpose                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `npm run format`  | Apply the repository's formatting conventions.                        |
| `npm run check`   | Check formatting, lint, types, and unused files/exports/dependencies. |
| `npm test`        | Run offline unit and service tests.                                   |
| `npm run build`   | Generate `dist/wiked_lite.min.js` and `dist/wiked_lite.user.js`.      |
| `npm run test:ui` | Build and run the offline Playwright Chromium suite.                  |
| `npm run verify`  | Run all required checks and tests.                                    |

Prettier and Knip settings live in `package.json`. Formatting commands honor
`.gitignore` and exclude the generated lockfile. ESLint and Playwright use their
own executable configurations; the test TypeScript configuration extends the
browser configuration with Node.js types.

Run `npm run verify` before submitting a material change. `npm run test:ui`
prints results to the terminal and deletes its temporary output after success,
failure, or a handled interruption. Reports requested through additional
Playwright arguments are also temporary. CI keeps the test output in its job log.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only when testing against a specific installed
Chromium executable.

Keep tests fixture-based and do not edit a live wiki from automation. Add behavior
coverage for meaningful regressions and new features. Keep pure logic independent
of browser globals, and inject external operations for service tests. Prefer
asserting user-visible behavior over matching the spelling of implementation
source. See [architecture](docs/architecture.md) for dependency and naming rules.

## Changes and reviews

Keep changes focused, explain the resulting behavior, and include relevant
validation. Update all three message catalogs together. Record notable changes
in `CHANGELOG.md`; keep README Features brief and place technical details in
`docs/`. Generated artifacts are rebuilt, never edited by hand.

Dependencies are locked. Review dependency updates through the same validation
pipeline. Vue and Codex remain supplied by MediaWiki in production; do not bundle
a second runtime accidentally. Preserve license notices and distinguish
project-owned code from third-party code and data.

## Releases

1. Update `package.json` and its lockfile to the release version (for example,
   `npm version patch --no-git-tag-version`).
2. Move completed Unreleased notes into a `## [X.Y.Z] - YYYY-MM-DD` section in
   `CHANGELOG.md` and confirm the date represents the release being prepared.
3. Run `npm run verify`, review the generated installation artifacts, and commit
   the release preparation.
4. Create `vX.Y.Z` and push the commit and tag to the project's GitHub repository.

For the initial version, the tag is `v0.1.0`. The release workflow requires the
stable tag to match the package version and a changelog section to exist. It runs
the shared validation pipeline before publishing both artifacts and the selected
changelog notes to GitHub Releases. Publishing a tag is a deliberate maintainer
action.
