import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, getStoredUser } from './api'
import { DISPOSAL_TEMPLATE } from './disposalTemplateData'

const STORAGE_KEY = 'icj_disposal_records_v2'
const LEGACY_STORAGE_KEY = 'icj_disposal_records_v1'
const TEMPLATE_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const ITEM_ROW_COUNT = 17
const FEE_RATE = 1.3
const FILTER_OPTIONS = [
  { value: 'latest', label: '최신 저장순' },
  { value: 'customer', label: '고객명순' },
  { value: 'date', label: '폐기일자순' },
  { value: 'status', label: '최종현황순' },
]

function createEmptyItem() {
  return { itemName: '', quantity: '', unitCost: '', reportNo: '', note: '' }
}

function createInitialDraft() {
  return {
    disposalDate: '',
    location: '',
    district: '',
    finalStatus: '',
    customerName: '',
    items: Array.from({ length: ITEM_ROW_COUNT }, () => createEmptyItem()),
  }
}

function safeNumber(value) {
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '')
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR')
}

function normalizeRecordShape(record) {
  if (!record || typeof record !== 'object') return null
  const items = Array.from({ length: ITEM_ROW_COUNT }, (_, index) => ({
    ...createEmptyItem(),
    ...(record.items?.[index] || {}),
  }))
  return {
    id: String(record.id || `disposal-${Date.now()}`),
    savedAt: String(record.savedAt || new Date().toISOString()),
    disposalDate: String(record.disposalDate || ''),
    location: String(record.location || ''),
    district: String(record.district || ''),
    finalStatus: String(record.finalStatus || ''),
    customerName: String(record.customerName || ''),
    items,
    totals: {
      totalQty: safeNumber(record?.totals?.totalQty),
      totalReport: safeNumber(record?.totals?.totalReport),
      totalFinal: safeNumber(record?.totals?.totalFinal),
    },
  }
}

function loadRecords() {
  try {
    const primary = localStorage.getItem(STORAGE_KEY)
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    const raw = primary || legacy || '[]'
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed.map(normalizeRecordShape).filter(Boolean) : []
    if (!primary && list.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    }
    return list
  } catch {
    return []
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify((records || []).map(normalizeRecordShape).filter(Boolean)))
}

function getCellRef(colIndex, rowNumber) {
  return `${TEMPLATE_COLUMNS[colIndex]}${rowNumber}`
}

function parseCellRef(ref) {
  const match = String(ref || '').match(/^([A-Z]+)(\d+)$/)
  if (!match) return null
  return { col: match[1], row: Number(match[2]) }
}

function columnIndex(col) {
  return TEMPLATE_COLUMNS.indexOf(col)
}

function buildMergeMap(merges) {
  const hidden = new Set()
  const origins = new Map()
  ;(merges || []).forEach((ref) => {
    const [startRef, endRef] = ref.split(':')
    const start = parseCellRef(startRef)
    const end = parseCellRef(endRef)
    if (!start || !end) return
    const startCol = columnIndex(start.col)
    const endCol = columnIndex(end.col)
    if (startCol < 0 || endCol < 0) return
    origins.set(startRef, {
      colSpan: endCol - startCol + 1,
      rowSpan: end.row - start.row + 1,
    })
    for (let row = start.row; row <= end.row; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const refKey = getCellRef(col, row)
        if (refKey !== startRef) hidden.add(refKey)
      }
    }
  })
  return { hidden, origins }
}

