import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LabState } from '../src/engine/lab';

const saved = (page: Page): Promise<{ lab: LabState }> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-lab-v1') || 'null'));
async function terminal(page: Page, source: string) {
  const input = page.getByLabel('Tera Term command');
  await input.fill(source);
  await input.press('Enter');
}

test('offline saved mismatch can be inspected and repaired while evidence and terminal control remain usable', async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route(/^https?:\/\//, (route) => route.abort('internetdisconnected'));
  await page.clock.install({ time: new Date('2026-10-09T15:00:00+08:00') });
  await page.goto(pathToFileURL(resolve('dist/wifi-qa-lab.html')).href);
  await page.clock.pauseAt(new Date('2026-10-09T15:01:00+08:00'));
  await expect(page.locator('.version')).toHaveText('v0.3.1');
  await page.getByRole('button', { name: '測試參數', exact: true }).click();
  await page.getByLabel('end', { exact: true }).fill('5');
  await page.getByLabel('duration', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(2_000);
  const oldRun = (await saved(page)).lab.msp.runs[0];
  expect(oldRun.status).toBe('completed');
  await terminal(page, 'uci set wireless.MT7999_1_2.etxbfencond=0; uci commit wireless');
  await page.getByRole('button', { name: 'Configure AP', exact: true }).click();
  await page.locator('.panel-ap').getByLabel('Band').selectOption('5');
  await page.getByLabel('AP SSID').fill('Recovery AP');
  await page.locator('.panel-ap').getByLabel('Security').selectOption('WPA2');
  await page
    .locator('.panel-ap')
    .getByLabel('Lab password', { exact: true })
    .fill('recovery-secret');
  await page.getByRole('button', { name: '關閉 AP Configuration', exact: true }).click();
  await page.getByLabel('Manual attenuation').fill('90');
  // Reproduce a long-lived saved fault without rendering thousands of timer callbacks.
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('wifi-qa-lab-v1')!);
    data.lab.clock = 2700;
    localStorage.setItem('wifi-qa-lab-v1', JSON.stringify(data));
  });
  await page.reload();
  await page.clock.runFor(12_000);
  await expect(page.locator('.panel-tera .terminal-scroll')).toContainText('NETWORK-NOT-FOUND');
  await page.getByRole('button', { name: '暫停 Serial 訊息', exact: true }).click();
  const consoleText = await page.locator('.panel-tera .terminal-scroll').innerText();
  const logCount = (await saved(page)).lab.logs.length;
  await page.clock.runFor(12_000);
  expect(await page.locator('.panel-tera .terminal-scroll').innerText()).toBe(consoleText);
  expect((await saved(page)).lab.logs.length).toBeGreaterThan(logCount);
  await terminal(page, 'iw dev stamld0 link');
  await expect(page.locator('.panel-tera .terminal-scroll')).toContainText('Not connected.');
  await page.getByRole('button', { name: '恢復起點', exact: true }).click();
  await page.clock.runFor(8_000);
  expect((await saved(page)).lab.sta.status).not.toBe('connected');
  await page.getByRole('button', { name: '檢查連線', exact: true }).click();
  for (const id of ['band', 'ssid', 'auth', 'runtime'])
    await expect(page.getByTestId(`connection-check-${id}`)).toHaveAttribute('data-ok', 'false');
  await expect(page.getByTestId('connection-diagnostics')).not.toContainText('recovery-secret');
  await expect(page.getByTestId('connection-check-rf')).toHaveAttribute('data-ok', 'true');
  const ap = (await saved(page)).lab.ap;
  const evidence = (await saved(page)).lab.logs.map((log) => log.id);
  await page.getByRole('button', { name: '依目前 AP 同步 STA 並重連', exact: true }).click();
  expect((await saved(page)).lab.sta.status).toBe('restarting');
  await page.clock.runFor(2_000);
  expect((await saved(page)).lab.sta.status).toBe('scanning');
  await page.clock.runFor(2_000);
  expect((await saved(page)).lab.sta.status).toBe('associating');
  await page.clock.runFor(2_000);
  const recovered = (await saved(page)).lab;
  expect(recovered.sta.status).toBe('connected');
  expect(recovered.sta.freq).toBe(5180);
  expect(recovered.ap).toEqual(ap);
  expect(recovered.msp.runs).toEqual([oldRun]);
  expect(recovered.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('0');
  expect(evidence.every((id) => recovered.logs.some((log) => log.id === id))).toBe(true);
  await terminal(page, 'ping -c 4 192.168.1.200');
  await expect(page.locator('.panel-tera .terminal-scroll')).toContainText('0% packet loss');
  await page.getByRole('button', { name: '繼續 Serial 訊息', exact: true }).click();
  await page.reload();
  expect((await saved(page)).lab.sta.status).toBe('connected');
  expect((await saved(page)).lab.msp.runs).toEqual([oldRun]);
  await page.getByRole('button', { name: '檢查連線', exact: true }).click();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath('connection-recovery-preview.png'),
    fullPage: true,
  });
});

test('diagnostic recovery blocks pending edits and serial messages never move the outer viewport', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-09T16:00:00+08:00') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-09T16:01:00+08:00'));
  await page.getByRole('button', { name: '檢查連線', exact: true }).click();
  await terminal(page, 'uci set wireless.MT7999_1_3.etxbfencond=0');
  await expect(
    page.getByRole('button', { name: '依目前 AP 同步 STA 並重連', exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId('connection-check-pending')).toHaveAttribute('data-ok', 'false');
  const config = (await saved(page)).lab.config;
  await page.getByRole('button', { name: '收起連線檢查', exact: true }).click();
  await page.getByLabel('Manual attenuation').fill('90');
  await page.locator('.desktop').evaluate((node) => {
    node.scrollTop = 0;
  });
  const position = await page.locator('.desktop').evaluate((node) => node.scrollTop);
  await page.clock.runFor(30_000);
  expect(await page.locator('.desktop').evaluate((node) => node.scrollTop)).toBe(position);
  expect((await saved(page)).lab.config).toEqual(config);
  await expect(page.locator('.panel-tera .terminal-scroll')).toContainText('NETWORK-NOT-FOUND');
  expect(errors).toEqual([]);
});
