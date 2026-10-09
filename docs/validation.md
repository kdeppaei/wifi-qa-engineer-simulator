# MVP 驗證紀錄

日期：2026-10-09。所有數值與設備均為模擬；本紀錄不是硬體 Wi-Fi QA 測試報告。

| 檢查                                                           | 結果                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TypeScript strict + Vite production build + standalone package | 通過                                                                                       |
| ESLint `--max-warnings 0`                                      | 通過，零警告                                                                               |
| Vitest                                                         | 73 個測試通過：Lab 20、Terminal 16、Exporter 4、Storage 6、Scenario 14、Workflow 13        |
| Playwright Chromium                                            | 10 個完整瀏覽器案例通過，無 JavaScript 例外                                                |
| XLSX native chart                                              | 實際下載後解包檢查工作表／關係；獨立 openpyxl 及 Artifact Tool 讀取，保留原生 ScatterChart |
| 視覺 QA                                                        | 1440×1000 截圖已檢查：四工具、主要控制、即時狀態及故障 Log 可見                            |

瀏覽器案例覆蓋：

1. 6G→5G／錯誤 SSID 真實失敗／UCI staged、committed、runtime 分離／5180 MHz 關聯／Ping／ON/OFF RvR／XLSX 疊圖／90 dB 中斷與恢復／重新整理保存。
2. Linux 與 Windows 環境分流、VFS、方向鍵歷史、Tab、Ctrl+C、Clear、視窗最小化／最大化／關閉與恢復。
3. 損壞快照匯入不會部分改動實驗室；損壞 localStorage 安全回到初始狀態。
4. Chapter 9 不在 Driver／supplicant 初始訊息直接揭示衰減原因；`echo` 查詢名稱不算診斷證據；真實查詢後可以完成。
5. `file://` 單一 HTML 封鎖 HTTP／HTTPS 後，工作流選擇／送入指令／關閉面板後執行、終端機、RF 故障恢復、MSP、CSV／Excel 下載及 VFS／結果保存仍能運作。
6. 選工作流不重置現場；送入只填寫終端，包含關閉終端後重新開啟；UCI 三層生命週期、等待恢復及工作流進度保存。
7. VT／CMD 指令分流，與手打產生相同結果；`wpa_cli` 互動模式阻擋 Linux Shell 快捷，Windows 仍可使用。
8. 未知指令、`echo` 偽造成功字串、斷線與 iperf3 不可達均不會勾成成功。
9. 明確 AP 操作後 6G→5G 遷移與逐步恢復；已有效的 5G Runtime 可明確驗證略過重啟，設備狀態不變。
10. 故障流程先保留負面 link、空掃描與 NETWORK-NOT-FOUND 證據；恢復 readback 後實際經 scanning／associating／connected，再驗證 Ping。

原生 Windows、Tera Term、OpenWrt、MT7999、MSP、AP 和衰減器皆未實際啟動或連接。未直接用 Microsoft Excel App 開啟 XLSX；驗證以兩個獨立讀取器及原生 OOXML 關係為依據。

## v0.2 指令工作流的驗收範圍

新增「逐步工作流」與「常用指令」頁籤，以及連線／流量方向、UCI BF 生命週期、6G → 5G APCLI 遷移、Reboot 後未連線排查四條流程，共 26 個常用指令。上表為 v0.2 完整驗證結果，包含原有功能與本次新增功能。

- 選擇或切換工作流不改變設備；只有明確執行儀器操作才變更共享狀態。載入故障場景會先提示清除目前量測。
- 「送入」只填寫 VT／CMD，編輯後手動 Enter 才執行；「執行本步」與手打使用同一終端解析器及共享引擎。
- 回饋同時檢查命令輸出與實際 Pending／Committed／Runtime、AP、STA、網路狀態；`echo` 指令名稱或沒有 stdout 不能單獨作為成功證據。
- 重啟與 RF 恢復由 restarting／scanning／associating／connected 的真實狀態與事件推進；不使用固定假成功倒數，不會替使用者修正錯誤 SSID 或認證。
- Windows 與 DUT 的命令、Server 角色、UL／DL 及 AP／STA 發送 BF 保持分流；`wpa_cli` 互動模式需先退出 Shell 才執行 Linux 指令。
- 已符合的 5G 配置需明確檢查才能略過；動態 Radio／Server 範本可明確更新，不覆蓋使用者正在編輯的內容。
- 工作流進度在重新整理後恢復，完成記錄表示過去的驗證。重練保留設備；載入實驗室快照或重置實驗室清除工作流進度。損壞工作流記錄不影響實驗室狀態。

![指令工作流與狀態回饋](workflow-preview.png)

## 里程碑狀態

| 里程碑        | 已可操作                                                      | 仍可擴充                                 |
| ------------- | ------------------------------------------------------------- | ---------------------------------------- |
| 1 桌面        | 多視窗、Tera Term、CMD、工具列及開始選單                      | 完整 Windows 外觀、PowerShell            |
| 2 Linux + UCI | bounded Shell、VFS、UCI 三層生命週期及教材腳本                | 完整 Bash、xterm、Monaco                 |
| 3 Wi-Fi       | AP／STA、認證、實際頻率、IP、Bridge／route／Counters          | 完整 Linux networking、真實硬體          |
| 4 RF 故障     | 0–90 dB、掃描與關聯失敗、逐步恢復及 MSP 中斷                  | 校準真實 RF／Driver 模型                 |
| 5 MSP         | 有時間進程的 Sweep、BF 方向、曲線、CSV／原生 Excel／HTML／Log | 真實 iperf streaming、Vendor MSP 精確 UI |
| 6 教學        | 章節驗收、四條逐步工作流、常用指令、真實狀態回饋及進度保存    | 隨機故障、累積成績、敘事與提示擴充       |

![虛擬工作台](ui-preview.png)
