# 教材來源、模型假設與驗收依據

此文件記錄教材中的事實、需要保留的不確定性，以及模擬器的驗收方式。它不是實機 MT7999／MSP／TP-Link 的操作保證。功能是否已通過驗證，請以 README 的實作清單與測試結果為準；下列未勾選項目是驗收規格。

## 使用者要求與教材內容的界線

使用者最新要求優先完成 **Tera Term ↔ AP ↔ Attenuator ↔ MSP 的共同狀態與因果關係**。附圖是建議的介面配置，不是現成系統；圖上的命令結果與曲線數值是視覺示例。先做出可操作、可排錯的完整路徑，再擴充桌面外觀。

貼上的《Codex 專案開發指令：Wi-Fi QA Engineer Simulator》是使用者的開發規格，要求瀏覽器中的虛擬作業系統、共享網路狀態、可輸入終端機、UCI 三層狀態、RvR、資料匯出與教學驗收。PDF 裡的「請執行」、「先不要 reboot」等文字則是當時故事或對話中的現場指導，作為模擬情境與教學資料；不代表要求在使用者真正的電腦、網路或 DUT 上執行那些指令。

## 已完整閱讀的來源

| 來源                                 | 範圍與定位                                                           | 本專案用途                                                     |
| ------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `WiFi_QA_Field_Guide_Compressed.pdf` | 《從 6G 的疑問，走到 5G 的答案》，2026.10／Version 1.0，38 頁、18 章 | 拓樸、命令分類、UCI、APCLI、BF、UL/DL、RvR、事故復盤與報告 SOP |
| `Ubuntu虛擬機使用iperf3.pdf`         | 6 頁的故障排查對話與手冊交付紀錄                                     | `scan_results` 語境、空掃描結果、FAIL-BUSY、高衰減後恢復與前檢 |
| `使用者貼上的文字.txt`               | 使用者貼上的 15 節開發規格                                           | 技術架構、10 個教學章節、6 個里程碑、13 個最低驗收項目         |
| 使用者附圖與最新訊息                 | 四區儀表板配置與共享狀態優先順序                                     | 第一版介面與 90 dB 故障連動                                    |

第二份 PDF 的檔名雖含 Ubuntu 虛擬機與 iperf3，實際內容沒有 Ubuntu 安裝、VM 網卡設定或 iperf3 完整部署 SOP。第一版不能憑檔名補寫不存在的來源要求。

兩份 PDF 的純文字內容已全部閱讀。教材中的密碼、未辨識的照片字元與完整敏感腳本沒有公開；模擬器應使用自己的明示虛擬密碼，不猜測真實實驗室金鑰。

## 第一份 PDF 的章節工作流

| 原書章節／頁碼 | 要教會的判斷或操作                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------- |
| 1／p.4         | 從 6 GHz BF 曲線不理想，進入主管要求改測 5 GHz 的任務                                           |
| 2／pp.5–6      | Windows 控制／流量端、有線 AP、RF 路徑、MT7999 STA；把關聯、IP 可達、實際測試路徑分開           |
| 3／pp.7–8      | CMD、Linux、UCI、iw、wpa_cli、MSP、廠商參數屬於不同環境；裸 `scan_results` 不是 Shell 指令      |
| 4／pp.9–10     | `uci set` 待提交、`commit` 持久化、`wifi restart`／`reboot` 套用；設定值不等於實機 Runtime 佐證 |
| 5／pp.11–12    | 長 APCLI 腳本會刪除／建立 STA，不能當成每次改 BF 的工具；本案 Device 使用 list 結構             |
| 6／pp.13–14    | SSID 與 Radio 都要改；實際掃到的是 BN68、BN68_MLO，不是猜想的 BN68_5G                           |
| 7／pp.15–16    | 判讀 Connected、BSSID、5180 MHz、RSSI、MCS、NSS、160 MHz；PHY Rate 不等於 TCP 吞吐              |
| 8／pp.17–18    | DUT IP、route、Bridge member、ARP／FDB、傳輸期間 Counters 組合成路徑證據                        |
| 9／pp.19–20    | BF 控制對象與 UL/DL 發送端；正在測 5G 時不能只修改 6G 的 `_1_3`                                 |
| 10／pp.21–22   | iperf3 server/client、port、`-P`、`-t`、`-R`、TCP／UDP；方向依端點位置決定                      |
| 11／pp.23–24   | RvR 衰減步進、共同起點、固定變因、可重複性；藍／紅色必須搭配明確圖例                            |
| 12／pp.25–26   | reboot 後設定保留，STA 卻沒連上；高衰減、空掃描、忙碌掃描的事故復盤                             |
| 13／pp.27–28   | 相同 Radio 與初始化 SOP 的 ON／OFF；先存 ON、回起點、驗證 OFF 再跑；中斷和完整資料分開          |
| 14／pp.29–30   | MSP 外層 Exception 無法直接指認 DUT；保存當下點位、Log、InnerException、Server 與 RF 狀態       |
| 15／pp.31–32   | 共同 X/Y 軸、Raw Data、Run 與組態、reload 條件、證據；不要把推論寫成實際讀值                    |
| 16／pp.33–34   | 四週練習與十道自我確認題；先提出假設，再選最小範圍查詢                                          |
| 17／pp.35–36   | 依用途區分唯讀查詢與變更命令，保留本案 IP／Radio 適用範圍                                       |
| 18／pp.37–38   | 開工、ON→OFF、收工；保留資料、衰減器回起點、記錄最後 BF 與未解決問題                            |

