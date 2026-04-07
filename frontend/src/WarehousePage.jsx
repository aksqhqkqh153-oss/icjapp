import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { WAREHOUSE_VIEW_CONFIG } from './warehouseViewConfig'

const INPUT_TABS = WAREHOUSE_VIEW_CONFIG.inputTabs
const WAREHOUSE_TABS = WAREHOUSE_VIEW_CONFIG.warehouseTabs
const ROW_HEADER_WIDTH = 52

function pxWidth(value, fallback = 88) {
  const width = Number(value || 0)
  if (!Number.isFinite(width) || width <= 0) return fallback
  return Math.max(40, Math.min(280, Math.round(width * 7)))
}

function pxHeight(value, fallback = 34) {
  const height = Number(value || 0)
  if (!Number.isFinite(height) || height <= 0) return fallback
  return Math.max(24, Math.min(160, Math.round(height)))
}

function colLabel(index) {
  let n = index
  let result = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result || 'A'
}

function buildMergeMaps(merges = []) {
  const startMap = new Map()
  const hiddenMap = new Set()
  merges.forEach((merge) => {
    const key = `${merge.r1}:${merge.c1}`
    startMap.set(key, merge)
    for (let r = merge.r1; r <= merge.r2; r += 1) {
      for (let c = merge.c1; c <= merge.c2; c += 1) {
        if (r === merge.r1 && c === merge.c1) continue
        hiddenMap.add(`${r}:${c}`)
      }
    }
  })
  return { startMap, hiddenMap }
}

function cropSheet(sheet, range) {
  if (!sheet || !range) return null
  const { startRow, endRow, startCol, endCol } = range
  const rowCount = Math.max(0, endRow - startRow + 1)
  const colCount = Math.max(0, endCol - startCol + 1)
  const rows = Array.from({ length: rowCount }, (_, rowOffset) => {
    const sourceRow = sheet.rows?.[startRow - 1 + rowOffset] || []
    return Array.from({ length: colCount }, (_, colOffset) => sourceRow[startCol - 1 + colOffset] ?? '')
  })
  const styles = Array.from({ length: rowCount }, (_, rowOffset) => {
    const sourceRow = sheet.styles?.[startRow - 1 + rowOffset] || []
    return Array.from({ length: colCount }, (_, colOffset) => sourceRow[startCol - 1 + colOffset] || {})
  })
  const merges = (sheet.merges || [])
    .filter((merge) => merge.r1 >= startRow && merge.r2 <= endRow && merge.c1 >= startCol && merge.c2 <= endCol)
    .map((merge) => ({
      r1: merge.r1 - startRow + 1,
      c1: merge.c1 - startCol + 1,
      r2: merge.r2 - startRow + 1,
      c2: merge.c2 - startCol + 1,
    }))

  const colWidths = {}
  for (let col = startCol; col <= endCol; col += 1) {
    const width = sheet.colWidths?.[String(col)]
    if (width !== undefined) colWidths[String(col - startCol + 1)] = width
  }

  const rowHeights = {}
  for (let row = startRow; row <= endRow; row += 1) {
    const height = sheet.rowHeights?.[String(row)]
    if (height !== undefined) rowHeights[String(row - startRow + 1)] = height
  }

  return { rows, styles, merges, colWidths, rowHeights, lastRow: rowCount, lastCol: colCount }
}

function resolveSheetByTab(state, tabConfig) {
  const sourceSheet = state?.sheets?.[tabConfig.sheetName]
  if (!sourceSheet) return null
  if (tabConfig.type === 'range') return cropSheet(sourceSheet, tabConfig.range)
  return sourceSheet
}

function translateRangeCell(tabConfig, row, col) {
  if (tabConfig?.type !== 'range' || !tabConfig?.range) return { row, col }
  return { row: tabConfig.range.startRow + row - 1, col: tabConfig.range.startCol + col - 1 }
}

