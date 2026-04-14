import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'

const TAB_ITEMS = [
  { key: 'input', title: '현황입력' },
  { key: 'monthly', title: '월별현황' },
]

const STATUS_FILTER_ITEMS = [
  { key: 'all', title: '구분(전체)' },
  { key: '예정', title: '예정' },
  { key: '진행', title: '진행' },
  { key: '종료', title: '종료' },
]

function matchesSearchKeyword(row, keyword) {
  const needle = String(keyword || '').trim().toLowerCase()
  if (!needle) return true
  const haystacks = [row.customer_name, row.manager_name, row.start_date, row.end_date, row.scale, row.status]
  return haystacks.some((value) => String(value || '').toLowerCase().includes(needle))
}

const EMPTY_ROW = () => ({
  id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  status: '',
  customer_name: '',
  manager_name: '',
  start_date: '',
  end_date: '',
  scale: '',
})

function parseDate(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace(/\//g, '.').replace(/-/g, '.')
  const parts = normalized.split('.').filter(Boolean)
  if (parts.length === 3) {
    let [year, month, day] = parts.map(part => Number(part))
    if (year < 100) year += 2000
    if (!year || !month || !day) return null
    const parsed = new Date(year, month - 1, day)
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) return null
    return parsed
  }
  const digits = text.replace(/\D/g, '')
  if (digits.length === 6) {
    const year = 2000 + Number(digits.slice(0, 2))
    const month = Number(digits.slice(2, 4))
    const day = Number(digits.slice(4, 6))
    const parsed = new Date(year, month - 1, day)
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) return null
    return parsed
  }
  if (digits.length === 8) {
    const year = Number(digits.slice(0, 4))
    const month = Number(digits.slice(4, 6))
    const day = Number(digits.slice(6, 8))
    const parsed = new Date(year, month - 1, day)
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) return null
    return parsed
  }
  return null
}

function formatDate(value) {
  const parsed = parseDate(value)
  if (!parsed) return String(value || '').trim()
  const yy = String(parsed.getFullYear()).slice(-2)
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  return `${yy}.${mm}.${dd}`
}

