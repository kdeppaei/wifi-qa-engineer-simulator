/** A deterministic teaching model. Values are simulated, not MT7999 lab measurements. */
export type Band = '2.4' | '5' | '6';
export type Direction = 'DL' | 'UL';
export type ConnectionStatus =
  'connected' | 'scanning' | 'associating' | 'disconnected' | 'restarting';
export interface ConnectionCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}
export interface APConfig {
  power: boolean;
  band: Band;
  ssid: string;
  channel: number;
  width: number;
  security: 'WPA2' | 'WPA3';
  password: string;
  txbf: boolean;
  nss: number;
}
export interface TestSettings {
  direction: Direction;
  protocol: 'TCP' | 'UDP';
  start: number;
  end: number;
  step: number;
  lowStep: number;
  threshold: number;
  duration: number;
  streams: number;
  port: number;
  serverIp: string;
  seed: number;
}
export interface MeasurementPoint {
  attenuation: number;
  rssi: number;
  snr: number;
  mcs: number;
  nss: number;
  phyRate: number;
  throughput: number;
  bf: boolean;
  time: number;
}
export type ResultPoint = MeasurementPoint;
export interface RunMetadata {
  ap: APConfig;
  runtime: Record<string, string>;
  committed: Record<string, string>;
  pending: Record<string, string>;
  network: {
    serverIp: string;
    serverPort: number;
    ethernetMbps: number;
    bypass: boolean;
    pcIp: string;
    dutIp: string;
  };
  band: Band;
  transmitter: 'AP' | 'STA';
  firmware: string;
  modelVersion: string;
  configuredWidth: string;
  negotiatedWidth: number;
}
export interface TestRun {
  id: string;
  label: string;
  bf: boolean;
  direction: Direction;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'interrupted';
  error?: string;
  settings: TestSettings;
  metadata: RunMetadata;
  points: MeasurementPoint[];
}
export interface LogEntry {
  id: string;
  time: number;
  source: string;
  level: string;
  message: string;
}
export interface LabState {
  version: 1;
  ap: APConfig;
  config: {
    staged: Record<string, string>;
    committed: Record<string, string>;
    runtime: Record<string, string>;
  };
  sta: {
    status: ConnectionStatus;
    reason: string;
    rssi: number;
    snr: number;
    mcs: number;
    nss: number;
    phyRate: number;
    throughput: number;
    freq: number;
    ssid: string;
    bssid: string;
    ip: string;
  };
  attenuation: { db: number; start: number };
  network: {
    serverIp: string;
    serverRunning: boolean;
    serverPort: number;
    ethernetMbps: number;
    bypass: boolean;
    pcIp: string;
    dutIp: string;
    wifiBytes: number;
    ethernetBytes: number;
    dutServerRunning: boolean;
    dutServerPort: number;
  };
  msp: {
    status: 'idle' | 'running' | 'completed' | 'interrupted';
    settings: TestSettings;
    runs: TestRun[];
    activeRunId: string | null;
  };
  logs: LogEntry[];
  clock: number;
  internal: {
    phaseUntil: number;
    retryAt: number;
    scanBusyUntil: number;
    lastScanVisible: boolean;
    lastScanAt: number;
    pointElapsed: number;
    measurementSum: number;
    measurementSamples: number;
    sequence: number;
  };
}

export const radioForBand = (band: Band): string =>
  `MT7999_1_${band === '2.4' ? 1 : band === '5' ? 2 : 3}`;
export const bandForRadio = (radio: string): Band | null =>
  radio === 'MT7999_1_1'
    ? '2.4'
    : radio === 'MT7999_1_2'
      ? '5'
      : radio === 'MT7999_1_3'
        ? '6'
        : null;
export const frequencyForBand = (band: Band, channel: number): number =>
  band === '2.4'
    ? channel === 14
      ? 2484
      : 2407 + channel * 5
    : (band === '5' ? 5000 : 5950) + channel * 5;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round = (n: number): number => Math.round(n * 10) / 10;
