import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { LabState } from '../src/engine/lab';

type TerminalData = { history: string[]; mode: 'shell' | 'wpa' };
type Saved = { lab: LabState; linux: TerminalData; windows: TerminalData; evidence: string[] };
type Progress = {
  selected: string;
  active: Record<string, number>;
  records: Record<
    string,
    Record<
      string,
      {
        feedback: { status: string; message: string };
        output?: string;
        attempt: { command?: string; os?: string };
      }
    >
  >;
};
const errors = new WeakMap<Page, string[]>();
const saved = (page: Page): Promise<Saved> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-lab-v1') || 'null'));
const progress = (page: Page): Promise<Progress> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-workflows-v1') || 'null'));
const devices = (data: Saved) => ({
  ap: data.lab.ap,
  attenuation: data.lab.attenuation,
  config: data.lab.config,
  runs: data.lab.msp.runs,
});

async function openGuide(page: Page, id?: string) {
  await page
    .locator('.workspace-actions')
    .getByRole('button', { name: '指令工作流', exact: true })
    .click();
  await expect(page.locator('.panel-workflow')).toBeVisible();
  if (id) await page.getByLabel('工作流程', { exact: true }).selectOption(id);
}

async function step(page: Page, id: string) {
  await page.getByTestId(`workflow-step-${id}`).click();
  await expect(page.getByTestId(`workflow-step-${id}`)).toHaveAttribute('aria-current', 'step');
}

async function runStep(page: Page, id: string, status = 'success') {
  await step(page, id);
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行本步', exact: true })
    .click();
  await expect(page.getByTestId(`workflow-step-${id}`)).toHaveAttribute('data-status', status);
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', status);
}

async function terminalOutput(page: Page, os: 'linux' | 'windows' = 'linux') {
  return page
    .locator(os === 'linux' ? '.panel-tera .terminal-entry' : '.panel-cmd .terminal-entry')
    .filter({ has: page.locator('.command-line') })
    .last()
    .locator('pre')
    .last()
    .innerText();
}

test.beforeEach(async ({ page }) => {
  const exceptions: string[] = [];
  errors.set(page, exceptions);
  page.on('pageerror', (error) => exceptions.push(error.message));
  await page.clock.install({ time: new Date('2026-10-09T10:00:00+08:00') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-09T10:01:00+08:00'));
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), 'Workflow interactions must not throw browser exceptions').toEqual([]);
});

