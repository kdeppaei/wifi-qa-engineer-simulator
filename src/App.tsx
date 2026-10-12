import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ReactNode, Ref, PointerEvent as ReactPointerEvent } from 'react';
import {
  Monitor,
  Terminal,
  Radio,
  Activity,
  Settings2,
  Network,
  BookOpen,
  FileCode2,
  Download,
  RotateCcw,
  ChevronRight,
  Play,
  Square,
  Minus,
  Maximize2,
  X,
  ShieldCheck,
  Wifi,
  WifiOff,
  Zap,
  Save,
  FolderOpen,
  Sun,
  Moon,
  PanelLeftClose,
  Check,
  HelpCircle,
  FlaskConical,
  Cable,
  Server,
  ChevronDown,
  ListChecks,
} from 'lucide-react';
import { LabEngine, radioForBand } from './engine/lab';
import type { LabState, Band, TestSettings } from './engine/lab';
import { TerminalSession, supportedCommands, windowsCommands } from './engine/terminal';
import { exportCsv, exportXlsx, exportReport } from './engine/export';
import { observeCommand, assessChapter } from './engine/scenario';
import { parseSnapshot } from './engine/storage';
import WorkflowView, { observeLab } from './WorkflowView';
import type { CommandContext, CommandExecution, ActionExecution } from './WorkflowView';
import type { WorkflowActionId } from './engine/workflow';
import {
  selectRvrPairState,
  validateRvrOnPreflight,
  validateRvrOffPreflight,
  validateRvrPair,
} from './engine/rvrWorkflow';
import type { RvrComparisonContext, RvrExportReceipt } from './engine/rvrWorkflow';

const STORAGE = 'wifi-qa-lab-v1';
type Tool =
  | 'tera'
  | 'cmd'
  | 'att'
  | 'msp'
  | 'ap'
  | 'topology'
  | 'learning'
  | 'script'
  | 'report'
  | 'workflow';
function loadSaved() {
  try {
    return parseSnapshot(JSON.parse(localStorage.getItem(STORAGE) || 'null'));
  } catch {
    return undefined;
  }
}
const saved = loadSaved();
const engine = new LabEngine(saved?.lab);
let linux = new TerminalSession(engine, 'linux', saved?.linux);
let windows = new TerminalSession(engine, 'windows', saved?.windows);
const names: Record<Tool, string> = {
  tera: 'COM23 · Tera Term VT',
  cmd: 'Windows CMD',
  att: 'Virtual Attenuator',
  msp: 'MSP RvR Tool',
  ap: 'AP Configuration',
  topology: 'Network Topology',
  learning: 'Learning Center',
  script: 'Script Editor',
  report: 'Result Analyzer',
  workflow: '指令工作流',
};
const icons: Record<Tool, typeof Monitor> = {
  tera: Terminal,
  cmd: Terminal,
  att: Radio,
  msp: Activity,
  ap: Settings2,
  topology: Network,
  learning: BookOpen,
  script: FileCode2,
  report: Download,
  workflow: ListChecks,
};
const scenarios = [
  ['自由實驗', '觀察不同工具如何共同反映設備狀態。'],
  ['第一次進入實驗室', '找出 DUT IP，確認關聯並 Ping 有線 Server。'],
  ['Linux 基礎訓練', '建立檔案並使用 Pipe 過濾內容。'],
  ['UCI 設定生命週期', '修改 BF，提交、重新啟動，驗證 Runtime。'],
  ['建立 APCLI', '檢查 Radio、SSID、加密與 STA 連線。'],
  ['從 6G 改測 5G', '遷移 APCLI 到 5 GHz，完成 BF ON/OFF DL RvR。'],
  ['iperf3 與方向', '由 DUT 對有線 Server 執行 UL 與 -R DL。'],
  ['第一次 BF ON RvR', '確認 AP TxBF ON，完成 5 GHz DL Sweep。'],
  ['切換 BF OFF', '保留 ON 資料，修改發送端 BF 並完成 OFF Sweep。'],
  ['Reboot 後 Not Connected', '設定已保存，但重新啟動後無法連線。先收集證據，再排查環境。'],
  ['MSP 自動化異常', 'MSP 出現 Invocation Exception。保留 Log，檢查 InnerException 與 Server。'],
];
const sampleScript =
  "# 6 GHz → 5 GHz APCLI\nuci get wireless.stamld0.device\nuci set wireless.stamld0.ssid='BN68'\nuci -q delete wireless.stamld0.device\nuci add_list wireless.stamld0.device='MT7999_1_2'\nuci commit wireless\nsync\nwifi restart";
function format(n: number) {
  return Math.round(n).toLocaleString();
}
function download(name: string, data: string | Uint8Array, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob.size;
}

function Panel({
  tool,
  children,
  onClose,
  onMin,
  onFocus,
  focused,
  extra = false,
}: {
  tool: Tool;
  children: ReactNode;
  onClose: () => void;
  onMin: () => void;
  onFocus: () => void;
  focused: boolean;
  extra?: boolean;
}) {
  const [max, setMax] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = icons[tool];
  function down(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest('button') || max) return;
    const r = ref.current!.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, px: r.x, py: r.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent) {
    if (!drag.current) return;
    const d = drag.current;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5)
      setPos({
        x: Math.max(64, Math.min(window.innerWidth - 200, d.px + e.clientX - d.x)),
        y: Math.max(55, Math.min(window.innerHeight - 110, d.py + e.clientY - d.y)),
      });
  }
  const floating = !!pos || extra;
  return (
    <section
      ref={ref}
      className={`panel panel-${tool} ${max ? 'maximized' : ''} ${floating ? 'floating' : ''} ${focused ? 'focused' : ''}`}
      style={
        !max && pos
          ? { left: pos.x, top: pos.y, zIndex: focused ? 60 : 40 }
          : floating && !max
            ? { zIndex: focused ? 60 : 40 }
            : undefined
      }
      onPointerDown={onFocus}
    >
      <header
        className="window-title"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setMax(!max)}
      >
        <div>
          <Icon size={15} />
          <span>{names[tool]}</span>
          {tool === 'tera' && <span className="tiny-tag">SERIAL</span>}
          {tool === 'msp' && <span className="tiny-tag">SIMULATED</span>}
        </div>
        <div className="window-actions">
          <button aria-label={`最小化 ${names[tool]}`} onClick={onMin}>
            <Minus size={13} />
          </button>
          <button aria-label={`最大化 ${names[tool]}`} onClick={() => setMax(!max)}>
            <Maximize2 size={12} />
          </button>
          <button aria-label={`關閉 ${names[tool]}`} onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </header>
      <div className="window-content">{children}</div>
    </section>
  );
}

