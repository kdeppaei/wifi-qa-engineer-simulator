import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { makeWorkbook, reportPrintNames, reportPrintSetup } from './workbook';
import { defaultChartOptions, validateChartOptions, type ChartOptions } from './presentation';

const one = [
  [
    { db: 0, mbps: 980 },
    { db: 7.5, mbps: null },
    { db: 30, mbps: 0 },
  ],
];
const two = [
  ...one,
  [
    { db: 5, mbps: 940 },
    { db: 30, mbps: 20 },
  ],
];
const text = (files: ReturnType<typeof unzipSync>, path: string) => strFromU8(files[path]);

describe('native editable Excel chart presentation', () => {
  it('links the title and series names to editable cells, independent of the source note', () => {
    const options = defaultChartOptions(true);
    options.title = '5 GHz TCP <DL> & TxBF';
    options.curves[0].name = 'FW A <ON>';
    options.curves[1].name = 'FW B & OFF';
    const files = unzipSync(makeWorkbook(two, 'MSP', '4 streams', undefined, options));
    const sheet = text(files, 'xl/worksheets/sheet2.xml');
    const chart = text(files, 'xl/drawings/charts/chart2.xml');
    expect(sheet).toMatch(/r="A2"[^>]*>[\s\S]*?5 GHz TCP &lt;DL&gt; &amp; TxBF/);
    expect(sheet).toMatch(/r="B6"[^>]*>[\s\S]*?FW A &lt;ON&gt;/);
    expect(sheet).toMatch(/r="E6"[^>]*>[\s\S]*?FW B &amp; OFF/);
    expect(sheet).toContain('Source: MSP / 4 streams');
    const title = chart.match(/<c:title>[\s\S]*?<\/c:title>/)?.[0];
    expect(title).toContain("<c:strRef><c:f>'TxBF'!$A$2</c:f>");
    expect(title).toContain('5 GHz TCP &lt;DL&gt; &amp; TxBF');
    expect(chart).toContain("<c:strRef><c:f>'TxBF'!$B$6</c:f>");
    expect(chart).toContain("<c:strRef><c:f>'TxBF'!$E$6</c:f>");
    expect(chart).not.toContain('<c:tx><c:v>');
    expect(sheet).not.toContain('SERIES');
    expect(sheet).toContain('X：dB；Y：Throughput (Mbps)');
  });

  it('uses real Excel strokes, marker shapes and chart switches, retaining straight numeric XY data', () => {
    const options = defaultChartOptions(true);
    Object.assign(options.curves[0], {
      color: '#009a73',
      lineStyle: 'dash',
      lineWidth: 3.5,
      marker: 'diamond',
      markerSize: 9,
    });
    Object.assign(options.curves[1], {
      color: '#ad34bc',
      lineStyle: 'dot',
      lineWidth: 1,
      marker: 'triangle',
      markerSize: 6,
    });
    options.showLegend = false;
    options.showGrid = false;
    const files = unzipSync(makeWorkbook(two, 'MSP', '', undefined, options));
    const chart = text(files, 'xl/drawings/charts/chart2.xml');
    const series = chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g)!;
    expect(series[0]).toContain('<a:ln w="44450">');
    expect(series[0]).toContain('<a:srgbClr val="009A73"/>');
    expect(series[0]).toContain('<a:prstDash val="dash"/>');
    expect(series[0]).toContain('<c:symbol val="diamond"/>');
    expect(series[0]).toContain('<c:size val="9"/>');
    expect(series[1]).toContain('<a:prstDash val="sysDot"/>');
    expect(series[1]).toContain('<c:symbol val="triangle"/>');
    expect(chart).not.toContain('<c:legend>');
    expect(chart).not.toContain('<c:majorGridlines>');
    expect(chart).toContain('<c:scatterStyle val="lineMarker"/>');
    expect(chart).toContain('<c:dispBlanksAs val="gap"/>');
    expect(chart.match(/<c:smooth val="0"\/>/g)).toHaveLength(2);
    expect(series[0]).toContain("'TxBF'!$A$7:$A$1006");
    expect(series[1]).toContain("'TxBF'!$D$7:$D$1006");
    expect(series[0]).toContain('<c:pt idx="2"><c:v>0</c:v></c:pt>');
    expect(series[0]).not.toContain('<c:pt idx="1"><c:v>0</c:v></c:pt>');
  });

  it('supports markers only and lines only without replacing native chart objects with images', () => {
    const options = defaultChartOptions(true);
    Object.assign(options.curves[0], { lineStyle: 'none', marker: 'square' });
    Object.assign(options.curves[1], { marker: 'none' });
    const files = unzipSync(makeWorkbook(two, 'user', '', undefined, options));
    const chart = text(files, 'xl/drawings/charts/chart2.xml');
    expect(chart).toContain('<a:ln><a:noFill/></a:ln>');
    expect(chart).toContain('<c:symbol val="square"/>');
    expect(chart).toContain('<c:symbol val="none"/>');
    expect(chart).toContain('<c:legend>');
    expect(chart).toContain('<c:majorGridlines>');
    expect(text(files, 'xl/drawings/drawing2.xml')).toContain('<c:chart');
    expect(Object.keys(files).filter((path) => path.startsWith('xl/media/'))).toHaveLength(0);
    expect(text(files, 'xl/worksheets/sheet2.xml')).not.toContain('sheetProtection');
    expect(chart).not.toContain('<c:protection');
    expect(text(files, 'xl/drawings/drawing2.xml')).not.toMatch(/noSelect="(?:1|true)"/);
  });

  it('wraps wider custom headers without shrinking fonts or hiding the blank/zero distinction', () => {
    const options = defaultChartOptions(false);
    options.curves[0].name = 'Firmware variant A measured downlink throughput in Mbps';
    const files = unzipSync(makeWorkbook(one, 'user', '', undefined, options));
    const sheet = text(files, 'xl/worksheets/sheet1.xml');
    const styles = text(files, 'xl/styles.xml');
    expect(sheet).toMatch(/<x:row\b[^>]*\br="6"[^>]*\bht="48"[^>]*\bcustomHeight="1"/);
    expect(styles).toContain('wrapText="1"');
    expect(sheet).toMatch(/r="B8"[^>]*\/>/);
    expect(sheet).toMatch(/r="B9"[^>]*><x:v>0<\/x:v>/);
    expect(sheet).not.toContain('<x:pane');
    expect(sheet).toContain('showGridLines="0"');
  });

  it('prints the chart and measured table without reserved input rows or instructional text', () => {
    const files = unzipSync(makeWorkbook(two, 'MSP', 'TCP DL'));
    const sheet = text(files, 'xl/worksheets/sheet2.xml');
    const workbook = text(files, 'xl/workbook.xml');
    const styles = text(files, 'xl/styles.xml');
    expect(sheet).toContain('ref="A2:Q2"');
    expect(sheet).toContain('paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(workbook).toContain("'TxBF'!$A$2:$Q$28");
    expect(workbook).toContain("'TxBF'!$6:$6");
    expect(styles).not.toContain('FFFFF8DF');
    expect(styles).toContain('<x:bottom style="thin">');
    expect(sheet).not.toContain('從第 7 列貼入');
    expect(sheet).not.toContain('選取資料');
    const style = (address: string) => sheet.match(new RegExp(`r="${address}"[^>]*s="(\\d+)"`))![1];
    expect(style('B9')).not.toBe(style('B10'));
    // Numeric zero and a missing Y measurement retain different native cell types.
    expect(sheet).toMatch(/r="B8"[^>]*\/>/);
    expect(sheet).toMatch(/r="B9"[^>]*><x:v>0<\/x:v>/);
    expect(text(files, 'xl/drawings/charts/chart2.xml')).toContain("'TxBF'!$B$7:$B$1006");
  });

  it('extends the printable measured range for longer runs without painting unused input rows', () => {
    const points = Array.from({ length: 100 }, (_v, index) => ({ db: index, mbps: 100 - index }));
    const files = unzipSync(makeWorkbook([points], 'MSP', ''));
    expect(text(files, 'xl/workbook.xml')).toContain("'Single'!$A$2:$Q$106");
    expect(text(files, 'xl/worksheets/sheet1.xml')).toMatch(/r="B106"[^>]*><x:v>1<\/x:v>/);
  });

  it('keeps the reusable inactive worksheet blank and report styled with its own live chart bindings', () => {
    const files = unzipSync(makeWorkbook(one, 'MSP', ''));
    const inactive = text(files, 'xl/worksheets/sheet2.xml');
    expect(inactive).toContain('showGridLines="0"');
    expect(inactive).toContain('ref="A2:Q2"');
    expect(inactive).not.toContain('Paste up to');
    expect(inactive).not.toContain('Right-click chart');
    expect(inactive).toMatch(/r="B7"[^>]*\/>/);
    expect(text(files, 'xl/drawings/charts/chart2.xml')).toContain("'TxBF'!$A$2");
    expect(text(files, 'xl/workbook.xml')).toContain("'TxBF'!$A$2:$Q$28");
    expect(text(files, 'xl/workbook.xml')).toContain('activeTab="0"');
  });

  it('replaces repeated report printing settings without duplicate names or page elements', () => {
    const files = unzipSync(makeWorkbook(two, 'MSP', ''));
    const sheet = text(files, 'xl/worksheets/sheet2.xml');
    expect(reportPrintSetup(reportPrintSetup(sheet))).toBe(sheet);
    const workbook = text(files, 'xl/workbook.xml').replace(
      '</x:definedNames>',
      '<x:definedName name="PreservedName">\'Single\'!$A$6</x:definedName></x:definedNames>',
    );
    const resized = reportPrintNames(workbook, 'TxBF', 1, 'Q', 90);
    expect(resized.match(/name="_xlnm.Print_Area"/g)).toHaveLength(2);
    expect(resized.match(/name="_xlnm.Print_Titles"/g)).toHaveLength(2);
    expect(resized).toContain("'TxBF'!$A$2:$Q$90");
    expect(resized).toContain('name="PreservedName"');
    expect(reportPrintNames(resized, 'TxBF', 1, 'Q', 90)).toBe(resized);
  });

  it('preserves legacy calls with default options and custom axis labels', () => {
    const files = unzipSync(
      makeWorkbook(one, 'user', '', { xLabel: 'RF loss <dB>', yLabel: 'Rate & Mbps' }),
    );
    const chart = text(files, 'xl/drawings/charts/chart1.xml');
    expect(chart).toContain("'Single'!$A$2");
    expect(chart).toContain("'Single'!$B$6");
    expect(chart).toContain('RF loss &lt;dB&gt;');
    expect(chart).toContain('Rate &amp; Mbps');
    expect(text(files, 'xl/workbook.xml')).toContain('activeTab="0"');
  });
});

