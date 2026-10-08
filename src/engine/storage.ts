import type { LabState } from './lab';
import type { TerminalSnapshot } from './terminal';

export interface SavedSnapshot {
  version: 1;
  lab: LabState;
  linux?: TerminalSnapshot;
  windows?: TerminalSnapshot;
  chapter: number;
  evidence: string[];
}

type ObjectValue = Record<string, unknown>;
const MAX_JSON_LENGTH = 12 * 1024 * 1024;
const MAX_RUNS = 200;
const MAX_POINTS = 20_000;
const MAX_LOGS = 3_000;
const MAX_RECORD_KEYS = 2_000;
const MAX_TEXT = 65_536;

function object(value: unknown): value is ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value: unknown, limit = MAX_TEXT): value is string {
  return typeof value === 'string' && value.length <= limit;
}

function number(value: unknown, min = -1e12, max = 1e12): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min: number, max: number): boolean {
  return number(value, min, max) && Number.isInteger(value);
}

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

function strings(value: ObjectValue, keys: readonly string[], limit = MAX_TEXT): boolean {
  return keys.every((key) => text(value[key], limit));
}

function numbers(value: ObjectValue, keys: readonly string[], min = -1e12, max = 1e12): boolean {
  return keys.every((key) => number(value[key], min, max));
}

function booleans(value: ObjectValue, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === 'boolean');
}

function stringRecord(value: unknown, valueLimit = MAX_TEXT): boolean {
  return (
    object(value) &&
    Object.keys(value).length <= MAX_RECORD_KEYS &&
    Object.entries(value).every(
      ([key, entry]) =>
        text(key, 512) &&
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        text(entry, valueLimit),
    )
  );
}

function stringList(value: unknown, length: number, itemLimit = MAX_TEXT): value is string[] {
  return (
    Array.isArray(value) && value.length <= length && value.every((item) => text(item, itemLimit))
  );
}

function ap(value: unknown): boolean {
  return (
    object(value) &&
    booleans(value, ['power', 'txbf']) &&
    oneOf(value.band, ['2.4', '5', '6']) &&
    oneOf(value.security, ['WPA2', 'WPA3']) &&
    strings(value, ['ssid', 'password'], 1024) &&
    integer(value.channel, 1, 233) &&
    number(value.width, 20, 320) &&
    integer(value.nss, 1, 4)
  );
}

function settings(value: unknown): boolean {
  // Preserve finite, intentionally invalid experiment inputs; startTest performs operational preflight.
  return (
    object(value) &&
    oneOf(value.direction, ['DL', 'UL']) &&
    oneOf(value.protocol, ['TCP', 'UDP']) &&
    text(value.serverIp, 256) &&
    numbers(value, [
      'start',
      'end',
      'step',
      'lowStep',
      'threshold',
      'duration',
      'streams',
      'port',
      'seed',
    ])
  );
}

function networkMetadata(value: unknown): boolean {
  return (
    object(value) &&
    strings(value, ['serverIp', 'pcIp', 'dutIp'], 256) &&
    number(value.serverPort) &&
    number(value.ethernetMbps, 1, 1e8) &&
    booleans(value, ['bypass'])
  );
}

function metadata(value: unknown): boolean {
  return (
    object(value) &&
    ap(value.ap) &&
    stringRecord(value.runtime) &&
    stringRecord(value.committed) &&
    stringRecord(value.pending) &&
    networkMetadata(value.network) &&
    oneOf(value.band, ['2.4', '5', '6']) &&
    oneOf(value.transmitter, ['AP', 'STA']) &&
    strings(value, ['firmware', 'modelVersion', 'configuredWidth'], 1024) &&
    number(value.negotiatedWidth, 0, 320)
  );
}

function point(value: unknown): boolean {
  return (
    object(value) &&
    number(value.attenuation, 0, 90) &&
    number(value.rssi, -250, 100) &&
    number(value.snr, 0, 350) &&
    integer(value.mcs, -1, 13) &&
    integer(value.nss, 0, 4) &&
    numbers(value, ['phyRate', 'throughput'], 0, 1e8) &&
    number(value.time, 0) &&
    booleans(value, ['bf'])
  );
}

function run(value: unknown): boolean {
  if (
    !object(value) ||
    !strings(value, ['id', 'label'], 1024) ||
    !value.id ||
    !booleans(value, ['bf']) ||
    !oneOf(value.direction, ['DL', 'UL']) ||
    !number(value.startedAt, 0) ||
    !oneOf(value.status, ['running', 'completed', 'interrupted']) ||
    !settings(value.settings) ||
    !metadata(value.metadata)
  )
    return false;
  if (value.endedAt !== undefined && !number(value.endedAt, value.startedAt as number))
    return false;
  if (value.error !== undefined && !text(value.error)) return false;
  return (
    Array.isArray(value.points) && value.points.length <= MAX_POINTS && value.points.every(point)
  );
}

function log(value: unknown): boolean {
  return (
    object(value) &&
    strings(value, ['id', 'source', 'level'], 1024) &&
    text(value.message) &&
    number(value.time, 0)
  );
}

function uniqueIds(items: unknown[]): boolean {
  return new Set(items.map((item) => (item as ObjectValue).id)).size === items.length;
}