function buildRenderedTemplate(draft) {
  const nextRows = DISPOSAL_TEMPLATE.rows.map((row) => [...row])
  const items = (draft?.items || []).slice(0, ITEM_ROW_COUNT).map(item => ({
    itemName: String(item?.itemName || ''),
    quantity: safeNumber(item?.quantity),
    unitCost: safeNumber(item?.unitCost),
    reportNo: String(item?.reportNo || ''),
    note: String(item?.note || ''),
  }))
  const reportRows = items.map(item => ({
    ...item,
    reportAmount: item.quantity * item.unitCost,
    finalAmount: Math.round(item.quantity * item.unitCost * FEE_RATE),
  }))
  const totalQty = reportRows.reduce((sum, item) => sum + item.quantity, 0)
  const totalReport = reportRows.reduce((sum, item) => sum + item.reportAmount, 0)
  const totalFinal = reportRows.reduce((sum, item) => sum + item.finalAmount, 0)

  nextRows[1][1] = draft?.disposalDate || nextRows[1][1]
  nextRows[1][4] = draft?.finalStatus || nextRows[1][4]
  nextRows[2][1] = draft?.location || ''
  nextRows[3][1] = draft?.district || ''
  nextRows[25][1] = draft?.disposalDate || nextRows[25][1]
  nextRows[26][1] = draft?.location || ''
  nextRows[50][1] = draft?.disposalDate || nextRows[50][1]
  nextRows[51][1] = draft?.location || ''

  reportRows.forEach((item, index) => {
    const sourceRow = 5 + index
    nextRows[sourceRow][1] = item.itemName
    nextRows[sourceRow][2] = item.quantity ? String(item.quantity) : ''
    nextRows[sourceRow][3] = item.unitCost ? String(item.unitCost) : ''
    nextRows[sourceRow][4] = item.reportAmount ? String(item.reportAmount) : '0'
    nextRows[sourceRow][5] = item.finalAmount ? String(item.finalAmount) : '0'
    nextRows[sourceRow][6] = item.reportNo
    nextRows[sourceRow][7] = item.note

    const summaryRow = 29 + index
    nextRows[summaryRow][1] = item.itemName
    nextRows[summaryRow][2] = item.quantity ? String(item.quantity) : ''
    nextRows[summaryRow][3] = item.finalAmount ? String(item.finalAmount) : ''

    const reportNoRow = 54 + index
    nextRows[reportNoRow][1] = item.itemName
    nextRows[reportNoRow][2] = item.quantity ? String(item.quantity) : ''
    nextRows[reportNoRow][3] = item.reportNo
  })

  nextRows[22][2] = totalQty ? String(totalQty) : '0'
  nextRows[22][4] = totalReport ? String(totalReport) : '0'
  nextRows[22][5] = totalFinal ? String(totalFinal) : '0'
  nextRows[47][0] = totalFinal ? String(totalFinal) : '0'

  return {
    rows: nextRows,
    totals: { totalQty, totalReport, totalFinal },
    reportRows,
  }
}

function makeRecordFromDraft(draft, totals, existingId = '') {
  return normalizeRecordShape({
    id: existingId || `disposal-${Date.now()}`,
    savedAt: new Date().toISOString(),
    disposalDate: draft.disposalDate,
    location: draft.location,
    district: draft.district,
    finalStatus: draft.finalStatus,
    customerName: draft.customerName,
    items: draft.items,
    totals,
  })
}

function sortRecords(records, sortKey) {
  const list = [...records]
  if (sortKey === 'customer') return list.sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), 'ko'))
  if (sortKey === 'date') return list.sort((a, b) => String(a.disposalDate || '').localeCompare(String(b.disposalDate || ''), 'ko'))
  if (sortKey === 'status') return list.sort((a, b) => String(a.finalStatus || '').localeCompare(String(b.finalStatus || ''), 'ko'))
  return list.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
}


function formatCurrency(value) {
  return `${formatNumber(value)}원`
}

function getPaymentStatus(record) {
  const status = String(record?.finalStatus || '').trim()
  if (!status) return '미확인'
  if (/입금|완료|정산완료/.test(status)) return '입금완료'
  if (/미입금|대기|보류/.test(status)) return '미입금'
  return status
}

function buildDisposalListGroups(records, sortKey) {
  const grouped = new Map()
  const sorted = sortRecords(records, sortKey === 'latest' ? 'latest' : 'date')
  sorted.forEach((record) => {
    const groupKey = String(record?.disposalDate || '날짜 미지정')
    const groupLabel = record?.disposalDate || '날짜 미지정'
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, { key: groupKey, label: groupLabel, rows: [] })
    }
    const paymentStatus = getPaymentStatus(record)
    const filledItems = (record.items || []).filter(item => {
      return String(item?.itemName || '').trim() || safeNumber(item?.quantity) || safeNumber(item?.unitCost) || String(item?.reportNo || '').trim()
    })
    const sourceItems = filledItems.length ? filledItems : [createEmptyItem()]
    sourceItems.forEach((item, index) => {
      const quantity = safeNumber(item?.quantity)
      const unitCost = safeNumber(item?.unitCost)
      const reportAmount = quantity * unitCost
      const finalAmount = Math.round(reportAmount * FEE_RATE)
      grouped.get(groupKey).rows.push({
        key: `${record.id}-${index}`,
        recordId: record.id,
        customerName: record.customerName || '-',
        itemName: String(item?.itemName || '').trim() || '-',
        quantity,
        unitCost,
        reportAmount,
        finalAmount,
        reportNo: String(item?.reportNo || '').trim() || '-',
        paymentStatus,
        savedAt: record.savedAt || '',
      })
    })
  })
  return Array.from(grouped.values()).map(group => ({
    ...group,
    rows: group.rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))),
  })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'ko'))
}