test('workflow selection preserves the lab, send only fills VT, and BF lifecycle saves real progress', async ({
  page,
}, testInfo) => {
  // Keep a completed run and a nonzero attenuator readback to detect accidental workflow resets.
  await page.getByRole('button', { name: '測試參數', exact: true }).click();
  await page.getByLabel('duration', { exact: true }).fill('1');
  await page.getByLabel('end', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(1_000);
  await page.getByLabel('Manual attenuation').fill('12');
  const beforeSelection = await saved(page);
  expect(beforeSelection.lab.msp.runs).toHaveLength(1);
  await openGuide(page, 'uci-bf-lifecycle');
  expect(devices(await saved(page))).toEqual(devices(beforeSelection));

  const readCommand = 'uci get wireless.MT7999_1_3.etxbfencond';
  await expect(page.getByLabel('工作流指令', { exact: true })).toHaveValue(readCommand);
  const beforeSend = await saved(page);
  await page.getByRole('button', { name: '關閉 COM23 · Tera Term VT', exact: true }).click();
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '送入 VT', exact: true })
    .click();
  await expect(page.getByLabel('Tera Term command')).toHaveValue(readCommand);
  const afterSend = await saved(page);
  expect(devices(afterSend)).toEqual(devices(beforeSend));
  expect(afterSend.linux.history).toEqual(beforeSend.linux.history);
  expect(afterSend.evidence).toEqual(beforeSend.evidence);
  await expect(page.getByTestId('workflow-step-bf-read')).toHaveAttribute('data-status', 'ready');

  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行本步', exact: true })
    .click();
  await expect(page.getByTestId('workflow-step-bf-read')).toHaveAttribute('data-status', 'success');
  await expect(page.getByLabel('Tera Term command')).toHaveValue('');
  expect(await terminalOutput(page)).toBe('3');
  expect((await saved(page)).linux.history.at(-1)).toBe(readCommand);
  expect((await progress(page)).records['uci-bf-lifecycle']['bf-read'].output).toBe('3');

  const key = 'wireless.MT7999_1_3.etxbfencond';
  await runStep(page, 'bf-stage-off');
  let data = await saved(page);
  expect(data.lab.config.staged[key]).toBe('0');
  expect(data.lab.config.committed[key]).toBe('3');
  expect(data.lab.config.runtime[key]).toBe('3');
  await expect(page.getByTestId('workflow-feedback')).toContainText('沒有標準輸出');
  await runStep(page, 'bf-read-pending');
  expect(await terminalOutput(page)).toBe('0');
  await runStep(page, 'bf-commit');
  data = await saved(page);
  expect(data.lab.config.staged[key]).toBeUndefined();
  expect(data.lab.config.committed[key]).toBe('0');
  expect(data.lab.config.runtime[key]).toBe('3');
  await runStep(page, 'bf-read-committed');
  expect(await terminalOutput(page)).toBe('0');
  await runStep(page, 'bf-restart');
  data = await saved(page);
  expect(data.lab.sta.status).toBe('restarting');
  expect(data.lab.config.runtime[key]).toBe('0');
  await step(page, 'bf-wait');
  await expect(page.getByTestId('workflow-step-bf-wait')).toHaveAttribute('data-status', 'waiting');
  await expect(
    page.locator('.panel-workflow').getByRole('button', { name: '下一步', exact: true }),
  ).toBeDisabled();
  await page.clock.runFor(2_000);
  expect((await saved(page)).lab.sta.status).toBe('scanning');
  await expect(page.getByTestId('workflow-step-bf-wait')).toHaveAttribute('data-status', 'waiting');
  await page.clock.runFor(4_000);
  await expect(page.getByTestId('workflow-step-bf-wait')).toHaveAttribute('data-status', 'success');
  expect((await saved(page)).lab.sta.status).toBe('connected');
  await runStep(page, 'bf-link');
  expect(await terminalOutput(page)).toContain('Connected');
  await page.screenshot({ path: testInfo.outputPath('workflow-preview.png'), fullPage: true });
  await runStep(page, 'bf-ping');
  expect(await terminalOutput(page)).toContain('0% packet loss');
  await expect(page.locator('.panel-workflow .workflow-complete')).toBeVisible();
  const finished = await progress(page);
  expect(
    Object.values(finished.records['uci-bf-lifecycle']).every(
      (record) => record.feedback.status === 'success',
    ),
  ).toBe(true);
  expect((await saved(page)).lab.msp.runs).toEqual(beforeSelection.lab.msp.runs);
  await page.reload();
  await openGuide(page);
  await expect(page.getByLabel('工作流程', { exact: true })).toHaveValue('uci-bf-lifecycle');
  await expect(page.getByTestId('workflow-step-bf-ping')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.panel-workflow .workflow-complete')).toBeVisible();
  const restored = await progress(page);
  expect(restored.active['uci-bf-lifecycle']).toBe(finished.active['uci-bf-lifecycle']);
  expect(
    Object.values(restored.records['uci-bf-lifecycle']).map((record) => record.feedback.status),
  ).toEqual(
    Object.values(finished.records['uci-bf-lifecycle']).map((record) => record.feedback.status),
  );
  expect(restored.records['uci-bf-lifecycle']['bf-ping'].output).toBe(
    finished.records['uci-bf-lifecycle']['bf-ping'].output,
  );
  expect((await saved(page)).lab.config.runtime[key]).toBe('0');
  await expect(page.getByTestId('attenuation-value')).toHaveText('12');
});

