export interface Point {
  db: number;
  mbps: number | null;
}
export interface Parsed {
  series: Point[][];
  missing: number;
  reordered: boolean;
}
export const MAX_POINTS = 1000;
export interface MatrixOptions {
  orientation?: 'columns' | 'rows';
  startRow?: number;
  endRow?: number;
  columns?: (number | undefined)[];
  rows?: (number | undefined)[];
  startColumn?: number;
  endColumn?: number;
}
export interface MatrixParsed extends Parsed {
  orientation: 'columns' | 'rows';
  startRow: number;
  endRow?: number;
  startColumn?: number;
  endColumn?: number;
  columns: number[];
  selectedRows: number[];
  ignoredColumns: number;
  skippedTopRows: number;
  remainingRows: number;
}
const numeric = (text: string) =>
  /^[+]?\d*(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(text) &&
  text !== '' &&
  Number.isFinite(Number(text)) &&
  Number(text) >= 0;

export function parseMatrix(
  text: string,
  count: 2 | 3,
  sort = true,
  options: MatrixOptions = {},
): MatrixParsed {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = raw.map((line, index) => {
    try {
      return line.trim() || /[\t,;]/.test(line) ? splitRow(line) : [];
    } catch (error) {
      throw new Error(`第 ${index + 1} 行：${(error as Error).message}`, { cause: error });
    }
  });
  if (options.orientation === 'rows') return parseMatrixRows(rows, raw, count, sort, options);
  if (
    options.startRow !== undefined &&
    (!Number.isInteger(options.startRow) || options.startRow < 1 || options.startRow > rows.length)
  )
    throw new Error('起始行必須是資料範圍內的正整數。');
  if (
    options.endRow !== undefined &&
    (!Number.isInteger(options.endRow) || options.endRow < 1 || options.endRow > rows.length)
  )
    throw new Error('終止行必須是資料範圍內的正整數。');
  if (
    options.startRow !== undefined &&
    options.endRow !== undefined &&
    options.endRow < options.startRow
  )
    throw new Error('終止行不得小於起始行。');
  for (const n of options.columns ?? [])
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 256))
      throw new Error('欄位必須是 1 至 256 的正整數。');
  let start = options.startRow === undefined ? -1 : options.startRow - 1;
  let columns: number[] = [];
  const stop = options.endRow ?? rows.length;
  for (let r = start < 0 ? 0 : start; r < stop; r++) {
    const left = Math.max(
      0,
      rows[r].findIndex((c) => c !== ''),
    );
    const x = options.columns?.[0] === undefined ? left : options.columns[0] - 1;
    const candidate = Array.from({ length: count }, (_, i) =>
      options.columns?.[i] === undefined ? x + i : options.columns[i]! - 1,
    );
    if (new Set(candidate).size !== count) throw new Error('每個資料欄位必須選擇不同欄。');
    if (
      start >= 0 ||
      (numeric(rows[r][x] ?? '') && candidate.slice(1).every((c) => c < rows[r].length))
    ) {
      start = r;
      columns = candidate;
      break;
    }
  }
  if (start < 0 || !columns.length)
    throw new Error('找不到左上方的數值區塊。請確認左欄 dB、右欄 Throughput，或指定起始行與欄位。');
  const selected: string[] = [];
  const seenDb = new Set<number>();
  const selectedRows: number[] = [];
  let ignoredColumns = 0;
  let end = start;
  for (let r = start; r < stop; r++) {
    const cells = rows[r];
    const chosen = columns.map((c) => cells[c] ?? '');
    if (options.endRow === undefined && r > start && chosen.every((c) => c === '')) break;
    if (
      options.endRow === undefined &&
      r > start &&
      (/^(average|mean|summary|total|end|平均|統計|合計|結束)(?:\s|$|:)/i.test(chosen[0]) ||
        chosen.every((c) => /^[^\d+-.]/.test(c) && !numeric(c)))
    )
      break;
    if (columns.some((c) => c >= cells.length))
      throw new Error(
        `第 ${r + 1} 行：指定的第 ${Math.max(...columns) + 1} 欄不存在。空白測值請保留 Tab 或逗號。`,
      );
    // Header rows were skipped above. Within this block, keep validation errors
    // tied to original matrix row numbers instead of silently omitting samples.
    for (let i = 0; i < count; i++)
      if (!(i > 0 && chosen[i] === '') && !numeric(chosen[i]))
        throw new Error(`第 ${r + 1} 行、第 ${columns[i] + 1} 欄：必須是非負數字。`);
    const db = Number(chosen[0]);
    if (seenDb.has(db))
      throw new Error(
        `第 ${r + 1} 行、第 ${columns[0] + 1} 欄：${db} dB 重複。請選擇同一輪測試或先處理重測值。`,
      );
    seenDb.add(db);
    selected.push(chosen.join('\t'));
    selectedRows.push(r + 1);
    ignoredColumns = Math.max(ignoredColumns, cells.length - count);
    end = r + 1;
  }
  const parsed = parseData(selected.join('\n'), count, sort);
  return {
    ...parsed,
    orientation: 'columns',
    startRow: start + 1,
    endRow: end,
    startColumn: Math.min(...columns) + 1,
    endColumn: Math.max(...columns) + 1,
    columns: columns.map((c) => c + 1),
    selectedRows,
    ignoredColumns,
    skippedTopRows: start,
    remainingRows: raw.slice(end).filter((line) => line.trim()).length,
  };
}

