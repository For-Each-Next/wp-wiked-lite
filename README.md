# wikEd Lite

[English](README.md) · [繁體中文](README.zh-Hant.md) · [简体中文](README.zh-Hans.md)

Highlight, inspect, and format wikitext while editing a MediaWiki page.

<!-- toc:start -->

## Contents

- [Features](#features)
- [Installation](#installation)
- [How to use](#how-to-use)
- [Screenshots](#screenshots)
- [Help](#help)
- [License](#license)

<!-- toc:end -->

## Features

- Live syntax highlighting with optional reference and page previews.
- Inspect and edit citation fields directly from a reference popup.
- Format a selection or the whole page, with optional template alignment and redirect resolution.
- Keep every edit synchronized with the source submitted by MediaWiki.

## Installation

Choose one installation method:

1. **MediaWiki:** download [wiked_lite.min.js](https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.min.js) from the latest GitHub release and copy its contents into your wiki’s `Special:MyPage/common.js`. Site administrators can install it as a gadget.
2. **Tampermonkey:** install [wiked_lite.user.js](https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.user.js). This version includes readable code and userscript metadata.

Reload an edit page after installation. To remove the tool, delete its code from your common.js or disable the userscript. Settings are stored in this browser on the current wiki.

## How to use

1. Open a page with **Edit source**.
2. Open **wikEd Lite panel** in the page tools.
3. Choose formatting options or highlighting settings. The primary action applies your choices to the current edit.
4. Use **More → Save settings** to keep these preferences for later visits.
5. Review the source before using MediaWiki’s own publish action.

The panel formats wikitext; it does not publish edits. Optional page lookups require a network connection. Current browsers and the current Wikimedia ResourceLoader APIs are supported. For non-wikitext models, you can enable the host CodeMirror editor in settings.

## Screenshots

![Inspecting an article reference](docs/images/screenshot-01.png)
![Formatting panel](docs/images/screenshot-03.png)

Captured from the running tool using the [BanG Dream! article, revision 94028176](https://zh.wikipedia.org/w/index.php?oldid=94028176). These are offline examples; see [screenshot sources and attribution](docs/screenshots.md).

## Help

Read [configuration](docs/configuration.md) and [panel behavior](docs/control-panel.md). Report a problem in [GitHub issues](https://github.com/For-Each-Next/wp-wiked-lite/issues), including your browser, wiki, and steps to reproduce it. For development, see [Contributing](CONTRIBUTING.md).

## License

Based on [Cacycle’s wikEd](https://en.wikipedia.org/wiki/User:Cacycle/wikEd), with live-highlighting inspiration from [Remember the dot](https://www.mediawiki.org/wiki/User:Remember_the_dot/Syntax_highlighter). Project-owned material is dedicated under [CC0 1.0](LICENSE); Codex icons retain the MIT license. See [third-party notices](THIRD-PARTY-NOTICES.md). Wikipedia fixture text retains CC BY-SA 4.0 attribution.
