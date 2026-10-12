import { describe, expect, it } from 'vitest';
import { matchedComparison, parseData, parseMatrix } from './data';
import { makeWorkbook } from './workbook';
import { strFromU8, unzipSync } from 'fflate';

describe('RvR measured-data parsing', () => {
  it('preserves decimals, measured zero and missing samples, sorting pairs together', () => {
    const p = parseData('dB\tMbps\n30\t0\n7.5\t950.25\n20\t', 2);
    expect(p.series[0]).toEqual([
      { db: 7.5, mbps: 950.25 },
      { db: 20, mbps: null },
      { db: 30, mbps: 0 },
    ]);
    expect(p.reordered).toBe(true);
    expect(p.missing).toBe(1);
  });
  it('accepts quoted CSV, TSV, semicolon and whitespace formats', () => {
    for (const text of [
      '"dB","Mbps"\r\n"0","980.5"',
      'dB;Mbps\n0;980.5',
      'dB Mbps\n0 980.5',
      '\uFEFFdB\tMbps\n0\t980.5',
    ])
      expect(parseData(text, 2).series[0]).toEqual([{ db: 0, mbps: 980.5 }]);
  });
  it('preserves independent ON/OFF blanks', () => {
    const p = parseData('dB\tON Mbps\tOFF Mbps\n0\t980\t950\n30\t\t0\n50\t0\t', 3);
    expect(p.series[0][1].mbps).toBeNull();
    expect(p.series[1][1].mbps).toBe(0);
    expect(p.missing).toBe(2);
  });
  it.each([
    '0\t10\n0\t20',
    '0\t=1+1',
    '0\t-1',
    'NaN\t1',
    '0\tInfinity',
    '0\t2 Mbps',
    '0\t1\textra',
    '"0\t10',
    '0\t1\n1\tbad',
  ])('rejects malformed or ambiguous input %s', (input) =>
    expect(() => parseData(input, 2)).toThrow(),
  );
  it('requires measured values and enforces template capacity', () => {
    expect(() => parseData('0\t', 2)).toThrow();
    expect(
      parseData(Array.from({ length: 1000 }, (_, i) => `${i}\t1`).join('\n'), 2).series[0],
    ).toHaveLength(1000);
    expect(() =>
      parseData(Array.from({ length: 1001 }, (_, i) => `${i}\t1`).join('\n'), 2),
    ).toThrow('最多');
  });
  it('can preserve original order and compares only equal dB without dividing by zero', () => {
    const on = parseData('10\t100\n0\t20', 2, false).series[0];
    expect(on[0].db).toBe(10);
    expect(
      matchedComparison(on, [
        { db: 0, mbps: 0 },
        { db: 5, mbps: 90 },
      ]),
    ).toEqual([{ db: 0, on: 20, off: 0, delta: 20, gain: null }]);
  });
});
describe('Reusable native Excel export', () => {
  it('exports editable column and axis names, without frozen chart boundaries', () => {
    const files = unzipSync(
      makeWorkbook([[{ db: 0, mbps: 100 }]], 'user', '', {
        xLabel: 'Loss <dB>',
        yLabel: 'Data rate & Mbps',
      }),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    const chart = strFromU8(files['xl/drawings/charts/chart1.xml']);
    expect(sheet).toContain('Loss &lt;dB&gt;');
    expect(chart).toContain('Data rate &amp; Mbps');
    expect(sheet).not.toContain('<x:pane');
    expect(sheet).toContain('showGridLines="0"');
  });
  it('keeps native numeric XY bindings and blank gaps with typed input cells', () => {
    const files = unzipSync(
      makeWorkbook(
        [
          [
            { db: 0, mbps: 100 },
            { db: 7.5, mbps: null },
            { db: 30, mbps: 0 },
          ],
        ],
        'MSP user data',
        '5 GHz <DL> & TCP',
      ),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    const chart = strFromU8(files['xl/drawings/charts/chart1.xml']);
    expect(sheet).toMatch(/r="A8"[^>]*><x:v>7.5<\/x:v>/);
    expect(sheet).toMatch(/r="B9"[^>]*><x:v>0<\/x:v>/);
    expect(sheet).toMatch(/r="B8"[^>]*\/>/);
    expect(sheet).toContain('5 GHz &lt;DL&gt; &amp; TCP');
    expect(chart).toContain("'Single'!$A$7:$A$1006");
    expect(chart).toContain('<c:scatterStyle val="lineMarker"/>');
    expect(chart).toContain('<c:dispBlanksAs val="gap"/>');
    expect(chart).toContain('<c:pt idx="2"><c:v>0</c:v></c:pt>');
    expect(chart).not.toContain('<c:pt idx="1"><c:v>0</c:v></c:pt>');
  });
  it('uses separate ON/OFF X ranges and opens the comparison sheet', () => {
    const files = unzipSync(
      makeWorkbook(
        [
          [
            { db: 0, mbps: 900 },
            { db: 20, mbps: null },
            { db: 30, mbps: 0 },
          ],
          [
            { db: 5, mbps: 800 },
            { db: 25, mbps: 20 },
            { db: 30, mbps: 0 },
          ],
        ],
        'SIMULATED',
        '',
      ),
    );
    const chart = strFromU8(files['xl/drawings/charts/chart2.xml']);
    expect(chart).toContain("'TxBF'!$A$7:$A$1006");
    expect(chart).toContain("'TxBF'!$D$7:$D$1006");
    expect(strFromU8(files['xl/worksheets/sheet2.xml'])).toContain('SIMULATED');
    expect(strFromU8(files['xl/worksheets/sheet2.xml'])).toMatch(/r="E7"[^>]*><x:v>800<\/x:v>/);
    expect(strFromU8(files['xl/workbook.xml'])).toContain('activeTab="1"');
  });
});

describe('MSP matrix extraction', () => {
  it('reports duplicate values at their original matrix row', () => {
    expect(() => parseMatrix('Report\nLoss\tRate\n0\t980\n0\t950', 2)).toThrow('第 4 行');
  });
  it('extracts the upper-left pair below captions and ignores other columns', () => {
    const result = parseMatrix(
      'MSP Report\nTest\tDL\t5G\nLoss\tRate\tRSSI\tMCS\n0\t980\t-40\t11\n7.5\t900\t-47\t10\n90\t0\t-99\t0',
      2,
    );
    expect(result.series[0]).toEqual([
      { db: 0, mbps: 980 },
      { db: 7.5, mbps: 900 },
      { db: 90, mbps: 0 },
    ]);
    expect(result.startRow).toBe(4);
    expect(result.columns).toEqual([1, 2]);
    expect(result.ignoredColumns).toBe(2);
  });
  it('finds the nearest left data columns after empty gutters', () => {
    const result = parseMatrix('\t\tLoss\tRate\tExtra\n\t\t0\t980\t22\n\t\t10\t900\t23', 2);
    expect(result.columns).toEqual([3, 4]);
    expect(result.series[0][1].mbps).toBe(900);
  });
  it('keeps the first block separate and reports a later run rather than pooling it', () => {
    const result = parseMatrix('dB\tRate\n0\t980\n10\t900\n\nSecond run\n0\t700\n10\t600', 2);
    expect(result.series[0]).toHaveLength(2);
    expect(result.remainingRows).toBe(3);
    expect(parseMatrix('dB\tRate\n0\t980\nAverage\t980', 2).remainingRows).toBe(1);
  });
  it('allows explicit row and column mapping, paired sorting and missing values', () => {
    const result = parseMatrix(
      'title\nidx\tRate\tLoss\tExtra\n1\t0\t90\t12\n2\t\t40\t13\n3\t950\t0\t14',
      2,
      true,
      { startRow: 3, columns: [3, 2] },
    );
    expect(result.series[0]).toEqual([
      { db: 0, mbps: 950 },
      { db: 40, mbps: null },
      { db: 90, mbps: 0 },
    ]);
    expect(result.reordered).toBe(true);
    expect(result.missing).toBe(1);
  });
  it('supports common BF columns while ignoring numeric matrix side columns', () => {
    const result = parseMatrix('header\n0\t980\t970\t11\n20\t900\t870\t10\n90\t0\t\t0', 3);
    expect(result.series).toHaveLength(2);
    expect(result.series[1][2].mbps).toBeNull();
    expect(result.ignoredColumns).toBe(1);
  });
  it.each(['0\tbad\t999', '0\t980\n10\tbad', '0\t980\n-1\t-2', '0\t980\n0\t900'])(
    'rejects invalid selected samples %s',
    (text) => expect(() => parseMatrix(text, 2)).toThrow(),
  );
  it('rejects duplicate mapping and out-of-range row/column settings', () => {
    for (const options of [
      { columns: [1, 1] },
      { columns: [257, 2] },
      { startRow: 3 },
      { columns: [2.5, 3] },
    ])
      expect(() => parseMatrix('0\t980', 2, true, options)).toThrow();
  });
});
