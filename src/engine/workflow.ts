import { bandForRadio, radioForBand, type LabState } from './lab';
import { observeCommand } from './scenario';
import { evaluateRvrStep, RVR_FLOW_ID, RVR_STEP_IDS } from './rvrWorkflow';
import type { RvrExportReceipt, RvrWorkflowActionId, RvrWorkflowCriterion } from './rvrWorkflow';

export type CommandText = string | ((state: LabState) => string);
export type WorkflowActionId =
  | 'configure-ap-5g'
  | 'restore-attenuation'
  | 'set-attenuation-90'
  | 'setup-rf-fault'
  | 'ap-bf-on'
  | 'ap-bf-off'
  | RvrWorkflowActionId;
export type WorkflowCriterion =
  | 'link-observed'
  | 'link-connected'
  | 'link-5g'
  | 'ip-assigned'
  | 'pc-ip'
  | 'server-ping'
  | 'server-listening'
  | 'iperf-ul'
  | 'iperf-dl'
  | 'uci-sta-query'
  | 'uci-bf-query'
  | 'bf-pending-off'
  | 'bf-pending-read-off'
  | 'bf-committed-off'
  | 'bf-committed-read-off'
  | 'bf-restart'
  | 'bf-connected-off'
  | 'ap-5g'
  | 'ssid-5g-staged'
  | 'device-5g-staged'
  | 'config-5g-committed'
  | '5g-restart'
  | '5g-connected'
  | 'fault-setup'
  | 'fault-visible'
  | 'scan-empty'
  | 'log-query'
  | 'attenuation-restored'
  | 'rf-connected'
  | RvrWorkflowCriterion;
export interface CommandShortcut {
  id: string;
  label: string;
  os: 'linux' | 'windows';
  command: CommandText;
  description: string;
  expected: string;
  requiresShell?: boolean;
}
interface StepBase {
  id: string;
  title: string;
  explanation: string;
  observe: string;
  expected: string;
  criterion: WorkflowCriterion;
  skipWhenSatisfied?: boolean;
}
export type WorkflowStep = StepBase &
  (
    | { kind: 'command'; os: 'linux' | 'windows'; command: CommandText; requiresShell?: boolean }
    | { kind: 'action'; action: WorkflowActionId }
    | { kind: 'wait' }
  );
export interface Workflow {
  id: string;
  title: string;
  description: string;
  steps: WorkflowStep[];
}
export interface WorkflowAttempt {
  command?: string;
  output?: string;
  os?: 'linux' | 'windows';
  action?: WorkflowActionId;
  startedAt?: number;
  exitCode?: number;
  runId?: string;
  onRunId?: string;
  offRunId?: string;
  exportReceipt?: RvrExportReceipt;
  error?: string;
}
export interface WorkflowFeedback {
  status: 'ready' | 'waiting' | 'success' | 'failure';
  message: string;
  hint?: string;
  evidence: string[];
}

