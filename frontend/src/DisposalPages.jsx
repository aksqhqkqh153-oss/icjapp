import React, { useEffect, useMemo, useState } from 'react'
import { DISPOSAL_TEMPLATE } from './disposalTemplateData'

const STORAGE_KEY = 'icj_disposal_records_v1'
const TEMPLATE_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const ITEM_ROW_COUNT = 17
const FEE_RATE = 1.3

function createEmptyItem() {
  return { itemName: '', quantity: '', unitCost: '', reportNo: '', note: '' }
}

function createInitialDraft() {
  return {
    disposalDate: '',
    location: '',
    district: '',
    finalStatus: '입금 대기 / 신고 대기',
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

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records || []))
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

function DisposalTemplateTable({ title, startRow, endRow, rendered }) {
  const mergeInfo = useMemo(() => buildMergeMap(DISPOSAL_TEMPLATE.merges), [])
  const columnStyle = useMemo(() => ({
    gridTemplateColumns: DISPOSAL_TEMPLATE.columnWidths.map((width) => `${Math.max(76, width * 7.5)}px`).join(' '),
  }), [])
  const rowSlice = rendered.rows.slice(startRow - 1, endRow)

  return (
    <section className="card disposal-sheet-card">
      <div className="disposal-sheet-head">
        <h3>{title}</h3>
        <div className="notice-text">첨부된 폐기견적서 A1:H71 영역을 앱 화면에 옮긴 양식입니다.</div>
      </div>
      <div className="disposal-sheet-scroll">
        <div className="disposal-sheet-grid" style={columnStyle}>
          {rowSlice.map((row, rowOffset) => {
            const actualRow = startRow + rowOffset
            return row.map((value, colIndex) => {
              const cellRef = getCellRef(colIndex, actualRow)
              if (mergeInfo.hidden.has(cellRef)) return null
              const merge = mergeInfo.origins.get(cellRef)
              const classNames = ['disposal-cell']
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
                    minHeight: `${Math.max(38, DISPOSAL_TEMPLATE.rowHeights[actualRow - 1] || 38)}px`,
                  }}
                >
                  <span>{String(value || '').trim() ? String(value) : ' '}</span>
                </div>
              )
            })
          })}
        </div>
      </div>
    </section>
  )
}