開發規格的 Chapter 1–10 是重新編排的教學關卡，不能把它們與原書 Chapter 1–18 當成同一編號。例如使用者的 Chapter 5「從 6G 改成 5G」主要對應原書第 6 章；使用者的 Chapter 9 排錯任務主要對應原書第 12 章與第二份 PDF。

## 本教材實驗室的預設識別值

| 項目          | 本案值                                                                  | 解讀限制                                                                  |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| DUT           | MediaTek MT7999、OpenWrt、STA/APCLI `stamld0`                           | Tera Term 是串列控制窗口，不是另一台流量設備                              |
| Radio         | `MT7999_1_1` = 2.4 GHz／CH6；`_1_2` = 5 GHz／CH36；`_1_3` = 6 GHz／CH37 | 教材機台的命名，非所有 MediaTek／OpenWrt 通則                             |
| 5 GHz AP      | BN68、5180 MHz、案例 BSSID `02:ff:00:2d:e3:63`                          | 頻段由實際頻率判定；SSID 名稱與同名 AP 無法單獨證明目標設備               |
| 原 6 GHz STA  | `BN68_6G`、`MT7999_1_3`                                                 | 重貼原始建立腳本會覆蓋改好的 5 GHz 設定                                   |
| DUT IP        | `192.168.1.5`，另見 `192.168.88.5` 位於 br-lan                          | 有 IP 不代表無線出口正確                                                  |
| iperf3 Server | `192.168.1.200`、port `9002`                                            | 是案例預設；必須檢查實際 server/client 位置、Listen 與 port 是否一致      |
| BF 標籤       | `etxbfencond=3` = ON、`0` = OFF                                         | 教材 SOP 標籤；不推斷 MTK 枚舉的其他位元、模式或協商含義                  |
| 認證          | `encryption=sae`、`ieee80211w=2`                                        | WPA3-Personal 與 required PMF；需與 AP 相容                               |
| 頻寬          | UCI 有 `UHR240`；連線快照是 160 MHz                                     | 保留 Config 與 Negotiated/Actual 兩個欄位；不把字串直接當成已協商 240 MHz |

本案 6G→5G 的原始變更片段應能在虛擬 DUT 中操作：

```sh
uci set wireless.stamld0.ssid='BN68'
uci -q delete wireless.stamld0.device
uci add_list wireless.stamld0.device='MT7999_1_2'
uci commit wireless
sync
wifi restart
```

Device 的 delete + add_list 是本案受控腳本結構。其他 OpenWrt 設備可能使用一般 option，不能把 list 寫法泛化成所有韌體的標準。

## iperf3 方向與 BF 控制側

預設 iperf3 是 client 傳送資料，`-R` 使 server 傳送。UL/DL 是相對無線鏈路，而不是相對「目前哪個窗口打指令」。

| Client 位置     | Server 位置          | 不加 `-R`             | 加 `-R`               |
| --------------- | -------------------- | --------------------- | --------------------- |
| DUT STA         | 有線 Windows／Server | STA → AP → 有線端，UL | 有線端 → AP → STA，DL |
| 有線 Windows PC | DUT STA              | 有線端 → AP → STA，DL | STA → AP →有線端，UL  |

依原書第 10 章，STA 端 client 的 DL 示例為：

