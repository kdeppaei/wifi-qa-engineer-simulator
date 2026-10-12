export type Direction = 'UL' | 'DL' | 'BI';
export type PeakDirection = Direction;

export interface PeakGroup {
  id: string;
  bandConfig: string;
  channel: string;
  directions: Direction[];
}

export interface PeakValues {
  criteria: string;
  su: string;
  mu: string;
  gain: string;
  extra: Record<string, string>;
}

export type CoreKey = 'bandConfig' | 'channel' | 'direction' | 'criteria' | 'su' | 'mu' | 'gain';

export interface PeakColumn {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'number';
  visible: boolean;
  width: number;
}

export interface PeakSettings {
  title: string;
  source: string;
  note: string;
  unit: string;
  headerColor: string;
  bandedRows: boolean;
  fontSize: number;
  decimals: number;
}

export interface PeakDocument {
  groups: PeakGroup[];
  values: Record<string, PeakValues>;
  columns: PeakColumn[];
  settings: PeakSettings;
}

export interface PeakRow extends PeakValues {
  key: string;
  groupId: string;
  bandConfig: string;
  channel: string;
  direction: Direction;
}

export const PEAK_MAX_ROWS = 1000;
export const PEAK_MAX_COLUMNS = 20;
export const PEAK_DIRECTIONS: Direction[] = ['UL', 'DL', 'BI'];
const coreKeys: CoreKey[] = ['bandConfig', 'channel', 'direction', 'criteria', 'su', 'mu', 'gain'];

export function blankPeakValues(): PeakValues {
  return { criteria: '', su: '', mu: '', gain: '', extra: {} };
}

export function rowKey(groupId: string, direction: Direction): string {
  return `${groupId}:${direction}`;
}

export function createPeakDocument(): PeakDocument {
  return {
    groups: [{ id: 'group-1', bandConfig: '6G_UHR320', channel: '37', directions: ['UL', 'DL'] }],
    values: {},
    columns: [
      {
        id: 'bandConfig',
        key: 'bandConfig',
        label: 'Band/Config',
        type: 'text',
        visible: true,
        width: 24,
      },
      { id: 'channel', key: 'channel', label: 'Channel', type: 'number', visible: true, width: 12 },
      {
        id: 'direction',
        key: 'direction',
        label: 'Direction',
        type: 'text',
        visible: true,
        width: 14,
      },
      {
        id: 'criteria',
        key: 'criteria',
        label: 'Gain Criteria',
        type: 'text',
        visible: true,
        width: 20,
      },
      { id: 'su', key: 'su', label: 'SU', type: 'number', visible: true, width: 16 },
      { id: 'mu', key: 'mu', label: 'MU', type: 'number', visible: true, width: 16 },
      { id: 'gain', key: 'gain', label: 'Gain', type: 'text', visible: true, width: 16 },
    ],
    settings: {
      title: 'Peak 測試結果',
      source: '使用者提供數據（未驗證量測來源）',
      note: '',
      unit: 'Mbps',
      headerColor: '#1D4ED8',
      bandedRows: true,
      fontSize: 12,
      decimals: 2,
    },
  };
}

export function getPeakRows(document: PeakDocument): PeakRow[] {
  return document.groups.flatMap((group) =>
    PEAK_DIRECTIONS.filter((direction) => group.directions.includes(direction)).map((direction) => {
      const key = rowKey(group.id, direction);
      const values = document.values[key] ?? blankPeakValues();
      return {
        ...values,
        extra: { ...values.extra },
        key,
        groupId: group.id,
        bandConfig: group.bandConfig,
        channel: group.channel,
        direction,
      };
    }),
  );
}