function displayValue(value) {
  if (value === true) return true
  if (value === false) return false
  if (value === null || value === undefined) return ''
  return String(value)
}

function normalizeLayout(sheet) {
  return {
    colWidths: { ...(sheet?.colWidths || {}) },
    rowHeights: { ...(sheet?.rowHeights || {}) },
  }
}

function sumSpannedWidth(colWidths, startCol, endCol, compact = false) {
  let total = 0
  for (let col = startCol; col <= endCol; col += 1) {
    const base = pxWidth(colWidths?.[String(col)], compact ? 64 : 84)
    total += compact ? Math.max(36, Math.round(base * 0.78)) : base
  }
  return total
}

function sumSpannedHeight(rowHeights, startRow, endRow, compact = false) {
  let total = 0
  for (let row = startRow; row <= endRow; row += 1) {
    const base = pxHeight(rowHeights?.[String(row)], 34)
    total += compact ? Math.max(22, Math.round(base * 0.82)) : base
  }
  return total
}

function sheetCellStyle(sheet, rowIndex, colIndex, cellStyle = {}, compact = false, merge = null) {
  const startCol = colIndex + 1
  const endCol = merge ? merge.c2 : startCol
  const startRow = rowIndex + 1
  const endRow = merge ? merge.r2 : startRow
  const width = sumSpannedWidth(sheet?.colWidths, startCol, endCol, compact)
  const height = sumSpannedHeight(sheet?.rowHeights, startRow, endRow, compact)
  const border = cellStyle.border || {}
  return {
    minWidth: `${width}px`,
    width: `${width}px`,
    minHeight: `${Math.max(compact ? 22 : 28, Math.round(height))}px`,
    height: `${Math.max(compact ? 22 : 28, Math.round(height))}px`,
    backgroundColor: cellStyle.fill ? `#${String(cellStyle.fill).replace(/^#/, '')}` : undefined,
    color: cellStyle.fontColor ? `#${String(cellStyle.fontColor).replace(/^#/, '')}` : undefined,
    fontWeight: cellStyle.fontBold ? 700 : 400,
    fontSize: cellStyle.fontSize ? `${Math.max(compact ? 9 : 10, Math.min(compact ? 15 : 18, Number(cellStyle.fontSize) * (compact ? 0.86 : 1)))}px` : undefined,
    textAlign: cellStyle.hAlign || 'center',
    verticalAlign: cellStyle.vAlign || 'middle',
    whiteSpace: cellStyle.wrap ? 'pre-line' : 'pre-line',
    borderLeft: border.left ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
    borderRight: border.right ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
    borderTop: border.top ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
    borderBottom: border.bottom ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
  }
}

function HeaderResizeHandle({ direction = 'col', onStart }) {
  return (
    <button
      type="button"
      className={`warehouse-resize-handle ${direction === 'row' ? 'is-row' : 'is-col'}`}
      onMouseDown={onStart}
      onTouchStart={onStart}
      aria-label={direction === 'row' ? '행 크기 조절' : '열 크기 조절'}
    />
  )
}