test('command picker dispatches to the right terminal and guards wpa_cli shell mode', async ({
  page,
}) => {
  await openGuide(page);
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '常用指令', exact: true })
    .click();
  await page.getByLabel('指令分類', { exact: true }).selectOption('windows');
  await page.getByLabel('常用指令', { exact: true }).selectOption('cmd-ip');
  await expect(page.getByLabel('常用指令內容', { exact: true })).toHaveValue('ipconfig');
  const beforeSend = await saved(page);
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '送入 CMD', exact: true })
    .click();
  await expect(page.getByLabel('Windows CMD command')).toHaveValue('ipconfig');
  await expect(page.getByLabel('Tera Term command')).toHaveValue('');
  expect((await saved(page)).windows.history).toEqual(beforeSend.windows.history);
  expect(devices(await saved(page))).toEqual(devices(beforeSend));
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行選定指令', exact: true })
    .click();
  const pickedOutput = await terminalOutput(page, 'windows');
  expect(pickedOutput).toContain('Windows IP Configuration');
  expect((await saved(page)).windows.history.at(-1)).toBe('ipconfig');
  expect((await saved(page)).linux.history).toEqual(beforeSend.linux.history);
  await page.getByLabel('Windows CMD command').fill('ipconfig');
  await page.getByLabel('Windows CMD command').press('Enter');
  expect(await terminalOutput(page, 'windows')).toBe(pickedOutput);

  await page.getByLabel('指令分類', { exact: true }).selectOption('linux');
  await page.getByLabel('常用指令', { exact: true }).selectOption('vt-bf-config');
  await expect(page.getByLabel('常用指令內容', { exact: true })).toHaveValue(
    'uci get wireless.MT7999_1_3.etxbfencond',
  );
  await page.getByLabel('Tera Term command').fill('wpa_cli -i stamld0');
  await page.getByLabel('Tera Term command').press('Enter');
  await expect(page.locator('.panel-workflow .workflow-warning')).toContainText('wpa_cli');
  await expect(
    page.locator('.panel-workflow').getByRole('button', { name: '執行選定指令', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('指令分類', { exact: true }).selectOption('windows');
  await page.getByLabel('常用指令', { exact: true }).selectOption('cmd-ip');
  await expect(
    page.locator('.panel-workflow').getByRole('button', { name: '執行選定指令', exact: true }),
  ).toBeEnabled();
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行選定指令', exact: true })
    .click();
  expect(await terminalOutput(page, 'windows')).toContain('Windows IP Configuration');
  expect((await saved(page)).linux.mode).toBe('wpa');
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '退出 wpa_cli', exact: true })
    .click();
  await expect(page.locator('.panel-workflow .workflow-warning')).toHaveCount(0);
  expect((await saved(page)).linux.mode).toBe('shell');
  await page.getByLabel('指令分類', { exact: true }).selectOption('linux');
  await page.getByLabel('常用指令', { exact: true }).selectOption('vt-link');
  await expect(page.getByLabel('常用指令內容', { exact: true })).toHaveValue('iw dev stamld0 link');
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行選定指令', exact: true })
    .click();
  await expect.poll(() => terminalOutput(page)).toContain('Connected');
});

