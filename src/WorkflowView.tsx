import { useEffect, useRef, useState } from 'react';
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
import type { LabState } from './engine/lab';
import {
  commandShortcuts,
  workflows,
  resolveCommand,
  evaluateWorkflowStep,
} from './engine/workflow';
import type { WorkflowActionId, WorkflowAttempt, WorkflowFeedback } from './engine/workflow';

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
  onAction: (action: WorkflowActionId) => ActionExecution;
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
  const navigationView = useRef<HTMLDivElement>(null);
  const currentView = useRef<HTMLElement>(null);
  const previousStep = useRef({ workflowId: '', stepId: '' });
  const workflow = workflows.find((item) => item.id === progress.selected) || workflows[0];
  const index = progress.active[workflow.id] || 0;
  const step = workflow.steps[index];
  const records = progress.records[workflow.id] || {};
  const result = records[step.id];
  useEffect(() => {
    if (previousStep.current.workflowId === workflow.id && previousStep.current.stepId !== step.id)
      currentView.current?.scrollIntoView({ block: 'start' });
    previousStep.current = { workflowId: workflow.id, stepId: step.id };
  }, [workflow.id, step.id]);
  useEffect(() => {
    if (result) navigationView.current?.scrollIntoView({ block: 'nearest' });
  }, [result]);
  const shortcut = commandShortcuts.find((item) => item.id === shortcutId) || commandShortcuts[0];

  function record(workflowId: string, stepId: string, value: StepRecord) {
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
    setProgress(fresh());
  }, [resetKey]);
  useEffect(() => {
    setDraft(step.kind === 'command' ? resolveCommand(step, state) : '');
  }, [workflow.id, step.id]);
  useEffect(() => {
    setCommandDraft(resolveCommand(shortcut, state));
  }, [shortcut.id]);
  useEffect(() => {
    if (!execution || execution.id === seenExecution.current) return;
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
    if (step.kind !== 'wait') return;
    const attempt = result?.attempt || { startedAt: state.clock };
    const feedback = evaluateWorkflowStep(step, state, attempt);
    if (
      !result ||
      feedback.status !== result.feedback.status ||
      feedback.message !== result.feedback.message
    )
      record(workflow.id, step.id, { attempt, feedback });
  }, [workflow.id, step.id, state.clock]);

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
    const output = onAction(step.action);
    if (step.action === 'setup-rf-fault') {
      setProgress((previous) => ({
        ...previous,
        records: { ...previous.records, [workflow.id]: {} },
      }));
    }
    const attempt: WorkflowAttempt = { action: step.action, startedAt: output.state.clock };
    record(workflow.id, step.id, {
      attempt,
      feedback: evaluateWorkflowStep(step, output.state, attempt),
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
                      ? '◷ 等待狀態恢復'
                      : result.feedback.status === 'failure'
                        ? '需要再檢查'
                        : '準備執行'}
                </strong>
                <p>{result.feedback.message}</p>
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
