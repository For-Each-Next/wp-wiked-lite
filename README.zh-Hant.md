# wikEd Lite

[English](README.md) · [繁體中文](README.zh-Hant.md) · [简体中文](README.zh-Hans.md)

在 MediaWiki 編輯頁面即時高亮、檢查及整理維基文字。

<!-- toc:start -->

## 目錄

- [功能](#功能)
- [安裝](#安裝)
- [使用方法](#使用方法)
- [螢幕擷圖](#螢幕擷圖)
- [說明與回報](#說明與回報)
- [授權](#授權)

<!-- toc:end -->

## 功能

- 即時語法高亮，可選擇顯示參考資料與頁面預覽。
- 直接在參考資料浮窗中檢查與修改引文欄位。
- 整理選取範圍或整頁文字，可選擇對齊模板參數與解析重新導向。
- 所有修改立即同步至 MediaWiki 提交的原始碼。

## 安裝

選擇一種安裝方式：

1. **MediaWiki：**下載 GitHub 最新版本的 [wiked_lite.min.js](https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.min.js)，將內容複製到該站的 `Special:MyPage/common.js`。管理員亦可安裝為小工具。
2. **Tampermonkey：**安裝 [wiked_lite.user.js](https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.user.js)，其中包含可閱讀的程式碼與使用者指令碼標頭。

安裝後重新載入編輯頁面。移除時，從 common.js 刪除相應程式碼或停用使用者指令碼。設定保存在目前瀏覽器的目前維基站點。

## 使用方法

1. 在條目選擇**編輯原始碼**。
2. 從頁面工具開啟 **wikEd Lite 面板**。
3. 選擇整理選項或高亮設定，再以主要操作按鈕套用至本次編輯。
4. 選擇**更多 → 儲存設定**，供日後使用。
5. 檢查原始碼後，再使用 MediaWiki 的發佈操作。

面板整理維基文字，不會發佈編輯。可選的頁面查詢需要網路連線。支援目前的瀏覽器與 Wikimedia ResourceLoader API。非維基文字的內容模型可在設定中啟用網站提供的 CodeMirror 編輯器。

## 螢幕擷圖

![檢查條目中的參考資料](docs/images/screenshot-01.png)
![整理面板](docs/images/screenshot-03.png)

以執行中的工具及 [BanG Dream! 條目第 94028176 版](https://zh.wikipedia.org/w/index.php?oldid=94028176)擷取。這些是離線示例；來源與署名見[擷圖說明](docs/screenshots.md)。

## 說明與回報

詳見[設定](docs/configuration.md)與[面板操作](docs/control-panel.md)。遇到問題時可至 [GitHub issues](https://github.com/For-Each-Next/wp-wiked-lite/issues) 提供瀏覽器、維基站點及重現步驟。開發說明見[貢獻指南](CONTRIBUTING.md)。

## 授權

基於 [Cacycle 的 wikEd](https://en.wikipedia.org/wiki/User:Cacycle/wikEd)，即時高亮亦受到 [Remember the dot](https://www.mediawiki.org/wiki/User:Remember_the_dot/Syntax_highlighter) 啟發。專案自身材料採用 [CC0 1.0](LICENSE)，Codex 圖示保留 MIT 授權，詳見[第三方聲明](THIRD-PARTY-NOTICES.md)。維基百科測試文字保留 CC BY-SA 4.0 署名。
