import { bandForRadio, type LabState, type TestRun, type TestSettings } from './lab';
import type { WorkflowAttempt, WorkflowFeedback } from './workflow';

export const RVR_FLOW_ID = 'rvr-bf-comparison';
export const RVR_STEP_IDS = {
  prepare: 'rvr-prepare',
  link: 'rvr-link',
  server: 'rvr-server',
  ping: 'rvr-ping',
  apOn: 'rvr-ap-on',
  restoreOn: 'rvr-restore-on',
  waitStartOn: 'rvr-wait-start-on',
  startOn: 'rvr-start-on',
  waitOn: 'rvr-wait-on',
  restoreOff: 'rvr-restore-off',
  waitStartOff: 'rvr-wait-start-off',
  apOff: 'rvr-ap-off',
  startOff: 'rvr-start-off',
  waitOff: 'rvr-wait-off',
  compare: 'rvr-compare',
  exportCsv: 'rvr-export-csv',
  exportXlsx: 'rvr-export-xlsx',
  exportReport: 'rvr-export-report',
  exportLog: 'rvr-export-log',
} as const;
export type RvrWorkflowActionId =
  | 'rvr-prepare-dl-tcp'
  | 'rvr-restore-start'
  | 'rvr-start-on'
  | 'rvr-start-off'
  | 'rvr-verify-pair'
  | 'rvr-export-csv'
  | 'rvr-export-xlsx'
  | 'rvr-export-report'
  | 'rvr-export-log';
export type RvrWorkflowCriterion =
  | 'rvr-prepared'
  | 'rvr-ap-on'
  | 'rvr-ap-off'
  | 'rvr-at-start'
  | 'rvr-at-captured-start'
  | 'rvr-connected-start'
  | 'rvr-connected-captured-start'
  | 'rvr-on-started'
  | 'rvr-on-complete'
  | 'rvr-off-started'
  | 'rvr-off-complete'
  | 'rvr-pair-valid'
  | 'rvr-exported-csv'
  | 'rvr-exported-xlsx'
  | 'rvr-exported-report'
  | 'rvr-exported-log';