function SpreadsheetTable({ title, sheet, editable = false, onEdit, compact = false, onSaveLayout }) {
  const mergeMaps = useMemo(() => buildMergeMaps(sheet?.merges || []), [sheet])
  const [drafts, setDrafts] = useState({})
  const [resizeMode, setResizeMode] = useState(false)
  const [layoutDraft, setLayoutDraft] = useState(() => normalizeLayout(sheet))
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [layoutSaving, setLayoutSaving] = useState(false)
  const dragStateRef = useRef(null)

  useEffect(() => {
    setDrafts({})
    setLayoutDraft(normalizeLayout(sheet))
    setLayoutDirty(false)
    setResizeMode(false)
  }, [sheet])

  useEffect(() => {
    if (!dragStateRef.current) return undefined
    const onMove = (event) => {
      const drag = dragStateRef.current
      if (!drag) return
      const point = 'touches' in event ? event.touches?.[0] : event
      if ('touches' in event && typeof event.preventDefault === 'function') event.preventDefault()
      if (!point) return
      const delta = drag.axis === 'x' ? point.clientX - drag.start : point.clientY - drag.start
      const nextPx = Math.max(drag.min, drag.initialPx + delta)
      if (drag.type === 'col') {
        const nextExcelWidth = Math.round((nextPx / 7) * 100) / 100
        setLayoutDraft((prev) => ({ ...prev, colWidths: { ...prev.colWidths, [String(drag.index)]: nextExcelWidth } }))
      } else {
        setLayoutDraft((prev) => ({ ...prev, rowHeights: { ...prev.rowHeights, [String(drag.index)]: Math.round(nextPx) } }))
      }
      setLayoutDirty(true)
    }
    const onUp = () => {
      dragStateRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [layoutDirty])

  if (!sheet) return null

  const currentSheet = {
    ...sheet,
    colWidths: layoutDraft.colWidths,
    rowHeights: layoutDraft.rowHeights,
  }

  const startDrag = (type, index, event) => {
    if (!resizeMode) return
    event.preventDefault()
    event.stopPropagation()
    const point = 'touches' in event ? event.touches?.[0] : event
    if (!point) return
    if (type === 'col') {
      dragStateRef.current = {
        type,
        axis: 'x',
        index,
        start: point.clientX,
        initialPx: sumSpannedWidth(layoutDraft.colWidths, index, index, compact),
        min: compact ? 36 : 40,
      }
      return
    }
    dragStateRef.current = {
      type,
      axis: 'y',
      index,
      start: point.clientY,
      initialPx: sumSpannedHeight(layoutDraft.rowHeights, index, index, compact),
      min: compact ? 22 : 24,
    }
  }

  const handleLayoutSave = async () => {
    if (!onSaveLayout || !layoutDirty) return
    setLayoutSaving(true)
    try {
      await onSaveLayout(layoutDraft)
      setLayoutDirty(false)
      setResizeMode(false)
    } finally {
      setLayoutSaving(false)
    }
  }

  const resetLayoutDraft = () => {
    setLayoutDraft(normalizeLayout(sheet))
    setLayoutDirty(false)
    setResizeMode(false)
  }

  return (
    <div className="warehouse-sheet-card">
      <div className="warehouse-sheet-topbar">
        {title ? <div className="warehouse-sheet-title">{title}</div> : <div />}
        <div className="warehouse-sheet-actions">
          <button type="button" className={resizeMode ? 'active' : ''} onClick={() => setResizeMode((prev) => !prev)}>
            셀테두리
          </button>
          {layoutDirty ? (
            <>
              <button type="button" onClick={resetLayoutDraft}>취소</button>
              <button type="button" className="primary" disabled={layoutSaving} onClick={handleLayoutSave}>
                {layoutSaving ? '저장중...' : '저장'}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {resizeMode ? <div className="warehouse-layout-guide">상단 열 머리글과 좌측 행 번호의 경계를 드래그하면 크기를 조절할 수 있습니다.</div> : null}
      <div className="warehouse-sheet-scroll">
        <table className={`warehouse-sheet-table${editable ? ' is-editable' : ''}${compact ? ' is-compact' : ''}${resizeMode ? ' is-resize-mode' : ''}`}>
          <thead>
            <tr>
              <th className="warehouse-corner-header" style={{ width: `${ROW_HEADER_WIDTH}px`, minWidth: `${ROW_HEADER_WIDTH}px` }}>#</th>
              {Array.from({ length: Number(sheet.lastCol || Math.max(0, ...(sheet.rows || []).map((row) => row.length))) }, (_, colIndex) => {
                const width = sumSpannedWidth(layoutDraft.colWidths, colIndex + 1, colIndex + 1, compact)
                return (
                  <th
                    key={`col-h-${colIndex + 1}`}
                    className="warehouse-col-header"
                    style={{ width: `${width}px`, minWidth: `${width}px` }}
                  >
                    <span>{colLabel(colIndex + 1)}</span>
                    {resizeMode ? <HeaderResizeHandle direction="col" onStart={(event) => startDrag('col', colIndex + 1, event)} /> : null}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, rowIndex) => {
              const rowHeight = sumSpannedHeight(layoutDraft.rowHeights, rowIndex + 1, rowIndex + 1, compact)
              return (
                <tr key={`r-${rowIndex + 1}`} style={{ height: `${rowHeight}px` }}>
                  <th className="warehouse-row-header" style={{ height: `${rowHeight}px` }}>
                    <span>{rowIndex + 1}</span>
                    {resizeMode ? <HeaderResizeHandle direction="row" onStart={(event) => startDrag('row', rowIndex + 1, event)} /> : null}
                  </th>
                  {Array.from({ length: Number(sheet.lastCol || row.length) }, (_, colIndex) => {
                    const value = row[colIndex]
                    const rowNo = rowIndex + 1
                    const colNo = colIndex + 1
                    const key = `${rowNo}:${colNo}`
                    if (mergeMaps.hiddenMap.has(key)) return null
                    const merge = mergeMaps.startMap.get(key)
                    const style = sheetCellStyle(currentSheet, rowIndex, colIndex, currentSheet.styles?.[rowIndex]?.[colIndex], compact, merge)
                    const currentValue = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : displayValue(value)
                    const isBool = typeof value === 'boolean'
                    const multiLine = String(currentValue || '').includes('\n') || String(currentValue || '').length > 22
                    return (
                      <td
                        key={key}
                        rowSpan={merge ? merge.r2 - merge.r1 + 1 : 1}
                        colSpan={merge ? merge.c2 - merge.c1 + 1 : 1}
                        style={style}
                      >
                        {editable ? (
                          isBool ? (
                            <label className="warehouse-checkbox-cell">
                              <input
                                type="checkbox"
                                checked={Boolean(currentValue)}
                                onChange={(event) => onEdit?.(rowNo, colNo, event.target.checked)}
                              />
                            </label>
                          ) : multiLine ? (
                            <textarea
                              className="warehouse-cell-textarea"
                              value={currentValue}
                              onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                              onBlur={() => onEdit?.(rowNo, colNo, currentValue)}
                            />
                          ) : (
                            <input
                              className="warehouse-cell-input"
                              value={currentValue}
                              onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                              onBlur={() => onEdit?.(rowNo, colNo, currentValue)}
                            />
                          )
                        ) : (
                          <div className="warehouse-cell-display">{String(value ?? '')}</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function WarehousePage() {
  const [mode, setMode] = useState('input')
  const [inputSite, setInputSite] = useState('galmae')
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [warehouseViewTab, setWarehouseViewTab] = useState('galmae')

  const loadState = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api('/api/warehouse/state')
      setState(response?.state || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  const handleEdit = useCallback(async (row, col, value) => {
    const selectedInputTab = INPUT_TABS.find((item) => item.key === inputSite) || INPUT_TABS[0]
    const sheetName = selectedInputTab?.sheetName
    const translated = translateRangeCell(selectedInputTab, row, col)
    const updateKey = `${sheetName}:${translated.row}:${translated.col}`
    setSavingKey(updateKey)
    try {
      const response = await api('/api/warehouse/cell', {
        method: 'POST',
        body: JSON.stringify({ sheet_name: sheetName, row: translated.row, col: translated.col, value }),
      })
      setState(response?.state || null)
    } finally {
      setSavingKey('')
    }
  }, [inputSite])

  const saveLayoutForTab = useCallback(async (tabConfig, layoutDraft) => {
    if (!tabConfig?.sheetName) return
    const colWidths = {}
    const rowHeights = {}
    const range = tabConfig?.type === 'range' ? tabConfig.range : null
    Object.entries(layoutDraft?.colWidths || {}).forEach(([key, value]) => {
      const idx = Number(key)
      if (!Number.isFinite(idx) || idx < 1) return
      const target = range ? range.startCol + idx - 1 : idx
      colWidths[String(target)] = value
    })
    Object.entries(layoutDraft?.rowHeights || {}).forEach(([key, value]) => {
      const idx = Number(key)
      if (!Number.isFinite(idx) || idx < 1) return
      const target = range ? range.startRow + idx - 1 : idx
      rowHeights[String(target)] = value
    })

    const response = await api('/api/warehouse/layout', {
      method: 'POST',
      body: JSON.stringify({ sheet_name: tabConfig.sheetName, col_widths: colWidths, row_heights: rowHeights }),
    })
    setState(response?.state || null)
  }, [])

  const selectedInputTab = INPUT_TABS.find((item) => item.key === inputSite) || INPUT_TABS[0]
  const currentInputSheet = resolveSheetByTab(state, selectedInputTab)
  const isCompactInputTab = ['gimpo-material-edit', 'galmae-material-edit'].includes(selectedInputTab?.key)

  return (
    <div className="feature-card warehouse-page-shell">
      <div className="warehouse-header-row warehouse-header-row-compact">
        <div className="warehouse-mode-tabs warehouse-mode-tabs-top" role="tablist" aria-label="창고현황 카테고리">
          <button type="button" className={mode === 'input' ? 'active' : ''} onClick={() => setMode('input')}>입력</button>
          <button type="button" className={mode === 'warehouse' ? 'active' : ''} onClick={() => setMode('warehouse')}>창고</button>
        </div>
        {savingKey ? <span className="warehouse-save-indicator">저장중...</span> : null}
      </div>

      <div className="warehouse-mode-tabs warehouse-mode-tabs-hidden" aria-hidden="true">
        <button type="button" className={mode === 'input' ? 'active' : ''} onClick={() => setMode('input')}>입력</button>
        <button type="button" className={mode === 'warehouse' ? 'active' : ''} onClick={() => setMode('warehouse')}>창고</button>
      </div>

      {mode === 'input' ? (
        <>
          <div className="warehouse-sub-tabs">
            {INPUT_TABS.map((item) => (
              <button key={item.key} type="button" className={inputSite === item.key ? 'active' : ''} onClick={() => setInputSite(item.key)}>
                {item.title}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="empty-state">창고 시트를 불러오는 중입니다...</div>
          ) : (
            <SpreadsheetTable
              title={selectedInputTab?.title || selectedInputTab?.sheetName}
              sheet={currentInputSheet}
              editable
              onEdit={handleEdit}
              compact={isCompactInputTab}
              onSaveLayout={(layoutDraft) => saveLayoutForTab(selectedInputTab, layoutDraft)}
            />
          )}
        </>
      ) : (
        <>
          <div className="warehouse-sub-tabs">
            {WAREHOUSE_TABS.map((item) => (
              <button key={item.key} type="button" className={warehouseViewTab === item.key ? 'active' : ''} onClick={() => setWarehouseViewTab(item.key)}>
                {item.title}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="empty-state">창고 시트를 불러오는 중입니다...</div>
          ) : (
            <div className="warehouse-dual-stack">
              {(() => {
                const selectedTab = WAREHOUSE_TABS.find((item) => item.key === warehouseViewTab) || WAREHOUSE_TABS[0]
                const selectedSheet = resolveSheetByTab(state, selectedTab)
                return (
                  <SpreadsheetTable
                    key={selectedTab.key}
                    title={selectedTab.title}
                    sheet={selectedSheet}
                    editable={false}
                    onSaveLayout={(layoutDraft) => saveLayoutForTab(selectedTab, layoutDraft)}
                  />
                )
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}
