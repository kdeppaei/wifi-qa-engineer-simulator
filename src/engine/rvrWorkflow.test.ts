import { describe, expect, it } from 'vitest';
import { LabEngine, type Band, type TestRun } from './lab';
import { TerminalSession } from './terminal';
import { exportCsv, exportReport, exportXlsx } from './export';
import { evaluateWorkflowStep, workflows } from './workflow';
import {
  evaluateRvrStep,
  RVR_FLOW_ID,
  RVR_STEP_IDS,
  selectRvrPairState,
  validateRvrOffPreflight,
  validateRvrOnPreflight,
  validateRvrPair,
  type RvrExportReceipt,
} from './rvrWorkflow';

function make(band: Band = '5') {
  const engine = new LabEngine();
  engine.reset(band);
  Object.assign(engine.state.msp.settings, {
    direction: 'DL',
    protocol: 'TCP',
    start: 0,
    end: 20,
    step: 10,
    lowStep: 1,
    threshold: 400,
    duration: 1,
    seed: 42,
  });
  return engine;
}
function finish(engine: LabEngine): void {
  for (let i = 0; i < 500 && engine.state.msp.status === 'running'; i++) engine.tick();
}
function onRun(engine: LabEngine): TestRun {
  engine.updateAP({ txbf: true });
  engine.setAttenuation(engine.state.msp.settings.start);
  expect(validateRvrOnPreflight(engine.state).valid).toBe(true);
  expect(engine.startTest()).toMatch(/^Started/);
  const run = engine.state.msp.runs.at(-1)!;
  finish(engine);
  return run;
}
function offRun(engine: LabEngine, on: TestRun): TestRun {
  engine.setAttenuation(on.settings.start);
  engine.updateAP({ txbf: false });
  expect(validateRvrOffPreflight(engine.state, on.id).valid).toBe(true);
  expect(engine.startTest()).toMatch(/^Started/);
  const run = engine.state.msp.runs.at(-1)!;
  finish(engine);
  return run;
}
function pair(band: Band = '5') {
  const engine = make(band);
  const on = onRun(engine);
  const off = offRun(engine, on);
  return { engine, on, off };
}