```sh
# 有線 Server 端
iperf3 -s -p 9002 -i 1 -f m
# DUT STA client；-R 令有線 Server 發送，是 DL
iperf3 -c 192.168.1.200 -p 9002 -P 20 -t 60 -i 1 -f m -R
```

`-P 20` 是 20 條平行串流，不是 20 秒；`-t 60` 才是時長。UDP lost 是端點看到的 IP 封包遺失，不能直接等同 Wi-Fi Driver 的 PER。Ping 成功也不能證明 TCP `9002` 正在 Listen。

DL 的無線發送端是 AP，因此本模型的 DL BF 效果應來自 AP 的 TxBF 控制；UL 的無線發送端是 STA，因此 UL 才使用 DUT Runtime BF。教材只改 STA UCI 的 DL A/B 可以標記為「依 STA UCI 設定分類」，但它本身不能證明 AP 的 DL BF 開關已變更。若模擬器另外提供「配對 AP BF」操作，必須明示它是模擬實驗控制，不宣稱 `uci set` 自動控制真實 AP。

## 共同狀態必須保存的因果關係

1. `uci get` 讀到 pending 疊加在 committed 的設定；`uci changes` 可看到尚未提交變更。`commit` 寫入 committed，但不立刻變更 Runtime。Runtime 在模擬的 reload／boot 流程後才更新。真正 Driver 行為仍需實機文件或 SOP。
2. AP 電源、頻段、SSID、認證、RF 可見性均會影響候選網路與 STA 關聯。錯誤 SSID 在 RF 良好時可能仍掃得到 AP；「掃得到 AP」與「設定匹配」要分開。
3. 衰減器改值會改變 RSSI／SNR、MCS、重傳與吞吐。90 dB 在本場景超出連線／掃描裕度，所以 STA 斷線、MSP 中斷，Log 顯示找不到候選網路。這是本場景的模型門檻，不是所有設備都在同一 dB 斷線。
4. 重啟 DUT 不會把獨立衰減器歸零。已提交 UCI 仍保留，RF 條件仍差；重貼腳本不能消除高衰減。
5. 回到起始值後，STA 經掃描、認證與關聯逐步恢復；不是所有窗口各自立即印出 Connected。MSP 中斷後保留結果與原因，重新前檢再啟動。
6. 手動 scan 與背景 scan 重疊才回 Resource busy／FAIL-BUSY。高衰減可以導致背景反覆掃描，使兩者同時出現；不能把 FAIL-BUSY 定義成「衰減器故障」。
7. Serial 控制、管理網路與測試資料路徑分開。可用管理或有線繞行成功 ping，同時無線路徑仍然故障；MSP 應拒絕把 bypass 的吞吐當成有效 Wi-Fi RvR。
8. RvR 用時間逐点推進，點位受目前設備狀態影響。尚未量到或中斷的點不能自動填成 0；已測到的近零吞吐與缺值需分辨。

第二份 PDF 提供的排查鏈是：衰減器讀值 → STA link／scan → IP ping → iperf3 → RvR。文件中曾把多種症狀歸於這次衰減器事件；模擬器應保留「本次原因」與「通用錯誤定義」的差別。`NETWORK-NOT-FOUND` 只證明當下沒有合適候選，仍可能是 AP 關機、頻段／SSID 不符或 RF 不可見。

## 模擬模型的範圍與限制

- 所有終端機、網路封包、讀值、BF 效果、Log、MSP 結果都是瀏覽器中的模擬。沒有執行真實 Windows／Linux VM，也沒有連線到真實 AP、DUT、衰減器或 iperf3 程序。
- RSSI 可由基準 RF 訊號減去可調衰減與固定路徑損耗求得；0 dB 僅代表額外可調衰減為零。SNR 需要假設 noise floor，不能由 RSSI 單獨得到實測 SNR。
- MCS、PHY Rate、PER／Retries、TCP 效率與 BF 增益是可重複的簡化模型，並非 MT7999 晶片校準曲線、完整 IEEE PHY 模擬或實機性能預測。要在介面／匯出 metadata 明示「模擬資料」。
- 有線 Backhaul 上限應截斷吞吐，避免設定 1 Gbps 有線端仍產生超過容量的 TCP 結果。PHY Rate 與 TCP Throughput 保持不同值。
- 相同 seed、相同點位及完整組態可重現結果。只存 seed、不存 AP／STA Runtime、方向、頻寬、NSS、Server、步進與起始環境，不足以重現整輪測試。
- BF 可以在某些區間改善有效 SNR，但不應保證 ON 在每一個衰減點必定高於 OFF。兩條曲線重合也可能是有線瓶頸或 BF 控制側不變，不能宣稱 BF 無效。
- Browser Shell 僅支援明列的教材子集。未知命令、未知語法或錯誤參數需要合理報錯，不能假裝執行成功。不要以 JavaScript `eval` 或宿主 Shell 執行使用者輸入。
- 虛擬 FDB／Counters 是共用拓樸模型產生的證據，沒有真實封包擷取／硬體卸載。介面可用它們教判斷，不能當成實機證明。
- MSP 外層 invocation exception 是故障情境的呈現；真正 .NET 工具的 InnerException、Stack Trace 與診斷仍需實際現場資料。模擬器不冒充原廠 MSP，也不杜撰 Vendor 內部實作。

