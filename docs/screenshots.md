# Documentation screenshots

**UI changes must follow [Wikimedia Codex: types and order of buttons](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html#types-and-order-of-buttons).**
Review action hierarchy, neutral cancellation, and focus order in the images.

Run `npm run screenshots` after installing the tracked dependencies and Chromium.
The command builds the current gadget and captures its actual editor and Codex
panel using offline Playwright fixtures. It never contacts or edits a live wiki.

Every image uses a 1024 × 768 viewport, device scale factor 1, a Simplified Chinese
interface, and disabled animations. The source in
`tests/fixtures/documentation.wikitext` is an invented example. Page-summary and
MediaWiki responses come from local fixtures.

| Image                      | State                                            |
| -------------------------- | ------------------------------------------------ |
| `images/screenshot-01.png` | Citation inspection with editable fields.        |
| `images/screenshot-02.png` | Interlanguage template link with a page summary. |
| `images/screenshot-03.png` | Formatting panel.                                |
| `images/screenshot-04.png` | Highlighting preferences.                        |

Documentation capture is opt-in and writes tracked images only when
`DOCUMENTATION_SCREENSHOTS=1`. Normal verification leaves the images untouched.
Review regenerated images for clipped controls and text before committing them.
