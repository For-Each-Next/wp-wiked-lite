# wikEd Lite contributor instructions

Read `CONTRIBUTING.md` and `docs/architecture.md` before changing project structure.
This is a working MediaWiki gadget and a reference for other gadget authors.

- Keep startup and wiring in `src/app/`, pure rules in `src/domain/`, host
  integration in `src/platform/`, and UI ownership in `src/features/`.
- Keep `src/index.ts` side-effect free. Expose only deliberate public operations.
- Mirror edits immediately to the native submitted textarea and restore it when
  disposing an enhanced surface. Release event listeners, timers, and observers.
- Treat article text as untrusted text. Render it with text nodes. Protect comments
  and literal extension tags during formatting. Optional lookups must not block
  editing; ignore stale asynchronous results.
- Inject logging and notification capabilities. Keep all three message catalogs
  aligned and render translated content as text.
- Use the tracked lockfile (`npm ci`) and Node.js 24.14.1 or newer. Run
  `npm run verify` for material changes. Automated tests are offline and do not
  mutate live MediaWiki services.
- Generate `dist/` with the build. Keep README Features short; put technical
  guidance in `docs/` and notable changes in `CHANGELOG.md`.
- Preserve the project-owned CC0 dedication and third-party licensing limits.
