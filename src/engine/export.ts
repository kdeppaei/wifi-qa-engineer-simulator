import { strToU8, zipSync } from 'fflate';
import type { LabState, TestRun } from './lab';

type CellValue = string | number | boolean | null | undefined;
type Row = CellValue[];
const ON = '60A5FA';
const OFF = 'F87171';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKGREL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const disclosure =
  '模擬資料：Browser-based Wi-Fi QA Virtual Lab。RF、Driver、iperf3 與 MSP 均為可重複教學模型，非真實量測。';
const bfNotice =
  'DL 發送端是 AP；UL 發送端是 STA。STA UCI etxbfencond 的標記不單獨證明 AP 的 DL BF 已切換。';
// XML 1.0 forbids these controls. Keep the exemption on the regex declaration after formatting.
// eslint-disable-next-line no-control-regex
const invalidXmlControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escaped(value: unknown): string {
  return String(value ?? '')
    .replace(invalidXmlControls, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function column(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cell(value: CellValue, reference: string, header = false): string {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '';
  const style = header
    ? ' s="1"'
    : typeof value === 'number'
      ? ` s="${Number.isInteger(value) ? 3 : 2}"`
      : '';
  if (typeof value === 'number') return `<c r="${reference}"${style}><v>${value}</v></c>`;
  if (typeof value === 'boolean')
    return `<c r="${reference}" t="b"${style}><v>${Number(value)}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escaped(value)}</t></is></c>`;
}

function worksheet(rows: Row[], widths: number[], drawing = false): string {
  const maxCol = Math.max(1, ...rows.map((row) => row.length));
  const last = `${column(maxCol - 1)}${Math.max(rows.length, 1)}`;
  const rowXml = rows
    .map((row, i) => {
      // Estimate wider non-ASCII glyphs; this equivalent range does not include ASCII controls.
      const lines = Math.max(
        1,
        ...row.map((value, j) =>
          typeof value === 'string'
            ? Math.ceil(
                value.replace(/[\u0080-\uFFFF]/g, 'xx').length / Math.max(8, (widths[j] ?? 20) - 2),
              )
            : 1,
        ),
      );
      const height = Math.max(i === 0 ? 32 : 18, lines * 17);
      return `<row r="${i + 1}" ht="${height}" customHeight="1">${row.map((value, j) => cell(value, `${column(j)}${i + 1}`, i === 0)).join('')}</row>`;
    })
    .join('');
  return `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rowXml}</sheetData>${rows.length > 1 && !drawing ? `<autoFilter ref="A1:${last}"/>` : ''}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>${drawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

function flatten(object: unknown, prefix = ''): [string, CellValue][] {
  if (object == null) return [[prefix, null]];
  if (typeof object !== 'object') return [[prefix, object as CellValue]];
  return Object.entries(object).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

function runName(run: TestRun): string {
  return `${run.label} · ${run.direction} · BF ${run.bf ? 'ON' : 'OFF'} · ${run.status}`;
}

const headers: Row = [
  'Run ID',
  'Run label',
  'Run status',
  'Band',
  'Direction',
  'Protocol',
  'Transmitter BF',
  'RF transmitter',
  'STA BF config',
  'STA BF runtime',
  'AP BF',
  'Attenuation (dB)',
  'RSSI (dBm)',
  'SNR (dB)',
  'MCS',
  'NSS',
  'PHY rate (Mbps)',
  'Throughput (Mbps)',
  'Point time (simulated s)',
  'Seed',
  'Server IP',
  'Port',
  'Streams',
  'Duration (s)',
  'Simulation',
];

function stationBf(values: Record<string, string>): string | undefined {
  const sections = Object.keys(values)
    .filter((key) => key.startsWith('wireless.') && key.endsWith('.mode') && values[key] === 'sta')
    .map((key) => key.slice(0, -5));
  const section =
    sections.find((key) => key === 'wireless.stamld0') ??
    sections.find((key) => values[`${key}.ifname`] === 'stamld0') ??
    sections[0] ??
    'wireless.stamld0';
  const radio = values[`${section}.device`]?.replace(/["']/g, '').split(/\s+/)[0];
  return radio ? values[`wireless.${radio}.etxbfencond`] : undefined;
}

function measurementRows(state: LabState): Row[] {
  const rows: Row[] = [headers];
  for (const run of state.msp.runs) {
    const configured = { ...run.metadata.committed, ...run.metadata.pending };
    for (const key of Object.keys(configured))
      if (configured[key] === '__DELETE__') delete configured[key];
    const staBf = stationBf(run.metadata.runtime);
    const configuredBf = stationBf(configured);
    for (const p of run.points) {
      rows.push([
        run.id,
        run.label,
        run.status,
        run.metadata.band,
        run.direction,
        run.settings.protocol,
        p.bf ? 'ON' : 'OFF',
        run.metadata.transmitter,
        configuredBf,
        staBf,
        run.metadata.ap.txbf,
        p.attenuation,
        p.rssi,
        p.snr,
        p.mcs,
        p.nss,
        p.phyRate,
        p.throughput,
        p.time,
        run.settings.seed,
        run.settings.serverIp,
        run.settings.port,
        run.settings.streams,
        run.settings.duration,
        'SIMULATED',
      ]);
    }
  }
  return rows;
}

function csvCell(value: CellValue): string {
  let text = value == null ? '' : String(value);
  // User labels/logs stay text in spreadsheet applications, even when they start with a formula prefix.
  if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Raw recorded points only; the browser download layer may prefix U+FEFF for Excel UTF-8 detection. */
export function exportCsv(state: LabState): string {
  return measurementRows(state)
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function cache(points: number[]): string {
  return `<c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="${points.length}"/>${points.map((value, i) => (Number.isFinite(value) ? `<c:pt idx="${i}"><c:v>${value}</c:v></c:pt>` : '')).join('')}</c:numCache>`;
}

function richText(text: string): string {
  return `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100"/></a:pPr><a:r><a:rPr lang="zh-TW"/><a:t>${escaped(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}

function chart(state: LabState): string {
  let nextRow = 2;
  const series = state.msp.runs
    .map((run, index) => {
      const start = nextRow;
      nextRow += run.points.length;
      if (!run.points.length) return '';
      const end = nextRow - 1;
      const color = run.bf ? ON : OFF;
      const x = `'Measurements'!$L$${start}:$L$${end}`;
      const y = `'Measurements'!$R$${start}:$R$${end}`;
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${escaped(runName(run))}</c:v></c:tx><c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr></c:marker><c:xVal><c:numRef><c:f>${escaped(x)}</c:f>${cache(run.points.map((p) => p.attenuation))}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${escaped(y)}</c:f>${cache(run.points.map((p) => p.throughput))}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
    })
    .join('');
  const axis = (id: number, position: string, title: string, cross: number) =>
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="${position}"/>${position === 'l' ? '<c:majorGridlines/>' : ''}<c:title>${richText(title)}<c:layout/><c:overlay val="0"/></c:title><c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;
  return `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><c:lang val="zh-TW"/><c:chart><c:title>${richText('RvR · recorded simulated runs')}<c:layout/><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:axId val="1001"/><c:axId val="1002"/></c:scatterChart>${axis(1001, 'b', 'Attenuation (dB)', 1002)}${axis(1002, 'l', 'Throughput (Mbps)', 1001)}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

function metadataRows(state: LabState): Row[] {
  const rows: Row[] = [['Run ID', 'Field', 'Value']];
  rows.push(
    ['Lab', 'simulation', disclosure],
    ['Lab', 'bf interpretation', bfNotice],
    [
      'Lab',
      'source',
      'WiFi_QA_Field_Guide_Compressed.pdf (38 pages, 2026.10 v1.0); Ubuntu虛擬機使用iperf3.pdf (6 pages)',
    ],
  );
  for (const run of state.msp.runs) {
    const snapshot = {
      label: run.label,
      bf: run.bf,
      direction: run.direction,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      error: run.error,
      settings: run.settings,
      metadata: run.metadata,
    };
    for (const [key, value] of flatten(snapshot)) rows.push([run.id, key, value]);
  }
  return rows;
}

function relationships(items: [string, string, string][]): string {
  return `${XML}<Relationships xmlns="${PKGREL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${escaped(target)}"/>`).join('')}</Relationships>`;
}

/** A native editable XY chart references Measurements cells; no rendered image is substituted for a chart. */
export function exportXlsx(state: LabState): Uint8Array {
  const recorded = state.msp.runs.some((run) => run.points.length > 0);
  const curve: Row[] = [
    ['Wi-Fi QA RvR', 'Recorded simulated runs'],
    ['資料來源', disclosure],
    ['BF 控制側', bfNotice],
    ['使用方式', '圖表參照 Measurements 工作表；可在 Excel 編輯原始數值與曲線。'],
    ['完成狀態', 'completed / interrupted / running 保留原始狀態，未量測點不補零。'],
    [],
    ['Run ID', 'Label', 'Direction', 'Transmitter BF', 'Status', 'Points'],
  ];
  for (const run of state.msp.runs)
    curve.push([
      run.id,
      run.label,
      run.direction,
      run.bf ? 'ON' : 'OFF',
      run.status,
      run.points.length,
    ]);
  if (!recorded) curve.push(['尚無已測資料', '請先執行 MSP 測試。']);
  const names = ['Curve', 'Measurements', 'Metadata', 'Log'];
  const sheets = [
    worksheet(curve, [24, 90, 15, 20, 18, 12], recorded),
    worksheet(
      measurementRows(state),
      headers.map((_, i) => (i === 1 ? 30 : 21)),
    ),
    worksheet(metadataRows(state), [24, 55, 90]),
    worksheet(
      [
        ['Simulated time (s)', 'Source', 'Level', 'Message'],
        ...state.logs.map((log) => [log.time, log.source, log.level, log.message]),
      ],
      [24, 22, 16, 110],
    ),
  ];
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, body: string) => {
    files[path] = strToU8(body);
  };
  put(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${recorded ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' : ''}</Types>`,
  );
  put('_rels/.rels', relationships([['rId1', 'officeDocument', 'xl/workbook.xml']]));
  put(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    relationships([
      ...names.map(
        (_, i) =>
          [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`] as [string, string, string],
      ),
      ['rId5', 'styles', 'styles.xml'],
    ]),
  );
  put(
    'xl/styles.xml',
    `${XML}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Aptos"/><color rgb="FF1F2937"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF172033"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  sheets.forEach((body, i) => put(`xl/worksheets/sheet${i + 1}.xml`, body));
  if (recorded) {
    put(
      'xl/worksheets/_rels/sheet1.xml.rels',
      relationships([['rId1', 'drawing', '../drawings/drawing1.xml']]),
    );
    put(
      'xl/drawings/drawing1.xml',
      `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.max(curve.length + 2, 12)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.max(curve.length + 2, 12) + 25}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="RvR BF ON OFF"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
    );
    put(
      'xl/drawings/_rels/drawing1.xml.rels',
      relationships([['rId1', 'chart', '../charts/chart1.xml']]),
    );
    put('xl/charts/chart1.xml', chart(state));
  }
  return zipSync(files, { level: 6 });
}

function svgChart(runs: TestRun[]): string {
  const width = 1000,
    height = 480,
    left = 78,
    top = 28,
    bottom = 68,
    right = 24;
  const all = runs.flatMap((run) => run.points);
  const maxX = Math.max(90, ...all.map((p) => p.attenuation));
  const maxY = Math.max(100, ...all.map((p) => p.throughput)) * 1.08;
  const x = (value: number) => left + (value / maxX) * (width - left - right);
  const y = (value: number) => height - bottom - (value / maxY) * (height - top - bottom);
  const grid = Array.from({ length: 6 }, (_, i) => {
    const value = (maxY * i) / 5;
    return `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#d9e1ea"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${Math.round(value)}</text>`;
  }).join('');
  const xLabels = Array.from({ length: 7 }, (_, i) => {
    const value = (maxX * i) / 6;
    return `<text x="${x(value)}" y="${height - bottom + 25}" text-anchor="middle">${Math.round(value)}</text>`;
  }).join('');
  const curves = runs
    .map(
      (run) =>
        `<g><title>${escaped(runName(run))}</title><polyline fill="none" stroke="#${run.bf ? ON : OFF}" stroke-width="3" points="${run.points
          .filter((p) => Number.isFinite(p.attenuation) && Number.isFinite(p.throughput))
          .map((p) => `${x(p.attenuation).toFixed(2)},${y(p.throughput).toFixed(2)}`)
          .join(' ')}"/>${run.points
          .filter((p) => Number.isFinite(p.attenuation) && Number.isFinite(p.throughput))
          .map(
            (p) =>
              `<circle cx="${x(p.attenuation).toFixed(2)}" cy="${y(p.throughput).toFixed(2)}" r="3" fill="#${run.bf ? ON : OFF}"><title>${p.attenuation} dB / ${p.throughput} Mbps</title></circle>`,
          )
          .join('')}</g>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded simulated RvR curves"><rect width="100%" height="100%" fill="white"/><g fill="#334155" font-family="sans-serif" font-size="13">${grid}${xLabels}<line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#64748b"/>${curves}<text x="${width / 2}" y="${height - 16}" text-anchor="middle">Attenuation (dB)</text><text transform="translate(19 ${height / 2}) rotate(-90)" text-anchor="middle">Throughput (Mbps)</text></g></svg>`;
}

/** Standalone report: actual recorded points, immutable run snapshots, and lab log; no remote assets. */
export function exportReport(state: LabState): string {
  const runs = state.msp.runs;
  const table = (rows: Row[], isHeader = true) =>
    `<table>${rows.map((row, i) => `<tr>${row.map((value) => `<${i === 0 && isHeader ? 'th' : 'td'}>${escaped(value)}</${i === 0 && isHeader ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wi-Fi QA · RvR 測試報告</title><style>body{max-width:1100px;margin:32px auto;padding:0 24px;font:14px/1.65 system-ui,sans-serif;color:#172033;background:#fff}h1{font-size:28px}h2{margin-top:28px}.note{padding:14px 18px;background:#eef4ff;border-left:4px solid #60a5fa}svg{width:100%;height:auto}.legend{display:flex;gap:16px;flex-wrap:wrap}.legend span{border-left:4px solid;padding-left:8px}table{border-collapse:collapse;width:100%;font-size:12px;margin:14px 0}th,td{text-align:left;border-bottom:1px solid #d8e0eb;padding:8px;vertical-align:top;overflow-wrap:anywhere}th{background:#edf2f8}.scroll{overflow:auto}.scroll table{min-width:2200px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:16px}details{margin:16px 0}@media print{body{margin:0;padding:16px}.scroll{overflow:visible}table{font-size:10px}details{display:block}details>*{display:block}}</style></head><body><h1>Wi-Fi QA RvR 測試報告</h1><p class="note">${escaped(disclosure)}<br>${escaped(bfNotice)}</p><p>已保存 ${runs.length} 個 Run；曲線保留原始 measured points。未量測點不補零，中斷結果依原始狀態標示。時間以實驗室模擬時鐘秒數記錄。</p><h2>RvR 疊圖</h2>${runs.some((run) => run.points.length) ? svgChart(runs) : '<p>尚無已測資料。</p>'}<div class="legend">${runs.map((run) => `<span style="border-color:#${run.bf ? ON : OFF}">${escaped(runName(run))}</span>`).join('')}</div><h2>Run 摘要</h2>${table([['Run', 'Band', 'Direction', 'Transmitter', 'Actual BF', 'Status', 'Points', 'Error'], ...runs.map((run) => [run.label, run.metadata.band, run.direction, run.metadata.transmitter, run.bf ? 'ON' : 'OFF', run.status, run.points.length, run.error])])}<h2>原始資料</h2><div class="scroll">${table(measurementRows(state))}</div><h2>每輪組態與 Runtime 快照</h2>${runs.map((run) => `<details open><summary>${escaped(run.label)} / ${escaped(run.id)}</summary><pre>${escaped(JSON.stringify({ settings: run.settings, metadata: run.metadata, startedAt: run.startedAt, endedAt: run.endedAt }, null, 2))}</pre></details>`).join('')}<h2>現場 Log</h2>${table([['Simulated seconds', 'Source', 'Level', 'Message'], ...state.logs.map((log) => [log.time, log.source, log.level, log.message])])}<p>教材：WiFi_QA_Field_Guide_Compressed.pdf（38 頁，2026.10 v1.0）／Ubuntu虛擬機使用iperf3.pdf（6 頁）。硬體名稱與 BF 0/3 依教材案例；實機需依受控 SOP／Driver 文件另行驗證。</p></body></html>`;
}