function terminal(value: unknown): value is TerminalSnapshot {
  if (
    !object(value) ||
    !text(value.cwd, 512) ||
    !oneOf(value.mode, ['shell', 'wpa']) ||
    !stringList(value.history, 200) ||
    !stringRecord(value.variables) ||
    !stringRecord(value.files, 512_000) ||
    !stringList(value.directories, 2000, 512) ||
    !stringList(value.listKeys, 2000, 512)
  )
    return false;
  return (
    Object.values(value.files as ObjectValue).reduce<number>(
      (total, entry) => total + (entry as string).length,
      0,
    ) <= 2_000_000
  );
}

function lab(value: unknown): value is LabState {
  if (!object(value) || value.version !== 1 || !ap(value.ap) || !number(value.clock, 0))
    return false;
  if (
    !object(value.config) ||
    !stringRecord(value.config.staged) ||
    !stringRecord(value.config.committed) ||
    !stringRecord(value.config.runtime)
  )
    return false;
  const sta = value.sta;
  if (
    !object(sta) ||
    !oneOf(sta.status, ['connected', 'scanning', 'associating', 'disconnected', 'restarting']) ||
    !strings(sta, ['reason', 'ssid', 'bssid', 'ip']) ||
    !number(sta.rssi, -250, 100) ||
    !number(sta.snr, 0, 350) ||
    !integer(sta.mcs, -1, 13) ||
    !integer(sta.nss, 0, 4) ||
    !numbers(sta, ['phyRate', 'throughput'], 0, 1e8) ||
    !number(sta.freq, 0, 8000)
  )
    return false;
  if (!object(value.attenuation) || !numbers(value.attenuation, ['db', 'start'], 0, 90))
    return false;
  const net = value.network;
  if (
    !object(net) ||
    !networkMetadata(net) ||
    !booleans(net, ['serverRunning', 'dutServerRunning']) ||
    !number(net.dutServerPort) ||
    !numbers(net, ['wifiBytes', 'ethernetBytes'], 0, Number.MAX_SAFE_INTEGER)
  )
    return false;
  const internal = value.internal;
  if (
    !object(internal) ||
    !numbers(
      internal,
      [
        'phaseUntil',
        'retryAt',
        'scanBusyUntil',
        'lastScanAt',
        'pointElapsed',
        'measurementSum',
        'measurementSamples',
      ],
      0,
    ) ||
    !integer(internal.sequence, 0, Number.MAX_SAFE_INTEGER) ||
    !booleans(internal, ['lastScanVisible'])
  )
    return false;
  const msp = value.msp;
  if (
    !object(msp) ||
    !oneOf(msp.status, ['idle', 'running', 'completed', 'interrupted']) ||
    !settings(msp.settings) ||
    !Array.isArray(msp.runs) ||
    msp.runs.length > MAX_RUNS ||
    !msp.runs.every(run) ||
    !uniqueIds(msp.runs)
  )
    return false;
  if (
    msp.runs.reduce<number>(
      (total, item) => total + ((item as ObjectValue).points as unknown[]).length,
      0,
    ) > MAX_POINTS
  )
    return false;
  if (
    msp.activeRunId !== null &&
    (!text(msp.activeRunId, 1024) ||
      !msp.runs.some((item) => (item as ObjectValue).id === msp.activeRunId))
  )
    return false;
  if (
    msp.status === 'running' &&
    !msp.runs.some(
      (item) =>
        (item as ObjectValue).id === msp.activeRunId && (item as ObjectValue).status === 'running',
    )
  )
    return false;
  return (
    Array.isArray(value.logs) &&
    value.logs.length <= MAX_LOGS &&
    value.logs.every(log) &&
    uniqueIds(value.logs)
  );
}

/** Validate the entire candidate before callers construct or replace any active lab/session. */
export function parseSnapshot(value: unknown): SavedSnapshot | undefined {
  try {
    const candidate =
      typeof value === 'string'
        ? value.length <= MAX_JSON_LENGTH
          ? (JSON.parse(value) as unknown)
          : undefined
        : value;
    if (!object(candidate) || candidate.version !== 1 || !lab(candidate.lab)) return undefined;
    if (candidate.linux !== undefined && !terminal(candidate.linux)) return undefined;
    if (candidate.windows !== undefined && !terminal(candidate.windows)) return undefined;
    const chapter = number(candidate.chapter)
      ? Math.min(10, Math.max(0, Math.trunc(candidate.chapter)))
      : 0;
    const evidence = stringList(candidate.evidence, 5000) ? candidate.evidence.slice(-120) : [];
    const normalized: SavedSnapshot = { version: 1, lab: candidate.lab, chapter, evidence };
    if (candidate.linux !== undefined) normalized.linux = candidate.linux;
    if (candidate.windows !== undefined) normalized.windows = candidate.windows;
    const serialized = JSON.stringify(normalized);
    if (serialized.length > MAX_JSON_LENGTH) return undefined;
    // The successful result owns all nested data. Validation never alters the candidate or active workspace.
    return JSON.parse(serialized) as SavedSnapshot;
  } catch {
    return undefined;
  }
}
