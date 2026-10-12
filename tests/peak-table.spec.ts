import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const peakTab = 'Peak 結果表 · 七欄';
const ns = '(?:[A-Za-z_][\\w.-]*:)?';

function cellXml(sheet: string, address: string) {
  return (
    sheet.match(
      new RegExp(`<${ns}c\\b[^>]*?\\br="${address}"[^>]*?(?:/>|>[\\s\\S]*?</${ns}c>)`),
    )?.[0] || ''
  );
}

function cellValue(sheet: string, address: string) {
  const cell = cellXml(sheet, address);
  const value = cell.match(new RegExp(`<${ns}v(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}v>`));
  if (value) return value[1];
  return [...cell.matchAll(new RegExp(`<${ns}t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}t>`, 'g'))]
    .map((match) => match[1])
    .join('')
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
      const entities: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      };
      return entities[entity];
    });
}

function expectNumericCell(sheet: string, address: string, value: number) {
  expect(cellXml(sheet, address)).not.toMatch(/\bt="(?:s|inlineStr)"/);
  expect(Number(cellValue(sheet, address))).toBe(value);
  expect(cellValue(sheet, address)).not.toBe('');
}

async function exportPeak(page: Page, info: TestInfo, name: string, blank = false) {
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', {
      name: blank ? '下載 Peak 空白表 .xlsx' : '下載 Peak Excel .xlsx',
      exact: true,
    })
    .click();
  const file = info.outputPath(name);
  await (await download).saveAs(file);
  const files = unzipSync(readFileSync(file));
  return { files, sheet: strFromU8(files['xl/worksheets/sheet1.xml']) };
}