interface TerminalController {
  insert: (value: string, context?: CommandContext) => void;
  execute: (value: string, context?: CommandContext) => void;
}
let commandSequence = 0;
function TerminalView({
  session,
  refresh,
  onEvidence,
  live,
  controller,
  onExecution,
}: {
  session: TerminalSession;
  refresh: () => void;
  onEvidence: (s: string, output: string, os: 'linux' | 'windows') => void;
  live?: LabState['logs'];
  controller: Ref<TerminalController>;
  onExecution: (result: CommandExecution) => void;
}) {
  const [entries, setEntries] = useState<{ command?: string; output: string }[]>(() => [
    {
      output:
        session === linux
          ? 'OpenWrt · MediaTek MT7999 / APCLI\nVirtual serial console ready. Type help for commands.'
          : 'Microsoft Windows [Virtual QA Workstation]\nType help for available commands.',
    },
  ]);
  const [input, setInput] = useState('');
  const [index, setIndex] = useState(-1);
  const [serialPaused, setSerialPaused] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(engine.state.logs.at(-1)?.id);
  const insertedContext = useRef<CommandContext | undefined>(undefined);
  const prompt =
    session === linux
      ? session.mode === 'wpa'
        ? '>'
        : `root@OpenWrt:${session.cwd === '/root' ? '~' : session.cwd}#`
      : `${session.cwd.replaceAll('/', '\\')}>`;
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [entries]);
  useEffect(() => {
    if (!live?.length) return;
    if (
      Number(live.at(-1)!.id.replace('log-', '')) <
      Number((seen.current || 'log-0').replace('log-', ''))
    )
      seen.current = 'log-0';
    const recent = live.filter(
      (l) =>
        Number(l.id.replace('log-', '')) > Number((seen.current || 'log-0').replace('log-', '')) &&
        ['wpa_supplicant', 'DUT', 'Wi-Fi', 'UCI', 'Driver'].some((s) =>
          l.source.toLowerCase().includes(s.toLowerCase()),
        ),
    );
    seen.current = live.at(-1)?.id;
    if (recent.length && !serialPaused)
      setEntries((e) => [
        ...e.slice(-160),
        { output: recent.map((l) => `[${l.time}] ${l.source}: ${l.message}`).join('\n') },
      ]);
  }, [live?.at(-1)?.id]);
  function submit(value = input, context?: CommandContext) {
    if (!value.trim()) return;
    follow.current = true;
    const before = observeLab(engine.state);
    const at = engine.state.clock;
    const output = session.execute(value);
    onEvidence(value, output, session.os);
    onExecution({
      id: ++commandSequence,
      command: value,
      output,
      os: session.os,
      at,
      before,
      after: observeLab(engine.state),
      context,
    });
    if (session.clearRequested) setEntries([]);
    else setEntries((e) => [...e.slice(-160), { command: `${prompt} ${value}`, output }]);
    setInput('');
    setIndex(-1);
    insertedContext.current = undefined;
    refresh();
  }
  useImperativeHandle(controller, () => ({
    insert: (value, context) => {
      setInput(value);
      insertedContext.current = context;
      field.current?.focus();
    },
    execute: (value, context) => submit(value, context),
  }));
  return (
    <div
      className={`terminal ${session === linux ? 'linux' : 'windows'}`}
      onClick={() => field.current?.focus()}
    >
      <div
        className="terminal-scroll"
        ref={scroll}
        onScroll={() => {
          const node = scroll.current;
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
        }}
      >
        {entries.map((e, i) => (
          <div className="terminal-entry" key={i}>
            {e.command && <pre className="command-line">{e.command}</pre>}
            {e.output && <pre>{e.output}</pre>}
          </div>
        ))}
      </div>
      <div className="terminal-input">
        <span>{prompt}</span>
        <textarea
          ref={field}
          value={input}
          rows={Math.min(5, input.split('\n').length)}
          spellCheck={false}
          aria-label={session === linux ? 'Tera Term command' : 'Windows CMD command'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(input, insertedContext.current);
            }
            if (e.key === 'ArrowUp' && !e.shiftKey) {
              e.preventDefault();
              const i = Math.min(index + 1, session.history.length - 1);
              setIndex(i);
              setInput(session.history[session.history.length - 1 - i] || '');
            }
            if (e.key === 'ArrowDown' && !e.shiftKey) {
              e.preventDefault();
              const i = Math.max(-1, index - 1);
              setIndex(i);
              setInput(i < 0 ? '' : session.history[session.history.length - 1 - i] || '');
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              const options = session === linux ? supportedCommands : windowsCommands;
              const hits = options.filter((c) => c.startsWith(input));
              if (hits.length === 1) setInput(hits[0] + ' ');
              else if (hits.length) setEntries((es) => [...es, { output: hits.join('  ') }]);
            }
            if (e.ctrlKey && e.key === 'c') {
              e.preventDefault();
              setInput('');
              insertedContext.current = undefined;
              session.mode = 'shell';
              setEntries((es) => [...es, { output: '^C' }]);
              refresh();
            }
          }}
        />
        <button
          title="執行指令"
          aria-label="執行指令"
          onClick={() => submit(input, insertedContext.current)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="terminal-foot">
        <span className="led green" />
        {session === linux ? '115200 baud · Serial 控制通道' : 'QA Workstation · Ethernet'}
        {session === linux && (
          <button
            type="button"
            aria-pressed={serialPaused}
            onClick={(event) => {
              event.stopPropagation();
              setSerialPaused((paused) => !paused);
            }}
          >
            {serialPaused ? '繼續 Serial 訊息' : '暫停 Serial 訊息'}
          </button>
        )}
        <span>{serialPaused ? '僅暫停顯示，Log 持續保存' : 'Enter 執行 · Shift+Enter 多行'}</span>
      </div>
    </div>
  );
}

