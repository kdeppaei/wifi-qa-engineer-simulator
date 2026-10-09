# v0.3 驗證紀錄

日期：2026-10-09。所有數值與設備均為模擬；本紀錄不是硬體 Wi-Fi QA 測試報告。

| 檢查                                                           | 結果                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict + Vite production build + standalone package | 通過                                                                                                                  |
| ESLint `--max-warnings 0`                                      | 通過，零警告                                                                                                          |
| Vitest                                                         | 93 個測試通過：Lab 20、Terminal 16、Exporter 6、Storage 6、Scenario 14、Workflow 13、RvrWorkflow 18                   |
| Playwright Chromium                                            | 最終 14 個完整瀏覽器案例全數通過，零 pageerror／JavaScript 例外；包含最新 build 與 standalone                         |
| XLSX native chart                                              | v0.3 瀏覽器下載由 openpyxl 核對四工作表、2 個 ScatterChart Series、原始點與 Metadata；格式先前另經 Artifact Tool 讀取 |
| 視覺 QA                                                        | 1440×1000 截圖已檢查：四工具、主要控制、即時狀態及故障 Log 可見                                                       |

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
11. 19 步完整 DL BF ON／OFF 比較保留舊 Run，拒絕改變 Seed，四格式只匯出指定比較組，重新整理後保留 Run ID 與進度。
12. 本輪 ON 在 90 dB 中斷時，不能借用先前完成的 ON 通過；恢復 RF 後仍保留部分點與中斷狀態，明確載入 RF 故障場景會清除 RvR 綁定。
13. Chapter 9 與自由實驗重置清除比較進度／Run ID 綁定，防止新現場重用編號後誤認為原比較組。
14. `file://` 封鎖 HTTP／HTTPS 後，可完成指定 ON／OFF DL 比較，下載含兩個原生 Series 的 Excel，核對低訊號下的 BF 差異，並在重新整理後恢復完成記錄。

v0.3 實際瀏覽器下載的讀取器檢查：ON／OFF 各 3 點，XLSX Measurements 與 CSV 各 7 列（含標題），HTML 有 6 個實際 SVG 點。原生圖表的數值快取、L／R 儲存格引用及型別逐點符合證據 Log 中的兩輪資料；AP、全部測試參數、三層設定、網路、Firmware／Model 與頻寬 Metadata 逐項相符，沒有其他 Run 混入。

最終修正的驗收包含多個 STA section 同時存在時，匯出欄位依共用引擎的實際 STA 優先序選擇 BF；完整 Run 的 Pending／Committed／Runtime 快照必須一致且符合該輪條件。單元、建置、完整 14 個瀏覽器案例均在這些修正後重新通過。

原生 Windows、Tera Term、OpenWrt、MT7999、MSP、AP 和衰減器皆未實際啟動或連接。未直接用 Microsoft Excel App 開啟 XLSX；格式曾經 openpyxl 與 Artifact Tool 讀取，本次工作流下載使用 openpyxl、原生 OOXML 關係及配套 CSV／HTML／Log 交互核對。

## v0.2 指令工作流的驗收範圍

v0.2 新增「逐步工作流」與「常用指令」頁籤，以及連線／流量方向、UCI BF 生命週期、6G → 5G APCLI 遷移、Reboot 後未連線排查四條流程，共 26 個常用指令。上表記錄目前版本的最終驗證結果，涵蓋原有功能與本次新增功能。

- 選擇或切換工作流不改變設備；只有明確執行儀器操作才變更共享狀態。載入故障場景會先提示清除目前量測。
- 「送入」只填寫 VT／CMD，編輯後手動 Enter 才執行；「執行本步」與手打使用同一終端解析器及共享引擎。
- 回饋同時檢查命令輸出與實際 Pending／Committed／Runtime、AP、STA、網路狀態；`echo` 指令名稱或沒有 stdout 不能單獨作為成功證據。
- 重啟與 RF 恢復由 restarting／scanning／associating／connected 的真實狀態與事件推進；不使用固定假成功倒數，不會替使用者修正錯誤 SSID 或認證。
- Windows 與 DUT 的命令、Server 角色、UL／DL 及 AP／STA 發送 BF 保持分流；需先退出 `wpa_cli` 互動模式、返回 Shell 才執行 Linux 指令。
- 已符合的 5G 配置需明確檢查才能略過；動態 Radio／Server 範本可明確更新，不覆蓋使用者正在編輯的內容。
- 工作流進度在重新整理後恢復，完成記錄表示過去的驗證。重練保留設備；載入實驗室快照或重置實驗室清除工作流進度。損壞工作流記錄不影響實驗室狀態。

