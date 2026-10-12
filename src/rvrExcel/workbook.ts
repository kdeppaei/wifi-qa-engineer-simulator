import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { templateBase64 } from './template';
import type { Point } from './data';
import {
  defaultChartOptions,
  validateChartOptions,
  type ChartOptions,
  type CurveStyle,
} from './presentation';

export const xml = (s: string) =>
  [...s]
    .filter((c) => c.charCodeAt(0) >= 32 || [9, 10, 13].includes(c.charCodeAt(0)))
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
function replaceCell(sheet: string, address: string, value: string | number | null) {
  const pattern = new RegExp(`<x:c\\b([^>]*?\\br="${address}"[^>]*?)(?:\\s*/>|>[\\s\\S]*?</x:c>)`);
  if (!pattern.test(sheet)) throw new Error(`範本缺少儲存格 ${address}`);
  return sheet.replace(pattern, (_all, attrs: string) => {
    attrs = attrs.replace(/\s+t="[^"]*"/g, '');
    return value === null
      ? `<x:c${attrs}/>`
      : typeof value === 'number'
        ? `<x:c${attrs}><x:v>${value}</x:v></x:c>`
        : `<x:c${attrs} t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value)}</x:t></x:is></x:c>`;
  });
}
function cache(points: Point[], x: boolean) {
  return `<c:numCache><c:formatCode>0.##</c:formatCode><c:ptCount val="1000"/>${points.flatMap((p, i) => ((x ? p.db : p.mbps) === null ? [] : [`<c:pt idx="${i}"><c:v>${x ? p.db : p.mbps}</c:v></c:pt>`])).join('')}</c:numCache>`;
}
function stringReference(sheet: string, cell: string, value: string) {
  const address = cell.match(/^(\D+)(\d+)$/)!;
  return `<c:strRef><c:f>'${sheet}'!$${address[1]}$${address[2]}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xml(value)}</c:v></c:pt></c:strCache></c:strRef>`;
}
function nativeStyle(style: CurveStyle) {
  const color = style.color.slice(1).toUpperCase();
  const fill = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const line =
    style.lineStyle === 'none'
      ? '<a:ln><a:noFill/></a:ln>'
      : `<a:ln w="${Math.round(style.lineWidth * 12700)}">${fill}<a:prstDash val="${style.lineStyle === 'dot' ? 'sysDot' : style.lineStyle}"/></a:ln>`;
  return {
    shape: `<c:spPr>${line}</c:spPr>`,
    marker: `<c:marker><c:symbol val="${style.marker}"/><c:size val="${style.markerSize}"/><c:spPr>${fill}<a:ln>${fill}</a:ln></c:spPr></c:marker>`,
  };
}

