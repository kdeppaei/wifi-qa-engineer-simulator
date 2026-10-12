import { useMemo, useRef, useState } from 'react';
import {
  blankPeakValues,
  createPeakDocument,
  getPeakRows,
  peakCellValue,
  rowKey,
  validatePeakDocument,
} from './model';
import type {
  PeakColumn,
  PeakDocument,
  PeakGroup,
  PeakRow,
  PeakSettings,
  PeakValues,
  PeakDirection,
} from './model';
import { makePeakWorkbook, peakHeaderTextColor } from './workbook';
import './peakTable.css';

const directions: PeakDirection[] = ['UL', 'DL', 'BI'];
const bandExamples = ['6G_UHR320', '5G_UHR160', '2G_UHR40'];
const metadataKeys = new Set(['bandConfig', 'channel', 'direction']);
const coreKeys = new Set(['bandConfig', 'channel', 'direction', 'criteria', 'su', 'mu', 'gain']);
const sourceOptions = [
  '使用者提供數據（未驗證量測來源）',
  'MSP 實機量測（使用者標示）',
  'SIMULATED 模擬數據',
  '示範數據（非實機量測）',
];

function valueHasData(value: PeakValues | undefined) {
  return Boolean(
    value &&
    [value.criteria, value.su, value.mu, value.gain, ...Object.values(value.extra)].some(
      (cell) => cell.trim() !== '',
    ),
  );
}

function displayValue(value: string | number | null, decimals: number) {
  if (value === null) return '—';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: Math.min(6, Math.max(0, decimals)),
      maximumFractionDigits: Math.min(8, Math.max(0, decimals)),
    });
  }
  return value;
}