function Chart({ state }: { state: LabState }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const runs = state.msp.runs;
  const max = Math.max(1000, ...runs.flatMap((r) => r.points.map((p) => p.throughput)));
  const ymax = Math.ceil(max / 500) * 500;
  const w = 660,
    h = 215;
  const x = (db: number) => 52 + (db / 90) * 590;
  const y = (v: number) => 170 - (v / ymax) * 145;
  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="RvR measured simulation throughput versus attenuation chart"
      >
        <defs>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#65a8ff" stopOpacity=".16" />
            <stop offset="100%" stopColor="#65a8ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="52"
              x2="642"
              y1={y((ymax * i) / 3)}
              y2={y((ymax * i) / 3)}
              className="chart-grid"
            />
            <text x="42" y={y((ymax * i) / 3) + 4} textAnchor="end">
              {format((ymax * i) / 3)}
            </text>
          </g>
        ))}
        {[0, 15, 30, 45, 60, 75, 90].map((db) => (
          <g key={db}>
            <line x1={x(db)} x2={x(db)} y1="25" y2="170" className="chart-grid vertical" />
            <text x={x(db)} y="188" textAnchor="middle">
              {db}
            </text>
          </g>
        ))}
        <text x="52" y="13">
          Throughput (Mbps)
        </text>
        <text x="642" y="209" textAnchor="end">
          Attenuation (dB)
        </text>
        {runs.map((r, i) => {
          const points = r.points.map((p) => `${x(p.attenuation)},${y(p.throughput)}`).join(' ');
          return (
            <g key={r.id}>
              {r.points.length > 1 && i === runs.length - 1 && (
                <polygon
                  points={`${x(r.points[0].attenuation)},170 ${points} ${x(r.points.at(-1)!.attenuation)},170`}
                  fill="url(#curve-fill)"
                />
              )}
              <polyline
                points={points}
                fill="none"
                stroke={r.bf ? '#6ba9ff' : '#ff818c'}
                strokeWidth="2.8"
                strokeLinejoin="round"
              />
              {r.points.map((p, j) => (
                <circle
                  key={j}
                  cx={x(p.attenuation)}
                  cy={y(p.throughput)}
                  r="3.3"
                  fill={r.bf ? '#6ba9ff' : '#ff818c'}
                  onMouseEnter={() =>
                    setHover({
                      x: x(p.attenuation),
                      y: y(p.throughput),
                      text: `${r.label}: ${p.attenuation} dB · ${format(p.throughput)} Mbps`,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </g>
          );
        })}
        {!runs.some((r) => r.points.length) && (
          <g>
            <text className="chart-empty" x="345" y="94" textAnchor="middle">
              等待第一個量測點
            </text>
            <text x="345" y="116" textAnchor="middle">
              啟動測試後，曲線將依衰減逐點生成
            </text>
          </g>
        )}
        {hover && (
          <g>
            <rect
              x={Math.max(52, Math.min(hover.x - 100, 420))}
              y={Math.max(25, hover.y - 35)}
              width="220"
              height="26"
              rx="5"
              fill="#182638"
            />
            <text
              fill="#fff"
              x={Math.max(62, Math.min(hover.x - 90, 430))}
              y={Math.max(42, hover.y - 18)}
            >
              {hover.text}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<LabState>({ ...engine.state });
  const [opened, setOpened] = useState<Tool[]>(['tera', 'cmd', 'att', 'msp']);
  const [minimized, setMinimized] = useState<Tool[]>([]);
  const [focus, setFocus] = useState<Tool>('tera');
  const [chapter, setChapter] = useState(saved?.chapter ?? 0);
  const [mode, setMode] = useState('Guided');
  const [evidence, setEvidence] = useState<string[]>(saved?.evidence ?? []);
  const [hint, setHint] = useState(0);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState('dark');
  const [script, setScript] = useState(sampleScript);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [startMenu, setStartMenu] = useState(false);
  const [execution, setExecution] = useState<CommandExecution | null>(null);
  const [workflowResetKey, setWorkflowResetKey] = useState(0);
  const teraController = useRef<TerminalController>(null);
  const cmdController = useRef<TerminalController>(null);
  const [pendingCommand, setPendingCommand] = useState<{
    command: string;
    os: 'linux' | 'windows';
    execute: boolean;
    context?: CommandContext;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refs = useRef({ chapter, evidence });
  refs.current = { chapter, evidence };
  function save() {
    const data = {
      version: 1,
      lab: engine.state,
      linux: linux.snapshot(),
      windows: windows.snapshot(),
      chapter: refs.current.chapter,
      evidence: refs.current.evidence,
    };
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
    } catch {
      setToast('瀏覽器儲存空間不足，請下載快照。');
    }
  }
  function refresh() {
    setState({ ...engine.state });
    save();
  }
  function act(fn: () => void) {
    fn();
    refresh();
  }
  function notify(s: string) {
    setToast(s);
  }
  useEffect(() => {
    const timer = setInterval(() => {
      engine.tick(1);
      setState({ ...engine.state });
      save();
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    save();
  }, [chapter, evidence]);
  function open(tool: Tool) {
    if (!opened.includes(tool)) setOpened([...opened, tool]);
    setMinimized(minimized.filter((t) => t !== tool));
    setFocus(tool);
    setStartMenu(false);
  }
  function close(tool: Tool) {
    setOpened(opened.filter((t) => t !== tool));
  }
  function record(s: string, output?: string, os?: 'linux' | 'windows') {
    const tags = output !== undefined && os ? observeCommand(s, output, os) : [];
    setEvidence((e) => [...e, `command:${s}`, ...tags.map((tag) => `evidence:${tag}`)].slice(-200));
  }
  function selectedCommand(
    command: string,
    os: 'linux' | 'windows',
    execute: boolean,
    context?: CommandContext,
  ) {
    const tool = os === 'linux' ? 'tera' : 'cmd';
    setOpened((previous) => (previous.includes(tool) ? previous : [...previous, tool]));
    setMinimized((previous) => previous.filter((item) => item !== tool));
    // Keep the guide visible while the real terminal receives the command.
    setFocus('workflow');
    setPendingCommand({ command, os, execute, context });
  }
  useEffect(() => {
    if (!pendingCommand) return;
    const control = pendingCommand.os === 'linux' ? teraController.current : cmdController.current;
    if (!control) return;
    if (pendingCommand.execute) control.execute(pendingCommand.command, pendingCommand.context);
    else {
      control.insert(pendingCommand.command, pendingCommand.context);
      notify(`指令已送入 ${pendingCommand.os === 'linux' ? 'VT' : 'CMD'}，按 Enter 執行。`);
    }
    setPendingCommand(null);
  }, [pendingCommand, opened, minimized]);
  function workflowAction(
    action: WorkflowActionId,
    comparison: RvrComparisonContext = {},
  ): ActionExecution {
    const before = observeLab(engine.state);
    let output = '';
    let runId: string | undefined;
    let exportReceipt: RvrExportReceipt | undefined;
    let error: string | undefined;
    try {
      act(() => {
        switch (action) {
          case 'configure-ap-5g':
            engine.updateAP({ band: '5', ssid: 'BN68', channel: 36 });
            output = 'AP 已設為 5 GHz / BN68 / Channel 36。觀察 STA 是否需要遷移 Radio。';
            break;
          case 'restore-attenuation':
            engine.setAttenuation(engine.state.attenuation.start);
            output = `衰減器已回到 ${engine.state.attenuation.start} dB，觀察掃描與重新關聯。`;
            break;
          case 'set-attenuation-90':
            engine.setAttenuation(90);
            output = '衰減器設為 90 dB，請觀察 STA、MSP 與 Log。';
            break;
          case 'setup-rf-fault':
            engine.reset('5');
            engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
            engine.commit();
            engine.setAttenuation(90);
            engine.restart(true);
            setChapter(9);
            setEvidence([]);
            output = '已載入 Chapter 9 練習環境；原測試結果已清除。先觀察連線與 Log。';
            break;
          case 'ap-bf-on':
            engine.updateAP({ txbf: true });
            output = 'AP TxBF 已開啟，這是 Downlink 的發送端。';
            break;
          case 'ap-bf-off':
            engine.updateAP({ txbf: false });
            output = 'AP TxBF 已關閉，這是 Downlink 的發送端。';
            break;
          case 'rvr-prepare-dl-tcp':
            if (engine.state.msp.status === 'running')
              throw new Error('請先停止目前量測，再準備新的 ON／OFF 比較。');
            Object.assign(engine.state.msp.settings, { direction: 'DL', protocol: 'TCP' });
            engine.log(
              'Workflow',
              'INFO',
              'Prepare BF comparison: DL / TCP; existing sweep parameters and runs preserved.',
            );
            output = `已設定 TCP Downlink。沿用 ${engine.state.msp.settings.start}–${engine.state.msp.settings.end} dB、${engine.state.msp.settings.duration} 秒／點與目前 Seed；舊量測保留。可在 MSP 調整參數後開始 ON。`;
            break;
          case 'rvr-restore-start': {
            if (engine.state.msp.status === 'running')
              throw new Error('Sweep 尚在量測，請等完成或明確 Stop，再恢復起點。');
            const on = engine.state.msp.runs.find((run) => run.id === comparison.onRunId);
            if (comparison.onRunId && !on)
              throw new Error('本工作流的 ON 量測已不存在，請重新開始 ON。');
            const start = on?.settings.start ?? engine.state.msp.settings.start;
            engine.setAttenuation(start);
            output = `衰減器實際 readback 已回到 ${start} dB。${engine.state.sta.status === 'connected' ? '目前仍為 Connected。' : '請觀察掃描與重新關聯。'}MSP 不會自動啟動下一輪。`;
            break;
          }
          case 'rvr-start-on':
          case 'rvr-start-off': {
            const check =
              action === 'rvr-start-on'
                ? validateRvrOnPreflight(engine.state)
                : validateRvrOffPreflight(engine.state, comparison.onRunId);
            if (!check.valid)
              throw new Error(`${check.message}${check.hint ? `\n${check.hint}` : ''}`);
            const previousId = engine.state.msp.activeRunId;
            output = engine.startTest();
            if (
              engine.state.msp.status !== 'running' ||
              !engine.state.msp.activeRunId ||
              engine.state.msp.activeRunId === previousId
            )
              throw new Error(output);
            runId = engine.state.msp.activeRunId;
            output += `\n本次量測編號：${runId}。量測會依模擬時鐘逐點進行，請到下一步觀察完成狀態。`;
            break;
          }
          case 'rvr-verify-pair': {
            const check = validateRvrPair(engine.state, comparison.onRunId, comparison.offRunId);
            if (!check.valid)
              throw new Error(`${check.message}${check.hint ? `\n${check.hint}` : ''}`);
            output = `${check.message}\n比較 ${comparison.onRunId}（ON）與 ${comparison.offRunId}（OFF）；使用各輪實際量測點，不補零、不偽造相同衰減格點。`;
            break;
          }
          case 'rvr-export-csv':
          case 'rvr-export-xlsx':
          case 'rvr-export-report':
          case 'rvr-export-log': {
            if (!comparison.onRunId || !comparison.offRunId)
              throw new Error('請先完成並驗證本次 ON／OFF 兩輪量測。');
            const pair = selectRvrPairState(engine.state, comparison.onRunId, comparison.offRunId);
            const [on, off] = pair.msp.runs;
            const kind = action.slice('rvr-export-'.length) as RvrExportReceipt['kind'];
            const filename = `wifi-qa-bf-on-off${kind === 'report' ? '-report.html' : kind === 'log' ? '-test.log' : `.${kind}`}`;
            let data: string | Uint8Array;
            let mime = 'text/plain;charset=utf-8';
            if (kind === 'csv') {
              data = '\uFEFF' + exportCsv(pair);
              mime = 'text/csv;charset=utf-8';
            } else if (kind === 'xlsx') {
              data = exportXlsx(pair);
              mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            } else if (kind === 'report') {
              data = exportReport(pair);
              mime = 'text/html;charset=utf-8';
            } else {
              data = [
                'SIMULATED · Wi-Fi QA BF ON/OFF TCP Downlink comparison',
                `ON=${on.id}; OFF=${off.id}; transmitter=AP; band=${on.metadata.band} GHz`,
                `保留的現場 Log：${on.startedAt}–${off.endedAt} 模擬秒，可能包含同期間其他操作；較早記錄可能已超出保存上限。`,
                JSON.stringify(
                  {
                    on: {
                      id: on.id,
                      settings: on.settings,
                      metadata: on.metadata,
                      points: on.points,
                    },
                    off: {
                      id: off.id,
                      settings: off.settings,
                      metadata: off.metadata,
                      points: off.points,
                    },
                  },
                  null,
                  2,
                ),
                ...pair.logs.map(
                  (entry) => `${entry.time} [${entry.source}] ${entry.level}: ${entry.message}`,
                ),
              ].join('\n');
            }
            const bytes = download(filename, data, mime);
            exportReceipt = {
              kind,
              onRunId: on.id,
              offRunId: off.id,
              pointCount: on.points.length + off.points.length,
              generatedAt: engine.state.clock,
              filename,
              bytes,
            };
            output = `已產生並送出下載：${filename}\n${on.id}（ON）：${on.points.length} 點；${off.id}（OFF）：${off.points.length} 點。\n僅匯出本工作流的有效比較組；${bytes.toLocaleString()} bytes。`;
            engine.log(
              'Workflow',
              'INFO',
              `Export ${filename}: ${on.id} / ${off.id}; ${exportReceipt.pointCount} recorded points; ${bytes} bytes.`,
            );
            break;
          }
        }
      });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      output = error;
      engine.log('Workflow', 'ERROR', error);
      refresh();
    }
    return {
      state: engine.state,
      output,
      before,
      after: observeLab(engine.state),
      runId,
      exportReceipt,
      error,
    };
  }
  function settings(p: Partial<TestSettings>) {
    act(() => {
      Object.assign(engine.state.msp.settings, p);
    });
  }
  const connected = state.sta.status === 'connected';
  const active = state.msp.runs.find((r) => r.id === state.msp.activeRunId);
  const settingsState = state.msp.settings;
  const staSection =
    Object.keys(state.config.runtime)
      .find((k) => k.endsWith('.mode') && state.config.runtime[k] === 'sta')
      ?.slice(0, -5) || 'wireless.stamld0';
  const runtimeRadio = state.config.runtime[`${staSection}.device`] || 'MT7999_1_3';
  const runtimeBF = state.config.runtime[`wireless.${runtimeRadio}.etxbfencond`];
  const changed = Object.keys(state.config.staged).length;
  const applied = Object.keys({ ...state.config.committed, ...state.config.runtime }).filter(
    (k) => state.config.committed[k] !== state.config.runtime[k],
  ).length;
  const readLink = evidence.includes('evidence:link-query');
  const readLog =
    evidence.includes('evidence:log-query') || evidence.includes('evidence:scan-query');
  const completed = assessChapter(chapter, state, evidence);
  function scenario(n: number) {
    setChapter(n);
    setHint(0);
    setEvidence([]);
    act(() => {
      if (n === 5) {
        setWorkflowResetKey((key) => key + 1);
        engine.reset('6');
        engine.updateAP({ band: '5', ssid: 'BN68', channel: 36 });
      }
      if (n === 9) {
        setWorkflowResetKey((key) => key + 1);
        engine.reset('5');
        engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
        engine.commit();
        engine.setAttenuation(90);
        engine.restart(true);
      }
      if (n === 10) {
        setWorkflowResetKey((key) => key + 1);
        engine.reset('5');
        engine.state.network.serverRunning = false;
        engine.log(
          'MSP',
          'error',
          'Exception has been thrown by the target of an invocation. InnerException: iperf3 server connection refused.',
        );
      }
      if (n === 7) {
        setWorkflowResetKey((key) => key + 1);
        engine.reset('5');
      }
      if (n === 8) {
        if (engine.state.ap.band !== '5') {
          setWorkflowResetKey((key) => key + 1);
          engine.reset('5');
        }
        engine.updateAP({ txbf: false });
      }
    });
    open('learning');
  }
  function mspExports(kind: string) {
    if (!state.msp.runs.some((r) => r.points.length)) {
      notify('請先完成至少一個量測點。');
      return;
    }
    if (kind === 'csv')
      download('wifi-qa-rvr.csv', '\uFEFF' + exportCsv(state), 'text/csv;charset=utf-8');
    if (kind === 'xlsx')
      download(
        'wifi-qa-rvr.xlsx',
        exportXlsx(state),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    if (kind === 'report')
      download('wifi-qa-report.html', exportReport(state), 'text/html;charset=utf-8');
  }
  function renderTool(tool: Tool) {
    if (tool === 'tera' || tool === 'cmd')
      return (
        <TerminalView
          session={tool === 'tera' ? linux : windows}
          refresh={refresh}
          onEvidence={record}
          live={tool === 'tera' ? state.logs : undefined}
          controller={tool === 'tera' ? teraController : cmdController}
          onExecution={setExecution}
        />
      );
    if (tool === 'workflow')
      return (
        <WorkflowView
          state={state}
          execution={execution}
          shellMode={linux.mode}
          resetKey={workflowResetKey}
          onCommand={selectedCommand}
          onAction={workflowAction}
          onSettings={settings}
          onOpenMsp={() => {
            setOpened((previous) => (previous.includes('msp') ? previous : [...previous, 'msp']));
            setMinimized((previous) => previous.filter((tool) => tool !== 'msp'));
            setSettingsOpen(true);
          }}
          renderComparisonChart={(comparison) => (
            <Chart
              state={{
                ...state,
                msp: {
                  ...state.msp,
                  runs: [comparison.onRunId, comparison.offRunId].flatMap(
                    (id) => state.msp.runs.find((run) => run.id === id) || [],
                  ),
                },
              }}
            />
          )}
        />
      );
    if (tool === 'att')
      return (
        <div className="att-body">
          <div className="section-label">
            RF PATH CONTROL <span>0–90 dB</span>
          </div>
          <div className="att-main">
            <div>
              <span className="att-number" data-testid="attenuation-value">
                {state.attenuation.db}
              </span>
              <span className="unit">dB</span>
              <p>Attenuation</p>
            </div>
            <div className={`link-badge ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}STA {state.sta.status}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="90"
            step="1"
            value={state.attenuation.db}
            aria-label="Attenuation dB"
            onChange={(e) => act(() => engine.setAttenuation(Number(e.target.value)))}
          />
          <div className="range-ticks">
            <span>0</span>
            <span>15</span>
            <span>30</span>
            <span>45</span>
            <span>60</span>
            <span>75</span>
            <span>90 dB</span>
          </div>
          <div className="att-controls">
            <button onClick={() => act(() => engine.setAttenuation(state.attenuation.db - 5))}>
              −5 dB
            </button>
            <label className="manual-db">
              <input
                type="number"
                min="0"
                max="90"
                value={state.attenuation.db}
                aria-label="Manual attenuation"
                onChange={(e) => act(() => engine.setAttenuation(Number(e.target.value)))}
              />
              <span>dB</span>
            </label>
            <button onClick={() => act(() => engine.setAttenuation(state.attenuation.db + 5))}>
              +5 dB
            </button>
            <button
              className="restore"
              onClick={() => {
                act(() => engine.setAttenuation(state.attenuation.start));
                record('restored attenuation');
              }}
            >
              <RotateCcw size={13} />
              恢復起點
            </button>
          </div>
          <div className="rf-metrics">
            <div>
              <span>RSSI</span>
              <strong>
                {format(state.sta.rssi)}
                <small>dBm</small>
              </strong>
            </div>
            <div>
              <span>SNR</span>
              <strong>
                {format(state.sta.snr)}
                <small>dB</small>
              </strong>
            </div>
            <div>
              <span>MCS / NSS</span>
              <strong>{connected ? `${state.sta.mcs} / ${state.sta.nss}` : '—'}</strong>
            </div>
          </div>
          <div className="rf-caption">
            <span className={`led ${connected ? 'green' : 'amber'}`} />
            {state.sta.reason || 'RF path ready. Link metrics update in real time.'}
          </div>
          <p className="subtle-note">0 dB 是衰減器設定值，不代表 RF 路徑零損耗。</p>
        </div>
      );
    if (tool === 'msp')
      return (
        <div className="msp-body">
          <div className="msp-config">
            <label>
              Traffic
              <select
                aria-label="Traffic direction"
                value={settingsState.direction}
                onChange={(e) => settings({ direction: e.target.value as 'DL' | 'UL' })}
              >
                <option value="DL">TCP / UDP Downlink</option>
                <option value="UL">TCP / UDP Uplink</option>
              </select>
            </label>
            <label>
              Protocol
              <select
                value={settingsState.protocol}
                onChange={(e) => settings({ protocol: e.target.value as 'TCP' | 'UDP' })}
              >
                <option>TCP</option>
                <option>UDP</option>
              </select>
            </label>
            <div
              className={`bf-badge ${(settingsState.direction === 'DL' ? state.ap.txbf : runtimeBF === '3') ? 'on' : 'off'}`}
            >
              <span className="led blue" />
              {(settingsState.direction === 'DL' ? state.ap.txbf : runtimeBF === '3')
                ? 'BF ON'
                : 'BF OFF'}
              <small>{settingsState.direction === 'DL' ? 'AP Tx' : 'STA Tx'}</small>
            </div>
            <button
              title="測試參數"
              aria-label="測試參數"
              className="icon-button"
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              <Settings2 size={15} />
            </button>
          </div>
          {settingsOpen && (
            <div className="sweep-settings">
              {(
                [
                  'start',
                  'end',
                  'step',
                  'lowStep',
                  'threshold',
                  'duration',
                  'streams',
                  'port',
                  'seed',
                ] as const
              ).map((k) => (
                <label key={k}>
                  {
                    {
                      start: 'Start dB',
                      end: 'End dB',
                      step: 'Step dB',
                      lowStep: 'Low step dB',
                      threshold: 'Low threshold Mbps',
                      duration: 'Seconds / point',
                      streams: 'Streams',
                      port: 'Port',
                      seed: 'Seed',
                    }[k]
                  }
                  <input
                    type="number"
                    aria-label={k}
                    value={settingsState[k]}
                    onChange={(e) => settings({ [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <label>
                Server IP
                <input
                  aria-label="MSP Server IP"
                  value={settingsState.serverIp}
                  onChange={(e) => settings({ serverIp: e.target.value })}
                />
              </label>
            </div>
          )}
          <Chart state={state} />
          <div className="chart-legend">
            <span>
              <i className="blue-dot" />
              BF ON
            </span>
            <span>
              <i className="red-dot" />
              BF OFF
            </span>
            <span className="legend-meta">
              Seed {settingsState.seed} · {state.ap.band} GHz · 模擬資料
            </span>
          </div>
          <div className="test-status">
            <span className={`led ${state.msp.status === 'running' ? 'green' : 'amber'}`} />
            <span>
              {state.msp.status === 'running'
                ? `Running · ATT ${state.attenuation.db} dB · ${active?.points.length || 0} points`
                : state.msp.status === 'interrupted'
                  ? 'Interrupted · 請檢查 Log 與鏈路狀態'
                  : state.msp.status === 'completed'
                    ? 'Completed · 結果已保留'
                    : 'Ready · 等待開始測試'}
            </span>
            <span>
              {active?.points.at(-1)
                ? `${format(active.points.at(-1)!.throughput)} Mbps`
                : '— Mbps'}
            </span>
          </div>
          <div className="msp-actions">
            <button
              className="primary"
              disabled={state.msp.status === 'running'}
              onClick={() =>
                act(() => {
                  const result = engine.startTest();
                  notify(result || '測試已啟動');
                  record('start MSP');
                })
              }
            >
              <Play size={13} />
              Start Test
            </button>
            <button
              disabled={state.msp.status !== 'running'}
              onClick={() => act(() => engine.stopTest())}
            >
              <Square size={12} />
              Stop
            </button>
            <div className="export-group">
              <button onClick={() => mspExports('csv')}>CSV</button>
              <button onClick={() => mspExports('xlsx')}>
                <Download size={13} />
                Excel
              </button>
            </div>
          </div>
          <div className="msp-log" aria-label="MSP live log">
            {state.logs
              .filter(
                (l) =>
                  l.source.toLowerCase().includes('msp') ||
                  l.source.toLowerCase().includes('iperf'),
              )
              .slice(-2)
              .map((l) => (
                <div key={l.id} className={l.level.toLowerCase() === 'error' ? 'error' : ''}>
                  <time>{l.time}</time> {l.message}
                </div>
              ))}
          </div>
        </div>
      );
    if (tool === 'ap')
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <Radio size={25} />
            <div>
              <h2>TP-Link Virtual AP</h2>
              <p>Wi-Fi 發送端 · 變更即時影響鏈路</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Power
              <select
                value={String(state.ap.power)}
                onChange={(e) => act(() => engine.updateAP({ power: e.target.value === 'true' }))}
              >
                <option value="true">ON</option>
                <option value="false">OFF</option>
              </select>
            </label>
            <label>
              Band
              <select
                value={state.ap.band}
                onChange={(e) =>
                  act(() => {
                    const band = e.target.value as Band;
                    engine.updateAP({ band, channel: band === '5' ? 36 : band === '6' ? 37 : 6 });
                  })
                }
              >
                <option>2.4</option>
                <option>5</option>
                <option>6</option>
              </select>
            </label>
            <label>
              SSID
              <input
                aria-label="AP SSID"
                value={state.ap.ssid}
                onChange={(e) => act(() => engine.updateAP({ ssid: e.target.value }))}
              />
            </label>
            <label>
              Channel
              <input
                type="number"
                value={state.ap.channel}
                onChange={(e) => act(() => engine.updateAP({ channel: Number(e.target.value) }))}
              />
            </label>
            <label>
              Channel width
              <select
                value={state.ap.width}
                onChange={(e) => act(() => engine.updateAP({ width: Number(e.target.value) }))}
              >
                {[20, 40, 80, 160, 320].map((w) => (
                  <option key={w} value={w}>
                    {w} MHz
                  </option>
                ))}
              </select>
            </label>
            <label>
              NSS
              <select
                value={state.ap.nss}
                onChange={(e) => act(() => engine.updateAP({ nss: Number(e.target.value) }))}
              >
                {[1, 2, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Security
              <select
                value={state.ap.security}
                onChange={(e) =>
                  act(() => engine.updateAP({ security: e.target.value as 'WPA2' | 'WPA3' }))
                }
              >
                <option>WPA2</option>
                <option>WPA3</option>
              </select>
            </label>
            <label>
              Lab password
              <input
                value={state.ap.password}
                onChange={(e) => act(() => engine.updateAP({ password: e.target.value }))}
              />
            </label>
          </div>
          <button
            className={`wide-toggle ${state.ap.txbf ? 'active' : ''}`}
            aria-label="AP TxBF toggle"
            onClick={() => act(() => engine.updateAP({ txbf: !state.ap.txbf }))}
          >
            <Zap size={16} />
            <span>AP Tx Beamforming</span>
            <strong>{state.ap.txbf ? 'ON' : 'OFF'}</strong>
          </button>
          <div className="info-box">
            DL 由 AP 發送，這個開關影響 DL 的 BF 條件。STA 的 <code>etxbfencond</code> 另由 UCI
            套用。
          </div>
          <div className="device-detail">
            <span>Connected clients</span>
            <strong>{connected ? 1 : 0}</strong>
            <span>BSSID</span>
            <code>{state.sta.bssid}</code>
          </div>
        </div>
      );
    if (tool === 'topology')
      return (
        <div className="tool-body">
          <h2>控制與流量路徑</h2>
          <p className="muted">Serial 不經 RF；Ping 可經管理網路繞行。</p>
          <div className="topology-diagram">
            <div>
              <Monitor />
              <b>QA PC</b>
              <small>{state.network.pcIp}</small>
            </div>
            <span className="path-line">
              <Cable size={15} />
              Ethernet
            </span>
            <div>
              <Radio />
              <b>TP-Link AP</b>
              <small>{state.ap.ssid}</small>
            </div>
            <span className={`path-line ${connected ? '' : 'broken'}`}>
              RF · {state.attenuation.db} dB
            </span>
            <div>
              <Wifi />
              <b>MT7999 STA</b>
              <small>{state.network.dutIp}</small>
            </div>
          </div>
          <div className="serial-path">
            QA PC ── COM23 / Serial ── DUT Shell <span className="led green" />
            控制通道
          </div>
          <div className="form-grid">
            <label>
              Ethernet bottleneck Mbps
              <input
                type="number"
                value={state.network.ethernetMbps}
                onChange={(e) =>
                  act(() => {
                    engine.state.network.ethernetMbps = Math.max(1, Number(e.target.value));
                  })
                }
              />
            </label>
            <label>
              Server port
              <input
                type="number"
                value={state.network.serverPort}
                onChange={(e) =>
                  act(() => {
                    engine.state.network.serverPort = Number(e.target.value);
                  })
                }
              />
            </label>
          </div>
          <button
            className={`wide-toggle ${state.network.serverRunning ? 'active' : ''}`}
            onClick={() =>
              act(() => {
                engine.state.network.serverRunning = !engine.state.network.serverRunning;
                engine.log(
                  'iperf3',
                  'info',
                  `Server ${engine.state.network.serverRunning ? 'listening' : 'stopped'}`,
                );
              })
            }
          >
            <Server size={16} />
            <span>iperf3 Server · {state.network.serverIp}</span>
            <strong>{state.network.serverRunning ? 'ON' : 'OFF'}</strong>
          </button>
          <button
            className={`wide-toggle ${state.network.bypass ? 'warning' : ''}`}
            onClick={() =>
              act(() => {
                engine.state.network.bypass = !engine.state.network.bypass;
                engine.log(
                  'Network',
                  'info',
                  `Management bypass ${engine.state.network.bypass ? 'enabled' : 'disabled'}`,
                );
              })
            }
          >
            <Cable size={16} />
            <span>Ethernet 管理繞行</span>
            <strong>{state.network.bypass ? 'ON' : 'OFF'}</strong>
          </button>
          <div className="rf-metrics">
            <div>
              <span>Wi-Fi counters</span>
              <strong>
                {format(state.network.wifiBytes / 1024)}
                <small>KiB</small>
              </strong>
            </div>
            <div>
              <span>Ethernet counters</span>
              <strong>
                {format(state.network.ethernetBytes / 1024)}
                <small>KiB</small>
              </strong>
            </div>
          </div>
          <div className="info-box">
            在 VT 執行 <code>ip route get 192.168.1.200</code>、<code>bridge fdb show</code>
            ，並比較測試前後 Counters，確認資料路徑。
          </div>
        </div>
      );
    if (tool === 'learning')
      return (
        <div className="tool-body learning-body">
          <div className="tool-heading">
            <BookOpen size={24} />
            <div>
              <h2>{chapter ? `Chapter ${chapter}` : '自由實驗'}</h2>
              <p>{scenarios[chapter][0]}</p>
            </div>
          </div>
          <div className="mode-tabs">
            {['Guided', 'Practice', 'Troubleshooting'].map((m) => (
              <button
                className={mode === m ? 'selected' : ''}
                key={m}
                onClick={() => {
                  setMode(m);
                  setHint(0);
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mission-text">{scenarios[chapter][1]}</p>
          <div className={`mission-result ${completed ? 'success' : ''}`}>
            <ShieldCheck size={18} />
            {completed ? '狀態驗收通過：已達成此章目標' : '任務進行中 · 以設備狀態與操作證據驗收'}
          </div>
          <div className="evidence-row">
            <span>{readLink ? <Check size={13} /> : <HelpCircle size={13} />}鏈路查詢</span>
            <span>{readLog ? <Check size={13} /> : <HelpCircle size={13} />}Log / 掃描證據</span>
            <span>{connected ? <Check size={13} /> : <HelpCircle size={13} />}STA Connected</span>
          </div>
          <button className="hint-button" onClick={() => setHint((h) => Math.min(h + 1, 3))}>
            <HelpCircle size={15} />
            {hint ? '下一層提示' : '需要提示'} <ChevronDown size={13} />
          </button>
          {hint > 0 && (
            <div className="info-box">
              {chapter === 9
                ? hint === 1
                  ? '先查 iw dev stamld0 link 與 logread。保留現象，不急著重貼設定。'
                  : hint === 2
                    ? '用 wpa_cli -i stamld0 scan_results 查可見 AP。空清單不能直接證明 SSID 錯誤；同時檢查 AP 電源與 RF 路徑。'
                    : '核對衰減器實際 dB，恢復到測試起點，等待掃描與關聯，再查 link、Ping。'
                : chapter === 5
                  ? hint === 1
                    ? '先核對 AP 實際 Band 與 SSID，再用 uci show wireless.stamld0 查 Device。'
                    : hint === 2
                      ? '5 GHz 使用 MT7999_1_2；AP SSID 是 BN68。變更後 commit 並 wifi restart。'
                      : '確認 5180 MHz 與資料路徑，跑 AP BF ON/OFF DL Sweep。STA BF 的 UCI 也要依 SOP 切换與驗證。'
                  : '依序檢查 AP、STA、Runtime、流量路徑、Server 與測試參數。'}
              {mode === 'Guided' && chapter !== 9 && (
                <pre>
                  {chapter === 5
                    ? sampleScript
                    : 'iw dev stamld0 link\nuci show wireless.stamld0\nip route get 192.168.1.200\nping -c 4 192.168.1.200'}
                </pre>
              )}
            </div>
          )}
          <div className="chapter-list">
            {scenarios.slice(1).map((s, i) => (
              <button
                key={i}
                className={chapter === i + 1 ? 'selected' : ''}
                onClick={() => scenario(i + 1)}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                {s[0]}
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <p className="subtle-note">
            章節 5、9、10 載入不同環境；章節 1–4、6 為練習目標。章節 9 的根因只在提示第三層揭示。
          </p>
        </div>
      );
    if (tool === 'script')
      return (
        <div className="tool-body">
          <h2>APCLI Script Editor</h2>
          <p className="muted">在虛擬 OpenWrt 執行；未知語法會明確回報。</p>
          <textarea
            className="script-editor"
            aria-label="Shell script editor"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
          />
          <button
            className="primary"
            onClick={() => {
              const output = linux.execute(script);
              record(script, output, 'linux');
              refresh();
              notify(output || '腳本已執行；查看 Runtime 與鏈路。');
              open('tera');
            }}
          >
            <Play size={13} />
            Execute in DUT
          </button>
          <button onClick={() => download('apcli.sh', script)}>
            <Download size={13} />
            Save .sh
          </button>
        </div>
      );
    return (
      <div className="tool-body">
        <h2>RvR Result Analyzer</h2>
        <p className="muted">只顯示實際產生的模擬點；各次執行保留設定。</p>
        <Chart state={state} />
        <div className="run-list">
          {state.msp.runs.map((r) => (
            <div className="run-row" key={r.id}>
              <span className={r.bf ? 'blue-dot' : 'red-dot'} />
              <input
                aria-label={`Legend ${r.id}`}
                value={r.label}
                onChange={(e) =>
                  act(() => {
                    const run = engine.state.msp.runs.find((x) => x.id === r.id);
                    if (run) run.label = e.target.value;
                  })
                }
              />
              <span>
                {r.direction} · {r.points.length} pts · {r.status}
              </span>
            </div>
          ))}
        </div>
        <div className="report-actions">
          <button onClick={() => mspExports('csv')}>CSV</button>
          <button onClick={() => mspExports('xlsx')}>
            <Download size={14} />
            Excel + Chart
          </button>
          <button onClick={() => mspExports('report')}>HTML Report</button>
          <button
            onClick={() =>
              download(
                'wifi-qa-test.log',
                state.logs
                  .map((l) => `${l.time} [${l.source}] ${l.level}: ${l.message}`)
                  .join('\n'),
              )
            }
          >
            Test Log
          </button>
        </div>
        <div className="config-layers">
          <h3>UCI → Driver · 三層設定</h3>
          <div>
            <span>Setting</span>
            <span>Staged</span>
            <span>Committed</span>
            <span>Runtime</span>
          </div>
          {[
            'wireless.stamld0.device',
            'wireless.stamld0.ssid',
            `wireless.${radioForBand(state.ap.band)}.etxbfencond`,
          ].map((k) => (
            <div key={k}>
              <code>{k.replace('wireless.', '')}</code>
              <code>{(state.config.staged[k] ?? state.config.committed[k]) || '—'}</code>
              <code>{state.config.committed[k] || '—'}</code>
              <code>{state.config.runtime[k] || '—'}</code>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={`app theme-${theme}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <Monitor size={21} />
          </span>
          <strong>
            Wi-Fi QA <span>Virtual Lab</span>
          </strong>
          <span className="version">v0.3.1</span>
        </div>
        <div className="header-right">
          <a
            className="companion-tool"
            href="https://excel-chart-table-tools.kdeppaei2.chatgpt.site"
            target="_blank"
            rel="noopener noreferrer"
          >
            Excel 繪圖與表格
          </a>
          <span className="simulation-tag">
            <FlaskConical size={12} />
            SIMULATION
          </span>
          <span className="header-id">LAB-01 · {state.ap.band} GHz</span>
          <button
            title="切換主題"
            aria-label="切換主題"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            title="儲存快照"
            aria-label="儲存快照"
            onClick={() => {
              save();
              download(
                'wifi-qa-snapshot.json',
                JSON.stringify(
                  {
                    version: 1,
                    lab: engine.state,
                    linux: linux.snapshot(),
                    windows: windows.snapshot(),
                    chapter,
                    evidence,
                  },
                  null,
                  2,
                ),
                'application/json',
              );
              notify('快照已保存，瀏覽器進度也會自動保存。');
            }}
          >
            <Save size={16} />
          </button>
          <button title="載入快照" aria-label="載入快照" onClick={() => file.current?.click()}>
            <FolderOpen size={16} />
          </button>
          <input
            type="file"
            ref={file}
            hidden
            accept="application/json,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const s = parseSnapshot(JSON.parse(await f.text()));
                if (!s) throw new Error('Invalid snapshot');
                const restored = new LabEngine(s.lab);
                const nextLinux = new TerminalSession(restored, 'linux', s.linux);
                const nextWindows = new TerminalSession(restored, 'windows', s.windows);
                nextLinux.engine = engine;
                nextWindows.engine = engine;
                engine.state = restored.state;
                linux = nextLinux;
                windows = nextWindows;
                setChapter(s.chapter);
                setEvidence(s.evidence);
                setWorkflowResetKey((key) => key + 1);
                refresh();
                notify('實驗室快照已還原。');
              } catch {
                notify('快照格式無效，未變更實驗室。');
              }
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <nav className="tool-rail">
        <div className="rail-label">TOOLS</div>
        {(['tera', 'cmd', 'att', 'msp'] as Tool[]).map((t) => {
          const Icon = icons[t];
          return (
            <button
              key={t}
              title={names[t]}
              aria-label={`開啟 ${names[t]}`}
              className={opened.includes(t) && !minimized.includes(t) ? 'active' : ''}
              onClick={() => open(t)}
            >
              <Icon size={20} />
              <span>{t === 'tera' ? 'VT' : t === 'cmd' ? 'CMD' : t === 'att' ? 'ATT' : 'MSP'}</span>
            </button>
          );
        })}
        <div className="rail-divider" />
        {(['workflow', 'ap', 'topology', 'script', 'report', 'learning'] as Tool[]).map((t) => {
          const Icon = icons[t];
          return (
            <button
              key={t}
              title={names[t]}
              aria-label={`開啟 ${names[t]}`}
              className={opened.includes(t) && !minimized.includes(t) ? 'active' : ''}
              onClick={() => open(t)}
            >
              <Icon size={19} />
            </button>
          );
        })}
        <button
          className="rail-reset"
          title="重置自由實驗（清除測試結果）"
          aria-label="重置實驗室"
          onClick={() => {
            act(() => engine.reset('6'));
            setChapter(0);
            setEvidence([]);
            setWorkflowResetKey((key) => key + 1);
            notify('實驗室已回到 6 GHz 初始狀態。');
          }}
        >
          <RotateCcw size={19} />
        </button>
      </nav>
      <main
        className={`desktop ${opened.includes('workflow') && !minimized.includes('workflow') ? 'workflow-visible' : ''}`}
      >
        <div className="workspace-bar">
          <div>
            <div className="eyebrow">
              <span className="led green" />
              SHARED LAB STATE
            </div>
            <h1>你的 Wi-Fi 測試工作台</h1>
          </div>
          <div className="workspace-actions">
            <button className="workflow-launch" onClick={() => open('workflow')}>
              <ListChecks size={14} />
              指令工作流
            </button>
            <button onClick={() => open('topology')}>
              <Network size={14} />
              Topology
            </button>
            <button onClick={() => open('ap')}>
              <Settings2 size={14} />
              Configure AP
            </button>
          </div>
        </div>
        <div className="status-strip">
          <div>
            <span className={`led ${connected ? 'green' : 'amber'}`} />
            <b>STA {state.sta.status}</b>
            <span>{state.ap.ssid}</span>
          </div>
          <div>
            <span>FREQUENCY</span>
            <b>
              {connected ? state.sta.freq : '—'} <small>MHz</small>
            </b>
          </div>
          <div>
            <span>PHY RATE</span>
            <b>
              {connected ? format(state.sta.phyRate) : '—'} <small>Mbps</small>
            </b>
          </div>
          <div>
            <span>UCI</span>
            <b className={changed || applied ? 'amber-text' : ''}>
              {changed} pending · {applied} unapplied
            </b>
          </div>
          <button onClick={() => open('report')}>
            State details
            <ChevronRight size={13} />
          </button>
        </div>
        <section className="connection-help" aria-label="連線診斷與恢復">
          <div className="connection-help-heading">
            <span>
              {connected
                ? 'STA 已連線；可檢查目前連線條件。'
                : 'STA 尚未連線；恢復起點後仍失敗時，請核對 AP 與 STA 設定。'}
            </span>
            <button
              aria-expanded={connectionOpen}
              onClick={() => setConnectionOpen((open) => !open)}
            >
              {connectionOpen ? '收起連線檢查' : '檢查連線'}
            </button>
          </div>
          {connectionOpen && (
            <div data-testid="connection-diagnostics">
              <p>
                目前階段：{state.sta.status} · {state.sta.reason}
                。重新整理會沿用本瀏覽器已保存的現場。
              </p>
              <div className="connection-checks">
                {engine.connectionDiagnostics().map((check) => (
                  <div
                    key={check.id}
                    data-testid={`connection-check-${check.id}`}
                    data-ok={check.ok}
                  >
                    <strong>
                      {check.ok ? '✓' : '!'} {check.label}
                    </strong>
                    <span>{check.detail}</span>
                  </div>
                ))}
              </div>
              <p>
                同步操作會將 STA 的 Radio、SSID、認證與 PMF 對齊目前 AP，提交並重啟 Wi-Fi，衰減設為
                0 dB。BF、Sweep、原量測及 Log 保留。
              </p>
              <div className="connection-recovery-actions">
                <button
                  disabled={state.msp.status === 'running'}
                  onClick={() => act(() => engine.setAttenuation(0))}
                >
                  衰減設為 0 dB
                </button>
                <button
                  disabled={!!engine.stationRecoveryBlocker()}
                  onClick={() => {
                    try {
                      let message = '';
                      act(() => {
                        message = engine.recoverStationToAP();
                      });
                      notify(message);
                    } catch (error) {
                      notify(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  依目前 AP 同步 STA 並重連
                </button>
                <button onClick={() => open('ap')}>檢查 AP 設定</button>
              </div>
              {engine.stationRecoveryBlocker() && (
                <p role="status">{engine.stationRecoveryBlocker()}</p>
              )}
              <p className="subtle-note">
                資料保存在各瀏覽器中。這裡保留故障現場；「重置實驗室」才會清除結果並回到初始環境。
              </p>
            </div>
          )}
        </section>
        <div className="workspace-grid">
          {(['tera', 'cmd', 'att', 'msp'] as Tool[]).map((t) =>
            opened.includes(t) && !minimized.includes(t) ? (
              <Panel
                key={t}
                tool={t}
                focused={focus === t}
                onFocus={() => setFocus(t)}
                onClose={() => close(t)}
                onMin={() => setMinimized([...minimized, t])}
              >
                {renderTool(t)}
              </Panel>
            ) : (
              <button className={`empty-panel empty-${t}`} key={t} onClick={() => open(t)}>
                {(() => {
                  const Icon = icons[t];
                  return <Icon size={25} />;
                })()}
                <span>Open {names[t]}</span>
              </button>
            ),
          )}
        </div>
        {opened
          .filter(
            (t) => !['tera', 'cmd', 'att', 'msp', 'workflow'].includes(t) && !minimized.includes(t),
          )
          .map((t) => (
            <Panel
              key={t}
              tool={t}
              extra
              focused={focus === t}
              onFocus={() => setFocus(t)}
              onClose={() => close(t)}
              onMin={() => setMinimized([...minimized, t])}
            >
              {renderTool(t)}
            </Panel>
          ))}
        <div hidden={!opened.includes('workflow') || minimized.includes('workflow')}>
          <Panel
            tool="workflow"
            extra
            focused={focus === 'workflow'}
            onFocus={() => setFocus('workflow')}
            onClose={() => close('workflow')}
            onMin={() => setMinimized([...minimized, 'workflow'])}
          >
            {renderTool('workflow')}
          </Panel>
        </div>
        <button className="mission-bar" onClick={() => open('learning')}>
          <BookOpen size={16} />
          <strong>{chapter ? `Chapter ${chapter}` : 'Free Lab'}</strong>
          <span className="mission-separator" />
          <span>{scenarios[chapter][0]}</span>
          {completed && (
            <span className="mission-complete">
              <Check size={14} />
              Completed
            </span>
          )}
          <span className="mission-mode">
            {mode} Mode
            <ChevronRight size={14} />
          </span>
        </button>
      </main>
      <footer className="taskbar">
        <button
          className="start-button"
          aria-label="開始選單"
          onClick={() => setStartMenu(!startMenu)}
        >
          <Monitor size={17} />
        </button>
        <span className="task-divider" />
        {opened.map((t) => {
          const Icon = icons[t];
          return (
            <button
              key={t}
              className={focus === t && !minimized.includes(t) ? 'active' : ''}
              title={names[t]}
              onClick={() => open(t)}
            >
              <Icon size={15} />
              <span>
                {t === 'tera'
                  ? 'Tera Term'
                  : t === 'cmd'
                    ? 'CMD'
                    : t === 'att'
                      ? 'Attenuator'
                      : t === 'msp'
                        ? 'MSP RvR'
                        : names[t]}
              </span>
              <i />
            </button>
          );
        })}
        <div className="taskbar-status">
          <span className="led green" />
          進度自動保存
          <span>
            SIM{' '}
            {Math.floor(state.clock / 60)
              .toString()
              .padStart(2, '0')}
            :{(state.clock % 60).toString().padStart(2, '0')}
          </span>
        </div>
      </footer>
      {startMenu && (
        <div className="start-menu">
          <h3>
            <Monitor size={17} />
            Virtual Lab Apps
          </h3>
          {(Object.keys(names) as Tool[]).map((t) => {
            const Icon = icons[t];
            return (
              <button key={t} onClick={() => open(t)}>
                <Icon size={18} />
                {names[t]}
              </button>
            );
          })}
          <button onClick={() => setStartMenu(false)}>
            <PanelLeftClose size={16} />
            Close menu
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={17} />
          {toast}
          <button onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
