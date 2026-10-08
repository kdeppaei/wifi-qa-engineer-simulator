import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const standalonePath = resolve('dist/wifi-qa-lab.html');

async function terminal(page: Page, source: string) {
  const field = page.getByLabel('Tera Term command');
  await field.fill(source);
  await field.press('Enter');
  await expect(field).toHaveValue('');
  return page
    .locator('.panel-tera .terminal-entry')
    .filter({ has: page.locator('.command-line') })
    .last()
    .locator('pre')
    .last()
    .innerText();
}

test('standalone file works offline, recovers RF, downloads results and preserves files on reload', async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    !existsSync(standalonePath),
    'Build Vite and run scripts/standalone.mjs to produce dist/wifi-qa-lab.html.',
  );
  const exceptions: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  // A file opened from disk must keep working even when external fonts or services cannot be reached.
  await context.route(/^https?:\/\//, (route) => route.abort('internetdisconnected'));
  await page.clock.install({ time: new Date('2026-10-09T09:00:00+08:00') });
  await page.goto(pathToFileURL(standalonePath).href);
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-09T09:01:00+08:00'));
  expect(page.url()).toMatch(/^file:\/\//);
  await expect(page.locator('script[src]')).toHaveCount(0);
  await expect(page.getByLabel('Tera Term command')).toBeVisible();
  await expect(page.getByLabel('Windows CMD command')).toBeVisible();
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await expect(page.locator('.panel-msp')).toBeVisible();
  expect(await terminal(page, 'iw dev stamld0 link')).toContain('Connected');

  await page.getByLabel('Manual attenuation').fill('90');
  await expect(page.getByTestId('attenuation-value')).toHaveText('90');
  expect(await terminal(page, 'iw dev stamld0 link')).toBe('Not connected.');
  expect(await terminal(page, 'wpa_cli -i stamld0 scan_results')).toBe(
    'bssid / frequency / signal level / flags / ssid',
  );
  await page.clock.runFor(3_000);
  expect(await terminal(page, 'logread | grep NETWORK-NOT-FOUND')).toContain('NETWORK-NOT-FOUND');
  await page.getByRole('button', { name: '恢復起點', exact: true }).click();
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await expect(page.locator('.status-strip')).not.toContainText('STA connected');
  await page.clock.runFor(6_000);
  await expect(page.locator('.status-strip')).toContainText('STA connected');
  expect(await terminal(page, 'ping -c 4 192.168.1.200')).toContain('0% packet loss');

  await page.getByRole('button', { name: '測試參數', exact: true }).click();
  await page.getByLabel('end', { exact: true }).fill('0');
  await page.getByLabel('duration', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(1_000);
  await expect(page.locator('.panel-msp .test-status')).toContainText('Completed');
  await expect(page.locator('.panel-msp .chart-wrap svg circle')).toHaveCount(1);

  const csvPromise = page.waitForEvent('download');
  await page.locator('.panel-msp').getByRole('button', { name: 'CSV', exact: true }).click();
  const csv = await csvPromise;
  expect(csv.suggestedFilename()).toBe('wifi-qa-rvr.csv');
  const csvPath = testInfo.outputPath('standalone-rvr.csv');
  await csv.saveAs(csvPath);
  expect(await readFile(csvPath, 'utf8')).toContain('SIMULATED');

  const excelPromise = page.waitForEvent('download');
  await page.locator('.panel-msp').getByRole('button', { name: 'Excel', exact: true }).click();
  const excel = await excelPromise;
  expect(excel.suggestedFilename()).toBe('wifi-qa-rvr.xlsx');
  const excelPath = testInfo.outputPath('standalone-rvr.xlsx');
  await excel.saveAs(excelPath);
  const zip = unzipSync(new Uint8Array(await readFile(excelPath)));
  expect(strFromU8(zip['xl/workbook.xml'])).toContain('Measurements');
  expect(strFromU8(zip['xl/worksheets/sheet2.xml'])).toContain('SIMULATED');
  expect(strFromU8(zip['xl/charts/chart1.xml'])).toContain('scatterChart');

  expect(
    await terminal(
      page,
      "mkdir saved; cd saved; echo 'offline RF evidence' > observations.txt; cat observations.txt",
    ),
  ).toBe('offline RF evidence');
  await page.reload();
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  expect(await terminal(page, 'pwd')).toBe('/root/saved');
  expect(await terminal(page, 'cat observations.txt')).toBe('offline RF evidence');
  expect(await terminal(page, 'iw dev stamld0 link')).toContain('Connected');
  await expect(page.locator('.panel-msp .chart-wrap svg circle')).toHaveCount(1);
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  expect(exceptions, 'Standalone file must have no JavaScript exceptions').toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('standalone-ui-preview.png'), fullPage: true });
});
