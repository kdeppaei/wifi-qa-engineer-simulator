import { describe, expect, it } from 'vitest';
import { LabEngine } from './lab';
import { TerminalSession } from './terminal';
import { parseSnapshot } from './storage';

function validSnapshot() {
  const engine = new LabEngine();
  engine.reset('5');
  engine.startTest({ end: 5, duration: 1, step: 5 });
  engine.tick(2);
  const linux = new TerminalSession(engine, 'linux');
  const windows = new TerminalSession(engine, 'windows');
  linux.execute('echo preserved > /tmp/evidence.txt');
  return {
    version: 1,
    lab: engine.state,
    linux: linux.snapshot(),
    windows: windows.snapshot(),
    chapter: 5,
    evidence: ['iw dev stamld0 link'],
  };
}

describe('transactional workspace snapshots', () => {
  it('round-trips all recorded points, runtime and terminal files while returning an independent deep clone', () => {
    const original = validSnapshot();
    const restored = parseSnapshot(JSON.stringify(original));
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
    restored!.lab.ap.ssid = 'changed copy';
    restored!.lab.msp.runs[0].points[0].throughput = 0;
    restored!.linux!.files['/tmp/evidence.txt'] = 'changed copy';
    expect(original.lab.ap.ssid).toBe('BN68');
    expect(original.lab.msp.runs[0].points[0].throughput).toBeGreaterThan(0);
    expect(original.linux.files['/tmp/evidence.txt']).toBe('preserved\n');
    const engine = new LabEngine(parseSnapshot(original)!.lab);
    expect(
      new TerminalSession(engine, 'linux', parseSnapshot(original)!.linux).execute(
        'cat /tmp/evidence.txt',
      ),
    ).toBe('preserved');
  });

  it('rejects incomplete or malformed essential lab records instead of returning a partially usable workspace', () => {
    const corruptions: ((value: ReturnType<typeof validSnapshot>) => void)[] = [
      (value) => {
        delete (value.lab as Partial<typeof value.lab>).sta;
      },
      (value) => {
        value.lab.ap.power = 'true' as unknown as boolean;
      },
      (value) => {
        value.lab.config.runtime['wireless.stamld0.ssid'] = 5 as unknown as string;
      },
      (value) => {
        value.lab.network.ethernetMbps = Infinity;
      },
      (value) => {
        value.lab.sta.rssi = NaN;
      },
      (value) => {
        value.lab.sta.status = 'rebooting' as typeof value.lab.sta.status;
      },
      (value) => {
        value.lab.msp.runs[0].metadata.ap.band = '7' as typeof value.lab.ap.band;
      },
      (value) => {
        value.lab.msp.runs[0].points[0].throughput = 'fast' as unknown as number;
      },
      (value) => {
        value.lab.internal.lastScanVisible = undefined as unknown as boolean;
      },
      (value) => {
        value.lab.msp.activeRunId = 'missing-run';
      },
    ];
    for (const corrupt of corruptions) {
      const candidate = validSnapshot();
      corrupt(candidate);
      expect(parseSnapshot(candidate)).toBeUndefined();
    }
    expect(parseSnapshot(null)).toBeUndefined();
    expect(parseSnapshot('{')).toBeUndefined();
    expect(parseSnapshot({ version: 2 })).toBeUndefined();
  });

  it('accepts absent terminal snapshots but rejects every malformed supplied terminal shape', () => {
    const original = validSnapshot();
    const withoutTerminals = {
      version: original.version,
      lab: original.lab,
      chapter: original.chapter,
      evidence: original.evidence,
    };
    expect(parseSnapshot(withoutTerminals)).toEqual(withoutTerminals);
    for (const linux of [
      null,
      {},
      { ...original.linux, history: undefined },
      { ...original.linux, files: { '/tmp/x': 5 } },
      { ...original.linux, directories: '/tmp' },
      { ...original.linux, mode: 'cmd' },
    ]) {
      expect(parseSnapshot({ ...original, linux })).toBeUndefined();
    }
    expect(
      parseSnapshot({ ...original, windows: { ...original.windows, listKeys: [3] } }),
    ).toBeUndefined();
    expect(original.lab.ap.ssid).toBe('BN68');
  });

  it('normalizes chapter and evidence without allowing malformed UI preferences to crash the application', () => {
    const original = validSnapshot();
    expect(parseSnapshot({ ...original, chapter: 999 })?.chapter).toBe(10);
    expect(parseSnapshot({ ...original, chapter: -5 })?.chapter).toBe(0);
    expect(parseSnapshot({ ...original, chapter: 3.9 })?.chapter).toBe(3);
    expect(parseSnapshot({ ...original, chapter: NaN, evidence: 'ping' })?.evidence).toEqual([]);
    expect(parseSnapshot({ ...original, chapter: undefined, evidence: [3] })?.chapter).toBe(0);
    expect(
      parseSnapshot({ ...original, evidence: Array.from({ length: 150 }, (_, i) => String(i)) })
        ?.evidence,
    ).toEqual(Array.from({ length: 120 }, (_, i) => String(i + 30)));
  });

  it('bounds stored dimensions and rejects duplicate run identities and nonfinite metadata', () => {
    const original = validSnapshot();
    const duplicate = structuredClone(original.lab.msp.runs[0]);
    expect(
      parseSnapshot({
        ...original,
        lab: {
          ...original.lab,
          msp: { ...original.lab.msp, runs: [original.lab.msp.runs[0], duplicate] },
        },
      }),
    ).toBeUndefined();
    expect(
      parseSnapshot({
        ...original,
        lab: {
          ...original.lab,
          logs: Array.from({ length: 3001 }, (_, i) => ({
            id: `log-${i}`,
            time: 0,
            source: 'LAB',
            level: 'INFO',
            message: '',
          })),
        },
      }),
    ).toBeUndefined();
    expect(
      parseSnapshot({
        ...original,
        linux: { ...original.linux, files: { '/tmp/too-large': 'x'.repeat(512001) } },
      }),
    ).toBeUndefined();
    original.lab.msp.runs[0].metadata.negotiatedWidth = Infinity;
    expect(parseSnapshot(original)).toBeUndefined();
  });

  it('preserves finite invalid MSP input for troubleshooting and interrupts a restored active run', () => {
    const original = validSnapshot();
    original.lab.msp.settings.port = 0;
    expect(parseSnapshot(original)?.lab.msp.settings.port).toBe(0);
    const engine = new LabEngine();
    engine.startTest({ duration: 60 });
    const candidate = parseSnapshot({ version: 1, lab: engine.state });
    expect(candidate).toBeDefined();
    expect(new LabEngine(candidate!.lab).state.msp.status).toBe('interrupted');
    expect(engine.state.msp.status).toBe('running');
  });
});
