import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { matchedComparison, parseMatrix } from './data';
import type { Point, MatrixOptions } from './data';
import { makeWorkbook } from './workbook';
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
const colors = ['#2563eb', '#dc2626'];
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
  return (
    <details className="mapping">
      <summary>修改擷取範圍（預設找左上方第一組數據）</summary>
      <div className="mapping-grid">
        <label>
          資料起始行
          <input
            aria-label={`${prefix}起始行`}
            type="number"
            min="1"
            value={value.startRow ?? ''}
            placeholder="自動"
            onChange={(e) =>
              onChange({
                ...value,
                startRow: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        {Array.from({ length: count }, (_, i) => (
          <label key={i}>
            {i === 0
              ? `X 欄（${xName}）`
              : count === 3
                ? `${i === 1 ? 'ON' : 'OFF'} Y 欄`
                : `Y 欄（${yName}）`}
            <input
              aria-label={`${prefix}第 ${i + 1} 欄位置`}
              type="number"
              min="1"
              max="256"
              value={value.columns?.[i] ?? ''}
              placeholder={i === 0 ? '自動最左欄' : `自動第 ${i + 1} 欄`}
              onChange={(e) => {
                const columns = [...(value.columns ?? [])];
                columns[i] = e.target.value === '' ? undefined : Number(e.target.value);
                onChange({ ...value, columns });
              }}
            />
          </label>
        ))}
      </div>
      <button className="secondary" onClick={() => onChange({})}>
        恢復自動擷取
      </button>
    </details>
  );
}
function Chart({
  series,
  labels,
  xLabel,
  yLabel,
}: {
  series: Point[][];
  labels: string[];
  xLabel: string;
  yLabel: string;
}) {
  const all = series.flat();
  const maxX = Math.max(10, ...all.map((p) => p.db));
  const maxY = Math.max(10, ...all.map((p) => p.mbps ?? 0)) * 1.1;
  const x = (v: number) => 78 + (v / maxX) * 626;
  const y = (v: number) => 352 - (v / maxY) * 294;
  const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('en-US');
  return (
    <svg viewBox="0 0 760 430" role="img" aria-label={`RvR 曲線：X 軸 ${xLabel}，Y 軸 ${yLabel}`}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <line x1="78" x2="704" y1={y((maxY * i) / 5)} y2={y((maxY * i) / 5)} stroke="#e1e7ef" />
          <text x="68" y={y((maxY * i) / 5) + 4} textAnchor="end">
            {fmt((maxY * i) / 5)}
          </text>
          <text x={x((maxX * i) / 5)} y="378" textAnchor="middle">
            {fmt((maxX * i) / 5)}
          </text>
        </g>
      ))}
      <line x1="78" y1="352" x2="704" y2="352" stroke="#8a98ac" />
      <text x="385" y="413" textAnchor="middle">
        {xLabel}
      </text>
      <text transform="translate(20 215) rotate(-90)" textAnchor="middle">
        {yLabel}
      </text>
      {series.map((points, s) => {
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
          <g key={s}>
            <path d={path} fill="none" stroke={colors[s]} strokeWidth="2.5" />
            {points.map((p, i) =>
              p.mbps === null ? null : (
                <circle key={i} cx={x(p.db)} cy={y(p.mbps)} r="3.3" fill={colors[s]}>
                  <title>
                    {labels[s]}: {p.db} {xLabel} / {p.mbps} {yLabel}
                  </title>
                </circle>
              ),
            )}
          </g>
        );
      })}
      {labels.map((label, i) => (
        <g key={label}>
          <line
            x1={220 + i * 170}
            x2={246 + i * 170}
            y1="25"
            y2="25"
            stroke={colors[i]}
            strokeWidth="3"
          />
          <text x={254 + i * 170} y="30">
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}
function App() {
  const [mode, setMode] = useState<Mode>('single');
  const [single, setSingle] = useState('');
  const [common, setCommon] = useState('');
  const [on, setOn] = useState('');
  const [off, setOff] = useState('');
  const [sort, setSort] = useState(true);
  const [metadata, setMetadata] = useState(defaultMetadata);
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
  const labels = mode === 'single' ? [yLabel] : ['TxBF ON', 'TxBF OFF'];
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
      const bytes = makeWorkbook(result.series, source, note, { xLabel, yLabel });
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
      setMessage('Excel 已匯出。開啟後可繼續修改黃色儲存格，圖表直接參照這些數據。');
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
          <span className="eyebrow">工具 02 · MSP 測試後處理</span>
          <h1>RvR Excel 繪圖工具</h1>
          <p>直接貼上 MSP 數值矩陣，預設擷取左上方 dB／Throughput，再下載 Excel。</p>
        </div>
        <span className="offline">離線使用 · v1.1</span>
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
            aria-pressed={mode === key}
            onClick={() => {
              setMode(key);
              setMessage('');
              setFileError('');
            }}
          >
            {title}
          </button>
        ))}
      </nav>
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
            dB 排序（整組數據一起排序）
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
                  onChange={(e) =>
                    setMetadata((previous) => ({
                      ...previous,
                      [mode]: { ...previous[mode], yLabel: e.target.value },
                    }))
                  }
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
            支援 Tab、逗號、分號或空白分隔。每條曲線最多 1,000 點。空白不補 0，重複 dB
            會提示處理。矩陣只擷取第一組連續數據；可修改起始行與欄位。圖片 OCR 尚未加入。
          </p>
        </section>
        <section className="preview">
          <h2>2. 檢查曲線並下載 Excel</h2>
          {result.status === 'ready' ? (
            <>
              <p className="status">
                {result.series
                  .map(
                    (p, i) => `${labels[i]}：${p.filter((v) => v.mbps !== null).length} 個量測點`,
                  )
                  .join(' · ')}
                {result.missing ? ` · ${result.missing} 個空白值（曲線斷開）` : ''}
                {result.reordered ? ' · 已依 dB 排序' : ''}
              </p>
              {result.selections.map((selection, i) => (
                <p className="selection-info" key={i}>
                  {mode === 'separate' ? `${i === 0 ? 'ON' : 'OFF'}：` : ''}從第{' '}
                  {selection.startRow} 行擷取，第 {selection.columns.join('、')} 欄。
                  {selection.ignoredColumns > 0
                    ? `右側／未選取 ${selection.ignoredColumns} 欄不納入曲線。`
                    : ''}
                  {selection.remainingRows > 0
                    ? `下方 ${selection.remainingRows} 行未匯入（只取第一組數據）。`
                    : ''}
                </p>
              ))}
              <Chart
                series={result.series}
                labels={labels}
                xLabel={xLabel || 'dB'}
                yLabel={yLabel || 'Throughput (Mbps)'}
              />
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
          ) : (
            <div className="empty">
              貼上數據後，曲線會即時出現在這裡。
              <br />
              也可以先按「載入示範」查看操作。
            </div>
          )}
          <button
            className="download"
            disabled={result.status !== 'ready' || !xLabel.trim() || !yLabel.trim()}
            onClick={download}
          >
            下載 Excel 原生圖表 .xlsx
          </button>
          <p className="hint">
            Excel 的 Single 工作表用 A／B 欄；TxBF 工作表用 A／B（ON）與 D／E（OFF）。從第 7
            行開始，修改資料後圖表會更新。換一輪測試前先清除舊測點。
            新版取消凍結窗格並顯示格線，圖表不再跨過凍結分界。
          </p>
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
      <footer>
        本工具不連線到 AP 或 MSP。使用你貼入的量測資料繪圖，圖表連線僅表示相鄰測點的趨勢。
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