export default function PeakTable() {
  const [doc, setDoc] = useState<PeakDocument>(createPeakDocument);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState<'text' | 'number'>('text');
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [removedGroup, setRemovedGroup] = useState<{ group: PeakGroup; index: number } | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const nextId = useRef(2);
  const rows = useMemo(() => getPeakRows(doc), [doc]);
  const errors = useMemo(() => validatePeakDocument(doc), [doc]);
  const visibleColumns = doc.columns.filter((column) => column.visible);
  const canAddGroup = rows.length <= 998;
  const canExport = errors.length === 0;

  function changeSetting<K extends keyof PeakSettings>(key: K, value: PeakSettings[K]) {
    setDoc((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
    setMessage('');
  }

  function changeGroup(id: string, updates: Partial<PeakGroup>) {
    setDoc((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.id === id ? { ...group, ...updates } : group)),
    }));
    setMessage('');
  }

  function changeDirection(group: PeakGroup, direction: PeakDirection, enabled: boolean) {
    const selected = new Set(group.directions);
    if (enabled) selected.add(direction);
    else selected.delete(direction);
    changeGroup(group.id, { directions: directions.filter((item) => selected.has(item)) });
  }

  function addGroup() {
    const id = `group-${Date.now()}-${nextId.current++}`;
    setDoc((current) => ({
      ...current,
      groups: [...current.groups, { id, bandConfig: '', channel: '', directions: ['UL', 'DL'] }],
    }));
    setMessage('已新增設定組，請填 Band/Config 與 Channel，再勾選要測的方向。');
  }

  function removeGroup(group: PeakGroup, confirmed = false) {
    const hasData = directions.some((direction) =>
      valueHasData(doc.values[rowKey(group.id, direction)]),
    );
    if (hasData && !confirmed) {
      setDeleteGroupId(group.id);
      return;
    }
    const index = doc.groups.findIndex((item) => item.id === group.id);
    setRemovedGroup({ group, index });
    setDoc((current) => ({
      ...current,
      groups: current.groups.filter((item) => item.id !== group.id),
    }));
    setDeleteGroupId(null);
    setMessage('已移除設定組。可按「復原移除」恢復最近一組及其已填數值。');
  }

  function undoRemove() {
    if (!removedGroup) return;
    setDoc((current) => {
      const groups = [...current.groups];
      groups.splice(Math.min(removedGroup.index, groups.length), 0, removedGroup.group);
      return { ...current, groups };
    });
    setRemovedGroup(null);
    setMessage('已復原設定組與已填數值。');
  }

  function changeColumn(id: string, updates: Partial<PeakColumn>) {
    setDoc((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === id ? { ...column, ...updates } : column,
      ),
    }));
    setMessage('');
  }

  function moveColumn(index: number, offset: -1 | 1) {
    setDoc((current) => {
      const columns = [...current.columns];
      const next = index + offset;
      [columns[index], columns[next]] = [columns[next], columns[index]];
      return { ...current, columns };
    });
  }

  function addColumn() {
    const label = newColumnName.trim();
    if (!label || doc.columns.length >= 20) return;
    const id = `extra-${Date.now()}-${nextId.current++}`;
    setDoc((current) => ({
      ...current,
      columns: [
        ...current.columns,
        { id, key: id, label, type: newColumnType, visible: true, width: 18 },
      ],
    }));
    setNewColumnName('');
    setMessage('已新增手填欄位。');
  }

  function changeMeasurement(row: PeakRow, column: PeakColumn, value: string) {
    setDoc((current) => {
      const existing = current.values[row.key] ?? blankPeakValues();
      const next = !coreKeys.has(column.key)
        ? { ...existing, extra: { ...existing.extra, [column.key]: value } }
        : { ...existing, [column.key]: value };
      return { ...current, values: { ...current.values, [row.key]: next } };
    });
    setMessage('');
  }

  function rawMeasurement(row: PeakRow, column: PeakColumn) {
    if (!coreKeys.has(column.key)) return row.extra[column.key] ?? '';
    return row[column.key as 'criteria' | 'su' | 'mu' | 'gain'];
  }

  function download(blank = false) {
    if (!canExport) return;
    try {
      const bytes = makePeakWorkbook(doc, blank);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = blank ? 'peak-blank-table.xlsx' : 'peak-results.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        blank
          ? '已下載空白表：保留設定組、方向與外觀，量測欄位全部留空。'
          : '已下載結果表：Excel 的欄名、數值、列及格式都可以編輯。Gain 只包含你手填的值。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel 匯出失敗，請核對表格設定。');
    }
  }

  return (
    <div className="peak-tool">
      <section className="peak-setup">
        <div className="section-heading">
          <span className="step-number">1</span>
          <h2>建立 Peak 測試設定</h2>
        </div>
        <p className="hint">
          指定 Band/Config、Channel 與測試方向。每個方向展開成一列，再到結果表填入量測值。
        </p>
        <div className="peak-task-note">
          <span>Gain 只手填</span>
          <span>
            {doc.groups.length} 個設定組 · {rows.length} 個方向列
          </span>
        </div>
        <div className="peak-metadata">
          <label>
            表格標題
            <input
              aria-label="表格標題"
              value={doc.settings.title}
              onChange={(event) => changeSetting('title', event.target.value)}
            />
          </label>
          <label>
            SU／MU 單位
            <input
              aria-label="SU／MU 單位"
              value={doc.settings.unit}
              onChange={(event) => changeSetting('unit', event.target.value)}
              placeholder="例如 Mbps"
            />
          </label>
          <label>
            數據來源
            <select
              aria-label="Peak 數據來源"
              value={doc.settings.source}
              onChange={(event) => changeSetting('source', event.target.value)}
            >
              {sourceOptions.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </label>
          <label>
            測試名稱／條件（選填）
            <input
              aria-label="Peak 測試名稱／條件"
              value={doc.settings.note}
              onChange={(event) => changeSetting('note', event.target.value)}
              placeholder="例如 DUT、版本、距離與測試日期"
            />
          </label>
        </div>

        <div className="peak-groups">
          <datalist id="peak-band-config-examples">
            {bandExamples.map((band) => (
              <option key={band} value={band} />
            ))}
          </datalist>
          {doc.groups.map((group, index) => (
            <fieldset className="peak-group" key={group.id}>
              <legend>設定組 {index + 1}</legend>
              <div className="peak-group-fields">
                <label>
                  Band/Config
                  <input
                    aria-label={`設定組 ${index + 1} Band/Config`}
                    list="peak-band-config-examples"
                    value={group.bandConfig}
                    placeholder="例如 6G_UHR320"
                    onChange={(event) => changeGroup(group.id, { bandConfig: event.target.value })}
                  />
                </label>
                <label>
                  Channel
                  <input
                    aria-label={`設定組 ${index + 1} Channel`}
                    type="text"
                    inputMode="numeric"
                    value={group.channel}
                    placeholder="例如 37"
                    onChange={(event) => changeGroup(group.id, { channel: event.target.value })}
                  />
                </label>
              </div>
              <div className="peak-group-actions">
                <div className="peak-directions" aria-label={`設定組 ${index + 1} 測試方向`}>
                  {directions.map((direction) => (
                    <label key={direction}>
                      <input
                        aria-label={`設定組 ${index + 1} ${direction}`}
                        type="checkbox"
                        checked={group.directions.includes(direction)}
                        onChange={(event) =>
                          changeDirection(group, direction, event.target.checked)
                        }
                      />
                      {direction}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`移除設定組 ${index + 1}`}
                  onClick={() => removeGroup(group)}
                >
                  移除設定組
                </button>
              </div>
              {deleteGroupId === group.id && (
                <div className="peak-removal" role="status">
                  <p>這組已有手填數值。移除後不會匯出，仍可復原最近一次移除。</p>
                  <button className="secondary" onClick={() => removeGroup(group, true)}>
                    確認移除設定組
                  </button>
                  <button className="secondary" onClick={() => setDeleteGroupId(null)}>
                    保留設定組
                  </button>
                </div>
              )}
            </fieldset>
          ))}
        </div>
        <div className="row">
          <button onClick={addGroup} disabled={!canAddGroup}>
            新增設定組
          </button>
          {removedGroup && <button onClick={undoRemove}>復原移除</button>}
        </div>
        <p className="hint">
          暫時取消某個方向再勾回來，已填數值會保留。Band/Config 與 Channel
          可自行填寫，工具不推測頻道。
        </p>

        <details className="peak-customization">
          <summary>客製化欄位與表格外觀</summary>
          <p className="hint">
            可改欄名、顯示／隱藏、左右移動與調整 Excel
            欄寬。七個預設欄位保留資料角色；新增欄位可選文字或數字。
          </p>
          <div className="peak-column-list">
            {doc.columns.map((column, index) => (
              <div className="peak-column" key={column.id}>
                <label className="peak-column-show">
                  <input
                    aria-label={`顯示欄位 ${index + 1}`}
                    type="checkbox"
                    checked={column.visible}
                    onChange={(event) => changeColumn(column.id, { visible: event.target.checked })}
                  />
                  欄位 {index + 1}
                </label>
                <label>
                  名稱
                  <input
                    aria-label={`欄位 ${index + 1} 名稱`}
                    value={column.label}
                    onChange={(event) => changeColumn(column.id, { label: event.target.value })}
                  />
                </label>
                <label>
                  Excel 欄寬
                  <input
                    aria-label={`欄位 ${index + 1} 寬度`}
                    type="number"
                    min="8"
                    max="60"
                    value={column.width}
                    onChange={(event) =>
                      changeColumn(column.id, { width: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  資料類型
                  <select
                    aria-label={`欄位 ${index + 1} 類型`}
                    value={column.type}
                    disabled={coreKeys.has(column.key)}
                    onChange={(event) =>
                      changeColumn(column.id, { type: event.target.value as 'text' | 'number' })
                    }
                  >
                    <option value="text">文字</option>
                    <option value="number">數字</option>
                  </select>
                </label>
                <div className="peak-column-actions">
                  <button
                    aria-label={`欄位 ${index + 1} 向左移`}
                    className="secondary"
                    disabled={index === 0}
                    onClick={() => moveColumn(index, -1)}
                  >
                    ←
                  </button>
                  <button
                    aria-label={`欄位 ${index + 1} 向右移`}
                    className="secondary"
                    disabled={index === doc.columns.length - 1}
                    onClick={() => moveColumn(index, 1)}
                  >
                    →
                  </button>
                  {!coreKeys.has(column.key) && (
                    <button
                      className="secondary"
                      aria-label={`移除欄位 ${index + 1}`}
                      onClick={() =>
                        setDoc((current) => ({
                          ...current,
                          columns: current.columns.filter((item) => item.id !== column.id),
                        }))
                      }
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="peak-add-column">
            <label>
              新增欄位名稱
              <input
                aria-label="新增欄位名稱"
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                placeholder="例如 備註或 DUT 版本"
              />
            </label>
            <label>
              新增欄位類型
              <select
                aria-label="新增欄位類型"
                value={newColumnType}
                onChange={(event) => setNewColumnType(event.target.value as 'text' | 'number')}
              >
                <option value="text">文字</option>
                <option value="number">數字</option>
              </select>
            </label>
            <button
              onClick={addColumn}
              disabled={!newColumnName.trim() || doc.columns.length >= 20}
            >
              新增欄位
            </button>
          </div>
          <div className="peak-style-grid">
            <label>
              表格標頭顏色
              <input
                aria-label="表格標頭顏色"
                type="color"
                value={doc.settings.headerColor}
                onChange={(event) => changeSetting('headerColor', event.target.value)}
              />
            </label>
            <label>
              字體大小
              <input
                aria-label="表格字體大小"
                type="number"
                min="8"
                max="16"
                value={doc.settings.fontSize}
                onChange={(event) => changeSetting('fontSize', Number(event.target.value))}
              />
            </label>
            <label>
              數字小數位數
              <input
                aria-label="表格小數位數"
                type="number"
                min="0"
                max="6"
                value={doc.settings.decimals}
                onChange={(event) => changeSetting('decimals', Number(event.target.value))}
              />
            </label>
            <label className="peak-checkbox">
              <input
                aria-label="交錯列底色"
                type="checkbox"
                checked={doc.settings.bandedRows}
                onChange={(event) => changeSetting('bandedRows', event.target.checked)}
              />
              交錯列底色
            </label>
          </div>
        </details>
      </section>

      <section className="peak-results">
        <div className="preview-toolbar peak-results-toolbar">
          <div className="section-heading">
            <span className="step-number">2</span>
            <h2>手填數值與核對報告</h2>
          </div>
          <div className="peak-downloads">
            <button
              className="download"
              disabled={!canExport}
              onClick={() => download(false)}
              aria-describedby="peak-export-status"
            >
              下載 Peak Excel .xlsx
            </button>
            <button disabled={!canExport} onClick={() => download(true)}>
              下載 Peak 空白表 .xlsx
            </button>
          </div>
        </div>
        <p id="peak-export-status" className="hint export-status">
          {canExport
            ? '表格可下載；量測欄位可留空，Gain 保留你手填的內容。'
            : '請修正標題、設定組或數值格式後再下載。'}
        </p>
        <div className="peak-table-caption">
          <h3>{doc.settings.title || '未命名表格'}</h3>
          <p>
            SU／MU 單位：{doc.settings.unit || '未指定'} · {rows.length} 個測試方向列
          </p>
          <p>
            來源：{doc.settings.source}
            {doc.settings.note && ` ／ ${doc.settings.note}`}
          </p>
        </div>
        <p className="hint">
          在下表直接填入量測值。空白保持空白，0 保留為數字
          0。前面三個欄位由設定組帶入；同一頻段／頻道的不同方向各自保留數值。
        </p>
        <div className={`peak-table-scroll${doc.settings.bandedRows ? ' peak-banded' : ''}`}>
          <table className="peak-edit-table" style={{ fontSize: `${doc.settings.fontSize}px` }}>
            <colgroup>
              {visibleColumns.map((column) => (
                <col key={column.id} style={{ width: `${Math.max(100, column.width * 7)}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.map((column) => (
                  <th
                    key={column.id}
                    style={{
                      backgroundColor: doc.settings.headerColor,
                      color: peakHeaderTextColor(doc.settings.headerColor),
                    }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={
                        column.type === 'number' || column.key === 'gain'
                          ? 'peak-numeric'
                          : undefined
                      }
                    >
                      {metadataKeys.has(column.key) ? (
                        <span>{peakCellValue(row, column, doc.settings)}</span>
                      ) : (
                        <input
                          aria-label={`第 ${index + 1} 列 ${!coreKeys.has(column.key) ? column.label : column.key === 'criteria' ? 'Gain Criteria' : column.key === 'gain' ? 'Gain' : column.key.toUpperCase()}`}
                          value={rawMeasurement(row, column)}
                          inputMode={column.type === 'number' ? 'decimal' : 'text'}
                          placeholder="手填"
                          onChange={(event) => changeMeasurement(row, column, event.target.value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="hint">新增設定組並勾選方向後，這裡會出現可填寫的測試列。</p>
        )}
        <details className="peak-preview">
          <summary>核對顯示格式與匯出欄位</summary>
          <p className="hint">
            下表反映欄位順序、顯示設定與小數格式；格式不會改寫原始量測值。空白以 — 提示，Excel
            中仍留空。
          </p>
          <div className={`peak-table-scroll${doc.settings.bandedRows ? ' peak-banded' : ''}`}>
            <table
              className="peak-preview-table"
              style={{ fontSize: `${doc.settings.fontSize}px` }}
            >
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <th
                      key={column.id}
                      style={{
                        backgroundColor: doc.settings.headerColor,
                        color: peakHeaderTextColor(doc.settings.headerColor),
                      }}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    {visibleColumns.map((column) => (
                      <td
                        key={column.id}
                        className={
                          column.type === 'number' || column.key === 'gain'
                            ? 'peak-numeric'
                            : undefined
                        }
                      >
                        {displayValue(
                          peakCellValue(row, column, doc.settings),
                          column.key === 'channel' ? 0 : doc.settings.decimals,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {errors.length > 0 && (
          <div className="error peak-errors" role="alert">
            <p>請修正下列項目後再下載：</p>
            <ul>
              {errors.map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="hint">
          匯出的 Excel 使用可編輯的原生表格，可修改欄名、量測值、排序、增刪列與格式。 每列保留完整
          Band/Config 與 Channel，方便整理與引用。Gain 始終只手填，空白表不含量測值。
        </p>
        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
