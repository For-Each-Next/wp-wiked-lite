# wikEd Lite

A lightweight MediaWiki source-editor gadget for highlighting and formatting
wikitext.

wikEd Lite builds on [Cacycle][1]'s [wikEd][2], focusing on its syntax
highlighting and formatting features. Thanks to Cacycle for releasing wikEd
into the public domain. Special thanks to [Remember the dot][3], whose
[syntax highlighter][4] inspired live highlighting as you type.

This gadget is mainly for personal use and was designed for the
[Chinese Wikipedia][5]. It may not suit everyone's needs or work as well on
other projects.

All of its code was generated with GPT, and I have no idea how it works.
If you have questions or suggestions for improvements, feel free to ask an AI
assistant to examine and improve the code.

## Features

![highlighting and previewing a citation](/docs/images/screenshot-01.png)
_The wikitext from "[地球冒险3][6]" by [Chinese Wikipedians][8] is licensed
under [CC BY-SA 4.0][7]._

### Syntax highlighting

- Live highlighting based on wikEd's color scheme, with optional alternating
  background colors for consecutive groups of references.
- Optional hover previews for `<ref name="foo" />` and `{{r|foo}}`, showing
  reference text and citation-template fields in a readable layout.
- Optional page previews when hovering over page titles in wikilinks or
  supported templates such as `{{link-en}}`, for both local and foreign pages.
- Optional missing-page checks that mark missing page titles in red.

### Formatting

- General wikitext cleanup based on wikEd, applied to a selection or the
  whole page.
- Optional indentation and parameter alignment for multiline templates.
- Optional redirect target "fixing".

### Trivia

- wikEd Lite is designed specifically for Wikitext. For other content models,
  such as Lua, you can choose to load [CodeMirror][9] automatically.

## How to use

From the [latest release](../../releases/latest), copy the contents of
[wiked_lite.min.js](https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.min.js)
into `Special:MyPage/common.js` or add it as a site gadget.
Tampermonkey users can install
[wiked_lite.user.js](https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.user.js)
instead.

On a wikitext edit page, open the **wikEd Lite panel** from the page tools to
format wikitext or change preferences. Use the main button to apply your choices
to this edit. To save the panel's current settings as your default on this site
in this browser, choose **More → Save settings**.

## License

Because wikEd Lite builds on [Cacycle][1]'s public-domain [wikEd][2] and its
code was generated with GPT, the repository owner does not claim copyright in
the project's own material. To the extent the owner holds any rights in that
material, he dedicates those rights to the public domain under
[CC0 1.0](LICENSE). Third-party dependencies and Wikimedia content retain their
own terms.

[1]: https://en.wikipedia.org/wiki/User:Cacycle
[2]: https://en.wikipedia.org/wiki/User:Cacycle/wikEd
[3]: https://en.wikipedia.org/wiki/User:Remember_the_dot
[4]: https://www.mediawiki.org/wiki/User:Remember_the_dot/Syntax_highlighter
[5]: https://zh.wikipedia.org/
[6]: https://zh.wikipedia.org/wiki/Special:PermanentLink/94562841
[7]: https://creativecommons.org/licenses/by-sa/4.0/
[8]: https://zh.wikipedia.org/w/index.php?title=地球冒险3&action=history&offset=20260925162900
[9]: https://www.mediawiki.org/wiki/Extension:CodeMirror