function parseMatrixRows(
  matrix: string[][],
  raw: string[],
  count: 2 | 3,
  sort: boolean,
  options: MatrixOptions,
): MatrixParsed {
  for (const n of options.rows ?? [])
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > matrix.length))
      throw new Error('資料列必須是資料範圍內的正整數。');
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  for (const [label, n] of [
    ['起始欄', options.startColumn],
    ['終止欄', options.endColumn],
  ] as const)
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > width))
      throw new Error(`${label}必須是資料範圍內的正整數。`);
  if (
    options.startColumn !== undefined &&
    options.endColumn !== undefined &&
    options.endColumn < options.startColumn
  )
    throw new Error('終止欄不得小於起始欄。');

  let selectedRows: number[] = [];
  let start = -1;
  const explicitX = options.rows?.[0];
  const stop = options.endColumn ?? width;
  for (let r = explicitX === undefined ? 0 : explicitX - 1; r < matrix.length; r++) {
    const candidate = Array.from({ length: count }, (_, i) =>
      options.rows?.[i] === undefined ? r + i : options.rows[i]! - 1,
    );
    if (new Set(candidate).size !== count) {
      if (explicitX !== undefined) throw new Error('每個資料列必須選擇不同列。');
      continue;
    }
    if (candidate.some((row) => row >= matrix.length)) {
      if (explicitX !== undefined)
        throw new Error(`第 ${Math.max(...candidate) + 1} 行不存在，請指定有效的 X／Y 資料列。`);
      continue;
    }
    const first =
      options.startColumn === undefined
        ? matrix[r].findIndex((cell, column) => column < stop && numeric(cell))
        : options.startColumn - 1;
    if (first >= 0 && (explicitX !== undefined || numeric(matrix[r][first] ?? ''))) {
      selectedRows = candidate;
      start = first;
      break;
    }
    if (explicitX !== undefined) break;
  }
  if (start < 0 || !selectedRows.length)
    throw new Error('找不到橫向數值區塊。請指定 X／Y 資料列與起始欄。');

  const selected: string[] = [];
  const columns: number[] = [];
  const seenDb = new Set<number>();
  let end = start;
  for (let c = start; c < stop; c++) {
    const chosen = selectedRows.map((row) => matrix[row][c] ?? '');
    if (
      options.endColumn === undefined &&
      c > start &&
      (chosen.every((cell) => cell === '') ||
        /^(average|mean|summary|total|end|平均|統計|合計|結束)(?:\s|$|:)/i.test(chosen[0]) ||
        chosen.every((cell) => /^[^\d+-.]/.test(cell) && !numeric(cell)))
    )
      break;
    for (let i = 0; i < count; i++) {
      const row = selectedRows[i];
      if (c >= matrix[row].length)
        throw new Error(`第 ${row + 1} 行、第 ${c + 1} 欄不存在。空白測值請保留 Tab 或逗號。`);
      if (!(i > 0 && chosen[i] === '') && !numeric(chosen[i]))
        throw new Error(`第 ${row + 1} 行、第 ${c + 1} 欄：必須是非負數字。`);
    }
    const db = Number(chosen[0]);
    if (seenDb.has(db))
      throw new Error(
        `第 ${selectedRows[0] + 1} 行、第 ${c + 1} 欄：${db} dB 重複。請選擇同一輪測試或先處理重測值。`,
      );
    seenDb.add(db);
    selected.push(chosen.join('\t'));
    columns.push(c + 1);
    end = c + 1;
  }
  const parsed = parseData(selected.join('\n'), count, sort);
  return {
    ...parsed,
    orientation: 'rows',
    startRow: selectedRows[0] + 1,
    endRow: Math.max(...selectedRows) + 1,
    startColumn: start + 1,
    endColumn: end,
    selectedRows: selectedRows.map((row) => row + 1),
    columns,
    ignoredColumns: Math.max(...selectedRows.map((row) => matrix[row].length)) - columns.length,
    skippedTopRows: Math.min(...selectedRows),
    remainingRows: raw.slice(Math.max(...selectedRows) + 1).filter((line) => line.trim()).length,
  };
}

