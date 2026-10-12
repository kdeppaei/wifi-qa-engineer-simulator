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

/** Replace only this template sheet's report printing settings. */
export function reportPrintSetup(sheet: string): string {
  sheet = sheet.replace(/<x:pageSetUpPr\b[^>]*(?:\s*\/>|>[\s\S]*?<\/x:pageSetUpPr>)/g, '');
  sheet = sheet.replace('</x:sheetPr>', '<x:pageSetUpPr fitToPage="1"/></x:sheetPr>');
  sheet = sheet.replace(
    /<x:(?:printOptions|pageSetup|headerFooter)\b[^>]*(?:\s*\/>|>[\s\S]*?<\/x:(?:printOptions|pageSetup|headerFooter)>)/g,
    '',
  );
  const setup =
    '<x:printOptions horizontalCentered="1" gridLines="0"/><x:pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><x:pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><x:headerFooter><x:oddFooter>&amp;R&amp;P / &amp;N</x:oddFooter></x:headerFooter>';
  return /<x:pageMargins\b/.test(sheet)
    ? sheet.replace(/<x:pageMargins\b[^>]*\/\s*>/, setup)
    : sheet.replace(/(?=<x:(?:drawing|tableParts)\b|<\/x:worksheet>)/, setup);
}

export function reportPrintNames(
  workbook: string,
  sheetName: string,
  sheetId: number,
  lastColumn: string,
  lastRow: number,
): string {
  workbook = workbook.replace(
    /<x:definedName\b([^>]*)>[\s\S]*?<\/x:definedName>/g,
    (all, attrs: string) =>
      new RegExp(`\\blocalSheetId="${sheetId}"`).test(attrs) &&
      /\bname="_xlnm.Print_(?:Area|Titles)"/.test(attrs)
        ? ''
        : all,
  );
  const quotedSheet = xml(sheetName.replace(/'/g, "''"));
  const names = `<x:definedName name="_xlnm.Print_Area" localSheetId="${sheetId}">'${quotedSheet}'!$A$2:$${lastColumn}$${lastRow}</x:definedName><x:definedName name="_xlnm.Print_Titles" localSheetId="${sheetId}">'${quotedSheet}'!$6:$6</x:definedName>`;
  return workbook.includes('<x:definedNames>')
    ? workbook.replace('</x:definedNames>', names + '</x:definedNames>')
    : workbook.replace('</x:sheets>', `</x:sheets><x:definedNames>${names}</x:definedNames>`);
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
function fitHeader(
  sheet: string,
  files: ReturnType<typeof unzipSync>,
  labels: string[],
  columns: string[],
) {
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
    new RegExp(`<x:c\\b([^>]*?\\br="(?:${columns.join('|')})6"[^>]*?)(\\s*\\/?>)`, 'g'),
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

function fitReportTable(
  sheet: string,
  files: ReturnType<typeof unzipSync>,
  series: Point[][],
  specs: string[][],
) {
  let styles = strFromU8(files['xl/styles.xml']).replace(/rgb="FFFFF8DF"/g, 'rgb="FFFFFFFF"');
  const borderBlock = styles.match(/<x:borders\b[^>]*>([\s\S]*?)<\/x:borders>/)!;
  const borderCount = (borderBlock[1].match(/<x:border\b/g) ?? []).length;
  const border =
    '<x:border><x:left style="thin"><x:color rgb="FFE2E8F0"/></x:left><x:right style="thin"><x:color rgb="FFE2E8F0"/></x:right><x:top style="thin"><x:color rgb="FFE2E8F0"/></x:top><x:bottom style="thin"><x:color rgb="FFE2E8F0"/></x:bottom><x:diagonal/></x:border>';
  styles = styles.replace(
    borderBlock[0],
    `<x:borders count="${borderCount + 1}">${borderBlock[1]}${border}</x:borders>`,
  );
  const xfBlock = styles.match(/<x:cellXfs\b[^>]*>([\s\S]*?)<\/x:cellXfs>/)!;
  const formats = xfBlock[1].match(/<x:xf\b[^>]*?(?:\s*\/>|>[\s\S]*?<\/x:xf>)/g)!;
  const bodyStyle = formats.length;
  formats.push(
    `<x:xf numFmtId="200" fontId="1" fillId="0" borderId="${borderCount}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><x:alignment horizontal="right" vertical="center" indent="1"/></x:xf>`,
  );
  styles = styles.replace(
    xfBlock[0],
    `<x:cellXfs count="${formats.length}">${formats.join('')}</x:cellXfs>`,
  );
  files['xl/styles.xml'] = strToU8(styles);
  const lengths = new Map(
    specs.flatMap((pair, index) => pair.map((column) => [column, series[index].length] as const)),
  );
  sheet = sheet.replace(
    /<x:c\b([^>]*?\br="([A-Z]+)(\d+)"[^>]*?)(\s*\/?>)/g,
    (all, attrs: string, column: string, row: string, close: string) => {
      const length = lengths.get(column);
      if (length === undefined || Number(row) < 7 || Number(row) >= length + 7) return all;
      return `<x:c${attrs.replace(/\s+s="[^"]*"/g, '')} s="${bodyStyle}"${close}`;
    },
  );
  sheet = sheet.replace(/showGridLines="[^"]*"/, 'showGridLines="0"');
  sheet = sheet.replace(/<x:mergeCells\b[^>]*>[\s\S]*?<\/x:mergeCells>/g, '');
  sheet = sheet.replace(
    '</x:sheetData>',
    '</x:sheetData><x:mergeCells count="3"><x:mergeCell ref="A2:Q2"/><x:mergeCell ref="A3:Q3"/><x:mergeCell ref="A4:Q4"/></x:mergeCells>',
  );
  return reportPrintSetup(sheet);
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
  sheet = replaceCell(sheet, 'A3', `X：${labels.xLabel}；Y：${labels.yLabel}`);
  sheet = replaceCell(sheet, 'A4', `Source: ${source}${note.trim() ? ' / ' + note.trim() : ''}`);
  sheet = replaceCell(sheet, 'A5', null);
  sheet = fitHeader(
    sheet,
    files,
    [labels.xLabel, ...options.curves.map((curve) => curve.name)],
    specs.flat(),
  );
  sheet = fitReportTable(sheet, files, series, specs);
  sheet = sheet.replace(/<x:sheetProtection\b[^>]*(?:\s*\/>|>[\s\S]*?<\/x:sheetProtection>)/g, '');
  files[path] = strToU8(sheet);
  const inactiveNumber = compare ? 1 : 2;
  const inactiveName = compare ? 'Single' : 'TxBF';
  const inactivePath = `xl/worksheets/sheet${inactiveNumber}.xml`;
  const inactiveSpecs = compare
    ? [['A', 'B']]
    : [
        ['A', 'B'],
        ['D', 'E'],
      ];
  let inactiveSheet = strFromU8(files[inactivePath]);
  inactiveSheet = replaceCell(inactiveSheet, 'A3', 'X：dB；Y：Throughput (Mbps)');
  inactiveSheet = replaceCell(inactiveSheet, 'A5', null);
  inactiveSheet = fitHeader(
    inactiveSheet,
    files,
    ['dB', 'Throughput (Mbps)'],
    inactiveSpecs.flat(),
  );
  inactiveSheet = fitReportTable(
    inactiveSheet,
    files,
    inactiveSpecs.map(() => []),
    inactiveSpecs,
  );
  files[inactivePath] = strToU8(inactiveSheet);
  // Keep both reusable worksheets, opening the active one on download.
  const workbook = strFromU8(files['xl/workbook.xml']);
  let reportWorkbook = workbook.includes('<x:bookViews>')
    ? workbook.replace(/activeTab="\d+"/g, `activeTab="${number - 1}"`)
    : workbook.replace(
        '<x:sheets>',
        `<x:bookViews><x:workbookView activeTab="${number - 1}"/></x:bookViews><x:sheets>`,
      );
  const lastReportRow = Math.max(28, ...series.map((points) => points.length + 6));
  reportWorkbook = reportPrintNames(reportWorkbook, name, number - 1, 'Q', lastReportRow);
  reportWorkbook = reportPrintNames(reportWorkbook, inactiveName, inactiveNumber - 1, 'Q', 28);
  files['xl/workbook.xml'] = strToU8(reportWorkbook);
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