export function DisposalFormsPage() {
  const [draft, setDraft] = useState(createInitialDraft())
  const [savedAt, setSavedAt] = useState('')

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
    const record = {
      id: `disposal-${Date.now()}`,
      savedAt: new Date().toISOString(),
      disposalDate: draft.disposalDate,
      location: draft.location,
      district: draft.district,
      finalStatus: draft.finalStatus,
      customerName: draft.customerName,
      items: draft.items,
      totals: rendered.totals,
    }
    const current = loadRecords()
    saveRecords([record, ...current].slice(0, 200))
    const stamp = new Date(record.savedAt)
    setSavedAt(`${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`)
    window.alert('폐기결산 데이터가 로컬 저장소에 저장되었습니다.')
  }

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>폐기양식</h2>
          <p className="notice-text">폐기견적서 양식을 앱 화면에 맞게 옮긴 입력/확인 화면입니다. 저장 시 폐기결산 화면에서 합계 내역을 확인할 수 있습니다.</p>
        </div>
        <div className="disposal-hero-actions">
          <button type="button" className="ghost" onClick={resetDraft}>초기화</button>
          <button type="button" className="ghost active" onClick={saveSettlementRecord}>폐기결산 저장</button>
        </div>
      </section>

      <section className="card disposal-entry-card">
        <div className="disposal-entry-grid">
          <label>
            <span>고객명</span>
            <input value={draft.customerName} onChange={e => updateDraftField('customerName', e.target.value)} placeholder="예: 홍길동" />
          </label>
          <label>
            <span>폐기일자</span>
            <input value={draft.disposalDate} onChange={e => updateDraftField('disposalDate', e.target.value)} placeholder="예: 26.05.29" />
          </label>
          <label>
            <span>폐기장소</span>
            <input value={draft.location} onChange={e => updateDraftField('location', e.target.value)} placeholder="예: 서울시 중랑구 면목로94길 15" />
          </label>
          <label>
            <span>관할구역</span>
            <input value={draft.district} onChange={e => updateDraftField('district', e.target.value)} placeholder="예: 중랑구" />
          </label>
          <label className="disposal-status-field">
            <span>최종현황</span>
            <select value={draft.finalStatus} onChange={e => updateDraftField('finalStatus', e.target.value)}>
              <option value="입금 대기 / 신고 대기">입금 대기 / 신고 대기</option>
              <option value="입금 완 / 신고 진행">입금 완 / 신고 진행</option>
              <option value="입금 완 / 신고 완">입금 완 / 신고 완</option>
            </select>
          </label>
        </div>
        <div className="disposal-saved-at">최근 저장: {savedAt || '-'}</div>
      </section>

      <section className="card disposal-items-card">
        <div className="disposal-items-head">
          <h3>폐기 품목 입력</h3>
          <div className="notice-text">수량 × 1개당 비용 = 신고합계, 신고합계 × 1.3 = 최종비용(수수료 포함)으로 자동 계산됩니다.</div>
        </div>
        <div className="disposal-items-scroll">
          <table className="disposal-items-table">
            <thead>
              <tr>
                <th>#</th>
                <th>폐기 품목</th>
                <th>수량</th>
                <th>1개당 비용</th>
                <th>신고합계</th>
                <th>최종비용</th>
                <th>폐기 신고 번호</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {rendered.reportRows.map((item, index) => (
                <tr key={`disposal-item-${index}`}>
                  <td>{index + 1}</td>
                  <td><input value={draft.items[index]?.itemName || ''} onChange={e => updateItem(index, 'itemName', e.target.value)} /></td>
                  <td><input inputMode="numeric" value={draft.items[index]?.quantity || ''} onChange={e => updateItem(index, 'quantity', e.target.value)} /></td>
                  <td><input inputMode="numeric" value={draft.items[index]?.unitCost || ''} onChange={e => updateItem(index, 'unitCost', e.target.value)} /></td>
                  <td>{formatNumber(item.reportAmount)}</td>
                  <td>{formatNumber(item.finalAmount)}</td>
                  <td><input value={draft.items[index]?.reportNo || ''} onChange={e => updateItem(index, 'reportNo', e.target.value)} /></td>
                  <td><input value={draft.items[index]?.note || ''} onChange={e => updateItem(index, 'note', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="2">합계</td>
                <td>{formatNumber(rendered.totals.totalQty)}</td>
                <td>-</td>
                <td>{formatNumber(rendered.totals.totalReport)}</td>
                <td>{formatNumber(rendered.totals.totalFinal)}</td>
                <td colSpan="2">{draft.customerName ? `${draft.customerName} 건` : '저장 전 임시 작성'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <DisposalTemplateTable title="편집용 양식" startRow={1} endRow={23} rendered={rendered} />
      <DisposalTemplateTable title="대리 신고 견적서" startRow={25} endRow={48} rendered={rendered} />
      <DisposalTemplateTable title="신고 번호 정리표" startRow={50} endRow={71} rendered={rendered} />
    </div>
  )
}

export function DisposalSettlementsPage() {
  const [records, setRecords] = useState([])
  const [filterDate, setFilterDate] = useState('')

  useEffect(() => {
    setRecords(loadRecords())
  }, [])

  const filteredRecords = useMemo(() => {
    const keyword = String(filterDate || '').trim()
    if (!keyword) return records
    return records.filter(record => String(record?.disposalDate || '').includes(keyword))
  }, [filterDate, records])

  const summary = useMemo(() => ({
    count: filteredRecords.length,
    totalQty: filteredRecords.reduce((sum, record) => sum + safeNumber(record?.totals?.totalQty), 0),
    totalReport: filteredRecords.reduce((sum, record) => sum + safeNumber(record?.totals?.totalReport), 0),
    totalFinal: filteredRecords.reduce((sum, record) => sum + safeNumber(record?.totals?.totalFinal), 0),
  }), [filteredRecords])

  function removeRecord(id) {
    const next = records.filter(record => record.id !== id)
    setRecords(next)
    saveRecords(next)
  }

  return (
    <div className="stack-page disposal-page">
      <section className="card disposal-hero">
        <div>
          <h2>폐기결산</h2>
          <p className="notice-text">폐기양식 화면에서 저장한 내역을 기준으로 건수와 금액 합계를 확인하는 화면입니다.</p>
        </div>
      </section>

      <section className="card disposal-settlement-filter-card">
        <div className="disposal-entry-grid disposal-entry-grid-compact">
          <label>
            <span>폐기일자 필터</span>
            <input value={filterDate} onChange={e => setFilterDate(e.target.value)} placeholder="예: 26.05" />
          </label>
        </div>
      </section>

      <section className="disposal-summary-grid">
        <div className="card disposal-summary-card"><span>저장 건수</span><strong>{formatNumber(summary.count)}</strong></div>
        <div className="card disposal-summary-card"><span>총 수량</span><strong>{formatNumber(summary.totalQty)}</strong></div>
        <div className="card disposal-summary-card"><span>신고합계</span><strong>{formatNumber(summary.totalReport)}원</strong></div>
        <div className="card disposal-summary-card"><span>최종비용 합계</span><strong>{formatNumber(summary.totalFinal)}원</strong></div>
      </section>

      <section className="card disposal-records-card">
        <div className="disposal-items-head">
          <h3>저장 내역</h3>
          <div className="notice-text">브라우저 로컬 저장소 기준으로 표시됩니다.</div>
        </div>
        {filteredRecords.length === 0 ? (
          <div className="empty-state">저장된 폐기결산 내역이 없습니다.</div>
        ) : (
          <div className="disposal-record-list">
            {filteredRecords.map(record => (
              <article key={record.id} className="disposal-record-card">
                <div className="disposal-record-head">
                  <div>
                    <strong>{record.customerName || '고객명 미입력'}</strong>
                    <div className="notice-text">{record.disposalDate || '-'} · {record.location || '-'} · {record.finalStatus || '-'}</div>
                  </div>
                  <button type="button" className="ghost" onClick={() => removeRecord(record.id)}>삭제</button>
                </div>
                <div className="disposal-record-meta">
                  <span>관할구역: {record.district || '-'}</span>
                  <span>총 수량: {formatNumber(record?.totals?.totalQty)}</span>
                  <span>신고합계: {formatNumber(record?.totals?.totalReport)}원</span>
                  <span>최종비용: {formatNumber(record?.totals?.totalFinal)}원</span>
                </div>
                <div className="disposal-record-items">
                  {(record.items || []).filter(item => String(item?.itemName || '').trim()).map((item, index) => (
                    <div key={`${record.id}-item-${index}`} className="disposal-record-item-row">
                      <span>{item.itemName}</span>
                      <span>{formatNumber(item.quantity)}개</span>
                      <span>{formatNumber(item.unitCost)}원</span>
                      <span>{item.reportNo || '-'}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
