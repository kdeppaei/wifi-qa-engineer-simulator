# Wi-Fi QA Engineer Simulator

可操作的繁體中文 Wi-Fi QA 虛擬實驗室。Tera Term、Windows CMD、AP、Attenuator 與 MSP 共用一個狀態引擎；所有 RF 和效能數值都是可重現的教學模擬，並非硬體量測。

![Wi-Fi QA 實測工作台](docs/ui-preview.png)

[驗證紀錄與里程碑狀態](docs/validation.md)

## 啟動

需要 Node.js 22 或更新版本，以及 pnpm 10.26+（建議 pnpm 11）。

```sh
pnpm install
pnpm dev
```

開啟終端機印出的本機網址，通常是 http://127.0.0.1:5173/ 。資料只保存在該瀏覽器、該 origin 的 localStorage。首次啟動使用 6 GHz／BN68_6G；虛擬測試金鑰 `qa-lab-2026` 是專案合成資料。

也提供免安裝版：`pnpm build` 會產生 `dist/wifi-qa-lab.html`。用 Chrome／Edge 直接開啟此單一 HTML，即可操作相同的共用模擬引擎；核心功能不需要網路或伺服器。線上字型無法載入時使用系統字型。`file://` 與本機 dev server 各有獨立的瀏覽器存檔；可透過 JSON 快照交換。

```sh
pnpm build
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm preview
```

