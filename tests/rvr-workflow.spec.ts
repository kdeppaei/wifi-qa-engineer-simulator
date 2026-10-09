import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import type { LabState } from '../src/engine/lab';

const FLOW = 'rvr-bf-comparison';
type StepRecord = {
  feedback: { status: string };
  attempt: { runId?: string; onRunId?: string; offRunId?: string };
};
type Progress = {
  selected: string;
  active: Record<string, number>;
  records: Record<string, Record<string, StepRecord>>;
};
const errors = new WeakMap<Page, string[]>();
const lab = (page: Page): Promise<LabState> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-lab-v1') || 'null').lab);
const progress = (page: Page): Promise<Progress> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wifi-qa-workflows-v1') || 'null'));

async function openRvr(page: Page) {
  await page
    .locator('.workspace-actions')
    .getByRole('button', { name: '指令工作流', exact: true })
    .click();
  await page.getByLabel('工作流程', { exact: true }).selectOption(FLOW);
}

async function selectStep(page: Page, id: string) {
  await page.getByTestId(`workflow-step-${id}`).click();
  await expect(page.getByTestId(`workflow-step-${id}`)).toHaveAttribute('aria-current', 'step');
}

async function perform(page: Page, id: string, status = 'success') {
  await selectStep(page, id);
  const current = page.getByTestId('workflow-current');
  const action = current.getByRole('button', { name: '執行本步操作', exact: true });
  const command = current.getByRole('button', { name: '執行本步', exact: true });
  if (await action.count()) await action.click();
  else if (await command.count()) await command.click();
  // Wait and comparison steps are driven by the shared state rather than a fabricated action result.
  await expect(page.getByTestId(`workflow-step-${id}`)).toHaveAttribute('data-status', status);
}

async function fastSettings(page: Page) {
  if (!(await page.getByLabel('duration', { exact: true }).count()))
    await page.getByRole('button', { name: '測試參數', exact: true }).click();
  for (const [key, value] of [
    ['start', '0'],
    ['end', '20'],
    ['step', '10'],
    ['lowStep', '10'],
    ['threshold', '0'],
    ['duration', '1'],
    ['seed', '7999'],
  ] as const)
    await page.getByLabel(key, { exact: true }).fill(value);
}

async function prepareOn(page: Page) {
  await perform(page, 'rvr-prepare');
  await fastSettings(page);
  await page.clock.runFor(6_000);
  await perform(page, 'rvr-link');
  await perform(page, 'rvr-server');
  await perform(page, 'rvr-ping');
  await perform(page, 'rvr-ap-on');
  await perform(page, 'rvr-restore-on');
  await perform(page, 'rvr-wait-start-on');
}

async function runId(page: Page, step: 'rvr-start-on' | 'rvr-start-off') {
  const id = (await progress(page)).records[FLOW][step].attempt.runId;
  expect(id, `${step} must retain the exact run created by its action`).toEqual(expect.any(String));
  return id!;
}

test.beforeEach(async ({ page }) => {
  const exceptions: string[] = [];
  errors.set(page, exceptions);
  page.on('pageerror', (error) => exceptions.push(error.message));
  await page.clock.install({ time: new Date('2026-10-09T11:00:00+08:00') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '你的 Wi-Fi 測試工作台' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-09T11:01:00+08:00'));
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), 'RvR workflow must not throw browser exceptions').toEqual([]);
});