function decimalNumber(value: string): number | undefined {
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function positiveInteger(value: string): boolean {
  return /^\+?\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function rowText(row: PeakRow, column: PeakColumn): string {
  return coreKeys.includes(column.key as CoreKey)
    ? row[column.key as CoreKey]
    : (row.extra[column.key] ?? '');
}

export function peakCellValue(
  row: PeakRow,
  column: PeakColumn,
  settings: PeakSettings,
): string | number | null {
  // Decimal places affect presentation only; exported measurements retain their precision.
  void settings;
  const text = rowText(row, column);
  if (!text.trim()) return null;
  if (['bandConfig', 'direction', 'criteria'].includes(column.key)) return text;
  if (['channel', 'su', 'mu', 'gain'].includes(column.key) || column.type === 'number') {
    const number = decimalNumber(text);
    if (number !== undefined) return number;
  }
  // Literal Gain entries, including percentages and criteria, remain manual text.
  return text;
}

export function validatePeakDocument(document: PeakDocument): string[] {
  const errors: string[] = [];
  const rows = getPeakRows(document);
  if (!rows.length) errors.push('至少需要一列測試資料；請選取 UL、DL 或 BI。');
  if (rows.length > PEAK_MAX_ROWS) errors.push(`最多支援 ${PEAK_MAX_ROWS} 列測試資料。`);
  if (document.columns.length > PEAK_MAX_COLUMNS)
    errors.push(`最多支援 ${PEAK_MAX_COLUMNS} 個欄位。`);

  const groupIds = new Set<string>();
  document.groups.forEach((group, index) => {
    const name = `第 ${index + 1} 組`;
    if (!group.id.trim() || groupIds.has(group.id))
      errors.push(`${name}的組別識別碼不可空白或重複。`);
    groupIds.add(group.id);
    if (!group.bandConfig.trim()) errors.push(`${name}的 Band/Config 不可空白。`);
    if (!positiveInteger(group.channel)) errors.push(`${name}的 Channel 必須是正整數。`);
    if (
      new Set(group.directions).size !== group.directions.length ||
      group.directions.some((direction) => !PEAK_DIRECTIONS.includes(direction))
    )
      errors.push(`${name}的 Direction 只能選取不重複的 UL、DL、BI。`);
  });

  const visibleColumns = document.columns.filter((column) => column.visible);
  if (!visibleColumns.length) errors.push('至少需要顯示一個欄位。');
  const labels = new Set<string>();
  const columnIds = new Set<string>();
  const columnKeys = new Set<string>();
  for (const column of document.columns) {
    const label = column.label.trim();
    if (!label || column.label.length > 60) errors.push('欄位名稱須為 1 至 60 個字元。');
    if (!column.id.trim() || columnIds.has(column.id)) errors.push('欄位識別碼不可空白或重複。');
    if (!column.key.trim() || columnKeys.has(column.key)) errors.push('欄位資料鍵不可空白或重複。');
    columnIds.add(column.id);
    columnKeys.add(column.key);
    if (!Number.isFinite(column.width) || column.width < 8 || column.width > 60)
      errors.push(`${label || '欄位'}的欄寬須為 8 至 60。`);
    if (column.visible) {
      const comparable = label.toLocaleLowerCase();
      if (labels.has(comparable)) errors.push(`顯示中的欄位名稱不可重複：${label}。`);
      labels.add(comparable);
    }
  }

  const settings = document.settings;
  if (!settings.title.trim() || settings.title.length > 120)
    errors.push('表格標題須為 1 至 120 個字元。');
  if (!settings.unit.trim() || settings.unit.length > 60) errors.push('單位須為 1 至 60 個字元。');
  if (!/^#[0-9a-f]{6}$/i.test(settings.headerColor)) errors.push('表頭顏色須為六位十六進位色碼。');
  if (!Number.isFinite(settings.fontSize) || settings.fontSize < 8 || settings.fontSize > 16)
    errors.push('字級須為 8 至 16。');
  if (!Number.isInteger(settings.decimals) || settings.decimals < 0 || settings.decimals > 6)
    errors.push('小數位數須為 0 至 6 的整數。');

  rows.forEach((row, index) => {
    for (const column of visibleColumns) {
      const text = rowText(row, column);
      if (!text.trim()) continue;
      const number = decimalNumber(text);
      if (column.key === 'su' || column.key === 'mu') {
        if (number === undefined || number < 0)
          errors.push(`第 ${index + 1} 列的 ${column.label} 必須是非負有限數值或空白。`);
      } else if (!coreKeys.includes(column.key as CoreKey) && column.type === 'number') {
        if (number === undefined)
          errors.push(`第 ${index + 1} 列的 ${column.label} 必須是有限數值或空白。`);
      }
    }
  });
  return errors;
}