## 核心端到端驗收清單

驗收應由設備狀態、變更原因與操作結果判定，不能只比對是否輸入指定字串。等價的合理操作可通過。

- [ ] 從桌面開啟 Tera Term；初始 `uci get wireless.stamld0.device`／`.ssid` 可讀到 6 GHz 配置。
- [ ] 在 VT 用 UCI 改為 `MT7999_1_2`；pending／committed／Runtime 的狀態在 commit、restart 前後可區分。
- [ ] 套用 `BN68_5G` 時關聯失敗；RF 良好且掃描完成時仍可列出 AP 廣播的 `BN68`。
- [ ] 修正 `BN68`、套用並等待後，link 顯示 Connected／BSSID／5180 MHz。
- [ ] VT／CMD 中 Ping 有合理結果；控制端位置及 bypass 情境不會被誤算為已證實 Wi-Fi 測試路徑。
- [ ] MSP 前檢確認 STA、Server IP／Listen／Port、Wi-Fi 路徑、方向、起始衰減、實際 BF 控制側。
- [ ] BF ON DL RvR 隨時間新增資料點；曲線依實際衰減、模型、seed 與設備狀態更新。
- [ ] ON 資料先保存；OFF 使用相同 Radio、reload SOP、流量組態與起始值，另存完整結果。
- [ ] AP 與 STA 的 BF 控制分開；只改 STA Runtime 時不自動改變 AP 的 DL BF。
- [ ] 可匯出 ON／OFF CSV、含 metadata 的 Excel 與疊圖；藍 ON／紅 OFF 搭配可辨識圖例，原始資料不被覆蓋。
- [ ] 手動設 90 dB 或讓 sweep 留在高衰減後，Tera Term link、AP clients、MSP、Log 共同反映斷線。
- [ ] 高衰減時 reboot 保留 committed UCI 且仍無法連線；Log 能提供 NETWORK-NOT-FOUND 等證據。
- [ ] 背景掃描進行時手動 scan 合理回 Busy；裸 Shell `scan_results` 合理報錯，wpa_cli 單行／互動模式可區分。
- [ ] 把衰減器回到共同起點後經掃描／關聯逐步恢復；不用重建 APCLI 或修改已正確的 BF OFF 設定。
- [ ] MSP 測試中拔掉資料路徑、關 AP、改 port 或升高衰減會中斷；保留現場、已測點、原因與 Log。
- [ ] Refresh 後恢復組態、結果、seed、進度；未完成測試合理標示為中斷，不假裝計時器在背景繼續完成。

## 延伸功能驗收

- [ ] Shell 檔案系統、pipe、grep、變數、條件與迴圈依已公開支援範圍操作持久狀態。
- [ ] UCI add／add_list／delete／rename／匿名索引與多行原書腳本按支援範圍驗證。
- [ ] CMD 與 OpenWrt 未安裝的對方命令產生正確環境錯誤，不回傳虛構成功。
- [ ] Guided、Practice、Troubleshooting 各有適當提示層級；故障關卡初始不直接揭露答案。
- [ ] 實驗室快照、重設關卡、結果分析、測試報告與操作歷史可用。
- [ ] 拖曳、縮放、最小化、最大化、關闭、焦點、主题與工作列可操作。
- [ ] 隨機故障包含 SSID、頻段、認證、RF、Server、Port、IP、Runtime 未套用與 Bridge bypass。

最後四項的完整度應如實列於 README 的里程碑清單，不能用入口圖示或靜態卡片宣稱功能完成。
