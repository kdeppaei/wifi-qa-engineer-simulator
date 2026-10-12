export type CurveStyle = {
  name: string;
  color: string;
  lineStyle: 'solid' | 'dash' | 'dot' | 'none';
  lineWidth: number;
  marker: 'none' | 'circle' | 'square' | 'diamond' | 'triangle';
  markerSize: number;
};

export type ChartOptions = {
  title: string;
  curves: CurveStyle[];
  showLegend: boolean;
  showGrid: boolean;
};

export function defaultChartOptions(compare: boolean, yLabel = 'Throughput (Mbps)'): ChartOptions {
  const curve = (name: string, color: string): CurveStyle => ({
    name,
    color,
    lineStyle: 'solid',
    lineWidth: 2,
    marker: 'circle',
    markerSize: 5,
  });
  return {
    title: compare ? 'TxBF ON / OFF RvR' : 'RvR Throughput',
    curves: compare
      ? [curve('TxBF ON', '#2563EB'), curve('TxBF OFF', '#DC2626')]
      : [curve(yLabel, '#2563EB')],
    showLegend: true,
    showGrid: true,
  };
}

/** Shared by the live preview and native export so invalid styles cannot diverge. */
export function validateChartOptions(options: ChartOptions, curveCount: number): void {
  if (!options.title.trim() || options.title.length > 180)
    throw new Error('圖表標題請填入 1–180 個字元。');
  if (options.curves.length !== curveCount) throw new Error('曲線樣式組數與資料組數不一致。');
  if (typeof options.showLegend !== 'boolean' || typeof options.showGrid !== 'boolean')
    throw new Error('圖例與格線設定不正確。');
  for (const [index, style] of options.curves.entries()) {
    const name = `第 ${index + 1} 條曲線`;
    if (!style.name.trim() || style.name.length > 120)
      throw new Error(`${name}名稱請填入 1–120 個字元。`);
    if (!/^#[\da-f]{6}$/i.test(style.color)) throw new Error(`${name}請選擇有效的顏色。`);
    if (!['solid', 'dash', 'dot', 'none'].includes(style.lineStyle))
      throw new Error(`${name}線條樣式不正確。`);
    if (!Number.isFinite(style.lineWidth) || style.lineWidth < 0.5 || style.lineWidth > 8)
      throw new Error(`${name}線寬需介於 0.5–8 pt。`);
    if (!['none', 'circle', 'square', 'diamond', 'triangle'].includes(style.marker))
      throw new Error(`${name}測點形狀不正確。`);
    if (!Number.isInteger(style.markerSize) || style.markerSize < 2 || style.markerSize > 16)
      throw new Error(`${name}測點大小需介於 2–16 pt。`);
    if (style.lineStyle === 'none' && style.marker === 'none')
      throw new Error(`${name}至少需顯示線條或測點。`);
  }
}