export interface RvrComparisonContext {
  onRunId?: string;
  offRunId?: string;
}
export interface RvrExportReceipt {
  kind: 'csv' | 'xlsx' | 'report' | 'log';
  onRunId: string;
  offRunId: string;
  pointCount: number;
  generatedAt: number;
  filename?: string;
  bytes: number;
}
export interface RvrValidationResult {
  valid: boolean;
  message: string;
  hint?: string;
}
const success = (message: string): RvrValidationResult => ({ valid: true, message });
const failure = (message: string, hint?: string): RvrValidationResult => ({
  valid: false,
  message,
  hint,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
const validIp = (value: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value) && value.split('.').every((part) => Number(part) <= 255);
const settingsKeys: (keyof TestSettings)[] = [
  'direction',
  'protocol',
  'start',
  'end',
  'step',
  'lowStep',
  'threshold',
  'duration',
  'streams',
  'port',
  'serverIp',
  'seed',
];

function difference(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  except: string[] = [],
): string | undefined {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].find(
    (key) => !except.includes(key) && a[key] !== b[key],
  );
}
function radio(runtime: Record<string, string>): string {
  const prefixes = Object.keys(runtime)
    .filter((key) => key.endsWith('.mode') && key.startsWith('wireless.') && runtime[key] === 'sta')
    .map((key) => key.slice(0, -5));
  const prefix =
    prefixes.find((key) => key === 'wireless.stamld0') ??
    prefixes.find((key) => runtime[`${key}.ifname`] === 'stamld0') ??
    prefixes[0] ??
    'wireless.stamld0';
  return (runtime[`${prefix}.device`] ?? '').replace(/["']/g, '').split(/\s+/)[0];
}
function applied(state: LabState): boolean {
  return (
    Object.keys(state.config.staged).length === 0 &&
    !difference(state.config.committed, state.config.runtime)
  );
}
function settingsValid(settings: TestSettings): boolean {
  const numbers = [
    'start',
    'end',
    'step',
    'lowStep',
    'threshold',
    'duration',
    'streams',
    'port',
    'seed',
  ] as const;
  return (
    settings.direction === 'DL' &&
    settings.protocol === 'TCP' &&
    numbers.every((key) => Number.isFinite(settings[key])) &&
    settings.start >= 0 &&
    settings.end <= 90 &&
    settings.end > settings.start &&
    settings.step > 0 &&
    settings.lowStep > 0 &&
    settings.threshold >= 0 &&
    settings.duration >= 1 &&
    Number.isInteger(settings.streams) &&
    settings.streams >= 1 &&
    settings.streams <= 128 &&
    Number.isInteger(settings.port) &&
    settings.port >= 1 &&
    settings.port <= 65535 &&
    Number.isInteger(settings.seed) &&
    validIp(settings.serverIp)
  );
}

export function validateRvrEnvironment(state: LabState): RvrValidationResult {
  if (state.msp.status === 'running')
    return failure('已有測試正在執行；先保留結果並停止，再準備比較。');
  if (!settingsValid(state.msp.settings))
    return failure(
      '請使用有效的 DL / TCP Sweep，End 必須大於 Start。',
      '至少兩個真實量測點；Seed、Port、Streams 須是有效整數。',
    );
  if (!applied(state))
    return failure(
      '存在 Pending 或尚未載入 Driver 的配置。',
      '先提交必要設定並等待初始化，再核對 Runtime。',
    );
  if (
    !state.ap.power ||
    state.sta.status !== 'connected' ||
    bandForRadio(radio(state.config.runtime)) !== state.ap.band ||
    state.sta.ssid !== state.ap.ssid
  )
    return failure(
      `STA 尚未有效關聯預期 AP：${state.sta.reason}`,
      '核對 AP、STA Radio / SSID / 認證與 RF readback。',
    );
  if (state.network.bypass) return failure('管理 Ethernet 繞行仍開啟，不能當作 Wi-Fi RvR。');
  if (!Number.isFinite(state.network.ethernetMbps) || state.network.ethernetMbps <= 0)
    return failure('Ethernet 瓶頸設定無效。');
  const settings = state.msp.settings;
  if (
    !state.network.serverRunning ||
    settings.serverIp !== state.network.serverIp ||
    settings.port !== state.network.serverPort
  )
    return failure(
      'Server 未監聽指定 IP / Port。',
      '在 Windows CMD 啟動有線 iperf3 Server，再由 DUT Ping。',
    );
  const mask = state.config.runtime['network.lan.netmask'] || '255.255.255.0';
  if (
    !validIp(state.sta.ip) ||
    !validIp(mask) ||
    !state.sta.ip
      .split('.')
      .every(
        (part, i) =>
          (Number(part) & Number(mask.split('.')[i])) ===
          (Number(settings.serverIp.split('.')[i]) & Number(mask.split('.')[i])),
      )
  )
    return failure(
      'DUT 與 Server 的 IPv4 路徑不相容。',
      '關聯成功不等於 IP 可達；核對 IPv4、路由與 Ping。',
    );
  return success('環境、Runtime、DL / TCP 參數與 Server 已就緒。');
}

export function validateRvrOnPreflight(state: LabState): RvrValidationResult {
  const environment = validateRvrEnvironment(state);
  if (!environment.valid) return environment;
  if (!state.ap.txbf)
    return failure(
      'DL 的實際發送端 AP TxBF 必須為 ON。',
      'STA 的 etxbfencond 不能代替 AP 發送端的 BF 開關。',
    );
  if (!near(state.attenuation.db, state.msp.settings.start))
    return failure(
      `衰減器 readback ${state.attenuation.db} dB 尚未回到 Start ${state.msp.settings.start} dB。`,
    );
  return success('可開始本輪 AP BF ON DL / TCP Sweep。');
}

function completeRun(run: TestRun | undefined, bf: boolean): RvrValidationResult {
  if (!run) return failure('找不到本輪指定的 Run；不會替換成舊結果。');
  if (run.status === 'interrupted' || run.error)
    return failure(
      `本輪 Run 已中斷：${run.error || 'interrupted'}`,
      '保留部分點與 Log；重新開始完整輪次後再比較。',
    );
  if (run.status !== 'completed') return failure('本輪 Run 尚未完成。');
  if (
    Object.keys(run.metadata.pending).length !== 0 ||
    difference(run.metadata.committed, run.metadata.runtime)
  )
    return failure(
      '本輪 Metadata 存在 Pending 或尚未載入 Driver 的配置。',
      '保留原始證據；提交配置並完成初始化後，重新量測完整 ON / OFF 輪次。',
    );
  if (
    !settingsValid(run.settings) ||
    run.direction !== 'DL' ||
    run.settings.direction !== 'DL' ||
    run.bf !== bf ||
    run.metadata.transmitter !== 'AP' ||
    run.metadata.ap.txbf !== bf
  )
    return failure('本輪不是正確的 AP BF ON / OFF DL / TCP 條件。');
  if (
    !run.metadata.ap.power ||
    run.metadata.network.bypass ||
    run.metadata.band !== run.metadata.ap.band ||
    bandForRadio(radio(run.metadata.runtime)) !== run.metadata.band
  )
    return failure('本輪的 AP / STA / 流量路徑 Metadata 不符合 Wi-Fi 測試。');
  if (
    run.points.length < 2 ||
    !near(run.points[0].attenuation, run.settings.start) ||
    !near(run.points.at(-1)!.attenuation, run.settings.end)
  )
    return failure('本輪未包含完整起點與終點，至少需要兩個量測點。');
  if (
    !run.points.every(
      (point, i) =>
        [
          point.attenuation,
          point.rssi,
          point.snr,
          point.mcs,
          point.nss,
          point.phyRate,
          point.throughput,
          point.time,
        ].every(Number.isFinite) &&
        point.bf === bf &&
        point.throughput > 0 &&
        point.phyRate >= point.throughput &&
        Number.isInteger(point.nss) &&
        point.nss >= 1 &&
        point.nss <= 4 &&
        Number.isInteger(point.mcs) &&
        point.mcs >= 0 &&
        point.mcs <= 13 &&
        point.attenuation >= run.settings.start &&
        point.attenuation <= run.settings.end &&
        (i === 0 ||
          (point.attenuation > run.points[i - 1].attenuation &&
            point.time > run.points[i - 1].time)),
    )
  )
    return failure('本輪包含無效、重複、逆序或未完成的量測點。');
  return success(`本輪 ${bf ? 'ON' : 'OFF'} 完整完成，${run.points.length} 個真實模擬點。`);
}

function metadataMatch(on: TestRun, off: TestRun): RvrValidationResult {
  const setting = settingsKeys.find((key) => on.settings[key] !== off.settings[key]);
  if (setting)
    return failure(
      `ON / OFF 參數 ${setting} 不一致。`,
      '沿用 ON 的參數；不可把不同 Seed、IP、步進或測試時間當作公平 A/B。',
    );
  if (
    on.metadata.band !== off.metadata.band ||
    on.metadata.firmware !== off.metadata.firmware ||
    on.metadata.modelVersion !== off.metadata.modelVersion ||
    on.metadata.transmitter !== off.metadata.transmitter
  )
    return failure('ON / OFF 的 Band、Firmware、Model 或發送端不同。');
  const ap = difference(
    on.metadata.ap as unknown as Record<string, unknown>,
    off.metadata.ap as unknown as Record<string, unknown>,
    ['txbf'],
  );
  if (ap) return failure(`ON / OFF AP 條件 ${ap} 不一致。`);
  for (const layer of ['runtime', 'committed', 'pending'] as const) {
    const key = difference(on.metadata[layer] ?? {}, off.metadata[layer] ?? {});
    if (key)
      return failure(
        `ON / OFF ${layer} 配置 ${key} 不一致。`,
        '本 DL 工作流只切換 AP TxBF；STA 與網路配置應保持一致。',
      );
  }
  const network = difference(on.metadata.network, off.metadata.network);
  if (network) return failure(`ON / OFF 網路條件 ${network} 不一致。`);
  if (
    on.metadata.configuredWidth !== off.metadata.configuredWidth ||
    on.metadata.negotiatedWidth !== off.metadata.negotiatedWidth
  )
    return failure('ON / OFF 配置或協商頻寬不同。');
  return success('兩輪僅 AP TxBF 不同，其他已保存的控制條件一致。');
}

export function validateRvrOffPreflight(state: LabState, onRunId?: string): RvrValidationResult {
  if (!onRunId) return failure('尚未捕捉本輪 ON Run ID；不會使用任意舊 ON 曲線。');
  const on = state.msp.runs.find((run) => run.id === onRunId);
  const complete = completeRun(on, true);
  if (!complete.valid || !on) return complete;
  const environment = validateRvrEnvironment(state);
  if (!environment.valid) return environment;
  const changed = settingsKeys.find((key) => state.msp.settings[key] !== on.settings[key]);
  if (changed)
    return failure(
      `測試參數 ${changed} 已改變（ON=${on.settings[changed]}，目前=${state.msp.settings[changed]}）。`,
      '先恢復 ON 的完整參數，或另開一組比較；不會靜默覆寫設定。',
    );
  if (state.ap.txbf) return failure('OFF 輪次必須確認 AP TxBF 為 OFF。');
  const ap = difference(
    on.metadata.ap as unknown as Record<string, unknown>,
    state.ap as unknown as Record<string, unknown>,
    ['txbf'],
  );
  if (ap) return failure(`AP 條件 ${ap} 與已捕捉 ON 不同。`);
  for (const [layer, current] of [
    ['runtime', state.config.runtime],
    ['committed', state.config.committed],
    ['pending', state.config.staged],
  ] as const) {
    const key = difference(on.metadata[layer] ?? {}, current);
    if (key)
      return failure(
        `${layer} 配置 ${key} 與 ON 不同。`,
        '保留同一組 STA、Driver 與網路控制條件。',
      );
  }
  const network = difference(on.metadata.network, {
    serverIp: state.network.serverIp,
    serverPort: state.network.serverPort,
    ethernetMbps: state.network.ethernetMbps,
    bypass: state.network.bypass,
    pcIp: state.network.pcIp,
    dutIp: state.network.dutIp,
  });
  if (network) return failure(`網路條件 ${network} 與 ON 不同。`);
  if (!near(state.attenuation.db, on.settings.start))
    return failure(`衰減器尚未回到 ON 起點 ${on.settings.start} dB。`);
  return success('OFF 前檢通過；使用與指定 ON 完全一致的 DL / TCP 控制條件。');
}

export function validateRvrPair(
  state: LabState,
  onRunId?: string,
  offRunId?: string,
): RvrValidationResult {
  if (!onRunId || !offRunId || onRunId === offRunId)
    return failure('需要本輪兩個不同的 ON / OFF Run ID。', '不會自動挑選最近兩條或其他舊曲線。');
  const on = state.msp.runs.find((run) => run.id === onRunId),
    off = state.msp.runs.find((run) => run.id === offRunId);
  const onResult = completeRun(on, true);
  if (!onResult.valid || !on) return onResult;
  const offResult = completeRun(off, false);
  if (!offResult.valid || !off) return offResult;
  if (off.startedAt < (on.endedAt ?? on.points.at(-1)!.time))
    return failure('OFF 輪次早於指定 ON 完成，並非本輪順序比較。');
  return metadataMatch(on, off);
}

/** A validated export view pins exact runs and their snapshots; the original workspace is untouched. */
export function selectRvrPairState(state: LabState, onRunId: string, offRunId: string): LabState {
  const result = validateRvrPair(state, onRunId, offRunId);
  if (!result.valid) throw new Error(result.message);
  const on = state.msp.runs.find((run) => run.id === onRunId)!,
    off = state.msp.runs.find((run) => run.id === offRunId)!;
  const selected = clone(state);
  selected.msp.runs = [clone(on), clone(off)];
  selected.msp.activeRunId = off.id;
  selected.msp.status = 'completed';
  selected.msp.settings = clone(on.settings);
  selected.ap = clone(on.metadata.ap);
  selected.config = {
    runtime: clone(on.metadata.runtime),
    committed: clone(on.metadata.committed),
    staged: clone(on.metadata.pending),
  };
  Object.assign(selected.network, clone(on.metadata.network));
  selected.attenuation = { start: on.settings.start, db: off.settings.end };
  selected.logs = selected.logs.filter(
    (log) => log.time >= on.startedAt && log.time <= (off.endedAt ?? off.points.at(-1)!.time),
  );
  return selected;
}

export function evaluateRvrStep(
  criterion: RvrWorkflowCriterion,
  state: LabState,
  attempt?: WorkflowAttempt,
): WorkflowFeedback {
  const result = (
    status: WorkflowFeedback['status'],
    message: string,
    hint?: string,
  ): WorkflowFeedback => ({ status, message, hint, evidence: [] });
  const fromValidation = (validation: RvrValidationResult): WorkflowFeedback =>
    result(validation.valid ? 'success' : 'failure', validation.message, validation.hint);
  if (attempt?.error) return result('failure', attempt.error);
  const on = attempt?.onRunId
    ? state.msp.runs.find((run) => run.id === attempt.onRunId)
    : undefined;
  const start = on?.settings.start ?? state.msp.settings.start;
  switch (criterion) {
    case 'rvr-prepared':
      return fromValidation(
        settingsValid(state.msp.settings) && state.msp.status !== 'running'
          ? success('DL / TCP 已準備；其他 Sweep 與 Seed 設定保留。')
          : failure('DL / TCP 參數無效或目前仍有測試正在執行。'),
      );
    case 'rvr-ap-on':
      return state.ap.txbf
        ? result('success', 'AP TxBF ON：DL 發送端已確認。')
        : result('failure', 'AP TxBF 尚未開啟。');
    case 'rvr-ap-off':
      return !state.ap.txbf
        ? result('success', 'AP TxBF OFF：其餘控制條件保持不變。')
        : result('failure', 'AP TxBF 尚未關閉。');
    case 'rvr-at-start':
    case 'rvr-at-captured-start': {
      if ((criterion === 'rvr-at-captured-start' && !attempt?.onRunId) || (attempt?.onRunId && !on))
        return result('failure', '缺少有效的本輪 ON Run ID，無法確認捕捉的起點。');
      return near(state.attenuation.db, start)
        ? result('success', `實際 Readback 已回到 ${start} dB。`)
        : result('failure', `衰減器 ${state.attenuation.db} dB 尚未回到 ${start} dB。`);
    }
    case 'rvr-connected-start':
    case 'rvr-connected-captured-start': {
      if (criterion === 'rvr-connected-captured-start' && !attempt?.onRunId)
        return result('failure', '尚未捕捉本輪 ON Run ID。');
      if (attempt?.onRunId && !on)
        return result('failure', '找不到指定 ON Run；無法確認恢復起點。');
      if (!near(state.attenuation.db, start))
        return result('failure', `Readback 尚未回到 ${start} dB。`);
      if (state.sta.status !== 'connected')
        return result(
          'waiting',
          `目前 ${state.sta.status}；${state.sta.reason}`,
          '等待真實掃描與關聯；若持續失敗，核對 AP、STA 與 RF。',
        );
      return result('success', '起點 Readback 與 STA Connected 已實際確認。');
    }
    case 'rvr-on-started':
    case 'rvr-off-started': {
      const bf = criterion === 'rvr-on-started';
      const run = attempt?.runId
        ? state.msp.runs.find((candidate) => candidate.id === attempt.runId)
        : undefined;
      if (
        !run ||
        state.msp.status !== 'running' ||
        run.status !== 'running' ||
        state.msp.activeRunId !== run.id ||
        run.bf !== bf ||
        run.direction !== 'DL' ||
        run.settings.protocol !== 'TCP' ||
        run.metadata.transmitter !== 'AP' ||
        run.metadata.ap.txbf !== bf ||
        !near(run.points[0]?.attenuation ?? state.attenuation.db, run.settings.start) ||
        (attempt?.startedAt !== undefined && run.startedAt < attempt.startedAt)
      )
        return result('failure', '本步沒有啟動並捕捉正確的新 Run ID。');
      const pinned = bf ? attempt?.onRunId : attempt?.offRunId;
      if (pinned && pinned !== run.id)
        return result('failure', '捕捉的 Run ID 與本步實際新 Run 不同。');
      if (!bf) {
        if (!on) return result('failure', 'OFF 未指定本輪 ON Run ID。');
        const complete = completeRun(on, true);
        if (!complete.valid) return fromValidation(complete);
        const matching = metadataMatch(on, run);
        if (!matching.valid) return fromValidation(matching);
      }
      return result(
        'success',
        `已捕捉本輪 ${bf ? 'ON' : 'OFF'} Run：${run.id}；Metadata 與參數已保存。`,
      );
    }
    case 'rvr-on-complete':
    case 'rvr-off-complete': {
      const bf = criterion === 'rvr-on-complete';
      const id = bf ? attempt?.onRunId : attempt?.offRunId;
      if (!id || (attempt?.runId && attempt.runId !== id))
        return result('failure', '本輪 Run ID 缺失或不一致；不會使用其他舊結果。');
      const run = state.msp.runs.find((candidate) => candidate.id === id);
      if (!run) return result('failure', '指定 Run 不存在。');
      if (run.status === 'interrupted' || run.error) return fromValidation(completeRun(run, bf));
      if (run.status === 'running') {
        if (state.msp.status !== 'running' || state.msp.activeRunId !== id)
          return result('failure', '正在執行的 Run 與本輪捕捉 ID 不一致。');
        return result(
          'waiting',
          `${bf ? 'ON' : 'OFF'} 執行中：${run.points.length} 點，ATT ${state.attenuation.db} dB。`,
        );
      }
      return fromValidation(completeRun(run, bf));
    }
    case 'rvr-pair-valid':
      return fromValidation(validateRvrPair(state, attempt?.onRunId, attempt?.offRunId));
    default: {
      const validation = validateRvrPair(state, attempt?.onRunId, attempt?.offRunId);
      if (!validation.valid) return fromValidation(validation);
      const kind = criterion.slice('rvr-exported-'.length) as RvrExportReceipt['kind'];
      const receipt = attempt?.exportReceipt;
      const off = state.msp.runs.find((run) => run.id === attempt?.offRunId)!;
      if (
        !receipt ||
        !on ||
        receipt.kind !== kind ||
        receipt.onRunId !== on.id ||
        receipt.offRunId !== off.id ||
        receipt.pointCount !== on.points.length + off.points.length ||
        !Number.isFinite(receipt.bytes) ||
        receipt.bytes <= 0 ||
        !Number.isFinite(receipt.generatedAt) ||
        (attempt?.startedAt !== undefined && receipt.generatedAt < attempt.startedAt)
      )
        return result(
          'failure',
          '尚未確認本輪指定 ON / OFF 的實際檔案匯出。',
          '需成功下載對應格式與實際資料；不能只標記匯出按鈕已按下。',
        );
      return result(
        'success',
        `${kind.toUpperCase()} 已匯出本輪兩條曲線與 ${receipt.pointCount} 個實際模擬點。`,
      );
    }
  }
}
