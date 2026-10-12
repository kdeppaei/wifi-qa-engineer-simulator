import { describe, expect, it } from 'vitest';
import { MAX_POINTS, parseMatrix } from './data';

describe('Matrix row and range selection', () => {
  it('preserves the default upper-left column block and reports its coordinates', () => {
    const parsed = parseMatrix(
      'Report\nLoss\tRate\tRSSI\n0\t980\t-40\n10\t900\t-50\n\nNext\n0\t700',
      2,
    );
    expect(parsed.orientation).toBe('columns');
    expect(parsed.startRow).toBe(3);
    expect(parsed.endRow).toBe(4);
    expect(parsed.selectedRows).toEqual([3, 4]);
    expect(parsed.columns).toEqual([1, 2]);
    expect(parsed.remainingRows).toBe(2);
    expect(parsed.series[0]).toEqual([
      { db: 0, mbps: 980 },
      { db: 10, mbps: 900 },
    ]);
  });

  it('extracts numeric X and both Y rows after their captions without transposing other rows', () => {
    const parsed = parseMatrix(
      'MSP Report\nLoss\t30\t7.5\t20\t90\nON Mbps\t0\t950.25\t\t0\nOFF Mbps\t0\t900\t500\t\nSummary\tirrelevant',
      3,
      true,
      { orientation: 'rows' },
    );
    expect(parsed.orientation).toBe('rows');
    expect(parsed.selectedRows).toEqual([2, 3, 4]);
    expect(parsed.startColumn).toBe(2);
    expect(parsed.endColumn).toBe(5);
    expect(parsed.columns).toEqual([2, 3, 4, 5]);
    expect(parsed.skippedTopRows).toBe(1);
    expect(parsed.remainingRows).toBe(1);
    expect(parsed.reordered).toBe(true);
    expect(parsed.missing).toBe(2);
    expect(parsed.series[0]).toEqual([
      { db: 7.5, mbps: 950.25 },
      { db: 20, mbps: null },
      { db: 30, mbps: 0 },
      { db: 90, mbps: 0 },
    ]);
    expect(parsed.series[1].at(-1)).toEqual({ db: 90, mbps: null });
  });

  it('accepts quoted CSV, semicolons and empty left gutters for row-oriented data', () => {
    for (const text of [
      '"Loss","0","7.5"\n"Rate","980","0"',
      'Loss;0;7.5\nRate;980;0',
      '\t\tLoss\t0\t7.5\n\t\tRate\t980\t0',
    ]) {
      const parsed = parseMatrix(text, 2, true, { orientation: 'rows' });
      expect(parsed.series[0]).toEqual([
        { db: 0, mbps: 980 },
        { db: 7.5, mbps: 0 },
      ]);
    }
  });

  it('keeps an automatic horizontal selection in its first consecutive block', () => {
    const parsed = parseMatrix('Loss\t0\t10\t\t0\t10\nRate\t980\t900\t\t700\t600', 2, true, {
      orientation: 'rows',
    });
    expect(parsed.endColumn).toBe(3);
    expect(parsed.series[0]).toHaveLength(2);
    expect(parsed.ignoredColumns).toBe(4);
  });

  it('ends an automatic horizontal selection at a summary caption', () => {
    const parsed = parseMatrix('Loss\t0\t10\tAverage\nRate\t980\t900\t940', 2, true, {
      orientation: 'rows',
    });
    expect(parsed.columns).toEqual([2, 3]);
  });

  it('allows arbitrary X/Y row order and inclusive horizontal endpoints', () => {
    const parsed = parseMatrix(
      'Report\nRate\t980\t900\t0\tbad\nIgnored\t-40\t-50\t-80\t-90\nLoss\t0\t10\t90\t100',
      2,
      false,
      { orientation: 'rows', rows: [4, 2], startColumn: 2, endColumn: 4 },
    );
    expect(parsed.selectedRows).toEqual([4, 2]);
    expect(parsed.startRow).toBe(4);
    expect(parsed.columns).toEqual([2, 3, 4]);
    expect(parsed.series[0]).toEqual([
      { db: 0, mbps: 980 },
      { db: 10, mbps: 900 },
      { db: 90, mbps: 0 },
    ]);
    expect(parsed.reordered).toBe(false);
  });

  it('defaults omitted Y rows to the rows immediately after X', () => {
    const parsed = parseMatrix('Report\nLoss\t0\t90\nON\t980\t0\nOFF\t960\t0', 3, true, {
      orientation: 'rows',
      rows: [2],
    });
    expect(parsed.selectedRows).toEqual([2, 3, 4]);
    expect(parsed.series[1]).toEqual([
      { db: 0, mbps: 960 },
      { db: 90, mbps: 0 },
    ]);
  });

  it('can preserve horizontal sample order and retain blank Y cells', () => {
    const parsed = parseMatrix('X\t20\t0\t10\nY\t0\t900\t', 2, false, { orientation: 'rows' });
    expect(parsed.series[0]).toEqual([
      { db: 20, mbps: 0 },
      { db: 0, mbps: 900 },
      { db: 10, mbps: null },
    ]);
    expect(parsed.reordered).toBe(false);
    expect(parsed.missing).toBe(1);
  });

  it('allows a single inclusive horizontal sample and independent blank series cells', () => {
    const parsed = parseMatrix('X\t0\t10\t20\nON\t900\t0\t500\nOFF\t850\t0\t400', 3, true, {
      orientation: 'rows',
      startColumn: 3,
      endColumn: 3,
    });
    expect(parsed.series).toEqual([[{ db: 10, mbps: 0 }], [{ db: 10, mbps: 0 }]]);
  });

  it('reports invalid selected Y values at their original matrix coordinate', () => {
    expect(() =>
      parseMatrix('Report\nLoss\t0\t10\nRate\t900\tbad', 2, true, {
        orientation: 'rows',
        rows: [2, 3],
      }),
    ).toThrow('第 3 行、第 3 欄');
  });

  it('reports duplicate horizontal X values at the original X row and column', () => {
    expect(() =>
      parseMatrix('Report\nLoss\t0\t10\t0\nRate\t900\t800\t700', 2, true, {
        orientation: 'rows',
      }),
    ).toThrow('第 2 行、第 4 欄');
  });

  it('reports a missing horizontal Y cell instead of inventing an empty cell', () => {
    expect(() => parseMatrix('Loss\t0\t10\nRate\t900', 2, true, { orientation: 'rows' })).toThrow(
      '第 2 行、第 3 欄不存在',
    );
  });

  it('requires explicit horizontal ranges to include only numeric X values', () => {
    for (const x of ['', 'Average', '-1', 'NaN', '=10']) {
      expect(() =>
        parseMatrix(`Loss\t0\t${x}\t20\nRate\t900\t800\t700`, 2, true, {
          orientation: 'rows',
          rows: [1, 2],
          startColumn: 2,
          endColumn: 4,
        }),
      ).toThrow('第 1 行、第 3 欄');
    }
  });

  it('does not silently omit a blank column inside an explicit horizontal range', () => {
    expect(() =>
      parseMatrix('Loss\t0\t\t20\nRate\t900\t\t700', 2, true, {
        orientation: 'rows',
        startColumn: 2,
        endColumn: 4,
      }),
    ).toThrow('第 1 行、第 3 欄');
  });

  it('does not silently omit a blank row inside an explicit vertical range', () => {
    expect(() =>
      parseMatrix('Loss\tRate\n0\t980\n\t\n20\t800', 2, true, {
        startRow: 2,
        endRow: 4,
      }),
    ).toThrow('第 3 行、第 1 欄');
  });

  it('supports inclusive vertical limits without reading a later malformed value', () => {
    const parsed = parseMatrix('Loss\tRate\n0\t980\n10\t900\n20\tbad', 2, true, {
      startRow: 2,
      endRow: 3,
    });
    expect(parsed.series[0]).toHaveLength(2);
    expect(parsed.endRow).toBe(3);
    expect(parsed.remainingRows).toBe(1);
  });

  it('can bound automatic vertical extraction with an inclusive end row', () => {
    const parsed = parseMatrix('Report\nLoss\tRate\n0\t980\n10\tbad', 2, true, { endRow: 3 });
    expect(parsed.startRow).toBe(3);
    expect(parsed.endRow).toBe(3);
    expect(parsed.series[0]).toEqual([{ db: 0, mbps: 980 }]);
  });

  it.each([
    { rows: [1, 1] },
    { rows: [0, 2] },
    { rows: [1.5, 2] },
    { rows: [3, 4] },
    { startColumn: 0 },
    { startColumn: 2.5 },
    { startColumn: 4 },
    { endColumn: 4 },
    { startColumn: 3, endColumn: 2 },
  ])('rejects invalid row-mode mappings and endpoints %j', (selection) => {
    expect(() =>
      parseMatrix('Loss\t0\t10\nRate\t980\t900', 2, true, { orientation: 'rows', ...selection }),
    ).toThrow();
  });

  it.each([{ endRow: 0 }, { endRow: 1.5 }, { endRow: 4 }, { startRow: 3, endRow: 2 }])(
    'rejects invalid vertical endpoints %j',
    (selection) =>
      expect(() => parseMatrix('Loss\tRate\n0\t980\n10\t900', 2, true, selection)).toThrow(),
  );

  it('enforces the 1000-point capacity for rows without limiting numeric columns to 256', () => {
    const matrix = (n: number) =>
      `Loss\t${Array.from({ length: n }, (_, i) => i).join('\t')}\nRate\t${Array.from({ length: n }, () => 1).join('\t')}`;
    expect(
      parseMatrix(matrix(MAX_POINTS), 2, true, { orientation: 'rows' }).series[0],
    ).toHaveLength(MAX_POINTS);
    expect(() => parseMatrix(matrix(MAX_POINTS + 1), 2, true, { orientation: 'rows' })).toThrow(
      '最多',
    );
    expect(
      parseMatrix(matrix(MAX_POINTS), 2, true, {
        orientation: 'rows',
        startColumn: 1001,
        endColumn: 1001,
      }).series[0],
    ).toEqual([{ db: 999, mbps: 1 }]);
  });
});