// Excel clipboard is TSV. CSV accepts quoted fields; whitespace is supported
// only when there are no explicit separators, so empty TSV cells stay empty.
export function splitRow(line: string): string[] {
  const separator = line.includes('\t')
    ? '\t'
    : line.includes(',')
      ? ','
      : line.includes(';')
        ? ';'
        : null;
  if (!separator) return line.trim().split(/\s+/);
  const result: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!cell.trim() || quoted) quoted = !quoted;
      else throw new Error('引號位置不正確。');
    } else if (ch === separator && !quoted) {
      result.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV 引號未閉合。');
  return [...result, cell.trim()];
}
function value(text: string, line: number, label: string): number {
  if (
    !/^[+]?\d*(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(text) ||
    !text ||
    !Number.isFinite(Number(text)) ||
    Number(text) < 0
  ) {
    throw new Error(`第 ${line} 行：${label} 必須是非負數字，單位請放在欄位標題。`);
  }
  return Number(text);
}
function header(cells: string[], count: number): boolean {
  return (
    cells.length === count &&
    /^(db|attenuation(?:\s*\(db\))?|衰減(?:\s*\(db\))?)$/i.test(cells[0]) &&
    cells.slice(1).every((c) => /(mbps|throughput|on|off|吞吐量)/i.test(c))
  );
}
export function parseData(text: string, count: 2 | 3, sort = true): Parsed {
  const series: Point[][] = Array.from({ length: count - 1 }, () => []);
  const seen = new Set<number>();
  let missing = 0;
  let first = true;
  for (const [index, original] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    if (!original.trim()) continue;
    let cells: string[];
    try {
      cells = splitRow(original);
    } catch (error) {
      throw new Error(`第 ${index + 1} 行：${(error as Error).message}`, { cause: error });
    }
    if (first && header(cells, count)) {
      first = false;
      continue;
    }
    first = false;
    if (cells.length !== count)
      throw new Error(
        `第 ${index + 1} 行：需要 ${count} 欄（dB${count === 3 ? '、ON Mbps、OFF Mbps' : '、Mbps'}），目前為 ${cells.length} 欄。`,
      );
    const db = value(cells[0], index + 1, 'dB');
    if (seen.has(db))
      throw new Error(
        `第 ${index + 1} 行：${db} dB 重複。請選取同一輪測試，或先決定重測值的處理方式。`,
      );
    seen.add(db);
    for (let i = 1; i < count; i++) {
      const mbps = cells[i] === '' ? null : value(cells[i], index + 1, 'Mbps');
      if (mbps === null) missing++;
      series[i - 1].push({ db, mbps });
    }
    if (seen.size > MAX_POINTS) throw new Error(`每條曲線最多 ${MAX_POINTS} 個測點。`);
  }
  if (!seen.size) throw new Error('請貼上 dB／Mbps 數據。');
  if (series.some((points) => !points.some((p) => p.mbps !== null)))
    throw new Error('每條曲線至少需要一個有 Mbps 的測點。');
  const reordered = sort && series[0].some((p, i, a) => i > 0 && p.db < a[i - 1].db);
  if (sort) series.forEach((points) => points.sort((a, b) => a.db - b.db));
  return { series, missing, reordered };
}

export function matchedComparison(on: Point[], off: Point[]) {
  const byDb = new Map(off.map((p) => [p.db, p.mbps]));
  return on.flatMap((p) => {
    const other = byDb.get(p.db);
    return p.mbps !== null && other !== null && other !== undefined
      ? [
          {
            db: p.db,
            on: p.mbps,
            off: other,
            delta: p.mbps - other,
            gain: other === 0 ? null : (p.mbps / other - 1) * 100,
          },
        ]
      : [];
  });
}