/** Only our embedded, unprotected template is processed here; no uploaded workbooks are changed. */
function fitHeader(sheet: string, files: ReturnType<typeof unzipSync>, labels: string[]) {
  const path = 'xl/styles.xml';
  let styles = strFromU8(files[path]);
  const xfs = styles.match(/<x:cellXfs\b[^>]*>([\s\S]*?)<\/x:cellXfs>/);
  if (!xfs) throw new Error('範本缺少儲存格格式。');
  const formats: string[] = xfs[1].match(/<x:xf\b[^>]*?(?:\s*\/>|>[\s\S]*?<\/x:xf>)/g) ?? [];
  const header = sheet.match(/<x:c\b[^>]*\br="B6"[^>]*>/)?.[0];
  const headerStyle = Number(header?.match(/\bs="(\d+)"/)?.[1]);
  let wrapped = formats[headerStyle];
  if (!wrapped) throw new Error('範本缺少欄位標題格式。');
  wrapped = wrapped.replace(/<x:alignment\b[^>]*(?:\s*\/>|>[\s\S]*?<\/x:alignment>)/g, '');
  wrapped = wrapped.replace(/\s+applyAlignment="[^"]*"/, '');
  wrapped = wrapped.replace(/^<x:xf\b/, '<x:xf applyAlignment="1"');
  if (/\/>$/.test(wrapped)) wrapped = wrapped.replace(/\s*\/>$/, '></x:xf>');
  wrapped = wrapped.replace(
    '</x:xf>',
    '<x:alignment horizontal="center" vertical="center" wrapText="1"/></x:xf>',
  );
  const existingStyle = formats.indexOf(wrapped);
  const newStyle = existingStyle < 0 ? formats.length : existingStyle;
  if (existingStyle < 0)
    styles = styles.replace(
      xfs[0],
      `<x:cellXfs count="${newStyle + 1}">${xfs[1]}${wrapped}</x:cellXfs>`,
    );
  files[path] = strToU8(styles);
  sheet = sheet.replace(
    /<x:c\b([^>]*?\br="(?:A|B|D|E)6"[^>]*?)(\s*\/?>)/g,
    (_all, attrs: string, close: string) =>
      `<x:c${attrs.replace(/\s+s="[^"]*"/g, '')} s="${newStyle}"${close}`,
  );
  // Enough height for ordinary custom labels. Longer labels wrap instead of shrinking the font.
  const height = Math.max(44, ...labels.map((label) => Math.ceil(label.length / 22) * 16));
  return sheet.replace(
    /<x:row\b([^>]*?\br="6"[^>]*?)>/,
    (_all, attrs: string) =>
      `<x:row${attrs.replace(/\s+(?:ht|customHeight)="[^"]*"/g, '')} ht="${height}" customHeight="1">`,
  );
}
export function makeWorkbook(
  series: Point[][],
  source: string,
  note: string,
  labels = { xLabel: 'dB', yLabel: 'Throughput (Mbps)' },
  chartOptions?: ChartOptions,
): Uint8Array {
  if (
    series.length < 1 ||
    series.length > 2 ||
    series.some(
      (points) =>
        points.length > 1000 ||
        points.some(
          (point) =>
            !Number.isFinite(point.db) || (point.mbps !== null && !Number.isFinite(point.mbps)),
        ),
    )
  )
    throw new Error('資料組數或測點數不正確。');
  const bytes = Uint8Array.from(atob(templateBase64), (c) => c.charCodeAt(0));
  const files = unzipSync(bytes);
  const compare = series.length === 2;
  const options = chartOptions ?? defaultChartOptions(compare, labels.yLabel);
  validateChartOptions(options, series.length);
  const number = compare ? 2 : 1;
  const name = compare ? 'TxBF' : 'Single';
  const path = `xl/worksheets/sheet${number}.xml`;
  let sheet = strFromU8(files[path]);
  const specs = compare
    ? [
        ['A', 'B'],
        ['D', 'E'],
      ]
    : [['A', 'B']];
  for (const [i, points] of series.entries()) {
    sheet = replaceCell(sheet, `${specs[i][0]}6`, labels.xLabel);
    sheet = replaceCell(sheet, `${specs[i][1]}6`, options.curves[i].name);
    for (const [j, p] of points.entries()) {
      sheet = replaceCell(sheet, `${specs[i][0]}${j + 7}`, p.db);
      sheet = replaceCell(sheet, `${specs[i][1]}${j + 7}`, p.mbps);
    }
  }
  sheet = replaceCell(sheet, 'A2', options.title);
  sheet = replaceCell(
    sheet,
    'A3',
    '從第 7 列貼入 X / Y 數值。每條曲線最多 1,000 點，缺值保持空白。',
  );
  sheet = replaceCell(sheet, 'A4', `Source: ${source}${note.trim() ? ' / ' + note.trim() : ''}`);
  sheet = replaceCell(
    sheet,
    'A5',
    `改 A2 更新圖表標題，改 ${compare ? 'B6 / E6' : 'B6'} 更新曲線名稱。右鍵圖表「選取資料」；點曲線查看 SERIES 公式。`,
  );
  sheet = fitHeader(sheet, files, [labels.xLabel, ...options.curves.map((curve) => curve.name)]);
  sheet = sheet.replace(/<x:sheetProtection\b[^>]*(?:\s*\/>|>[\s\S]*?<\/x:sheetProtection>)/g, '');
  files[path] = strToU8(sheet);
  // Keep both reusable worksheets, opening the active one on download.
  const workbook = strFromU8(files['xl/workbook.xml']);
  files['xl/workbook.xml'] = strToU8(
    workbook.includes('<x:bookViews>')
      ? workbook.replace(/activeTab="\d+"/g, `activeTab="${number - 1}"`)
      : workbook.replace(
          '<x:sheets>',
          `<x:bookViews><x:workbookView activeTab="${number - 1}"/></x:bookViews><x:sheets>`,
        ),
  );
  const chartPath = `xl/drawings/charts/chart${number}.xml`;
  let chart = strFromU8(files[chartPath]);
  chart = chart.replace(
    /<c:chartSpace\b([^>]*)>/,
    (_all, attrs: string) =>
      `<c:chartSpace${attrs.includes('xmlns:a=') ? attrs : attrs + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'}>`,
  );
  // A linked native title remains editable through A2 or Excel's title formula bar.
  chart = chart.replace(/<c:title>[\s\S]*?<\/c:title>/, (title) =>
    title.replace(
      /<c:tx>[\s\S]*?<\/c:tx>/,
      `<c:tx>${stringReference(name, 'A2', options.title)}</c:tx>`,
    ),
  );
  chart = chart.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, (axis) => {
    axis = axis.replace(
      /(<c:title>[\s\S]*?<a:t>)[\s\S]*?(<\/a:t>)/,
      (_m, before: string, after: string) =>
        before + xml(/<c:axPos val="b"/.test(axis) ? labels.xLabel : labels.yLabel) + after,
    );
    const grid =
      '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>';
    if (!options.showGrid)
      axis = axis.replace(/<c:majorGridlines\b[^>]*(?:\s*\/>|>[\s\S]*?<\/c:majorGridlines>)/g, '');
    else if (!axis.includes('<c:majorGridlines'))
      axis = axis.replace(/(<c:axPos\b[^>]*\/\s*>)/, '$1' + grid);
    return axis;
  });
  let index = 0;
  chart = chart.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const [x, y] = specs[index];
    const points = series[index];
    const style = options.curves[index++];
    const native = nativeStyle(style);
    return ser
      .replace(
        /<c:tx>[\s\S]*?<\/c:tx>/,
        `<c:tx>${stringReference(name, `${y}6`, style.name)}</c:tx>`,
      )
      .replace(/<c:spPr>[\s\S]*?<\/c:spPr>/, native.shape)
      .replace(/<c:marker>[\s\S]*?<\/c:marker>/, native.marker)
      .replace(
        /<c:xVal>[\s\S]*?<\/c:xVal>/,
        `<c:xVal><c:numRef><c:f>'${name}'!$${x}$7:$${x}$1006</c:f>${cache(points, true)}</c:numRef></c:xVal>`,
      )
      .replace(
        /<c:yVal>[\s\S]*?<\/c:yVal>/,
        `<c:yVal><c:numRef><c:f>'${name}'!$${y}$7:$${y}$1006</c:f>${cache(points, false)}</c:numRef></c:yVal>`,
      )
      .replace(/<c:smooth\b[^>]*\/\s*>/g, '')
      .replace('</c:ser>', '<c:smooth val="0"/></c:ser>');
  });
  if (index !== series.length) throw new Error('範本曲線與資料組數不一致。');
  if (!options.showLegend) chart = chart.replace(/<c:legend>[\s\S]*?<\/c:legend>/g, '');
  else if (!chart.includes('<c:legend>'))
    chart = chart.replace(
      '</c:plotArea>',
      '</c:plotArea><c:legend><c:legendPos val="t"/><c:overlay val="0"/></c:legend>',
    );
  chart = chart.replace(/<c:protection\b[^>]*(?:\s*\/>|>[\s\S]*?<\/c:protection>)/g, '');
  files[chartPath] = strToU8(chart);
  return zipSync(files, { level: 6 });
}
