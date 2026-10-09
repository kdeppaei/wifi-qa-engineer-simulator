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
  await expect(page.locator('tbody tr')).toHaveCount(2);
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
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await expect(page.locator('tbody tr').last()).toContainText('—');
  await page.screenshot({ path: info.outputPath('rvr-excel-demo.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '清空全部' }).click();
  await expect(page.getByRole('button', { name: '下載 Excel 原生圖表 .xlsx' })).toBeDisabled();
});
