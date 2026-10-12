import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { peakTemplateBase64 } from './template';
import { blankPeakValues, getPeakRows, peakCellValue, validatePeakDocument } from './model';
import type { PeakDocument, PeakSettings } from './model';
import { xml } from '../rvrExcel/workbook';

export function peakHeaderTextColor(color: string): string {
  const components = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return components[0] * 0.299 + components[1] * 0.587 + components[2] * 0.114 > 150
    ? '#172033'
    : '#FFFFFF';
}
function columnName(index: number) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
function cell(address: string, value: string | number | null, style: number) {
  if (value === null) return `<x:c r="${address}" s="${style}"/>`;
  if (typeof value === 'number')
    return `<x:c r="${address}" s="${style}"><x:v>${value}</x:v></x:c>`;
  if (value.length > 32767) throw new Error('單一儲存格最多可填 32,767 個字元。');
  // Literal leading '=' remains text; manually supplied Gain never becomes a formula.
  return `<x:c r="${address}" s="${style}" t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value)}</x:t></x:is></x:c>`;
}
function fitStyles(styles: string, settings: PeakSettings) {
  const fonts = styles.match(/<x:fonts\b[^>]*>([\s\S]*?)<\/x:fonts>/)!;
  const items = fonts[1].match(/<x:font>[\s\S]*?<\/x:font>/g)!;
  for (const index of [1, 2, 4])
    items[index] = items[index].replace(
      /<x:sz\b[^>]*\/\s*>/,
      `<x:sz val="${settings.fontSize + (index === 2 ? 4 : 0)}"/>`,
    );
  items[4] = items[4].replace(
    /<x:color\b[^>]*\/\s*>/,
    `<x:color rgb="FF${peakHeaderTextColor(settings.headerColor).slice(1)}"/>`,
  );
  styles = styles.replace(fonts[0], `<x:fonts count="${items.length}">${items.join('')}</x:fonts>`);
  const fillBlock = styles.match(/<x:fills\b[^>]*>([\s\S]*?)<\/x:fills>/)!;
  const fills = fillBlock[1].match(/<x:fill>[\s\S]*?<\/x:fill>/g)!;
  fills[2] = `<x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FF${settings.headerColor.slice(1).toUpperCase()}"/></x:patternFill></x:fill>`;
  const stripe = fills.length;
  fills.push(
    '<x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FFF0F5FB"/></x:patternFill></x:fill>',
  );
  const plain = fills.length;
  fills.push(
    '<x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FFFFFFFF"/></x:patternFill></x:fill>',
  );
  styles = styles.replace(
    fillBlock[0],
    `<x:fills count="${fills.length}">${fills.join('')}</x:fills>`,
  );
  const format = settings.decimals ? '0.' + '0'.repeat(settings.decimals) : '0';
  styles = styles.replace(
    /<x:numFmt\b[^>]*\bnumFmtId="201"[^>]*\/\s*>/,
    `<x:numFmt numFmtId="201" formatCode="${format}"/>`,
  );
  const xfs = styles.match(/<x:cellXfs\b[^>]*>([\s\S]*?)<\/x:cellXfs>/)!;
  const formats = xfs[1].match(/<x:xf\b[^>]*?(?:\s*\/>|>[\s\S]*?<\/x:xf>)/g)!;
  const base = formats.length;
  for (let band = 0; band < 2; band++)
    for (const numberFormat of [0, 200, 201])
      formats.push(
        `<x:xf numFmtId="${numberFormat}" fontId="1" fillId="${band ? stripe : plain}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><x:alignment horizontal="${numberFormat ? 'right' : 'left'}" ${numberFormat ? '' : 'indent="1"'} vertical="center" wrapText="1"/></x:xf>`,
      );
  styles = styles.replace(
    xfs[0],
    `<x:cellXfs count="${formats.length}">${formats.join('')}</x:cellXfs>`,
  );
  return { styles, base };
}
const weightedLength = (text: string) =>
  [...text].reduce((length, c) => length + (c.charCodeAt(0) > 255 ? 2 : 1), 0);

