# 本對話的兩項工作

## Task 1：Wi-Fi QA Engineer Simulator

目前交付 v0.3.1。Tera Term、AP、Attenuator、Windows CMD 和 MSP 共用模擬狀態，支援指令選單、逐步工作流、完整 BF ON／OFF DL RvR 及結果匯出。連線診斷、明確同步 STA／AP 重連、Serial 暫停顯示已加入。

入口：`dist/wifi-qa-lab.html` 或開發伺服器 `/`。數據皆為 SIMULATED。使用說明與驗證紀錄見 README 和 `validation.md`。

持續維護方向：依真實操作回饋增加故障情境、診斷證據與工作流，不因開發 Task 2 而移除原有功能。

## Task 2：MSP RvR Excel 繪圖工具

目前交付 v1.2。獨立輸入 dB／Throughput 或直接貼上 MSP 數值矩陣，預設擷取左上方第一組數據；可按欄或按列選 X／Y、指定起訖範圍、改寫欄名與座標軸。圖表大標題、曲線名稱、配色、線型、線寬、測點形狀／大小、圖例及格線均可自訂並帶到原生 Excel；Excel 改 A2 更新圖表標題、改 B6／E6 更新圖例，也可編輯 SERIES 來源與原生格式。支援 TxBF ON／OFF 共用三欄或各自兩欄、即時 XY 預覽、同 dB 比較、CSV／TSV 匯入。範本及下載檔沒有工作表／圖表保護，取消凍結窗格、顯示格線。每組最多 1,000 測點。圖片 OCR 尚未加入。

入口：`dist/rvr-excel-tool.html`、開發伺服器 `/rvr-excel.html`、`docs/rvr-excel-template.xlsx`。量測來源由使用者標示，與模擬器狀態及存檔分開。操作方式與推薦優化見 `rvr-excel-guide.md`。

優先優化：圖表設定儲存／匯入、SVG／PNG 報告圖片匯出、表格截圖 OCR 與校對、實際 MSP 報表區塊與測試條件辨識；再加入重測統計與 Excel 內差值／增益公式。
