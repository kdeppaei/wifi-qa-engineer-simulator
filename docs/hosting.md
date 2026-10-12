# 兩個公開網站

| 工具                 | 公開網址                                               | Sites project_id                         |
| -------------------- | ------------------------------------------------------ | ---------------------------------------- |
| Excel 繪圖與表格     | https://excel-chart-table-tools.kdeppaei2.chatgpt.site | appgprj_6accfbefcd08819197e715891094c738 |
| Wi-Fi QA Virtual Lab | https://wifi-qa-virtual-lab.kdeppaei2.chatgpt.site     | appgprj_6accfc0d16a08191ba3dd419597247df |

兩個 Site 的 access_mode 為 public，提供分開的工具入口。發布包只有程式與靜態資源，沒有使用者 PDF、截圖、測試試算表或實測資料。執行時沒有資料上傳 API。原始碼與 Fork 維持在此公開 GitHub 儲存庫。

維護時先完成來源測試與 `pnpm build`，再用 `scripts/prepare-sites.mjs` 將建置資源放入原 Sites checkout 的 `dist/`；保留各自 `.openai/hosting.json` 的 project_id。依 Sites 技能更新來源、保存版本及發布，重新使用以上 Site，勿重複建立。短期 Git 憑證只能透過 helper stdin 傳入，不放入原始碼或檔案。

本機 HTML 免安裝版仍提供，與公開網站使用同一個建置版本。Wi-Fi 模擬器不同 origin 的瀏覽器存檔獨立，可用 JSON 快照交換。

## UI 設計參考

- [Microsoft Fluent 按鈕](https://fluent2.microsoft.design/components/web/react/core/button/usage/)：用主要動作層級凸顯下載，次要操作使用中性樣式。
- [IBM Carbon Accordion](https://www.carbondesignsystem.com/building-blocks/core/components/accordion/guidelines)：將進階欄位／外觀及操作說明按需展開，減少頁面捲動。
