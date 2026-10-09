import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import type { LabState } from '../src/engine/lab';

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

  await page
    .locator('.workspace-actions')
    .getByRole('button', { name: '指令工作流', exact: true })
    .click();
  await page.getByLabel('工作流程', { exact: true }).selectOption('uci-bf-lifecycle');
  await page.getByRole('button', { name: '送入 VT', exact: true }).click();
  await expect(page.getByLabel('Tera Term command')).toHaveValue(
    'uci get wireless.MT7999_1_3.etxbfencond',
  );
  await page.getByRole('button', { name: '關閉 指令工作流', exact: true }).click();
  await page.getByLabel('Tera Term command').press('Enter');
  await page
    .locator('.workspace-actions')
    .getByRole('button', { name: '指令工作流', exact: true })
    .click();
  await expect(page.getByTestId('workflow-step-bf-read')).toHaveAttribute('data-status', 'success');
  await expect(page.getByTestId('workflow-feedback')).toContainText('實際執行：uci get');
  await page.getByRole('button', { name: '關閉 指令工作流', exact: true }).click();

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

test('standalone file completes a pinned BF ON/OFF DL pair and downloads native Excel offline', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!existsSync(standalonePath), 'Build the current standalone HTML before this test.');
  const exceptions: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  await context.route(/^https?:\/\//, (route) => route.abort('internetdisconnected'));
  await page.clock.install({ time: new Date('2026-10-09T12:00:00+08:00') });
  await page.goto(pathToFileURL(standalonePath).href);
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-09T12:01:00+08:00'));
  expect(page.url()).toMatch(/^file:\/\//);
  await expect(page.locator('script[src]')).toHaveCount(0);
  await page.getByRole('button', { name: '測試參數', exact: true }).click();
  for (const [key, value] of [
    ['start', '0'],
    ['end', '60'],
    ['step', '20'],
    ['lowStep', '20'],
    ['threshold', '0'],
    ['duration', '1'],
    ['seed', '7999'],
  ] as const)
    await page.getByLabel(key, { exact: true }).fill(value);
  await page
    .locator('.workspace-actions')
    .getByRole('button', { name: '指令工作流', exact: true })
    .click();
  await page.getByLabel('工作流程', { exact: true }).selectOption('rvr-bf-comparison');

  const perform = async (id: string, status = 'success') => {
    const row = page.getByTestId(`workflow-step-${id}`);
    await row.click();
    await expect(row).toHaveAttribute('aria-current', 'step');
    const current = page.getByTestId('workflow-current');
    const action = current.getByRole('button', { name: '執行本步操作', exact: true });
    const command = current.getByRole('button', { name: '執行本步', exact: true });
    if (await action.count()) await action.click();
    else if (await command.count()) await command.click();
    await expect(row).toHaveAttribute('data-status', status);
  };
  const state = (): Promise<LabState> =>
    page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-lab-v1') || 'null').lab);
  for (const id of [
    'rvr-prepare',
    'rvr-link',
    'rvr-server',
    'rvr-ping',
    'rvr-ap-on',
    'rvr-restore-on',
    'rvr-wait-start-on',
    'rvr-start-on',
  ])
    await perform(id);
  const onId = (await state()).msp.activeRunId!;
  await perform('rvr-wait-on', 'waiting');
  await page.clock.runFor(1_000);
  expect((await state()).msp.runs[0].points).toHaveLength(1);
  await page.clock.runFor(3_000);
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'success',
  );
  for (const id of ['rvr-restore-off', 'rvr-wait-start-off', 'rvr-ap-off', 'rvr-start-off'])
    await perform(id);
  const offId = (await state()).msp.activeRunId!;
  expect(offId).not.toBe(onId);
  await perform('rvr-wait-off', 'waiting');
  await page.clock.runFor(4_000);
  await expect(page.getByTestId('workflow-step-rvr-wait-off')).toHaveAttribute(
    'data-status',
    'success',
  );
  await perform('rvr-compare');
  const runs = (await state()).msp.runs;
  expect(runs.map((run) => run.id)).toEqual([onId, offId]);
  expect(runs.every((run) => run.status === 'completed')).toBe(true);
  expect(runs.map((run) => run.points.map((point) => point.attenuation))).toEqual([
    [0, 20, 40, 60],
    [0, 20, 40, 60],
  ]);
  expect(runs[1].settings).toEqual(runs[0].settings);
  expect(runs[0].points.every((point) => point.bf)).toBe(true);
  expect(runs[1].points.every((point) => !point.bf)).toBe(true);
  expect(runs[0].points.at(-1)!.throughput).toBeGreaterThan(runs[1].points.at(-1)!.throughput);

  const received = page.waitForEvent('download');
  await perform('rvr-export-xlsx');
  const download = await received;
  expect(download.suggestedFilename()).toMatch(/^wifi-qa-bf-on-off.*\.xlsx$/);
  const exportPath = testInfo.outputPath('standalone-bf-on-off.xlsx');
  await download.saveAs(exportPath);
  const zip = unzipSync(new Uint8Array(await readFile(exportPath)));
  const data = strFromU8(zip['xl/worksheets/sheet2.xml']);
  expect(data).toContain(`>${onId}</t>`);
  expect(data).toContain(`>${offId}</t>`);
  expect(data.match(/>SIMULATED<\/t>/g)).toHaveLength(8);
  const chart = strFromU8(zip['xl/charts/chart1.xml']);
  expect(chart.match(/<c:ser>/g)).toHaveLength(2);
  expect(chart).toContain('BF ON');
  expect(chart).toContain('BF OFF');

  await page.reload();
  await page
    .locator('.workspace-actions')
    .getByRole('button', { name: '指令工作流', exact: true })
    .click();
  await expect(page.getByLabel('工作流程', { exact: true })).toHaveValue('rvr-bf-comparison');
  for (const [bf, id] of [
    ['ON', onId],
    ['OFF', offId],
  ]) {
    const row = page.getByTestId('rvr-live-data').locator(`.rvr-run-row[data-bf="${bf}"]`);
    await expect(row).toHaveAttribute('data-runid', id);
    await expect(row).toHaveAttribute('data-status', 'completed');
    await expect(row).toHaveAttribute('data-points', '4');
  }
  await perform('rvr-compare');
  expect((await state()).msp.runs).toEqual(runs);
  expect(exceptions, 'The complete offline pair must have no JavaScript exceptions').toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('standalone-rvr-workflow-preview.png'),
    fullPage: true,
  });
});
