import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { LabEngine } from './lab';
import { TerminalSession } from './terminal';
import { exportCsv, exportReport, exportXlsx } from './export';

function recordedLab() {
  const engine = new LabEngine();
  engine.reset('5');
  engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
  engine.startTest({ end: 10, step: 5, lowStep: 5, threshold: 0, duration: 1 });
  engine.tick(3);
  engine.setAttenuation(0);
  engine.updateAP({ txbf: false });
  engine.startTest({ end: 10, step: 5, lowStep: 5, threshold: 0, duration: 1 });
  engine.tick(1);
  engine.stopTest();
  return engine;
}

describe('recorded data exports', () => {
  it('exports native XY chart references for each complete or interrupted run without filling unmeasured points', () => {
    const state = recordedLab().state;
    expect(state.msp.runs.map((run) => [run.bf, run.status, run.points.length])).toEqual([
      [true, 'completed', 3],
      [false, 'interrupted', 1],
    ]);
    const archive = unzipSync(exportXlsx(state));
    const chart = strFromU8(archive['xl/charts/chart1.xml']);
    expect(chart).toContain('<c:scatterStyle val="lineMarker"/>');
    expect(chart.match(/<c:ser>/g)).toHaveLength(2);
    expect(chart).toContain('$L$2:$L$4');
    expect(chart).toContain('$R$2:$R$4');
    expect(chart).toContain('$L$5:$L$5');
    expect(chart).toContain('$R$5:$R$5');
    expect(chart).toContain('60A5FA');
    expect(chart).toContain('F87171');
    for (const run of state.msp.runs)
      for (const point of run.points) expect(chart).toContain(`<c:v>${point.throughput}</c:v>`);
    expect(strFromU8(archive['xl/worksheets/_rels/sheet1.xml.rels'])).toContain(
      '../drawings/drawing1.xml',
    );
    expect(strFromU8(archive['xl/drawings/_rels/drawing1.xml.rels'])).toContain(
      '../charts/chart1.xml',
    );
    const measurements = strFromU8(archive['xl/worksheets/sheet2.xml']);
    expect(measurements.match(/<row r=/g)).toHaveLength(5);
    expect(measurements).toContain('interrupted');
    const metadata = strFromU8(archive['xl/worksheets/sheet3.xml']);
    expect(metadata).toContain('metadata.ap.txbf');
    expect(metadata).toContain('metadata.runtime.wireless.MT7999_1_2.etxbfencond');
    expect(metadata).toContain('metadata.pending.wireless.MT7999_1_2.etxbfencond');
    expect(metadata).toContain('settings.seed');
    expect(strFromU8(archive['xl/worksheets/sheet4.xml'])).toContain('USER-STOP');
  });

  it('retains configured versus runtime BF, immutable AP snapshots, and typed negative RSSI in CSV', () => {
    const engine = recordedLab();
    engine.updateAP({ ssid: 'later AP' });
    const rows = exportCsv(engine.state).split('\r\n');
    expect(rows).toHaveLength(5);
    const first = rows[1].split(',');
    expect(first[8]).toBe('"0"');
    expect(first[9]).toBe('"3"');
    expect(first[10]).toBe('"true"');
    expect(first[12]).toMatch(/^"-\d/);
    const metadata = strFromU8(unzipSync(exportXlsx(engine.state))['xl/worksheets/sheet3.xml']);
    expect(metadata).toContain('BN68');
    expect(metadata).not.toContain('later AP');
  });

  it('finds renamed APCLI sections independently in configured and runtime BF snapshots', () => {
    const engine = new LabEngine();
    engine.reset('5');
    const terminal = new TerminalSession(engine, 'linux');
    expect(
      terminal.execute('uci rename wireless.stamld0=qa_client\nuci commit wireless\nwifi restart'),
    ).toContain('Wireless subsystem restarting');
    engine.tick(8);
    expect(engine.state.sta.status).toBe('connected');
    expect(
      terminal.execute(
        "uci set wireless.qa_client.device='MT7999_1_3'\nuci set wireless.MT7999_1_3.etxbfencond=0",
      ),
    ).toBe('');
    expect(engine.startTest({ end: 5, duration: 1, step: 5 })).toContain('Started');
    engine.tick(2);
    const run = engine.state.msp.runs[0];
    expect(run.metadata.runtime['wireless.stamld0.device']).toBeUndefined();
    expect(run.metadata.runtime['wireless.qa_client.device']).toBe('MT7999_1_2');
    const first = exportCsv(engine.state).split('\r\n')[1].split(',');
    expect(first[8]).toBe('"0"');
    expect(first[9]).toBe('"3"');
    const measurements = strFromU8(unzipSync(exportXlsx(engine.state))['xl/worksheets/sheet2.xml']);
    expect(measurements).toMatch(/<c r="I2"[^>]*>.*?<t[^>]*>0<\/t>/);
    expect(measurements).toMatch(/<c r="J2"[^>]*>.*?<t[^>]*>3<\/t>/);
    expect(exportReport(engine.state)).toContain('wireless.qa_client.device');
  });

  it('matches the engine active STA when another STA advertises the same interface first', () => {
    const engine = new LabEngine();
    engine.reset('5');
    const terminal = new TerminalSession(engine, 'linux');
    expect(
      terminal.execute(
        [
          'uci rename wireless.stamld0=primary_temp',
          'uci commit wireless',
          'uci set wireless.secondary=wifi-iface',
          'uci set wireless.secondary.mode=sta',
          'uci set wireless.secondary.ifname=stamld0',
          'uci set wireless.secondary.device=MT7999_1_3',
          'uci set wireless.secondary.ssid=BN68_6G',
          'uci set wireless.MT7999_1_3.etxbfencond=0',
          'uci commit wireless',
          'uci rename wireless.primary_temp=stamld0',
          'uci commit wireless',
          'wifi restart',
        ].join('\n'),
      ),
    ).toContain('Wireless subsystem restarting');
    engine.tick(8);
    expect(engine.state.sta.status).toBe('connected');
    expect(terminal.execute('iw dev stamld0 link')).toContain('freq: 5180');
    expect(engine.startTest({ direction: 'UL', end: 5, duration: 1, step: 5 })).toContain(
      'Started',
    );
    engine.tick(2);
    const run = engine.state.msp.runs[0];
    const keys = Object.keys(run.metadata.runtime);
    expect(keys.indexOf('wireless.secondary.mode')).toBeLessThan(
      keys.indexOf('wireless.stamld0.mode'),
    );
    expect(run.bf).toBe(true);
    expect(run.points.every((point) => point.bf)).toBe(true);
    const first = exportCsv(engine.state).split('\r\n')[1].split(',');
    expect(first[4]).toBe('"UL"');
    expect(first[6]).toBe('"ON"');
    expect(first[8]).toBe('"3"');
    expect(first[9]).toBe('"3"');
    const measurements = strFromU8(unzipSync(exportXlsx(engine.state))['xl/worksheets/sheet2.xml']);
    expect(measurements).toMatch(/<c r="I2"[^>]*><is><t[^>]*>3<\/t><\/is><\/c>/);
    expect(measurements).toMatch(/<c r="J2"[^>]*><is><t[^>]*>3<\/t><\/is><\/c>/);
  });

  it('escapes custom labels and logs in all formats and preserves actual SVG point values', () => {
    const state = recordedLab().state;
    state.msp.runs[0].label = '=1+1,<script>alert("qa")</script>';
    state.logs.push({
      id: 'untrusted-label',
      time: 10,
      source: 'QA',
      level: 'INFO',
      message: '<img src=x onerror=alert(1)>',
    });
    const csv = exportCsv(state);
    expect(csv).toContain('"\'=1+1,<script>alert(""qa"")</script>"');
    const report = exportReport(state);
    expect(report).not.toContain('<script>');
    expect(report).not.toContain('<img src=x');
    expect(report).toContain('&lt;script&gt;');
    expect(report.match(/<circle /g)).toHaveLength(4);
    expect(report).toContain(`${state.msp.runs[0].points[0].throughput} Mbps</title>`);
    expect(report).toContain('非真實量測');
    expect(report).toContain('USER-STOP');
    const chart = strFromU8(unzipSync(exportXlsx(state))['xl/charts/chart1.xml']);
    expect(chart).toContain('&lt;script&gt;');
    expect(chart).not.toContain('<script>');
  });

  it('exports an empty workspace honestly with no invented chart or measurements', () => {
    const state = new LabEngine().state;
    const files = unzipSync(exportXlsx(state));
    expect(files['xl/charts/chart1.xml']).toBeUndefined();
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('尚無已測資料');
    expect(exportCsv(state).split('\r\n')).toHaveLength(1);
    expect(exportReport(state)).toContain('尚無已測資料');
  });
});