const validIp = (ip: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
  ip.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
const subnetMatches = (a: string, b: string, mask: string): boolean =>
  validIp(a) &&
  validIp(b) &&
  validIp(mask) &&
  a
    .split('.')
    .every(
      (part, i) =>
        (Number(part) & Number(mask.split('.')[i])) ===
        (Number(b.split('.')[i]) & Number(mask.split('.')[i])),
    );

function initialState(band: Band = '6'): LabState {
  const ssid = band === '6' ? 'BN68_6G' : band === '5' ? 'BN68' : 'BN68_2G';
  const ap: APConfig = {
    power: true,
    band,
    ssid,
    channel: band === '6' ? 37 : band === '5' ? 36 : 6,
    width: band === '2.4' ? 40 : 160,
    security: 'WPA3',
    password: 'qa-lab-2026',
    txbf: true,
    nss: 2,
  };
  const committed: Record<string, string> = {
    'wireless.stamld0': 'wifi-iface',
    'wireless.stamld0.ifname': 'stamld0',
    'wireless.stamld0.mode': 'sta',
    'wireless.stamld0.network': 'lan',
    'wireless.stamld0.device': radioForBand(band),
    'wireless.stamld0.ssid': ssid,
    'wireless.stamld0.key': ap.password,
    'wireless.stamld0.encryption': 'sae',
    'wireless.stamld0.ieee80211w': '2',
    'wireless.stamld0.disabled': '0',
    'network.lan': 'interface',
    'network.lan.proto': 'static',
    'network.lan.device': 'br-lan',
    'network.lan.ipaddr': '192.168.1.5',
    'network.lan.netmask': '255.255.255.0',
    'network.lan.gateway': '192.168.1.1',
  };
  (['2.4', '5', '6'] as Band[]).forEach((radioBand) => {
    const prefix = `wireless.${radioForBand(radioBand)}`;
    Object.assign(committed, {
      [prefix]: 'wifi-device',
      [`${prefix}.type`]: 'mt7999',
      [`${prefix}.band`]: radioBand,
      [`${prefix}.channel`]: radioBand === '6' ? '37' : radioBand === '5' ? '36' : '6',
      [`${prefix}.htmode`]: radioBand === '2.4' ? 'EHT40' : 'UHR240',
      [`${prefix}.etxbfencond`]: '3',
      [`${prefix}.nss`]: '2',
      [`${prefix}.disabled`]: '0',
    });
  });
  return {
    version: 1,
    ap,
    config: { staged: {}, committed, runtime: clone(committed) },
    sta: {
      status: 'connected',
      reason: 'CONNECTED',
      rssi: -30,
      snr: 66,
      mcs: 13,
      nss: 2,
      phyRate: 0,
      throughput: 0,
      freq: frequencyForBand(band, ap.channel),
      ssid,
      bssid: '02:ff:00:2d:e3:63',
      ip: '192.168.1.5',
    },
    attenuation: { db: 0, start: 0 },
    network: {
      serverIp: '192.168.1.200',
      serverRunning: true,
      serverPort: 9002,
      ethernetMbps: 2500,
      bypass: false,
      pcIp: '192.168.1.200',
      dutIp: '192.168.1.5',
      wifiBytes: 0,
      ethernetBytes: 0,
      dutServerRunning: false,
      dutServerPort: 5201,
    },
    msp: {
      status: 'idle',
      settings: {
        direction: 'DL',
        protocol: 'TCP',
        start: 0,
        end: 60,
        step: 5,
        lowStep: 1,
        threshold: 400,
        duration: 3,
        streams: 20,
        port: 9002,
        serverIp: '192.168.1.200',
        seed: 7999,
      },
      runs: [],
      activeRunId: null,
    },
    logs: [],
    clock: 0,
    internal: {
      phaseUntil: 0,
      retryAt: 0,
      scanBusyUntil: 0,
      lastScanVisible: true,
      lastScanAt: 0,
      pointElapsed: 0,
      measurementSum: 0,
      measurementSamples: 0,
      sequence: 0,
    },
  };
}

export class LabEngine {
  state: LabState;

  constructor(savedState?: LabState | string | null) {
    let restored: LabState | null = null;
    try {
      const candidate = typeof savedState === 'string' ? JSON.parse(savedState) : savedState;
      if (
        candidate?.version === 1 &&
        candidate.ap &&
        candidate.config?.runtime &&
        candidate.msp?.runs &&
        candidate.internal
      )
        restored = clone(candidate);
    } catch {
      /* An unreadable saved lab opens the default workspace. */
    }
    this.state = restored ?? initialState();
    if (restored && this.state.msp.status === 'running')
      this.interrupt('SESSION-RESTORED: active test was not executed while this page was closed.');
    this.refreshMetrics();
    if (!restored)
      this.log(
        'LAB',
        'INFO',
        'Virtual lab ready. All values are deterministic simulated data. AP → RF attenuator → STA; wired iperf3 server listens on :9002.',
      );
  }

  log(source: string, level: string, message: string): void {
    this.state.internal.sequence += 1;
    this.state.logs.push({
      id: `log-${this.state.internal.sequence}`,
      time: round(this.state.clock),
      source,
      level,
      message,
    });
    // Keep the persistent workspace bounded; each run retains its own immutable metadata and raw points.
    if (this.state.logs.length > 3000) this.state.logs.splice(0, this.state.logs.length - 3000);
  }

  reset(band: Band = '6'): void {
    this.state = initialState(band);
    this.refreshMetrics();
    this.log(
      'LAB',
      'INFO',
      `New ${band} GHz training workspace. Previous evidence cleared by explicit reset.`,
    );
  }

  exportState(): string {
    return JSON.stringify(this.state, null, 2);
  }

  private staPrefix(runtime = this.state.config.runtime): string {
    const sections = Object.keys(runtime)
      .filter(
        (key) => key.endsWith('.mode') && key.startsWith('wireless.') && runtime[key] === 'sta',
      )
      .map((key) => key.slice(0, -5));
    return (
      sections.find((key) => key === 'wireless.stamld0') ??
      sections.find((key) => runtime[`${key}.ifname`] === 'stamld0') ??
      sections[0] ??
      'wireless.stamld0'
    );
  }
  private staValue(key: string): string {
    return this.state.config.runtime[`${this.staPrefix()}.${key}`] ?? '';
  }
  private radio(): string {
    return this.staValue('device').replace(/["']/g, '').split(/\s+/)[0];
  }
  private runtimeBand(): Band | null {
    return bandForRadio(this.radio());
  }
  private configuredWidth(): number {
    const mode = this.state.config.runtime[`wireless.${this.radio()}.htmode`] ?? 'EHT20';
    return Number(mode.match(/\d+/)?.[0] ?? 20);
  }
  private negotiatedWidth(): number {
    // UHR240 is a vendor configuration label; the teaching AP negotiates at most its configured width.
    const width = Math.min(
      this.configuredWidth(),
      this.state.ap.width,
      this.state.ap.band === '2.4' ? 40 : this.state.ap.band === '5' ? 160 : 320,
    );
    return [320, 160, 80, 40, 20].find((value) => value <= width) ?? 20;
  }
  private actualBF(direction: Direction): boolean {
    return direction === 'DL'
      ? this.state.ap.txbf
      : this.state.config.runtime[`wireless.${this.radio()}.etxbfencond`] === '3';
  }
  private rawSignal(): number {
    return round(-28 - (this.state.ap.band === '6' ? 2 : 0) - this.state.attenuation.db * 0.9);
  }
  private validAPChannel(): boolean {
    const { band, channel } = this.state.ap;
    return (
      Number.isInteger(channel) &&
      (band === '2.4'
        ? channel >= 1 && channel <= 14
        : band === '6'
          ? channel >= 1 && channel <= 233 && (channel - 1) % 4 === 0
          : [
              36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140,
              144, 149, 153, 157, 161, 165, 169, 173, 177,
            ].includes(channel))
    );
  }
  private canSeeAP(): boolean {
    return (
      this.state.ap.power &&
      this.validAPChannel() &&
      this.runtimeBand() === this.state.ap.band &&
      this.rawSignal() > -95
    );
  }

  private connectionFailure(): string | null {
    const ap = this.state.ap;
    const runtime = this.state.config.runtime;
    if (
      this.staValue('mode') !== 'sta' ||
      this.staValue('disabled') === '1' ||
      runtime[`wireless.${this.radio()}.disabled`] === '1'
    )
      return 'STA-DISABLED: no enabled APCLI interface';
    // The supplicant reports its observation, not privileged knowledge of the fault injector.
    // AP power, radio band and the attenuator must be investigated as separate evidence.
    if (
      !ap.power ||
      !this.validAPChannel() ||
      this.runtimeBand() !== ap.band ||
      this.rawSignal() <= -95
    )
      return 'NETWORK-NOT-FOUND: No suitable network found';
    if (this.staValue('ssid') !== ap.ssid)
      return `SSID-MISMATCH: Skip - SSID mismatch (configured '${this.staValue('ssid')}', observed '${ap.ssid}')`;
    const encryption = this.staValue('encryption');
    if (
      (ap.security === 'WPA3' && !encryption.includes('sae')) ||
      (ap.security === 'WPA2' && !encryption.includes('psk2'))
    )
      return `AUTH-REJECT: encryption ${encryption || '(unset)'} does not match ${ap.security}`;
    if ((ap.security === 'WPA3' || ap.band === '6') && this.staValue('ieee80211w') !== '2')
      return 'AUTH-REJECT: SAE requires PMF (ieee80211w=2) in this lab';
    if (ap.band === '6' && ap.security !== 'WPA3')
      return 'AUTH-REJECT: 6 GHz training profile requires WPA3';
    if (this.staValue('key') !== ap.password) return 'AUTH-REJECT: SAE/PSK authentication failed';
    return null;
  }

  connectionDiagnostics(): ConnectionCheck[] {
    const { ap, config, attenuation } = this.state;
    const encryption = this.staValue('encryption');
    const radio = this.radio();
    const pending = Object.keys(config.staged).length;
    const unapplied = [
      ...new Set([...Object.keys(config.committed), ...Object.keys(config.runtime)]),
    ].filter((key) => config.committed[key] !== config.runtime[key]).length;
    return [
      {
        id: 'power',
        label: 'AP 電源',
        ok: ap.power,
        detail: ap.power ? '已開啟' : '請在 AP Configuration 開啟電源',
      },
      {
        id: 'channel',
        label: 'AP Channel',
        ok: this.validAPChannel() && (ap.band !== '6' || ap.security === 'WPA3'),
        detail: `${ap.band} GHz / CH ${ap.channel} / ${ap.security}；6 GHz 須使用 WPA3 與有效 Channel`,
      },
      {
        id: 'enabled',
        label: 'STA / Radio',
        ok:
          this.staValue('mode') === 'sta' &&
          this.staValue('disabled') !== '1' &&
          config.runtime[`wireless.${radio}.disabled`] !== '1',
        detail: `${this.staPrefix()} · ${radio || '尚未指定 Radio'}`,
      },
      {
        id: 'band',
        label: '頻段匹配',
        ok: this.runtimeBand() === ap.band,
        detail: `STA Runtime ${this.runtimeBand() || '未知'} GHz → AP ${ap.band} GHz`,
      },
      {
        id: 'ssid',
        label: 'SSID 匹配',
        ok: this.staValue('ssid') === ap.ssid,
        detail: `STA ${this.staValue('ssid') || '未設定'} → AP ${ap.ssid}`,
      },
      {
        id: 'rf',
        label: 'RF Readback',
        ok: this.rawSignal() > -95,
        detail: `${attenuation.db} dB · ${this.rawSignal()} dBm；起點按鈕目前會恢復到 ${attenuation.start} dB`,
      },
      {
        id: 'auth',
        label: '認證 / PMF',
        ok:
          (ap.security === 'WPA3' ? encryption.includes('sae') : encryption.includes('psk2')) &&
          this.staValue('key') === ap.password &&
          (!(ap.security === 'WPA3' || ap.band === '6') || this.staValue('ieee80211w') === '2'),
        detail: `${encryption || '未設定'} / PMF ${this.staValue('ieee80211w') || '未設定'}；核對 AP 認證，金鑰不顯示`,
      },
      {
        id: 'pending',
        label: 'Pending',
        ok: pending === 0,
        detail: `${pending} 項尚未提交；先處理自己的修改，再使用同步操作`,
      },
      {
        id: 'runtime',
        label: 'Committed → Runtime',
        ok: unapplied === 0,
        detail: `${unapplied} 項尚未載入 Driver；同步操作會重新初始化 Wi-Fi`,
      },
    ];
  }

  stationRecoveryBlocker(): string | null {
    if (this.state.msp.status === 'running') return '請先停止 MSP 量測，再同步 STA。';
    if (Object.keys(this.state.config.staged).length)
      return '仍有 Pending 修改；先提交或處理後再同步，避免混入其他設定。';
    if (
      !this.state.ap.power ||
      !this.validAPChannel() ||
      (this.state.ap.band === '6' && this.state.ap.security !== 'WPA3')
    )
      return '請先在 AP Configuration 開啟電源並設定有效 Channel／認證。';
    return null;
  }

  recoverStationToAP(): string {
    const blocker = this.stationRecoveryBlocker();
    if (blocker) throw new Error(blocker);
    const { ap } = this.state;
    const prefix = this.staPrefix(this.state.config.committed);
    const radio = radioForBand(ap.band);
    this.log(
      'LAB',
      'INFO',
      `Operator requested STA recovery to current AP ${ap.ssid} / ${ap.band} GHz; existing evidence retained.`,
    );
    this.setAttenuation(0);
    for (const [key, value] of Object.entries({
      [prefix]: 'wifi-iface',
      [`${prefix}.mode`]: 'sta',
      [`${prefix}.ifname`]: 'stamld0',
      [`${prefix}.network`]: 'lan',
      [`${prefix}.device`]: radio,
      [`${prefix}.ssid`]: ap.ssid,
      [`${prefix}.encryption`]: ap.security === 'WPA3' ? 'sae' : 'psk2',
      [`${prefix}.key`]: ap.password,
      [`${prefix}.ieee80211w`]: '2',
      [`${prefix}.disabled`]: '0',
      [`wireless.${radio}.disabled`]: '0',
    }))
      this.stage(key, value);
    this.commit('wireless');
    this.restart();
    return `已依 AP ${ap.ssid} / ${ap.band} GHz 同步 STA 並設定 0 dB。請觀察 restarting → scanning → associating → connected；原量測與 Log 保留，MSP 不會自動重跑。`;
  }

  private ipv4(): string {
    const runtime = this.state.config.runtime;
    if (runtime['network.lan.proto'] === 'dhcp') return '192.168.1.5';
    return runtime['network.lan.proto'] === 'static' && validIp(runtime['network.lan.ipaddr'] ?? '')
      ? runtime['network.lan.ipaddr']
      : '';
  }
  private routeAvailable(target: string): boolean {
    const local = this.ipv4();
    return (
      Boolean(local) &&
      subnetMatches(
        local,
        target,
        this.state.config.runtime['network.lan.netmask'] || '255.255.255.0',
      ) &&
      (this.state.sta.status === 'connected' || this.state.network.bypass)
    );
  }

  private measure(
    settings: Pick<TestSettings, 'direction' | 'protocol' | 'streams' | 'seed'>,
  ): MeasurementPoint {
    const rssi = this.rawSignal();
    const snr = round(Math.max(0, rssi + 96));
    const bf = this.actualBF(settings.direction);
    const effective = snr + (bf ? 5 : 0);
    const thresholds = [-4, -1, 2, 5, 8, 11, 14, 18, 22, 26, 30, 34, 39, 43];
    let mcs = thresholds.reduce((result, threshold, i) => (effective >= threshold ? i : result), 0);
    let nss = clamp(
      Math.min(
        this.state.ap.nss,
        Number(this.state.config.runtime[`wireless.${this.radio()}.nss`] ?? 2),
      ),
      1,
      4,
    );
    if (effective < 15) nss = 1;
    const rates = [
      8.6, 17.2, 25.8, 34.4, 51.6, 68.8, 77.4, 86, 103.2, 114.7, 129, 143.4, 154.9, 180.1,
    ];
    let phyRate = round(rates[mcs] * (this.negotiatedWidth() / 20) * nss);
    const loss = clamp(0.018 + (30 - effective) / 65, 0.018, 0.77);
    const streamFactor = 0.66 + 0.34 * (1 - Math.exp(-Math.max(1, settings.streams) / 4));
    let hash =
      (settings.seed ^
        Math.round(this.state.attenuation.db * 100) ^
        (settings.direction === 'UL' ? 73 : 31)) >>>
      0;
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
    const jitter = 0.97 + ((hash % 1000) / 1000) * 0.06;
    let throughput = round(
      Math.min(
        this.state.network.ethernetMbps * 0.94,
        phyRate *
          0.7 *
          (1 - loss) *
          streamFactor *
          (settings.protocol === 'UDP' ? 0.98 : 0.92) *
          (settings.direction === 'UL' ? 0.96 : 1) *
          jitter,
      ),
    );
    if (this.state.sta.status !== 'connected') {
      mcs = -1;
      nss = 0;
      phyRate = 0;
      throughput = 0;
    }
    return {
      attenuation: this.state.attenuation.db,
      rssi,
      snr,
      mcs,
      nss,
      phyRate,
      throughput,
      bf,
      time: round(this.state.clock),
    };
  }

  private refreshMetrics(
    settings: Pick<TestSettings, 'direction' | 'protocol' | 'streams' | 'seed'> = this.state.msp
      .settings,
  ): void {
    const point = this.measure(settings);
    Object.assign(this.state.sta, {
      rssi: point.rssi,
      snr: point.snr,
      mcs: point.mcs,
      nss: point.nss,
      phyRate: point.phyRate,
      throughput: point.throughput,
    });
    if (this.state.sta.status === 'connected') {
      this.state.sta.freq = frequencyForBand(this.state.ap.band, this.state.ap.channel);
      this.state.sta.ssid = this.state.ap.ssid;
      this.state.sta.ip = this.ipv4();
    }
  }

  private interrupt(reason: string): void {
    if (this.state.msp.status !== 'running') return;
    const run = this.state.msp.runs.find(
      (candidate) => candidate.id === this.state.msp.activeRunId,
    );
    if (run) {
      run.status = 'interrupted';
      run.error = reason;
      run.endedAt = round(this.state.clock);
    }
    this.state.msp.status = 'interrupted';
    this.log(
      'MSP',
      'ERROR',
      `Exception: ${reason}; test interrupted at ${this.state.attenuation.db} dB. Preserve partial points and logs.`,
    );
  }

  private disconnect(reason: string): void {
    const previous = this.state.sta.status;
    this.state.sta.status = 'disconnected';
    this.state.sta.reason = reason;
    this.state.sta.ip = '';
    this.state.internal.retryAt = this.state.clock + 1;
    this.state.internal.lastScanVisible = false;
    this.state.internal.scanBusyUntil = this.state.clock;
    this.refreshMetrics();
    if (previous !== 'disconnected')
      this.log('wpa_supplicant', 'WARN', `stamld0 CTRL-EVENT-DISCONNECTED; ${reason}`);
    this.interrupt(reason);
  }

  setAttenuation(db: number): void {
    if (!Number.isFinite(db)) return;
    const next = round(clamp(db, 0, 90));
    const previous = this.state.attenuation.db;
    if (next === previous) return;
    this.state.attenuation.db = next;
    this.log('ATTENUATOR', 'INFO', `Readback ${previous} → ${next} dB`);
    this.checkLinkAfterChange();
    if (this.state.msp.status === 'running')
      this.interrupt(
        'MANUAL-ATTENUATOR-CHANGE: active sweep changed outside its configured sequence',
      );
  }

  private checkLinkAfterChange(): void {
    const failure = this.connectionFailure();
    if (this.state.sta.status === 'connected' && failure) this.disconnect(failure);
    else if (this.state.sta.status !== 'connected' && this.state.sta.status !== 'restarting') {
      if (!failure && this.state.sta.status === 'disconnected')
        this.state.internal.retryAt = this.state.clock + 1;
      this.refreshMetrics();
    } else this.refreshMetrics();
  }

  updateAP(partial: Partial<APConfig>): void {
    const before = clone(this.state.ap);
    Object.assign(this.state.ap, partial);
    this.state.ap.width = clamp(
      this.state.ap.width,
      20,
      this.state.ap.band === '2.4' ? 40 : this.state.ap.band === '5' ? 160 : 320,
    );
    this.state.ap.nss = clamp(this.state.ap.nss, 1, 4);
    this.log(
      'AP',
      'INFO',
      `Applied AP settings: ${Object.keys(partial).join(', ')}; ${this.state.ap.ssid} / ${this.state.ap.band} GHz / CH${this.state.ap.channel} / ${this.state.ap.security}`,
    );
    if (this.state.msp.status === 'running')
      this.interrupt('AP-CONFIG-CHANGED: test control variables changed during measurement');
    const failure = this.connectionFailure();
    if (
      this.state.sta.status === 'connected' &&
      (failure || before.channel !== this.state.ap.channel)
    )
      this.disconnect(failure ?? 'CHANNEL-SWITCH: AP radio changed channel');
    else this.checkLinkAfterChange();
  }

  stage(key: string, value: string): void {
    this.state.config.staged[key] = String(value);
    this.log(
      'UCI',
      'INFO',
      `Pending ${key}=${key.endsWith('.key') ? '(training key changed)' : value}; runtime unchanged`,
    );
  }

  commit(packageName = 'wireless'): void {
    const matching = Object.keys(this.state.config.staged).filter(
      (key) => !packageName || key === packageName || key.startsWith(`${packageName}.`),
    );
    for (const key of matching) {
      const value = this.state.config.staged[key];
      if (value === '__DELETE__') delete this.state.config.committed[key];
      else this.state.config.committed[key] = value;
      delete this.state.config.staged[key];
    }
    this.log(
      'UCI',
      'INFO',
      `Committed ${matching.length} ${packageName || 'all'} setting(s). Driver runtime changes only after restart.`,
    );
  }

  restart(reboot = false): void {
    this.interrupt(reboot ? 'DUT-REBOOT' : 'WIFI-RESTART');
    this.state.config.runtime = clone(this.state.config.committed);
    if (reboot) {
      this.state.config.staged = {};
      this.state.network.dutServerRunning = false;
    }
    this.state.network.dutIp = this.ipv4();
    this.state.sta.status = 'restarting';
    this.state.sta.reason = reboot ? 'DUT booting' : 'Wi-Fi driver reinitializing';
    this.state.sta.ip = '';
    this.state.internal.phaseUntil = this.state.clock + (reboot ? 5 : 2);
    this.state.internal.scanBusyUntil = this.state.internal.phaseUntil;
    this.state.internal.lastScanVisible = false;
    this.refreshMetrics();
    this.log(
      'DUT',
      'INFO',
      `${reboot ? 'Reboot' : 'wifi restart'}: committed configuration loaded; driver initializing.`,
    );
  }

  scan(): string {
    if (
      this.state.clock < this.state.internal.scanBusyUntil ||
      ['restarting', 'scanning', 'associating'].includes(this.state.sta.status)
    ) {
      this.log(
        'wpa_supplicant',
        'WARN',
        'FAIL-BUSY: another scan/association is already in progress (Resource busy -16)',
      );
      return 'FAIL-BUSY';
    }
    this.state.internal.scanBusyUntil = this.state.clock + 2;
    this.state.internal.lastScanAt = this.state.internal.scanBusyUntil;
    this.log('wpa_supplicant', 'INFO', 'CTRL-EVENT-SCAN-STARTED (manual scan request accepted)');
    return 'OK';
  }

  scanResults(): string {
    const heading = 'bssid / frequency / signal level / flags / ssid';
    if (!this.canSeeAP() || !this.state.internal.lastScanVisible) return heading;
    const ap = this.state.ap;
    return `${heading}\n${this.state.sta.bssid}\t${frequencyForBand(ap.band, ap.channel)}\t${this.rawSignal()}\t${ap.security === 'WPA3' ? '[WPA2-SAE-CCMP][ESS][MFPR]' : '[WPA2-PSK-CCMP][ESS]'}\t${ap.ssid}`;
  }

  startTest(partial: Partial<TestSettings> = {}): string {
    if (this.state.msp.status === 'running') return 'MSP is already running.';
    const settings = { ...this.state.msp.settings, ...partial };
    const numeric = [
      settings.start,
      settings.end,
      settings.step,
      settings.lowStep,
      settings.threshold,
      settings.duration,
      settings.streams,
      settings.port,
      settings.seed,
    ];
    if (
      numeric.some((n) => !Number.isFinite(n)) ||
      settings.start < 0 ||
      settings.end > 90 ||
      settings.start > settings.end ||
      settings.step <= 0 ||
      settings.lowStep <= 0 ||
      settings.threshold < 0 ||
      settings.duration < 1 ||
      !Number.isInteger(settings.streams) ||
      settings.streams < 1 ||
      settings.streams > 128 ||
      !Number.isInteger(settings.port) ||
      settings.port < 1 ||
      settings.port > 65535 ||
      !Number.isInteger(settings.seed) ||
      !validIp(settings.serverIp)
    )
      return this.preflightError(
        'INVALID-SETTINGS: check attenuation range, step, duration, streams, seed and server endpoint.',
      );
    this.state.msp.settings = clone(settings);
    if (this.state.sta.status !== 'connected')
      return this.preflightError(`STA-NOT-CONNECTED: ${this.state.sta.reason}`);
    if (this.state.attenuation.db !== settings.start)
      return this.preflightError(
        `ATTENUATOR-NOT-AT-START: readback ${this.state.attenuation.db} dB, configured start ${settings.start} dB. Restore the physical readback before starting.`,
      );
    if (this.state.network.bypass)
      return this.preflightError(
        'PATH-BYPASS: management Ethernet bypass is enabled. A Wi-Fi RvR run requires traffic on stamld0.',
      );
    if (!this.routeAvailable(settings.serverIp))
      return this.preflightError(
        'NO-IP-ROUTE: association alone does not prove IPv4 reachability.',
      );
    if (
      !this.state.network.serverRunning ||
      settings.serverIp !== this.state.network.serverIp ||
      settings.port !== this.state.network.serverPort
    )
      return this.preflightError(
        'SERVER-UNREACHABLE: verify iperf3 server IP, listening port and server process.',
      );
    const bf = this.actualBF(settings.direction);
    const id = `run-${++this.state.internal.sequence}`;
    const run: TestRun = {
      id,
      label: `${this.state.ap.band}G BF ${bf ? 'ON' : 'OFF'} ${settings.direction} ${String(this.state.msp.runs.length + 1).padStart(2, '0')}`,
      bf,
      direction: settings.direction,
      startedAt: round(this.state.clock),
      status: 'running',
      settings: clone(settings),
      points: [],
      metadata: {
        ap: clone(this.state.ap),
        runtime: clone(this.state.config.runtime),
        committed: clone(this.state.config.committed),
        pending: clone(this.state.config.staged),
        network: {
          serverIp: this.state.network.serverIp,
          serverPort: this.state.network.serverPort,
          ethernetMbps: this.state.network.ethernetMbps,
          bypass: this.state.network.bypass,
          pcIp: this.state.network.pcIp,
          dutIp: this.state.network.dutIp,
        },
        band: this.state.ap.band,
        transmitter: settings.direction === 'DL' ? 'AP' : 'STA',
        firmware: 'MT7999 / OpenWrt virtual model v1',
        modelVersion: '1.0',
        configuredWidth: this.state.config.runtime[`wireless.${this.radio()}.htmode`] ?? '',
        negotiatedWidth: this.negotiatedWidth(),
      },
    };
    this.state.msp.runs.push(run);
    this.state.msp.activeRunId = id;
    this.state.msp.status = 'running';
    this.state.attenuation.start = settings.start;
    this.resetPointAccumulator();
    this.log(
      'MSP',
      'INFO',
      `Start ${run.label}; ${settings.protocol}; ${settings.serverIp}:${settings.port}; ${settings.duration}s/point; seed=${settings.seed}; transmitter=${run.metadata.transmitter}; actual TxBF=${bf ? 'ON' : 'OFF'}.`,
    );
    this.refreshMetrics(settings);
    return `Started ${run.label}`;
  }

  private preflightError(message: string): string {
    this.log('MSP', 'ERROR', `Preflight: ${message}`);
    return message;
  }
  private resetPointAccumulator(): void {
    this.state.internal.pointElapsed = 0;
    this.state.internal.measurementSum = 0;
    this.state.internal.measurementSamples = 0;
  }
  stopTest(): void {
    this.interrupt('USER-STOP: operator stopped the sweep; partial data preserved');
  }

  tick(seconds = 1): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    let remaining = Math.min(seconds, 86400);
    while (remaining > 0) {
      const dt = Math.min(remaining, 1);
      this.state.clock = round(this.state.clock + dt);
      this.advanceConnection();
      if (
        this.state.internal.lastScanAt > 0 &&
        this.state.clock >= this.state.internal.lastScanAt
      ) {
        this.state.internal.lastScanVisible = this.canSeeAP();
        this.state.internal.lastScanAt = 0;
        this.log('wpa_supplicant', 'INFO', 'CTRL-EVENT-SCAN-RESULTS');
      }
      this.refreshMetrics();
      if (this.state.msp.status === 'running') this.advanceTest(dt);
      remaining -= dt;
    }
  }

  private startAutoScan(): void {
    this.state.sta.status = 'scanning';
    this.state.sta.reason = 'Automatic scan in progress';
    this.state.internal.phaseUntil = this.state.clock + 2;
    this.state.internal.scanBusyUntil = this.state.internal.phaseUntil;
    this.log('wpa_supplicant', 'INFO', 'stamld0 CTRL-EVENT-SCAN-STARTED (automatic reconnect)');
  }
  private advanceConnection(): void {
    const { sta, internal } = this.state;
    if (sta.status === 'connected') {
      const failure = this.connectionFailure();
      if (failure) this.disconnect(failure);
      return;
    }
    if (sta.status === 'restarting' && this.state.clock >= internal.phaseUntil) {
      this.startAutoScan();
      return;
    }
    if (sta.status === 'disconnected' && this.state.clock >= internal.retryAt) {
      this.startAutoScan();
      return;
    }
    if (sta.status === 'scanning' && this.state.clock >= internal.phaseUntil) {
      internal.lastScanVisible = this.canSeeAP();
      this.log('wpa_supplicant', 'INFO', 'stamld0 CTRL-EVENT-SCAN-RESULTS');
      const failure = this.connectionFailure();
      if (failure) {
        sta.status = 'disconnected';
        sta.reason = failure;
        internal.retryAt = this.state.clock + 4;
        this.log(
          'wpa_supplicant',
          'WARN',
          `stamld0 CTRL-EVENT-${failure.startsWith('AUTH') ? 'AUTH-REJECT' : 'NETWORK-NOT-FOUND'}; ${failure}`,
        );
      } else {
        sta.status = 'associating';
        sta.reason = `Authenticating with ${this.state.ap.ssid}`;
        internal.phaseUntil = this.state.clock + 2;
        internal.scanBusyUntil = internal.phaseUntil;
        this.log(
          'wpa_supplicant',
          'INFO',
          `stamld0 Trying to associate with ${this.state.sta.bssid}; ${this.state.ap.security}`,
        );
      }
      return;
    }
    if (sta.status === 'associating' && this.state.clock >= internal.phaseUntil) {
      const failure = this.connectionFailure();
      if (failure) {
        this.disconnect(failure);
        return;
      }
      sta.status = 'connected';
      sta.reason = this.ipv4() ? 'CONNECTED' : 'CONNECTED (L2 only: no IPv4)';
      this.refreshMetrics();
      this.log(
        'wpa_supplicant',
        'INFO',
        `stamld0 CTRL-EVENT-CONNECTED to ${sta.bssid}; SSID=${sta.ssid}; freq=${sta.freq}; IPv4=${sta.ip || '(none)'}`,
      );
    }
  }

  private advanceTest(dt: number): void {
    const settings = this.state.msp.settings;
    if (this.state.sta.status !== 'connected') {
      this.interrupt(`STA-NOT-CONNECTED: ${this.state.sta.reason}`);
      return;
    }
    if (this.state.network.bypass || !this.routeAvailable(settings.serverIp)) {
      this.interrupt('TEST-PATH-CHANGED: expected Wi-Fi IP route is unavailable');
      return;
    }
    if (
      !this.state.network.serverRunning ||
      settings.port !== this.state.network.serverPort ||
      settings.serverIp !== this.state.network.serverIp
    ) {
      this.interrupt('SERVER-CONNECTION-LOST: iperf3 listener unavailable');
      return;
    }
    const run = this.state.msp.runs.find(
      (candidate) => candidate.id === this.state.msp.activeRunId,
    );
    if (!run) {
      this.interrupt('RUN-STATE-LOST');
      return;
    }
    if (JSON.stringify(settings) !== JSON.stringify(run.settings)) {
      this.interrupt('MSP-SETTINGS-CHANGED: configured sweep variables changed during measurement');
      return;
    }
    if (this.state.network.ethernetMbps !== run.metadata.network.ethernetMbps) {
      this.interrupt('BACKHAUL-CHANGED: Ethernet bottleneck changed during measurement');
      return;
    }
    const metric = this.measure(settings);
    this.state.internal.pointElapsed += dt;
    this.state.internal.measurementSum += metric.throughput * dt;
    this.state.internal.measurementSamples += dt;
    this.accountTraffic(metric.throughput, dt, false);
    if (this.state.internal.pointElapsed + 0.0001 < settings.duration) return;
    metric.throughput = round(
      this.state.internal.measurementSum / this.state.internal.measurementSamples,
    );
    run.points.push(metric);
    this.log(
      'MSP',
      'INFO',
      `Point ${metric.attenuation} dB: ${metric.throughput} Mbps; RSSI ${metric.rssi} dBm; MCS${metric.mcs}/NSS${metric.nss}; ${settings.direction}`,
    );
    if (this.state.attenuation.db >= settings.end) {
      run.status = 'completed';
      run.endedAt = round(this.state.clock);
      this.state.msp.status = 'completed';
      this.log(
        'MSP',
        'INFO',
        `Completed ${run.label}; ${run.points.length} measured points. Attenuator remains ${this.state.attenuation.db} dB; restore start before reboot or next run.`,
      );
      return;
    }
    const step = metric.throughput < settings.threshold ? settings.lowStep : settings.step;
    const next = round(Math.min(settings.end, this.state.attenuation.db + step));
    this.state.attenuation.db = next;
    this.log(
      'ATTENUATOR',
      'INFO',
      `MSP set/readback ${next} dB (${metric.throughput < settings.threshold ? 'low throughput' : 'normal'} step ${step} dB)`,
    );
    this.resetPointAccumulator();
    const failure = this.connectionFailure();
    if (failure) this.disconnect(failure);
    else this.refreshMetrics(settings);
  }

  private accountTraffic(mbps: number, seconds: number, bypass: boolean): void {
    const bytes = Math.round(((mbps * 1_000_000) / 8) * seconds);
    if (bypass) this.state.network.ethernetBytes += bytes;
    else this.state.network.wifiBytes += bytes;
  }

  ping(target: string, count = 4, origin = 'linux'): string {
    if (!validIp(target))
      return origin === 'linux'
        ? `ping: bad address '${target}'`
        : `Ping request could not find host ${target}.`;
    count = clamp(Math.floor(count) || 4, 1, 20);
    const linux = origin === 'linux';
    const known = [
      this.state.network.serverIp,
      this.state.network.pcIp,
      this.state.network.dutIp,
      '192.168.1.1',
    ];
    const isSelf = target === (linux ? this.ipv4() : this.state.network.pcIp);
    const needsWifi = linux ? !isSelf : target === this.state.network.dutIp;
    const reachable =
      known.includes(target) &&
      (isSelf ||
        (needsWifi ? this.routeAvailable(linux ? target : this.state.network.pcIp) : true));
    if (reachable && needsWifi) {
      if (this.state.network.bypass) this.state.network.ethernetBytes += count * 84;
      else this.state.network.wifiBytes += count * 84;
    }
    this.log(
      linux ? 'DUT' : 'CMD',
      reachable ? 'INFO' : 'WARN',
      `ping ${target}: ${reachable ? '0' : '100'}% loss; path=${isSelf ? 'local' : needsWifi ? (this.state.network.bypass ? 'eth2 (bypass)' : 'stamld0 Wi-Fi') : 'wired PC network'}`,
    );
    if (linux) {
      const replies = reachable
        ? Array.from(
            { length: count },
            (_, i) =>
              `64 bytes from ${target}: seq=${i} ttl=64 time=${round(1.3 + this.state.attenuation.db * 0.04)} ms`,
          ).join('\n')
        : `From ${this.ipv4() || '0.0.0.0'}: Destination Host Unreachable`;
      return `PING ${target} (${target}): 56 data bytes\n${replies}\n\n--- ${target} ping statistics ---\n${count} packets transmitted, ${reachable ? count : 0} packets received, ${reachable ? 0 : 100}% packet loss`;
    }
    const replies = Array.from({ length: count }, () =>
      reachable
        ? `Reply from ${target}: bytes=32 time=${Math.ceil(1 + this.state.attenuation.db * 0.04)}ms TTL=64`
        : 'Request timed out.',
    ).join('\n');
    return `Pinging ${target} with 32 bytes of data:\n${replies}\n\nPing statistics for ${target}:\n    Packets: Sent = ${count}, Received = ${reachable ? count : 0}, Lost = ${reachable ? 0 : count} (${reachable ? 0 : 100}% loss)`;
  }

  iperf(args: string[], origin = 'linux'): string {
    const option = (short: string, long?: string): string | undefined => {
      const index = args.findIndex((arg) => arg === short || (long && arg === long));
      return index >= 0
        ? args[index + 1]
        : args.find((arg) => arg.startsWith(`${long}=`))?.slice((long?.length ?? 0) + 1);
    };
    const linux = origin === 'linux';
    const port = Number(option('-p', '--port') ?? 5201);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return 'iperf3: parameter error - invalid port';
    if (args.includes('-s') || args.includes('--server')) {
      if (linux) {
        this.state.network.dutServerRunning = true;
        this.state.network.dutServerPort = port;
      } else {
        this.state.network.serverRunning = true;
        this.state.network.serverPort = port;
        this.state.network.serverIp = this.state.network.pcIp;
      }
      this.log(
        linux ? 'DUT' : 'CMD',
        'INFO',
        `iperf3 server listening on ${linux ? this.state.network.dutIp : this.state.network.serverIp}:${port}`,
      );
      return `-----------------------------------------------------------\nServer listening on ${port} (virtual process)\n-----------------------------------------------------------`;
    }
    const target = option('-c', '--client');
    if (!target)
      return 'Usage: iperf3 -s [-p port] | iperf3 -c host [-p port] [-R] [-P streams] [-t seconds] [-u]';
    const duration = Number(option('-t', '--time') ?? 10);
    const streams = Number(option('-P', '--parallel') ?? 1);
    if (
      !validIp(target) ||
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 3600 ||
      !Number.isFinite(streams) ||
      streams < 1 ||
      streams > 128
    )
      return 'iperf3: parameter error - check host, duration (1–3600s), and streams (1–128)';
    const reverse = args.includes('-R') || args.includes('--reverse');
    const direction: Direction = linux ? (reverse ? 'DL' : 'UL') : reverse ? 'UL' : 'DL';
    const protocol = args.includes('-u') || args.includes('--udp') ? 'UDP' : 'TCP';
    const endpointRunning = linux
      ? this.state.network.serverRunning &&
        target === this.state.network.serverIp &&
        port === this.state.network.serverPort
      : this.state.network.dutServerRunning &&
        target === this.state.network.dutIp &&
        port === this.state.network.dutServerPort;
    const reachable = this.routeAvailable(linux ? target : this.state.network.pcIp);
    if (!reachable) {
      this.log('iperf3', 'ERROR', 'unable to connect: No route to host');
      return 'iperf3: error - unable to connect to server: No route to host';
    }
    if (!endpointRunning) {
      this.log('iperf3', 'ERROR', `Connection refused: no server at ${target}:${port}`);
      return `iperf3: error - unable to connect to server: Connection refused (${target}:${port})`;
    }
    const bypass = this.state.network.bypass;
    const point = this.measure({
      direction,
      protocol,
      streams,
      seed: this.state.msp.settings.seed,
    });
    let throughput = bypass ? round(this.state.network.ethernetMbps * 0.94) : point.throughput;
    let udpLine = '';
    if (protocol === 'UDP') {
      const requestedText = option('-b', '--bitrate') ?? '1M';
      const match = requestedText.match(/^(\d+(?:\.\d+)?)([KMG])?$/i);
      if (!match) return 'iperf3: parameter error - invalid UDP bitrate';
      const amount =
        Number(match[1]) *
        ({ K: 0.001, M: 1, G: 1000 }[match[2]?.toUpperCase() as 'K' | 'M' | 'G'] ?? 0.000001);
      const offered = amount === 0 ? throughput : amount;
      const loss = Math.max(0, 1 - throughput / Math.max(offered, 0.001));
      throughput = round(Math.min(throughput, offered));
      udpLine = `  0.120 ms  ${Math.round(loss * 1000)}/1000 (${round(loss * 100)}%)`;
    }
    this.accountTraffic(throughput, duration, bypass);
    const transfer = round((throughput * duration) / 8);
    this.log(
      'iperf3',
      bypass ? 'WARN' : 'INFO',
      `${protocol} ${direction} ${throughput} Mbps; ${duration}s; P=${streams}; transmitter=${direction === 'DL' ? 'AP' : 'STA'}; path=${bypass ? 'eth2 BYPASS' : 'stamld0'}; simulated summary`,
    );
    return `Connecting to host ${target}, port ${port}\n[  5] local ${linux ? this.state.network.dutIp : this.state.network.pcIp} connected to ${target}\n[ ID] Interval           Transfer     Bitrate${protocol === 'UDP' ? '         Jitter    Lost/Total Datagrams' : ''}\n[SUM] 0.00-${duration.toFixed(2)} sec  ${transfer} MBytes  ${throughput} Mbits/sec${udpLine}  sender\n[SUM] 0.00-${duration.toFixed(2)} sec  ${transfer} MBytes  ${throughput} Mbits/sec${udpLine}  receiver\nWireless direction: ${direction} (${direction === 'DL' ? 'AP → STA' : 'STA → AP'}); ${bypass ? 'WARNING: management Ethernet bypass, Wi-Fi counters unchanged' : 'path stamld0'}\nSimulated one-shot summary; virtual lab clock is unchanged.\niperf Done.`;
  }
}
