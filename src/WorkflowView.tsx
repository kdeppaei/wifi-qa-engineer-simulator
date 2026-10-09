import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  Clock3,
  ListChecks,
  Play,
  RotateCcw,
  Send,
  Terminal,
} from 'lucide-react';
import type { LabState, TestSettings } from './engine/lab';
import {
  commandShortcuts,
  workflows,
  resolveCommand,
  evaluateWorkflowStep,
} from './engine/workflow';
import type { WorkflowActionId, WorkflowAttempt, WorkflowFeedback } from './engine/workflow';
import { RVR_FLOW_ID, RVR_STEP_IDS, validateRvrPair } from './engine/rvrWorkflow';
import type { RvrComparisonContext, RvrExportReceipt } from './engine/rvrWorkflow';

export interface LabObservation {
  link: string;
  attenuation: number;
  pending: number;
  unapplied: number;
  ap: string;
  runtimeBF: string;
  msp: string;
}
export function observeLab(state: LabState): LabObservation {
  const section =
    Object.keys(state.config.runtime)
      .find((key) => key.endsWith('.mode') && state.config.runtime[key] === 'sta')
      ?.slice(0, -5) || 'wireless.stamld0';
  const radio = state.config.runtime[`${section}.device`];
  return {
    link: state.sta.status,
    attenuation: state.attenuation.db,
    pending: Object.keys(state.config.staged).length,
    unapplied: Object.keys({ ...state.config.committed, ...state.config.runtime }).filter(
      (key) => state.config.committed[key] !== state.config.runtime[key],
    ).length,
    ap: `${state.ap.band} GHz · ${state.ap.ssid}`,
    runtimeBF: state.config.runtime[`wireless.${radio}.etxbfencond`] || '—',
    msp: state.msp.status,
  };
}
export interface CommandContext {
  workflowId: string;
  stepId: string;
}
export interface CommandExecution {
  id: number;
  command: string;
  output: string;
  os: 'linux' | 'windows';
  at: number;
  before: LabObservation;
  after: LabObservation;
  context?: CommandContext;
}
export interface ActionExecution {
  state: LabState;
  output: string;
  before: LabObservation;
  after: LabObservation;
  runId?: string;
  exportReceipt?: RvrExportReceipt;
  error?: string;
}
interface StepRecord {
  feedback: WorkflowFeedback;
  attempt: WorkflowAttempt;
  output?: string;
  before?: LabObservation;
  after?: LabObservation;
}
interface Progress {
  version: 1;
  selected: string;
  active: Record<string, number>;
  records: Record<string, Record<string, StepRecord>>;
}
const KEY = 'wifi-qa-workflows-v1';
function fresh(): Progress {
  return { version: 1, selected: workflows[0].id, active: {}, records: {} };
}
function savedRunId(input: unknown): string | undefined {
  return typeof input === 'string' && /^run-\d+$/.test(input) ? input : undefined;
}
function savedReceipt(input: unknown): RvrExportReceipt | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const data = input as Partial<RvrExportReceipt>;
  if (
    !['csv', 'xlsx', 'report', 'log'].includes(data.kind || '') ||
    !savedRunId(data.onRunId) ||
    !savedRunId(data.offRunId) ||
    !Number.isInteger(data.pointCount) ||
    !(data.pointCount! > 0) ||
    !Number.isFinite(data.generatedAt) ||
    !(data.generatedAt! >= 0) ||
    !Number.isInteger(data.bytes) ||
    !(data.bytes! > 0) ||
    (data.filename !== undefined &&
      (typeof data.filename !== 'string' || data.filename.length > 256))
  )
    return undefined;
  return {
    kind: data.kind!,
    onRunId: data.onRunId!,
    offRunId: data.offRunId!,
    pointCount: data.pointCount!,
    generatedAt: data.generatedAt!,
    bytes: data.bytes!,
    filename: data.filename,
  };
}
function restore(): Progress {
  const result = fresh();
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!data || data.version !== 1) return result;
    if (workflows.some((workflow) => workflow.id === data.selected))
      result.selected = data.selected;
    for (const workflow of workflows) {
      const index = data.active?.[workflow.id];
      if (Number.isInteger(index) && index >= 0 && index < workflow.steps.length)
        result.active[workflow.id] = index;
      const records: Record<string, StepRecord> = {};
      for (const step of workflow.steps) {
        const record = data.records?.[workflow.id]?.[step.id];
        if (
          !record ||
          !['ready', 'waiting', 'success', 'failure'].includes(record.feedback?.status) ||
          typeof record.feedback.message !== 'string' ||
          record.feedback.message.length > 2000 ||
          !record.attempt ||
          !Number.isFinite(record.attempt.startedAt)
        )
          continue;
        records[step.id] = {
          feedback: {
            status: record.feedback.status,
            message: record.feedback.message,
            hint:
              typeof record.feedback.hint === 'string'
                ? record.feedback.hint.slice(0, 2000)
                : undefined,
            evidence: Array.isArray(record.feedback.evidence)
              ? record.feedback.evidence.filter((s: unknown) => typeof s === 'string').slice(0, 20)
              : [],
          },
          attempt: {
            startedAt: record.attempt.startedAt,
            command:
              typeof record.attempt.command === 'string'
                ? record.attempt.command.slice(0, 6000)
                : undefined,
            output:
              typeof record.attempt.output === 'string'
                ? record.attempt.output.slice(0, 6000)
                : undefined,
            os: ['linux', 'windows'].includes(record.attempt.os) ? record.attempt.os : undefined,
            action:
              step.kind === 'action' && record.attempt.action === step.action
                ? step.action
                : undefined,
            runId: savedRunId(record.attempt.runId),
            onRunId: savedRunId(record.attempt.onRunId),
            offRunId: savedRunId(record.attempt.offRunId),
            exportReceipt: savedReceipt(record.attempt.exportReceipt),
            error:
              typeof record.attempt.error === 'string'
                ? record.attempt.error.slice(0, 2000)
                : undefined,
          },
          output: typeof record.output === 'string' ? record.output.slice(0, 6000) : undefined,
          before: validObservation(record.before) ? record.before : undefined,
          after: validObservation(record.after) ? record.after : undefined,
        };
      }
      result.records[workflow.id] = records;
    }
  } catch {
    /* A damaged progress record does not affect the laboratory. */
  }
  return result;
}
const labels: Record<keyof LabObservation, string> = {
  link: 'STA',
  attenuation: '衰減 dB',
  pending: 'Pending',
  unapplied: 'Unapplied',
  ap: 'AP',
  runtimeBF: 'STA Runtime BF',
  msp: 'MSP',
};
function validObservation(input: unknown): input is LabObservation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return Object.keys(labels).every((key) =>
    ['attenuation', 'pending', 'unapplied'].includes(key)
      ? typeof value[key] === 'number' &&
        Number.isFinite(value[key]) &&
        value[key] >= 0 &&
        value[key] <= 10000
      : typeof value[key] === 'string' && value[key].length <= 200,
  );
}