test('errors and disconnected links never mark a workflow step successful', async ({ page }) => {
  await openGuide(page, 'connection-direction');
  await page.getByLabel('工作流指令', { exact: true }).fill('definitely_not_a_command');
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行本步', exact: true })
    .click();
  await expect(page.getByTestId('workflow-step-connection-link')).toHaveAttribute(
    'data-status',
    'failure',
  );
  expect(await terminalOutput(page)).toContain('not found');
  await expect(
    page.locator('.panel-workflow').getByRole('button', { name: '下一步', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('工作流指令', { exact: true })
    .fill("echo 'Connected to 02:ff:00:2d:e3:63'");
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行本步', exact: true })
    .click();
  await expect(page.getByTestId('workflow-step-connection-link')).toHaveAttribute(
    'data-status',
    'failure',
  );

  await page.getByLabel('Manual attenuation').fill('90');
  await page.getByLabel('工作流指令', { exact: true }).fill('iw dev stamld0 link');
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行本步', exact: true })
    .click();
  expect(await terminalOutput(page)).toBe('Not connected.');
  await expect(page.getByTestId('workflow-step-connection-link')).toHaveAttribute(
    'data-status',
    'failure',
  );
  await runStep(page, 'connection-pc-ip');
  expect(await terminalOutput(page, 'windows')).toContain('Windows IP Configuration');
  await runStep(page, 'connection-ul', 'failure');
  expect(await terminalOutput(page)).toContain('No route to host');
  const data = await progress(page);
  expect(data.records['connection-direction']['connection-link'].feedback.status).toBe('failure');
  expect(data.records['connection-direction']['connection-pc-ip'].feedback.status).toBe('success');
  expect(data.records['connection-direction']['connection-ul'].feedback.status).toBe('failure');
});

test('5 GHz migration workflow applies its explicit operation and verifies real recovery', async ({
  page,
}) => {
  await openGuide(page, 'migrate-5g');
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 6 GHz');
  await expect(page.getByTestId('workflow-step-migration-ap')).toHaveAttribute(
    'data-status',
    'ready',
  );
  await page
    .locator('.panel-workflow')
    .getByRole('button', { name: '執行本步操作', exact: true })
    .click();
  await expect(page.getByTestId('workflow-step-migration-ap')).toHaveAttribute(
    'data-status',
    'success',
  );
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 5 GHz');
  expect((await saved(page)).lab.config.runtime['wireless.stamld0.device']).toBe('MT7999_1_3');
  await runStep(page, 'migration-read');
  await runStep(page, 'migration-ssid');
  await runStep(page, 'migration-device');
  expect((await saved(page)).lab.config.staged['wireless.stamld0.device']).toBe('MT7999_1_2');
  await runStep(page, 'migration-commit');
  expect((await saved(page)).lab.config.runtime['wireless.stamld0.device']).toBe('MT7999_1_3');
  await runStep(page, 'migration-restart');
  await step(page, 'migration-wait');
  await expect(page.getByTestId('workflow-step-migration-wait')).toHaveAttribute(
    'data-status',
    'waiting',
  );
  await page.clock.runFor(6_000);
  await expect(page.getByTestId('workflow-step-migration-wait')).toHaveAttribute(
    'data-status',
    'success',
  );
  await runStep(page, 'migration-link');
  expect(await terminalOutput(page)).toContain('freq: 5180');
  await runStep(page, 'migration-ping');
  expect(await terminalOutput(page)).toContain('0% packet loss');
  await expect(page.locator('.panel-workflow .workflow-complete')).toBeVisible();
  await step(page, 'migration-restart');
  const beforeSkip = await saved(page);
  await page.getByRole('button', { name: '檢查目前狀態（已符合可跳過）', exact: true }).click();
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'success');
  expect(devices(await saved(page))).toEqual(devices(beforeSkip));
});

test('RF troubleshooting gathers real negative evidence then waits for progressive recovery', async ({
  page,
}) => {
  await openGuide(page, 'rf-recovery');
  await expect(page.locator('.panel-workflow .workflow-warning')).toContainText('清除目前量測');
  await page.getByRole('button', { name: '執行本步操作', exact: true }).click();
  await expect(page.getByTestId('workflow-step-fault-setup')).toHaveAttribute(
    'data-status',
    'success',
  );
  await expect(page.getByTestId('attenuation-value')).toHaveText('90');
  await step(page, 'fault-wait');
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'waiting');
  await page.clock.runFor(9_000);
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'success');
  await runStep(page, 'fault-link');
  expect(await terminalOutput(page)).toBe('Not connected.');
  await runStep(page, 'fault-config');
  await runStep(page, 'fault-scan');
  expect(await terminalOutput(page)).toBe('bssid / frequency / signal level / flags / ssid');
  await runStep(page, 'fault-log');
  expect(await terminalOutput(page)).toContain('NETWORK-NOT-FOUND');
  await step(page, 'fault-restore');
  await page.getByRole('button', { name: '執行本步操作', exact: true }).click();
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await step(page, 'fault-recovery-wait');
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'waiting');
  await page.clock.runFor(1_000);
  await expect(page.locator('.status-strip')).toContainText('STA scanning');
  await page.clock.runFor(2_000);
  await expect(page.locator('.status-strip')).toContainText('STA associating');
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'waiting');
  await page.clock.runFor(2_000);
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'success');
  await runStep(page, 'fault-recovered-link');
  await runStep(page, 'fault-recovered-ping');
  await expect(page.locator('.panel-workflow .workflow-complete')).toBeVisible();
  expect(
    (await saved(page)).lab.logs.some((log) => log.message.includes('NETWORK-NOT-FOUND')),
  ).toBe(true);
});
