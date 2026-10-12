import { describe, expect, it } from 'vitest';
import {
  blankPeakValues,
  createPeakDocument,
  getPeakRows,
  peakCellValue,
  rowKey,
  validatePeakDocument,
} from './model';

describe('Peak editable table model', () => {
  it('starts with the exact seven columns and separate UL/DL rows, with blank measurements', () => {
    const document = createPeakDocument();
    expect(document.columns.map((column) => column.label)).toEqual([
      'Band/Config',
      'Channel',
      'Direction',
      'Gain Criteria',
      'SU',
      'MU',
      'Gain',
    ]);
    expect(
      getPeakRows(document).map((row) => [row.bandConfig, row.channel, row.direction]),
    ).toEqual([
      ['6G_UHR320', '37', 'UL'],
      ['6G_UHR320', '37', 'DL'],
    ]);
    expect(
      getPeakRows(document).every((row) => row.su === '' && row.mu === '' && row.gain === ''),
    ).toBe(true);
    expect(validatePeakDocument(document)).toEqual([]);
  });

  it('uses canonical directions, supports optional BI, and retains group order', () => {
    const document = createPeakDocument();
    document.groups[0].directions = ['BI', 'DL', 'UL'];
    document.groups.push({
      id: 'group-2',
      bandConfig: '5G_UHR160',
      channel: '149',
      directions: ['DL'],
    });
    expect(getPeakRows(document).map((row) => [row.groupId, row.direction])).toEqual([
      ['group-1', 'UL'],
      ['group-1', 'DL'],
      ['group-1', 'BI'],
      ['group-2', 'DL'],
    ]);
  });

  it('retains manually entered values when group conditions change or directions are toggled', () => {
    const document = createPeakDocument();
    const key = rowKey('group-1', 'UL');
    document.values[key] = {
      criteria: '>=10%',
      su: '100',
      mu: '150',
      gain: '-5%',
      extra: { notes: '原始結果' },
    };
    document.groups[0].directions = ['DL'];
    document.groups[0].bandConfig = '2G_UHR40';
    document.groups[0].channel = '6';
    expect(getPeakRows(document)).toHaveLength(1);
    document.groups[0].directions = ['UL', 'DL'];
    const row = getPeakRows(document)[0];
    expect(row).toMatchObject({
      bandConfig: '2G_UHR40',
      channel: '6',
      criteria: '>=10%',
      su: '100',
      mu: '150',
      gain: '-5%',
    });
    row.extra.notes = 'edited snapshot';
    expect(document.values[key].extra.notes).toBe('原始結果');
  });

  it('does not derive Gain from SU/MU, infer percent units, or round measurements on export', () => {
    const document = createPeakDocument();
    document.values[rowKey('group-1', 'UL')] = {
      ...blankPeakValues(),
      su: '100',
      mu: '150.123456',
      gain: '-5',
    };
    const row = getPeakRows(document)[0];
    const cell = (key: string) =>
      peakCellValue(
        row,
        document.columns.find((column) => column.key === key)!,
        document.settings,
      );
    expect(cell('gain')).toBe(-5);
    expect(cell('mu')).toBe(150.123456);
    for (const text of ['-5%', 'PASS', '>=10%', ' 10% ']) {
      row.gain = text;
      expect(cell('gain')).toBe(text);
    }
    row.gain = '0';
    expect(cell('gain')).toBe(0);
    row.gain = '';
    expect(cell('gain')).toBeNull();
  });

  it('distinguishes blank measurements from zero and preserves numeric-looking text fields', () => {
    const document = createPeakDocument();
    document.values[rowKey('group-1', 'UL')] = {
      ...blankPeakValues(),
      su: '0',
      mu: ' .5 ',
      criteria: '001',
    };
    document.groups[0].bandConfig = '006';
    const row = getPeakRows(document)[0];
    const cells = Object.fromEntries(
      document.columns.map((column) => [column.key, peakCellValue(row, column, document.settings)]),
    );
    expect(cells).toMatchObject({
      bandConfig: '006',
      channel: 37,
      criteria: '001',
      su: 0,
      mu: 0.5,
      gain: null,
    });
    expect(validatePeakDocument(document)).toEqual([]);
  });

  it('keeps values attached to stable keys when headers are renamed and reordered', () => {
    const document = createPeakDocument();
    document.columns.push({
      id: 'note-id',
      key: 'note-key',
      label: 'Notes',
      type: 'text',
      visible: true,
      width: 20,
    });
    document.values[rowKey('group-1', 'UL')] = {
      ...blankPeakValues(),
      su: '10',
      extra: { 'note-key': 'sample A' },
    };
    document.columns.reverse();
    document.columns[0].label = '新版備註';
    const row = getPeakRows(document)[0];
    expect(peakCellValue(row, document.columns[0], document.settings)).toBe('sample A');
    expect(validatePeakDocument(document)).toEqual([]);
  });

  it.each(['-1', 'NaN', 'Infinity', '1e400', '1,000', '=1+1', '5 Mbps', '0x10'])(
    'rejects invalid SU/MU value %s without converting it to zero',
    (value) => {
      const document = createPeakDocument();
      document.values[rowKey('group-1', 'UL')] = { ...blankPeakValues(), su: value };
      expect(validatePeakDocument(document).some((error) => error.includes('SU'))).toBe(true);
    },
  );

  it('only validates visible measurement columns and active direction rows', () => {
    const document = createPeakDocument();
    document.values[rowKey('group-1', 'UL')] = { ...blankPeakValues(), su: 'invalid' };
    document.values[rowKey('group-1', 'BI')] = { ...blankPeakValues(), mu: '-1' };
    document.columns.find((column) => column.key === 'su')!.visible = false;
    expect(validatePeakDocument(document)).toEqual([]);
    document.groups[0].directions.push('BI');
    expect(validatePeakDocument(document).some((error) => error.includes('MU'))).toBe(true);
    document.groups[0].directions = ['DL'];
    document.columns.find((column) => column.key === 'su')!.visible = true;
    expect(validatePeakDocument(document)).toEqual([]);
  });

  it('validates custom numeric columns while permitting signed values and preserving custom text', () => {
    const document = createPeakDocument();
    const column = {
      id: 'difference',
      key: 'difference',
      label: 'Difference',
      type: 'number' as const,
      visible: true,
      width: 18,
    };
    document.columns.push(column);
    document.values[rowKey('group-1', 'UL')] = {
      ...blankPeakValues(),
      extra: { difference: '-10.25' },
    };
    expect(validatePeakDocument(document)).toEqual([]);
    expect(peakCellValue(getPeakRows(document)[0], column, document.settings)).toBe(-10.25);
    document.values[rowKey('group-1', 'UL')].extra.difference = 'bad';
    expect(validatePeakDocument(document).some((error) => error.includes('Difference'))).toBe(true);
    column.visible = false;
    expect(validatePeakDocument(document)).toEqual([]);
  });

  it.each(['0', '-1', '1.5', 'NaN', '37 text', ''])(
    'requires a positive integer Channel: %s',
    (channel) => {
      const document = createPeakDocument();
      document.groups[0].channel = channel;
      expect(validatePeakDocument(document).some((error) => error.includes('Channel'))).toBe(true);
    },
  );

  it('does not invent a vendor-specific upper bound for channel numbers', () => {
    const document = createPeakDocument();
    document.groups[0].channel = '300';
    expect(validatePeakDocument(document)).toEqual([]);
  });

  it('rejects empty configuration, duplicate visible headers, and empty column selections', () => {
    const document = createPeakDocument();
    document.groups[0].bandConfig = '';
    document.columns[4].label = ' channel ';
    expect(validatePeakDocument(document).some((error) => error.includes('Band/Config'))).toBe(
      true,
    );
    expect(validatePeakDocument(document).some((error) => error.includes('名稱不可重複'))).toBe(
      true,
    );
    document.groups[0].bandConfig = '6G_UHR320';
    document.columns[4].visible = false;
    expect(validatePeakDocument(document)).toEqual([]);
    document.columns.forEach((column) => {
      column.visible = false;
    });
    expect(validatePeakDocument(document)).toContain('至少需要顯示一個欄位。');
  });

  it('enforces row and column capacity without counting cached inactive directions', () => {
    const document = createPeakDocument();
    document.groups = Array.from({ length: 1000 }, (_, index) => ({
      id: `group-${index}`,
      bandConfig: '5G_UHR160',
      channel: '37',
      directions: ['DL'],
    }));
    expect(validatePeakDocument(document)).toEqual([]);
    document.groups[0].directions.push('UL');
    expect(validatePeakDocument(document)).toContain('最多支援 1000 列測試資料。');
    document.groups[0].directions = ['DL'];
    for (let index = 0; index < 14; index++)
      document.columns.push({
        id: `extra-${index}`,
        key: `extra-${index}`,
        label: `Extra ${index}`,
        type: 'text',
        visible: true,
        width: 20,
      });
    expect(validatePeakDocument(document)).toContain('最多支援 20 個欄位。');
  });

  it('checks editable presentation settings and bounded labels', () => {
    const document = createPeakDocument();
    document.settings = {
      ...document.settings,
      title: 'x'.repeat(121),
      headerColor: 'red',
      fontSize: 17,
      decimals: 7,
    };
    document.columns[0].label = 'x'.repeat(61);
    document.columns[1].width = 7;
    const errors = validatePeakDocument(document);
    for (const name of ['表格標題', '表頭顏色', '字級', '小數位數', '欄位名稱', '欄寬'])
      expect(errors.some((error) => error.includes(name))).toBe(true);
  });
});