describe('pinned DL TCP BF comparison', () => {
  it('exposes a non-mutating workflow with exact typed action and step IDs', () => {
    const engine = make();
    const before = engine.exportState();
    const flow = workflows.find((item) => item.id === RVR_FLOW_ID)!;
    expect(flow.steps.map((item) => item.id)).toEqual(Object.values(RVR_STEP_IDS));
    expect(evaluateWorkflowStep(flow.steps[0], engine.state).status).toBe('ready');
    expect(engine.exportState()).toBe(before);
  });

  it.each(['2.4', '5', '6'] as Band[])(
    'accepts an actual complete comparable pair on %s GHz',
    (band) => {
      const { engine, on, off } = pair(band);
      expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(true);
      expect(on.bf).toBe(true);
      expect(off.bf).toBe(false);
      expect(on.metadata.transmitter).toBe('AP');
      expect(off.metadata.transmitter).toBe('AP');
      expect(on.points[0].attenuation).toBe(0);
      expect(off.points.at(-1)!.attenuation).toBe(20);
    },
  );

  it('checks effective AP BF, readback, applied config, numeric settings and Server before ON', () => {
    const engine = make();
    engine.updateAP({ txbf: false });
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.updateAP({ txbf: true });
    engine.setAttenuation(10);
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.setAttenuation(0);
    engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.commit();
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.restart();
    engine.tick(6);
    expect(validateRvrOnPreflight(engine.state).valid).toBe(true);
    engine.state.msp.settings.seed = 1.5;
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.state.msp.settings.seed = 42;
    engine.state.msp.settings.end = 0;
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.state.msp.settings.end = 20;
    engine.state.network.serverRunning = false;
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
    engine.state.network.serverRunning = true;
    engine.state.network.bypass = true;
    expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
  });

  it.each(['pending', 'committed'] as const)(
    'rejects an actual free-MSP pair captured with %s but unapplied UCI settings',
    (layer) => {
      const engine = make();
      const terminal = new TerminalSession(engine, 'linux');
      expect(terminal.execute('uci set wireless.MT7999_1_2.etxbfencond=0')).toBe('');
      if (layer === 'committed') expect(terminal.execute('uci commit wireless')).toBe('');
      expect(validateRvrOnPreflight(engine.state).valid).toBe(false);
      expect(engine.state.sta.status).toBe('connected');

      expect(engine.startTest()).toMatch(/^Started/);
      const on = engine.state.msp.runs.at(-1)!;
      finish(engine);
      engine.setAttenuation(on.settings.start);
      engine.updateAP({ txbf: false });
      expect(engine.startTest()).toMatch(/^Started/);
      const off = engine.state.msp.runs.at(-1)!;
      finish(engine);

      for (const run of [on, off]) {
        expect(run.status).toBe('completed');
        expect(run.points.length).toBeGreaterThanOrEqual(2);
        expect(run.metadata.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('3');
        if (layer === 'pending')
          expect(run.metadata.pending['wireless.MT7999_1_2.etxbfencond']).toBe('0');
        else {
          expect(run.metadata.pending).toEqual({});
          expect(run.metadata.committed['wireless.MT7999_1_2.etxbfencond']).toBe('0');
        }
      }
      const result = validateRvrPair(engine.state, on.id, off.id);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/Pending|Driver/);
      expect(() => selectRvrPairState(engine.state, on.id, off.id)).toThrow(result.message);
    },
  );

  it('ignores non-wireless STA prefixes when the engine uses a recreated wireless section', () => {
    const engine = make();
    const terminal = new TerminalSession(engine, 'linux');
    terminal.execute(
      'uci rename wireless.stamld0=actual; uci set wireless.actual.ifname=wlan0; ' +
        'uci set network.fake.mode=sta; uci set network.fake.ifname=stamld0; ' +
        'uci set network.fake.device=MT7999_1_3; uci commit wireless; uci commit network; ' +
        'wifi restart; sleep 6',
    );
    expect(terminal.variables['?']).toBe('0');
    expect(engine.state.config.runtime['wireless.stamld0.mode']).toBeUndefined();
    expect(engine.state.config.runtime['wireless.actual.device']).toBe('MT7999_1_2');
    expect(terminal.execute('iw dev stamld0 link')).toContain('freq: 5180');
    expect(validateRvrOnPreflight(engine.state).valid).toBe(true);
    const on = onRun(engine),
      off = offRun(engine, on);
    expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(true);
  });

  it('rejects changed seed/parameters before OFF without modifying settings or adding runs', () => {
    const engine = make();
    const on = onRun(engine);
    engine.setAttenuation(0);
    engine.updateAP({ txbf: false });
    const count = engine.state.msp.runs.length;
    for (const [key, value] of [
      ['seed', 43],
      ['streams', 1],
      ['duration', 2],
      ['end', 30],
      ['step', 5],
      ['lowStep', 2],
      ['threshold', 200],
      ['port', 5201],
    ] as const) {
      const before = engine.state.msp.settings[key];
      engine.state.msp.settings[key] = value;
      expect(validateRvrOffPreflight(engine.state, on.id).valid, key).toBe(false);
      expect(engine.state.msp.settings[key]).toBe(value);
      expect(engine.state.msp.runs.length).toBe(count);
      engine.state.msp.settings[key] = before;
    }
    expect(validateRvrOffPreflight(engine.state, on.id).valid).toBe(true);
  });

  it('rejects changed AP, credentials, runtime, committed, pending, endpoint and backhaul conditions', () => {
    const alterations: ((engine: LabEngine) => void)[] = [
      (engine) => engine.updateAP({ channel: 44 }),
      (engine) => engine.updateAP({ width: 80 }),
      (engine) => engine.updateAP({ password: 'different' }),
      (engine) => engine.updateAP({ band: '6' }),
      (engine) => {
        engine.state.network.ethernetMbps = 1000;
      },
      (engine) => {
        engine.state.network.pcIp = '192.168.1.201';
        engine.state.network.serverIp = '192.168.1.201';
        engine.state.msp.settings.serverIp = '192.168.1.201';
      },
      (engine) => {
        engine.state.config.runtime['wireless.MT7999_1_2.nss'] = '1';
        engine.state.config.committed['wireless.MT7999_1_2.nss'] = '1';
      },
      (engine) => {
        engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond'] = '0';
        engine.state.config.committed['wireless.MT7999_1_2.etxbfencond'] = '0';
      },
      (engine) => engine.stage('wireless.stamld0.ssid', 'BN68'),
    ];
    for (const alter of alterations) {
      const engine = make();
      const on = onRun(engine);
      engine.setAttenuation(0);
      engine.updateAP({ txbf: false });
      alter(engine);
      engine.tick(5);
      expect(validateRvrOffPreflight(engine.state, on.id).valid).toBe(false);
    }
  });

  it('uses only specified pins when old completed 6G runs coexist with the new 5G comparison', () => {
    const engine = make('6');
    const oldOn = onRun(engine);
    const oldOff = offRun(engine, oldOn);
    engine.setAttenuation(0);
    engine.updateAP({ band: '5', channel: 36, ssid: 'BN68' });
    engine.stage('wireless.stamld0.device', 'MT7999_1_2');
    engine.stage('wireless.stamld0.ssid', 'BN68');
    engine.commit();
    engine.restart();
    engine.tick(6);
    const on = onRun(engine),
      off = offRun(engine, on);
    expect(engine.state.msp.runs).toHaveLength(4);
    expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(true);
    expect(validateRvrPair(engine.state, oldOn.id, off.id).valid).toBe(false);
    expect(validateRvrPair(engine.state, on.id, oldOff.id).valid).toBe(false);
    expect(validateRvrPair(engine.state).valid).toBe(false);
    expect(validateRvrPair(engine.state, 'missing', off.id).valid).toBe(false);
    const selected = selectRvrPairState(engine.state, on.id, off.id);
    expect(selected.msp.runs.map((run) => run.id)).toEqual([on.id, off.id]);
    expect(selected.ap.band).toBe('5');
    expect(engine.state.msp.runs).toHaveLength(4);
    selected.msp.runs[0].points[0].throughput = 0;
    expect(on.points[0].throughput).toBeGreaterThan(0);
  });

  it('accepts different actual adaptive grids without interpolation or requiring equal point counts', () => {
    const engine = make();
    Object.assign(engine.state.msp.settings, { end: 65, step: 5 });
    const on = onRun(engine),
      off = offRun(engine, on);
    expect(on.points.length).not.toBe(off.points.length);
    expect(on.points.at(-1)!.attenuation).toBe(65);
    expect(off.points.at(-1)!.attenuation).toBe(65);
    expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(true);
    expect(selectRvrPairState(engine.state, on.id, off.id).msp.runs[0].points).toEqual(on.points);
  });

  it('waits for the new active Run and fails its interruption rather than falling back to an old ON', () => {
    const engine = make();
    onRun(engine);
    engine.setAttenuation(0);
    engine.updateAP({ txbf: true });
    engine.startTest();
    const id = engine.state.msp.activeRunId!;
    const attempt = { runId: id, onRunId: id, startedAt: engine.state.clock };
    expect(evaluateRvrStep('rvr-on-started', engine.state, attempt).status).toBe('success');
    expect(evaluateRvrStep('rvr-on-complete', engine.state, attempt).status).toBe('waiting');
    expect(evaluateRvrStep('rvr-on-complete', engine.state).status).toBe('failure');
    expect(
      evaluateRvrStep('rvr-on-complete', engine.state, { ...attempt, runId: 'wrong' }).status,
    ).toBe('failure');
    engine.tick();
    engine.setAttenuation(90);
    expect(evaluateRvrStep('rvr-on-complete', engine.state, attempt).status).toBe('failure');
    expect(engine.state.msp.runs.at(-1)!.points).toHaveLength(1);
    expect(validateRvrOffPreflight(engine.state, id).valid).toBe(false);
  });

  it('requires exact new started IDs and validates OFF snapshots against the pinned ON', () => {
    const engine = make();
    const on = onRun(engine);
    engine.setAttenuation(0);
    engine.updateAP({ txbf: false });
    engine.startTest();
    const offId = engine.state.msp.activeRunId!;
    expect(
      evaluateRvrStep('rvr-off-started', engine.state, {
        runId: offId,
        onRunId: on.id,
        offRunId: offId,
        startedAt: engine.state.clock,
      }).status,
    ).toBe('success');
    expect(
      evaluateRvrStep('rvr-off-started', engine.state, {
        runId: offId,
        onRunId: on.id,
        offRunId: on.id,
      }).status,
    ).toBe('failure');
    expect(evaluateRvrStep('rvr-off-started', engine.state, { runId: offId }).status).toBe(
      'failure',
    );
    engine.state.msp.runs.at(-1)!.settings.seed = 99;
    expect(
      evaluateRvrStep('rvr-off-started', engine.state, { runId: offId, onRunId: on.id }).status,
    ).toBe('failure');
  });

  it('rejects partial, single-point, missing-endpoint, wrong-direction and malformed-point pairs', () => {
    const changes: ((off: TestRun) => void)[] = [
      (off) => {
        off.status = 'interrupted';
        off.error = 'NETWORK-NOT-FOUND';
      },
      (off) => {
        off.points = [off.points[0]];
      },
      (off) => {
        off.points.pop();
      },
      (off) => {
        off.points.shift();
      },
      (off) => {
        off.direction = 'UL';
      },
      (off) => {
        off.points[1].attenuation = off.points[0].attenuation;
      },
      (off) => {
        off.points[1].throughput = Number.NaN;
      },
      (off) => {
        off.points[1].bf = true;
      },
    ];
    for (const change of changes) {
      const { engine, on, off } = pair();
      change(off);
      expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(false);
      expect(() => selectRvrPairState(engine.state, on.id, off.id)).toThrow();
    }
    const engine = make();
    Object.assign(engine.state.msp.settings, { start: 0, end: 0 });
    engine.startTest();
    engine.tick();
    const on = engine.state.msp.runs.at(-1)!;
    engine.updateAP({ txbf: false });
    engine.startTest();
    engine.tick();
    const off = engine.state.msp.runs.at(-1)!;
    expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(false);
  });

  it('rejects mismatched firmware/model/transmitter and any non-AP-BF snapshot difference', () => {
    const changes: ((off: TestRun) => void)[] = [
      (off) => {
        off.metadata.firmware = 'other';
      },
      (off) => {
        off.metadata.modelVersion = '2.0';
      },
      (off) => {
        off.metadata.transmitter = 'STA';
      },
      (off) => {
        off.metadata.ap.channel = 44;
      },
      (off) => {
        off.metadata.runtime['wireless.MT7999_1_2.nss'] = '1';
      },
      (off) => {
        off.metadata.committed['network.lan.gateway'] = '192.168.1.9';
      },
      (off) => {
        off.metadata.pending['wireless.stamld0.ssid'] = 'OTHER';
      },
      (off) => {
        off.metadata.network.ethernetMbps = 1000;
      },
      (off) => {
        off.metadata.negotiatedWidth = 80;
      },
    ];
    for (const change of changes) {
      const { engine, on, off } = pair();
      change(off);
      expect(validateRvrPair(engine.state, on.id, off.id).valid).toBe(false);
    }
  });

  it('restores the captured start without silently changing newly edited settings', () => {
    const engine = make();
    engine.state.msp.settings.start = 5;
    engine.setAttenuation(5);
    const on = onRun(engine);
    engine.state.msp.settings.start = 10;
    engine.setAttenuation(on.settings.start);
    expect(evaluateRvrStep('rvr-at-start', engine.state, { onRunId: on.id }).status).toBe(
      'success',
    );
    expect(evaluateRvrStep('rvr-connected-start', engine.state, { onRunId: on.id }).status).toBe(
      'success',
    );
    expect(evaluateRvrStep('rvr-connected-start', engine.state, {}).status).toBe('failure');
    expect(evaluateRvrStep('rvr-at-captured-start', engine.state, {}).status).toBe('failure');
    expect(evaluateRvrStep('rvr-connected-captured-start', engine.state, {}).status).toBe(
      'failure',
    );
    expect(
      evaluateRvrStep('rvr-connected-captured-start', engine.state, { onRunId: on.id }).status,
    ).toBe('success');
    engine.updateAP({ txbf: false });
    expect(validateRvrOffPreflight(engine.state, on.id).valid).toBe(false);
    expect(engine.state.msp.settings.start).toBe(10);
  });

  it('requires an explicit comparison action and real matching nonempty export receipts', () => {
    const { engine, on, off } = pair();
    const context = { onRunId: on.id, offRunId: off.id };
    const compare = workflows
      .find((item) => item.id === RVR_FLOW_ID)!
      .steps.find((item) => item.id === RVR_STEP_IDS.compare)!;
    expect(evaluateWorkflowStep(compare, engine.state).status).toBe('ready');
    expect(
      evaluateWorkflowStep(compare, engine.state, { ...context, action: 'rvr-verify-pair' }).status,
    ).toBe('success');
    expect(
      evaluateWorkflowStep(compare, engine.state, { ...context, action: 'rvr-start-off' }).status,
    ).toBe('failure');
    const selected = selectRvrPairState(engine.state, on.id, off.id);
    const files = {
      csv: exportCsv(selected),
      xlsx: exportXlsx(selected),
      report: exportReport(selected),
      log: selected.logs.map((entry) => `${entry.time} ${entry.message}`).join('\n'),
    };
    for (const kind of ['csv', 'xlsx', 'report', 'log'] as const) {
      const data = files[kind],
        bytes =
          typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
      const receipt: RvrExportReceipt = {
        kind,
        ...context,
        pointCount: on.points.length + off.points.length,
        bytes,
        generatedAt: engine.state.clock,
      };
      expect(
        evaluateRvrStep(`rvr-exported-${kind}`, engine.state, {
          ...context,
          exportReceipt: receipt,
          startedAt: engine.state.clock,
        }).status,
      ).toBe('success');
      expect(
        evaluateRvrStep(`rvr-exported-${kind}`, engine.state, {
          ...context,
          exportReceipt: { ...receipt, bytes: 0 },
        }).status,
      ).toBe('failure');
      expect(
        evaluateRvrStep(`rvr-exported-${kind}`, engine.state, {
          ...context,
          exportReceipt: { ...receipt, onRunId: 'other' },
        }).status,
      ).toBe('failure');
      expect(
        evaluateRvrStep(`rvr-exported-${kind}`, engine.state, {
          ...context,
          exportReceipt: { ...receipt, pointCount: 99 },
        }).status,
      ).toBe('failure');
      expect(
        evaluateRvrStep(`rvr-exported-${kind}`, engine.state, {
          ...context,
          exportReceipt: receipt,
          error: 'Download failed',
        }).status,
      ).toBe('failure');
    }
    expect(evaluateRvrStep('rvr-exported-csv', engine.state, context).status).toBe('failure');
  });
});