function expectEditableManualTable(files: ReturnType<typeof unzipSync>, sheet: string) {
  expect(strFromU8(files['xl/workbook.xml'])).toContain('Peak Results');
  expect(sheet).not.toContain('sheetProtection');
  expect(strFromU8(files['xl/workbook.xml'])).not.toContain('workbookProtection');
  expect(sheet).not.toMatch(new RegExp(`<${ns}f\\b`));
  expect(
    Object.keys(files).filter((name) => /^xl\/tables\/table\d+\.xml$/.test(name)),
  ).toHaveLength(1);
  expect(
    Object.keys(files).filter((name) => /^(?:xl\/(?:drawings|charts|media))\//.test(name)),
  ).toEqual([]);
}

test('Peak groups expand UL, DL and optional BI while preserving manual results and tab state', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  await page.getByRole('button', { name: peakTab, exact: true }).click();
  await expect(page.getByLabel('設定組 1 Band/Config', { exact: true })).toHaveValue('6G_UHR320');
  await expect(page.getByLabel('設定組 1 Channel', { exact: true })).toHaveValue('37');
  await expect(page.getByLabel('設定組 1 UL', { exact: true })).toBeChecked();
  await expect(page.getByLabel('設定組 1 DL', { exact: true })).toBeChecked();
  await expect(page.getByLabel('設定組 1 BI', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('第 3 列 SU', { exact: true })).toHaveCount(0);
  await page.getByLabel('第 1 列 Gain Criteria', { exact: true }).fill('>= 8%');
  await page.getByLabel('第 1 列 SU', { exact: true }).fill('1200.25');
  await page.getByLabel('第 1 列 MU', { exact: true }).fill('0');
  await page.getByLabel('第 1 列 Gain', { exact: true }).fill('-0.25');
  await page.getByLabel('第 2 列 SU', { exact: true }).fill('900');
  await page.getByLabel('第 2 列 MU', { exact: true }).fill('1250');
  await expect(page.getByLabel('第 2 列 Gain', { exact: true })).toHaveValue('');
  await page.getByLabel('設定組 1 Band/Config', { exact: true }).fill('5G_UHR160');
  await page.getByLabel('設定組 1 Channel', { exact: true }).fill('149');
  await expect(page.getByLabel('第 1 列 SU', { exact: true })).toHaveValue('1200.25');
  await page.getByLabel('設定組 1 UL', { exact: true }).uncheck();
  await expect(page.getByLabel('第 1 列 SU', { exact: true })).toHaveValue('900');
  await page.getByLabel('設定組 1 UL', { exact: true }).check();
  await expect(page.getByLabel('第 1 列 SU', { exact: true })).toHaveValue('1200.25');
  await page.getByLabel('設定組 1 BI', { exact: true }).check();
  await page.getByLabel('第 3 列 Gain', { exact: true }).fill('Pending');
  await expect(page.getByRole('button', { name: '單條曲線 · 兩欄', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '曲線繪圖', exact: true }).click();
  await page.getByRole('button', { name: '單條曲線 · 兩欄', exact: true }).click();
  await page.locator('#data').fill('0\t980\n10\t900');
  await page.getByRole('button', { name: peakTab, exact: true }).click();
  await expect(page.getByLabel('第 1 列 SU', { exact: true })).toHaveValue('1200.25');
  await expect(page.getByLabel('第 2 列 Gain', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('第 3 列 Gain', { exact: true })).toHaveValue('Pending');
  const { files, sheet } = await exportPeak(page, info, 'peak-grouped-manual.xlsx');
  expectEditableManualTable(files, sheet);
  for (const [row, direction] of [
    [7, 'UL'],
    [8, 'DL'],
    [9, 'BI'],
  ] as const) {
    expect(cellValue(sheet, `A${row}`)).toBe('5G_UHR160');
    expect(cellValue(sheet, `B${row}`)).toBe('149');
    expect(cellValue(sheet, `C${row}`)).toBe(direction);
  }
  expect(cellValue(sheet, 'D7')).toBe('>= 8%');
  expectNumericCell(sheet, 'E7', 1200.25);
  expectNumericCell(sheet, 'F7', 0);
  expectNumericCell(sheet, 'G7', -0.25);
  expectNumericCell(sheet, 'E8', 900);
  expectNumericCell(sheet, 'F8', 1250);
  expect(cellValue(sheet, 'G8')).toBe('');
  expect(cellValue(sheet, 'G9')).toBe('Pending');
});

test('Peak custom headers, visible order, added fields and styling export as an editable native table', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  await page.getByRole('button', { name: peakTab, exact: true }).click();
  await page.getByLabel('表格標題', { exact: true }).fill('Peak test <UHR> & results');
  await page.getByLabel('SU／MU 單位', { exact: true }).fill('Gbps');
  await page.locator('.peak-customization summary').click();
  await page.getByLabel('表格標頭顏色', { exact: true }).fill('#008855');
  await page.getByLabel('表格小數位數', { exact: true }).fill('3');
  await page.getByLabel('欄位 5 名稱', { exact: true }).fill('SU rate');
  await page.getByLabel('顯示欄位 4', { exact: true }).uncheck();
  await page.getByLabel('新增欄位名稱', { exact: true }).fill('Remarks');
  await page.getByRole('button', { name: '新增欄位', exact: true }).click();
  await page.getByRole('button', { name: '欄位 8 向左移', exact: true }).click();
  await page.getByLabel('第 1 列 SU', { exact: true }).fill('1.125');
  await page.getByLabel('第 1 列 MU', { exact: true }).fill('0');
  await page.getByLabel('第 1 列 Remarks', { exact: true }).fill('Manually approved');
  await page.getByLabel('第 1 列 Gain', { exact: true }).fill('12%');
  const { files, sheet } = await exportPeak(page, info, 'peak-custom-editable.xlsx');
  expectEditableManualTable(files, sheet);
  expect(cellValue(sheet, 'A2')).toBe('Peak test <UHR> & results');
  const headers = ['Band/Config', 'Channel', 'Direction', 'SU rate', 'MU', 'Remarks', 'Gain'];
  for (const [index, header] of headers.entries()) {
    expect(cellValue(sheet, `${String.fromCharCode(65 + index)}6`)).toBe(header);
  }
  expectNumericCell(sheet, 'D7', 1.125);
  expectNumericCell(sheet, 'E7', 0);
  expect(cellValue(sheet, 'F7')).toBe('Manually approved');
  expect(cellValue(sheet, 'G7')).toBe('12%');
  const tableName = Object.keys(files).find((name) => /^xl\/tables\/table\d+\.xml$/.test(name))!;
  const table = strFromU8(files[tableName]);
  expect(table).toContain('ref="A6:G8"');
  expect(table).not.toMatch(new RegExp(`<${ns}autoFilter\\b`));
  expect(table).toContain('name="SU rate"');
  expect(table).toContain('name="Remarks"');
  expect(table).not.toContain('Gain Criteria');
  expect(strFromU8(files['xl/styles.xml']).toUpperCase()).toContain('008855');
  expect(strFromU8(files['xl/styles.xml'])).toMatch(/formatCode="[^"]*0\.[#0]{3}/);
  expect(sheet).toContain('Gbps');
});

test('Peak blank export keeps groups and layout while clearing measurements without changing the editor', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  await page.getByRole('button', { name: peakTab, exact: true }).click();
  await page.getByLabel('表格標題', { exact: true }).fill('Reusable peak measurement form');
  await page.getByLabel('設定組 1 BI', { exact: true }).check();
  await page.getByLabel('第 1 列 Gain Criteria', { exact: true }).fill('>= 5%');
  await page.getByLabel('第 1 列 SU', { exact: true }).fill('900.5');
  await page.getByLabel('第 1 列 MU', { exact: true }).fill('1000');
  await page.getByLabel('第 1 列 Gain', { exact: true }).fill('Manual 11%');
  await page.locator('.peak-customization summary').click();
  await page.getByLabel('新增欄位名稱', { exact: true }).fill('Operator');
  await page.getByRole('button', { name: '新增欄位', exact: true }).click();
  await page.getByLabel('第 1 列 Operator', { exact: true }).fill('QA engineer');
  const { files, sheet } = await exportPeak(page, info, 'peak-blank-configured.xlsx', true);
  expectEditableManualTable(files, sheet);
  expect(cellValue(sheet, 'A2')).toBe('Reusable peak measurement form');
  expect(cellValue(sheet, 'H6')).toBe('Operator');
  for (const [row, direction] of [
    [7, 'UL'],
    [8, 'DL'],
    [9, 'BI'],
  ] as const) {
    expect(cellValue(sheet, `A${row}`)).toBe('6G_UHR320');
    expect(cellValue(sheet, `B${row}`)).toBe('37');
    expect(cellValue(sheet, `C${row}`)).toBe(direction);
    for (const column of ['D', 'E', 'F', 'G', 'H']) {
      expect(cellValue(sheet, `${column}${row}`)).toBe('');
    }
  }
  await expect(page.getByLabel('第 1 列 Gain Criteria', { exact: true })).toHaveValue('>= 5%');
  await expect(page.getByLabel('第 1 列 SU', { exact: true })).toHaveValue('900.5');
  await expect(page.getByLabel('第 1 列 MU', { exact: true })).toHaveValue('1000');
  await expect(page.getByLabel('第 1 列 Gain', { exact: true })).toHaveValue('Manual 11%');
  await expect(page.getByLabel('第 1 列 Operator', { exact: true })).toHaveValue('QA engineer');
});

test('Peak standalone works offline, remains usable at 390px and adds separate configuration groups', async ({
  page,
}, info) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('dist/rvr-excel-tool.html')).href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Excel 繪圖與表格工具');
  await page.getByRole('button', { name: peakTab, exact: true }).click();
  await page.getByLabel('第 1 列 SU', { exact: true }).fill('1000');
  await page.getByRole('button', { name: '新增設定組', exact: true }).click();
  await page.getByLabel('設定組 2 Band/Config', { exact: true }).fill('2G_UHR40');
  await page.getByLabel('設定組 2 Channel', { exact: true }).fill('6');
  await expect(page.getByLabel('第 1 列 SU', { exact: true })).toHaveValue('1000');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(
    page.getByRole('button', { name: '下載 Peak Excel .xlsx', exact: true }),
  ).toBeEnabled();
  const { files, sheet } = await exportPeak(page, info, 'peak-offline-multiple-groups.xlsx');
  expectEditableManualTable(files, sheet);
  expectNumericCell(sheet, 'E7', 1000);
  expect(cellValue(sheet, 'A9')).toBe('2G_UHR40');
  expect(cellValue(sheet, 'B9')).toBe('6');
  expect(cellValue(sheet, 'C9')).toBe('UL');
  expect(cellValue(sheet, 'A10')).toBe('2G_UHR40');
  expect(cellValue(sheet, 'C10')).toBe('DL');
  await page.screenshot({ path: info.outputPath('peak-table-mobile.png'), fullPage: true });
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