function station(
  state: LabState,
  layer: 'runtime' | 'uci' | 'committed' = 'runtime',
): { prefix: string; radio: string; values: Record<string, string> } {
  const values =
    layer === 'runtime'
      ? state.config.runtime
      : layer === 'committed'
        ? state.config.committed
        : { ...state.config.committed, ...state.config.staged };
  const sections = Object.keys(values)
    .filter((key) => key.endsWith('.mode') && key.startsWith('wireless.') && values[key] === 'sta')
    .map((key) => key.slice(0, -5));
  const prefix =
    sections.find((key) => key === 'wireless.stamld0') ??
    sections.find((key) => values[`${key}.ifname`] === 'stamld0') ??
    sections[0] ??
    'wireless.stamld0';
  return {
    prefix,
    radio: (values[`${prefix}.device`] ?? radioForBand(state.ap.band))
      .replace(/["']/g, '')
      .split(/\s+/)[0],
    values,
  };
}
const bfKey = (state: LabState, layer: 'runtime' | 'uci' = 'runtime'): string =>
  `wireless.${station(state, layer).radio}.etxbfencond`;
const pingCommand = (state: LabState): string => `ping -c 4 ${state.network.serverIp}`;
const iperfCommand = (state: LabState, reverse = false): string =>
  `iperf3 -c ${state.network.serverIp} -p ${state.network.serverPort} -P 4 -t 3 -f m${reverse ? ' -R' : ''}`;
export function resolveCommand(item: { command: CommandText }, state: LabState): string {
  return typeof item.command === 'function' ? item.command(state) : item.command;
}

const shortcutDefinitions: CommandShortcut[] = [
  {
    id: 'vt-link',
    label: 'STA 關聯狀態',
    os: 'linux',
    command: 'iw dev stamld0 link',
    description: '讀取實際關聯、頻率與 PHY。',
    expected: 'Connected 或 Not connected；PHY 不等於吞吐。',
  },
  {
    id: 'vt-iwconfig',
    label: 'Wi-Fi 摘要',
    os: 'linux',
    command: 'iwconfig',
    description: '比較 ESSID、Access Point 與 Signal。',
    expected: 'stamld0 的目前無線狀態。',
  },
  {
    id: 'vt-wpa-status',
    label: 'WPA 狀態',
    os: 'linux',
    command: 'wpa_cli -i stamld0 status',
    description: '查看掃描、認證或完成狀態。',
    expected: 'wpa_state=COMPLETED 才代表關聯完成。',
  },
  {
    id: 'vt-scan-results',
    label: '掃描結果',
    os: 'linux',
    command: 'wpa_cli -i stamld0 scan_results',
    description: '讀取已取得的候選 AP 清單。',
    expected: 'BSSID、頻率與 SSID；只剩標題代表沒有可列出的候選。',
  },
  {
    id: 'vt-scan',
    label: '請求掃描',
    os: 'linux',
    command: 'wpa_cli -i stamld0 scan',
    description: '送出掃描請求，稍後再看 scan_results。',
    expected: 'OK 或 FAIL-BUSY；忙碌不等於晶片故障。',
  },
  {
    id: 'vt-log',
    label: '近期 Wi-Fi Log',
    os: 'linux',
    command: "logread | grep -Ei 'stamld0|wpa|ssid|auth|fail' | tail -40",
    description: '保留關聯與失敗證據。',
    expected: '事件順序比單一錯誤字串更有用。',
  },
  {
    id: 'vt-uci-sta',
    label: 'APCLI 設定',
    os: 'linux',
    command: (state) => `uci show ${station(state, 'uci').prefix}`,
    description: '查看 UCI 的 STA 設定，可能仍有待提交值。',
    expected: 'Device、SSID、加密；這不是 Driver Runtime。',
  },
  {
    id: 'vt-bf-config',
    label: 'BF 設定值（UCI）',
    os: 'linux',
    command: (state) => `uci get ${bfKey(state, 'uci')}`,
    description: '按 UCI 目前綁定的 Radio 查詢配置。',
    expected: '案例 SOP：3=ON、0=OFF；尚不能證明 Runtime 已套用。',
  },
  {
    id: 'vt-bf-active-radio',
    label: '運行 Radio 的 BF 配置',
    os: 'linux',
    command: (state) => `uci get ${bfKey(state)}`,
    description: '依正在運行的 STA Radio 選 Key；輸出仍是 UCI 配置值。',
    expected: '與 BF 設定值比較，辨認綁定變更尚未重啟的情形。',
  },
  {
    id: 'vt-bf-off',
    label: '暫存 STA BF OFF',
    os: 'linux',
    command: (state) => `uci set ${bfKey(state)}=0`,
    description: '只寫入 Pending，不會立刻改 Driver。',
    expected: '通常沒有 stdout；檢查 Pending 與 Runtime。',
  },
  {
    id: 'vt-bf-on',
    label: '暫存 STA BF ON',
    os: 'linux',
    command: (state) => `uci set ${bfKey(state)}=3`,
    description: '按運行 Radio 暫存本案例的 ON 值。',
    expected: '之後仍需 commit 與一致的初始化方式。',
  },
  {
    id: 'vt-commit',
    label: '提交 Wireless',
    os: 'linux',
    command: 'uci commit wireless',
    description: '保存 Wireless，Driver Runtime 暫時不變。',
    expected: 'Pending 清除、Committed 更新。',
  },
  {
    id: 'vt-restart',
    label: '重新啟動 Wi-Fi',
    os: 'linux',
    command: 'wifi restart',
    description: '載入已提交配置並重新掃描、認證。',
    expected: '需等 restarting → scanning → associating → connected。',
  },
  {
    id: 'vt-reboot',
    label: '重新啟動 DUT',
    os: 'linux',
    command: 'reboot',
    description: '按 SOP 重新初始化；未提交變更會被捨棄。',
    expected: 'Serial 保留，等待開機與關聯。',
  },
  {
    id: 'vt-ip',
    label: 'DUT IPv4',
    os: 'linux',
    command: 'ip -4 addr show br-lan',
    description: '確認 Bridge 位址。',
    expected: '有 IPv4 不等於 Server 可達。',
  },
  {
    id: 'vt-route',
    label: 'Server 路由',
    os: 'linux',
    command: (state) => `ip route get ${state.network.serverIp}`,
    description: '查看邏輯介面與來源位址。',
    expected: 'br-lan 仍需搭配 FDB 與 Counters 確認實體路徑。',
  },
  {
    id: 'vt-fdb',
    label: 'Bridge FDB',
    os: 'linux',
    command: 'bridge fdb show br br-lan',
    description: '辨認流量出口。',
    expected: '檢查 stamld0 與可能的 eth2 管理繞行。',
  },
  {
    id: 'vt-counters',
    label: 'Wi-Fi Counters',
    os: 'linux',
    command: 'ip -s link show stamld0',
    description: '比較測試前後封包計數。',
    expected: 'Wi-Fi 測試流量應增加 stamld0 bytes。',
  },
  {
    id: 'vt-ping',
    label: 'Ping 有線 Server',
    os: 'linux',
    command: pingCommand,
    description: '由 DUT 驗證 IP 連通。',
    expected: '0% loss 後仍需排除 Ethernet 繞行。',
  },
  {
    id: 'vt-iperf-ul',
    label: 'iperf3 UL',
    os: 'linux',
    command: (state) => iperfCommand(state),
    description: 'DUT 是 Client，預設 STA → AP。',
    expected: 'Wireless direction: UL，路徑 stamld0。',
  },
  {
    id: 'vt-iperf-dl',
    label: 'iperf3 DL',
    os: 'linux',
    command: (state) => iperfCommand(state, true),
    description: 'DUT Client 加 -R，AP → STA。',
    expected: 'Wireless direction: DL；AP 是發送端。',
  },
  {
    id: 'cmd-ip',
    label: 'PC 網路設定',
    os: 'windows',
    command: 'ipconfig',
    description: '辨認 QA PC 的 Ethernet 位址。',
    expected: 'PC 使用 Ethernet；DUT Wi-Fi 從 Tera Term 查。',
  },
  {
    id: 'cmd-ping',
    label: 'PC Ping DUT',
    os: 'windows',
    command: (state) => `ping -n 4 ${state.network.dutIp}`,
    description: '由 PC 確認 DUT 可達。',
    expected: 'Reply from DUT，仍須核對流量路徑。',
  },
  {
    id: 'cmd-server',
    label: 'PC iperf3 Server',
    os: 'windows',
    command: (state) => `iperf3 -s -p ${state.msp.settings.port} -i 1 -f m`,
    description: '在有線 PC 啟動 MSP 設定埠的 Server。',
    expected: 'Server listening；Client 必須使用相同 IP 與 Port。',
  },
  {
    id: 'cmd-iperf-dl',
    label: 'PC Client DL',
    os: 'windows',
    command: (state) =>
      `iperf3 -c ${state.network.dutIp} -p ${state.network.dutServerPort} -P 4 -t 3 -f m`,
    description: '需先在 DUT 啟動 iperf3 Server。PC Client 預設 DL。',
    expected: 'Wireless direction: DL；Connection refused 代表需檢查 DUT listener。',
  },
  {
    id: 'cmd-iperf-ul',
    label: 'PC Client UL',
    os: 'windows',
    command: (state) =>
      `iperf3 -c ${state.network.dutIp} -p ${state.network.dutServerPort} -P 4 -t 3 -f m -R`,
    description: '需 DUT Server；PC Client 加 -R 為 UL。',
    expected: 'Wireless direction: UL。',
  },
];
export const commandShortcuts: CommandShortcut[] = shortcutDefinitions.map((item) => ({
  ...item,
  requiresShell: item.os === 'linux',
}));

const commandStep = (
  id: string,
  title: string,
  command: CommandText,
  criterion: WorkflowCriterion,
  explanation: string,
  observe: string,
  expected: string,
  os: 'linux' | 'windows' = 'linux',
  skipWhenSatisfied = false,
): WorkflowStep => ({
  id,
  title,
  kind: 'command',
  os,
  command,
  criterion,
  explanation,
  observe,
  expected,
  requiresShell: os === 'linux',
  skipWhenSatisfied,
});
const waitStep = (
  id: string,
  title: string,
  criterion: WorkflowCriterion,
  explanation: string,
  observe: string,
  expected: string,
): WorkflowStep => ({ id, title, kind: 'wait', criterion, explanation, observe, expected });
const actionStep = (
  id: string,
  title: string,
  action: WorkflowActionId,
  criterion: WorkflowCriterion,
  explanation: string,
  observe: string,
  expected: string,
): WorkflowStep => ({
  id,
  title,
  kind: 'action',
  action,
  criterion,
  explanation,
  observe,
  expected,
});

export const workflows: Workflow[] = [
  {
    id: 'connection-direction',
    title: '連線與流量方向基礎',
    description: '分開確認關聯、IP、Server 與 UL / DL；選擇流程不會重置現場。',
    steps: [
      commandStep(
        'connection-link',
        '先確認 STA 關聯',
        'iw dev stamld0 link',
        'link-connected',
        'Serial 只是控制通道。先看真正的 Wi-Fi 關聯。',
        'Connected、SSID、頻率；Not connected 時先保留現象。',
        'STA 已關聯預期 AP。',
      ),
      commandStep(
        'connection-ip',
        '確認 DUT 的 IPv4',
        'ip -4 addr show br-lan',
        'ip-assigned',
        '關聯成功後才檢查 IP 層。',
        'br-lan 的 inet 位址與 Server 子網。',
        'DUT 的目前 IPv4 有出現在輸出。',
      ),
      commandStep(
        'connection-pc-ip',
        '辨認 PC 網路',
        'ipconfig',
        'pc-ip',
        'Windows CMD 操作 QA PC，Tera Term 操作 DUT。',
        'Ethernet IPv4；Windows 本身沒有這張 DUT Wi-Fi。',
        'PC 的目前 IPv4 有出現在輸出。',
        'windows',
      ),
      commandStep(
        'connection-server',
        '在 PC 啟動 Server',
        (state) => `iperf3 -s -p ${state.msp.settings.port} -i 1 -f m`,
        'server-listening',
        'Client 與 Server 必須使用同一埠。',
        'Server listening 與實際 listener 狀態。',
        '有線 Server 監聽 MSP 設定埠。',
        'windows',
      ),
      commandStep(
        'connection-ping',
        '由 DUT Ping Server',
        pingCommand,
        'server-ping',
        'Ping 證明 IP 可達；還要辨認繞行。',
        '傳送 / 接收數量、packet loss。',
        'DUT 到 Server 0% loss，管理繞行關閉。',
      ),
      commandStep(
        'connection-ul',
        '送出 UL 流量',
        (state) => iperfCommand(state),
        'iperf-ul',
        'DUT Client 預設由 STA 發送。',
        'Wireless direction、receiver 吞吐、stamld0 路徑。',
        '成功的 STA → AP UL。',
      ),
      commandStep(
        'connection-dl',
        '改為 DL 流量',
        (state) => iperfCommand(state, true),
        'iperf-dl',
        '加 -R 讓有線 Server 發送，無線發送端是 AP。',
        '與上一個指令比較 -R 和方向。',
        '成功的 AP → STA DL。',
      ),
    ],
  },
  {
    id: 'uci-bf-lifecycle',
    title: 'UCI BF 設定生命週期',
    description: '親手比較 Pending、Committed 與 Driver Runtime；STA TxBF 的直接發送方向是 UL。',
    steps: [
      commandStep(
        'bf-read',
        '讀取 BF 配置',
        (state) => `uci get ${bfKey(state)}`,
        'uci-bf-query',
        'Key 依正在運行的 STA Radio 產生。',
        '0 / 3 是本案例 UCI 配置枚舉。',
        '讀到目前配置，不把它當 Runtime 證明。',
      ),
      commandStep(
        'bf-stage-off',
        '暫存 BF OFF',
        (state) => `uci set ${bfKey(state)}=0`,
        'bf-pending-off',
        'set 成功通常沒有輸出。驗收看狀態。',
        'Pending=0；Driver 尚未被重啟。',
        '運行 Radio 的 Pending BF 為 0。',
      ),
      commandStep(
        'bf-read-pending',
        '查詢 Pending 值',
        (state) => `uci get ${bfKey(state)}`,
        'bf-pending-read-off',
        'uci get 會看到待提交設定。',
        '輸出 0，同時比較 Runtime。',
        '輸出與 Pending 都是 0。',
      ),
      commandStep(
        'bf-commit',
        '提交 Wireless',
        'uci commit wireless',
        'bf-committed-off',
        'commit 保存設定，不會自行重新初始化晶片。',
        'Pending 清除，Committed=0。',
        'OFF 已提交；Runtime 仍需後續初始化。',
      ),
      commandStep(
        'bf-read-committed',
        '再次讀取已保存配置',
        (state) => `uci get ${bfKey(state)}`,
        'bf-committed-read-off',
        '同樣是 0，這次已保存。',
        '已無 Pending；Runtime 與 Committed 分開看。',
        '輸出 0 且已提交。',
      ),
      commandStep(
        'bf-restart',
        '重新初始化 Wi-Fi',
        'wifi restart',
        'bf-restart',
        '載入 Committed 並暫時中斷關聯。',
        'restarting，之後才會掃描和認證。',
        '重新啟動確實開始。',
      ),
      waitStep(
        'bf-wait',
        '等待 Driver 與 STA 恢復',
        'bf-connected-off',
        '等待由實際狀態推進，沒有固定假成功倒數。',
        'restarting → scanning → associating → connected。',
        'STA 重新關聯，運行 Radio Runtime BF=0。',
      ),
      commandStep(
        'bf-link',
        '重新核對鏈路',
        'iw dev stamld0 link',
        'link-connected',
        '保存配置與成功關聯是兩件事。',
        'Connected、SSID、頻率。',
        '重啟後的實際關聯成功。',
      ),
      commandStep(
        'bf-ping',
        '確認 IP 層恢復',
        pingCommand,
        'server-ping',
        '最後再測 IP，避免只靠 UCI 值宣告成功。',
        'Server ping loss。',
        '0% loss 且沒有管理繞行。',
      ),
    ],
  },
  {
    id: 'migrate-5g',
    title: '6G → 5G APCLI 遷移',
    description: 'AP、STA 的 Radio 與 SSID 一起核對；已符合的配置可明確跳過重做。',
    steps: [
      actionStep(
        'migration-ap',
        '設定測試 AP 為 5 GHz',
        'configure-ap-5g',
        'ap-5g',
        '這個按鈕只變更 AP；選擇流程本身不改設備。',
        'AP：BN68、5 GHz、CH36；STA 可能仍使用 6G Radio。',
        'AP 已是預定的 5G 配置。',
      ),
      commandStep(
        'migration-read',
        '讀取 APCLI 原配置',
        (state) => `uci show ${station(state, 'uci').prefix}`,
        'uci-sta-query',
        '先讀 Device、SSID、加密，保留變更前證據。',
        'MT7999_1_3 / BN68_6G 或目前配置。',
        '實際 UCI 查詢成功。',
      ),
      commandStep(
        'migration-ssid',
        '把 STA SSID 改為 BN68',
        (state) => `uci set ${station(state, 'uci').prefix}.ssid='BN68'`,
        'ssid-5g-staged',
        '不要推測 BN68_5G；本案例 AP 名稱是 BN68。',
        'Pending SSID，不是 Runtime SSID。',
        'UCI 視圖 SSID=BN68。',
        'linux',
        true,
      ),
      commandStep(
        'migration-device',
        '把 STA 綁到 5G Radio',
        (state) =>
          `uci -q delete ${station(state, 'uci').prefix}.device\nuci add_list ${station(state, 'uci').prefix}.device='MT7999_1_2'`,
        'device-5g-staged',
        '沿用案例的 Device 清單格式。',
        'Device 從 _1_3 改為 _1_2。',
        'UCI 視圖 Device=MT7999_1_2。',
        'linux',
        true,
      ),
      commandStep(
        'migration-commit',
        '保存 5G 配置',
        'uci commit wireless',
        'config-5g-committed',
        'SSID 與 Device 都保存後再初始化。',
        'Committed=BN68 / MT7999_1_2。',
        '兩個核心配置已提交。',
        'linux',
        true,
      ),
      commandStep(
        'migration-restart',
        '載入已保存配置',
        'wifi restart',
        '5g-restart',
        '若 Runtime 已是有效 5G 關聯，可明確略過重啟。',
        '仍是 6G 時必須等待實際重啟與恢復。',
        '重啟開始，或已確認 Runtime 完整符合 5G。',
        'linux',
        true,
      ),
      waitStep(
        'migration-wait',
        '等待 5G 關聯',
        '5g-connected',
        'AP 與 STA 有任何不相容時，等待不會宣告成功。',
        '掃描、認證、5 GHz Connected。',
        'STA Runtime 是 _1_2、BN68，頻率在 5 GHz。',
      ),
      commandStep(
        'migration-link',
        '驗證實際 5G 鏈路',
        'iw dev stamld0 link',
        'link-5g',
        'UHR240 是配置標籤；實際頻寬另外記錄。',
        '本案例 CH36 應看到 5180 MHz。',
        '查詢證明目前連到 5G AP。',
      ),
      commandStep(
        'migration-ping',
        '驗證 Server 可達',
        pingCommand,
        'server-ping',
        '完成 L2 後再檢查 L3。',
        'ping 與管理繞行狀態。',
        'DUT → Server 0% loss。',
      ),
    ],
  },
  {
    id: 'rf-recovery',
    title: 'Reboot 後未連線：排查與恢復',
    description: '從現象、配置、掃描與 Log 找證據，再修改 RF 條件；故障只在明確載入後注入。',
    steps: [
      actionStep(
        'fault-setup',
        '明確載入故障場景',
        'setup-rf-fault',
        'fault-setup',
        '此操作建立一個已提交 BF OFF 的 5G 故障現場，並重新開機。',
        '配置已保存，STA 開機後卻無法關聯。',
        '故障場景開始；保留接下來的證據。',
      ),
      waitStep(
        'fault-wait',
        '等開機與第一次選網結果',
        'fault-visible',
        '開機過程中的 Not connected 先視為等待。',
        '等到真正的掃描結果與 NETWORK-NOT-FOUND。',
        '看到選網失敗，而不是僅看到開機中。',
      ),
      commandStep(
        'fault-link',
        '記錄未連線現象',
        'iw dev stamld0 link',
        'link-observed',
        '負面觀察也是有效證據；此步不要求先恢復。',
        'Not connected。',
        '真正執行鏈路查詢並讀到結果。',
      ),
      commandStep(
        'fault-config',
        '確認設定沒有遺失',
        (state) => `uci show ${station(state, 'uci').prefix}\nuci get ${bfKey(state)}`,
        'uci-sta-query',
        '不要急著重貼長腳本。先查看保存的設定。',
        '_1_2、BN68、BF OFF=0。',
        'UCI 查詢提供配置證據。',
      ),
      commandStep(
        'fault-scan',
        '讀取候選 AP 清單',
        'wpa_cli -i stamld0 scan_results',
        'scan-empty',
        '空清單無法單獨證明 AP 關機、SSID 錯誤或晶片故障。',
        '是否只有欄位標題，沒有 BSSID。',
        '實際查到空候選清單。',
      ),
      commandStep(
        'fault-log',
        '保留選網日誌',
        "logread | grep -Ei 'stamld0|wpa|ssid|auth|fail' | tail -40",
        'log-query',
        '用事件順序形成假設，再核對 AP 與 RF 儀器。',
        'SCAN-RESULTS、NETWORK-NOT-FOUND；FAIL-BUSY 的時機。',
        '實際取得診斷 Log。',
      ),
      actionStep(
        'fault-restore',
        '將衰減器恢復起點',
        'restore-attenuation',
        'attenuation-restored',
        '核對實際 readback，而不是只看 MSP startATT。',
        '衰減器回到指定起點；STA 不會瞬間 Connected。',
        '物理設定讀回值等於起點。',
      ),
      waitStep(
        'fault-recovery-wait',
        '等待自動掃描與認證',
        'rf-connected',
        '恢復 RF 條件後觀察自動恢復，保留原故障記錄。',
        'scanning → associating → connected。',
        '真實狀態恢復；MSP 不會自動續跑原中斷測試。',
      ),
      commandStep(
        'fault-recovered-link',
        '核對恢復後關聯',
        'iw dev stamld0 link',
        'link-connected',
        '用新的查詢驗證剛才的恢復假設。',
        'Connected、BN68、5 GHz。',
        '鏈路恢復成功。',
      ),
      commandStep(
        'fault-recovered-ping',
        '核對恢復後 IP',
        pingCommand,
        'server-ping',
        '從 RF 到 L2，再驗證 L3。',
        'Server 0% loss、正確流量路徑。',
        '整條路徑恢復，證據仍保留。',
      ),
    ],
  },
];

workflows.push({
  id: RVR_FLOW_ID,
  title: '完整 BF ON / OFF DL RvR 與匯出',
  description:
    '保留舊資料，綁定本輪 Run ID，以相同 DL / TCP 條件比較 AP TxBF 並匯出完整實際模擬點。',
  steps: [
    actionStep(
      RVR_STEP_IDS.prepare,
      '準備 DL / TCP 比較',
      'rvr-prepare-dl-tcp',
      'rvr-prepared',
      '只設定方向與 Protocol，保留目前 Start / End、步進、時間、Seed 和 Server。',
      'End 大於 Start；其餘 Sweep 參數由你確認。',
      'DL / TCP 與有效的多點 Sweep 已準備。',
    ),
    commandStep(
      RVR_STEP_IDS.link,
      '確認目前 STA 關聯',
      'iw dev stamld0 link',
      'link-connected',
      '使用目前 Band 的同一條 Wi-Fi 鏈路，選流程不會重置現場。',
      'Connected、SSID、頻率與實際 PHY。',
      '目前 AP / STA 已有效關聯。',
    ),
    commandStep(
      RVR_STEP_IDS.server,
      '確認有線 Server',
      (state) => `iperf3 -s -p ${state.msp.settings.port} -i 1 -f m`,
      'server-listening',
      'Server Port 必須與這輪 Sweep 一致。',
      'PC Server listening、實際 IP / Port。',
      '指定有線 Server 正在監聽。',
      'windows',
    ),
    commandStep(
      RVR_STEP_IDS.ping,
      '驗證 DUT 到 Server',
      pingCommand,
      'server-ping',
      '關聯與 IP 路徑都要驗證，管理繞行必須關閉。',
      '0% loss；核對 stamld0 與 Server 端點。',
      'Wi-Fi 預定 IP 路徑可達。',
    ),
    actionStep(
      RVR_STEP_IDS.apOn,
      '將 DL 發送端 BF 設為 ON',
      'ap-bf-on',
      'rvr-ap-on',
      'DL 的發送端是 AP，這輪只切換 AP TxBF。',
      'AP TxBF ON；STA 與網路配置保持不變。',
      '已確認實際 AP BF ON。',
    ),
    actionStep(
      RVR_STEP_IDS.restoreOn,
      '恢復 ON 輪次起點',
      'rvr-restore-start',
      'rvr-at-start',
      '調整實際衰減器 Readback，不能只看 startATT。',
      'Readback 等於目前 Sweep Start。',
      '實際衰減器位於 ON 起點。',
    ),
    waitStep(
      RVR_STEP_IDS.waitStartOn,
      '等待起點鏈路正常',
      'rvr-connected-start',
      '若鏈路曾中斷，等待真實掃描與認證；原本仍正常的鏈路可直接確認。',
      '起點 Readback 與 STA Connected。',
      '可進行 ON 前檢。',
    ),
    actionStep(
      RVR_STEP_IDS.startOn,
      '開始並捕捉本輪 ON',
      'rvr-start-on',
      'rvr-on-started',
      '開始測試時保存不可變參數與 Metadata，捕捉這次的新 Run ID。',
      '新的 ON Run ID、DL / TCP、AP 發送端。',
      '本輪 ON 已開始並捕捉 ID。',
    ),
    waitStep(
      RVR_STEP_IDS.waitOn,
      '等待完整 ON Sweep',
      'rvr-on-complete',
      '只驗收剛捕捉的 Run，不會替換成舊 ON 曲線。',
      '逐點量測；中斷保留部分資料並阻擋正式比較。',
      '指定 ON 完整涵蓋實際起點與終點。',
    ),
    actionStep(
      RVR_STEP_IDS.restoreOff,
      '回到已捕捉 ON 的起點',
      'rvr-restore-start',
      'rvr-at-captured-start',
      'OFF 起點沿用已捕捉 ON；不會靜默改寫你後來變更的 Sweep 參數。',
      'Readback 回到 ON Snapshot 的 Start。',
      '實際衰減器回到本輪同一起點。',
    ),
    waitStep(
      RVR_STEP_IDS.waitStartOff,
      '等待 OFF 起點鏈路正常',
      'rvr-connected-captured-start',
      '先恢復鏈路，再切換發送端 BF，保留故障與量測證據。',
      '指定起點與真實 Connected。',
      'OFF 起點鏈路正常。',
    ),
    actionStep(
      RVR_STEP_IDS.apOff,
      '只切換 AP BF 為 OFF',
      'ap-bf-off',
      'rvr-ap-off',
      'DL 比較只改 AP TxBF。Seed、Band、STA Runtime、Server 與 Ethernet 瓶頸不可變。',
      'AP OFF；其他條件與已捕捉 ON 比較。',
      '已確認 AP BF OFF。',
    ),
    actionStep(
      RVR_STEP_IDS.startOff,
      '前檢並開始本輪 OFF',
      'rvr-start-off',
      'rvr-off-started',
      '若任何控制條件改變，會阻擋 Start；不會替你覆寫 Seed 或配置。',
      '本輪 ON ID、全套匹配參數、新 OFF ID。',
      'OFF 使用與本輪 ON 相同的控制條件並捕捉新 ID。',
    ),
    waitStep(
      RVR_STEP_IDS.waitOff,
      '等待完整 OFF Sweep',
      'rvr-off-complete',
      '只追蹤指定 OFF，不把中斷點當作完成結果。',
      '完整實際起點與終點；低吞吐自適應步進可能使點數與 ON 不同。',
      '指定 OFF 完整完成。',
    ),
    actionStep(
      RVR_STEP_IDS.compare,
      '明確驗證本輪公平比較',
      'rvr-verify-pair',
      'rvr-pair-valid',
      '比較 Run Snapshot，只有 AP TxBF 可不同；保留各輪真實點，不插補成假量測。',
      '相同 Seed、Sweep、Band、AP、Runtime、Server、瓶頸與模型版本。',
      '指定本輪 ON / OFF 完整且可比較。',
    ),
    actionStep(
      RVR_STEP_IDS.exportCsv,
      '匯出本輪 CSV',
      'rvr-export-csv',
      'rvr-exported-csv',
      '只匯出本輪指定的 ON / OFF 實際模擬點。',
      '下載內容、Run ID 與實際點數。',
      'CSV 已生成，並已送出瀏覽器下載請求。',
    ),
    actionStep(
      RVR_STEP_IDS.exportXlsx,
      '匯出本輪 Excel 與圖表',
      'rvr-export-xlsx',
      'rvr-exported-xlsx',
      '保留兩輪各自的 Attenuation Grid、參數與 Metadata。',
      '原始資料表與 BF ON / OFF 曲線。',
      'XLSX 已生成，並已送出瀏覽器下載請求。',
    ),
    actionStep(
      RVR_STEP_IDS.exportReport,
      '匯出本輪測試報告',
      'rvr-export-report',
      'rvr-exported-report',
      '報告標記模擬資料及實際 AP 發送端 BF。',
      '指定兩輪的控制條件、結果與限制。',
      'HTML Report 已生成，並已送出瀏覽器下載請求。',
    ),
    actionStep(
      RVR_STEP_IDS.exportLog,
      '匯出本輪證據 Log',
      'rvr-export-log',
      'rvr-exported-log',
      '保存比較期間事件，完整工作區的舊資料仍保留。',
      'ON 到 OFF 的量測、衰減與設定事件。',
      '本輪 Log 已生成，並已送出瀏覽器下載請求。',
    ),
  ],
});

const canonical = (source: string): string =>
  source
    .replace(/(['"])(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
const outputFailed = (output: string): boolean =>
  /(^|\n)(?:-ash:|Unknown command|Usage:|Failed to connect|command failed:|iperf3: (?:error|parameter error)|(?:uci|iw|grep|cat):|'.*' is not recognized)/i.test(
    output,
  );
const connected5 = (state: LabState): boolean => {
  const active = station(state);
  return (
    state.sta.status === 'connected' &&
    state.ap.band === '5' &&
    state.ap.ssid === 'BN68' &&
    bandForRadio(active.radio) === '5' &&
    active.values[`${active.prefix}.ssid`] === 'BN68' &&
    state.sta.freq >= 5000 &&
    state.sta.freq < 5950
  );
};
function recoveryTrace(state: LabState, source: 'restart' | 'rf'): boolean {
  let start = -1;
  for (let i = state.logs.length - 1; i >= 0; i--) {
    const entry = state.logs[i];
    if (
      source === 'restart'
        ? entry.source === 'DUT' && /^(?:Reboot|wifi restart):/.test(entry.message)
        : entry.source === 'ATTENUATOR' && /^Readback /.test(entry.message)
    ) {
      start = i;
      break;
    }
  }
  if (start < 0) return false;
  let phase = 0;
  for (const log of state.logs.slice(start + 1)) {
    if (log.source !== 'wpa_supplicant') continue;
    if (phase === 0 && /CTRL-EVENT-SCAN-STARTED/.test(log.message)) phase = 1;
    else if (phase === 1 && /Trying to associate/.test(log.message)) phase = 2;
    else if (phase === 2 && /CTRL-EVENT-CONNECTED/.test(log.message)) return true;
  }
  return false;
}

function stateSatisfied(criterion: WorkflowCriterion, state: LabState): boolean {
  const uci = station(state, 'uci'),
    committed = station(state, 'committed');
  const key = bfKey(state),
    bf = state.config.runtime[key];
  switch (criterion) {
    case 'bf-pending-off':
    case 'bf-pending-read-off':
      return state.config.staged[key] === '0';
    case 'bf-committed-off':
    case 'bf-committed-read-off':
      return state.config.committed[key] === '0' && state.config.staged[key] === undefined;
    case 'bf-connected-off':
      return (
        state.sta.status === 'connected' &&
        bf === '0' &&
        state.config.committed[key] === '0' &&
        recoveryTrace(state, 'restart')
      );
    case 'ap-5g':
      return (
        state.ap.power &&
        state.ap.band === '5' &&
        state.ap.ssid === 'BN68' &&
        state.ap.channel === 36
      );
    case 'ssid-5g-staged':
      return uci.values[`${uci.prefix}.ssid`] === 'BN68';
    case 'device-5g-staged':
      return uci.radio === 'MT7999_1_2';
    case 'config-5g-committed':
      return (
        committed.radio === 'MT7999_1_2' &&
        committed.values[`${committed.prefix}.ssid`] === 'BN68' &&
        !Object.keys(state.config.staged).some((k) => k.startsWith('wireless.'))
      );
    case '5g-connected':
      return connected5(state);
    case 'fault-setup':
      return (
        state.attenuation.db === 90 &&
        state.ap.band === '5' &&
        bf === '0' &&
        state.sta.status !== 'connected'
      );
    case 'fault-visible':
      return (
        state.sta.status !== 'connected' &&
        state.sta.status !== 'restarting' &&
        state.logs.some(
          (log) =>
            log.source === 'wpa_supplicant' && /CTRL-EVENT-NETWORK-NOT-FOUND/.test(log.message),
        )
      );
    case 'attenuation-restored':
      return state.attenuation.db === state.attenuation.start;
    case 'rf-connected':
      return (
        state.sta.status === 'connected' &&
        state.attenuation.db === state.attenuation.start &&
        recoveryTrace(state, 'rf')
      );
    case 'link-connected':
      return state.sta.status === 'connected';
    case 'link-5g':
      return connected5(state);
    case 'ip-assigned':
      return Boolean(state.network.dutIp) && Boolean(state.config.runtime['network.lan.proto']);
    case 'server-listening':
      return state.network.serverRunning && state.network.serverPort === state.msp.settings.port;
    case 'bf-restart':
    case '5g-restart':
      return state.sta.status === 'restarting';
    default:
      return false;
  }
}

/** Pure feedback: commands are executed by the existing terminal, actions by the UI, never here. */
export function evaluateWorkflowStep(
  step: WorkflowStep,
  state: LabState,
  attempt?: WorkflowAttempt,
): WorkflowFeedback {
  const feedback = (
    status: WorkflowFeedback['status'],
    message: string,
    hint?: string,
    evidence: string[] = [],
  ): WorkflowFeedback => ({ status, message, hint, evidence });
  if (attempt?.error) return feedback('failure', attempt.error);
  if (step.criterion.startsWith('rvr-')) {
    if (step.kind === 'action' && !attempt)
      return feedback('ready', '明確執行本步後，將驗收本輪 Run ID 與真實設備狀態。');
    if (step.kind === 'action' && attempt?.action !== step.action)
      return feedback('failure', '尚未執行本步指定的 RvR 操作。');
    return evaluateRvrStep(step.criterion as RvrWorkflowCriterion, state, attempt);
  }
  if (step.kind === 'wait') {
    if (stateSatisfied(step.criterion, state)) return feedback('success', step.expected);
    const reason =
      state.sta.status === 'disconnected'
        ? `尚未連線：${state.sta.reason}`
        : `目前 ${state.sta.status}，等待實際狀態更新。`;
    return feedback(
      'waiting',
      reason,
      '若持續未連線，依序核對 AP、STA Radio / SSID / 認證與衰減器 readback。等待不會修正不相容配置。',
    );
  }
  if (!attempt) {
    if (
      step.skipWhenSatisfied &&
      connected5(state) &&
      (step.criterion === '5g-restart' || stateSatisfied(step.criterion, state))
    )
      return feedback('success', '目前狀態已符合此步，可略過重做。');
    return feedback(
      'ready',
      step.kind === 'action'
        ? '按下操作後，將依實際設備狀態驗收。'
        : '執行本步指令後，將一起檢查輸出與設備狀態。',
    );
  }
  if (step.kind === 'action') {
    if (attempt.action !== step.action) return feedback('failure', '尚未執行本步指定的操作。');
    return stateSatisfied(step.criterion, state)
      ? feedback('success', step.expected)
      : feedback('failure', '操作後的設備狀態尚未符合預期。', step.observe);
  }
  if (attempt.os !== step.os || !attempt.command?.trim())
    return feedback('failure', '請在本步指定的終端執行指令。');
  const output = attempt.output ?? '';
  if (attempt.exitCode !== undefined && attempt.exitCode !== 0)
    return feedback('failure', '終端回報指令未成功。', output || '核對語法、介面名稱與目標設定。');
  if (outputFailed(output))
    return feedback(
      'failure',
      '指令輸出顯示錯誤，這一步尚未完成。',
      /Unknown command/.test(output)
        ? '若在 wpa_cli 互動模式，先 quit 返回 OpenWrt Shell。'
        : output,
    );
  const tags = observeCommand(attempt.command, output, step.os);
  const exact = canonical(attempt.command) === canonical(resolveCommand(step, state));
  const mutation = [
    'bf-pending-off',
    'bf-committed-off',
    'bf-restart',
    'ssid-5g-staged',
    'device-5g-staged',
    'config-5g-committed',
    '5g-restart',
    'server-listening',
  ].includes(step.criterion);
  if (mutation && !exact)
    return feedback(
      'failure',
      '執行的指令與本步目標不同。',
      '可以編輯指令，但本步設定目標與操作必須一致；查看 Pending / Committed / Runtime。',
    );
  let success: boolean;
  switch (step.criterion) {
    case 'link-observed':
      success = tags.includes('link-query');
      break;
    case 'link-connected':
    case 'link-5g':
      success = tags.includes('link-query') && stateSatisfied(step.criterion, state);
      break;
    case 'ip-assigned':
      success =
        /^ip\s/.test(attempt.command.trim()) &&
        /\binet\s/.test(output) &&
        output.includes(state.network.dutIp) &&
        stateSatisfied(step.criterion, state);
      break;
    case 'pc-ip':
      success =
        step.os === 'windows' &&
        /^ipconfig\s*$/i.test(attempt.command.trim()) &&
        output.includes('Windows IP Configuration') &&
        output.includes(state.network.pcIp);
      break;
    case 'server-ping': {
      const stats = output.match(
        /(\d+) packets transmitted,\s*(\d+) (?:packets )?received,\s*0% packet loss/,
      );
      success =
        (exact ||
          (state.network.serverIp === '192.168.1.200' && tags.includes('server-ping-ok'))) &&
        Boolean(stats && Number(stats[1]) > 0 && stats[1] === stats[2]) &&
        state.sta.status === 'connected' &&
        !state.network.bypass;
      break;
    }
    case 'server-listening':
      success = /Server listening on /.test(output) && stateSatisfied(step.criterion, state);
      break;
    case 'iperf-ul':
    case 'iperf-dl':
      success =
        tags.includes(step.criterion === 'iperf-ul' ? 'iperf-ul-ok' : 'iperf-dl-ok') &&
        state.sta.status === 'connected' &&
        !state.network.bypass;
      break;
    case 'uci-sta-query':
      success = exact && tags.includes('uci-query');
      break;
    case 'uci-bf-query':
      success = exact && tags.includes('uci-query') && /^(0|3)$/.test(output.trim());
      break;
    case 'bf-pending-read-off':
    case 'bf-committed-read-off':
      success =
        exact &&
        tags.includes('uci-query') &&
        output.trim() === '0' &&
        stateSatisfied(step.criterion, state);
      break;
    case 'bf-restart':
    case '5g-restart':
      success =
        exact &&
        /Wireless subsystem restarting|going down for reboot/.test(output) &&
        stateSatisfied(step.criterion, state);
      break;
    case 'scan-empty':
      success =
        tags.includes('scan-query') &&
        output.trim() === 'bssid / frequency / signal level / flags / ssid';
      break;
    case 'log-query':
      success = tags.includes('log-query');
      break;
    default:
      success = exact && stateSatisfied(step.criterion, state);
  }
  if (success) return feedback('success', step.expected, undefined, tags);
  if (
    ['restarting', 'scanning', 'associating'].includes(state.sta.status) &&
    ['link-connected', 'link-5g', 'server-ping'].includes(step.criterion)
  )
    return feedback(
      'waiting',
      `目前 ${state.sta.status}；先等待真實關聯完成。`,
      '恢復後重新執行查詢確認。',
      tags,
    );
  return feedback(
    'failure',
    '輸出或設備狀態尚未符合本步預期。',
    `${step.observe}${state.sta.status === 'disconnected' ? `；目前 ${state.sta.reason}` : ''}`,
    tags,
  );
}
