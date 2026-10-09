# 本對話的兩項工作

## Task 1：Wi-Fi QA Engineer Simulator

目前交付 v0.3.1。Tera Term、AP、Attenuator、Windows CMD 和 MSP 共用模擬狀態，支援指令選單、逐步工作流、完整 BF ON／OFF DL RvR 及結果匯出。連線診斷、明確同步 STA／AP 重連、Serial 暫停顯示已加入。

入口：`dist/wifi-qa-lab.html` 或開發伺服器 `/`。數據皆為 SIMULATED。使用說明與驗證紀錄見 README 和 `validation.md`。

持續維護方向：依真實操作回饋增加故障情境、診斷證據與工作流，不因開發 Task 2 而移除原有功能。

## Task 2：MSP RvR Excel 繪圖工具

目前交付 v1.0。獨立輸入 dB／Mbps 兩欄，或 TxBF ON／OFF 共用三欄、各自兩欄；即時 XY 曲線預覽、同 dB 比較、CSV／TSV 匯入、Excel 原生可編輯曲線下載。另提供可直接貼入數據即更新圖表的空白 Excel 範本。每組最多 1,000 測點。

入口：`dist/rvr-excel-tool.html`、開發伺服器 `/rvr-excel.html`、`docs/rvr-excel-template.xlsx`。量測來源由使用者標示，與模擬器狀態及存檔分開。操作方式與推薦優化見 `rvr-excel-guide.md`。

優先優化：取得實際 MSP CSV 範例，支援廠商原始欄位和每輪測試條件；再加入重測統計與 Excel 內差值／增益公式。