function DisposalTemplateTable({ title, rendered }) {
  const mergeInfo = useMemo(() => buildMergeMap(DISPOSAL_TEMPLATE.merges), [])
  const columnStyle = useMemo(() => ({
    gridTemplateColumns: DISPOSAL_TEMPLATE.columnWidths.map((width) => `${Math.max(60, width * 5.8)}px`).join(' '),
  }), [])

  return (
    <section className="card disposal-sheet-card disposal-sheet-fit-card">
      <div className="disposal-sheet-head">
        <h3>{title}</h3>
        <div className="notice-text">표 전체가 한 화면 안에 보이도록 축소된 미리보기입니다.</div>
      </div>
      <div className="disposal-sheet-fit-shell">
        <div className="disposal-sheet-fit-scale">
          <div className="disposal-sheet-grid disposal-sheet-grid-fit" style={columnStyle}>
            {rendered.rows.map((row, rowOffset) => {
              const actualRow = rowOffset + 1
              return row.map((value, colIndex) => {
                const cellRef = getCellRef(colIndex, actualRow)
                if (mergeInfo.hidden.has(cellRef)) return null
                const merge = mergeInfo.origins.get(cellRef)
                const classNames = ['disposal-cell', 'fit-cell']
                if ([1, 25, 50].includes(actualRow)) classNames.push('title-cell')
                if ([5, 28, 53].includes(actualRow)) classNames.push('header-cell')
                if ([23, 47, 48].includes(actualRow)) classNames.push('summary-cell')
                if (colIndex === 0) classNames.push('label-cell')
                return (
                  <div
                    key={cellRef}
                    className={classNames.join(' ')}
                    style={{
                      gridColumn: `${colIndex + 1} / span ${merge?.colSpan || 1}`,
                      gridRow: `${rowOffset + 1} / span ${merge?.rowSpan || 1}`,
                      minHeight: `${Math.max(24, (DISPOSAL_TEMPLATE.rowHeights[actualRow - 1] || 28) * 0.55)}px`,
                    }}
                  >
                    <span>{String(value || '').trim() ? String(value) : ' '}</span>
                  </div>
                )
              })
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function DisposalMetaInputs({ draft, updateDraftField, districtResolved }) {
  return (
    <section className="card disposal-entry-card">
      <div className="disposal-meta-layout">
        <div className="disposal-meta-row disposal-meta-row-top">
          <input value={draft.customerName} onChange={e => updateDraftField('customerName', e.target.value)} placeholder="고객명" />
          <input value={draft.disposalDate} onChange={e => updateDraftField('disposalDate', e.target.value)} placeholder="폐기일자" />
          <input value={draft.finalStatus} onChange={e => updateDraftField('finalStatus', e.target.value)} placeholder="최종현황" />
        </div>
        <div className="disposal-meta-row disposal-meta-row-bottom">
          <input value={draft.location} onChange={e => updateDraftField('location', e.target.value)} placeholder="폐기장소" />
          <div className="disposal-district-field">
            <input value={draft.district} onChange={e => updateDraftField('district', e.target.value)} placeholder="관할구역" />
            {districtResolved?.report_link ? (
              <a className="disposal-district-link" href={districtResolved.report_link} target="_blank" rel="noreferrer">
                {districtResolved.district_name || draft.district} 신고 접수 바로가기
              </a>
            ) : (
              <div className="disposal-district-hint">{districtResolved?.matched ? `${districtResolved.place_prefix} 기준 자동 반영` : '등록된 관할구역 링크 없음'}</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function DisposalItemsEditor({ draft, rendered, updateItem }) {
  return (
    <section className="card disposal-items-card">
      <div className="disposal-items-head">
        <h3>폐기 품목 입력</h3>
        <div className="notice-text">수량 × 1개당 비용 = 신고합계, 신고합계 × 1.3 = 최종비용으로 자동 계산됩니다.</div>
      </div>
      <div className="disposal-items-grid-list">
        {rendered.reportRows.map((item, index) => (
          <div key={`disposal-item-${index}`} className="disposal-item-card">
            <div className="disposal-item-card-head">#{index + 1}</div>
            <input value={draft.items[index]?.itemName || ''} onChange={e => updateItem(index, 'itemName', e.target.value)} placeholder="폐기 품목" />
            <div className="disposal-item-row-two">
              <input inputMode="numeric" value={draft.items[index]?.quantity || ''} onChange={e => updateItem(index, 'quantity', e.target.value)} placeholder="수량" />
              <input inputMode="numeric" value={draft.items[index]?.unitCost || ''} onChange={e => updateItem(index, 'unitCost', e.target.value)} placeholder="1개당 비용" />
            </div>
            <div className="disposal-item-row-two muted-metrics">
              <div>신고합계 {formatNumber(item.reportAmount)}원</div>
              <div>최종비용 {formatNumber(item.finalAmount)}원</div>
            </div>
            <div className="disposal-item-row-two">
              <input value={draft.items[index]?.reportNo || ''} onChange={e => updateItem(index, 'reportNo', e.target.value)} placeholder="폐기 신고 번호" />
              <input value={draft.items[index]?.note || ''} onChange={e => updateItem(index, 'note', e.target.value)} placeholder="비고" />
            </div>
          </div>
        ))}
      </div>
      <div className="disposal-inline-summary">
        <span>총 수량 {formatNumber(rendered.totals.totalQty)}</span>
        <span>신고합계 {formatNumber(rendered.totals.totalReport)}원</span>
        <span>최종비용 {formatNumber(rendered.totals.totalFinal)}원</span>
      </div>
    </section>
  )
}


function DisposalSettingsPopover({ open, onClose, onMoveRegistry }) {
  if (!open) return null
  return (
    <div className="disposal-settings-popover">
      <button type="button" className="ghost disposal-settings-popover-item" onClick={() => { onMoveRegistry(); onClose() }}>관할구역등록</button>
    </div>
  )
}

export function DisposalJurisdictionRegistryPage() {
  const navigate = useNavigate()
  const currentUser = getStoredUser() || {}
  const canEdit = Number(currentUser?.grade || 9) <= 2
  const [rows, setRows] = useState([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [filterValue, setFilterValue] = useState('all')

  async function load(keyword = '') {
    setLoading(true)
    try {
      const result = await api(`/api/disposal/jurisdictions${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`, { cache: 'no-store' })
      setRows(Array.isArray(result?.rows) ? result.rows.map((row, index) => ({ ...row, localId: String(row.id || `loaded-${index}`) })) : [])
      setSelectedIds(prev => prev.filter(id => (result?.rows || []).some(row => row.id === id)))
    } catch (error) {
      window.alert(error.message || '관할구역 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load('') }, [])

  const visibleRows = useMemo(() => {
    if (filterValue === 'all') return rows
    return rows.filter(row => String(row.category || '기본') === filterValue)
  }, [rows, filterValue])

  function updateRow(localId, key, value) {
    setRows(prev => prev.map(row => row.localId === localId ? { ...row, [key]: value } : row))
  }

  function addRow() {
    const uid = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setRows(prev => [{ id: null, localId: uid, category: '기본', place_prefix: '', district_name: '', report_link: '' }, ...prev])
  }

  function toggleAll(checked) {
    setSelectedIds(checked ? visibleRows.filter(row => row.id).map(row => row.id) : [])
  }

  function toggleOne(id, checked) {
    if (!id) return
    setSelectedIds(prev => checked ? Array.from(new Set([...prev, id])) : prev.filter(item => item !== id))
  }

  async function saveRows() {
    if (!canEdit) {
      window.alert('관할구역등록 저장 권한이 없습니다.')
      return
    }
    const payloadRows = rows
      .map(row => ({
        id: row.id || undefined,
        category: String(row.category || '기본').trim() || '기본',
        place_prefix: String(row.place_prefix || '').trim(),
        district_name: String(row.district_name || '').trim(),
        report_link: String(row.report_link || '').trim(),
      }))
      .filter(row => row.place_prefix && row.district_name)
    if (!payloadRows.length) {
      window.alert('저장할 관할구역 데이터를 입력해주세요.')
      return
    }
    setSaving(true)
    try {
      await api('/api/disposal/jurisdictions/bulk-save', { method: 'POST', body: JSON.stringify({ rows: payloadRows }) })
      await load(searchKeyword)
      window.alert('관할구역 데이터가 저장되었습니다.')
    } catch (error) {
      window.alert(error.message || '관할구역 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelected() {
    if (!canEdit) {
      window.alert('관할구역등록 삭제 권한이 없습니다.')
      return
    }
    if (!selectedIds.length) {
      window.alert('삭제할 항목을 선택해주세요.')
      return
    }
    if (!window.confirm('선택한 관할구역 항목을 삭제할까요?')) return
    try {
      await api('/api/disposal/jurisdictions/delete', { method: 'POST', body: JSON.stringify({ rows: selectedIds.map(id => ({ id })) }) })
      await load(searchKeyword)
      setSelectedIds([])
      window.alert('선택 항목이 삭제되었습니다.')
    } catch (error) {
      window.alert(error.message || '삭제 중 오류가 발생했습니다.')
    }
  }

  const categoryOptions = useMemo(() => {
    const bucket = new Set(['기본'])
    rows.forEach(row => { if (row.category) bucket.add(row.category) })
    return Array.from(bucket)
  }, [rows])

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>관할구역등록</h2>
          <p className="notice-text">폐기장소의 시/구 기준으로 관할구역명과 폐기신고 링크를 저장·관리하는 화면입니다.</p>
        </div>
        <div className="disposal-hero-actions">
          <button type="button" className="ghost" onClick={() => navigate('/disposal/forms')}>폐기양식</button>
          <button type="button" className="ghost" onClick={addRow}>행추가</button>
          <button type="button" className="ghost" onClick={deleteSelected}>선택삭제</button>
          <button type="button" className="ghost active" onClick={saveRows} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
        </div>
      </section>

      <section className="card disposal-jurisdiction-toolbar-card">
        <div className="disposal-jurisdiction-toolbar">
          <div className="disposal-jurisdiction-toolbar-left">
            <select value={filterValue} onChange={e => setFilterValue(e.target.value)}>
              <option value="all">전체 필터</option>
              {categoryOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="disposal-jurisdiction-toolbar-right">
            <input value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} placeholder="키워드 검색" />
            <button type="button" className="ghost" onClick={() => load(searchKeyword)}>검색</button>
            <button type="button" className="ghost active" onClick={saveRows} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
          </div>
        </div>
      </section>

      <section className="card disposal-records-card disposal-jurisdiction-table-card">
        <div className="disposal-jurisdiction-grid">
          <div className="disposal-jurisdiction-grid-row disposal-jurisdiction-grid-head">
            <label className="disposal-jurisdiction-check-all"><input type="checkbox" checked={visibleRows.length > 0 && visibleRows.every(row => row.id && selectedIds.includes(row.id))} onChange={e => toggleAll(e.target.checked)} /></label>
            <div>구분</div>
            <div>폐기장소 입력칸</div>
            <div>관할구역 입력칸</div>
            <div>관할구역 폐기신고링크 입력칸</div>
          </div>
          {loading ? <div className="empty-state">불러오는 중...</div> : visibleRows.map((row, index) => (
            <div key={row.localId || row.id || `row-${index}`} className="disposal-jurisdiction-grid-row">
              <label><input type="checkbox" checked={!!row.id && selectedIds.includes(row.id)} onChange={e => toggleOne(row.id, e.target.checked)} /></label>
              <input value={row.category || '기본'} onChange={e => updateRow(row.localId, 'category', e.target.value)} disabled={!canEdit} placeholder="구분" />
              <input value={row.place_prefix || ''} onChange={e => updateRow(row.localId, 'place_prefix', e.target.value)} disabled={!canEdit} placeholder="예: 서울특별시 노원구" />
              <input value={row.district_name || ''} onChange={e => updateRow(row.localId, 'district_name', e.target.value)} disabled={!canEdit} placeholder="관할구역명" />
              <input value={row.report_link || ''} onChange={e => updateRow(row.localId, 'report_link', e.target.value)} disabled={!canEdit} placeholder="https://..." />
            </div>
          ))}
          {!loading && visibleRows.length === 0 && <div className="empty-state">등록된 관할구역 데이터가 없습니다.</div>}
        </div>
      </section>
    </div>
  )
}

export function DisposalHubPage() {
  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero disposal-hub-card">
        <div>
          <h2>폐기</h2>
          <p className="notice-text">폐기양식 입력, 폐기목록 관리, 폐기결산 확인 화면으로 이동할 수 있습니다.</p>
        </div>
        <div className="disposal-hub-grid">
          <Link className="disposal-hub-button" to="/disposal/forms">폐기양식</Link>
          <Link className="disposal-hub-button" to="/disposal/list">폐기목록</Link>
          <Link className="disposal-hub-button" to="/disposal/settlements">폐기결산</Link>
        </div>
      </section>
    </div>
  )
}

export function DisposalFormsPage() {
  const navigate = useNavigate()
  const { recordId } = useParams()
  const [draft, setDraft] = useState(createInitialDraft())
  const [savedAt, setSavedAt] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [districtResolved, setDistrictResolved] = useState({ matched: false, district_name: '', report_link: '', place_prefix: '' })
  const settingsRef = useRef(null)

  useEffect(() => {
    if (!recordId) return
    const found = loadRecords().find(record => record.id === recordId)
    if (found) {
      setDraft({
        customerName: found.customerName || '',
        disposalDate: found.disposalDate || '',
        location: found.location || '',
        district: found.district || '',
        finalStatus: found.finalStatus || '',
        items: Array.from({ length: ITEM_ROW_COUNT }, (_, index) => ({ ...createEmptyItem(), ...(found.items?.[index] || {}) })),
      })
      setSavedAt(found.savedAt || '')
    }
  }, [recordId])


useEffect(() => {
  function handleClickOutside(event) {
    if (!settingsRef.current || settingsRef.current.contains(event.target)) return
    setSettingsOpen(false)
  }
  document.addEventListener('mousedown', handleClickOutside)
  return () => document.removeEventListener('mousedown', handleClickOutside)
}, [])

useEffect(() => {
  const trimmed = String(draft.location || '').trim()
  if (!trimmed) {
    setDistrictResolved({ matched: false, district_name: '', report_link: '', place_prefix: '' })
    return
  }
  const timer = window.setTimeout(async () => {
    try {
      const result = await api(`/api/disposal/jurisdictions/resolve?location=${encodeURIComponent(trimmed)}`, { cache: 'no-store' })
      setDistrictResolved(result || { matched: false, district_name: '', report_link: '', place_prefix: '' })
      if (result?.matched && result?.district_name) {
        setDraft(prev => prev.district === result.district_name ? prev : ({ ...prev, district: result.district_name }))
      }
    } catch {
      setDistrictResolved({ matched: false, district_name: '', report_link: '', place_prefix: '' })
    }
  }, 250)
  return () => window.clearTimeout(timer)
}, [draft.location])

  const rendered = useMemo(() => buildRenderedTemplate(draft), [draft])

  function updateDraftField(key, value) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  function updateItem(index, key, value) {
    setDraft(prev => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    }))
  }

  function resetDraft() {
    setDraft(createInitialDraft())
    setSavedAt('')
  }

  function saveSettlementRecord() {
    const nextRecord = makeRecordFromDraft(draft, rendered.totals, recordId)
    const current = loadRecords()
    const next = [nextRecord, ...current.filter(record => record.id !== nextRecord.id)].slice(0, 300)
    saveRecords(next)
    setSavedAt(nextRecord.savedAt)
    window.alert(recordId ? '폐기양식이 수정 저장되었습니다.' : '폐기결산 저장과 함께 폐기목록에 등록되었습니다.')
    navigate('/disposal/list')
  }

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>{recordId ? '폐기양식 상세 수정' : '폐기양식'}</h2>
          <p className="notice-text">저장 시 폐기목록과 폐기결산에서 동시에 관리됩니다.</p>
        </div>
        <div className="disposal-hero-actions" ref={settingsRef}>
          <div className="disposal-settings-inline">
            <button type="button" className="ghost" onClick={() => setSettingsOpen(prev => !prev)}>설정</button>
            <DisposalSettingsPopover open={settingsOpen} onClose={() => setSettingsOpen(false)} onMoveRegistry={() => navigate('/disposal/jurisdictions')} />
          </div>
          <button type="button" className="ghost" onClick={resetDraft}>초기화</button>
          <button type="button" className="ghost" onClick={() => navigate('/disposal/list')}>폐기목록</button>
          <button type="button" className="ghost active" onClick={saveSettlementRecord}>폐기결산 저장</button>
        </div>
      </section>

      <DisposalMetaInputs draft={draft} updateDraftField={updateDraftField} districtResolved={districtResolved} />

      <section className="disposal-form-shell">
        <div className="disposal-form-left">
          <DisposalItemsEditor draft={draft} rendered={rendered} updateItem={updateItem} />
          <div className="disposal-saved-at">최근 저장: {savedAt ? new Date(savedAt).toLocaleString('ko-KR') : '-'}</div>
        </div>
        <div className="disposal-form-right">
          <DisposalTemplateTable title="폐기견적서 전체 미리보기" rendered={rendered} />
        </div>
      </section>
    </div>
  )
}

export function DisposalListPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [sortKey, setSortKey] = useState('latest')

  useEffect(() => {
    setRecords(loadRecords())
  }, [])

  function removeRecord(id) {
    const next = records.filter(record => record.id !== id)
    setRecords(next)
    saveRecords(next)
  }

  const groupedRows = useMemo(() => buildDisposalListGroups(records, sortKey), [records, sortKey])

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>폐기목록</h2>
          <p className="notice-text">폐기양식 저장 건을 폐기날짜별로 묶어 보여줍니다. 행을 누르면 상세입력창으로 이동합니다.</p>
        </div>
        <div className="disposal-hero-actions">
          <button type="button" className="ghost active" onClick={() => navigate('/disposal/forms')}>새 폐기양식</button>
        </div>
      </section>

      <section className="card disposal-settlement-filter-card">
        <div className="disposal-filter-row">
          <div className="disposal-filter-chip-label">정렬필터</div>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)}>
            {FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </section>

      <section className="card disposal-records-card disposal-list-board-card">
        {groupedRows.length === 0 ? (
          <div className="empty-state">저장된 폐기목록이 없습니다.</div>
        ) : groupedRows.map(group => (
          <div key={group.key} className="disposal-list-date-group">
            <div className="disposal-list-date-label">{group.label}</div>
            <div className="disposal-list-grid">
              <div className="disposal-list-grid-row disposal-list-grid-head">
                <div>고객명</div>
                <div>품목</div>
                <div>수량</div>
                <div>개당비용</div>
                <div>신고합계</div>
                <div>최종비용(수수료 포함)</div>
                <div>폐기신고번호</div>
                <div>입금여부</div>
                <div>관리</div>
              </div>
              {group.rows.map(row => (
                <div key={row.key} className="disposal-list-grid-row disposal-list-grid-data-row">
                  <button
                    type="button"
                    className="disposal-list-grid-button"
                    onClick={() => navigate(`/disposal/forms/${row.recordId}`)}
                  >
                    <span>{row.customerName}</span>
                    <span>{row.itemName}</span>
                    <span>{formatNumber(row.quantity)}</span>
                    <span>{formatCurrency(row.unitCost)}</span>
                    <span>{formatCurrency(row.reportAmount)}</span>
                    <span>{formatCurrency(row.finalAmount)}</span>
                    <span>{row.reportNo}</span>
                    <span>{row.paymentStatus}</span>
                  </button>
                  <button type="button" className="ghost disposal-row-delete" onClick={() => removeRecord(row.recordId)}>삭제</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}


function formatGroupDate(value) {
  if (!value) return '날짜 미지정'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('ko-KR')
}

function getSavedDateKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || 'unknown')
  return date.toISOString().slice(0, 10)
}

function getMonthKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonthKey(monthKey, diff) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const base = Number.isFinite(year) && Number.isFinite(month)
    ? new Date(year, month - 1, 1)
    : new Date()
  base.setMonth(base.getMonth() + diff)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(monthKey) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '월 미지정'
  return `${year}년 ${month}월`
}

function filterRecordsByMonth(records, monthKey) {
  return (records || []).filter(record => getMonthKey(record.savedAt) === monthKey)
}

function buildSettlementGroups(records) {
  const grouped = new Map()
  sortRecords(records, 'latest').forEach((record) => {
    const key = getSavedDateKey(record.savedAt)
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: formatGroupDate(record.savedAt),
        records: [],
      })
    }
    grouped.get(key).records.push(record)
  })
  return Array.from(grouped.values())
}

function buildSettlementSalesSheet(monthLabel, monthlyRecords) {
  const totals = monthlyRecords.reduce((acc, record) => {
    const metrics = getRecordSettlementMetrics(record)
    acc.count += 1
    acc.customers.add(String(record?.customerName || '').trim())
    acc.totalQty += metrics.totalQty
    acc.totalReport += metrics.reportAmount
    acc.totalFee += metrics.feeAmount
    acc.totalCancel += metrics.cancelAmount
    acc.totalMinimum += metrics.minimumFee
    return acc
  }, {
    count: 0,
    customers: new Set(),
    totalQty: 0,
    totalReport: 0,
    totalFee: 0,
    totalCancel: 0,
    totalMinimum: 0,
  })

  return [
    ['요약', monthLabel, '', '', '', ''],
    ['구분', '월', '저장건수', '고객수', '총품목수', '비고'],
    ['기준', monthLabel, formatNumber(totals.count), formatNumber(totals.customers.size), formatNumber(totals.totalQty), '월간 집계'],
    ['폐기신고액', `${formatNumber(totals.totalReport)}원`, '폐기수수료', `${formatNumber(totals.totalFee)}원`, '취소신고액', `${formatNumber(totals.totalCancel)}원`],
    ['최소수수료', `${formatNumber(totals.totalMinimum)}원`, '평균신고액', totals.count ? `${formatNumber(Math.round(totals.totalReport / totals.count))}원` : '0원', '평균수수료', totals.count ? `${formatNumber(Math.round(totals.totalFee / totals.count))}원` : '0원'],
    ['최고신고액', `${formatNumber(Math.max(0, ...monthlyRecords.map(record => getRecordSettlementMetrics(record).reportAmount)))}원`, '최고수수료', `${formatNumber(Math.max(0, ...monthlyRecords.map(record => getRecordSettlementMetrics(record).feeAmount)))}원`, '최고최소수수료', `${formatNumber(Math.max(0, ...monthlyRecords.map(record => getRecordSettlementMetrics(record).minimumFee)))}원`],
    ['일평균 건수', formatNumber(groupMonthlyRecordCount(monthlyRecords).dailyAverage), '일평균 품목수', formatNumber(groupMonthlyRecordCount(monthlyRecords).qtyAverage), '일평균 최소수수료', `${formatNumber(groupMonthlyRecordCount(monthlyRecords).minimumAverage)}원`],
    ['집계대상', '저장일 기준', '목록정렬', '최신 저장순', '표시방식', '날짜별 그룹'],
    ['안내', '아래 목록에서 항목 클릭 시 상세 입력 화면으로 이동', '', '', '', ''],
  ]
}

function groupMonthlyRecordCount(monthlyRecords) {
  const days = new Map()
  monthlyRecords.forEach(record => {
    const key = getSavedDateKey(record.savedAt)
    const metrics = getRecordSettlementMetrics(record)
    if (!days.has(key)) days.set(key, { count: 0, qty: 0, minimum: 0 })
    const target = days.get(key)
    target.count += 1
    target.qty += metrics.totalQty
    target.minimum += metrics.minimumFee
  })
  const size = days.size || 1
  const totals = Array.from(days.values()).reduce((acc, day) => {
    acc.count += day.count
    acc.qty += day.qty
    acc.minimum += day.minimum
    return acc
  }, { count: 0, qty: 0, minimum: 0 })
  return {
    dailyAverage: Math.round(totals.count / size),
    qtyAverage: Math.round(totals.qty / size),
    minimumAverage: Math.round(totals.minimum / size),
  }
}

function getRecordSettlementMetrics(record) {
  const totalQty = safeNumber(record?.totals?.totalQty)
  const reportAmount = safeNumber(record?.totals?.totalReport)
  const finalAmount = safeNumber(record?.totals?.totalFinal)
  const feeAmount = Math.max(0, finalAmount - reportAmount)
  return {
    totalQty,
    reportAmount,
    feeAmount,
    cancelAmount: 0,
    minimumFee: finalAmount,
  }
}

export function DisposalSettlementsPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [monthKey, setMonthKey] = useState(getMonthKey(new Date().toISOString()))

  useEffect(() => {
    const loaded = loadRecords()
    setRecords(loaded)
    if (loaded.length) {
      setMonthKey(getMonthKey(loaded[0]?.savedAt || new Date().toISOString()))
    }
  }, [])

  const monthlyRecords = useMemo(() => filterRecordsByMonth(records, monthKey), [records, monthKey])
  const groupedSettlements = useMemo(() => buildSettlementGroups(monthlyRecords), [monthlyRecords])
  const monthLabel = useMemo(() => formatMonthLabel(monthKey), [monthKey])
  const salesSheetRows = useMemo(() => buildSettlementSalesSheet(monthLabel, monthlyRecords), [monthLabel, monthlyRecords])

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>폐기결산</h2>
        </div>
        <div className="disposal-hero-actions">
          <button type="button" className="ghost" onClick={() => navigate('/disposal/list')}>폐기목록</button>
          <button type="button" className="ghost active" onClick={() => navigate('/disposal/forms')}>폐기양식</button>
        </div>
      </section>

      <section className="card disposal-month-switch-card">
        <button type="button" className="ghost" onClick={() => setMonthKey(prev => shiftMonthKey(prev, -1))}>이전 ◀</button>
        <div className="disposal-month-switch-title">{monthLabel}</div>
        <button type="button" className="ghost" onClick={() => setMonthKey(prev => shiftMonthKey(prev, 1))}>다음 ▶</button>
      </section>

      <section className="card disposal-monthly-sheet-card">
        <div className="disposal-sheet-title">월간 데이터 요약</div>
        <div className="disposal-sales-sheet">
          {salesSheetRows.map((row, rowIndex) => (
            <div key={`sales-row-${rowIndex}`} className={`disposal-sales-sheet-row ${rowIndex === 0 ? 'is-title' : rowIndex === 1 ? 'is-head' : ''}`}>
              {row.map((cell, cellIndex) => (
                <div key={`sales-cell-${rowIndex}-${cellIndex}`} className="disposal-sales-sheet-cell">{cell || ''}</div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card disposal-records-card disposal-settlement-board-card">
        {groupedSettlements.length === 0 ? (
          <div className="empty-state">저장된 폐기결산 내역이 없습니다.</div>
        ) : groupedSettlements.map(group => (
          <div key={group.key} className="disposal-settlement-date-group">
            <div className="disposal-settlement-date-label">{group.label}</div>
            <div className="disposal-settlement-grid">
              <div className="disposal-settlement-grid-row disposal-settlement-grid-head">
                <div>고객명</div>
                <div>폐기예정일</div>
                <div>품목수</div>
                <div>폐기신고액</div>
                <div>폐기수수료</div>
                <div>취소신고액</div>
                <div>최소수수료</div>
              </div>
              {group.records.map(record => {
                const metrics = getRecordSettlementMetrics(record)
                return (
                  <button
                    key={record.id}
                    type="button"
                    className="disposal-settlement-grid-row disposal-settlement-grid-button"
                    onClick={() => navigate(`/disposal/forms/${record.id}`)}
                  >
                    <span>{record.customerName || '-'}</span>
                    <span>{record.disposalDate || '-'}</span>
                    <span>{formatNumber(metrics.totalQty)}</span>
                    <span>{formatNumber(metrics.reportAmount)}원</span>
                    <span>{formatNumber(metrics.feeAmount)}원</span>
                    <span>{formatNumber(metrics.cancelAmount)}원</span>
                    <span>{formatNumber(metrics.minimumFee)}원</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