![指令工作流與狀態回饋](workflow-preview.png)

## v0.3 完整 BF ON／OFF RvR 工作流的驗收範圍

第五條「完整 BF ON / OFF DL RvR 與匯出」提供 19 步操作；以下範圍已完成本次 v0.3 最終建置與回歸核對。

- 選流程不重置現場；準備操作僅指定 DL／TCP，保留 Band、AP、STA、Sweep／Seed／Server 參數和舊 Run。5 GHz 或 6 GHz 均可在同 Band 下比較。
- ON／OFF 開始時捕捉實際新 Run ID，等待只追蹤該 ID。完整 Run 必須含實際起點與終點、至少兩點、無中斷及繞行。
- DL BF 來源為 AP；兩輪間只允許 AP TxBF 不同。比較全部 Sweep／流量／Seed、AP、STA Pending／Committed／Runtime、NSS、配置／協商頻寬、Firmware／Model、Server IP／Port 與 Ethernet 瓶頸。
- OFF 前恢復指定 ON 的衰減起點並等待實際 Connected。控制條件改變時顯示具體差異；套用 ON 參數須明確操作，不會靜默重設 AP／STA 或網路。
- 自適應步進允許兩輪格點與點數不同；只保留原始點。中斷、遺失或不相容的 Run 不得替換成任意舊曲線或匯出正式比較。
- 工作流圖表與 CSV／XLSX／HTML／Log 只使用指定 ON／OFF 子集；原工作區與舊 Run 保留。Excel 的原生 XY 圖表應恰含兩個 Series，參照對應 Measurements 儲存格。
- 每次匯出實際產生 bytes 並送出瀏覽器下載，回饋格式、Run ID、點數與檔名；不宣稱已確認使用者本機的儲存位置。Metadata 完整保存在 XLSX、HTML 與證據 Log。
- Log 僅包含 ON 開始至 OFF 完成期間仍保留的現場事件，可能包含其他操作；工作區 3000 條事件上限不代表完整硬體 trace。
- 重跑 ON 清除其後的本流程驗證，重跑 OFF 清除比較／匯出驗證；重新整理恢復指定 Run 與進度，進行中的量測標記中斷。
- 明確重置設備的 Learning Center 場景會清除工作流進度；工作流內載入 RF 故障場景時，清除故障與 RvR 記錄／綁定。跨現場重用的 Run ID 不得被視為原比較組。

![完整 BF ON／OFF RvR 與匯出](rvr-workflow-preview.png)

## 里程碑狀態

| 里程碑        | 已可操作                                                      | 仍可擴充                                 |
| ------------- | ------------------------------------------------------------- | ---------------------------------------- |
| 1 桌面        | 多視窗、Tera Term、CMD、工具列及開始選單                      | 完整 Windows 外觀、PowerShell            |
| 2 Linux + UCI | bounded Shell、VFS、UCI 三層生命週期及教材腳本                | 完整 Bash、xterm、Monaco                 |
| 3 Wi-Fi       | AP／STA、認證、實際頻率、IP、Bridge／route／Counters          | 完整 Linux networking、真實硬體          |
| 4 RF 故障     | 0–90 dB、掃描與關聯失敗、逐步恢復及 MSP 中斷                  | 校準真實 RF／Driver 模型                 |
| 5 MSP         | 有時間進程的 Sweep、BF 方向、曲線、CSV／原生 Excel／HTML／Log | 真實 iperf streaming、Vendor MSP 精確 UI |
| 6 教學        | 章節驗收、五條工作流、完整 BF RvR 與匯出、指令選單及進度保存  | 隨機故障、累積成績、敘事與提示擴充       |

![虛擬工作台](ui-preview.png)