export default function WorkflowView({
  state,
  execution,
  shellMode,
  resetKey,
  onCommand,
  onAction,
  onSettings,
  onOpenMsp,
  renderComparisonChart,
}: {
  state: LabState;
  execution: CommandExecution | null;
  shellMode: 'shell' | 'wpa';
  resetKey: number;
  onCommand: (
    command: string,
    os: 'linux' | 'windows',
    execute: boolean,
    context?: CommandContext,
  ) => void;
  onAction: (action: WorkflowActionId, comparison?: RvrComparisonContext) => ActionExecution;
  onSettings: (settings: Partial<TestSettings>) => void;
  onOpenMsp: () => void;
  renderComparisonChart: (comparison: RvrComparisonContext) => ReactNode;
}) {
  const [progress, setProgress] = useState(restore);
  const [tab, setTab] = useState<'workflow' | 'commands'>('workflow');
  const [draft, setDraft] = useState('');
  const [shortcutId, setShortcutId] = useState(commandShortcuts[0].id);
  const [commandDraft, setCommandDraft] = useState('');
  const [filter, setFilter] = useState('all');
  const [storageError, setStorageError] = useState(false);
  const seenExecution = useRef<number | undefined>(execution?.id);
  const seenReset = useRef(resetKey);
  const resetPending = seenReset.current !== resetKey;
  const navigationView = useRef<HTMLDivElement>(null);
  const currentView = useRef<HTMLElement>(null);
  const previousStep = useRef({ workflowId: '', stepId: '' });
  const workflow = workflows.find((item) => item.id === progress.selected) || workflows[0];
  const index = progress.active[workflow.id] || 0;
  const step = workflow.steps[index];
  const records = progress.records[workflow.id] || {};
  function comparisonFor(workflowId: string = workflow.id): RvrComparisonContext {
    const items = progress.records[workflowId] || {};
    return {
      onRunId: items[RVR_STEP_IDS.startOn]?.attempt.runId,
      offRunId: items[RVR_STEP_IDS.startOff]?.attempt.runId,
    };
  }
  const comparison = comparisonFor();
  const onRun = state.msp.runs.find((run) => run.id === comparison.onRunId);
  const offRun = state.msp.runs.find((run) => run.id === comparison.offRunId);
  const isRvr = workflow.id === RVR_FLOW_ID;
  const pairCheck = isRvr
    ? validateRvrPair(state, comparison.onRunId, comparison.offRunId)
    : undefined;
  const paramsDiffer =
    !!onRun &&
    (Object.keys(onRun.settings) as (keyof TestSettings)[]).some(
      (key) => onRun.settings[key] !== state.msp.settings[key],
    );
  const result = records[step.id];
  useEffect(() => {
    if (previousStep.current.workflowId === workflow.id && previousStep.current.stepId !== step.id)
      currentView.current?.scrollIntoView({ block: 'start' });
    previousStep.current = { workflowId: workflow.id, stepId: step.id };
  }, [workflow.id, step.id]);
  useEffect(() => {
    if (!result || resetPending) return;
    if (isRvr && result.feedback.status === 'waiting')
      currentView.current?.scrollIntoView({ block: 'start' });
    else navigationView.current?.scrollIntoView({ block: 'nearest' });
  }, [workflow.id, step.id, result?.feedback.status, result?.attempt.startedAt, result?.output]);
  const shortcut = commandShortcuts.find((item) => item.id === shortcutId) || commandShortcuts[0];

  function record(workflowId: string, stepId: string, value: StepRecord) {
    if (resetPending) return;
    setProgress((previous) => ({
      ...previous,
      records: {
        ...previous.records,
        [workflowId]: { ...previous.records[workflowId], [stepId]: value },
      },
    }));
  }
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(progress));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [progress]);
  useEffect(() => {
    if (seenReset.current === resetKey) return;
    seenReset.current = resetKey;
    seenExecution.current = execution?.id;
    setProgress(fresh());
  }, [resetKey]);
  useEffect(() => {
    setDraft(step.kind === 'command' ? resolveCommand(step, state) : '');
  }, [workflow.id, step.id]);
  useEffect(() => {
    setCommandDraft(resolveCommand(shortcut, state));
  }, [shortcut.id]);
  useEffect(() => {
    if (resetPending || !execution || execution.id === seenExecution.current) return;
    seenExecution.current = execution.id;
    let targetWorkflow = workflow;
    let targetStep = step;
    if (execution.context) {
      targetWorkflow =
        workflows.find((item) => item.id === execution.context!.workflowId) || workflow;
      targetStep =
        targetWorkflow.steps.find((item) => item.id === execution.context!.stepId) || step;
    } else if (
      step.kind !== 'command' ||
      step.os !== execution.os ||
      ![draft.trim(), resolveCommand(step, state).trim()].includes(execution.command.trim())
    )
      return;
    const attempt: WorkflowAttempt = {
      command: execution.command,
      output: execution.output,
      os: execution.os,
      startedAt: execution.at,
      ...comparisonFor(targetWorkflow.id),
    };
    record(targetWorkflow.id, targetStep.id, {
      feedback: evaluateWorkflowStep(targetStep, state, attempt),
      attempt,
      output: execution.output,
      before: execution.before,
      after: execution.after,
    });
  }, [execution?.id]);
  useEffect(() => {
    if (resetPending || step.kind !== 'wait') return;
    const attempt: WorkflowAttempt = {
      ...result?.attempt,
      startedAt: result?.attempt.startedAt ?? state.clock,
      ...(step.id === RVR_STEP_IDS.waitStartOn ? {} : comparison),
      onRunId: step.id === RVR_STEP_IDS.waitStartOn ? undefined : comparison.onRunId,
      offRunId: step.id === RVR_STEP_IDS.waitStartOn ? undefined : comparison.offRunId,
      runId:
        step.id === RVR_STEP_IDS.waitOn
          ? comparison.onRunId
          : step.id === RVR_STEP_IDS.waitOff
            ? comparison.offRunId
            : result?.attempt.runId,
    };
    const feedback = evaluateWorkflowStep(step, state, attempt);
    if (
      !result ||
      feedback.status !== result.feedback.status ||
      feedback.message !== result.feedback.message
    )
      record(workflow.id, step.id, { ...result, attempt, feedback });
  }, [workflow.id, step.id, state.clock, comparison.onRunId, comparison.offRunId]);

  function select(id: string) {
    setProgress((p) => ({ ...p, selected: id }));
  }
  function move(next: number) {
    setProgress((p) => ({ ...p, active: { ...p.active, [workflow.id]: next } }));
  }
  function dispatch(command: string, os: 'linux' | 'windows', execute: boolean, guided = false) {
    if (!command.trim()) return;
    onCommand(
      command,
      os,
      execute,
      guided ? { workflowId: workflow.id, stepId: step.id } : undefined,
    );
  }
  function act() {
    if (step.kind !== 'action') return;
    const output = onAction(step.action, step.id === RVR_STEP_IDS.restoreOn ? {} : comparison);
    if (step.action === 'setup-rf-fault') {
      setProgress((previous) => ({
        ...previous,
        records: { ...previous.records, [workflow.id]: {}, [RVR_FLOW_ID]: {} },
        active: { ...previous.active, [RVR_FLOW_ID]: 0 },
      }));
    }
    const nextComparison: RvrComparisonContext =
      step.id === RVR_STEP_IDS.restoreOn || step.action === 'rvr-prepare-dl-tcp'
        ? {}
        : { ...comparison };
    if (step.action === 'rvr-start-on' && output.runId) {
      nextComparison.onRunId = output.runId;
      nextComparison.offRunId = undefined;
    }
    if (step.action === 'rvr-start-off' && output.runId) nextComparison.offRunId = output.runId;
    const attempt: WorkflowAttempt = {
      action: step.action,
      startedAt: output.state.clock,
      ...nextComparison,
      runId: output.runId,
      exportReceipt: output.exportReceipt,
      error: output.error,
    };
    const feedback: WorkflowFeedback = output.error
      ? {
          status: 'failure',
          message: output.error,
          evidence: [],
          hint: '先修正提示的條件，再重新執行本步。',
        }
      : evaluateWorkflowStep(step, output.state, attempt);
    if (feedback.status === 'success' && isRvr) {
      const cutoff =
        step.action === 'rvr-prepare-dl-tcp'
          ? 0
          : step.action === 'rvr-start-on'
            ? workflow.steps.findIndex((item) => item.id === RVR_STEP_IDS.startOn)
            : step.action === 'rvr-start-off'
              ? workflow.steps.findIndex((item) => item.id === RVR_STEP_IDS.startOff)
              : -1;
      if (cutoff >= 0)
        setProgress((previous) => ({
          ...previous,
          records: {
            ...previous.records,
            [workflow.id]: Object.fromEntries(
              Object.entries(previous.records[workflow.id] || {}).filter(
                ([id]) => workflow.steps.findIndex((item) => item.id === id) < cutoff,
              ),
            ),
          },
        }));
    }
    record(workflow.id, step.id, {
      attempt,
      feedback,
      output: output.output,
      before: output.before,
      after: output.after,
    });
  }
  const count = workflow.steps.filter(
    (item) => records[item.id]?.feedback.status === 'success',
  ).length;
  const blocked = shellMode === 'wpa';
  return (
    <div className="workflow-body">
      <div className="workflow-tabs">
        <button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}>
          <ListChecks size={15} />
          逐步工作流
        </button>
        <button className={tab === 'commands' ? 'active' : ''} onClick={() => setTab('commands')}>
          <Terminal size={15} />
          常用指令
        </button>
      </div>
      {blocked && (
        <div className="workflow-warning">
          VT 目前在 wpa_cli 互動模式。Linux 指令前請先退出。
          <button onClick={() => dispatch('quit', 'linux', true)}>退出 wpa_cli</button>
        </div>
      )}
      {tab === 'workflow' ? (
        <>
          <label className="workflow-label">
            選擇工作流
            <select
              aria-label="工作流程"
              value={workflow.id}
              onChange={(e) => select(e.target.value)}
            >
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <p className="workflow-description">{workflow.description}</p>
          {isRvr && (
            <div className="workflow-rvr-summary" data-testid="rvr-live-data">
              <div className="section-label">
                本次比較 <span>AP TxBF · TCP DOWNLINK</span>
              </div>
              {[
                { bf: 'ON', run: onRun },
                { bf: 'OFF', run: offRun },
              ].map(({ bf, run }) => (
                <div
                  className={`rvr-run-row ${bf.toLowerCase()}`}
                  key={bf}
                  data-bf={bf}
                  data-runid={run?.id || ''}
                  data-status={run?.status || 'idle'}
                  data-points={run?.points.length || 0}
                >
                  <b>BF {bf}</b>
                  <span>{run ? `${run.id} · ${run.status}` : '尚未開始'}</span>
                  <strong>{run?.points.length || 0} 點</strong>
                </div>
              ))}
              <p>
                {state.msp.settings.start}–{state.msp.settings.end} dB ·{' '}
                {state.msp.settings.duration} 秒／點 · P={state.msp.settings.streams} · Seed{' '}
                {state.msp.settings.seed}
              </p>
              <div className="rvr-setting-actions">
                <button onClick={onOpenMsp}>MSP 量測參數</button>
                {onRun && (
                  <button
                    disabled={state.msp.status === 'running'}
                    onClick={() => onSettings({ ...onRun.settings })}
                  >
                    套用 ON 的量測參數
                  </button>
                )}
              </div>
              {paramsDiffer && (
                <p className="rvr-difference" data-testid="rvr-parameters-differ">
                  目前量測參數與 ON 不同；開始 OFF 前需恢復一致。
                </p>
              )}
              {onRun && offRun && (
                <p
                  className={pairCheck?.valid ? 'rvr-pair-valid' : 'rvr-difference'}
                  data-testid="rvr-pair-validation"
                  data-valid={pairCheck?.valid ? 'true' : 'false'}
                >
                  {pairCheck?.message}
                </p>
              )}
            </div>
          )}
          <div className="workflow-progress">
            <span>
              完成記錄 {count} / {workflow.steps.length}
            </span>
            <button
              aria-label="重新練習此工作流"
              title="只清除本工作流進度，保留實驗室狀態"
              onClick={() =>
                setProgress((p) => ({
                  ...p,
                  active: { ...p.active, [workflow.id]: 0 },
                  records: { ...p.records, [workflow.id]: {} },
                }))
              }
            >
              <RotateCcw size={13} />
              重練
            </button>
          </div>
          <div className="workflow-progress-track">
            <i style={{ width: `${(count / workflow.steps.length) * 100}%` }} />
          </div>
          <ol className="workflow-steps">
            {workflow.steps.map((item, i) => {
              const status = records[item.id]?.feedback.status || 'ready';
              return (
                <li key={item.id}>
                  <button
                    className={`${i === index ? 'current' : ''} ${status}`}
                    aria-current={i === index ? 'step' : undefined}
                    data-testid={`workflow-step-${item.id}`}
                    data-status={status}
                    onClick={() => move(i)}
                  >
                    <span className="workflow-step-number">
                      {status === 'success' ? <Check size={12} /> : i + 1}
                    </span>
                    <span>{item.title}</span>
                    {status === 'waiting' && <Clock3 size={12} />}
                  </button>
                </li>
              );
            })}
          </ol>
          <article className="workflow-current" data-testid="workflow-current" ref={currentView}>
            <div className="section-label">
              STEP {index + 1}{' '}
              <span>
                {step.kind === 'command'
                  ? step.os === 'linux'
                    ? 'TERA TERM VT'
                    : 'WINDOWS CMD'
                  : step.kind === 'wait'
                    ? '觀察狀態'
                    : '儀器操作'}
              </span>
            </div>
            <h2>{step.title}</h2>
            <p>{step.explanation}</p>
            <div className="workflow-observe">
              <b>觀察重點</b>
              <p>{step.observe}</p>
            </div>
            {isRvr &&
              (step.kind === 'wait' ||
                step.id === RVR_STEP_IDS.compare ||
                (step.kind === 'action' && step.action.startsWith('rvr-export-'))) &&
              (onRun || offRun) && (
                <div className="workflow-rvr-chart">
                  <small>本工作流的實際量測點 · ON 藍／OFF 紅</small>
                  {renderComparisonChart(comparison)}
                </div>
              )}
            {step.kind === 'command' && (
              <>
                <textarea
                  aria-label="工作流指令"
                  value={draft}
                  rows={Math.min(5, Math.max(2, draft.split('\n').length))}
                  spellCheck={false}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="workflow-refresh-command"
                  aria-label="依目前狀態更新指令"
                  onClick={() => setDraft(resolveCommand(step, state))}
                >
                  <RotateCcw size={12} />
                  依目前狀態更新指令
                </button>
                <div className="workflow-command-actions">
                  <button
                    disabled={!draft.trim()}
                    onClick={() => dispatch(draft, step.os, false, true)}
                  >
                    <Send size={13} />
                    送入 {step.os === 'linux' ? 'VT' : 'CMD'}
                  </button>
                  <button
                    className="primary"
                    disabled={!draft.trim() || (step.os === 'linux' && blocked)}
                    onClick={() => dispatch(draft, step.os, true, true)}
                  >
                    <Play size={13} />
                    執行本步
                  </button>
                </div>
                <small>送入只填寫終端；可修改後按 Enter。執行本步會立即執行。</small>
                {step.skipWhenSatisfied && (
                  <button
                    className="workflow-check-current"
                    onClick={() => {
                      const feedback = evaluateWorkflowStep(step, state);
                      record(workflow.id, step.id, {
                        feedback,
                        attempt: { startedAt: state.clock },
                        output:
                          feedback.status === 'success'
                            ? '本步未重新執行指令；目前共享狀態已符合 5 GHz 遷移條件。'
                            : undefined,
                      });
                    }}
                  >
                    檢查目前狀態（已符合可跳過）
                  </button>
                )}
              </>
            )}
            {step.kind === 'action' && step.action === 'setup-rf-fault' && (
              <p className="workflow-warning">
                載入會建立 5 GHz 練習環境並清除目前量測結果。可先儲存快照。
              </p>
            )}
            {step.kind === 'action' && (
              <button className="primary workflow-action" onClick={act}>
                <Play size={13} />
                執行本步操作
              </button>
            )}
            {step.kind === 'wait' && (
              <div className="workflow-live">
                <Clock3 size={15} />
                <span>
                  即時觀察：STA {state.sta.status} · {state.attenuation.db} dB
                </span>
              </div>
            )}
            <div className="workflow-expected">
              <b>預期結果</b>
              <p>{step.expected}</p>
            </div>
            {result && (
              <div
                className={`workflow-feedback ${result.feedback.status}`}
                data-testid="workflow-feedback"
                data-status={result.feedback.status}
                aria-live="polite"
              >
                <strong>
                  {result.feedback.status === 'success'
                    ? '✓ 已驗證'
                    : result.feedback.status === 'waiting'
                      ? isRvr
                        ? '◷ 量測／連線進行中'
                        : '◷ 等待狀態恢復'
                      : result.feedback.status === 'failure'
                        ? '需要再檢查'
                        : '準備執行'}
                </strong>
                <p>{result.feedback.message}</p>
                {result.attempt.exportReceipt && (
                  <p className="workflow-export-receipt" data-testid="rvr-export-receipt">
                    下載已產生：{result.attempt.exportReceipt.filename} ·{' '}
                    {result.attempt.exportReceipt.pointCount} 點 ·{' '}
                    {result.attempt.exportReceipt.bytes.toLocaleString()} bytes
                  </p>
                )}
                {result.feedback.hint && <p className="workflow-hint">{result.feedback.hint}</p>}
                {result.before && result.after && (
                  <div className="workflow-deltas">
                    {(Object.keys(labels) as (keyof LabObservation)[])
                      .filter((key) => result.before![key] !== result.after![key])
                      .map((key) => (
                        <span key={key}>
                          {labels[key]}：{result.before![key]} → {result.after![key]}
                        </span>
                      ))}
                    {JSON.stringify(result.before) === JSON.stringify(result.after) && (
                      <span>此觀察摘要沒有變動。</span>
                    )}
                  </div>
                )}
                {result.output !== undefined && (
                  <pre className="workflow-output">
                    {result.attempt.command && `實際執行：${result.attempt.command}\n\n`}
                    {result.output || '（指令沒有標準輸出；驗證以共享狀態為準。）'}
                  </pre>
                )}
              </div>
            )}
            <div className="workflow-navigation" ref={navigationView}>
              <button disabled={index === 0} onClick={() => move(index - 1)}>
                上一步
              </button>
              <button
                disabled={
                  result?.feedback.status !== 'success' || index === workflow.steps.length - 1
                }
                onClick={() => move(index + 1)}
              >
                下一步
                <ChevronRight size={14} />
              </button>
            </div>
            {count === workflow.steps.length && (
              <p className="workflow-complete">
                本工作流已完成。可回看每一步的指令、輸出與驗證結果。
              </p>
            )}
          </article>
        </>
      ) : (
        <>
          <label className="workflow-label">
            指令分類
            <select
              aria-label="指令分類"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                const first = commandShortcuts.find(
                  (item) => e.target.value === 'all' || item.os === e.target.value,
                );
                if (first) setShortcutId(first.id);
              }}
            >
              <option value="all">全部工具</option>
              <option value="linux">Tera Term VT</option>
              <option value="windows">Windows CMD</option>
            </select>
          </label>
          <label className="workflow-label">
            選擇指令
            <select
              aria-label="常用指令"
              value={shortcut.id}
              onChange={(e) => setShortcutId(e.target.value)}
            >
              {commandShortcuts
                .filter((item) => filter === 'all' || item.os === filter)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          <div className="workflow-current">
            <div className="section-label">
              COMMAND PICKER <span>{shortcut.os === 'linux' ? 'TERA TERM VT' : 'WINDOWS CMD'}</span>
            </div>
            <p>{shortcut.description}</p>
            <textarea
              aria-label="常用指令內容"
              value={commandDraft}
              rows={3}
              spellCheck={false}
              onChange={(e) => setCommandDraft(e.target.value)}
            />
            <button
              className="workflow-refresh-command"
              aria-label="依目前狀態更新指令"
              onClick={() => setCommandDraft(resolveCommand(shortcut, state))}
            >
              <RotateCcw size={12} />
              依目前狀態更新指令
            </button>
            <div className="workflow-command-actions">
              <button
                disabled={!commandDraft.trim()}
                onClick={() => dispatch(commandDraft, shortcut.os, false)}
              >
                <Send size={13} />
                送入 {shortcut.os === 'linux' ? 'VT' : 'CMD'}
              </button>
              <button
                className="primary"
                disabled={!commandDraft.trim() || (shortcut.os === 'linux' && blocked)}
                onClick={() => dispatch(commandDraft, shortcut.os, true)}
              >
                <Play size={13} />
                執行選定指令
              </button>
            </div>
            <div className="workflow-expected">
              <b>觀察重點</b>
              <p>{shortcut.expected}</p>
            </div>
            <small>
              指令會依目前 Radio／Server IP 產生。切換設備設定後，可按更新按鈕重新產生內容。
            </small>
            {execution && (
              <div className="workflow-feedback ready" aria-live="polite">
                <strong>最近的終端執行 · {execution.os === 'linux' ? 'VT' : 'CMD'}</strong>
                <pre className="workflow-output">
                  {execution.command}
                  {'\n'}
                  {execution.output || '（無標準輸出）'}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
      <p className="workflow-footer">
        選工作流不會重置實驗室。完成記錄保存過去的驗證；目前連線以工具即時狀態為準。
        {storageError && ' 瀏覽器無法保存工作流進度。'}
      </p>
    </div>
  );
}
