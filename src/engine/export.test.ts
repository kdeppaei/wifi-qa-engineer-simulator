import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { LabEngine } from './lab';
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
