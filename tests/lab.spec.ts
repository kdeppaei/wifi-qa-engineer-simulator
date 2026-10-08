import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import type { LabState } from '../src/engine/lab';

const pageErrors = new WeakMap<Page, string[]>();
const stored = (
  page: Page,
): Promise<{ lab: LabState; chapter: number; evidence: string[]; linux: { history: string[] } }> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-lab-v1') || 'null'));

async function command(page: Page, source: string, os: 'linux' | 'windows' = 'linux') {
  const panel = page.locator(os === 'linux' ? '.panel-tera' : '.panel-cmd');
  const field = page.getByLabel(os === 'linux' ? 'Tera Term command' : 'Windows CMD command');
  await field.fill(source);
  await field.press('Enter');
  await expect(field).toHaveValue('');
  const entry = panel
    .locator('.terminal-entry')
    .filter({ has: page.locator('.command-line') })
    .last();
  return entry.locator('pre').last().innerText();
}

async function closeAP(page: Page) {
  await page.getByRole('button', { name: '關閉 AP Configuration', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-09T08:00:00+08:00') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-09T08:01:00+08:00'));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'No browser exceptions during the workflow').toEqual([]);
});

test('6 GHz → 5 GHz, BF ON/OFF RvR, native Excel, RF interruption and persistent recovery', async ({
  page,
}, testInfo) => {
  await expect(page.locator('.mission-bar')).toContainText('Free Lab');
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 6 GHz');
  expect((await stored(page)).chapter).toBe(0);
  expect(await command(page, 'uci get wireless.stamld0.device')).toBe('MT7999_1_3');
  expect(await command(page, 'iw dev stamld0 link')).toContain('SSID: BN68_6G');

  await page.getByRole('button', { name: 'Configure AP', exact: true }).click();
  await expect(page.locator('.panel-ap')).toBeVisible();
  await page.locator('.panel-ap').getByLabel('Band').selectOption('5');
  await page.getByLabel('AP SSID').fill('BN68');
  await closeAP(page);
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 5 GHz');

  // A wrong SSID is real pending configuration, and the runtime still holds the previous value.
  await command(page, "uci set wireless.stamld0.ssid='WRONG_SSID'");
  let saved = await stored(page);
  expect(saved.lab.config.staged['wireless.stamld0.ssid']).toBe('WRONG_SSID');
  expect(saved.lab.config.runtime['wireless.stamld0.ssid']).toBe('BN68_6G');
  await command(page, 'uci commit wireless; wifi restart');
  await page.clock.runFor(8_000);
  expect(await command(page, 'iw dev stamld0 link')).toBe('Not connected.');
  expect(await command(page, 'logread | grep NETWORK-NOT-FOUND')).toContain('NETWORK-NOT-FOUND');

  await command(
    page,
    "uci set wireless.stamld0.ssid='BN68'; uci -q delete wireless.stamld0.device; uci add_list wireless.stamld0.device='MT7999_1_2'; uci commit wireless; wifi restart",
  );
  await expect(page.locator('.status-strip')).toContainText('STA restarting');
  await page.clock.runFor(2_000);
  await expect(page.locator('.status-strip')).toContainText('STA scanning');
  await page.clock.runFor(4_000);
  const link = await command(page, 'iw dev stamld0 link');
  expect(link).toContain('Connected');
  expect(link).toContain('SSID: BN68');
  expect(link).toContain('freq: 5180');
  expect(await command(page, 'ping -c 4 192.168.1.200')).toContain('0% packet loss');
  expect(await command(page, 'iperf3 -c 192.168.1.200 -p 9002 -P 4 -t 2 -R')).toContain('AP → STA');

  await page.getByRole('button', { name: '測試參數', exact: true }).click();
  await page.getByLabel('duration', { exact: true }).fill('1');
  await page.getByLabel('end', { exact: true }).fill('10');
  await page.getByLabel('step', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(1_000);
  saved = await stored(page);
  expect(saved.lab.msp.status).toBe('running');
  expect(saved.lab.msp.runs[0].points.map((p) => p.attenuation)).toEqual([0]);
  await page.clock.runFor(2_000);
  saved = await stored(page);
  expect(saved.lab.msp.status).toBe('completed');
  expect(saved.lab.msp.runs[0].points.map((p) => p.attenuation)).toEqual([0, 5, 10]);
  expect(saved.lab.msp.runs[0].bf).toBe(true);

  await page.getByRole('button', { name: 'Configure AP', exact: true }).click();
  await page.getByRole('button', { name: 'AP TxBF toggle', exact: true }).click();
  await closeAP(page);
  await command(
    page,
    'uci set wireless.MT7999_1_2.etxbfencond=0; uci commit wireless; wifi restart',
  );
  await page.getByRole('button', { name: '恢復起點', exact: true }).click();
  await page.clock.runFor(6_000);
  expect(await command(page, 'uci get wireless.MT7999_1_2.etxbfencond')).toBe('0');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(3_000);
  saved = await stored(page);
  expect(saved.lab.msp.runs).toHaveLength(2);
  expect(saved.lab.msp.runs[1].bf).toBe(false);
  expect(saved.lab.msp.runs[1].status).toBe('completed');
  expect(saved.lab.msp.runs[1].points.map((p) => p.attenuation)).toEqual([0, 5, 10]);
  // At strong RSSI both modes can use the same top MCS; BF gain appears near rate thresholds.
  expect(saved.lab.msp.runs[0].points[1].throughput).toBeGreaterThanOrEqual(
    saved.lab.msp.runs[1].points[1].throughput,
  );
  expect(saved.lab.msp.runs[0].points.every((point) => point.bf)).toBe(true);
  expect(saved.lab.msp.runs[1].points.every((point) => !point.bf)).toBe(true);
  await expect(page.locator('.panel-msp .chart-wrap svg circle')).toHaveCount(6);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.panel-msp').getByRole('button', { name: 'Excel', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('wifi-qa-rvr.xlsx');
  const workbookPath = testInfo.outputPath('wifi-qa-rvr.xlsx');
  await download.saveAs(workbookPath);
  const zip = unzipSync(new Uint8Array(await readFile(workbookPath)));
  expect(strFromU8(zip['xl/workbook.xml'])).toContain('Measurements');
  expect(strFromU8(zip['xl/workbook.xml'])).toContain('Metadata');
  expect(strFromU8(zip['xl/worksheets/sheet2.xml'])).toContain('SIMULATED');
  expect(strFromU8(zip['xl/charts/chart1.xml'])).toContain('scatterChart');
  expect(strFromU8(zip['xl/charts/chart1.xml'])).toContain('BF ON');
  expect(strFromU8(zip['xl/charts/chart1.xml'])).toContain('BF OFF');

  await page.getByRole('button', { name: '恢復起點', exact: true }).click();
  await page.getByLabel('end', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(1_000);
  await page.getByLabel('Manual attenuation').fill('90');
  await expect(page.getByTestId('attenuation-value')).toHaveText('90');
  await expect(page.locator('.panel-msp .test-status')).toContainText('Interrupted');
  expect(await command(page, 'iw dev stamld0 link')).toBe('Not connected.');
  expect(await command(page, 'wpa_cli -i stamld0 scan_results')).toBe(
    'bssid / frequency / signal level / flags / ssid',
  );
  expect(await command(page, 'ping -c 4 192.168.1.200')).toContain('100% packet loss');
  await page.clock.runFor(3_000);
  expect(await command(page, 'logread | grep NETWORK-NOT-FOUND')).toContain('NETWORK-NOT-FOUND');
  await page.getByRole('button', { name: '恢復起點', exact: true }).click();
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await expect(page.locator('.status-strip')).not.toContainText('STA connected');
  await page.clock.runFor(9_000);
  await expect(page.locator('.status-strip')).toContainText('STA connected');
  expect(await command(page, 'iw dev stamld0 link')).toContain('freq: 5180');
  expect(await command(page, 'ping -c 4 192.168.1.200')).toContain('0% packet loss');
  saved = await stored(page);
  expect(saved.lab.msp.runs[2].status).toBe('interrupted');
  expect(saved.lab.msp.runs[2].points).toHaveLength(1);
  expect(saved.lab.msp.runs.slice(0, 2).every((run) => run.status === 'completed')).toBe(true);

  await page.getByRole('button', { name: '開啟 Learning Center', exact: true }).click();
  await page.locator('.chapter-list').getByRole('button', { name: '第一次進入實驗室' }).click();
  await page.getByRole('button', { name: '關閉 Learning Center', exact: true }).click();
  await command(page, 'iw dev stamld0 link');
  await command(page, 'ping -c 4 192.168.1.200');
  await expect(page.locator('.mission-bar')).toContainText('Completed');
  const beforeReload = await stored(page);
  await page.reload();
  await expect(page.locator('.mission-bar')).toContainText('Chapter 1');
  await expect(page.locator('.mission-bar')).toContainText('Completed');
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 5 GHz');
  const afterReload = await stored(page);
  expect(afterReload.lab.msp.runs).toEqual(beforeReload.lab.msp.runs);
  expect(afterReload.lab.msp.settings).toEqual(beforeReload.lab.msp.settings);
  expect(afterReload.linux.history).toEqual(beforeReload.linux.history);
  expect(afterReload.evidence).toEqual(beforeReload.evidence);
  await page.screenshot({ path: testInfo.outputPath('ui-preview.png'), fullPage: true });
});

test('independent terminals, VFS persistence, history, clear, Ctrl+C and window controls', async ({
  page,
}) => {
  expect(await command(page, 'uci get wireless.stamld0.ssid', 'windows')).toContain(
    'not recognized',
  );
  expect(await command(page, 'ipconfig', 'windows')).toContain('192.168.1.200');
  expect(await command(page, 'ping 192.168.1.5', 'windows')).toContain('Received = 4');
  expect(await command(page, 'scan_results')).toContain('not found');
  expect(await command(page, 'wpa_cli -i atamld0 status')).toContain('No such virtual interface');
  expect(
    await command(
      page,
      "mkdir evidence; cd evidence; echo 'RF observation' > notes.txt; echo 'NETWORK-NOT-FOUND' >> notes.txt; cat notes.txt | grep NETWORK",
    ),
  ).toBe('NETWORK-NOT-FOUND');
  const field = page.getByLabel('Tera Term command');
  await field.press('ArrowUp');
  await expect(field).toHaveValue(/mkdir evidence/);
  await field.press('Control+c');
  await expect(field).toHaveValue('');
  await expect(page.locator('.panel-tera .terminal-scroll')).toContainText('^C');
  await field.fill('whoa');
  await field.press('Tab');
  await expect(field).toHaveValue('whoami ');
  await field.press('Enter');
  await expect(page.locator('.panel-tera .terminal-scroll')).toContainText('root');
  expect(await command(page, 'history')).toContain('cat notes.txt | grep NETWORK');
  await field.fill('clear');
  await field.press('Enter');
  await expect(page.locator('.panel-tera .terminal-scroll')).toHaveText('');
  expect(await command(page, 'cat notes.txt')).toBe('RF observation\nNETWORK-NOT-FOUND');
  await command(page, 'wpa_cli -i stamld0');
  expect(await command(page, 'status')).toContain('wpa_state=COMPLETED');
  await command(page, 'quit');

  await page.getByRole('button', { name: '最小化 Windows CMD', exact: true }).click();
  await expect(page.getByLabel('Windows CMD command')).toHaveCount(0);
  await page.getByRole('button', { name: '開啟 Windows CMD', exact: true }).click();
  await expect(page.getByLabel('Windows CMD command')).toBeVisible();
  await page.getByRole('button', { name: '最大化 Windows CMD', exact: true }).click();
  await expect(page.locator('.panel-cmd')).toHaveClass(/maximized/);
  await page.getByRole('button', { name: '最大化 Windows CMD', exact: true }).click();
  await expect(page.locator('.panel-cmd')).not.toHaveClass(/maximized/);
  await page.getByRole('button', { name: '關閉 Windows CMD', exact: true }).click();
  await page.getByRole('button', { name: '開啟 Windows CMD', exact: true }).click();
  await expect(page.getByLabel('Windows CMD command')).toBeVisible();
  await page.reload();
  expect(await command(page, 'pwd')).toBe('/root/evidence');
  expect(await command(page, 'cat notes.txt | tail -1')).toBe('NETWORK-NOT-FOUND');
  expect(await command(page, 'ipconfig', 'windows')).toContain('192.168.1.200');
});

test('snapshot import is transactional and corrupt saved data reloads safely', async ({ page }) => {
  await page.getByRole('button', { name: '測試參數', exact: true }).click();
  await page.getByLabel('duration', { exact: true }).fill('1');
  await page.getByLabel('end', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(1_000);
  await expect(page.locator('.panel-msp .test-status')).toContainText('Completed');
  await page.getByLabel('Manual attenuation').fill('17');
  const before = await stored(page);
  expect(before.lab.msp.runs).toHaveLength(1);
  const corruptImport = {
    ...before,
    lab: {
      ...before.lab,
      ap: { ...before.lab.ap, ssid: 'MUST-NOT-APPLY' },
      attenuation: { ...before.lab.attenuation, db: 90 },
      msp: { ...before.lab.msp, runs: [] },
    },
    linux: { ...before.linux, history: null },
  };
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '載入快照', exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'corrupt-terminal-snapshot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(corruptImport)),
  });
  await expect(page.getByRole('status')).toContainText('快照格式無效');
  await expect(page.getByTestId('attenuation-value')).toHaveText('17');
  await expect(page.locator('.status-strip')).toContainText('BN68_6G');
  const afterRejectedImport = await stored(page);
  expect(afterRejectedImport.lab).toEqual(before.lab);
  expect(afterRejectedImport.linux).toEqual(before.linux);

  // Deliberately corrupt only persisted input to exercise the reload recovery boundary.
  // This never mutates a running engine; restoration must validate before constructing one.
  const corruptPersisted = { ...before, lab: { ...before.lab, sta: null } };
  await page.evaluate(
    (value) => localStorage.setItem('wifi-qa-lab-v1', value),
    JSON.stringify(corruptPersisted),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 6 GHz');
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await expect(page.locator('.status-strip')).toContainText('STA connected');
  const recovered = await stored(page);
  expect(recovered.lab.msp.runs).toHaveLength(0);
  expect(recovered.lab.sta.status).toBe('connected');
  expect(await command(page, 'iw dev stamld0 link')).toContain('SSID: BN68_6G');
});

test('chapter 9 preserves the diagnostic exercise and requires real queries after recovery', async ({
  page,
}) => {
  await page.getByRole('button', { name: '開啟 Learning Center', exact: true }).click();
  await page
    .locator('.chapter-list')
    .getByRole('button', { name: 'Reboot 後 Not Connected' })
    .click();
  await page.getByRole('button', { name: '關閉 Learning Center', exact: true }).click();
  await expect(page.locator('.mission-bar')).toContainText('Chapter 9');
  await page.clock.runFor(9_000);
  expect(await command(page, 'iw dev stamld0 link')).toBe('Not connected.');
  const diagnosticLog = await command(page, 'logread');
  expect(diagnosticLog).toContain('NETWORK-NOT-FOUND');
  expect(diagnosticLog.toLowerCase()).not.toContain('below sensitivity');
  expect(diagnosticLog.toLowerCase()).not.toContain('attenuator remains');
  expect(await command(page, 'wpa_cli -i stamld0 scan_results')).toBe(
    'bssid / frequency / signal level / flags / ssid',
  );

  // Begin a fresh exercise so the spoof check cannot inherit legitimate diagnostic evidence.
  await page.getByRole('button', { name: '開啟 Learning Center', exact: true }).click();
  await page
    .locator('.chapter-list')
    .getByRole('button', { name: 'Reboot 後 Not Connected' })
    .click();
  await page.getByRole('button', { name: '關閉 Learning Center', exact: true }).click();
  await page.clock.runFor(9_000);
  expect((await stored(page)).evidence).toEqual([]);
  await page.getByRole('button', { name: '恢復起點', exact: true }).click();
  await page.clock.runFor(6_000);
  await expect(page.locator('.status-strip')).toContainText('STA connected');

  await command(
    page,
    "echo 'iw dev stamld0 link'; echo 'logread'; echo 'wpa_cli -i stamld0 scan_results'; echo 'ping -c 4 192.168.1.200'",
  );
  await expect(page.locator('.mission-bar')).not.toContainText('Completed');
  expect(await command(page, 'iw dev stamld0 link')).toContain('Connected');
  expect(await command(page, 'wpa_cli -i stamld0 scan_results')).toContain('BN68');
  expect(await command(page, 'ping -c 4 192.168.1.200')).toContain('0% packet loss');
  await command(page, 'logread');
  await expect(page.locator('.mission-bar')).toContainText('Completed');
  expect((await stored(page)).chapter).toBe(9);
});
