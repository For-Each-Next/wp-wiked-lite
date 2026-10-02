# Documentation screenshots

<!-- toc:start -->

## Contents

- [Capture](#capture)
- [Article source and attribution](#article-source-and-attribution)
- [Image inventory](#image-inventory)

<!-- toc:end -->

## Capture

Run `npm run screenshots` after installing the tracked dependencies and Chromium.
The command builds the current gadget and captures its actual editor and Codex panel
with offline Playwright fixtures. It never contacts or edits a live wiki.

Every image uses a 1024 × 768 viewport, device scale factor 1, a Simplified Chinese
interface, and disabled animations. Normal verification leaves the images untouched.
Review every image for clipped text, controls, keyboard order, and readable contrast.

## Article source and attribution

`tests/fixtures/bang-dream.wikitext` contains the full source of
[BanG Dream! 少女樂團派對, revision 94028176](https://zh.wikipedia.org/w/index.php?oldid=94028176),
as supplied for this example. Revision metadata is in `bang-dream.source.json`.
Text is credited to [Wikipedia contributors](https://zh.wikipedia.org/w/index.php?title=BanG_Dream!_%E5%B0%91%E5%A5%B3%E6%A8%82%E5%9C%98%E6%B4%BE%E5%B0%8D&action=history)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The captured source remains unchanged; the viewport is scrolled to show the relevant feature.
The page-summary response and MediaWiki shell are local simulations, not live article data.
No article images, audio, or video are downloaded or included.

## Image inventory

| Image                      | State                                           |
| -------------------------- | ----------------------------------------------- |
| `images/screenshot-01.png` | Citation inspection with editable fields.       |
| `images/screenshot-02.png` | Article link with a local page-summary fixture. |
| `images/screenshot-03.png` | Formatting panel.                               |
| `images/screenshot-04.png` | Highlighting preferences.                       |