test('full DL BF pair preserves old runs, rejects changed seed, exports only the pinned pair and reloads context', async ({
  page,
}, testInfo) => {
  await fastSettings(page);
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(3_000);
  const oldRun = (await lab(page)).msp.runs[0];
  expect(oldRun.status).toBe('completed');
  expect(oldRun.metadata.band).toBe('6');
  await openRvr(page);
  await expect(page.locator('.header-id')).toHaveText('LAB-01 · 6 GHz');
  expect((await lab(page)).msp.runs[0]).toEqual(oldRun);
  await prepareOn(page);
  let state = await lab(page);
  expect(state.ap.band).toBe('6');
  expect(state.sta.status).toBe('connected');
  expect(state.msp.runs[0]).toEqual(oldRun);
  expect(state.msp.runs).toHaveLength(1);

  await perform(page, 'rvr-start-on');
  const onId = await runId(page, 'rvr-start-on');
  expect(onId).not.toBe(oldRun.id);
  const onRow = page.getByTestId('rvr-live-data').locator('.rvr-run-row[data-bf="ON"]');
  await expect(onRow).toHaveAttribute('data-runid', onId);
  await expect(onRow).toHaveAttribute('data-status', 'running');
  await expect(onRow).toHaveAttribute('data-points', '0');
  await selectStep(page, 'rvr-wait-on');
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'waiting',
  );
  expect((await lab(page)).msp.runs.find((run) => run.id === onId)?.points).toHaveLength(0);
  await page.clock.runFor(1_000);
  let on = (await lab(page)).msp.runs.find((run) => run.id === onId)!;
  expect(on.status).toBe('running');
  expect(on.points.map((point) => point.attenuation)).toEqual([0]);
  await expect(onRow).toHaveAttribute('data-points', '1');
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'waiting',
  );
  await page.clock.runFor(2_000);
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'success',
  );
  on = (await lab(page)).msp.runs.find((run) => run.id === onId)!;
  expect(on.status).toBe('completed');
  expect(on.points.map((point) => point.attenuation)).toEqual([0, 10, 20]);
  expect(on.points.every((point) => point.bf)).toBe(true);
  await expect(onRow).toHaveAttribute('data-status', 'completed');
  await expect(onRow).toHaveAttribute('data-points', '3');

  await perform(page, 'rvr-restore-off');
  await expect(page.getByTestId('attenuation-value')).toHaveText('0');
  await perform(page, 'rvr-wait-start-off');
  await perform(page, 'rvr-ap-off');
  await page.getByLabel('seed', { exact: true }).fill('8000');
  await perform(page, 'rvr-start-off', 'failure');
  state = await lab(page);
  expect(state.msp.runs).toHaveLength(2);
  expect(state.msp.runs.find((run) => run.id === onId)).toEqual(on);
  await expect(
    page.locator('.panel-workflow').getByRole('button', { name: '下一步', exact: true }),
  ).toBeDisabled();
  // Restore the actual control value through the MSP form before retrying the same action.
  await page.getByLabel('seed', { exact: true }).fill('7999');
  await perform(page, 'rvr-start-off');
  const offId = await runId(page, 'rvr-start-off');
  expect(offId).not.toBe(onId);
  expect(offId).not.toBe(oldRun.id);
  const offRow = page.getByTestId('rvr-live-data').locator('.rvr-run-row[data-bf="OFF"]');
  await expect(offRow).toHaveAttribute('data-runid', offId);
  await expect(offRow).toHaveAttribute('data-status', 'running');
  await selectStep(page, 'rvr-wait-off');
  await expect(page.getByTestId('workflow-step-rvr-wait-off')).toHaveAttribute(
    'data-status',
    'waiting',
  );
  await page.clock.runFor(1_000);
  expect(
    (await lab(page)).msp.runs
      .find((run) => run.id === offId)
      ?.points.map((point) => point.attenuation),
  ).toEqual([0]);
  await page.clock.runFor(2_000);
  await expect(page.getByTestId('workflow-step-rvr-wait-off')).toHaveAttribute(
    'data-status',
    'success',
  );
  state = await lab(page);
  const off = state.msp.runs.find((run) => run.id === offId)!;
  expect(off.status).toBe('completed');
  expect(off.points.map((point) => point.attenuation)).toEqual([0, 10, 20]);
  expect(off.points.every((point) => !point.bf)).toBe(true);
  await expect(offRow).toHaveAttribute('data-status', 'completed');
  await expect(offRow).toHaveAttribute('data-points', '3');
  await expect(page.getByTestId('rvr-live-data').locator('.rvr-run-row')).toHaveCount(2);
  expect(off.settings).toEqual(on.settings);
  await perform(page, 'rvr-compare');
  await expect(page.getByTestId('workflow-feedback')).toHaveAttribute('data-status', 'success');

  const downloads: Record<string, Uint8Array> = {};
  for (const [kind, extension] of [
    ['csv', '.csv'],
    ['xlsx', '.xlsx'],
    ['report', '.html'],
    ['log', '.log'],
  ] as const) {
    const received = page.waitForEvent('download');
    await perform(page, `rvr-export-${kind}`);
    const download = await received;
    expect(download.suggestedFilename()).toContain('wifi-qa-bf-on-off');
    expect(download.suggestedFilename()).toMatch(new RegExp(extension.replace('.', '\\.') + '$'));
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    downloads[kind] = new Uint8Array(await readFile(path));
    expect(downloads[kind].length).toBeGreaterThan(100);
  }
  const csv = new TextDecoder().decode(downloads.csv);
  const rows = csv.trim().split(/\r?\n/);
  expect(rows).toHaveLength(7);
  const csvRunIds = rows.slice(1).map((row) => row.match(/^"([^"]+)"/)?.[1]);
  expect(csvRunIds).toEqual([onId, onId, onId, offId, offId, offId]);
  expect(csvRunIds).not.toContain(oldRun.id);
  const workbook = unzipSync(downloads.xlsx);
  const measured = strFromU8(workbook['xl/worksheets/sheet2.xml']);
  expect(measured).toContain(`>${onId}</t>`);
  expect(measured).toContain(`>${offId}</t>`);
  expect(measured).not.toContain(`>${oldRun.id}</t>`);
  const chart = strFromU8(workbook['xl/charts/chart1.xml']);
  expect(chart.match(/<c:ser>/g)).toHaveLength(2);
  expect(chart).toContain('BF ON');
  expect(chart).toContain('BF OFF');
  const report = new TextDecoder().decode(downloads.report);
  expect(report.match(/<details open>/g)).toHaveLength(2);
  expect(report).toContain(onId);
  expect(report).toContain(offId);
  expect(report).toContain('模擬資料');
  const log = new TextDecoder().decode(downloads.log);
  expect(log).toContain('MSP');
  expect(log).toContain(on.label);
  expect(log).toContain(off.label);
  expect((await lab(page)).msp.runs).toHaveLength(3);
  expect((await lab(page)).msp.runs[0]).toEqual(oldRun);

  await page.reload();
  await openRvr(page);
  const restored = await progress(page);
  expect(restored.selected).toBe(FLOW);
  expect(restored.records[FLOW]['rvr-start-on'].attempt.runId).toBe(onId);
  expect(restored.records[FLOW]['rvr-start-off'].attempt.runId).toBe(offId);
  await expect(
    page.getByTestId('rvr-live-data').locator('.rvr-run-row[data-bf="ON"]'),
  ).toHaveAttribute('data-runid', onId);
  await expect(
    page.getByTestId('rvr-live-data').locator('.rvr-run-row[data-bf="OFF"]'),
  ).toHaveAttribute('data-runid', offId);
  await perform(page, 'rvr-compare');
  expect((await lab(page)).msp.runs).toHaveLength(3);
  await page.screenshot({ path: testInfo.outputPath('rvr-workflow-preview.png'), fullPage: true });
});