function formatSelectionLabel(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getMonth() + 1}월 ${value.getDate()}일 일정선택`
  }
  const parsed = parseDate(value)
  if (!parsed) return '0월 0일 일정선택'
  return `${parsed.getMonth() + 1}월 ${parsed.getDate()}일 일정선택`
}

function parseScale(value) {
  const text = String(value || '').trim().replace(/,/g, '')
  if (!text) return 0
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : 0
}

function formatScale(value) {
  const amount = parseScale(value)
  if (!String(value || '').trim()) return ''
  if (Number.isInteger(amount)) return String(amount)
  return String(amount)
}

function getStatus(startValue, endValue) {
  const start = parseDate(startValue)
  const end = parseDate(endValue)
  if (!start && !end) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const compareStart = start || end
  const compareEnd = end || start
  if (compareStart && today < compareStart) return '예정'
  if (compareEnd && today > compareEnd) return '종료'
  return '진행'
}

function normalizeRow(row, options = {}) {
  const { finalizeDates = true, finalizeScale = true } = options
  const next = {
    id: String(row?.id || EMPTY_ROW().id),
    customer_name: String(row?.customer_name || '').trim(),
    manager_name: String(row?.manager_name || '').trim(),
    start_date: finalizeDates ? formatDate(row?.start_date || '') : String(row?.start_date || '').trim(),
    end_date: finalizeDates ? formatDate(row?.end_date || '') : String(row?.end_date || '').trim(),
    scale: finalizeScale ? formatScale(row?.scale || '') : String(row?.scale || '').trim(),
  }
  return {
    ...next,
    status: getStatus(next.start_date, next.end_date),
    __isNew: Boolean(row?.__isNew),
    __newAt: Number(row?.__newAt || 0),
    source_type: row?.source_type || '',
    source_group_id: row?.source_group_id || '',
    source_event_id: row?.source_event_id || '',
    source_locked: row?.source_locked || 0,
  }
}

function buildMonthlyRows(rows, targetYear = new Date().getFullYear()) {
  const totals = Array.from({ length: 12 }, () => Array.from({ length: 31 }, () => 0))
  rows.forEach((row) => {
    const start = parseDate(row.start_date)
    const end = parseDate(row.end_date)
    const amount = parseScale(row.scale)
    if (!start || !end || !amount) return
    const cursor = new Date(start)
    const limit = new Date(end)
    cursor.setHours(0, 0, 0, 0)
    limit.setHours(0, 0, 0, 0)
    if (cursor > limit) return
    while (cursor <= limit) {
      if (cursor.getFullYear() === targetYear) {
        totals[cursor.getMonth()][cursor.getDate() - 1] += amount
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  })
  return totals.map((days, monthIndex) => ({
    month: monthIndex + 1,
    days: days.map((value) => {
      if (!value) return ''
      return Number.isInteger(value) ? String(value) : `${value}`
    }),
  }))
}

function isDateWithinRow(targetDate, row) {
  const start = parseDate(row.start_date)
  const end = parseDate(row.end_date)
  if (!targetDate || !start || !end) return false
  const cursor = new Date(targetDate)
  cursor.setHours(0, 0, 0, 0)
  const compareStart = new Date(start)
  const compareEnd = new Date(end)
  compareStart.setHours(0, 0, 0, 0)
  compareEnd.setHours(0, 0, 0, 0)
  return cursor >= compareStart && cursor <= compareEnd
}

function serializeRows(rows) {
  return JSON.stringify(rows.map(normalizeRow).map(({ id, status, customer_name, manager_name, start_date, end_date, scale, source_type, source_group_id, source_event_id, source_locked }) => ({
    id,
    status,
    customer_name,
    manager_name,
    start_date,
    end_date,
    scale,
    source_type,
    source_group_id,
    source_event_id,
    source_locked,
  })))
}

function describeRowChanges(previousRow, nextRow) {
  const labels = {
    customer_name: '고객명',
    manager_name: '담당대표',
    start_date: '시작일',
    end_date: '종료일',
    scale: '짐규모',
    status: '구분',
  }
  const changes = []
  Object.keys(labels).forEach((field) => {
    const beforeValue = String(previousRow?.[field] || '').trim() || '-'
    const afterValue = String(nextRow?.[field] || '').trim() || '-'
    if (beforeValue !== afterValue) {
      changes.push(`${labels[field]} ${beforeValue} → ${afterValue}`)
    }
  })
  return changes.join(', ')
}


function getMonthlyCellFillStyle(value) {
  const amount = parseScale(value)
  if (!amount) return '#ffffff'
  if (amount < 17) return '#ccf4da'
  if (amount < 18) return '#ffe1be'
  return '#ffd0d0'
}

function getMonthlyCrossFillStyle({ isSelectedCell, isSelectedCross, baseFill }) {
  if (isSelectedCell) return '#111111'
  if (isSelectedCross) return '#eceff3'
  return baseFill
}

function getMonthlyCrossTextStyle({ isSelectedCell, isHeader }) {
  if (isSelectedCell) return '#ffffff'
  if (isHeader) return '#111111'
  return '#111111'
}

async function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
}

async function buildMonthlyTableCanvas(monthlyRows, selectedMonthlyCell) {
  if (!Array.isArray(monthlyRows) || monthlyRows.length === 0) {
    throw new Error('복사할 월별현황 데이터가 없습니다.')
  }

  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  const paddingX = 18
  const paddingY = 18
  const monthColWidth = 62
  const dayColWidth = 42
  const headerHeight = 40
  const rowHeight = 38
  const borderColor = '#e5e7eb'
  const headerFill = '#f1f5f9'
  const crossFill = '#eceff3'
  const textColor = '#111111'
  const strongBorder = '#111111'

  const tableWidth = monthColWidth + (31 * dayColWidth)
  const tableHeight = headerHeight + (monthlyRows.length * rowHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((tableWidth + paddingX * 2) * scale)
  canvas.height = Math.round((tableHeight + paddingY * 2) * scale)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('표 이미지를 생성하지 못했습니다.')

  context.scale(scale, scale)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, tableWidth + paddingX * 2, tableHeight + paddingY * 2)
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  function drawCell(x, y, width, height, label, options = {}) {
    const {
      fill = '#ffffff',
      color = textColor,
      font = '700 13px Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif',
      border = borderColor,
      lineWidth = 1,
    } = options
    context.fillStyle = fill
    context.fillRect(x, y, width, height)
    context.strokeStyle = border
    context.lineWidth = lineWidth
    context.strokeRect(x + lineWidth / 2, y + lineWidth / 2, width - lineWidth, height - lineWidth)
    context.fillStyle = color
    context.font = font
    context.fillText(String(label ?? ''), x + (width / 2), y + (height / 2) + 0.5)
  }

  const originX = paddingX
  const originY = paddingY
  const hasSelection = Boolean(selectedMonthlyCell?.month && selectedMonthlyCell?.day)

  drawCell(originX, originY, monthColWidth, headerHeight, '월', {
    fill: hasSelection ? crossFill : headerFill,
    font: '800 13px Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif',
  })

  Array.from({ length: 31 }, (_, index) => {
    const day = index + 1
    const isSelectedColumn = selectedMonthlyCell?.day === day
    drawCell(originX + monthColWidth + (index * dayColWidth), originY, dayColWidth, headerHeight, day, {
      fill: isSelectedColumn ? crossFill : headerFill,
      font: '800 12px Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif',
      border: isSelectedColumn ? strongBorder : borderColor,
      lineWidth: isSelectedColumn ? 2 : 1,
    })
  })

  monthlyRows.forEach((row, rowIndex) => {
    const y = originY + headerHeight + (rowIndex * rowHeight)
    const isSelectedRow = selectedMonthlyCell?.month === row.month
    drawCell(originX, y, monthColWidth, rowHeight, `${row.month}월`, {
      fill: isSelectedRow ? crossFill : headerFill,
      font: '800 12px Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif',
      border: isSelectedRow ? strongBorder : borderColor,
      lineWidth: isSelectedRow ? 2 : 1,
    })
    row.days.forEach((value, dayIndex) => {
      const day = dayIndex + 1
      const isSelectedColumn = selectedMonthlyCell?.day === day
      const isSelectedCell = isSelectedRow && isSelectedColumn
      const isSelectedCross = !isSelectedCell && (isSelectedRow || isSelectedColumn)
      const baseFill = getMonthlyCellFillStyle(value)
      drawCell(originX + monthColWidth + (dayIndex * dayColWidth), y, dayColWidth, rowHeight, value || '', {
        fill: getMonthlyCrossFillStyle({ isSelectedCell, isSelectedCross, baseFill }),
        color: getMonthlyCrossTextStyle({ isSelectedCell, isHeader: false }),
        font: value ? '800 12px Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif' : '500 12px Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif',
        border: (isSelectedCell || isSelectedCross) ? strongBorder : borderColor,
        lineWidth: (isSelectedCell || isSelectedCross) ? 2 : 1,
      })
    })
  })

  return canvas
}

async function copyMonthlyTableAsImage(monthlyRows, selectedMonthlyCell) {
  const canvas = await buildMonthlyTableCanvas(monthlyRows, selectedMonthlyCell)
  const pngBlob = await canvasToPngBlob(canvas)
  if (!pngBlob) throw new Error('표 이미지를 생성하지 못했습니다.')
  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    return
  }
  throw new Error('이미지 클립보드 복사를 지원하지 않는 브라우저입니다.')
}

function getMonthlyCellTone(value) {
  const amount = parseScale(value)
  if (!amount) return ''
  if (amount < 17) return 'is-safe'
  if (amount < 18) return 'is-warn'
  return 'is-danger'
}

export default function StorageStatusPage() {
  const [tab, setTab] = useState('input')
  const [rows, setRows] = useState([])
  const [baselineRows, setBaselineRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [detailModalDate, setDetailModalDate] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedMonthlyCell, setSelectedMonthlyCell] = useState(null)
  const [copyMessage, setCopyMessage] = useState('')
  const monthlyTableRef = useRef(null)

  const handleCopyMonthlyTable = useCallback(async () => {
    setError('')
    setSavedMessage('')
    setCopyMessage('')
    try {
      await copyMonthlyTableAsImage(monthlyRows, selectedMonthlyCell)
      setCopyMessage('월별현황 표가 이미지로 복사되었습니다.')
      window.setTimeout(() => setCopyMessage(''), 1800)
    } catch (err) {
      setError(err?.message || '월별현황 표 복사에 실패했습니다.')
    }
  }, [monthlyRows, selectedMonthlyCell])

  const isDirty = useMemo(
    () => serializeRows(rows) !== serializeRows(baselineRows),
    [rows, baselineRows],
  )


  useEffect(() => {
    if (!detailModalDate) return undefined
    const handleEscape = (event) => {
      if (event.key === 'Escape') setDetailModalDate(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [detailModalDate])

  useEffect(() => {
    if (!isDirty) return undefined
    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api('/api/storage-status/state')
      const nextRows = Array.isArray(response?.state?.rows) ? response.state.rows.map(normalizeRow) : []
      setRows(nextRows)
      setBaselineRows(nextRows)
    } catch (err) {
      setError(err?.message || '짐보관현황 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rows.some((row) => row.id === id)))
  }, [rows])

  const updateRow = useCallback((rowId, field, value) => {
    setRows((prev) => prev.map((row) => {
      if (row.id !== rowId) return row
      const next = { ...row, [field]: value }
      return normalizeRow(next, { finalizeDates: false, finalizeScale: false })
    }))
  }, [])

  const addRow = useCallback(() => {
    const nextRow = normalizeRow({
      ...EMPTY_ROW(),
      __isNew: true,
      __newAt: Date.now(),
    }, { finalizeDates: false, finalizeScale: false })
    setRows((prev) => [nextRow, ...prev])
  }, [])

  const toggleSelectedRow = useCallback((rowId) => {
    setSelectedIds((prev) => prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId])
  }, [])

  const filteredRows = useMemo(() => {
    const statusOrder = { '예정': 0, '진행': 1, '종료': 2, '': 3 }

    const statusFilteredRows = rows.filter((row) => {
      if (statusFilter === 'all') return row.status !== '종료'
      return row.status === statusFilter
    })

    return statusFilteredRows
      .filter((row) => matchesSearchKeyword(row, searchKeyword))
      .slice()
      .sort((a, b) => {
        if (a.__isNew && b.__isNew) {
          return (b.__newAt || 0) - (a.__newAt || 0)
        }
        if (a.__isNew) return -1
        if (b.__isNew) return 1

        if (statusFilter === 'all') {
          const statusCompare = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
          if (statusCompare !== 0) return statusCompare
        }

        const aDate = parseDate(a.start_date)
        const bDate = parseDate(b.start_date)

        if (aDate && bDate) {
          const timeCompare = aDate.getTime() - bDate.getTime()
          if (timeCompare !== 0) return timeCompare
        } else if (aDate && !bDate) {
          return -1
        } else if (!aDate && bDate) {
          return 1
        }

        const customerCompare = String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'ko')
        if (customerCompare !== 0) return customerCompare

        return String(a.id || '').localeCompare(String(b.id || ''), 'en')
      })
  }, [rows, statusFilter, searchKeyword])

  const visibleRowIds = useMemo(() => filteredRows.map((row) => row.id), [filteredRows])

  const areAllVisibleSelected = useMemo(() => visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedIds.includes(id)), [visibleRowIds, selectedIds])

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      if (visibleRowIds.length === 0) return prev
      if (visibleRowIds.every((id) => prev.includes(id))) {
        return prev.filter((id) => !visibleRowIds.includes(id))
      }
      return Array.from(new Set([...prev, ...visibleRowIds]))
    })
  }, [visibleRowIds])

  const deleteSelectedRows = useCallback(() => {
    if (selectedIds.length === 0) {
      window.alert('삭제할 일정을 선택해주세요.')
      return
    }
    const confirmed = window.confirm(`선택한 ${selectedIds.length}개의 일정을 삭제하시겠습니까?`)
    if (!confirmed) return
    setRows((prev) => prev.filter((row) => !selectedIds.includes(row.id)))
    setSelectedIds([])
  }, [selectedIds])

  const runSearch = useCallback(() => {
    setSearchKeyword(searchInput.trim())
  }, [searchInput])

  const handleSearchKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setSearchKeyword(searchInput.trim())
    }
  }, [searchInput])

  const save = useCallback(async (rowsToSave = rows) => {
    setSaving(true)
    setError('')
    setSavedMessage('')
    try {
      const payloadRows = rowsToSave.map(normalizeRow)
      const response = await api('/api/storage-status/state', {
        method: 'POST',
        body: JSON.stringify({ rows: payloadRows }),
      })
      const nextRows = Array.isArray(response?.state?.rows) ? response.state.rows.map(normalizeRow) : []
      setRows(nextRows)
      setBaselineRows(nextRows)
      setSavedMessage('저장되었습니다.')
      window.setTimeout(() => setSavedMessage(''), 1500)
      return true
    } catch (err) {
      setError(err?.message || '짐보관현황 저장에 실패했습니다.')
      return false
    } finally {
      setSaving(false)
    }
  }, [rows])

  const handleTabChange = useCallback(async (nextTab) => {
    if (nextTab === tab) return
    if (tab === 'input' && isDirty) {
      const changedRow = rows.find((row) => {
        const previousRow = baselineRows.find((item) => item.id === row.id) || {}
        return describeRowChanges(previousRow, row)
      }) || rows[0]
      const baselineRow = baselineRows.find((row) => row.id === changedRow?.id) || baselineRows[0] || {}
      const customerName = changedRow?.customer_name || baselineRow?.customer_name || '미지정'
      const changeSummary = describeRowChanges(baselineRow, changedRow)
      const confirmed = window.confirm(`${customerName} 고객님의 일정이 ${changeSummary || '변경됨'}으로 변경되었습니다. 저장하시겠습니까?`)
      if (!confirmed) {
        setTab('input')
        return
      }
      const saved = await save(rows)
      if (!saved) return
    }
    setTab(nextTab)
  }, [tab, isDirty, rows, baselineRows, save])

  const monthlyTargetYear = useMemo(() => new Date().getFullYear(), [])
  const monthlyRows = useMemo(() => buildMonthlyRows(rows, monthlyTargetYear), [rows, monthlyTargetYear])
  const detailRows = useMemo(() => rows.filter((row) => isDateWithinRow(detailModalDate, row)), [rows, detailModalDate])

  const changedCellMap = useMemo(() => {
    const map = {}
    rows.forEach((row, index) => {
      const previousRow = baselineRows.find((item) => item.id === row.id) || baselineRows[index] || {}
      const changedFields = new Set()
      ;['customer_name', 'manager_name', 'start_date', 'end_date', 'scale', 'status'].forEach((field) => {
        if (String(previousRow?.[field] || '').trim() !== String(row?.[field] || '').trim()) {
          changedFields.add(field)
        }
      })
      map[row.id] = changedFields
    })
    return map
  }, [rows, baselineRows])

  const handleMonthlyCellClick = useCallback((month, day) => {
    const targetDate = new Date(new Date().getFullYear(), month - 1, day)
    targetDate.setHours(0, 0, 0, 0)
    setDetailModalDate(targetDate)
  }, [])

  return (
    <div className="feature-card storage-status-shell">
      <div className="storage-status-category-bar">
        <div className="settlement-tabs settlement-tabs-inline storage-status-tabs" role="tablist" aria-label="짐보관현황 카테고리">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? 'ghost settlement-tab active' : 'ghost settlement-tab'}
              onClick={() => handleTabChange(item.key)}
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {tab === 'input' ? (
        <div className="storage-status-toolbar-stack">
          <div className="storage-status-toolbar storage-status-toolbar-actions-row">
            <div className="storage-status-toolbar-spacer" aria-hidden="true" />
            <div className="storage-status-actions">
              <button type="button" className="small ghost danger" onClick={deleteSelectedRows}>삭제</button>
              <button type="button" className="small ghost" onClick={addRow}>행추가</button>
              <button type="button" className="small" onClick={() => save(rows)} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
            </div>
          </div>
          <div className="storage-status-toolbar storage-status-toolbar-filter-row">
            <div className="storage-status-filter-wrap">
              
              <select
                id="storage-status-filter"
                className="storage-status-filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_FILTER_ITEMS.map((item) => (
                  <option key={item.key} value={item.key}>{item.title}</option>
                ))}
              </select>
            </div>
            <div className="storage-status-search-wrap">
              <input
                type="text"
                className="storage-status-search-input"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="고객명, 담당대표, 날짜 검색"
                aria-label="현황입력 검색"
              />
              <button type="button" className="small ghost storage-status-search-button" onClick={runSearch} aria-label="검색">검색</button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="storage-status-feedback is-error">{error}</div> : null}
      {savedMessage ? <div className="storage-status-feedback is-success">{savedMessage}</div> : null}
      {copyMessage ? <div className="storage-status-feedback is-success">{copyMessage}</div> : null}
      {loading ? <div className="muted">짐보관현황을 불러오는 중입니다.</div> : null}

      {!loading && tab === 'input' ? (
        <div className="storage-status-table-wrap">
          <table className="storage-status-table storage-status-table-input">
            <colgroup>
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th className="storage-status-check-col">
                  <input
                    type="checkbox"
                    checked={areAllVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="전체 선택"
                  />
                </th>
                <th>구분</th>
                <th>고객명</th>
                <th>담당대표</th>
                <th>시작일</th>
                <th>종료일</th>
                <th><span className="storage-status-scale-label">짐규모</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="storage-status-empty">등록된 짐보관 현황이 없습니다.</td>
                </tr>
) : filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="storage-status-check-col">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelectedRow(row.id)}
                      aria-label={`${row.customer_name || '일정'} 선택`}
                    />
                  </td>
                  <td className={changedCellMap[row.id]?.has('status') ? 'storage-status-cell-changed' : ''}>
                    <span className={`storage-status-badge is-${row.status || 'empty'}`}>{row.status || '-'}</span>
                  </td>
                  <td className={changedCellMap[row.id]?.has('customer_name') ? 'storage-status-cell-changed' : ''}>
                    <input value={row.customer_name} onChange={(e) => updateRow(row.id, 'customer_name', e.target.value)} placeholder="고객명" />
                  </td>
                  <td className={changedCellMap[row.id]?.has('manager_name') ? 'storage-status-cell-changed' : ''}>
                    <input value={row.manager_name} onChange={(e) => updateRow(row.id, 'manager_name', e.target.value)} placeholder="담당대표" />
                  </td>
                  <td className={changedCellMap[row.id]?.has('start_date') ? 'storage-status-cell-changed' : ''}>
                    <input value={row.start_date} onChange={(e) => updateRow(row.id, 'start_date', e.target.value)} placeholder="26.05.01" />
                  </td>
                  <td className={changedCellMap[row.id]?.has('end_date') ? 'storage-status-cell-changed' : ''}>
                    <input value={row.end_date} onChange={(e) => updateRow(row.id, 'end_date', e.target.value)} placeholder="26.05.01" />
                  </td>
                  <td className={changedCellMap[row.id]?.has('scale') ? 'storage-status-cell-changed' : ''}>
                    <input value={row.scale} onChange={(e) => updateRow(row.id, 'scale', e.target.value)} onBlur={(e) => updateRow(row.id, 'scale', formatScale(e.target.value))} placeholder="1" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && tab === 'monthly' ? (
        <div className="storage-status-monthly-panel">
          <div className="storage-status-monthly-panel-header">
            <div className="storage-status-monthly-panel-title">월별현황 표</div>
            <button type="button" className="small ghost storage-status-copy-button" onClick={handleCopyMonthlyTable}>복사</button>
          </div>
          <div className="storage-status-table-wrap storage-status-table-wrap-monthly">
            <div ref={monthlyTableRef} className="storage-status-monthly-copy-target">
              <table className="storage-status-table is-monthly storage-status-table-monthly">
                <thead>
                  <tr>
                    <th className={selectedMonthlyCell ? 'is-selected-cross' : ''}>월</th>
                    {Array.from({ length: 31 }, (_, index) => {
                      const day = index + 1
                      const isSelectedColumn = selectedMonthlyCell?.day === day
                      return <th key={day} className={isSelectedColumn ? 'is-selected-cross' : ''}>{day}</th>
                    })}
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => {
                    const isSelectedRow = selectedMonthlyCell?.month === row.month
                    return (
                    <tr key={row.month}>
                      <th className={isSelectedRow ? 'is-selected-cross' : ''}>{row.month}월</th>
                      {row.days.map((value, index) => {
                        const day = index + 1
                        const toneClass = getMonthlyCellTone(value)
                        const clickableClass = value ? 'is-clickable' : ''
                        const isSelectedColumn = selectedMonthlyCell?.day === day
                        const isSelectedCell = isSelectedRow && isSelectedColumn
                        const crossClass = isSelectedCell
                          ? 'is-selected-cell'
                          : (isSelectedRow || isSelectedColumn ? 'is-selected-cross' : '')
                        return (
                          <td
                            key={day}
                            className={`${toneClass} ${clickableClass} ${crossClass}`.trim()}
                            onClick={value ? () => handleMonthlyCellClick(row.month, day) : undefined}
                            role={value ? 'button' : undefined}
                            tabIndex={value ? 0 : undefined}
                            onKeyDown={value ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                handleMonthlyCellClick(row.month, day)
                              }
                            } : undefined}
                            aria-label={value ? `${row.month}월 ${day}일 짐규모 세부현황 열기` : undefined}
                          >
                            {value}
                          </td>
                        )
                      })}
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {detailModalDate ? (
        <div className="storage-status-modal-backdrop" role="dialog" aria-modal="true" aria-label="짐규모 세부현황" onClick={() => setDetailModalDate(null)}>
          <div className="storage-status-modal" onClick={(event) => event.stopPropagation()}>
            <div className="storage-status-modal-header">
              <button
                type="button"
                className="ghost storage-status-modal-back"
                onClick={() => setDetailModalDate(null)}
                aria-label="뒤로가기"
              >
                ←
              </button>
              <strong>짐규모 세부현황</strong>
              <span className="storage-status-modal-date">{formatSelectionLabel(detailModalDate)}</span>
            </div>
            <div className="storage-status-modal-body">
              <table className="storage-status-detail-table">
                <thead>
                  <tr>
                    <th>고객명</th>
                    <th>담당대표</th>
                    <th>시작일</th>
                    <th>종료일</th>
                    <th>짐규모</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="storage-status-empty">해당 일자의 짐보관 일정이 없습니다.</td>
                    </tr>
                  ) : detailRows.map((row) => (
                    <tr key={`detail-${row.id}`}>
                      <td>{row.customer_name || '-'}</td>
                      <td>{row.manager_name || '-'}</td>
                      <td>{row.start_date || '-'}</td>
                      <td>{row.end_date || '-'}</td>
                      <td>{row.scale || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  )
}
