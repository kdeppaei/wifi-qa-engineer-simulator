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
