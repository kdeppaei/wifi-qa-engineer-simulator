import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { templateBase64 } from './template';
import type { Point } from './data';

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
export function makeWorkbook(
  series: Point[][],
  source: string,
  note: string,
  labels = { xLabel: 'dB', yLabel: 'Throughput (Mbps)' },
): Uint8Array {
  if (series.length < 1 || series.length > 2 || series.some((p) => p.length > 1000))
    throw new Error('資料組數或測點數不正確。');
  const bytes = Uint8Array.from(atob(templateBase64), (c) => c.charCodeAt(0));
  const files = unzipSync(bytes);
  const compare = series.length === 2;
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
    sheet = replaceCell(
      sheet,
      `${specs[i][1]}6`,
      `${compare ? (i === 0 ? 'TxBF ON ' : 'TxBF OFF ') : ''}${labels.yLabel}`,
    );
    for (const [j, p] of points.entries()) {
      sheet = replaceCell(sheet, `${specs[i][0]}${j + 7}`, p.db);
      sheet = replaceCell(sheet, `${specs[i][1]}${j + 7}`, p.mbps);
    }
  }
  sheet = replaceCell(sheet, 'A4', `Source: ${source}${note.trim() ? ' / ' + note.trim() : ''}`);
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
  chart = chart.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/g, (axis) =>
    axis.replace(
      /(<c:title>[\s\S]*?<a:t>)[\s\S]*?(<\/a:t>)/,
      (_m, before: string, after: string) =>
        before + xml(/<c:axPos val="b"/.test(axis) ? labels.xLabel : labels.yLabel) + after,
    ),
  );
  let index = 0;
  chart = chart.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const [x, y] = specs[index];
    const points = series[index++];
    return (
      compare
        ? ser
        : ser.replace(
            /(<c:tx><c:v>)[\s\S]*?(<\/c:v>)/,
            (_m, before: string, after: string) => before + xml(labels.yLabel) + after,
          )
    )
      .replace(
        /<c:xVal>[\s\S]*?<\/c:xVal>/,
        `<c:xVal><c:numRef><c:f>'${name}'!$${x}$7:$${x}$1006</c:f>${cache(points, true)}</c:numRef></c:xVal>`,
      )
      .replace(
        /<c:yVal>[\s\S]*?<\/c:yVal>/,
        `<c:yVal><c:numRef><c:f>'${name}'!$${y}$7:$${y}$1006</c:f>${cache(points, false)}</c:numRef></c:yVal>`,
      );
  });
  files[chartPath] = strToU8(chart);
  return zipSync(files, { level: 6 });
}