Playwright 會啟動本機 dev server。已有相同版本 Chromium 時可省略 browser install。`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 可指定現有 Chromium 執行檔。

## 第一條完整工作流程

1. 開啟 Learning Center，選擇 Chapter 5。AP 改成 5 GHz／BN68；STA 保留 6 GHz 設定，會真實連線失敗。關閉教學視窗即可回到工作台。
2. 在 VT 查詢 `uci get wireless.stamld0.device`、`uci show wireless.stamld0`。錯誤的 SSID，例如 BN68_5G，無法關聯。依教材操作：

```sh
uci set wireless.stamld0.ssid='BN68'
uci -q delete wireless.stamld0.device
uci add_list wireless.stamld0.device='MT7999_1_2'
uci commit wireless
sync
wifi restart
```

3. 等待重新啟動、掃描與關聯，在 VT 執行：

```sh
iw dev stamld0 link
ip route get 192.168.1.200
bridge fdb show
ping -c 4 192.168.1.200
```

應看到 5180 MHz 和 Connected。單獨 Ping 成功不等於 Wi-Fi 路徑驗證；Topology 可啟用管理 Ethernet 繞行，MSP 會拒絕在該路徑作 Wi-Fi RvR。

4. AP TxBF ON，MSP 選 DL／TCP，Start Test。預設 Server 192.168.1.200:9002、20 streams、3 秒／點、0–60 dB、5 dB 正常步進；低吞吐時改為 1 dB。曲線逐點產生，完成後衰減器保留末值。Test Parameters 可改設定。
5. 恢復衰減起點。在 VT 切换本教材定義的 STA BF OFF：

```sh
uci set wireless.MT7999_1_2.etxbfencond=0
uci commit wireless
wifi restart
```

`uci get`、Committed、Driver Runtime 為不同層。在 Result Analyzer 可並排查看。等待 STA Connected。

6. **DL 的無線發送端是 AP**。在 AP Configuration 另把 AP Tx Beamforming 切到 OFF，再跑一次 DL，才會生成由 AP BF 條件分類的 ON/OFF 疊圖。只切換 STA 發送 BF，不會假冒 AP 的 DL 發送 BF 改變。UL 使用套用後的 STA BF。
7. 結果可匯出 CSV、原生可編輯 XLSX XY 疊圖、HTML/SVG 報告與測試 Log。每次 run 保存 AP、三層設定、Runtime、Band、發送端、Seed、Channel Width、流量參數。Result Analyzer 的曲線名稱可修改。
8. 測試進行時把 Attenuator 調到 90 dB，會使 STA 斷線、MSP 中断並保留已量測的點。Serial 控制連線仍可使用。
9. 在 VT 查 `iw dev stamld0 link`、`logread`、`wpa_cli -i stamld0 scan_results`；還原衰減起點後等待掃描、關聯，系統才逐步恢復。測試須自行重新 Start，原中斷 run 不會被覆寫。
10. 重新整理，設定、量測、Terminal VFS、操作歷史與教學進度仍在。儲存快照按鈕另下載 JSON；載入按鈕可恢復。正在跑的測試若重新整理，會標記中斷，避免杜撰頁面關閉期間的量測。

## 排錯任務

- Chapter 9：已 Commit 的設定保留，但 Reboot 後沒有網路；先看 link、Log 與 scan evidence，再檢查 RF 環境。提示分三層，第一層不揭示根因。
- Chapter 10：MSP Invocation Exception；透過 InnerException 排查 Server 與 Port，復原後完成 RvR。
- Guided、Practice、Troubleshooting 介面提供目標、操作證據與狀態回饋。所有章節有設備狀態／成功操作的驗收規則；Chapter 5、7、8、9、10 另外載入指定環境。Chapter 5 只接受完整且同條件的 5 GHz DL ON/OFF 比較，不接受單點或不同 Seed、頻寬、流量參數混搭。隨機故障組合、累積成績與完整敘事引導留待下一階段。

## 可操作功能與界線

- 桌面工具列、開始選單；視窗可拖曳、縮放、最大化、最小化、關閉及重新開啟。Native resize 位於浮動視窗右下角；拖動標題可使主工具浮動。提供基本淺色主題。
- Terminal 有歷史方向鍵、Tab 補完、Ctrl+C、Shift+Enter 多行；使用自製可測試的 parser，沒有連接主機 Shell。Linux、Windows CMD、wpa_cli 互動模式明確區分。
- Linux VFS、Pipe、redirect、變數、條件、bounded for/while、command substitution、基本算術。支援教材倒序 APCLI 清理腳本；未知或不支援語法會報錯。不是完整 Bash，沒有任意 host command 執行。
- UCI get/show/set/add/add_list/delete/rename/changes/commit，STA/AP 連線條件、RF、頻率、認證、PMF、IP 子網路、route、Bridge FDB、Counters、Server／Client。錯誤介面名称會失敗。
- RF 模型包括固定 path loss、衰減、SNR、MCS/NSS、PHY、packet loss／retry 影響、方向、BF、頻寬、parallel streams、種子與 Ethernet bottleneck。高衰減會同時影響 scan 與關聯；scan Busy 模擬來自 concurrent scans。
- 直接輸入 `iperf3` 產生依當下設備狀態計算的彙總模擬；有時間進程的多點自動化在 MSP。iperf JSON／interval streaming、完整 Linux networking、真實 OS／VM、xterm／Monaco、PowerShell 與真實硬體接入尚未實作。
- MT7999 Radio 名稱與 `etxbfencond=3/0`、`UHR240` 的使用依本教材教學假設；不宣稱通用 Vendor 語義。實際協商寬度與配置字串分開保存。

## 結構

```text
src/engine/lab.ts       共用狀態、RF／IP 模型、MSP runner
src/engine/terminal.ts  Shell AST、虛擬檔案系統、UCI／Windows 命令
src/engine/export.ts    CSV、OOXML XLSX native chart、HTML 報告
src/engine/scenario.ts  實際查詢證據與狀態驗收、可比較的 ON/OFF 條件
src/engine/storage.ts   快照驗證與損壞存檔防護
src/App.tsx            多視窗操作、GUI、Terminal、章節與保存
src/style.css          深色工作台、桌面及響應式介面
tests/lab.spec.ts       實際瀏覽器完整因果流程
docs/source-notes.md    兩份 PDF 全文研讀筆記、假設與驗收對照
```

所有 GUI 與命令都透過同一個 `LabEngine`。每秒更新模擬時間；固定 Seed 相同條件可重現。將來可把 engine 的控制操作轉接到 WebSocket／遠端設備，不需要讓 GUI 各自維護網路狀態。

原理核對：[OpenWrt UCI](https://openwrt.org/docs/techref/uci)、[ESnet iperf3](https://software.es.net/iperf/invoking.html)。教學資料來自使用者提供的《WiFi_QA_Field_Guide_Compressed.pdf》（38 頁）及《Ubuntu虛擬機使用iperf3.pdf》（6 頁故障對話），PDF 未上傳儲存庫。
