import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { WAREHOUSE_VIEW_CONFIG } from './warehouseViewConfig'

const INPUT_TABS = WAREHOUSE_VIEW_CONFIG.inputTabs
const WAREHOUSE_TABS = WAREHOUSE_VIEW_CONFIG.warehouseTabs

function pxWidth(value, fallback = 88) {
  const width = Number(value || 0)
  if (!Number.isFinite(width) || width <= 0) return fallback
  return Math.max(40, Math.min(220, Math.round(width * 7)))
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
    if (width !== undefined) {
      colWidths[String(col - startCol + 1)] = width
    }
  }

  const rowHeights = {}
  for (let row = startRow; row <= endRow; row += 1) {
    const height = sheet.rowHeights?.[String(row)]
    if (height !== undefined) {
      rowHeights[String(row - startRow + 1)] = height
    }
  }

  return {
    rows,
    styles,
    merges,
    colWidths,
    rowHeights,
    lastRow: rowCount,
    lastCol: colCount,
  }
}

function resolveSheetByTab(state, tabConfig) {
  const sourceSheet = state?.sheets?.[tabConfig.sheetName]
  if (!sourceSheet) return null
  if (tabConfig.type === 'range') {
    return cropSheet(sourceSheet, tabConfig.range)
  }
  return sourceSheet
}

function translateRangeCell(tabConfig, row, col) {
  if (tabConfig?.type !== 'range' || !tabConfig?.range) {
    return { row, col }
  }
  return {
    row: tabConfig.range.startRow + row - 1,
    col: tabConfig.range.startCol + col - 1,
  }
}

function displayValue(value) {
  if (value === true) return true
  if (value === false) return false
  if (value === null || value === undefined) return ''
  return String(value)
}

function sheetCellStyle(sheet, rowIndex, colIndex, cellStyle = {}) {
  const width = pxWidth(sheet?.colWidths?.[String(colIndex + 1)], 84)
  const height = Number(sheet?.rowHeights?.[String(rowIndex + 1)] || 34)
  const border = cellStyle.border || {}
  return {
    minWidth: `${width}px`,
    width: `${width}px`,
    minHeight: `${Math.max(28, Math.round(height))}px`,
    backgroundColor: cellStyle.fill ? `#${String(cellStyle.fill).replace(/^#/, '')}` : undefined,
    color: cellStyle.fontColor ? `#${String(cellStyle.fontColor).replace(/^#/, '')}` : undefined,
    fontWeight: cellStyle.fontBold ? 700 : 400,
    fontSize: cellStyle.fontSize ? `${Math.max(10, Math.min(18, Number(cellStyle.fontSize)))}px` : undefined,
    textAlign: cellStyle.hAlign || 'center',
    verticalAlign: cellStyle.vAlign || 'middle',
    whiteSpace: cellStyle.wrap ? 'pre-line' : 'pre-line',
    borderLeft: border.left ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
    borderRight: border.right ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
    borderTop: border.top ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
    borderBottom: border.bottom ? '1px solid rgba(79,92,128,0.32)' : '1px solid rgba(79,92,128,0.18)',
  }
}

function SpreadsheetTable({ title, sheet, editable = false, onEdit }) {
  const mergeMaps = useMemo(() => buildMergeMaps(sheet?.merges || []), [sheet])
  const [drafts, setDrafts] = useState({})

  useEffect(() => {
    setDrafts({})
  }, [sheet])

  if (!sheet) return null

  return (
    <div className="warehouse-sheet-card">
      {title ? <div className="warehouse-sheet-title">{title}</div> : null}
      <div className="warehouse-sheet-scroll">
        <table className={`warehouse-sheet-table${editable ? ' is-editable' : ''}`}>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={`r-${rowIndex + 1}`}>
                {row.map((value, colIndex) => {
                  const rowNo = rowIndex + 1
                  const colNo = colIndex + 1
                  const key = `${rowNo}:${colNo}`
                  if (mergeMaps.hiddenMap.has(key)) return null
                  const merge = mergeMaps.startMap.get(key)
                  const style = sheetCellStyle(sheet, rowIndex, colIndex, sheet.styles?.[rowIndex]?.[colIndex])
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
            ))}
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

  const selectedInputTab = INPUT_TABS.find((item) => item.key === inputSite) || INPUT_TABS[0]
  const currentInputSheet = resolveSheetByTab(state, selectedInputTab)

  return (
    <div className="feature-card warehouse-page-shell">
      <div className="warehouse-header-row">
        <div>
          <h2 style={{ margin: 0 }}>창고현황</h2>
          <p className="feature-description" style={{ marginBottom: 0 }}>
            첨부된 창고 시트 구조를 앱 화면으로 옮긴 화면입니다.
          </p>
        </div>
        {savingKey ? <span className="warehouse-save-indicator">저장중...</span> : null}
      </div>

      <div className="warehouse-mode-tabs">
        <button type="button" className={mode === 'input' ? 'active' : ''} onClick={() => setMode('input')}>입력</button>
        <button type="button" className={mode === 'warehouse' ? 'active' : ''} onClick={() => setMode('warehouse')}>창고</button>
      </div>

      {mode === 'input' ? (
        <>
          <div className="warehouse-sub-tabs">
            {INPUT_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={inputSite === item.key ? 'active' : ''}
                onClick={() => setInputSite(item.key)}
              >
                {item.title}
              </button>
            ))}
          </div>
          {loading ? <div className="empty-state">창고 시트를 불러오는 중입니다...</div> : <SpreadsheetTable title={selectedInputTab?.title || selectedInputTab?.sheetName} sheet={currentInputSheet} editable onEdit={handleEdit} />}
        </>
      ) : (
        <>
          <div className="warehouse-sub-tabs">
            {WAREHOUSE_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={warehouseViewTab === item.key ? 'active' : ''}
                onClick={() => setWarehouseViewTab(item.key)}
              >
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
                return <SpreadsheetTable key={selectedTab.key} title={selectedTab.title} sheet={selectedSheet} editable={false} />
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}
