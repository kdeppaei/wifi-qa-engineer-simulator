import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { unzipSync, strFromU8 } from 'fflate';

test('offline Excel tool exports independent BF curves, gaps, zeros and source context', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.goto(pathToFileURL(resolve('dist/rvr-excel-tool.html')).href);
  await page.getByRole('button', { name: 'TxBF ON／OFF · 各兩欄' }).click();
  await page.locator('#data').fill('dB\tMbps\n30\t0\n7.5\t920.25\n20\t');
  await page.locator('#off').fill('dB\tMbps\n0\t930\n7.5\t880\n25\t20\n30\t0');
  await expect(page.locator('.status')).toContainText('1 個空白值');
  await expect(page.getByRole('img')).toBeVisible();
  await expect(page.locator('.comparison tbody tr')).toHaveCount(2);
  await page.locator('#source').selectOption('MSP 實機量測（使用者標示）');
  await page.locator('#note').fill('5 GHz DL <test> & TCP');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' }).click();
  const download = await event;
  const file = info.outputPath('measured-txbf.xlsx');
  await download.saveAs(file);
  const files = unzipSync(readFileSync(file));
  const sheet = strFromU8(files['xl/worksheets/sheet2.xml']);
  expect(sheet).toContain('MSP 實機量測');
  expect(sheet).toContain('&lt;test&gt; &amp; TCP');
  expect(sheet).toMatch(/r="A7"[^>]*><x:v>7.5<\/x:v>/);
  expect(sheet).toMatch(/r="B8"[^>]*\/>/);
  expect(sheet).toMatch(/r="B9"[^>]*><x:v>0<\/x:v>/);
  expect(strFromU8(files['xl/drawings/charts/chart2.xml'])).toContain("'TxBF'!$D$7:$D$1006");
  await page.screenshot({ path: info.outputPath('rvr-excel-preview.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
test('Excel tool blocks bad data, imports CSV and keeps zero distinct from missing', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  const download = page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' });
  await expect(download).toBeDisabled();
  await page.locator('#data').fill('0\t900\n0\t800');
  await expect(page.getByRole('alert')).toContainText('重複');
  await expect(download).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles({
    name: 'measured.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('dB,Mbps\n0,970.5\n7.5,900\n50,\n90,0'),
  });
  await expect(download).toBeEnabled();
  await expect(page.locator('.status')).toContainText('3 個量測點');
  await expect(page.locator('.status')).toContainText('1 個空白值');
  const event = page.waitForEvent('download');
  await download.click();
  const file = info.outputPath('measured-single.xlsx');
  await (await event).saveAs(file);
  expect(strFromU8(unzipSync(readFileSync(file))['xl/worksheets/sheet1.xml'])).toContain(
    'measured.csv',
  );
  await page.locator('#data').fill('0\tbad');
  await expect(download).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('第 1 行');
});
test('common BF data and narrow screens show explicit demo provenance without overflow', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  await page.getByRole('button', { name: 'TxBF ON／OFF · 三欄' }).click();
  await page.getByRole('button', { name: '載入示範' }).click();
  await expect(page.locator('#source')).toHaveValue('示範數據（非實機量測）');
  await page.getByRole('button', { name: '單條曲線 · 兩欄' }).click();
  await expect(page.locator('#source')).toHaveValue('使用者提供數據（未驗證量測來源）');
  await expect(page.locator('#data')).toHaveValue('');
  await page.getByRole('button', { name: 'TxBF ON／OFF · 三欄' }).click();
  await expect(page.locator('#source')).toHaveValue('示範數據（非實機量測）');
  await expect(page.locator('.comparison tbody tr')).toHaveCount(6);
  await expect(page.locator('.comparison tbody tr').last()).toContainText('—');
  await page.screenshot({ path: info.outputPath('rvr-excel-demo.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '清空全部' }).click();
  await expect(page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' })).toBeDisabled();
});

test('matrix paste uses left columns, allows mapping and exports renamed native axes', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  await page
    .locator('#data')
    .fill(
      'MSP report\nLoss\tRate\tMCS\tNSS\n0\t980\t11\t2\n10\t900\t10\t2\n90\t0\t0\t1\n\nSecond run\n0\t500\t7\t1',
    );
  await expect(page.locator('.selection-info')).toContainText('第 3 行');
  await expect(page.locator('.selection-info')).toContainText('第 1、2 欄');
  await expect(page.locator('.selection-info')).toContainText('2 欄不納入');
  await expect(page.locator('#x-label')).toHaveValue('dB');
  await expect(page.locator('#y-label')).toHaveValue('Throughput (Mbps)');
  await page.locator('#x-label').fill('RF loss (dB)');
  await page.locator('#y-label').fill('Measured rate (Mbps)');
  await expect(page.getByRole('img')).toHaveAttribute(
    'aria-label',
    'RvR 曲線：X 軸 RF loss (dB)，Y 軸 Measured rate (Mbps)',
  );
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' }).click();
  const file = info.outputPath('matrix-renamed.xlsx');
  await (await event).saveAs(file);
  const files = unzipSync(readFileSync(file));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  expect(sheet).not.toContain('<x:pane');
  expect(sheet).toContain('showGridLines="1"');
  expect(sheet).toContain('RF loss (dB)');
  expect(strFromU8(files['xl/drawings/charts/chart1.xml'])).toContain('Measured rate (Mbps)');
  await page.locator('#data').fill('Rate\tLoss\tOther\n980\t0\t11\n900\t10\t10\n0\t90\t0');
  await page.getByLabel('第 1 欄位置', { exact: true }).fill('2');
  await page.getByLabel('第 2 欄位置', { exact: true }).fill('1');
  await expect(page.locator('.selection-info')).toContainText('第 2、1 欄');
  await page.screenshot({ path: info.outputPath('matrix-mapping-preview.png'), fullPage: true });
});

test('custom title, legend, markers and lines are shared by preview and editable native chart', async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.goto(pathToFileURL(resolve('dist/rvr-excel-tool.html')).href);
  await page.getByRole('button', { name: 'TxBF ON／OFF · 三欄' }).click();
  await page.getByRole('button', { name: '載入示範' }).click();
  await page.locator('#chart-title').fill('5 GHz DL — TxBF comparison <test> & rate');
  await page.locator('#note').fill('Measurement condition, distinct from title');
  await page.locator('.curve-settings summary').click();
  await page.getByLabel('曲線 1 名稱', { exact: true }).fill('BF enabled');
  await page.getByLabel('曲線 1 顏色', { exact: true }).fill('#008855');
  await page.getByLabel('曲線 1 線型', { exact: true }).selectOption('dash');
  await page.getByLabel('曲線 1 線寬', { exact: true }).selectOption('3');
  await page.getByLabel('曲線 1 測點樣式', { exact: true }).selectOption('diamond');
  await page.getByLabel('曲線 1 測點大小', { exact: true }).selectOption('7');
  await page.getByLabel('曲線 2 線型', { exact: true }).selectOption('none');
  await page.getByLabel('曲線 2 測點樣式', { exact: true }).selectOption('square');
  await page.getByLabel('顯示圖表格線', { exact: true }).uncheck();
  await expect(page.locator('.chart-title')).toHaveText('5 GHz DL — TxBF comparison <test> & rate');
  await expect(page.locator('[data-curve="1"] > path')).toHaveAttribute('stroke', '#008855');
  await expect(page.locator('[data-curve="1"] > path')).toHaveAttribute('stroke-dasharray', '9 5');
  await expect(page.locator('[data-curve="1"] [data-marker="diamond"]')).toHaveCount(7);
  await expect(page.locator('[data-curve="2"] > path')).toHaveCount(0);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' }).click();
  const file = info.outputPath('custom-editable.xlsx');
  await (await event).saveAs(file);
  const files = unzipSync(readFileSync(file));
  const chart = strFromU8(files['xl/drawings/charts/chart2.xml']);
  expect(chart).toContain("'TxBF'!$A$2");
  expect(chart).toContain("'TxBF'!$B$6");
  expect(chart).toContain('5 GHz DL — TxBF comparison &lt;test&gt; &amp; rate');
  expect(chart).toContain('008855');
  expect(chart).toContain('prstDash val="dash"');
  expect(chart).toContain('symbol val="diamond"');
  expect(chart).not.toContain('majorGridlines');
  expect(strFromU8(files['xl/worksheets/sheet2.xml'])).not.toContain('sheetProtection');
  await page.screenshot({ path: info.outputPath('custom-style-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('曲線 2 測點樣式', { exact: true }).selectOption('none');
  await expect(page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' })).toBeDisabled();
  expect(requests).toEqual([]);
});

test('row orientation maps X and Y across columns with an inclusive selected range', async ({
  page,
}, info) => {
  await page.goto('/rvr-excel.html');
  await page
    .locator('#data')
    .fill('MSP report\nRate\t980\t900\t\t0\t123\nLoss\t0\t10\t50\t90\t100\nOther\t11\t10\t5\t0\t9');
  await page.getByLabel('資料排列方式', { exact: true }).selectOption('rows');
  await page.getByLabel('第 1 行位置', { exact: true }).fill('3');
  await page.getByLabel('第 2 行位置', { exact: true }).fill('2');
  await page.getByLabel('資料起始欄', { exact: true }).fill('2');
  await page.getByLabel('資料結束欄', { exact: true }).fill('5');
  await expect(page.locator('.selection-info')).toContainText('第 3、2 行，第 2–5 欄');
  await expect(page.locator('.status')).toContainText('3 個量測點');
  await expect(page.locator('.status')).toContainText('1 個空白值');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' }).click();
  const file = info.outputPath('horizontal-selection.xlsx');
  await (await event).saveAs(file);
  const sheet = strFromU8(unzipSync(readFileSync(file))['xl/worksheets/sheet1.xml']);
  expect(sheet).toMatch(/r="A10"[^>]*><x:v>90<\/x:v>/);
  expect(sheet).toMatch(/r="B9"[^>]*\/>/);
  expect(sheet).toMatch(/r="B10"[^>]*><x:v>0<\/x:v>/);
  expect(sheet).not.toMatch(/r="A11"[^>]*><x:v>/);
  await page.getByLabel('資料結束欄', { exact: true }).fill('6');
  await expect(page.locator('.status')).toContainText('4 個量測點');
});

test('column range and chart options remain independent between modes', async ({ page }) => {
  await page.goto('/rvr-excel.html');
  await page
    .locator('#data')
    .fill('Caption\nRate\tLoss\tOther\n980\t0\t11\n900\t10\t10\n500\t20\t9');
  await page.getByLabel('第 1 欄位置', { exact: true }).fill('2');
  await page.getByLabel('第 2 欄位置', { exact: true }).fill('1');
  await page.getByLabel('資料起始行', { exact: true }).fill('3');
  await page.getByLabel('資料結束行', { exact: true }).fill('4');
  await expect(page.locator('.status')).toContainText('2 個量測點');
  await page.locator('#chart-title').fill('Single custom title');
  await page.getByRole('button', { name: '黑白列印' }).click();
  await page.getByRole('button', { name: 'TxBF ON／OFF · 三欄' }).click();
  await expect(page.locator('#chart-title')).toHaveValue('TxBF ON / OFF RvR');
  await page.getByRole('button', { name: '單條曲線 · 兩欄' }).click();
  await expect(page.locator('#chart-title')).toHaveValue('Single custom title');
  await expect(page.getByLabel('曲線 1 顏色', { exact: true })).toHaveValue('#222222');
  await expect(page.locator('.status')).toContainText('2 個量測點');
});
