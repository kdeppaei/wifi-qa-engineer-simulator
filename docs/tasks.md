# 本對話的兩項工作

## Task 1：Wi-Fi QA Engineer Simulator

目前交付 v0.3.1。Tera Term、AP、Attenuator、Windows CMD 和 MSP 共用模擬狀態，支援指令選單、逐步工作流、完整 BF ON／OFF DL RvR 及結果匯出。連線診斷、明確同步 STA／AP 重連、Serial 暫停顯示已加入。

入口：`dist/wifi-qa-lab.html` 或開發伺服器 `/`。數據皆為 SIMULATED。使用說明與驗證紀錄見 README 和 `validation.md`。

持續維護方向：依真實操作回饋增加故障情境、診斷證據與工作流，不因開發 Task 2 而移除原有功能。

## Task 2：Excel 繪圖與表格工具

目前交付 v1.3，名稱擴充為通用 Excel 繪圖與表格。既有矩陣選取、單曲線／TxBF ON／OFF、標題與曲線外觀、原生可編輯圖表匯出都保留。設定與圖表並排，可單獨捲動設定或使用放大固定預覽。

新增 Peak 結果表，預設 Band/Config、Channel、Direction、Gain Criteria、SU、MU、Gain 七欄，依每組配置／頻道與 UL／DL／BI 展開資料列。Gain 依使用者要求只手填，不提供任何自動計算或判定。可改欄名、順序、顯示、欄寬、標題、來源、單位及外觀，新增手填欄；匯出原生 Excel Table 結果或空白表。每份最多 1,000 方向列、20 欄，切換頁籤與停用方向會保留目前頁面上的資料。圖片 OCR 尚未加入。

入口：`dist/rvr-excel-tool.html`、開發伺服器 `/rvr-excel.html`、曲線範本 `docs/rvr-excel-template.xlsx` 及 Peak 範本 `docs/peak-results-template.xlsx`。既有檔名與網址保留。量測來源由使用者標示，與模擬器狀態及存檔分開。操作方式與推薦優化見 `rvr-excel-guide.md`。

優先優化：設定範本儲存／匯入、Peak 多列貼上／CSV 匯入、SVG／PNG 報告圖片匯出、表格截圖 OCR 與校對。Peak 的 Gain 維持只手填。