describe('shared chart option validation', () => {
  it('returns independent defaults', () => {
    const first = defaultChartOptions(true);
    first.curves[0].color = '#000000';
    expect(defaultChartOptions(true).curves[0].color).toBe('#2563EB');
    expect(defaultChartOptions(false, 'Rate').curves[0].name).toBe('Rate');
  });
  it('rejects invalid colors, sizes, types and invisible curves', () => {
    const invalid: Array<Partial<ChartOptions['curves'][number]>> = [
      { color: '#abc' },
      { color: '#000000" />' },
      { lineWidth: Number.NaN },
      { lineWidth: 0 },
      { markerSize: 1 },
      { markerSize: 3.5 },
      { name: '' },
      { lineStyle: 'none', marker: 'none' },
    ];
    for (const change of invalid) {
      const options = defaultChartOptions(false);
      Object.assign(options.curves[0], change);
      expect(() => validateChartOptions(options, 1)).toThrow();
      expect(() => makeWorkbook(one, 'user', '', undefined, options)).toThrow();
    }
    expect(() => validateChartOptions({ ...defaultChartOptions(false), title: '' }, 1)).toThrow();
    expect(() => validateChartOptions(defaultChartOptions(false), 2)).toThrow();
    expect(() => makeWorkbook([[{ db: 0, mbps: Infinity }]], 'user', '')).toThrow();
  });
});
