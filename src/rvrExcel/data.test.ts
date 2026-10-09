import { describe, expect, it } from 'vitest';
import { matchedComparison, parseData } from './data';
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
