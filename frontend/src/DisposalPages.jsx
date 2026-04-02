import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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

function DisposalMetaInputs({ draft, updateDraftField }) {
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
          <input value={draft.district} onChange={e => updateDraftField('district', e.target.value)} placeholder="관할구역" />
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
        <div className="disposal-hero-actions">
          <button type="button" className="ghost" onClick={resetDraft}>초기화</button>
          <button type="button" className="ghost" onClick={() => navigate('/disposal/list')}>폐기목록</button>
          <button type="button" className="ghost active" onClick={saveSettlementRecord}>폐기결산 저장</button>
        </div>
      </section>

      <DisposalMetaInputs draft={draft} updateDraftField={updateDraftField} />

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

  useEffect(() => {
    setRecords(loadRecords())
  }, [])

  const summary = useMemo(() => ({
    count: records.length,
    totalQty: records.reduce((sum, record) => sum + safeNumber(record?.totals?.totalQty), 0),
    totalReport: records.reduce((sum, record) => sum + safeNumber(record?.totals?.totalReport), 0),
    totalFinal: records.reduce((sum, record) => sum + safeNumber(record?.totals?.totalFinal), 0),
  }), [records])

  const groupedSettlements = useMemo(() => buildSettlementGroups(records), [records])

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>폐기결산</h2>
          <p className="notice-text">저장일 기준으로 날짜별 결산 자료를 묶어서 한 번에 확인하도록 구성했습니다.</p>
        </div>
        <div className="disposal-hero-actions">
          <button type="button" className="ghost" onClick={() => navigate('/disposal/list')}>폐기목록</button>
          <button type="button" className="ghost active" onClick={() => navigate('/disposal/forms')}>폐기양식</button>
        </div>
      </section>

      <section className="disposal-summary-grid">
        <div className="card disposal-summary-card"><span>저장 건수</span><strong>{formatNumber(summary.count)}</strong></div>
        <div className="card disposal-summary-card"><span>총 품목수</span><strong>{formatNumber(summary.totalQty)}</strong></div>
        <div className="card disposal-summary-card"><span>폐기신고액 합계</span><strong>{formatNumber(summary.totalReport)}원</strong></div>
        <div className="card disposal-summary-card"><span>최소수수료 합계</span><strong>{formatNumber(summary.totalFinal)}원</strong></div>
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