export function makePeakWorkbook(document: PeakDocument, blank = false): Uint8Array {
  const errors = validatePeakDocument(document);
  if (errors.length) throw new Error(errors[0]);
  const columns = document.columns.filter((c) => c.visible);
  const rows = getPeakRows(document);
  const settings = document.settings;
  const files = unzipSync(Uint8Array.from(atob(peakTemplateBase64), (c) => c.charCodeAt(0)));
  const fitted = fitStyles(strFromU8(files['xl/styles.xml']), settings);
  files['xl/styles.xml'] = strToU8(fitted.styles);
  const lastColumn = columnName(columns.length - 1);
  const lastRow = 6 + rows.length;
  const ref = `A6:${lastColumn}${lastRow}`;
  const meta: (string | null)[] = [
    null,
    settings.title,
    `SU / MU 單位：${settings.unit}。Gain 僅手填，不計算。`,
    `Source: ${settings.source}${settings.note.trim() ? ' / ' + settings.note : ''}`,
    '每列代表一組 Band/Config、Channel 與 Direction；可直接改儲存格、篩選或新增表格列。',
  ];
  let data = meta
    .map(
      (value, i) =>
        `<x:row r="${i + 1}" ht="${i === 1 ? Math.max(26, settings.fontSize + 10) : 24}" customHeight="1">${cell(`A${i + 1}`, value, i === 1 ? 2 : 3)}</x:row>`,
    )
    .join('');
  const headerHeight = Math.max(
    32,
    ...columns.map(
      (c) =>
        Math.ceil((weightedLength(c.label) * settings.fontSize) / 11 / c.width) *
        (settings.fontSize + 6),
    ),
  );
  data += `<x:row r="6" ht="${headerHeight}" customHeight="1">${columns.map((c, i) => cell(`${columnName(i)}6`, c.label.trim(), 8)).join('')}</x:row>`;
  rows.forEach((original, i) => {
    const row = blank ? { ...original, ...blankPeakValues() } : original;
    const values = columns.map((c) => peakCellValue(row, c, settings));
    const height = Math.max(
      24,
      ...values.map(
        (v, index) =>
          Math.ceil(
            (weightedLength(String(v ?? '')) * settings.fontSize) / 11 / columns[index].width,
          ) *
          (settings.fontSize + 6),
      ),
    );
    const band = settings.bandedRows && i % 2 === 1 ? 3 : 0;
    data += `<x:row r="${i + 7}" ht="${height}" customHeight="1">${values.map((v, index) => cell(`${columnName(index)}${i + 7}`, v, fitted.base + band + (typeof v === 'number' ? (columns[index].key === 'channel' ? 1 : 2) : 0))).join('')}</x:row>`;
  });
  let sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  sheet = sheet.replace(
    /<x:sheetData>[\s\S]*?<\/x:sheetData>/,
    `<x:sheetData>${data}</x:sheetData>`,
  );
  sheet = sheet.replace(
    /<x:cols>[\s\S]*?<\/x:cols>/,
    `<x:cols>${columns.map((c, i) => `<x:col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('')}</x:cols>`,
  );
  sheet = sheet.replace(/<x:sheetProtection\b[^>]*(?:\s*\/>|>[\s\S]*?<\/x:sheetProtection>)/g, '');
  if (/<x:dimension\b/.test(sheet))
    sheet = sheet.replace(
      /<x:dimension\b[^>]*\/\s*>/,
      `<x:dimension ref="A1:${lastColumn}${lastRow}"/>`,
    );
  else
    sheet = sheet.replace(
      '</x:sheetPr>',
      `</x:sheetPr><x:dimension ref="A1:${lastColumn}${lastRow}"/>`,
    );
  files['xl/worksheets/sheet1.xml'] = strToU8(sheet);
  let table = strFromU8(files['xl/tables/table1.xml']);
  table = table.replace(/\bref="[^"]*"/g, `ref="${ref}"`);
  table = table.replace(
    /<x:tableColumns\b[^>]*>[\s\S]*?<\/x:tableColumns>/,
    `<x:tableColumns count="${columns.length}">${columns.map((c, i) => `<x:tableColumn id="${i + 1}" name="${xml(c.label.trim())}"/>`).join('')}</x:tableColumns>`,
  );
  table = table.replace(
    /showRowStripes="[^"]*"/,
    `showRowStripes="${settings.bandedRows ? 1 : 0}"`,
  );
  files['xl/tables/table1.xml'] = strToU8(table);
  return zipSync(files, { level: 6 });
}
