import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { matchedComparison, parseMatrix } from './data';
import type { Point, MatrixOptions } from './data';
import { makeWorkbook } from './workbook';
import { defaultChartOptions } from './presentation';
import type { ChartOptions, CurveStyle } from './presentation';
import PeakTable from '../peakTable/PeakTable';
import './style.css';

type Mode = 'single' | 'common' | 'separate';
const defaultMetadata = () =>
  Object.fromEntries(
    ['single', 'common', 'separate'].map((mode) => [
      mode,
      {
        source: '使用者提供數據（未驗證量測來源）',
        note: '',
        xLabel: 'dB',
        yLabel: 'Throughput (Mbps)',
      },
    ]),
  ) as Record<Mode, { source: string; note: string; xLabel: string; yLabel: string }>;
const defaultPresentation = () => ({
  single: defaultChartOptions(false),
  common: defaultChartOptions(true),
  separate: defaultChartOptions(true),
});
function Mapping({
  value,
  onChange,
  count,
  prefix,
  xName,
  yName,
}: {
  value: MatrixOptions;
  onChange: (v: MatrixOptions) => void;
  count: 2 | 3;
  prefix: string;
  xName: string;
  yName: string;
}) {
  const horizontal = value.orientation === 'rows';
  const boundInput = (
    key: 'startRow' | 'endRow' | 'startColumn' | 'endColumn',
    caption: string,
  ) => (
    <label>
      {caption}
      <input
        aria-label={`${prefix}${caption}`}
        type="number"
        min="1"
        value={value[key] ?? ''}
        placeholder="自動"
        onChange={(e) =>
          onChange({ ...value, [key]: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      />
    </label>
  );
  return (
    <details className="mapping" open>
      <summary>修改擷取範圍（預設找左上方第一組數據）</summary>
      <label className="mapping-orientation">
        資料排列方式
        <select
          aria-label={`${prefix}資料排列方式`}
          value={horizontal ? 'rows' : 'columns'}
          onChange={(e) =>
            onChange({ ...value, orientation: e.target.value as 'rows' | 'columns' })
          }
        >
          <option value="columns">按欄讀取：每一行是一個測點</option>
          <option value="rows">按列讀取：每一欄是一個測點</option>
        </select>
      </label>
      <div className="mapping-grid">
        {horizontal ? (
          <>
            {boundInput('startColumn', '資料起始欄')}
            {boundInput('endColumn', '資料結束欄')}
          </>
        ) : (
          <>
            {boundInput('startRow', '資料起始行')}
            {boundInput('endRow', '資料結束行')}
          </>
        )}
        {Array.from({ length: count }, (_, i) => (
          <label key={i}>
            {i === 0
              ? `X ${horizontal ? '行' : '欄'}（${xName}）`
              : count === 3
                ? `${i === 1 ? 'ON' : 'OFF'} Y ${horizontal ? '行' : '欄'}`
                : `Y ${horizontal ? '行' : '欄'}（${yName}）`}
            <input
              aria-label={`${prefix}第 ${i + 1} ${horizontal ? '行' : '欄'}位置`}
              type="number"
              min="1"
              max={horizontal ? undefined : 256}
              value={(horizontal ? value.rows : value.columns)?.[i] ?? ''}
              placeholder={i === 0 ? '自動尋找 X' : `自動 X + ${i}`}
              onChange={(e) => {
                const key = horizontal ? 'rows' : 'columns';
                const positions = [...(value[key] ?? [])];
                positions[i] = e.target.value === '' ? undefined : Number(e.target.value);
                onChange({ ...value, [key]: positions });
              }}
            />
          </label>
        ))}
      </div>
      <p className="hint">
        行與欄從 1 開始計算，包含貼上的標題。留空使用自動選取；結束位置包含在資料範圍內。
      </p>
      <button className="secondary" onClick={() => onChange({})}>
        恢復自動擷取
      </button>
    </details>
  );
}
function Appearance({
  value,
  onChange,
}: {
  value: ChartOptions;
  onChange: (v: ChartOptions) => void;
}) {
  const editCurve = (index: number, patch: Partial<CurveStyle>) =>
    onChange({
      ...value,
      curves: value.curves.map((curve, i) => (i === index ? { ...curve, ...patch } : curve)),
    });
  return (
    <details className="appearance" open>
      <summary>圖表標題與曲線外觀</summary>
      <label htmlFor="chart-title">
        圖表標題
        <input
          id="chart-title"
          maxLength={120}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <p className="hint">同步預覽、Excel 的 A2 與圖表大標題。測試條件另存於來源說明。</p>
      <div className="row palette-buttons">
        <button
          className="secondary"
          onClick={() =>
            onChange({
              ...value,
              curves: value.curves.map((c, i) => ({
                ...c,
                color: i ? '#e69f00' : '#0072b2',
                lineStyle: i ? 'dash' : 'solid',
                marker: i ? 'square' : 'circle',
              })),
            })
          }
        >
          藍橙＋不同線型
        </button>
        <button
          className="secondary"
          onClick={() =>
            onChange({
              ...value,
              curves: value.curves.map((c, i) => ({
                ...c,
                color: i ? '#777777' : '#222222',
                lineStyle: i ? 'dash' : 'solid',
                marker: i ? 'diamond' : 'circle',
              })),
            })
          }
        >
          黑白列印
        </button>
      </div>
      <details className="curve-settings">
        <summary>曲線顏色、線型與測點（展開設定）</summary>
        <div className="curves">
          {value.curves.map((curve, i) => (
            <fieldset key={i} className="curve-style">
              <legend>曲線 {i + 1}</legend>
              <label>
                圖例名稱
                <input
                  aria-label={`曲線 ${i + 1} 名稱`}
                  maxLength={60}
                  value={curve.name}
                  onChange={(e) => editCurve(i, { name: e.target.value })}
                />
              </label>
              <div className="mapping-grid">
                <label>
                  顏色
                  <input
                    aria-label={`曲線 ${i + 1} 顏色`}
                    type="color"
                    value={curve.color}
                    onChange={(e) => editCurve(i, { color: e.target.value })}
                  />
                </label>
                <label>
                  線型
                  <select
                    aria-label={`曲線 ${i + 1} 線型`}
                    value={curve.lineStyle}
                    onChange={(e) =>
                      editCurve(i, { lineStyle: e.target.value as CurveStyle['lineStyle'] })
                    }
                  >
                    <option value="solid">實線</option>
                    <option value="dash">虛線</option>
                    <option value="dot">點線</option>
                    <option value="none">不連線</option>
                  </select>
                </label>
                <label>
                  線寬（pt）
                  <select
                    aria-label={`曲線 ${i + 1} 線寬`}
                    value={curve.lineWidth}
                    onChange={(e) => editCurve(i, { lineWidth: Number(e.target.value) })}
                  >
                    {[1, 1.5, 2, 2.5, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  測點樣式
                  <select
                    aria-label={`曲線 ${i + 1} 測點樣式`}
                    value={curve.marker}
                    onChange={(e) =>
                      editCurve(i, { marker: e.target.value as CurveStyle['marker'] })
                    }
                  >
                    <option value="circle">圓形</option>
                    <option value="square">方形</option>
                    <option value="diamond">菱形</option>
                    <option value="triangle">三角形</option>
                    <option value="none">隱藏測點</option>
                  </select>
                </label>
                <label>
                  測點大小
                  <select
                    aria-label={`曲線 ${i + 1} 測點大小`}
                    value={curve.markerSize}
                    onChange={(e) => editCurve(i, { markerSize: Number(e.target.value) })}
                  >
                    {[3, 5, 7, 9, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
          ))}
        </div>
      </details>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={value.showLegend}
            onChange={(e) => onChange({ ...value, showLegend: e.target.checked })}
          />
          顯示圖例
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.showGrid}
            onChange={(e) => onChange({ ...value, showGrid: e.target.checked })}
          />
          顯示圖表格線
        </label>
      </div>
      {value.curves.some((c) => c.lineStyle === 'none' && c.marker === 'none') && (
        <p role="alert" className="error">
          不連線時請保留測點樣式，曲線才可見。
        </p>
      )}
    </details>
  );
}
function Marker({
  curve,
  x,
  y,
  children,
}: {
  curve: CurveStyle;
  x: number;
  y: number;
  children?: React.ReactNode;
}) {
  const r = curve.markerSize * 0.65;
  return (
    <g fill={curve.color} data-marker={curve.marker}>
      {curve.marker === 'circle' && <circle cx={x} cy={y} r={r} />}
      {curve.marker === 'square' && <rect x={x - r} y={y - r} width={2 * r} height={2 * r} />}
      {curve.marker === 'diamond' && (
        <path d={`M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`} />
      )}
      {curve.marker === 'triangle' && (
        <path d={`M${x},${y - r}L${x + r},${y + r}L${x - r},${y + r}Z`} />
      )}
      {children}
    </g>
  );
}
function Chart({
  series,
  options,
  xLabel,
  yLabel,
}: {
  series: Point[][];
  options: ChartOptions;
  xLabel: string;
  yLabel: string;
}) {
  const all = series.flat();
  const maxX = Math.max(10, ...all.map((p) => p.db));
  const maxY = Math.max(10, ...all.map((p) => p.mbps ?? 0)) * 1.1;
  const x = (v: number) => 78 + (v / maxX) * 626;
  const y = (v: number) => 410 - (v / maxY) * 290;
  const dash = (curve: CurveStyle) =>
    curve.lineStyle === 'dash' ? '9 5' : curve.lineStyle === 'dot' ? '2 4' : undefined;
  const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('en-US');
  return (
    <svg viewBox="0 0 760 500" role="img" aria-label={`RvR 曲線：X 軸 ${xLabel}，Y 軸 ${yLabel}`}>
      <foreignObject x="78" y="8" width="626" height="66">
        <div className="chart-title">{options.title}</div>
      </foreignObject>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          {options.showGrid && (
            <>
              <line
                x1="78"
                x2="704"
                y1={y((maxY * i) / 5)}
                y2={y((maxY * i) / 5)}
                stroke="#e1e7ef"
              />
              <line
                x1={x((maxX * i) / 5)}
                x2={x((maxX * i) / 5)}
                y1="120"
                y2="410"
                stroke="#e1e7ef"
              />
            </>
          )}
          <text x="68" y={y((maxY * i) / 5) + 4} textAnchor="end">
            {fmt((maxY * i) / 5)}
          </text>
          <text x={x((maxX * i) / 5)} y="437" textAnchor="middle">
            {fmt((maxX * i) / 5)}
          </text>
        </g>
      ))}
      <line x1="78" y1="410" x2="704" y2="410" stroke="#8a98ac" />
      <line x1="78" y1="120" x2="78" y2="410" stroke="#8a98ac" />
      <text x="385" y="478" textAnchor="middle">
        {xLabel}
      </text>
      <text transform="translate(20 265) rotate(-90)" textAnchor="middle">
        {yLabel}
      </text>
      {series.map((points, s) => {
        const curve = options.curves[s];
        let pen = false;
        const path = points
          .map((p) => {
            if (p.mbps === null) {
              pen = false;
              return '';
            }
            const command = pen ? 'L' : 'M';
            pen = true;
            return `${command}${x(p.db)},${y(p.mbps)}`;
          })
          .join(' ');
        return (
          <g key={s} data-curve={s + 1}>
            {curve.lineStyle !== 'none' && (
              <path
                d={path}
                fill="none"
                stroke={curve.color}
                strokeWidth={curve.lineWidth * 1.33}
                strokeDasharray={dash(curve)}
              />
            )}
            {curve.marker !== 'none' &&
              points.map((p, i) =>
                p.mbps === null ? null : (
                  <Marker key={i} curve={curve} x={x(p.db)} y={y(p.mbps)}>
                    <title>
                      {curve.name}: {p.db} {xLabel} / {p.mbps} {yLabel}
                    </title>
                  </Marker>
                ),
              )}
          </g>
        );
      })}
      {options.showLegend &&
        options.curves.map((curve, i) => (
          <g key={i}>
            {curve.lineStyle !== 'none' && (
              <line
                x1={90 + i * 320}
                x2={122 + i * 320}
                y1="94"
                y2="94"
                stroke={curve.color}
                strokeWidth={curve.lineWidth * 1.33}
                strokeDasharray={dash(curve)}
              />
            )}
            <Marker curve={curve} x={106 + i * 320} y={94} />
            <foreignObject x={132 + i * 320} y="80" width="260" height="32">
              <div className="chart-legend" title={curve.name}>
                {curve.name}
              </div>
            </foreignObject>
          </g>
        ))}
    </svg>
  );
}
function App() {
  const [view, setView] = useState<'chart' | 'peak'>('chart');
  const [expanded, setExpanded] = useState(false);
  const workbench = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    workbench.current?.querySelector('button')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [expanded]);
  const [mode, setMode] = useState<Mode>('single');
  const [single, setSingle] = useState('');
  const [common, setCommon] = useState('');
  const [on, setOn] = useState('');
  const [off, setOff] = useState('');
  const [sort, setSort] = useState(true);
  const [metadata, setMetadata] = useState(defaultMetadata);
  const [presentation, setPresentation] = useState<Record<Mode, ChartOptions>>(defaultPresentation);
  const options = presentation[mode];
  const appearanceValid =
    options.title.trim() &&
    options.curves.every((c) => c.name.trim() && !(c.lineStyle === 'none' && c.marker === 'none'));
  const { source, note, xLabel, yLabel } = metadata[mode];
  const [mapping, setMapping] = useState<Record<string, MatrixOptions>>({
    single: {},
    common: {},
    on: {},
    off: {},
  });
  const mappingKey = mode === 'separate' ? 'on' : mode;
  const setSource = (source: string) =>
    setMetadata((previous) => ({ ...previous, [mode]: { ...previous[mode], source } }));
  const setNote = (note: string) =>
    setMetadata((previous) => ({ ...previous, [mode]: { ...previous[mode], note } }));
  const [fileError, setFileError] = useState('');
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const text = mode === 'single' ? single : mode === 'common' ? common : on;
  const result = useMemo(() => {
    if (!text.trim() && (mode !== 'separate' || !off.trim())) return { status: 'empty' as const };
    try {
      const parsed = parseMatrix(text, mode === 'common' ? 3 : 2, sort, mapping[mappingKey]);
      if (mode === 'separate') {
        const other = parseMatrix(off, 2, sort, mapping.off);
        return {
          status: 'ready' as const,
          series: [parsed.series[0], other.series[0]],
          missing: parsed.missing + other.missing,
          reordered: parsed.reordered || other.reordered,
          selections: [parsed, other],
        };
      }
      return { status: 'ready' as const, ...parsed, selections: [parsed] };
    } catch (error) {
      return { status: 'error' as const, error: (error as Error).message };
    }
  }, [text, off, mode, sort, mapping, mappingKey]);
  const labels = options.curves.map((curve) => curve.name);
  const comparison =
    result.status === 'ready' && mode !== 'single'
      ? matchedComparison(result.series[0], result.series[1])
      : [];
  function changeText(value: string, second = false) {
    if (second) setOff(value);
    else if (mode === 'single') setSingle(value);
    else if (mode === 'common') setCommon(value);
    else setOn(value);
    setFileError('');
    setMessage('');
  }
  function demo() {
    const left = 'dB\tMbps\n0\t980\n7.5\t950\n20\t860\n40\t570\n60\t240\n80\t25\n90\t0';
    if (mode === 'single') setSingle(left);
    if (mode === 'separate') {
      setOn(left);
      setOff('dB\tMbps\n0\t960\n10\t900\n20\t760\n40\t410\n60\t110\n80\t0');
    }
    if (mode === 'common')
      setCommon(
        'dB\tON Mbps\tOFF Mbps\n0\t980\t960\n7.5\t950\t910\n20\t860\t760\n40\t570\t410\n60\t240\t110\n80\t25\t0\n90\t0\t',
      );
    setSource('示範數據（非實機量測）');
    setNote('');
    setMessage('已載入示範。貼入自己的數據後，請更新來源欄位。');
    setFileError('');
  }
  function download() {
    if (result.status !== 'ready') return;
    try {
      const bytes = makeWorkbook(result.series, source, note, { xLabel, yLabel }, options);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `rvr-${mode === 'single' ? 'single' : 'txbf-on-off'}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage(
        'Excel 已匯出。可修改 A2 更新圖表標題、修改第 6 行更新圖例名稱；黃色儲存格直接驅動原生 XY 圖表。',
      );
    } catch (error) {
      setMessage(`匯出失敗：${(error as Error).message}`);
    }
  }
  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setFileError('檔案超過 2 MB，請只匯入這輪測試的資料。');
      return;
    }
    try {
      changeText(await file.text());
      setSource('使用者匯入檔案（未驗證量測來源）');
      setNote(file.name);
    } catch {
      setFileError('無法讀取檔案，請使用 UTF-8 CSV／TSV 或直接貼上。');
    }
  }
  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">工具 02 · 量測資料整理</span>
          <h1>Excel 繪圖與表格工具</h1>
          <p>貼上數值矩陣繪圖，或依 Band／Config 建立 Peak 結果表，再下載可編輯的 Excel。</p>
        </div>
        <span className="offline">離線使用 · v1.3</span>
      </header>
      <nav aria-label="資料格式">
        {(
          [
            ['single', '單條曲線 · 兩欄'],
            ['common', 'TxBF ON／OFF · 三欄'],
            ['separate', 'TxBF ON／OFF · 各兩欄'],
          ] as const
        ).map(([key, title]) => (
          <button
            key={key}
            aria-pressed={view === 'chart' && mode === key}
            onClick={() => {
              setMode(key);
              setView('chart');
              setMessage('');
              setFileError('');
            }}
          >
            {title}
          </button>
        ))}
        <button aria-pressed={view === 'peak'} onClick={() => setView('peak')}>
          Peak 結果表 · 七欄
        </button>
      </nav>
      <div hidden={view !== 'chart'}>
        <div className="workspace">
          <section className="editor">
            <h2>1. 貼上測試數據</h2>
            <p>
              {mode === 'common'
                ? '每行：dB、ON Mbps、OFF Mbps。測不到的值可留空。'
                : mode === 'separate'
                  ? 'ON、OFF 分別貼上兩欄。兩組可使用不同 dB 測點。'
                  : '可貼上整塊 MSP 矩陣。預設只擷取左上方前兩欄，右側其他數值不納入曲線。'}
            </p>
            <label htmlFor="data">
              {mode === 'separate'
                ? `TxBF ON 原始矩陣：${xLabel}／${yLabel}`
                : mode === 'common'
                  ? `原始矩陣：${xLabel}／ON ${yLabel}／OFF ${yLabel}`
                  : `原始矩陣：${xLabel}／${yLabel}`}
            </label>
            <textarea
              id="data"
              spellCheck={false}
              value={text}
              onChange={(e) => changeText(e.target.value)}
              placeholder={
                mode === 'common'
                  ? 'dB\tON Mbps\tOFF Mbps\n0\t980\t950\n10\t920\t870'
                  : 'dB\tMbps\n0\t980\n10\t920\n20\t850'
              }
            />
            <Mapping
              value={mapping[mappingKey]}
              count={mode === 'common' ? 3 : 2}
              prefix={mode === 'separate' ? 'ON ' : ''}
              xName={xLabel}
              yName={yLabel}
              onChange={(value) => setMapping((previous) => ({ ...previous, [mappingKey]: value }))}
            />
            {mode === 'separate' && (
              <>
                <label htmlFor="off">
                  TxBF OFF 原始矩陣：{xLabel}／{yLabel}
                </label>
                <textarea
                  id="off"
                  spellCheck={false}
                  value={off}
                  onChange={(e) => changeText(e.target.value, true)}
                  placeholder="dB&#9;Mbps"
                />
                <Mapping
                  value={mapping.off}
                  count={2}
                  prefix="OFF "
                  xName={xLabel}
                  yName={yLabel}
                  onChange={(value) => setMapping((previous) => ({ ...previous, off: value }))}
                />
              </>
            )}
            <div className="row">
              <button className="secondary" onClick={() => input.current?.click()}>
                匯入 CSV／TSV
              </button>
              <button className="secondary" onClick={demo}>
                載入示範
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setSingle('');
                  setCommon('');
                  setOn('');
                  setOff('');
                  setMetadata(defaultMetadata());
                  setPresentation(defaultPresentation());
                  setMapping({ single: {}, common: {}, on: {}, off: {} });
                  setFileError('');
                  setMessage('');
                }}
              >
                清空全部
              </button>
            </div>
            <input
              ref={input}
              hidden
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <label className="check">
              <input type="checkbox" checked={sort} onChange={(e) => setSort(e.target.checked)} />按
              X 排序（整組數據一起排序）
            </label>
            <div className="metadata">
              <div className="mapping-grid">
                <label htmlFor="x-label">
                  X 欄名稱
                  <input
                    id="x-label"
                    maxLength={60}
                    value={xLabel}
                    onChange={(e) =>
                      setMetadata((previous) => ({
                        ...previous,
                        [mode]: { ...previous[mode], xLabel: e.target.value },
                      }))
                    }
                  />
                </label>
                <label htmlFor="y-label">
                  Y 欄名稱與單位
                  <input
                    id="y-label"
                    maxLength={60}
                    value={yLabel}
                    onChange={(e) => {
                      const name = e.target.value;
                      if (mode === 'single' && options.curves[0].name === yLabel)
                        setPresentation((previous) => ({
                          ...previous,
                          single: {
                            ...previous.single,
                            curves: [{ ...previous.single.curves[0], name }],
                          },
                        }));
                      setMetadata((previous) => ({
                        ...previous,
                        [mode]: { ...previous[mode], yLabel: name },
                      }));
                    }}
                  />
                </label>
              </div>
              <label htmlFor="source">數據來源</label>
              <select id="source" value={source} onChange={(e) => setSource(e.target.value)}>
                <option>使用者提供數據（未驗證量測來源）</option>
                <option>使用者匯入檔案（未驗證量測來源）</option>
                <option>MSP 實機量測（使用者標示）</option>
                <option>模擬器數據（SIMULATED）</option>
                <option>示範數據（非實機量測）</option>
              </select>
              <label htmlFor="note">測試名稱／條件（選填）</label>
              <input
                id="note"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如 5 GHz · TCP DL · 4 streams"
              />
            </div>
            {fileError && (
              <p role="alert" className="error">
                {fileError}
              </p>
            )}
            {result.status === 'error' && (
              <p role="alert" className="error">
                {result.error}
              </p>
            )}
            <p className="hint">
              支援 Tab、逗號、分號或空白分隔。每條曲線最多 1,000 點。空白不補 0，重複 X
              會提示處理。自動模式擷取第一組連續數據，也可指定 X／Y 行或欄與完整起訖範圍。圖片 OCR
              尚未加入。
            </p>
          </section>
          <section className="preview">
            <h2>2. 檢查曲線並下載 Excel</h2>
            <div
              ref={workbench}
              className={`chart-workbench${expanded ? ' chart-workbench-full' : ''}`}
              role={expanded ? 'dialog' : undefined}
              aria-modal={expanded || undefined}
              aria-label={expanded ? '曲線調整與固定預覽' : undefined}
              onKeyDown={(event) => {
                if (!expanded) return;
                if (event.key === 'Escape') setExpanded(false);
                if (event.key === 'Tab') {
                  const nodes = Array.from(
                    workbench.current?.querySelectorAll<HTMLElement>(
                      'button,input,select,textarea,summary',
                    ) ?? [],
                  ).filter((node) => node.offsetParent !== null && !node.hasAttribute('disabled'));
                  const first = nodes[0],
                    last = nodes.at(-1);
                  if (
                    (!event.shiftKey && document.activeElement === last) ||
                    (event.shiftKey && document.activeElement === first)
                  ) {
                    event.preventDefault();
                    (event.shiftKey ? last : first)?.focus();
                  }
                }
              }}
            >
              <div className="workbench-bar">
                <span>邊調整，邊看曲線</span>
                <button className="secondary" onClick={() => setExpanded(!expanded)}>
                  {expanded ? '結束放大編輯' : '放大並固定預覽'}
                </button>
              </div>
              <div className="chart-settings">
                <Appearance
                  value={options}
                  onChange={(value) =>
                    setPresentation((previous) => ({ ...previous, [mode]: value }))
                  }
                />
              </div>
              <div className="chart-plot">
                {result.status === 'ready' ? (
                  <Chart
                    series={result.series}
                    options={options}
                    xLabel={xLabel || 'dB'}
                    yLabel={yLabel || 'Throughput (Mbps)'}
                  />
                ) : (
                  <div className="empty">
                    貼上數據後，曲線會即時出現在這裡。
                    <br />
                    也可以先按「載入示範」查看操作。
                  </div>
                )}
              </div>
            </div>
            {result.status === 'ready' && (
              <>
                <p className="status">
                  {result.series
                    .map(
                      (p, i) => `${labels[i]}：${p.filter((v) => v.mbps !== null).length} 個量測點`,
                    )
                    .join(' · ')}
                  {result.missing ? ` · ${result.missing} 個空白值（曲線斷開）` : ''}
                  {result.reordered ? ' · 已依 X 排序' : ''}
                </p>
                {result.selections.map((selection, i) => (
                  <p className="selection-info" key={i}>
                    {mode === 'separate' ? `${i === 0 ? 'ON' : 'OFF'}：` : ''}
                    {selection.orientation === 'rows'
                      ? `按列擷取：X／Y 使用第 ${selection.selectedRows.join('、')} 行，第 ${selection.startColumn}–${selection.endColumn} 欄。`
                      : `從第 ${selection.startRow} 行擷取，第 ${selection.columns.join('、')} 欄，到第 ${selection.endRow} 行。`}
                    {selection.ignoredColumns > 0
                      ? `右側／未選取 ${selection.ignoredColumns} 欄不納入曲線。`
                      : ''}
                    {selection.remainingRows > 0
                      ? `另有 ${selection.remainingRows} 行未匯入。`
                      : ''}
                  </p>
                ))}
                <details>
                  <summary>核對已擷取欄位</summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>曲線</th>
                          <th>{xLabel}</th>
                          <th>{yLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.series.flatMap((points, s) =>
                          points.slice(0, 20).map((p, i) => (
                            <tr key={`${s}-${i}`}>
                              <td>{labels[s]}</td>
                              <td>{p.db}</td>
                              <td>{p.mbps ?? '空白'}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="hint">顯示每組前 20 行供核對；下載包含全部擷取測點。</p>
                </details>
              </>
            )}
            <button
              className="download"
              disabled={
                result.status !== 'ready' || !xLabel.trim() || !yLabel.trim() || !appearanceValid
              }
              onClick={download}
            >
              下載 Excel 原生圖表 .xlsx
            </button>
            <p className="hint">
              Excel 的 Single 工作表用 A／B 欄；TxBF 工作表用 A／B（ON）與 D／E（OFF）。從第 7
              行開始，修改資料後圖表會更新。換一輪測試前先清除舊測點。 改 A2 更新圖表標題，改 B6／E6
              更新圖例。右鍵曲線可「設定數列格式」；右鍵圖表可「選取資料」。 點選曲線後，Excel
              公式列可查看 SERIES 資料來源。圖表與工作表均未設保護。
            </p>
            <details className="excel-help">
              <summary>Excel 無法編輯時的檢查方式</summary>
              <p className="hint">
                若 Excel 顯示「受保護的檢視」，確認檔案是自己的匯出後按「啟用編輯」。若顯示 Office
                授權過期或未啟用，需處理 Office
                授權，網站無法解除此限制。一般模式下點一下圖表，再點曲線可調整格式；圖表標題亦可直接編輯。修改後另存
                .xlsx。
              </p>
            </details>
            {message && (
              <p role="status" className="message">
                {message}
              </p>
            )}
            {mode !== 'single' && result.status === 'ready' && (
              <details open className="comparison">
                <summary>同 dB 的 ON／OFF 比較（{comparison.length} 點）</summary>
                <p className="hint">
                  僅比較兩組皆有量測值的相同 dB；不插值。比較時請保持其他測試條件一致。OFF 為 0
                  時不計算百分比。
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{xLabel}</th>
                        <th>ON {yLabel}</th>
                        <th>OFF {yLabel}</th>
                        <th>差值 {yLabel}</th>
                        <th>增益 %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.map((p) => (
                        <tr key={p.db}>
                          <td>{p.db}</td>
                          <td>{p.on}</td>
                          <td>{p.off}</td>
                          <td>{Number(p.delta.toFixed(3))}</td>
                          <td>{p.gain === null ? '—' : Number(p.gain.toFixed(2))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        </div>
      </div>
      <div hidden={view !== 'peak'}>
        <PeakTable />
      </div>
      <footer>使用你輸入的資料整理曲線與表格。繪圖使用原始測點，Peak 的 Gain 完全由你手填。</footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
