import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'

const TAB_ITEMS = [
  { key: 'input', title: '현황입력' },
  { key: 'monthly', title: '월별현황' },
]

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
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const digits = text.replace(/\D/g, '')
  if (digits.length === 6) {
    const year = 2000 + Number(digits.slice(0, 2))
    const month = Number(digits.slice(2, 4))
    const day = Number(digits.slice(4, 6))
    const parsed = new Date(year, month - 1, day)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (digits.length === 8) {
    const year = Number(digits.slice(0, 4))
    const month = Number(digits.slice(4, 6))
    const day = Number(digits.slice(6, 8))
    const parsed = new Date(year, month - 1, day)
    return Number.isNaN(parsed.getTime()) ? null : parsed
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

function normalizeRow(row) {
  const next = {
    id: String(row?.id || EMPTY_ROW().id),
    customer_name: String(row?.customer_name || '').trim(),
    manager_name: String(row?.manager_name || '').trim(),
    start_date: formatDate(row?.start_date || ''),
    end_date: formatDate(row?.end_date || ''),
    scale: formatScale(row?.scale || ''),
  }
  return { ...next, status: getStatus(next.start_date, next.end_date) }
}

function buildMonthlyRows(rows) {
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
      totals[cursor.getMonth()][cursor.getDate() - 1] += amount
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

export default function StorageStatusPage() {
  const [tab, setTab] = useState('input')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api('/api/storage-status/state')
      const nextRows = Array.isArray(response?.state?.rows) ? response.state.rows.map(normalizeRow) : []
      setRows(nextRows)
    } catch (err) {
      setError(err?.message || '짐보관현황 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const updateRow = useCallback((rowId, field, value) => {
    setRows((prev) => prev.map((row) => {
      if (row.id !== rowId) return row
      const next = { ...row, [field]: value }
      return normalizeRow(next)
    }))
  }, [])

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, normalizeRow(EMPTY_ROW())])
  }, [])

  const removeRow = useCallback((rowId) => {
    setRows((prev) => prev.filter((row) => row.id !== rowId))
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setError('')
    setSavedMessage('')
    try {
      const payloadRows = rows.map(normalizeRow)
      const response = await api('/api/storage-status/state', {
        method: 'POST',
        body: JSON.stringify({ rows: payloadRows }),
      })
      setRows(Array.isArray(response?.state?.rows) ? response.state.rows.map(normalizeRow) : [])
      setSavedMessage('저장되었습니다.')
      window.setTimeout(() => setSavedMessage(''), 1500)
    } catch (err) {
      setError(err?.message || '짐보관현황 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }, [rows])

  const monthlyRows = useMemo(() => buildMonthlyRows(rows), [rows])

  return (
    <div className="feature-card storage-status-shell">
      <div className="storage-status-topbar">
        <div className="settlement-tabs settlement-tabs-inline storage-status-tabs" role="tablist" aria-label="짐보관현황 카테고리">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? 'ghost settlement-tab active' : 'ghost settlement-tab'}
              onClick={() => setTab(item.key)}
            >
              {item.title}
            </button>
          ))}
        </div>
        {tab === 'input' ? (
          <div className="storage-status-actions">
            <button type="button" className="small ghost" onClick={addRow}>행추가</button>
            <button type="button" className="small" onClick={save} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
          </div>
        ) : null}
      </div>

      {error ? <div className="storage-status-feedback is-error">{error}</div> : null}
      {savedMessage ? <div className="storage-status-feedback is-success">{savedMessage}</div> : null}
      {loading ? <div className="muted">짐보관현황을 불러오는 중입니다.</div> : null}

      {!loading && tab === 'input' ? (
        <div className="storage-status-table-wrap">
          <table className="storage-status-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>고객명</th>
                <th>담당대표</th>
                <th>시작일</th>
                <th>종료일</th>
                <th>짐규모</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="storage-status-empty">등록된 짐보관 현황이 없습니다.</td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  <td><span className={`storage-status-badge is-${row.status || 'empty'}`}>{row.status || '-'}</span></td>
                  <td><input value={row.customer_name} onChange={(e) => updateRow(row.id, 'customer_name', e.target.value)} placeholder="고객명" /></td>
                  <td><input value={row.manager_name} onChange={(e) => updateRow(row.id, 'manager_name', e.target.value)} placeholder="담당대표" /></td>
                  <td><input value={row.start_date} onChange={(e) => updateRow(row.id, 'start_date', e.target.value)} onBlur={(e) => updateRow(row.id, 'start_date', formatDate(e.target.value))} placeholder="26.04.10" /></td>
                  <td><input value={row.end_date} onChange={(e) => updateRow(row.id, 'end_date', e.target.value)} onBlur={(e) => updateRow(row.id, 'end_date', formatDate(e.target.value))} placeholder="26.04.10" /></td>
                  <td><input value={row.scale} onChange={(e) => updateRow(row.id, 'scale', e.target.value)} onBlur={(e) => updateRow(row.id, 'scale', formatScale(e.target.value))} placeholder="1" /></td>
                  <td><button type="button" className="small ghost danger" onClick={() => removeRow(row.id)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && tab === 'monthly' ? (
        <div className="storage-status-table-wrap">
          <table className="storage-status-table is-monthly">
            <thead>
              <tr>
                <th>월</th>
                {Array.from({ length: 31 }, (_, index) => <th key={index + 1}>{index + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((row) => (
                <tr key={row.month}>
                  <th>{row.month}월</th>
                  {row.days.map((value, index) => <td key={index + 1}>{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
