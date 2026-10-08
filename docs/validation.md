# MVP 驗證紀錄

日期：2026-10-09。所有數值與設備均為模擬；本紀錄不是硬體 Wi-Fi QA 測試報告。

| 檢查                                                           | 結果                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TypeScript strict + Vite production build + standalone package | 通過                                                                                       |
| ESLint `--max-warnings 0`                                      | 通過，零警告                                                                               |
| Vitest                                                         | 60 個測試通過：Lab 20、Terminal 16、Exporter 4、Storage 6、Scenario 14                     |
| Playwright Chromium                                            | 5 個完整瀏覽器案例通過，無 JavaScript 例外                                                 |
| 最後排版調整後                                                 | 重新驗證完整 6G→5G 工作流程與離線版，2 個案例通過                                          |
| XLSX native chart                                              | 實際下載後解包檢查工作表／關係；獨立 openpyxl 及 Artifact Tool 讀取，保留原生 ScatterChart |
| 視覺 QA                                                        | 1440×1000 截圖已檢查：四工具、主要控制、即時狀態及故障 Log 可見                            |

瀏覽器案例覆蓋：

1. 6G→5G／錯誤 SSID 真實失敗／UCI staged、committed、runtime 分離／5180 MHz 關聯／Ping／ON/OFF RvR／XLSX 疊圖／90 dB 中斷與恢復／重新整理保存。
2. Linux 與 Windows 環境分流、VFS、方向鍵歷史、Tab、Ctrl+C、Clear、視窗最小化／最大化／關閉與恢復。
3. 損壞快照匯入不會部分改動實驗室；損壞 localStorage 安全回到初始狀態。
4. Chapter 9 不在 Driver／supplicant 初始訊息直接揭示衰減原因；`echo` 查詢名稱不算診斷證據；真實查詢後可以完成。
5. `file://` 單一 HTML 封鎖 HTTP／HTTPS 後，終端機、RF 故障恢復、MSP、CSV／Excel 下載及 VFS／結果保存仍能運作。

原生 Windows、Tera Term、OpenWrt、MT7999、MSP、AP 和衰減器皆未實際啟動或連接。未直接用 Microsoft Excel App 開啟 XLSX；驗證以兩個獨立讀取器及原生 OOXML 關係為依據。

## 里程碑狀態

| 里程碑        | 已可操作                                                      | 仍可擴充                                 |
| ------------- | ------------------------------------------------------------- | ---------------------------------------- |
| 1 桌面        | 多視窗、Tera Term、CMD、工具列及開始選單                      | 完整 Windows 外觀、PowerShell            |
| 2 Linux + UCI | bounded Shell、VFS、UCI 三層生命週期及教材腳本                | 完整 Bash、xterm、Monaco                 |
| 3 Wi-Fi       | AP／STA、認證、實際頻率、IP、Bridge／route／Counters          | 完整 Linux networking、真實硬體          |
| 4 RF 故障     | 0–90 dB、掃描與關聯失敗、逐步恢復及 MSP 中斷                  | 校準真實 RF／Driver 模型                 |
| 5 MSP         | 有時間進程的 Sweep、BF 方向、曲線、CSV／原生 Excel／HTML／Log | 真實 iperf streaming、Vendor MSP 精確 UI |
| 6 教學        | 章節目標、狀態與證據驗收、指定故障場景、完整主要流程          | 隨機故障、累積成績、敘事與提示擴充       |

![實測工作台](ui-preview.png)