test('an interrupted pinned ON run fails even when a previous matching ON run is completed', async ({
  page,
}) => {
  // Produce a tempting old 5 GHz run through the real AP and terminal interfaces.
  await page.getByRole('button', { name: 'Configure AP', exact: true }).click();
  await page.locator('.panel-ap').getByLabel('Band').selectOption('5');
  await page.getByLabel('AP SSID').fill('BN68');
  await page.getByRole('button', { name: '關閉 AP Configuration', exact: true }).click();
  await page
    .getByLabel('Tera Term command')
    .fill(
      'uci set wireless.stamld0.ssid=BN68; uci set wireless.stamld0.device=MT7999_1_2; uci commit wireless; wifi restart',
    );
  await page.getByLabel('Tera Term command').press('Enter');
  await page.clock.runFor(6_000);
  await fastSettings(page);
  await page.getByRole('button', { name: 'Start Test', exact: true }).click();
  await page.clock.runFor(3_000);
  const oldRun = (await lab(page)).msp.runs[0];
  expect(oldRun.status).toBe('completed');
  expect(oldRun.metadata.band).toBe('5');
  expect(oldRun.bf).toBe(true);
  await openRvr(page);
  await prepareOn(page);
  await perform(page, 'rvr-start-on');
  const onId = await runId(page, 'rvr-start-on');
  expect(onId).not.toBe(oldRun.id);
  await selectStep(page, 'rvr-wait-on');
  await page.clock.runFor(1_000);
  await page.getByLabel('Manual attenuation').fill('90');
  await page.clock.runFor(1_000);
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'failure',
  );
  const state = await lab(page);
  expect(state.msp.runs.find((run) => run.id === onId)?.status).toBe('interrupted');
  expect(state.msp.runs.find((run) => run.id === onId)?.points).toHaveLength(1);
  expect(state.msp.runs.find((run) => run.id === oldRun.id)).toEqual(oldRun);
  await expect(
    page.locator('.panel-workflow').getByRole('button', { name: '下一步', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await openRvr(page);
  expect((await progress(page)).records[FLOW]['rvr-start-on'].attempt.runId).toBe(onId);
  await selectStep(page, 'rvr-wait-on');
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'failure',
  );
  expect((await lab(page)).msp.runs).toHaveLength(2);
  // This setup resets the engine but keeps the RF guide open: discard every old RvR pin.
  await page.getByLabel('工作流程', { exact: true }).selectOption('rf-recovery');
  await perform(page, 'fault-setup');
  expect((await progress(page)).records[FLOW]).toEqual({});
  expect((await progress(page)).records['rf-recovery']['fault-setup'].feedback.status).toBe(
    'success',
  );
  await page.getByLabel('工作流程', { exact: true }).selectOption(FLOW);
  for (const bf of ['ON', 'OFF']) {
    const row = page.getByTestId('rvr-live-data').locator(`.rvr-run-row[data-bf="${bf}"]`);
    await expect(row).toHaveAttribute('data-runid', '');
    await expect(row).toHaveAttribute('data-status', 'idle');
  }
  await perform(page, 'rvr-compare', 'failure');
  await expect(page.getByTestId('workflow-feedback')).toContainText('Run ID');
  expect((await lab(page)).msp.runs).toHaveLength(0);
});

test('scenario and free-lab resets clear all comparison pins before run identifiers can be reused', async ({
  page,
}) => {
  await fastSettings(page);
  await openRvr(page);
  await prepareOn(page);
  await perform(page, 'rvr-start-on');
  const originalId = await runId(page, 'rvr-start-on');
  await selectStep(page, 'rvr-wait-on');
  await page.clock.runFor(3_000);
  await expect(page.getByTestId('workflow-step-rvr-wait-on')).toHaveAttribute(
    'data-status',
    'success',
  );
  expect((await lab(page)).msp.runs[0].id).toBe(originalId);

  await page.getByRole('button', { name: '開啟 Learning Center', exact: true }).click();
  await page
    .locator('.chapter-list')
    .getByRole('button', { name: 'Reboot 後 Not Connected' })
    .click();
  await page.getByRole('button', { name: '關閉 Learning Center', exact: true }).click();
  expect((await progress(page)).records).toEqual({});
  expect((await lab(page)).msp.runs).toHaveLength(0);
  await page.getByLabel('工作流程', { exact: true }).selectOption(FLOW);
  await expect(
    page.getByTestId('rvr-live-data').locator('.rvr-run-row[data-bf="ON"]'),
  ).toHaveAttribute('data-runid', '');
  await perform(page, 'rvr-compare', 'failure');

  // Recover through the real control, create another pin, then use the free-lab reset.
  await page.getByLabel('Manual attenuation').fill('0');
  await page.clock.runFor(9_000);
  await prepareOn(page);
  await perform(page, 'rvr-start-on');
  const recoveredId = await runId(page, 'rvr-start-on');
  expect((await lab(page)).msp.runs[0].id).toBe(recoveredId);
  await page.getByRole('button', { name: '重置實驗室', exact: true }).click();
  expect((await progress(page)).records).toEqual({});
  expect((await lab(page)).msp.runs).toHaveLength(0);
  expect((await lab(page)).ap.band).toBe('6');
  await page.getByLabel('工作流程', { exact: true }).selectOption(FLOW);
  await expect(
    page.getByTestId('rvr-live-data').locator('.rvr-run-row[data-bf="ON"]'),
  ).toHaveAttribute('data-runid', '');
  await perform(page, 'rvr-compare', 'failure');
  await page.reload();
  await openRvr(page);
  expect((await progress(page)).records[FLOW]['rvr-start-on']).toBeUndefined();
  await perform(page, 'rvr-compare', 'failure');
});
