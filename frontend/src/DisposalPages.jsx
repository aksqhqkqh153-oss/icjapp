import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, getStoredUser } from './api'
import { DISPOSAL_TEMPLATE } from './disposalTemplateData'

const LEGACY_STORAGE_KEYS = ['icj_disposal_records_v2', 'icj_disposal_records_v1']
let disposalRecordsMemoryCache = []
const DISPOSAL_NAV_TABS = [
  { key: 'forms', label: '폐기양식', path: '/disposal/forms' },
  { key: 'list', label: '폐기목록', path: '/disposal/list' },
  { key: 'settlements', label: '폐기결산', path: '/disposal/settlements' },
]
const TEMPLATE_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const ITEM_ROW_COUNT = 30
const TEMPLATE_ITEM_ROW_COUNT = 17
const DEFAULT_VISIBLE_ITEM_ROWS = 8
const DISPOSAL_DEFAULT_VISIBLE_ROWS_KEY = 'icj_disposal_default_visible_rows_v1'
const DISPOSAL_PREVIEW_SESSION_KEY = 'icj_disposal_preview_draft_v1'
const FEE_RATE = 1.3
const DATE_FILTER_OPTIONS = [
  { value: 'all', label: '날짜(전체)' },
  { value: 'today', label: '오늘' },
  { value: '7days', label: '7일' },
  { value: 'thisMonth', label: '이번달' },
  { value: 'lastMonth', label: '지난달' },
  { value: 'custom', label: '직접입력' },
]

const FILTER_OPTIONS = [
  { value: 'latest', label: '1차' },
  { value: 'date', label: '폐기일자순' },
  { value: 'customer', label: '고객명순' },
  { value: 'status', label: '최종현황순' },
]

const SORT_DIRECTION_OPTIONS = [
  { value: 'desc', label: '2차' },
  { value: 'asc', label: '오름차순' },
]

const SETTLEMENT_PRIMARY_FILTER_OPTIONS = [
  { value: 'customerName', label: '고객명' },
  { value: 'disposalDate', label: '폐기일자' },
  { value: 'paymentDate', label: '입금일자' },
]

const SETTLEMENT_SORT_DIRECTION_OPTIONS = [
  { value: 'asc', label: '오름차순' },
  { value: 'desc', label: '내림차순' },
]

function getMonthDateRangeForKey(monthKey) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const first = new Date(y, m - 1, 1)
    const last = new Date(y, m, 0)
    return {
      start: formatShortDate(first),
      end: formatShortDate(last),
    }
  }
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  return {
    start: formatShortDate(first),
    end: formatShortDate(last),
  }
}

const FINAL_STATUS_OPTIONS = ['입금전 / 신고전', '입금완 / 신고전', '입금완 / 신고완']
const DEFAULT_CUSTOMER_EXPORT_TEMPLATE = '[{platform} {customerName} {disposalDate}] {suffix}'
const DEFAULT_COMPANY_EXPORT_TEMPLATE = '[{platform} {customerName} {disposalDate}] {suffix}'
const EXPORT_TEMPLATE_TOKEN_ALIASES = {
  platform: 'platform',
  고객명: 'customerName',
  customerName: 'customerName',
  disposalDate: 'disposalDate',
  폐기날짜: 'disposalDate',
  폐기일자: 'disposalDate',
  location: 'location',
  폐기주소: 'location',
  폐기장소: 'location',
  suffix: 'suffix',
}

function getDisposalExportSettingsStorageKey() {
  const user = getStoredUser?.() || {}
  const identity = String(user?.username || user?.id || 'guest').trim() || 'guest'
  return `disposal-export-settings:${identity}`
}

function loadDisposalExportSettings() {
  try {
    const raw = localStorage.getItem(getDisposalExportSettingsStorageKey())
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      customerTemplate: String(parsed?.customerTemplate || DEFAULT_CUSTOMER_EXPORT_TEMPLATE),
      companyTemplate: String(parsed?.companyTemplate || DEFAULT_COMPANY_EXPORT_TEMPLATE),
    }
  } catch {
    return {
      customerTemplate: DEFAULT_CUSTOMER_EXPORT_TEMPLATE,
      companyTemplate: DEFAULT_COMPANY_EXPORT_TEMPLATE,
    }
  }
}

function saveDisposalExportSettings(nextSettings = {}) {
  const normalized = {
    customerTemplate: String(nextSettings?.customerTemplate || DEFAULT_CUSTOMER_EXPORT_TEMPLATE),
    companyTemplate: String(nextSettings?.companyTemplate || DEFAULT_COMPANY_EXPORT_TEMPLATE),
  }
  try {
    localStorage.setItem(getDisposalExportSettingsStorageKey(), JSON.stringify(normalized))
  } catch {}
  return normalized
}

const FINAL_STATUS_SELECT_OPTIONS = [{ value: '', label: '최종현황 선택' }, ...FINAL_STATUS_OPTIONS.map(option => ({ value: option, label: option }))]
const PLATFORM_OPTIONS = ['', '숨고', '오늘', '공홈']

function SearchButtonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="disposal-search-icon">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function statusMark(value) {
  return value ? 'O' : 'X'
}

const UNPAID_PAYMENT_VALUE = '__UNPAID__'

function formatPaymentCellDisplay(row = {}) {
  const settled = formatShortDate(row?.paymentSettledAt)
  if (settled) return settled
  return '미입금'
}

function getBulkPaymentInputValue(row = {}) {
  const settled = formatDateInputValue(row?.paymentSettledAt)
  if (settled) return settled
  return row?.paymentDone ? getTodayDateInputValue() : UNPAID_PAYMENT_VALUE
}


function clampVisibleItemRows(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_VISIBLE_ITEM_ROWS
  return Math.max(1, Math.min(ITEM_ROW_COUNT, Math.round(numeric)))
}

function getDefaultVisibleItemRows() {
  try {
    const raw = Number(localStorage.getItem(DISPOSAL_DEFAULT_VISIBLE_ROWS_KEY) || DEFAULT_VISIBLE_ITEM_ROWS)
    return clampVisibleItemRows(raw)
  } catch {
    return DEFAULT_VISIBLE_ITEM_ROWS
  }
}

function setDefaultVisibleItemRowsStorage(value) {
  try {
    localStorage.setItem(DISPOSAL_DEFAULT_VISIBLE_ROWS_KEY, String(clampVisibleItemRows(value)))
  } catch {}
}

function createEmptyItem() {
  return { itemName: '', quantity: '', unitCost: '', reportNo: '', note: '', paymentDone: false, reportDone: false, paymentSettledAt: '' }
}

function hasMeaningfulItemContent(item) {
  return !!(
    String(item?.itemName || '').trim() ||
    String(item?.quantity || '').trim() ||
    String(item?.unitCost || '').trim() ||
    String(item?.reportNo || '').trim() ||
    String(item?.note || '').trim()
  )
}

function normalizeDraftItemsForSave(draftItems = [], existingRecord = null) {
  return (draftItems || []).slice(0, ITEM_ROW_COUNT).map((item, index) => {
    const normalizedItem = { ...createEmptyItem(), ...(item || {}) }
    const previousItem = existingRecord?.items?.[index] || null
    const isNewlyFilledItem = hasMeaningfulItemContent(normalizedItem) && !hasMeaningfulItemContent(previousItem)
    const hasReportNumber = !!String(normalizedItem?.reportNo || '').trim()
    return {
      ...normalizedItem,
      paymentDone: isNewlyFilledItem ? false : !!normalizedItem.paymentDone,
      reportDone: hasReportNumber ? true : (isNewlyFilledItem ? false : !!normalizedItem.reportDone),
      paymentSettledAt: isNewlyFilledItem ? '' : String(normalizedItem.paymentSettledAt || ''),
    }
  })
}

function createInitialDraft() {
  return {
    disposalDate: '',
    location: '',
    district: '',
    finalStatus: '',
    platform: '',
    customerName: '',
    items: Array.from({ length: getDefaultVisibleItemRows() }, () => createEmptyItem()),
  }
}

function safeNumber(value) {
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '')
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

function isFreeUnitCostValue(value) {
  const raw = String(value ?? '').trim()
  return raw === '무료'
}

function isZeroUnitCostValue(value) {
  const raw = String(value ?? '').trim()
  return raw === '0' || raw === '0원'
}

function formatUnitCostChangeLabel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  if (isFreeUnitCostValue(raw)) return '개당신고비용 : 무료'
  if (isZeroUnitCostValue(raw)) return '개당신고비용 : 0원'
  return `개당신고비용 : ${formatCurrency(safeNumber(raw))}`
}

function formatQuantityChangeLabel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  return `${formatNumber(safeNumber(raw))}개`
}

function formatCustomerItemCostDisplay(item = {}) {
  if (item?.isFree) return '무료'
  if (item?.unitCostRaw != null && isZeroUnitCostValue(item.unitCostRaw)) return '0원'
  return item?.finalAmount || item?.finalAmount === 0 ? formatCurrency(item.finalAmount) : ''
}

function formatCustomerTotalCostDisplay(items = [], totalFinal = 0) {
  return formatCurrency(totalFinal || 0)
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR')
}

function formatShortDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(raw)) return raw
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  return `${String(date.getFullYear()).slice(-2)}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function formatDateInputValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(raw)) {
    return `20${raw.slice(0, 2)}-${raw.slice(3, 5)}-${raw.slice(6, 8)}`
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function getTodayDateInputValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeSearchText(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase()
}

function makeCustomerLocationKey(customerName, location) {
  const customerKey = normalizeSearchText(customerName)
  const locationKey = normalizeSearchText(location)
  return `${customerKey}__${locationKey}`
}

function findMatchingRecord(records = [], draft = {}) {
  const targetKey = makeCustomerLocationKey(draft?.customerName, draft?.location)
  if (!targetKey || targetKey === '__') return null
  return (records || []).find(record => makeCustomerLocationKey(record?.customerName, record?.location) === targetKey) || null
}

function normalizeRecordShape(record) {
  if (!record || typeof record !== 'object') return null
  const sourceItems = Array.isArray(record.items) ? record.items : []
  const defaultVisibleRows = getDefaultVisibleItemRows()
  const visibleItemCount = Math.max(defaultVisibleRows, Math.min(ITEM_ROW_COUNT, sourceItems.length || defaultVisibleRows))
  const defaultPaid = /입금완/.test(String(record?.finalStatus || '').trim())
  const defaultReported = /신고완/.test(String(record?.finalStatus || '').trim())
  const items = Array.from({ length: visibleItemCount }, (_, index) => {
    const sourceItem = sourceItems[index] || {}
    return {
      ...createEmptyItem(),
      ...sourceItem,
      paymentDone: typeof sourceItem?.paymentDone === 'boolean' ? sourceItem.paymentDone : defaultPaid,
      reportDone: String(sourceItem?.reportNo || '').trim()
        ? true
        : (typeof sourceItem?.reportDone === 'boolean' ? sourceItem.reportDone : defaultReported),
      paymentSettledAt: String(sourceItem?.paymentSettledAt || ''),
    }
  })
  return {
    id: String(record.id || `disposal-${Date.now()}`),
    savedAt: String(record.savedAt || new Date().toISOString()),
    disposalDate: String(record.disposalDate || ''),
    location: String(record.location || ''),
    district: String(record.district || ''),
    finalStatus: String(record.finalStatus || ''),
    platform: String(record.platform || ''),
    customerName: String(record.customerName || ''),
    createdByUserId: String(record.createdByUserId || record.created_by_user_id || ''),
    createdByUsername: String(record.createdByUsername || record.created_by_username || ''),
    createdByGrade: String(record.createdByGrade || record.created_by_grade || ''),
    items,
    settlementTransferredAt: record.settlementTransferredAt ? String(record.settlementTransferredAt) : '',
    totals: {
      totalQty: safeNumber(record?.totals?.totalQty),
      totalUnitCost: safeNumber(record?.totals?.totalUnitCost),
      totalReport: safeNumber(record?.totals?.totalReport),
      totalFinal: safeNumber(record?.totals?.totalFinal),
    },
  }
}

function getDisposalCurrentUser() {
  return getStoredUser?.() || {}
}

function isDisposalAdminLike(user = {}) {
  return Number(user?.grade || 9) <= 2
}

function getDisposalUserIdentity(user = {}) {
  return {
    userId: String(user?.id || '').trim(),
    username: String(user?.username || '').trim(),
  }
}

function canUserViewDisposalRecord(record, user = getDisposalCurrentUser()) {
  if (!record) return false
  if (isDisposalAdminLike(user)) return true
  const { userId, username } = getDisposalUserIdentity(user)
  const recordUserId = String(record?.createdByUserId || '').trim()
  const recordUsername = String(record?.createdByUsername || '').trim()
  if (!recordUserId && !recordUsername) return true
  if (userId && recordUserId && userId === recordUserId) return true
  if (username && recordUsername && username === recordUsername) return true
  return false
}

function attachDisposalRecordOwner(record, user = getDisposalCurrentUser()) {
  const normalized = normalizeRecordShape(record)
  if (!normalized) return null
  const { userId, username } = getDisposalUserIdentity(user)
  return {
    ...normalized,
    createdByUserId: String(normalized?.createdByUserId || userId || ''),
    createdByUsername: String(normalized?.createdByUsername || username || ''),
    createdByGrade: String(normalized?.createdByGrade || user?.grade || ''),
  }
}

function loadLegacyLocalDisposalRecords() {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const records = Array.isArray(parsed) ? parsed.map(normalizeRecordShape).filter(Boolean) : []
      if (records.length) {
        return records
      }
    } catch {
      // ignore broken local legacy payloads and continue checking the next key
    }
  }
  return []
}

function clearLegacyLocalDisposalRecords() {
  LEGACY_STORAGE_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  })
}

function loadAllRecords() {
  return [...disposalRecordsMemoryCache]
}

function loadRecords(user = getDisposalCurrentUser()) {
  return loadAllRecords().filter(record => canUserViewDisposalRecord(record, user))
}

function saveRecords(records) {
  disposalRecordsMemoryCache = (records || []).map(normalizeRecordShape).filter(Boolean)
  try {
    window.dispatchEvent(new CustomEvent('icj-disposal-records-updated'))
  } catch {}
}

async function fetchDisposalRecordsFromServer() {
  const response = await api('/api/disposal/records', { icjCache: { skip: true } })
  const records = Array.isArray(response?.records) ? response.records.map(normalizeRecordShape).filter(Boolean) : []
  saveRecords(records)
  return records
}

async function migrateLocalDisposalRecordsToServer(records = loadLegacyLocalDisposalRecords()) {
  const normalized = (records || []).map(normalizeRecordShape).filter(Boolean)
  if (!normalized.length) return { ok: true, count: 0 }
  return api('/api/disposal/records/migrate-local', {
    method: 'POST',
    body: JSON.stringify({ records: normalized }),
  })
}

async function replaceLocalDisposalRecordsToServer(records = loadLegacyLocalDisposalRecords()) {
  const normalized = (records || []).map(normalizeRecordShape).filter(Boolean)
  if (!normalized.length) return { ok: true, count: 0 }
  return api('/api/disposal/records/replace-local', {
    method: 'POST',
    body: JSON.stringify({ records: normalized }),
  })
}

async function upsertDisposalRecordToServer(record) {
  const normalized = normalizeRecordShape(record)
  const response = await api('/api/disposal/records/upsert', {
    method: 'POST',
    body: JSON.stringify(normalized),
  })
  const saved = normalizeRecordShape(response?.record)
  const current = loadAllRecords().filter(item => item.id !== saved?.id)
  const next = [saved, ...current].filter(Boolean)
  saveRecords(next)
  return saved
}

async function deleteDisposalRecordsFromServer(ids = []) {
  const targetIds = Array.from(new Set((ids || []).map(value => String(value || '').trim()).filter(Boolean)))
  if (!targetIds.length) return { ok: true, deletedIds: [] }
  const response = await api('/api/disposal/records/delete', {
    method: 'POST',
    body: JSON.stringify({ ids: targetIds }),
  })
  const deletedIds = Array.isArray(response?.deletedIds) ? response.deletedIds.map(value => String(value || '')) : targetIds
  const next = loadAllRecords().filter(record => !deletedIds.includes(String(record?.id || '')))
  saveRecords(next)
  return { ok: true, deletedIds }
}

async function bootstrapDisposalRecords() {
  const legacyLocalRecords = loadLegacyLocalDisposalRecords()
  if (legacyLocalRecords.length) {
    await replaceLocalDisposalRecordsToServer(legacyLocalRecords)
    clearLegacyLocalDisposalRecords()
  }
  return fetchDisposalRecordsFromServer()
}

function getDateValueParts(rawValue) {

  const raw = String(rawValue || '').trim()
  if (!raw) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { date, dateKey }
}

function isWithinCustomDateRange(rawValue, startDate = '', endDate = '') {
  const parsed = getDateValueParts(rawValue)
  if (!parsed) return false
  const start = startDate ? getDateValueParts(startDate)?.date : null
  const end = endDate ? getDateValueParts(endDate)?.date : null
  if (start && parsed.date < start) return false
  if (end && parsed.date > end) return false
  return true
}

function compareDisposalValue(a, b, sortKey = 'latest', sortDirection = 'desc') {
  let compared = 0
  if (sortKey === 'customer') compared = String(a?.customerName || a?.itemName || '').localeCompare(String(b?.customerName || b?.itemName || ''), 'ko')
  else if (sortKey === 'status') compared = String(a?.finalStatus || '').localeCompare(String(b?.finalStatus || ''), 'ko')
  else if (sortKey === 'date') compared = String(a?.disposalDate || '').localeCompare(String(b?.disposalDate || ''), 'ko')
  else compared = String(a?.savedAt || '').localeCompare(String(b?.savedAt || ''))
  return sortDirection === 'asc' ? compared : compared * -1
}

function sortGroupedRows(rows = []) {
  const list = [...(rows || [])]
  return list.sort((a, b) => {
    const orderGap = safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder)
    if (orderGap !== 0) return orderGap
    const savedAtGap = String(b?.savedAt || '').localeCompare(String(a?.savedAt || ''))
    if (savedAtGap !== 0) return savedAtGap
    return String(a?.itemName || '').localeCompare(String(b?.itemName || ''), 'ko')
  })
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
  const sourceItems = Array.from({ length: ITEM_ROW_COUNT }, (_, index) => ({
    ...createEmptyItem(),
    ...((draft?.items || [])[index] || {}),
  }))
  const items = sourceItems.slice(0, ITEM_ROW_COUNT).map(item => {
    const unitCostRaw = String(item?.unitCost || '').trim()
    const isFree = isFreeUnitCostValue(unitCostRaw)
    const isZeroCost = isZeroUnitCostValue(unitCostRaw)
    return {
      itemName: String(item?.itemName || ''),
      quantity: safeNumber(item?.quantity),
      unitCost: isFree ? 0 : safeNumber(item?.unitCost),
      unitCostRaw,
      isFree,
      isZeroCost,
      reportNo: String(item?.reportNo || ''),
      note: String(item?.note || ''),
    }
  })
  const reportRows = items.map(item => {
    const reportAmount = item.isFree ? 0 : item.quantity * item.unitCost
    const feeAmount = item.isFree ? 0 : Math.round(reportAmount * 0.3)
    const finalAmount = item.isFree ? 0 : reportAmount + feeAmount
    const customerDisplayCost = item.isFree ? '무료' : (item.isZeroCost ? '0원' : '')
    return {
      ...item,
      reportAmount,
      feeAmount,
      finalAmount,
      customerDisplayCost,
    }
  })
  const totalQty = reportRows.reduce((sum, item) => sum + item.quantity, 0)
  const totalUnitCost = reportRows.reduce((sum, item) => sum + item.unitCost, 0)
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

  reportRows.slice(0, TEMPLATE_ITEM_ROW_COUNT).forEach((item, index) => {
    const sourceRow = 5 + index
    nextRows[sourceRow][1] = item.itemName
    nextRows[sourceRow][2] = item.quantity ? String(item.quantity) : ''
    nextRows[sourceRow][3] = item.isFree ? '무료' : (item.isZeroCost ? '0' : (item.unitCost ? String(item.unitCost) : ''))
    nextRows[sourceRow][4] = item.reportAmount ? String(item.reportAmount) : '0'
    nextRows[sourceRow][5] = item.finalAmount ? String(item.finalAmount) : '0'
    nextRows[sourceRow][6] = item.reportNo
    nextRows[sourceRow][7] = item.note

    const summaryRow = 29 + index
    nextRows[summaryRow][1] = item.itemName
    nextRows[summaryRow][2] = item.quantity ? String(item.quantity) : ''
    nextRows[summaryRow][3] = item.isFree ? '무료' : (item.isZeroCost ? '0원' : ((item.finalAmount || item.finalAmount === 0) ? String(item.finalAmount) : ''))

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
    totals: { totalQty, totalUnitCost, totalReport, totalFinal },
    reportRows,
  }
}

function makeRecordFromDraft(draft, totals, existingId = '', options = {}) {
  const { existingRecord = null } = options || {}
  const normalizedTotals = {
    totalQty: safeNumber(totals?.totalQty),
    totalUnitCost: safeNumber(totals?.totalUnitCost),
    totalReport: safeNumber(totals?.totalReport),
    totalFinal: safeNumber(totals?.totalFinal),
  }
  const normalizedItems = normalizeDraftItemsForSave(draft?.items || [], existingRecord)
  const filledItems = normalizedItems.filter(item => hasMeaningfulItemContent(item))
  const paymentDone = filledItems.length > 0 && filledItems.every(item => !!item?.paymentDone)
  const reportDone = filledItems.length > 0 && filledItems.every(item => !!item?.reportDone)
  const hasEligibleSettlementItems = filledItems.some(item => !!item?.paymentDone && String(item?.paymentSettledAt || '').trim())
  return attachDisposalRecordOwner({
    id: existingId || `disposal-${Date.now()}`,
    savedAt: new Date().toISOString(),
    disposalDate: draft.disposalDate,
    location: draft.location,
    district: draft.district,
    finalStatus: composeFinalStatus(paymentDone, reportDone),
    platform: draft.platform,
    customerName: draft.customerName,
    createdByUserId: existingRecord?.createdByUserId || '',
    createdByUsername: existingRecord?.createdByUsername || '',
    createdByGrade: existingRecord?.createdByGrade || '',
    items: normalizedItems,
    settlementTransferredAt: existingRecord?.settlementTransferredAt && hasEligibleSettlementItems ? String(existingRecord.settlementTransferredAt) : '',
    totals: normalizedTotals,
  })
}

function upsertRecordByCustomerLocation(records, nextRecord) {
  const visibleRecords = (records || []).filter(record => canUserViewDisposalRecord(record))
  const existing = findMatchingRecord(visibleRecords, nextRecord)
  const nextId = existing?.id || nextRecord.id
  const normalizedNext = attachDisposalRecordOwner({
    ...nextRecord,
    id: nextId,
    savedAt: new Date().toISOString(),
    createdByUserId: existing?.createdByUserId || '',
    createdByUsername: existing?.createdByUsername || '',
    createdByGrade: existing?.createdByGrade || '',
  })
  return [normalizedNext, ...(records || []).filter(record => record.id !== nextId)].slice(0, 300)
}

function normalizeDraftForCompare(draft) {
  const source = draft || createInitialDraft()
  return {
    disposalDate: String(source.disposalDate || '').trim(),
    location: String(source.location || '').trim(),
    district: String(source.district || '').trim(),
    finalStatus: String(source.finalStatus || '').trim(),
    platform: String(source.platform || '').trim(),
    customerName: String(source.customerName || '').trim(),
    items: Array.from({ length: ITEM_ROW_COUNT }, (_, index) => {
      const item = (source.items || [])[index] || {}
      return {
        itemName: String(item.itemName || '').trim(),
        quantity: String(item.quantity || '').trim(),
        unitCost: String(item.unitCost || '').trim(),
        reportNo: String(item.reportNo || '').trim(),
        note: String(item.note || '').trim(),
      }
    }),
  }
}

function buildDraftChangeSummary(initialDraft, currentDraft) {
  const initial = normalizeDraftForCompare(initialDraft)
  const current = normalizeDraftForCompare(currentDraft)
  const changed = []
  const valueLabel = value => String(value || '').trim() || '-'

  if (initial.customerName != current.customerName) changed.push('- 고객명')
  if (initial.disposalDate != current.disposalDate) changed.push('- 폐기일자')
  if (initial.platform != current.platform) changed.push('- 플랫폼')
  if (initial.location != current.location) changed.push('- 폐기장소')
  if (initial.district != current.district) changed.push('- 관할구역')
  if (initial.finalStatus != current.finalStatus) changed.push('- 최종현황')

  const changedItemDetails = []
  for (let index = 0; index < ITEM_ROW_COUNT; index += 1) {
    const before = initial.items[index] || {}
    const after = current.items[index] || {}

    const hasItemChange = (
      before.itemName !== after.itemName
      || before.quantity !== after.quantity
      || before.unitCost !== after.unitCost
    )

    if (hasItemChange) {
      changedItemDetails.push(
        [
          `폐기품목입력 ${index + 1}번`,
          `- 기존 : [${valueLabel(before.itemName)}] [${formatQuantityChangeLabel(before.quantity)}] [${formatUnitCostChangeLabel(before.unitCost)}]`,
          `- 변경 : [${valueLabel(after.itemName)}] [${formatQuantityChangeLabel(after.quantity)}] [${formatUnitCostChangeLabel(after.unitCost)}]`,
        ].join('\n')
      )
    }
  }
  if (changedItemDetails.length) {
    changed.push(...changedItemDetails.slice(0, 12))
    if (changedItemDetails.length > 12) {
      changed.push(`폐기품목입력 외 ${changedItemDetails.length - 12}건`)
    }
  }

  return changed
}

function sortRecords(records, sortKey, sortDirection = 'desc') {
  const list = [...records]
  let sorted = list
  if (sortKey === 'customer') sorted = list.sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), 'ko'))
  else if (sortKey === 'date') sorted = list.sort((a, b) => String(a.disposalDate || '').localeCompare(String(b.disposalDate || ''), 'ko'))
  else if (sortKey === 'status') sorted = list.sort((a, b) => String(a.finalStatus || '').localeCompare(String(b.finalStatus || ''), 'ko'))
  else sorted = list.sort((a, b) => String(a.savedAt || '').localeCompare(String(b.savedAt || '')))
  return sortDirection === 'asc' ? sorted : [...sorted].reverse()
}


function formatCurrency(value) {
  return `${formatNumber(value)}원`
}

function formatCurrencyPlain(value) {
  return formatNumber(value)
}


function formatExportDisplayDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length >= 8) {
    const year = digits.slice(0, 4)
    const month = digits.slice(4, 6)
    const day = digits.slice(6, 8)
    return `${year.slice(-2)}.${month}.${day}`
  }
  return raw
}

function formatExportCustomerLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/고객님$/.test(raw)) return raw
  if (/님$/.test(raw)) return `${raw.replace(/님$/, '')} 고객님`
  return `${raw} 고객님`
}

function formatExportDateLabel(value) {
  const raw = formatExportDisplayDate(value)
  if (!raw) return ''
  return `${raw} 폐기예정`
}

function formatExportLocationLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return `주소 : ${raw}`
}

function buildExportInfoInlineText({ customerName = '', disposalDate = '', location = '' }) {
  return [
    formatExportCustomerLabel(customerName),
    formatExportDateLabel(disposalDate),
    formatExportLocationLabel(location),
  ].filter(Boolean).join(' | ')
}

function buildExportInfoLines({ customerName = '', disposalDate = '', location = '' }) {
  return [buildExportInfoInlineText({ customerName, disposalDate, location })].filter(Boolean)
}

function buildEstimateExportFilename({ platform = '', customerName = '', disposalDate = '', location = '', suffix = '', template = '' }) {
  const values = {
    platform: String(platform || '').trim(),
    customerName: String(customerName || '').trim(),
    disposalDate: String(disposalDate || '').trim(),
    location: String(location || '').trim(),
    suffix: String(suffix || '').trim(),
  }
  const defaultLabel = [values.platform, values.customerName, values.disposalDate].filter(Boolean).join(' ')
  const defaultWrapped = defaultLabel ? `[${defaultLabel}] ${values.suffix}` : values.suffix
  const raw = String(template || '').trim()
  const rendered = raw
    ? raw.replace(/\{([^}]+)\}/g, (_, rawKey) => {
      const normalizedKey = EXPORT_TEMPLATE_TOKEN_ALIASES[String(rawKey || '').trim()]
      return normalizedKey ? (values[normalizedKey] || '') : ''
    })
    : defaultWrapped
  return `${sanitizeExportFilename(rendered || defaultWrapped)}.jpg`
}

function sanitizeExportFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 60) || '고객용견적서'
}

async function canvasToJpegBlob(canvas, quality = 0.95) {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('이미지 변환에 실패했습니다.'))
    }, 'image/jpeg', quality)
  })
}

async function loadCanvasImage(src) {
  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('브랜드 이미지를 불러오지 못했습니다.'))
    image.src = src
  })
}

function getEstimateExportFrame(rawContentWidth, rawContentHeight) {
  const compactMargin = rawContentHeight > 1400 ? 18 : 24
  const ratio = rawContentWidth / Math.max(1, rawContentHeight)
  const nearSquare = Math.abs(1 - ratio) <= 0.22

  let frameWidth = rawContentWidth + compactMargin * 2
  let frameHeight = rawContentHeight + compactMargin * 2

  if (nearSquare) {
    const squareSize = Math.max(frameWidth, frameHeight)
    frameWidth = squareSize
    frameHeight = squareSize
  } else if (ratio < 1) {
    const portraitRatio = 3 / 4
    frameWidth = Math.max(frameWidth, frameHeight * portraitRatio)
  } else {
    const landscapeRatio = 4 / 3
    frameHeight = Math.max(frameHeight, frameWidth / landscapeRatio)
  }

  const exportScale = rawContentHeight > 2200
    ? 1.8
    : rawContentHeight > 1700
      ? 2
      : rawContentHeight > 1200
        ? 2.2
        : 2.5

  return {
    frameWidth: Math.ceil(frameWidth),
    frameHeight: Math.ceil(frameHeight),
    offsetX: Math.round((frameWidth - rawContentWidth) / 2),
    offsetY: Math.round((frameHeight - rawContentHeight) / 2),
    exportScale,
  }
}

async function buildEstimateQuoteCanvas({ rows = [], totalFinal = 0, platform = '', customerName = '', disposalDate = '', location = '', mode = 'customer' }) {
  const isCompany = mode === 'company'
  const padding = 28
  const titleHeight = isCompany ? 96 : 52
  const subtitleHeight = isCompany ? 0 : 34
  const includePlatform = isCompany
  const infoLines = buildExportInfoLines({ customerName, disposalDate, location })
  const infoLineGap = 24
  const infoHeight = Math.max(includePlatform ? 54 : 42, infoLines.length ? infoLines.length * infoLineGap : 0)
  const headerHeight = 58
  const rowHeight = 54
  const totalHeight = 76
  const footerGap = 20
  const bodyRows = Math.max(DEFAULT_VISIBLE_ITEM_ROWS, rows.length)
  const cols = isCompany
    ? [
        { key: 'index', label: '번호', width: 118, align: 'center' },
        { key: 'itemName', label: '품목', width: 416, align: 'center' },
        { key: 'quantity', label: '개수', width: 126, align: 'center' },
        { key: 'reportNo', label: '신고번호', width: 340, align: 'center' },
      ]
    : [
        { key: 'index', label: '번호', width: 118, align: 'center' },
        { key: 'itemName', label: '품목', width: 520, align: 'center' },
        { key: 'quantity', label: '개수', width: 126, align: 'center' },
        { key: 'finalAmount', label: '개별품목비용', width: 236, align: 'right' },
      ]
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0)
  const totalSectionHeight = isCompany ? 0 : (totalHeight + 22)
  const rawContentWidth = padding * 2 + tableWidth
  const rawContentHeight = padding * 2 + titleHeight + subtitleHeight + infoHeight + 6 + headerHeight + bodyRows * rowHeight + totalSectionHeight + footerGap
  const { frameWidth, frameHeight, offsetX, offsetY, exportScale } = getEstimateExportFrame(rawContentWidth, rawContentHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(frameWidth * exportScale))
  canvas.height = Math.max(1, Math.round(frameHeight * exportScale))
  const ctx = canvas.getContext('2d')

  ctx.scale(exportScale, exportScale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, frameWidth, frameHeight)
  ctx.textBaseline = 'middle'

  const startX = offsetX + padding
  let currentY = offsetY + padding

  let logoImage = null
  try {
    const logoSrc = new URL('/disposal-customer-logo.png', window.location.origin).toString()
    logoImage = await loadCanvasImage(logoSrc)
  } catch (error) {
    logoImage = null
  }

  ctx.fillStyle = '#111827'
  ctx.font = '700 28px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('이청잘 폐기 대리신고 견적서', startX, currentY + titleHeight / 2)

  if (logoImage) {
    const maxLogoWidth = isCompany ? 270 : 248
    const maxLogoHeight = isCompany ? 74 : 98
    const ratio = Math.min(maxLogoWidth / logoImage.width, maxLogoHeight / logoImage.height)
    const drawWidth = logoImage.width * ratio
    const drawHeight = logoImage.height * ratio
    const logoRightPadding = 0
    const logoTopPadding = isCompany ? 2 : 0
    const logoX = startX + tableWidth - drawWidth - logoRightPadding
    const logoY = isCompany
      ? currentY + (titleHeight - drawHeight) / 2
      : Math.max(8, currentY + logoTopPadding)
    ctx.drawImage(logoImage, logoX, logoY, drawWidth, drawHeight)
  }

  currentY += titleHeight

  if (!isCompany) {
    ctx.fillStyle = '#16a34a'
    ctx.font = '700 18px sans-serif'
    ctx.fillText("본 견적서는 '대리신고' + '폐기스티커 부착' 서비스에 대한 견적입니다.", startX, currentY + subtitleHeight / 2)
    currentY += subtitleHeight
  }

  ctx.fillStyle = '#374151'
  ctx.font = '700 18px sans-serif'
  ctx.textAlign = 'left'
  if (infoLines.length) {
    const startLineY = currentY + infoLineGap / 2
    infoLines.forEach((line, index) => {
      ctx.fillText(line, startX, startLineY + index * infoLineGap)
    })
  }
  currentY += infoHeight
  currentY += 2

  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 3
  ctx.strokeRect(startX, currentY, tableWidth, headerHeight + bodyRows * rowHeight)

  let x = startX
  cols.forEach(col => {
    ctx.fillStyle = '#f3f4f6'
    ctx.fillRect(x, currentY, col.width, headerHeight)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 3
    ctx.strokeRect(x, currentY, col.width, headerHeight)
    ctx.fillStyle = '#111827'
    ctx.font = '700 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(col.label, x + col.width / 2, currentY + headerHeight / 2)
    x += col.width
  })

  for (let i = 0; i < bodyRows; i += 1) {
    const row = rows[i] || {}
    const rowY = currentY + headerHeight + i * rowHeight
    let colX = startX
    cols.forEach(col => {
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 3
      ctx.strokeRect(colX, rowY, col.width, rowHeight)
      const rawValue = row[col.key] ?? ''
      const value = col.key === 'finalAmount' ? formatCustomerItemCostDisplay(row) : String(rawValue || '')
      ctx.fillStyle = '#111827'
      ctx.font = '500 20px sans-serif'
      if (col.align === 'right') {
        ctx.textAlign = 'right'
        ctx.fillText(value, colX + col.width - 16, rowY + rowHeight / 2)
      } else if (col.align === 'center') {
        ctx.textAlign = 'center'
        ctx.fillText(value, colX + col.width / 2, rowY + rowHeight / 2)
      } else {
        ctx.textAlign = 'left'
        ctx.fillText(value, colX + 16, rowY + rowHeight / 2)
      }
      colX += col.width
    })
  }

  if (!isCompany) {
    const totalY = currentY + headerHeight + bodyRows * rowHeight + 22
    const totalWidth = 650
    const totalX = startX + tableWidth - totalWidth
    ctx.fillStyle = '#eff6ff'
    ctx.fillRect(totalX, totalY, totalWidth, totalHeight)
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 3
    ctx.strokeRect(totalX, totalY, totalWidth, totalHeight)
    ctx.fillStyle = '#2563eb'
    ctx.font = '800 28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('폐기 대리신고 합계비용', totalX + 18, totalY + totalHeight / 2)
    ctx.textAlign = 'right'
    ctx.fillText(formatCustomerTotalCostDisplay(rows, totalFinal || 0), totalX + totalWidth - 18, totalY + totalHeight / 2)
  }

  return canvas
}

async function buildCustomerQuoteCanvas(options = {}) {
  return buildEstimateQuoteCanvas({ ...options, mode: 'customer' })
}

async function buildCompanyQuoteCanvas(options = {}) {
  return buildEstimateQuoteCanvas({ ...options, mode: 'company' })
}

function persistPreviewDraft(draft) {
  try {
    sessionStorage.setItem(DISPOSAL_PREVIEW_SESSION_KEY, JSON.stringify({
      platform: String(draft?.platform || ''),
      customerName: String(draft?.customerName || ''),
      disposalDate: String(draft?.disposalDate || ''),
      location: String(draft?.location || ''),
      district: String(draft?.district || ''),
      finalStatus: String(draft?.finalStatus || ''),
      items: Array.from({ length: Math.min(ITEM_ROW_COUNT, Math.max(DEFAULT_VISIBLE_ITEM_ROWS, (draft?.items || []).length || DEFAULT_VISIBLE_ITEM_ROWS)) }, (_, index) => ({
        ...createEmptyItem(),
        ...((draft?.items || [])[index] || {}),
      })),
    }))
  } catch {}
}

function loadPreviewDraft() {
  try {
    const raw = sessionStorage.getItem(DISPOSAL_PREVIEW_SESSION_KEY)
    if (!raw) return createInitialDraft()
    const parsed = JSON.parse(raw)
    return normalizeRecordShape({ ...parsed, id: 'preview', savedAt: new Date().toISOString(), totals: { totalQty: 0, totalReport: 0, totalFinal: 0 } }) || createInitialDraft()
  } catch {
    return createInitialDraft()
  }
}

function getPaymentStatus(record) {
  const status = String(record?.finalStatus || '').trim()
  if (!status) return '미입금'
  if (/입금완/.test(status)) return '완료'
  return '미입금'
}

function getReportStatus(record) {
  const status = String(record?.finalStatus || '').trim()
  if (!status) return '신고전'
  if (/신고완/.test(status)) return '완료'
  return '신고전'
}
function getFilledRecordItems(record) {
  const filledItems = (record?.items || []).filter(item => {
    return String(item?.itemName || '').trim() || safeNumber(item?.quantity) || safeNumber(item?.unitCost) || String(item?.reportNo || '').trim()
  })
  return filledItems.length ? filledItems : [createEmptyItem()]
}

function getAggregateItemStatus(record, field) {
  const items = getFilledRecordItems(record)
  const key = field === 'payment' ? 'paymentDone' : 'reportDone'
  return items.every(item => !!item?.[key]) ? '완료' : (field === 'payment' ? '미입금' : '신고전')
}

function getSettlementEligibleItems(record) {
  return getFilledRecordItems(record).filter(item => !!item?.paymentDone && String(item?.paymentSettledAt || '').trim())
}

function getRecordSettlementEligibility(record) {
  const eligibleItems = getSettlementEligibleItems(record)
  return {
    eligibleItems,
    hasEligibleItems: eligibleItems.length > 0,
  }
}


function matchesSettlementFilter(record, settlementFilter = 'all') {
  if (settlementFilter === 'completed') return !!record?.settlementTransferredAt
  if (settlementFilter === 'pending') return !record?.settlementTransferredAt
  return true
}

function composeFinalStatus(isPaid, isReported) {
  return `${isPaid ? '입금완' : '입금전'} / ${isReported ? '신고완' : '신고전'}`
}

function getFinalStatusFromPaymentStatus(value, currentFinalStatus = '') {
  const reportDone = /신고완/.test(String(currentFinalStatus || '').trim())
  return composeFinalStatus(value === '완료', reportDone)
}

function getFinalStatusFromFlags(isPaid, isReported) {
  return composeFinalStatus(!!isPaid, !!isReported)
}

function matchesDateFilter(record, dateFilter = 'all', customStartDate = '', customEndDate = '', dateField = 'disposalDate') {
  if (dateFilter === 'all') return true
  const raw = String(record?.[dateField] || '').trim()
  const parsed = getDateValueParts(raw)
  if (!parsed) return false
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const targetStart = new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate())
  if (dateFilter === 'today') return targetStart.getTime() === todayStart.getTime()
  if (dateFilter === '7days') {
    const start = new Date(todayStart)
    start.setDate(start.getDate() - 6)
    return targetStart >= start && targetStart <= todayStart
  }
  if (dateFilter === 'thisMonth') return targetStart.getFullYear() === todayStart.getFullYear() && targetStart.getMonth() === todayStart.getMonth()
  if (dateFilter === 'lastMonth') {
    const lastMonth = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1)
    return targetStart.getFullYear() === lastMonth.getFullYear() && targetStart.getMonth() === lastMonth.getMonth()
  }
  if (dateFilter === 'custom') return isWithinCustomDateRange(raw, customStartDate, customEndDate)
  return true
}

function buildDisposalListGroups(records, sortKey, sortDirection = 'desc', searchQuery = '', dateFilter = 'all', customStartDate = '', customEndDate = '') {
  const grouped = new Map()
  const sorted = sortRecords(records, sortKey, sortDirection)
  const normalizedQuery = normalizeSearchText(searchQuery)
  sorted.forEach((record) => {
    const customerGroupKey = makeCustomerLocationKey(record?.customerName, record?.location) || String(record?.id || '')
    const searchable = normalizeSearchText([record?.platform, record?.customerName, record?.location, record?.disposalDate, record?.district, record?.finalStatus].join(' '))
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return
    if (!matchesDateFilter(record, dateFilter, customStartDate, customEndDate, 'disposalDate')) return
    if (!grouped.has(customerGroupKey)) {
      grouped.set(customerGroupKey, {
        key: customerGroupKey,
        label: `${record?.customerName || '고객명 미지정'}${record?.location ? ` · ${record.location}` : ''}`,
        recordId: record.id,
        platform: record.platform || '-',
        customerName: record.customerName || '-',
        location: record.location || '-',
        disposalDate: record.disposalDate || '-',
        paymentStatus: getAggregateItemStatus(record, 'payment'),
        reportStatus: getAggregateItemStatus(record, 'report'),
        finalStatus: record.finalStatus || '',
        settlementTransferredAt: record.settlementTransferredAt || '',
        savedAt: record.savedAt || '',
        rows: [],
        totals: { quantity: 0, unitCost: 0, reportAmount: 0, feeAmount: 0, finalAmount: 0 },
      })
    }
    const group = grouped.get(customerGroupKey)
    const sourceItems = getFilledRecordItems(record)
    sourceItems.forEach((item, index) => {
      const quantity = safeNumber(item?.quantity)
      const unitCost = safeNumber(item?.unitCost)
      const reportAmount = quantity * unitCost
      const feeAmount = Math.round(reportAmount * 0.3)
      const finalAmount = reportAmount + feeAmount
      group.rows.push({
        key: `${record.id}-${index}`,
        recordId: record.id,
        customerName: record.customerName || '',
        disposalDate: record.disposalDate || '',
        finalStatus: record.finalStatus || '',
        savedAt: record.savedAt || '',
        itemOrder: index,
        itemName: String(item?.itemName || '').trim() || '-',
        quantity,
        unitCost,
        reportAmount,
        feeAmount,
        finalAmount,
        paymentDone: !!item?.paymentDone,
        reportDone: !!item?.reportDone,
        paymentSettledAt: String(item?.paymentSettledAt || ''),
      })
      group.totals.quantity += quantity
      group.totals.unitCost += unitCost
      group.totals.reportAmount += reportAmount
      group.totals.feeAmount += feeAmount
      group.totals.finalAmount += finalAmount
    })
  })
  const list = Array.from(grouped.values())
    .map(group => ({
      ...group,
      rows: sortGroupedRows(group.rows),
    }))

  if (sortKey === 'customer') return list.sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), 'ko'))
  if (sortKey === 'date') return list.sort((a, b) => String(a.disposalDate || '').localeCompare(String(b.disposalDate || ''), 'ko'))
  if (sortKey === 'status') return list.sort((a, b) => String(a.finalStatus || '').localeCompare(String(b.finalStatus || ''), 'ko'))
  return list.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
}


function buildPendingSettlementChangeMessage(record) {
  if (!record) return ''
  return `[${record.disposalDate || '-'}] [${record.platform || '-'}] [${record.customerName || '-'}] [${record.location || '-'}]의 [입금여부] 결산이 변경되었습니다.`
}

function buildSettlementTrackingSnapshot(record) {
  const normalized = normalizeRecordShape(record || {})
  const items = getFilledRecordItems(normalized).map(item => ({
    itemName: String(item?.itemName || '').trim(),
    paymentDone: !!item?.paymentDone,
    paymentSettledAt: String(item?.paymentSettledAt || '').trim(),
    reportDone: !!item?.reportDone,
  }))
  return JSON.stringify({
    id: String(normalized?.id || ''),
    finalStatus: String(normalized?.finalStatus || ''),
    settlementTransferredAt: String(normalized?.settlementTransferredAt || ''),
    items,
  })
}

function getDisposalNavTabKey(pathname = '') {
  if (pathname.startsWith('/disposal/list')) return 'list'
  if (pathname.startsWith('/disposal/settlements')) return 'settlements'
  return 'forms'
}

function DisposalCategoryTabs({ current = 'forms', onNavigate }) {
  return (
    <section className="card disposal-page-tabs-card">
      <div className="disposal-page-tabs">
        {DISPOSAL_NAV_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`disposal-page-tab ${current === tab.key ? 'active' : ''}`.trim()}
            onClick={() => onNavigate?.(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function DisposalConfirmModal({
  open,
  message,
  title = '확인',
  cancelLabel = '취소',
  confirmLabel = '네',
  extraActionLabel = '',
  onConfirm,
  onCancel,
  onExtraAction,
}) {
  if (!open) return null
  return (
    <div className="disposal-confirm-overlay" role="dialog" aria-modal="true">
      <div className="disposal-confirm-card">
        <div className="disposal-confirm-title">{title}</div>
        <div className="disposal-confirm-message">
          {String(message || '').split('\n').map((line, index) => <p key={`confirm-line-${index}`}>{line}</p>)}
        </div>
        <div className="disposal-confirm-actions">
          <button type="button" className="ghost" onClick={onCancel}>{cancelLabel}</button>
          {extraActionLabel ? <button type="button" className="ghost" onClick={onExtraAction}>{extraActionLabel}</button> : null}
          <button type="button" className="ghost active" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
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


function DisposalFinalStatusRichLabel({ value }) {
  const status = String(value || '').trim()
  if (!status) return <span className="disposal-status-placeholder">최종현황 선택</span>
  if (status === '입금전 / 신고전') {
    return (
      <span className="disposal-status-rich">
        <span className="disposal-status-part danger">입금전</span>
        <span className="disposal-status-separator"> / </span>
        <span className="disposal-status-part danger">신고전</span>
      </span>
    )
  }
  if (status === '입금완 / 신고완') {
    return (
      <span className="disposal-status-rich">
        <span className="disposal-status-part primary">입금완</span>
        <span className="disposal-status-separator"> / </span>
        <span className="disposal-status-part primary">신고완</span>
      </span>
    )
  }
  if (status === '입금완 / 신고전') {
    return (
      <span className="disposal-status-rich">
        <span className="disposal-status-part primary">입금완</span>
        <span className="disposal-status-separator"> / </span>
        <span className="disposal-status-part danger">신고전</span>
      </span>
    )
  }
  return <span>{status}</span>
}

function DisposalMetaInputs({ draft, updateDraftField, districtResolved, actions = null }) {
  const platformRef = useRef(null)
  const customerNameRef = useRef(null)
  const disposalDateRef = useRef(null)
  const finalStatusRef = useRef(null)
  const locationRef = useRef(null)
  const districtRef = useRef(null)

  function moveFocus(event, nextRef, prevRef = null) {
    if (event.key === 'Enter') {
      event.preventDefault()
      nextRef?.current?.focus?.()
      if (nextRef?.current?.tagName === 'SELECT') {
        nextRef.current.size = 1
      }
      return
    }
    if (event.key === 'Tab' && event.shiftKey && prevRef?.current) {
      event.preventDefault()
      prevRef.current.focus?.()
      return
    }
  }

  function handleFinalStatusKeyDown(event) {
    const currentIndex = FINAL_STATUS_SELECT_OPTIONS.findIndex(option => option.value === (draft.finalStatus || ''))

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = Math.min(currentIndex + 1, FINAL_STATUS_SELECT_OPTIONS.length - 1)
      updateDraftField('finalStatus', FINAL_STATUS_SELECT_OPTIONS[nextIndex]?.value || '')
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const nextIndex = Math.max(currentIndex - 1, 0)
      updateDraftField('finalStatus', FINAL_STATUS_SELECT_OPTIONS[nextIndex]?.value || '')
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      updateDraftField('finalStatus', '')
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      updateDraftField('finalStatus', FINAL_STATUS_OPTIONS[FINAL_STATUS_OPTIONS.length - 1] || '')
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      locationRef.current?.focus?.()
      return
    }

    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      disposalDateRef.current?.focus?.()
    }
  }

  const statusClass = draft.finalStatus === '입금전'
    ? 'disposal-status-danger'
    : (draft.finalStatus === '입금완 / 신고완' ? 'disposal-status-primary' : (draft.finalStatus === '입금완 / 신고전' ? 'disposal-status-mixed' : ''))

  return (
    <section className="card disposal-entry-card">
      <div className="disposal-meta-layout">
        <div className="disposal-meta-row disposal-meta-row-top">
          <select ref={platformRef} value={draft.platform || ''} onChange={e => updateDraftField('platform', e.target.value)} onKeyDown={e => moveFocus(e, customerNameRef)} className={!draft.platform ? 'is-placeholder' : ''}>
            <option value="">플랫폼</option>
            {PLATFORM_OPTIONS.filter(Boolean).map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <input ref={customerNameRef} value={draft.customerName} onChange={e => updateDraftField('customerName', e.target.value)} onKeyDown={e => moveFocus(e, disposalDateRef, platformRef)} placeholder="고객명" />
          <input ref={disposalDateRef} value={draft.disposalDate} onChange={e => updateDraftField('disposalDate', e.target.value)} onKeyDown={e => moveFocus(e, finalStatusRef, customerNameRef)} placeholder="폐기일자" />
          <div className={`disposal-top-status-actions${actions ? ' has-actions' : ' no-actions'}`}> 
            <div className={`disposal-final-status-shell ${statusClass}`.trim()}>
              <select
                ref={finalStatusRef}
                className={`disposal-final-status-select ${statusClass} ${draft.finalStatus ? 'has-value' : 'is-placeholder'}`.trim()}
                value={draft.finalStatus}
                onChange={e => updateDraftField('finalStatus', e.target.value)}
                onKeyDown={handleFinalStatusKeyDown}
              >
                {FINAL_STATUS_SELECT_OPTIONS.map(option => <option key={option.value || 'placeholder'} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            {actions ? <div className="disposal-meta-inline-actions">{actions}</div> : null}
          </div>
        </div>
        <div className="disposal-meta-row disposal-meta-row-bottom">
          <input ref={locationRef} value={draft.location} onChange={e => updateDraftField('location', e.target.value)} onKeyDown={e => moveFocus(e, districtRef, finalStatusRef)} placeholder="폐기장소" />
          <div className="disposal-district-field">
            <input ref={districtRef} value={draft.district} onChange={e => updateDraftField('district', e.target.value)} onKeyDown={e => moveFocus(e, null, locationRef)} placeholder="관할구역" />
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

function DisposalItemsEditor({
  draft,
  rendered,
  updateItem,
  addItemRow,
  deleteMode,
  selectedItemRows,
  toggleDeleteMode,
  toggleItemRowSelection,
  deleteSelectedItemRows,
  itemSettingsOpen,
  setItemSettingsOpen,
  defaultVisibleRows,
  configureDefaultVisibleRows,
  itemSettingsRef,
  onAutoSaveRecord,
  existingRecordId,
  onOpenPreview,
  onOpenRegistry,
  onSaveEstimate,
}) {
  const effectiveVisibleRows = clampVisibleItemRows(defaultVisibleRows)
  const visibleRows = useMemo(() => (draft.items || []).slice(0, effectiveVisibleRows), [draft.items, effectiveVisibleRows])
  const visibleRendered = useMemo(
    () => buildRenderedTemplate({ ...draft, items: visibleRows }),
    [draft, visibleRows],
  )
  const [customerSettingsOpen, setCustomerSettingsOpen] = useState(false)
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false)
  const [customerSaveDirectoryHandle, setCustomerSaveDirectoryHandle] = useState(null)
  const [companySaveDirectoryHandle, setCompanySaveDirectoryHandle] = useState(null)
  const [customerSaveDirectoryLabel, setCustomerSaveDirectoryLabel] = useState('기본 다운로드 폴더')
  const [companySaveDirectoryLabel, setCompanySaveDirectoryLabel] = useState('기본 다운로드 폴더')
  const [showItemsHelp, setShowItemsHelp] = useState(false)
  const [activeNoteInfo, setActiveNoteInfo] = useState(null)
  const [previewModalKind, setPreviewModalKind] = useState('')
  const [previewImageSrc, setPreviewImageSrc] = useState('')
  const [previewImageLoading, setPreviewImageLoading] = useState(false)
  const [exportSettings, setExportSettings] = useState(() => loadDisposalExportSettings())
  const customerSettingsRef = useRef(null)
  const companySettingsRef = useRef(null)
  const itemSettingsButtonRef = useRef(null)
  const itemSettingsPopoverRef = useRef(null)
  const [itemSettingsPopoverStyle, setItemSettingsPopoverStyle] = useState(null)

  const customerExportRows = useMemo(() => visibleRows.reduce((acc, row, index) => {
    const hasContent = String(row?.itemName || '').trim() || safeNumber(row?.quantity) || safeNumber(row?.unitCost) || String(row?.reportNo || '').trim()
    if (!hasContent) return acc
    const item = visibleRendered.reportRows[index] || { finalAmount: 0, isFree: false, customerDisplayCost: '' }
    acc.push({
      index: acc.length + 1,
      itemName: row?.itemName || '',
      quantity: row?.quantity || '',
      finalAmount: item.finalAmount || 0,
      isFree: !!item.isFree,
      customerDisplayCost: item.customerDisplayCost || '',
    })
    return acc
  }, []), [visibleRows, visibleRendered.reportRows])

  const companyExportRows = useMemo(() => visibleRows.reduce((acc, row) => {
    const hasContent = String(row?.itemName || '').trim() || safeNumber(row?.quantity) || safeNumber(row?.unitCost) || String(row?.reportNo || '').trim()
    if (!hasContent) return acc
    acc.push({
      index: acc.length + 1,
      itemName: row?.itemName || '',
      quantity: row?.quantity || '',
      reportNo: row?.reportNo || '',
    })
    return acc
  }, []), [visibleRows])

  useEffect(() => {
    if (!customerSettingsOpen && !companySettingsOpen) return undefined
    function handleOutsideClick(event) {
      if (customerSettingsOpen && !customerSettingsRef.current?.contains(event.target)) {
        setCustomerSettingsOpen(false)
      }
      if (companySettingsOpen && !companySettingsRef.current?.contains(event.target)) {
        setCompanySettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [customerSettingsOpen, companySettingsOpen])

  useEffect(() => {
    if (!itemSettingsOpen) {
      setItemSettingsPopoverStyle(null)
      return undefined
    }

    function updateItemSettingsPopoverPosition() {
      const buttonEl = itemSettingsButtonRef.current
      const popoverEl = itemSettingsPopoverRef.current
      if (!buttonEl || !popoverEl) return

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
      const gap = 8
      const buttonRect = buttonEl.getBoundingClientRect()
      const popoverRect = popoverEl.getBoundingClientRect()

      const openBelow = buttonRect.bottom + gap + popoverRect.height <= viewportHeight - gap || buttonRect.top < popoverRect.height
      const top = openBelow ? buttonRect.height + 6 : -(popoverRect.height + 6)

      let left = 0
      if (buttonRect.left + popoverRect.width > viewportWidth - gap) {
        left = Math.min(0, viewportWidth - gap - buttonRect.left - popoverRect.width)
      }
      if (buttonRect.left + left < gap) {
        left += gap - (buttonRect.left + left)
      }

      setItemSettingsPopoverStyle({ top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, right: 'auto' })
    }

    const rafId = window.requestAnimationFrame(updateItemSettingsPopoverPosition)
    window.addEventListener('resize', updateItemSettingsPopoverPosition)
    window.addEventListener('scroll', updateItemSettingsPopoverPosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateItemSettingsPopoverPosition)
      window.removeEventListener('scroll', updateItemSettingsPopoverPosition, true)
    }
  }, [itemSettingsOpen])

  async function openEstimatePreviewModal(kind) {
    const nextKind = kind === 'company' ? 'company' : 'customer'
    setPreviewModalKind(nextKind)
    setPreviewImageSrc('')
    setPreviewImageLoading(true)
    try {
      const canvas = nextKind === 'company'
        ? await buildCompanyQuoteCanvas({
            rows: companyExportRows,
            customerName: draft.customerName,
            disposalDate: draft.disposalDate,
            location: draft.location,
          })
        : await buildCustomerQuoteCanvas({
            rows: customerExportRows,
            totalFinal: visibleRendered.totals.totalFinal || 0,
            customerName: draft.customerName,
            disposalDate: draft.disposalDate,
            location: draft.location,
          })
      setPreviewImageSrc(canvas.toDataURL('image/jpeg', 0.95))
    } catch (error) {
      window.alert(error?.message || '미리보기를 생성하지 못했습니다.')
      setPreviewModalKind('')
    } finally {
      setPreviewImageLoading(false)
    }
  }

  function closeEstimatePreviewModal() {
    setPreviewModalKind('')
    setPreviewImageSrc('')
    setPreviewImageLoading(false)
  }

  function updateExportTemplate(kind) {
    const currentTemplate = kind === 'customer' ? exportSettings.customerTemplate : exportSettings.companyTemplate
    const nextTemplate = window.prompt(
      '파일명 형식을 입력해주세요.\n사용 가능 항목: {플랫폼} {고객명} {폐기날짜} {폐기주소} {suffix}\n영문 항목 {platform} {customerName} {disposalDate} {location} 도 함께 사용할 수 있습니다.\n\n빈값으로 확인하면 기본 형식으로 복원됩니다.',
      currentTemplate,
    )
    if (nextTemplate === null) return
    const normalized = saveDisposalExportSettings({
      ...exportSettings,
      [kind === 'customer' ? 'customerTemplate' : 'companyTemplate']: String(nextTemplate || '').trim() || (kind === 'customer' ? DEFAULT_CUSTOMER_EXPORT_TEMPLATE : DEFAULT_COMPANY_EXPORT_TEMPLATE),
    })
    setExportSettings(normalized)
    window.alert('견적 저장 파일명이 변경되었습니다.')
  }

  function getDirectoryPickerErrorMessage(error) {
    const rawMessage = String(error?.message || '')
    const normalizedMessage = rawMessage.toLowerCase()

    if (
      normalizedMessage.includes('system files')
      || normalizedMessage.includes('could not be opened')
      || normalizedMessage.includes('not allowed')
      || normalizedMessage.includes('permission')
    ) {
      return '선택한 폴더 접근 권한을 브라우저가 허용하지 않았습니다.\n다른 일반 로컬 폴더를 선택한 뒤 다시 저장해주세요.'
    }

    return '견적저장위치를 지정하지 못했습니다.\n다운로드, 문서, 바탕화면 또는 직접 만든 일반 폴더를 다시 선택해주세요.'
  }

  async function selectCustomerSaveDirectory() {
    if (!window.showDirectoryPicker) {
      window.alert('현재 브라우저에서는 저장 폴더 지정을 지원하지 않습니다. 크롬 최신 브라우저에서 사용해주세요.')
      return
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      setCustomerSaveDirectoryHandle(handle)
      setCustomerSaveDirectoryLabel(handle?.name || '선택된 폴더')
      setCustomerSettingsOpen(false)
    } catch (error) {
      if (error?.name !== 'AbortError') {
        window.alert(getDirectoryPickerErrorMessage(error))
      }
    }
  }

  async function selectCompanySaveDirectory() {
    if (!window.showDirectoryPicker) {
      window.alert('현재 브라우저에서는 저장 폴더 지정을 지원하지 않습니다. 크롬 최신 브라우저에서 사용해주세요.')
      return
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      setCompanySaveDirectoryHandle(handle)
      setCompanySaveDirectoryLabel(handle?.name || '선택된 폴더')
      setCompanySettingsOpen(false)
    } catch (error) {
      if (error?.name !== 'AbortError') {
        window.alert(getDirectoryPickerErrorMessage(error))
      }
    }
  }

  async function saveBlobWithPicker(blob, suggestedName) {
    if (!window.showSaveFilePicker) return { supported: false, saved: false, cancelled: false }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'JPEG 이미지', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { supported: true, saved: true, cancelled: false }
    } catch (error) {
      if (error?.name === 'AbortError') return { supported: true, saved: false, cancelled: true }
      throw error
    }
  }

  async function saveCustomerEstimateAsJpg() {
    try {
      const autoSavedRecord = makeRecordFromDraft(draft, rendered.totals, existingRecordId || '')
      const canvas = await buildCustomerQuoteCanvas({
        rows: customerExportRows,
        totalFinal: rendered.totals.totalFinal || 0,
        customerName: draft.customerName,
        disposalDate: draft.disposalDate,
        location: draft.location,
      })
      const blob = await canvasToJpegBlob(canvas)
      const filename = buildEstimateExportFilename({
        platform: draft.platform,
        customerName: draft.customerName,
        disposalDate: draft.disposalDate,
        suffix: '폐기견적',
        template: exportSettings.customerTemplate,
        location: draft.location,
      })

      if (customerSaveDirectoryHandle) {
        const permission = await customerSaveDirectoryHandle.queryPermission?.({ mode: 'readwrite' })
        if (permission !== 'granted') {
          const requested = await customerSaveDirectoryHandle.requestPermission?.({ mode: 'readwrite' })
          if (requested !== 'granted') throw new Error('저장 폴더 쓰기 권한이 허용되지 않았습니다.')
        }
        const fileHandle = await customerSaveDirectoryHandle.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        window.alert(`고객용 견적서가 저장되었습니다.\n저장위치: ${customerSaveDirectoryLabel}`)
        return
      }

      const pickerResult = await saveBlobWithPicker(blob, filename)
      if (pickerResult.saved) {
        onAutoSaveRecord?.(autoSavedRecord)
        return
      }
      if (pickerResult.supported && pickerResult.cancelled) {
        return
      }

      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      onAutoSaveRecord?.(autoSavedRecord)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      window.alert(error?.message || '고객용 견적서를 저장하지 못했습니다.')
    }
  }


  async function saveCompanyEstimateAsJpg() {
    try {
      const canvas = await buildCompanyQuoteCanvas({
        rows: companyExportRows,
        customerName: draft.customerName,
        disposalDate: draft.disposalDate,
        location: draft.location,
      })
      const blob = await canvasToJpegBlob(canvas)
      const filename = buildEstimateExportFilename({
        platform: draft.platform,
        customerName: draft.customerName,
        disposalDate: draft.disposalDate,
        suffix: '폐기밴드',
        template: exportSettings.companyTemplate,
        location: draft.location,
      })

      if (companySaveDirectoryHandle) {
        const permission = await companySaveDirectoryHandle.queryPermission?.({ mode: 'readwrite' })
        if (permission !== 'granted') {
          const requested = await companySaveDirectoryHandle.requestPermission?.({ mode: 'readwrite' })
          if (requested !== 'granted') throw new Error('저장 폴더 쓰기 권한이 허용되지 않았습니다.')
        }
        const fileHandle = await companySaveDirectoryHandle.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        window.alert(`회사용 견적서가 저장되었습니다.
저장위치: ${companySaveDirectoryLabel}`)
        return
      }

      const pickerResult = await saveBlobWithPicker(blob, filename)
      if (pickerResult.saved) {
        window.alert('회사용 견적서가 저장되었습니다.')
        return
      }
      if (pickerResult.supported && pickerResult.cancelled) {
        return
      }

      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      window.alert('회사용 견적서 JPG 파일 다운로드가 시작되었습니다.')
    } catch (error) {
      window.alert(error?.message || '회사용 견적서를 저장하지 못했습니다.')
    }
  }

  function handleItemGridKeyDown(event, rowIndex, colIndex) {
    const key = event.key
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return

    const activeElement = event.currentTarget
    const isTextInput = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
    if (isTextInput && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const value = String(activeElement.value || '')
      const selectionStart = typeof activeElement.selectionStart === 'number' ? activeElement.selectionStart : value.length
      const selectionEnd = typeof activeElement.selectionEnd === 'number' ? activeElement.selectionEnd : value.length
      const hasRangeSelection = selectionStart !== selectionEnd
      const atLeftEdge = selectionStart === 0 && selectionEnd === 0
      const atRightEdge = selectionStart === value.length && selectionEnd === value.length

      if (hasRangeSelection) return
      if (key === 'ArrowLeft' && !atLeftEdge) return
      if (key === 'ArrowRight' && !atRightEdge) return
    }

    event.preventDefault()
    const maxRowIndex = visibleRows.length
    let nextRow = rowIndex
    let nextCol = colIndex
    if (key === 'ArrowLeft') nextCol -= 1
    if (key === 'ArrowRight') nextCol += 1
    if (key === 'ArrowUp') nextRow -= 1
    if (key === 'ArrowDown') nextRow += 1

    nextRow = Math.max(0, Math.min(maxRowIndex, nextRow))
    nextCol = Math.max(0, Math.min(7, nextCol))

    const selector = `[data-grid-row="${nextRow}"][data-grid-col="${nextCol}"]`
    const nextEl = document.querySelector(selector)
    if (nextEl && typeof nextEl.focus === 'function') {
      nextEl.focus()
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && (nextEl instanceof HTMLInputElement || nextEl instanceof HTMLTextAreaElement)) {
        const nextValue = String(nextEl.value || '')
        const caretPosition = key === 'ArrowLeft' ? nextValue.length : 0
        try {
          nextEl.setSelectionRange(caretPosition, caretPosition)
        } catch (error) {
          // ignore selection range errors for unsupported input types
        }
      }
    }
  }


  return (
    <section className="card disposal-items-card disposal-square-ui">
      <div className="disposal-items-section disposal-items-input-section">
        <div className="disposal-items-head disposal-items-head-bar">
          <div>
            <h3>폐기품목입력</h3>
          </div>
          <div className="disposal-items-toolbar" ref={itemSettingsRef}>
            <button type="button" className="ghost" onClick={() => setShowItemsHelp(true)}>설명</button>
            <button type="button" className="ghost" onClick={addItemRow}>품목추가</button>
            <button type="button" className={`ghost ${deleteMode ? 'active' : ''}`.trim()} onClick={toggleDeleteMode}>{deleteMode ? '삭제모드닫기' : '삭제'}</button>
            <div className="disposal-settings-inline disposal-item-settings-inline">
              <button ref={itemSettingsButtonRef} type="button" className="ghost disposal-preview-settings-button disposal-preview-settings-button-inline" onClick={() => setItemSettingsOpen(prev => !prev)} aria-label="폐기양식 설정">설정</button>
              <button
                type="button"
                className="ghost disposal-preview-settings-button disposal-preview-settings-button-inline"
                onClick={onSaveEstimate}
                aria-label="폐기목록 저장"
                title="현재 입력한 내용을 폐기목록에 저장"
              >
                저장
              </button>
              {itemSettingsOpen ? (
                <div ref={itemSettingsPopoverRef} style={itemSettingsPopoverStyle || undefined} className="disposal-settings-popover disposal-item-settings-popover">
                  <button type="button" className="ghost disposal-settings-popover-item" onClick={() => { onOpenPreview(); setItemSettingsOpen(false) }}>폐기견적서 전체 미리보기</button>
                  <button type="button" className="ghost disposal-settings-popover-item" onClick={() => { onOpenRegistry(); setItemSettingsOpen(false) }}>관할구역등록</button>
                  <button type="button" className="ghost disposal-settings-popover-item" onClick={configureDefaultVisibleRows}>기본품목칸</button>
                </div>
              ) : null}
            </div>
            {deleteMode ? <button type="button" className="ghost active" onClick={deleteSelectedItemRows}>선택삭제</button> : null}
          </div>
        </div>

        <div className="disposal-items-table-wrap">
          <div className={`disposal-items-table ${deleteMode ? 'delete-mode' : ''}`.trim()}>
            <div className="disposal-items-table-row disposal-items-table-head">
              {deleteMode ? <div>체크</div> : null}
              <div className="disposal-table-multiline-head"><span>번</span><span>호</span></div>
              <div>품목</div>
              <div className="disposal-table-multiline-head"><span>개</span><span>수</span></div>
              <div className="disposal-table-multiline-head"><span>개당</span><span>신고비용</span></div>
              <div className="disposal-table-multiline-head"><span>신고</span><span>합계비용</span></div>
              <div className="disposal-table-singleline-head">매출액</div>
              <div>신고번호</div>
              <div className="disposal-items-note-column">메모칸</div>
            </div>
            {visibleRows.map((row, index) => {
              const item = visibleRendered.reportRows[index] || { reportAmount: 0, finalAmount: 0 }
              return (
                <div key={`disposal-item-row-${index}`} className="disposal-items-table-row disposal-items-table-data-row">
                  {deleteMode ? (
                    <label className="disposal-items-delete-check">
                      <input type="checkbox" checked={selectedItemRows.includes(index)} onChange={e => toggleItemRowSelection(index, e.target.checked)} />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    data-grid-row={index}
                    data-grid-col={0}
                    onKeyDown={e => handleItemGridKeyDown(e, index, 0)}
                    className={`disposal-items-number-cell ${String(row?.note || '').trim() ? 'has-note' : ''}`.trim()}
                    onClick={() => {
                      if (!String(row?.note || '').trim()) return
                      setActiveNoteInfo({ index: index + 1, itemName: row?.itemName || '', note: row?.note || '' })
                    }}
                    title={String(row?.note || '').trim() ? '메모 보기' : '메모 없음'}
                  >
                    {index + 1}
                  </button>
                  <input data-grid-row={index} data-grid-col={1} onKeyDown={e => handleItemGridKeyDown(e, index, 1)} value={row?.itemName || ''} onChange={e => updateItem(index, 'itemName', e.target.value)} placeholder="품목" />
                  <input data-grid-row={index} data-grid-col={2} onKeyDown={e => handleItemGridKeyDown(e, index, 2)} inputMode="numeric" value={row?.quantity || ''} onChange={e => updateItem(index, 'quantity', e.target.value)} placeholder="개수" />
                  <input data-grid-row={index} data-grid-col={3} onKeyDown={e => handleItemGridKeyDown(e, index, 3)} inputMode="numeric" value={row?.unitCost || ''} onChange={e => updateItem(index, 'unitCost', e.target.value)} placeholder="개당신고비용" />
                  <div tabIndex={0} data-grid-row={index} data-grid-col={4} onKeyDown={e => handleItemGridKeyDown(e, index, 4)} className="disposal-items-metric-cell">{formatCurrencyPlain(item.reportAmount || 0)}</div>
                  <div tabIndex={0} data-grid-row={index} data-grid-col={5} onKeyDown={e => handleItemGridKeyDown(e, index, 5)} className="disposal-items-metric-cell strong">{formatCurrencyPlain(item.finalAmount || 0)}</div>
                  <input data-grid-row={index} data-grid-col={6} onKeyDown={e => handleItemGridKeyDown(e, index, 6)} value={row?.reportNo || ''} onChange={e => updateItem(index, 'reportNo', e.target.value)} placeholder="신고번호" />
                  <input data-grid-row={index} data-grid-col={7} onKeyDown={e => handleItemGridKeyDown(e, index, 7)} className="disposal-items-note-column" value={row?.note || ''} onChange={e => updateItem(index, 'note', e.target.value)} placeholder="메모칸" />
                </div>
              )
            })}
            <div className={`disposal-items-table-row disposal-items-summary-row ${deleteMode ? 'delete-mode' : ''}`.trim()}>
              {deleteMode ? <div /> : null}
              <div />
              <div tabIndex={0} data-grid-row={visibleRows.length} data-grid-col={1} onKeyDown={e => handleItemGridKeyDown(e, visibleRows.length, 1)} className="disposal-items-summary-box strong center">합계</div>
              <div tabIndex={0} data-grid-row={visibleRows.length} data-grid-col={2} onKeyDown={e => handleItemGridKeyDown(e, visibleRows.length, 2)} className="disposal-items-summary-box strong center">{formatNumber(visibleRendered.totals.totalQty)}개</div>
              <div />
              <div tabIndex={0} data-grid-row={visibleRows.length} data-grid-col={5} onKeyDown={e => handleItemGridKeyDown(e, visibleRows.length, 5)} className="disposal-items-summary-box strong center">{formatCurrencyPlain(visibleRendered.totals.totalReport)}</div>
              <div tabIndex={0} data-grid-row={visibleRows.length} data-grid-col={6} onKeyDown={e => handleItemGridKeyDown(e, visibleRows.length, 6)} className="disposal-items-summary-box strong center">{formatCurrencyPlain(visibleRendered.totals.totalFinal)}</div>
              <input
                data-grid-row={visibleRows.length}
                data-grid-col={7}
                onKeyDown={e => handleItemGridKeyDown(e, visibleRows.length, 7)}
                className="disposal-items-summary-input center"
                value={draft.items.every(item => String(item?.reportNo || '') === String(draft.items?.[0]?.reportNo || '')) ? String(draft.items?.[0]?.reportNo || '') : ''}
                onChange={e => updateAllItemReportNo(e.target.value)}
                placeholder="신고번호 일괄입력"
                aria-label="합계 행 신고번호 일괄입력"
              />
            </div>
          </div>
        </div>
        <div className="disposal-mobile-note-hint">* '번호'를 누르면 해당품목의 메모정보를 볼 수 있습니다.</div>
      </div>

      <div className="disposal-items-section disposal-linked-preview-card customer-preview-card">
        <div className="disposal-linked-preview-card-head">
          <div className="disposal-linked-preview-title customer-title">고객용</div>
          <div className="disposal-linked-preview-actions" ref={customerSettingsRef}>
            <button type="button" className="ghost disposal-preview-preview-button" onClick={() => openEstimatePreviewModal('customer')}>미리보기</button>
            <button type="button" className="ghost disposal-preview-save-button" onClick={saveCustomerEstimateAsJpg}>견적저장</button>
            <button type="button" className="ghost disposal-preview-settings-button" onClick={() => setCustomerSettingsOpen(prev => !prev)} aria-label="고객용 설정">⚙</button>
            {customerSettingsOpen ? (
              <div className="disposal-settings-popover disposal-customer-settings-popover">
                <div className="disposal-settings-popover-caption">고객용 저장은 기본 설정으로 바로 저장됩니다.</div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="disposal-linked-preview-meta customer-large-text">
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-platform">{draft.platform || '-'}</div>
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-name">{formatExportCustomerLabel(draft.customerName) || '-'}</div>
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-date">{formatExportDateLabel(draft.disposalDate) || '-'}</div>
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-location">{formatExportLocationLabel(draft.location) || '-'}</div>
        </div>
        <div className="disposal-linked-preview-table customer customer-large-text">
          <div className="disposal-linked-preview-row head">
            <div>번호</div>
            <div>품목</div>
            <div>개수</div>
            <div>개별품목비용</div>
          </div>
          {customerExportRows.map(row => (
            <div key={`customer-view-${row.index}`} className="disposal-linked-preview-row">
              <div>{row.index}</div>
              <div>{row.itemName || ''}</div>
              <div>{row.quantity || ''}</div>
              <div>{formatCustomerItemCostDisplay(row)}</div>
            </div>
          ))}
        </div>
        <div className="disposal-linked-preview-total wide emphasize-blue">
          <span>폐기 대리신고 합계비용</span>
          <strong>{formatCustomerTotalCostDisplay(customerExportRows, rendered.totals.totalFinal || 0)}</strong>
        </div>
      </div>

      <div className="disposal-items-section disposal-linked-preview-card customer-preview-card">
        <div className="disposal-linked-preview-card-head">
          <div className="disposal-linked-preview-title customer-title">회사용</div>
          <div className="disposal-linked-preview-actions" ref={companySettingsRef}>
            <button type="button" className="ghost disposal-preview-preview-button" onClick={() => openEstimatePreviewModal('company')}>미리보기</button>
            <button type="button" className="ghost disposal-preview-save-button" onClick={saveCompanyEstimateAsJpg}>견적저장</button>
            <button type="button" className="ghost disposal-preview-settings-button" onClick={() => setCompanySettingsOpen(prev => !prev)} aria-label="회사용 설정">⚙</button>
            {companySettingsOpen ? (
              <div className="disposal-settings-popover disposal-customer-settings-popover">
                <div className="disposal-settings-popover-caption">회사용 저장은 기본 설정으로 바로 저장됩니다.</div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="disposal-linked-preview-meta customer-large-text">
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-platform">{draft.platform || '-'}</div>
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-name">{formatExportCustomerLabel(draft.customerName) || '-'}</div>
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-date">{formatExportDateLabel(draft.disposalDate) || '-'}</div>
          <div className="disposal-linked-preview-meta-chip disposal-linked-preview-meta-chip-location">{formatExportLocationLabel(draft.location) || '-'}</div>
        </div>
        <div className="disposal-linked-preview-table customer company customer-large-text">
          <div className="disposal-linked-preview-row head">
            <div>번호</div>
            <div>품목</div>
            <div>개수</div>
            <div>신고번호</div>
          </div>
          {companyExportRows.map(row => (
            <div key={`company-view-${row.index}`} className="disposal-linked-preview-row">
              <div>{row.index}</div>
              <div>{row.itemName || ''}</div>
              <div>{row.quantity || ''}</div>
              <div>{row.reportNo || ''}</div>
            </div>
          ))}
        </div>
      </div>

      {previewModalKind ? (
        <div className="disposal-inline-popup-backdrop" onClick={closeEstimatePreviewModal}>
          <div className="disposal-inline-popup disposal-estimate-preview-popup" onClick={e => e.stopPropagation()}>
            <div className="disposal-inline-popup-title">{previewModalKind === 'company' ? '회사용 저장 이미지 미리보기' : '고객용 저장 이미지 미리보기'}</div>
            <div className="disposal-inline-popup-subtitle">견적저장 버튼으로 저장될 JPG 결과를 저장 전에 미리 보여줍니다.</div>
            <div className="disposal-estimate-preview-frame disposal-estimate-preview-image-frame">
              {previewImageLoading ? (
                <div className="disposal-estimate-preview-loading">저장 이미지 미리보기를 생성하는 중입니다.</div>
              ) : previewImageSrc ? (
                <img
                  src={previewImageSrc}
                  alt={previewModalKind === 'company' ? '회사용 저장 이미지 미리보기' : '고객용 저장 이미지 미리보기'}
                  className="disposal-estimate-preview-image"
                />
              ) : (
                <div className="disposal-estimate-preview-loading">미리보기 이미지를 불러오지 못했습니다.</div>
              )}
            </div>
            <div className="disposal-inline-popup-actions">
              <button type="button" className="ghost" onClick={closeEstimatePreviewModal}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}

      {showItemsHelp ? (
        <div className="disposal-inline-popup-backdrop" onClick={() => setShowItemsHelp(false)}>
          <div className="disposal-inline-popup" onClick={e => e.stopPropagation()}>
            <div className="disposal-inline-popup-title">폐기품목입력 설명</div>
            <div className="disposal-inline-popup-body">개수 × 개당신고비용 = 신고합계비용, 신고합계비용 × 0.3 = 수수료, 신고합계비용 + 수수료 = 매출액으로 자동 계산됩니다.</div>
            <div className="disposal-inline-popup-actions">
              <button type="button" className="ghost" onClick={() => setShowItemsHelp(false)}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeNoteInfo ? (
        <div className="disposal-inline-popup-backdrop" onClick={() => setActiveNoteInfo(null)}>
          <div className="disposal-inline-popup note-popup" onClick={e => e.stopPropagation()}>
            <div className="disposal-inline-popup-title">품목 메모</div>
            <div className="disposal-inline-popup-subtitle">번호 {activeNoteInfo.index}{activeNoteInfo.itemName ? ` · ${activeNoteInfo.itemName}` : ''}</div>
            <div className="disposal-inline-popup-body">{activeNoteInfo.note}</div>
            <div className="disposal-inline-popup-actions">
              <button type="button" className="ghost" onClick={() => setActiveNoteInfo(null)}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}


function DisposalSettingsPopover({ open, onClose, onMoveRegistry, onOpenPreview, canManageJurisdictions }) {
  if (!open) return null
  return (
    <div className="disposal-settings-popover">
      <button type="button" className="ghost disposal-settings-popover-item" onClick={() => { onOpenPreview(); onClose() }}>폐기견적서 전체 미리보기</button>
      {canManageJurisdictions ? <button type="button" className="ghost disposal-settings-popover-item" onClick={() => { onMoveRegistry(); onClose() }}>관할구역등록</button> : null}
    </div>
  )
}


export function DisposalJurisdictionRegistryPage() {
  const navigate = useNavigate()
  const navigateWithDraftGuard = (target) => navigate(target)
  const currentUser = getStoredUser() || {}
  const canEdit = Number(currentUser?.grade || 9) <= 2
  const [rows, setRows] = useState([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [primaryFilter, setPrimaryFilter] = useState('category')
  const [secondaryFilter, setSecondaryFilter] = useState('updated_desc')

  async function load(keyword = '') {
    setLoading(true)
    try {
      const result = await api(`/api/disposal/jurisdictions${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`, { cache: 'no-store' })
      setRows(Array.isArray(result?.rows) ? result.rows.map((row, index) => ({ ...row, addedAt: 0, localId: String(row.id || `loaded-${index}`) })) : [])
      setSelectedIds(prev => prev.filter(id => (result?.rows || []).some(row => row.id === id)))
    } catch (error) {
      window.alert(error.message || '관할구역 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canEdit) {
      window.alert('관리자 또는 부관리자만 접근할 수 있습니다.')
      navigate('/disposal/forms', { replace: true })
      return
    }
    load('')
  }, [canEdit, navigate])

  const visibleRows = useMemo(() => {
    const keyword = String(searchKeyword || '').trim().toLowerCase()
    let filtered = rows
    if (keyword) {
      filtered = rows.filter(row => {
        const fieldMap = {
          category: String(row.category || '기본'),
          place_prefix: String(row.place_prefix || ''),
          district_name: String(row.district_name || ''),
          report_link: String(row.report_link || ''),
        }
        const target = primaryFilter === 'all'
          ? Object.values(fieldMap).join(' ')
          : (fieldMap[primaryFilter] || '')
        return target.toLowerCase().includes(keyword)
      })
    }

    const sorted = [...filtered]
    const compareText = (a, b, key, direction = 'asc') => {
      const left = String(a[key] || '').toLowerCase()
      const right = String(b[key] || '').toLowerCase()
      return direction === 'asc' ? left.localeCompare(right, 'ko') : right.localeCompare(left, 'ko')
    }
    const prioritizeNewRows = (a, b) => {
      const aNew = !a?.id
      const bNew = !b?.id
      if (aNew && bNew) return Number(b?.addedAt || 0) - Number(a?.addedAt || 0)
      if (aNew) return -1
      if (bNew) return 1
      return null
    }
    switch (secondaryFilter) {
      case 'asc':
        sorted.sort((a, b) => prioritizeNewRows(a, b) ?? compareText(a, b, primaryFilter === 'all' ? 'place_prefix' : primaryFilter, 'asc'))
        break
      case 'desc':
        sorted.sort((a, b) => prioritizeNewRows(a, b) ?? compareText(a, b, primaryFilter === 'all' ? 'place_prefix' : primaryFilter, 'desc'))
        break
      case 'created_desc':
        sorted.sort((a, b) => prioritizeNewRows(a, b) ?? String(b.created_at || '').localeCompare(String(a.created_at || '')))
        break
      case 'created_asc':
        sorted.sort((a, b) => prioritizeNewRows(a, b) ?? String(a.created_at || '').localeCompare(String(b.created_at || '')))
        break
      case 'updated_asc':
        sorted.sort((a, b) => prioritizeNewRows(a, b) ?? String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
        break
      case 'updated_desc':
      default:
        sorted.sort((a, b) => prioritizeNewRows(a, b) ?? String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        break
    }
    return sorted
  }, [rows, searchKeyword, primaryFilter, secondaryFilter])

  function updateRow(localId, key, value) {
    setRows(prev => prev.map(row => row.localId === localId ? { ...row, [key]: value } : row))
  }

  function addRow() {
    const uid = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setRows(prev => [{ id: null, localId: uid, addedAt: Date.now(), category: '기본', place_prefix: '', district_name: '', report_link: '' }, ...prev])
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
      await load('')
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
      await load('')
      setSelectedIds([])
      window.alert('선택 항목이 삭제되었습니다.')
    } catch (error) {
      window.alert(error.message || '삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <div className="stack-page disposal-page disposal-form-page">
      <DisposalCategoryTabs current="forms" onNavigate={navigateWithDraftGuard} />
      <section className="card disposal-hero">
        <div>
          <h2>관할구역등록</h2>
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
            <select value={primaryFilter} onChange={e => setPrimaryFilter(e.target.value)}>
              <option value="category">1차필터: 구분</option>
              <option value="place_prefix">1차필터: 폐기장소입력칸</option>
              <option value="district_name">1차필터: 관할구역 입력칸</option>
              <option value="report_link">1차필터: 관할구역 폐기신고링크 입력칸</option>
              <option value="all">1차필터: 전체</option>
            </select>
            <select value={secondaryFilter} onChange={e => setSecondaryFilter(e.target.value)}>
              <option value="asc">2차필터: 오름차순</option>
              <option value="desc">2차필터: 내림차순</option>
              <option value="created_desc">2차필터: 등록일순</option>
              <option value="created_asc">2차필터: 등록일 오래된순</option>
              <option value="updated_desc">2차필터: 수정일 최신순</option>
              <option value="updated_asc">2차필터: 수정일 오래된순</option>
            </select>
            <input value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)} placeholder="키워드 검색" />
            <button type="button" className="ghost" onClick={() => load('')}>검색</button>
            <button type="button" className="ghost active" onClick={saveRows} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
          </div>
        </div>
      </section>

      <section className="card disposal-records-card disposal-jurisdiction-table-card">
        <div className="disposal-jurisdiction-grid">
          <div className="disposal-jurisdiction-grid-row disposal-jurisdiction-grid-head">
            <div className="disposal-jurisdiction-head-spacer" />
            <div>구분</div>
            <div>폐기장소입력칸</div>
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
  const handleCategoryNavigate = (path) => navigate(path)
  const { recordId } = useParams()
  const [draft, setDraft] = useState(createInitialDraft())
  const [loadedRecordId, setLoadedRecordId] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [districtResolved, setDistrictResolved] = useState({ matched: false, district_name: '', report_link: '', place_prefix: '' })
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedItemRows, setSelectedItemRows] = useState([])
  const [itemSettingsOpen, setItemSettingsOpen] = useState(false)
  const [defaultVisibleRows, setDefaultVisibleRows] = useState(() => getDefaultVisibleItemRows())
  const [savedDraftBaseline, setSavedDraftBaseline] = useState(() => normalizeDraftForCompare(createInitialDraft()))
  const [pendingDraftNavigation, setPendingDraftNavigation] = useState('')
  const settingsRef = useRef(null)
  const itemSettingsRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      try {
        await bootstrapDisposalRecords()
      } catch {}
      if (cancelled) return
      if (!recordId) {
        setLoadedRecordId('')
        setSavedDraftBaseline(normalizeDraftForCompare(createInitialDraft()))
        return
      }
      const found = loadAllRecords().find(record => record.id === recordId && canUserViewDisposalRecord(record))
      if (found) {
        setLoadedRecordId(found.id || recordId)
        setDraft({
          platform: found.platform || '',
          customerName: found.customerName || '',
          disposalDate: found.disposalDate || '',
          location: found.location || '',
          district: found.district || '',
          finalStatus: found.finalStatus || '',
          items: Array.from({ length: Math.max(getDefaultVisibleItemRows(), Math.min(ITEM_ROW_COUNT, found.items?.length || getDefaultVisibleItemRows())) }, (_, index) => ({ ...createEmptyItem(), ...(found.items?.[index] || {}) })),
        })
        setSavedAt(found.savedAt || '')
        setSavedDraftBaseline(normalizeDraftForCompare({
          platform: found.platform || '',
          customerName: found.customerName || '',
          disposalDate: found.disposalDate || '',
          location: found.location || '',
          district: found.district || '',
          finalStatus: found.finalStatus || '',
          items: Array.from({ length: Math.max(getDefaultVisibleItemRows(), Math.min(ITEM_ROW_COUNT, found.items?.length || getDefaultVisibleItemRows())) }, (_, index) => ({ ...createEmptyItem(), ...(found.items?.[index] || {}) })),
        }))
        return
      }
      setLoadedRecordId('')
      setSavedAt('')
      setSavedDraftBaseline(normalizeDraftForCompare(createInitialDraft()))
      navigate('/disposal/forms', { replace: true })
    }
    loadRecord()
    return () => { cancelled = true }
  }, [recordId, navigate])


useEffect(() => {
  function handleClickOutside(event) {
    if (settingsRef.current && !settingsRef.current.contains(event.target)) setSettingsOpen(false)
    if (itemSettingsRef.current && !itemSettingsRef.current.contains(event.target)) setItemSettingsOpen(false)
  }
  document.addEventListener('mousedown', handleClickOutside)
  return () => document.removeEventListener('mousedown', handleClickOutside)
}, [])

useEffect(() => {
  const trimmed = String(draft.location || '').trim()
  if (!trimmed) {
    setDistrictResolved({ matched: false, district_name: '', report_link: '', place_prefix: '' })
    setDraft(prev => prev.district ? ({ ...prev, district: '' }) : prev)
    return
  }
  const timer = window.setTimeout(async () => {
    try {
      const result = await api(`/api/disposal/jurisdictions/resolve?location=${encodeURIComponent(trimmed)}`, { cache: 'no-store' })
      const normalizedResult = result || { matched: false, district_name: '', report_link: '', place_prefix: '' }
      setDistrictResolved(normalizedResult)
      setDraft(prev => {
        if (normalizedResult?.matched && normalizedResult?.district_name) {
          return prev.district === normalizedResult.district_name ? prev : ({ ...prev, district: normalizedResult.district_name })
        }
        return prev.district ? ({ ...prev, district: '' }) : prev
      })
    } catch {
      setDistrictResolved({ matched: false, district_name: '', report_link: '', place_prefix: '' })
    }
  }, 180)
  return () => window.clearTimeout(timer)
}, [draft.location])

  const rendered = useMemo(() => buildRenderedTemplate(draft), [draft])
  const changedFields = useMemo(() => buildDraftChangeSummary(savedDraftBaseline, draft), [savedDraftBaseline, draft])
  const hasUnsavedChanges = changedFields.length > 0

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    function handleBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    setSelectedItemRows(prev => prev.filter(index => index < (draft.items || []).length))
  }, [draft.items.length])

  function updateDraftField(key, value) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  function updateItem(index, key, value) {
    setDraft(prev => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    }))
  }

  function updateAllItemReportNo(value) {
    setDraft(prev => ({
      ...prev,
      items: (prev.items || []).map(item => ({ ...item, reportNo: value })),
    }))
  }

  function addItemRow() {
    setDraft(prev => {
      if ((prev.items || []).length >= ITEM_ROW_COUNT) {
        window.alert(`폐기품목입력은 최대 ${ITEM_ROW_COUNT}줄까지 추가할 수 있습니다.`)
        return prev
      }
      return { ...prev, items: [...(prev.items || []), createEmptyItem()] }
    })
  }

  function toggleDeleteMode() {
    setDeleteMode(prev => {
      const next = !prev
      if (!next) setSelectedItemRows([])
      return next
    })
  }

  function toggleItemRowSelection(index, checked) {
    setSelectedItemRows(prev => checked ? Array.from(new Set([...prev, index])).sort((a, b) => a - b) : prev.filter(item => item !== index))
  }

  function deleteSelectedItemRows() {
    if (!selectedItemRows.length) {
      window.alert('삭제할 품목을 선택해주세요.')
      return
    }
    setDraft(prev => {
      const selectedSet = new Set(selectedItemRows)
      const remaining = (prev.items || []).filter((_, index) => !selectedSet.has(index))
      return {
        ...prev,
        items: (remaining.length ? remaining : [createEmptyItem()]).concat(Array.from({ length: Math.max(0, getDefaultVisibleItemRows() - Math.max(1, remaining.length)) }, () => createEmptyItem())).slice(0, ITEM_ROW_COUNT),
      }
    })
    setSelectedItemRows([])
    setDeleteMode(false)
  }

  function configureDefaultVisibleRows() {
    const input = window.prompt(`기본품목칸 수를 입력해 주세요. (1~${ITEM_ROW_COUNT})`, String(defaultVisibleRows || getDefaultVisibleItemRows()))
    if (input === null) return
    const nextValue = Math.max(1, Math.min(ITEM_ROW_COUNT, Number(input) || getDefaultVisibleItemRows()))
    setDefaultVisibleRows(nextValue)
    setDefaultVisibleItemRowsStorage(nextValue)
    setDraft(prev => {
      const currentItems = Array.isArray(prev.items) ? [...prev.items] : []
      if (currentItems.length >= nextValue) return prev
      return {
        ...prev,
        items: currentItems.concat(Array.from({ length: nextValue - currentItems.length }, () => createEmptyItem())),
      }
    })
    setItemSettingsOpen(false)
    window.alert(`기본품목칸 수가 ${nextValue}칸으로 변경되었습니다.`)
  }

  async function saveCurrentDraftRecord(options = {}) {
    const { silent = false } = options
    if (!String(draft?.customerName || '').trim()) {
      if (!silent) window.alert('고객명을 입력한 후 저장해주세요.')
      return false
    }
    const current = loadAllRecords()
    const visibleCurrent = loadRecords()
    const effectiveRecordId = String(recordId || loadedRecordId || '').trim()
    const matchedRecord = effectiveRecordId ? null : findMatchingRecord(visibleCurrent, draft)
    const existingRecord = current.find(record => record.id === (effectiveRecordId || matchedRecord?.id || '')) || matchedRecord || null
    const nextRecord = makeRecordFromDraft(draft, rendered.totals, effectiveRecordId || matchedRecord?.id || '', { existingRecord })
    const savedRecord = await upsertDisposalRecordToServer(nextRecord)
    setLoadedRecordId(savedRecord.id)
    setSavedAt(savedRecord.savedAt)
    setSavedDraftBaseline(normalizeDraftForCompare(draft))
    if (!silent) {
      window.alert(effectiveRecordId ? '폐기양식이 수정 저장되어 폐기목록에 반영되었습니다.' : '현재 입력한 정보가 저장되어 폐기목록에 등록되었습니다.')
    }
    return true
  }

  function closeDraftNavigationModal() {
    setPendingDraftNavigation('')
  }

  function navigateWithDraftGuard(target) {
    if (!target) return
    if (!hasUnsavedChanges) {
      navigate(target)
      return
    }
    setPendingDraftNavigation(target)
  }

  async function confirmDraftNavigationSave() {
    const target = String(pendingDraftNavigation || '').trim()
    if (!target) return
    const saved = await saveCurrentDraftRecord({ silent: true })
    if (!saved) return
    setPendingDraftNavigation('')
    navigate(target)
  }

  function ignoreDraftAndNavigate() {
    const target = String(pendingDraftNavigation || '').trim()
    if (!target) return
    setPendingDraftNavigation('')
    navigate(target)
  }
  function openPreviewPage() {
    persistPreviewDraft(draft)
    navigateWithDraftGuard('/disposal/forms/preview')
  }

  function resetDraft() {
    const initialDraft = createInitialDraft()
    setDraft(initialDraft)
    setLoadedRecordId('')
    setSavedAt('')
    setSavedDraftBaseline(normalizeDraftForCompare(initialDraft))
  }

  async function saveSettlementRecord() {
    const saved = await saveCurrentDraftRecord()
    if (!saved) return
    navigate('/disposal/list')
  }

  return (
    <div className="stack-page disposal-page">
      <DisposalCategoryTabs current="forms" onNavigate={navigateWithDraftGuard} />
      <div className="disposal-form-inline-tools" ref={settingsRef}>
        <DisposalMetaInputs
          draft={draft}
          updateDraftField={updateDraftField}
          districtResolved={districtResolved}
        />
      </div>

      <section className="disposal-form-shell disposal-form-shell-single">
        <div className="disposal-form-left">
          <DisposalItemsEditor
            draft={draft}
            rendered={rendered}
            updateItem={updateItem}
            addItemRow={addItemRow}
            deleteMode={deleteMode}
            selectedItemRows={selectedItemRows}
            toggleDeleteMode={toggleDeleteMode}
            toggleItemRowSelection={toggleItemRowSelection}
            deleteSelectedItemRows={deleteSelectedItemRows}
            itemSettingsOpen={itemSettingsOpen}
            setItemSettingsOpen={setItemSettingsOpen}
            defaultVisibleRows={defaultVisibleRows}
            configureDefaultVisibleRows={configureDefaultVisibleRows}
            itemSettingsRef={itemSettingsRef}
            existingRecordId={String(recordId || loadedRecordId || '').trim()}
            onOpenPreview={openPreviewPage}
            onOpenRegistry={() => navigateWithDraftGuard('/disposal/jurisdictions')}
            onSaveEstimate={saveSettlementRecord}
            onAutoSaveRecord={async nextRecord => {
              const currentRecords = loadAllRecords()
              const effectiveRecordId = String(recordId || loadedRecordId || nextRecord?.id || '').trim()
              if (effectiveRecordId) {
                const existingRecord = currentRecords.find(record => record.id === effectiveRecordId) || null
                const normalizedNextRecord = attachDisposalRecordOwner({ ...nextRecord, id: effectiveRecordId, savedAt: new Date().toISOString(), createdByUserId: existingRecord?.createdByUserId || '', createdByUsername: existingRecord?.createdByUsername || '', createdByGrade: existingRecord?.createdByGrade || '' })
                const savedRecord = await upsertDisposalRecordToServer(normalizedNextRecord)
                setLoadedRecordId(effectiveRecordId)
                setSavedAt(savedRecord?.savedAt || '')
                setSavedDraftBaseline(normalizeDraftForCompare(draft))
                return
              }
              const nextRecords = upsertRecordByCustomerLocation(currentRecords, nextRecord)
              const savedRecord = await upsertDisposalRecordToServer(nextRecords[0])
              setSavedAt(savedRecord?.savedAt || '')
              setSavedDraftBaseline(normalizeDraftForCompare(draft))
            }}
          />
        </div>
      </section>

      <DisposalConfirmModal
        open={!!pendingDraftNavigation}
        title="저장되지 않은 변경사항"
        message={['변동된 데이터가 있습니다.', '', ...changedFields, '', '화면 이동 전 저장하시겠습니까?'].join('\n')}
        cancelLabel="되돌아가기"
        extraActionLabel="무시하고 이동"
        confirmLabel="저장 후 이동"
        onCancel={closeDraftNavigationModal}
        onExtraAction={ignoreDraftAndNavigate}
        onConfirm={confirmDraftNavigationSave}
      />
    </div>
  )
}

export function DisposalPreviewPage() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(() => loadPreviewDraft())
  const navigateWithDraftGuard = (target) => navigate(target)

  useEffect(() => {
    setDraft(loadPreviewDraft())
  }, [])

  const rendered = useMemo(() => buildRenderedTemplate(draft), [draft])

  return (
    <div className="stack-page disposal-page">
      <DisposalCategoryTabs current="forms" onNavigate={navigateWithDraftGuard} />
      <section className="card disposal-hero">
        <div>
          <h2>폐기견적서 전체 미리보기</h2>
          <p className="notice-text">설정 버튼에서 호출한 현재 입력값 기준 미리보기 화면입니다.</p>
        </div>
        <div className="disposal-hero-actions">
          <button type="button" className="ghost" onClick={() => navigate(-1)}>뒤로가기</button>
          <button type="button" className="ghost active" onClick={() => navigate('/disposal/forms')}>폐기양식</button>
        </div>
      </section>

      <DisposalTemplateTable title="폐기견적서 전체 미리보기" rendered={rendered} />
    </div>
  )
}

export 
function DisposalBulkPaymentModal({ open, group, rows = [], paymentDates = {}, reportStatuses = {}, onChangeDate, onChangeReportStatus, onApplyAllDates, onApplyAllReports, onConfirm, onClose }) {
  const initialPaymentDatesRef = useRef({})
  const initialReportStatusesRef = useRef({})
  const [filterKey, setFilterKey] = useState('default')

  useEffect(() => {
    if (!open) {
      initialPaymentDatesRef.current = {}
      return
    }
    initialPaymentDatesRef.current = Object.fromEntries(
      rows.map(row => [row.key, String(paymentDates?.[row.key] || '')])
    )
    initialReportStatusesRef.current = Object.fromEntries(
      rows.map(row => [row.key, !!reportStatuses?.[row.key]])
    )
  }, [open, group?.recordId, rows, paymentDates, reportStatuses])

  useEffect(() => {
    if (!open) return
    setFilterKey('default')
  }, [open, group?.recordId])

  const filteredRows = useMemo(() => {
    const list = [...rows]
    if (filterKey === 'item_name') {
      return list.sort((a, b) => String(a?.itemName || '').localeCompare(String(b?.itemName || ''), 'ko'))
    }
    if (filterKey === 'quantity') {
      return list.sort((a, b) => safeNumber(a?.quantity) - safeNumber(b?.quantity) || safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder))
    }
    if (filterKey === 'sales_amount') {
      return list.sort((a, b) => safeNumber(a?.finalAmount) - safeNumber(b?.finalAmount) || safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder))
    }
    if (filterKey === 'payment_date') {
      return list.sort((a, b) => {
        const aValue = String(paymentDates?.[a.key] || '').trim()
        const bValue = String(paymentDates?.[b.key] || '').trim()
        const aIsUnpaid = !aValue || aValue === UNPAID_PAYMENT_VALUE
        const bIsUnpaid = !bValue || bValue === UNPAID_PAYMENT_VALUE
        if (aIsUnpaid !== bIsUnpaid) return aIsUnpaid ? 1 : -1
        return String(aValue).localeCompare(String(bValue), 'ko') || safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder)
      })
    }
    if (filterKey === 'payment_status') {
      return list.sort((a, b) => {
        const aPaid = (() => { const value = String(paymentDates?.[a.key] || '').trim(); return !!value && value !== UNPAID_PAYMENT_VALUE })()
        const bPaid = (() => { const value = String(paymentDates?.[b.key] || '').trim(); return !!value && value !== UNPAID_PAYMENT_VALUE })()
        if (aPaid !== bPaid) return aPaid ? -1 : 1
        return safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder)
      })
    }
    if (filterKey === 'report_status') {
      return list.sort((a, b) => {
        const aReported = !!reportStatuses?.[a.key]
        const bReported = !!reportStatuses?.[b.key]
        if (aReported !== bReported) return aReported ? -1 : 1
        return safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder)
      })
    }
    return list.sort((a, b) => safeNumber(a?.itemOrder) - safeNumber(b?.itemOrder))
  }, [rows, filterKey, paymentDates, reportStatuses])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const initialDates = initialPaymentDatesRef.current || {}
      const initialReports = initialReportStatusesRef.current || {}
      const hasChanges = filteredRows.some(row => String(initialDates[row.key] || '') !== String(paymentDates?.[row.key] || '') || !!initialReports[row.key] !== !!reportStatuses?.[row.key])
      if (!hasChanges) {
        onClose?.()
        return
      }
      const confirmed = window.confirm('입금결산 변동사항이 있습니다. 저장 후 창을 닫으시겠습니까?')
      if (!confirmed) return
      onConfirm?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredRows, paymentDates, reportStatuses, onConfirm, onClose])

  if (!open || !group) return null
  const totalFinalAmount = rows.reduce((sum, row) => sum + safeNumber(row?.finalAmount), 0)
  const handleRequestClose = () => {
    const initialDates = initialPaymentDatesRef.current || {}
    const initialReports = initialReportStatusesRef.current || {}
    const hasChanges = filteredRows.some(row => String(initialDates[row.key] || '') !== String(paymentDates?.[row.key] || '') || !!initialReports[row.key] !== !!reportStatuses?.[row.key])
    if (!hasChanges) {
      onClose?.()
      return
    }
    const confirmed = window.confirm('입금결산 변동사항이 있습니다. 저장 후 창을 닫으시겠습니까?')
    if (!confirmed) return
    onConfirm?.()
  }
  return (
    <div className="disposal-confirm-overlay disposal-bulk-payment-overlay" role="dialog" aria-modal="true" onMouseDown={(event) => {
      if (event.target !== event.currentTarget) return
      handleRequestClose()
    }}>
      <div className="disposal-confirm-card disposal-bulk-payment-card">
        <div className="disposal-bulk-payment-header">
          <button type="button" className="disposal-bulk-payment-back" onClick={handleRequestClose} aria-label="뒤로가기">
            ←
          </button>
          <div className="disposal-bulk-payment-title">입금결산</div>
          <div className="disposal-bulk-payment-header-spacer" />
        </div>

        <div className="disposal-bulk-payment-meta">
          <div className="disposal-bulk-payment-meta-grid">
            <span><strong>폐기날짜</strong><em>{group.disposalDate || '-'}</em></span>
            <span><strong>플랫폼</strong><em>{group.platform || '-'}</em></span>
            <span><strong>고객명</strong><em>{group.customerName || '-'}</em></span>
          </div>
          <div className="disposal-bulk-payment-location"><strong>폐기장소</strong><em>{group.location || '-'}</em></div>
        </div>

        <div className="disposal-bulk-payment-filter-row">
          <label className="disposal-bulk-payment-filter-label" htmlFor="disposal-bulk-filter">필터</label>
          <select id="disposal-bulk-filter" value={filterKey} onChange={e => setFilterKey(e.target.value)} aria-label="입금결산 필터">
            <option value="default">기본순서</option>
            <option value="item_name">품목(오름차순)</option>
            <option value="quantity">수량(오름차순)</option>
            <option value="sales_amount">매출액(오름차순)</option>
            <option value="payment_date">입금일시(날짜 오름차순)</option>
            <option value="payment_status">입금(O/X 분류)</option>
            <option value="report_status">신고(O/X 분류)</option>
          </select>
        </div>

        <div className="disposal-bulk-payment-table-wrap">
          <div className="disposal-bulk-payment-table">
            <div className="disposal-bulk-payment-row disposal-bulk-payment-row-head">
              <div>품목</div>
              <div>수량</div>
              <div>매출액</div>
              <div>입금일시</div>
              <div className="disposal-bulk-payment-cell-center">입금</div>
              <div className="disposal-bulk-payment-cell-center">신고</div>
            </div>
            {filteredRows.map(row => {
              const nextValue = String(paymentDates[row.key] || '').trim()
              const isPaid = !!nextValue && nextValue !== UNPAID_PAYMENT_VALUE
              const isReported = !!reportStatuses?.[row.key]
              return (
                <div key={`bulk-payment-${row.key}`} className="disposal-bulk-payment-row">
                  <div>{row.itemName || '-'}</div>
                  <div>{formatNumber(row.quantity)}개</div>
                  <div>{formatCurrency(row.finalAmount)}</div>
                  <div>
                    <div className="disposal-bulk-payment-date-control">
                      <select
                        value={isPaid ? 'date' : 'unpaid'}
                        onChange={e => {
                          const nextMode = e.target.value
                          if (nextMode === 'unpaid') {
                            onChangeDate?.(row.key, UNPAID_PAYMENT_VALUE)
                            return
                          }
                          const fallbackDate = formatDateInputValue(row.paymentSettledAt) || getTodayDateInputValue()
                          onChangeDate?.(row.key, isPaid ? nextValue : fallbackDate)
                        }}
                        aria-label={`${row.itemName} 입금상태 선택`}
                      >
                        <option value="date">날짜입력</option>
                        <option value="unpaid">미입금</option>
                      </select>
                      <input
                        type="date"
                        value={isPaid ? nextValue : ''}
                        onChange={e => onChangeDate?.(row.key, e.target.value || UNPAID_PAYMENT_VALUE)}
                        aria-label={`${row.itemName} 입금일시`}
                        disabled={!isPaid}
                      />
                    </div>
                  </div>
                  <div className="disposal-bulk-payment-cell-center">{isPaid ? 'O' : 'X'}</div>
                  <div className="disposal-bulk-payment-cell-center">
                    <button
                      type="button"
                      className="disposal-bulk-payment-status-button"
                      onClick={() => onChangeReportStatus?.(row.key, !isReported)}
                      aria-label={`${row.itemName} 신고상태 변경`}
                    >
                      {isReported ? 'O' : 'X'}
                    </button>
                  </div>
                </div>
              )
            })}
            <div className="disposal-bulk-payment-row disposal-bulk-payment-row-total">
              <div>합계</div>
              <div />
              <div>{formatCurrency(totalFinalAmount)}</div>
              <div>
                <div className="disposal-bulk-payment-date-control disposal-bulk-payment-date-control-total">
                  <select
                    value={rows.every(row => { const value = String(paymentDates[row.key] || '').trim(); return !!value && value !== UNPAID_PAYMENT_VALUE; }) ? 'date' : 'unpaid'}
                    onChange={e => {
                      const nextMode = e.target.value
                      if (nextMode === 'unpaid') {
                        const confirmed = window.confirm('미입금으로 입금일시 전체 데이터를 변경하겠습니까?')
                        if (!confirmed) return
                        onApplyAllDates?.(UNPAID_PAYMENT_VALUE)
                        return
                      }
                      const fallbackDate = rows.map(row => String(paymentDates[row.key] || '').trim()).find(value => value && value !== UNPAID_PAYMENT_VALUE) || getTodayDateInputValue()
                      const confirmed = window.confirm(`${fallbackDate}으로 입금일시 전체 데이터를 변경하겠습니까?`)
                      if (!confirmed) return
                      onApplyAllDates?.(fallbackDate)
                    }}
                    aria-label="합계 행 입금상태 전체 선택"
                  >
                    <option value="date">날짜입력</option>
                    <option value="unpaid">미입금</option>
                  </select>
                  <input
                    type="date"
                    value={rows.every(row => { const value = String(paymentDates[row.key] || '').trim(); return !!value && value !== UNPAID_PAYMENT_VALUE; }) ? (rows.map(row => String(paymentDates[row.key] || '').trim()).find(value => value && value !== UNPAID_PAYMENT_VALUE) || '') : ''}
                    onChange={e => {
                      const nextDate = e.target.value || ''
                      if (!nextDate) return
                      const confirmed = window.confirm(`${nextDate}으로 입금일시 전체 데이터를 변경하겠습니까?`)
                      if (!confirmed) return
                      onApplyAllDates?.(nextDate)
                    }}
                    aria-label="합계 행 입금일시 전체 입력"
                    disabled={!rows.every(row => { const value = String(paymentDates[row.key] || '').trim(); return !!value && value !== UNPAID_PAYMENT_VALUE; })}
                  />
                </div>
              </div>
              <div>{rows.every(row => { const value = String(paymentDates[row.key] || '').trim(); return !!value && value !== UNPAID_PAYMENT_VALUE; }) ? 'O' : 'X'}</div>
              <div>
                <button
                  type="button"
                  className="disposal-bulk-payment-status-button disposal-bulk-payment-status-button-total"
                  onClick={() => {
                    const nextValue = rows.every(row => !!reportStatuses?.[row.key]) ? 'X' : 'O'
                    const confirmed = window.confirm(`(${nextValue})로 신고상태의 전체 데이터를 변경하겠습니까?`)
                    if (!confirmed) return
                    onApplyAllReports?.(nextValue === 'O')
                  }}
                  aria-label="합계 행 신고상태 전체 변경"
                >
                  {rows.every(row => !!reportStatuses?.[row.key]) ? 'O' : 'X'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="disposal-bulk-payment-footer-row">
          <div className="disposal-bulk-payment-question">폐기 신고금액 입금일자가 정확합니까?</div>
          <div className="disposal-confirm-actions disposal-bulk-payment-actions-inline">
            <button type="button" className="ghost" onClick={handleRequestClose}>아니오</button>
            <button type="button" onClick={onConfirm}>네</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DisposalListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [records, setRecords] = useState([])
  const [sortKey, setSortKey] = useState('latest')
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [customDateStart, setCustomDateStart] = useState('')
  const [customDateEnd, setCustomDateEnd] = useState('')
  const [sortDirection, setSortDirection] = useState('desc')
  const [pendingSettlementMessages, setPendingSettlementMessages] = useState([])
  const [pendingNavigationPath, setPendingNavigationPath] = useState('')
  const [bulkPaymentModal, setBulkPaymentModal] = useState({ open: false, recordId: '', group: null, rows: [] })
  const [bulkPaymentDates, setBulkPaymentDates] = useState({})
  const [bulkReportStatuses, setBulkReportStatuses] = useState({})
  const settlementBaselineRef = useRef({})

  const alertSearchQuery = String(searchParams.get('query') || '').trim()
  const alertRecordId = String(searchParams.get('recordId') || '').trim()
  const hasUnreportedAlertFocus = String(searchParams.get('alert') || '').trim() === 'disposal_unreported'

  useEffect(() => {
    let cancelled = false
    async function loadServerRecords() {
      let loadedRecords = loadRecords()
      try {
        loadedRecords = await bootstrapDisposalRecords()
      } catch {}
      if (cancelled) return
      setRecords(loadedRecords)
      settlementBaselineRef.current = Object.fromEntries(
        loadedRecords.map(record => [String(record?.id || ''), buildSettlementTrackingSnapshot(record)])
      )
    }
    loadServerRecords()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!alertSearchQuery) return
    setSearchInput(alertSearchQuery)
    setSearchQuery(alertSearchQuery)
  }, [alertSearchQuery])

  const groupedRows = useMemo(() => buildDisposalListGroups(records, sortKey, sortDirection, searchQuery, dateFilter, customDateStart, customDateEnd), [records, sortKey, sortDirection, searchQuery, dateFilter, customDateStart, customDateEnd])
  const visibleRowKeys = useMemo(() => groupedRows.flatMap(group => group.rows.map(row => row.key)), [groupedRows])
  const visibleRowKeySet = useMemo(() => new Set(visibleRowKeys), [visibleRowKeys])
  const selectedVisibleCount = useMemo(() => selectedRowKeys.filter(key => visibleRowKeySet.has(key)).length, [selectedRowKeys, visibleRowKeySet])
  const allVisibleChecked = visibleRowKeys.length > 0 && selectedVisibleCount === visibleRowKeys.length
  const dailySettlementSummary = useMemo(() => buildDailySettlementSummary(groupedRows), [groupedRows])

  useEffect(() => {
    setSelectedRowKeys(prev => prev.filter(key => visibleRowKeySet.has(key)))
  }, [visibleRowKeys.join('|')])

  useEffect(() => {
    if (dateFilter !== 'custom') {
      setCustomDateStart('')
      setCustomDateEnd('')
    }
  }, [dateFilter])

  function toggleRowSelection(rowKey, checked) {
    setSelectedRowKeys(prev => checked ? Array.from(new Set([...prev, rowKey])) : prev.filter(key => key !== rowKey))
  }

  async function updateRecordStatuses(recordId, updater) {
    const target = records.find(record => record.id === recordId)
    if (!target) return
    let nextTarget = null
    const nextRecords = records.map(record => {
      if (record.id !== recordId) return record
      const currentItems = getFilledRecordItems(record)
      const nextItems = currentItems.map((item, index) => ({ ...item, ...(updater(item, index, currentItems) || {}) }))
      const nextPaid = nextItems.every(item => !!item.paymentDone)
      const nextReported = nextItems.every(item => !!item.reportDone)
      const hasEligibleSettlementItems = nextItems.some(item => !!item.paymentDone && String(item?.paymentSettledAt || '').trim())
      nextTarget = normalizeRecordShape({
        ...record,
        items: nextItems,
        finalStatus: getFinalStatusFromFlags(nextPaid, nextReported),
        settlementTransferredAt: record.settlementTransferredAt && hasEligibleSettlementItems ? record.settlementTransferredAt : '',
      })
      return nextTarget
    })
    if (!nextTarget) return
    const savedTarget = await upsertDisposalRecordToServer(nextTarget)
    const refreshedRecords = records.map(record => record.id === recordId ? savedTarget : record)
    setRecords(refreshedRecords)
    const baselineSnapshot = settlementBaselineRef.current[String(recordId || '')] || ''
    const nextSnapshot = buildSettlementTrackingSnapshot(savedTarget)
    const nextMessage = buildPendingSettlementChangeMessage(savedTarget)
    const previousMessage = buildPendingSettlementChangeMessage(target)
    setPendingSettlementMessages(prev => {
      const filtered = prev.filter(message => message !== previousMessage && message !== nextMessage)
      if (!baselineSnapshot || baselineSnapshot === nextSnapshot) {
        return filtered
      }
      return Array.from(new Set([...filtered, nextMessage]))
    })
  }

  function updatePaymentStatus(recordId, rowKey, isChecked) {
    updateRecordStatuses(recordId, (_item, index) => {
      if (!String(rowKey || '').endsWith(`-${index}`)) return { paymentDone: _item.paymentDone, paymentSettledAt: _item.paymentSettledAt || '' }
      return {
        paymentDone: !!isChecked,
        paymentSettledAt: isChecked ? (_item.paymentSettledAt || getTodayDateInputValue()) : '',
      }
    })
  }

  function updateReportStatus(recordId, rowKey, isChecked) {
    updateRecordStatuses(recordId, (_item, index) => ({ reportDone: String(rowKey || '').endsWith(`-${index}`) ? !!isChecked : _item.reportDone }))
  }

  function updateAllPaymentStatuses(recordId, isChecked) {
    updateRecordStatuses(recordId, () => ({ paymentDone: !!isChecked }))
  }

  function openBulkPaymentModal(recordId) {
    const targetGroup = groupedRows.find(group => group.recordId === recordId)
    if (!targetGroup) return
    const defaults = {}
    const reportDefaults = {}
    targetGroup.rows.forEach(row => {
      defaults[row.key] = getBulkPaymentInputValue(row)
      reportDefaults[row.key] = !!row.reportDone
    })
    setBulkPaymentDates(defaults)
    setBulkReportStatuses(reportDefaults)
    setBulkPaymentModal({
      open: true,
      recordId,
      group: targetGroup,
      rows: targetGroup.rows,
    })
  }

  function closeBulkPaymentModal() {
    setBulkPaymentModal({ open: false, recordId: '', group: null, rows: [] })
    setBulkPaymentDates({})
    setBulkReportStatuses({})
  }

  function confirmBulkPaymentDates() {
    const { recordId, rows } = bulkPaymentModal || {}
    if (!recordId || !Array.isArray(rows) || !rows.length) {
      closeBulkPaymentModal()
      return
    }
    updateRecordStatuses(recordId, (_item, index) => {
      const rowKey = `${recordId}-${index}`
      const nextDate = String(bulkPaymentDates[rowKey] || '').trim()
      const isUnpaid = !nextDate || nextDate === UNPAID_PAYMENT_VALUE
      return {
        paymentDone: !isUnpaid,
        paymentSettledAt: isUnpaid ? '' : nextDate,
        reportDone: !!bulkReportStatuses[rowKey],
      }
    })
    closeBulkPaymentModal()
  }

  function updateAllReportStatuses(recordId, isChecked) {
    updateRecordStatuses(recordId, () => ({ reportDone: !!isChecked }))
  }

  function togglePaymentStatus(recordId, rowKey) {
    const targetGroup = groupedRows.find(group => group.recordId === recordId)
    const targetRow = targetGroup?.rows?.find(row => row.key === rowKey)
    if (!targetRow) return
    openBulkPaymentModal(recordId)
  }

  function toggleReportStatus(recordId, rowKey) {
    const targetGroup = groupedRows.find(group => group.recordId === recordId)
    const targetRow = targetGroup?.rows?.find(row => row.key === rowKey)
    if (!targetRow) return
    updateReportStatus(recordId, rowKey, !targetRow.reportDone)
  }

  function applyAllBulkPaymentDates(value) {
    setBulkPaymentDates(prev => Object.fromEntries(Object.keys(prev).map(key => [key, value])))
  }

  function applyAllBulkReportStatuses(isReported) {
    setBulkReportStatuses(prev => Object.fromEntries(Object.keys(prev).map(key => [key, !!isReported])))
  }

  function confirmBulkStatusChange(recordId, field, checked) {
    if (field === 'payment' && checked) {
      openBulkPaymentModal(recordId)
      return
    }
    const label = field === 'payment' ? '입금일시' : '신고여부'
    const nextValue = checked ? 'O' : 'X'
    const confirmed = window.confirm(`체크박스를 체크하면 모든 품목의 ${label}가 ${nextValue}로 전환됩니다.`)
    if (!confirmed) return
    if (field === 'payment') {
      updateAllPaymentStatuses(recordId, checked)
      return
    }
    updateAllReportStatuses(recordId, checked)
  }

  function applySearch() {
    setSearchQuery(searchInput.trim())
  }

  async function removeSelectedRecords() {
    if (!selectedRowKeys.length) {
      window.alert('삭제할 폐기목록을 선택해주세요.')
      return
    }
    const targetRecordIds = Array.from(new Set(groupedRows.flatMap(group => group.rows).filter(row => selectedRowKeys.includes(row.key)).map(row => row.recordId)))
    if (!targetRecordIds.length) {
      window.alert('삭제할 폐기목록을 찾지 못했습니다.')
      return
    }
    if (!window.confirm('선택한 폐기목록을 삭제할까요?')) return
    await deleteDisposalRecordsFromServer(targetRecordIds)
    const nextRecords = records.filter(record => !targetRecordIds.includes(record.id))
    setRecords(nextRecords)
    setSelectedRowKeys([])
  }

  async function moveToSettlement(recordId) {
    const target = records.find(record => record.id === recordId)
    if (!target) return
    const { hasEligibleItems } = getRecordSettlementEligibility(target)
    if (!hasEligibleItems) {
      window.alert('입금일시가 입력된 품목만 폐기결산에 반영할 수 있습니다.')
      return
    }
    const alreadyTransferred = !!target?.settlementTransferredAt
    const nextTransferredAt = alreadyTransferred ? target.settlementTransferredAt : new Date().toISOString()
    const updatedRecord = normalizeRecordShape({ ...target, settlementTransferredAt: nextTransferredAt })
    const savedRecord = await upsertDisposalRecordToServer(updatedRecord)
    const nextRecords = records.map(record => record.id === recordId ? savedRecord : record)
    setRecords(nextRecords)
    window.alert(alreadyTransferred ? '현재 결산 가능 품목 기준으로 폐기결산 화면을 갱신합니다.' : '결산처리가 완료되어 폐기결산에 저장되었습니다.')
    navigate('/disposal/settlements')
  }

  function handleCategoryNavigate(path) {
    if (!pendingSettlementMessages.length) {
      navigate(path)
      return
    }
    setPendingNavigationPath(path)
  }

  function confirmPendingNavigation() {
    const path = pendingNavigationPath
    setPendingSettlementMessages([])
    setPendingNavigationPath('')
    navigate(path)
  }

  function cancelPendingNavigation() {
    setPendingNavigationPath('')
  }

  return (
    <div className="stack-page disposal-page">
      <DisposalCategoryTabs current="list" onNavigate={handleCategoryNavigate} />
      <section className="card disposal-records-card disposal-list-board-card">
        <div className="disposal-list-top-controls disposal-list-top-controls-single-row">
          <div className="disposal-filter-inline-group disposal-filter-inline-group-compact disposal-filter-inline-group-stackable disposal-settlement-toolbar-row">
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} aria-label="폐기목록 날짜 필터">
              {DATE_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} aria-label="폐기목록 1차 필터">
              {FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={sortDirection} onChange={e => setSortDirection(e.target.value)} aria-label="폐기목록 2차 필터">
              {SORT_DIRECTION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {dateFilter === 'custom' ? (
              <>
                <input type="date" value={customDateStart} onChange={e => setCustomDateStart(e.target.value)} aria-label="폐기목록 시작일 필터" />
                <input type="date" value={customDateEnd} onChange={e => setCustomDateEnd(e.target.value)} aria-label="폐기목록 종료일 필터" />
              </>
            ) : null}
          </div>
          <div className="disposal-filter-inline-group disposal-filter-search-group disposal-filter-search-group-compact disposal-settlement-search-group">
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applySearch() }} placeholder="키워드 검색" />
            <button type="button" className="ghost disposal-action-button disposal-search-text-button" onClick={applySearch}>검색</button>
            <button type="button" className="ghost disposal-action-button disposal-delete-button" onClick={removeSelectedRecords}>삭제</button>
          </div>
        </div>
        {groupedRows.length === 0 ? (
          <div className="empty-state">저장된 폐기목록이 없습니다.</div>
        ) : groupedRows.map(group => {
          const allGroupChecked = group.rows.length > 0 && group.rows.every(row => selectedRowKeys.includes(row.key))
          const isPaid = group.paymentStatus === '완료'
          const isReported = group.reportStatus === '완료'
          const isTransferred = !!group.settlementTransferredAt
          return (
            <div key={group.key} className="disposal-list-date-group disposal-customer-group-card">
              <div className="disposal-list-date-label disposal-customer-group-label disposal-customer-group-label-mobile-card">
                <div className="disposal-group-meta-card" aria-label={`${group.customerName} 폐기양식 정보`}>
                  <div className="disposal-meta-row disposal-meta-row-top disposal-meta-row-top-inline-actions">
                    <div
                      className="disposal-meta-top-click-group"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/disposal/forms/${group.recordId}`)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/disposal/forms/${group.recordId}`)
                        }
                      }}
                      aria-label={`${group.customerName} 폐기양식으로 이동`}
                    >
                      <span className="disposal-meta-link-button disposal-meta-date">{group.disposalDate}</span>
                      <span className="disposal-meta-link-button disposal-meta-platform">{group.platform || '-'}</span>
                      <span className="disposal-meta-link-button disposal-meta-customer-link"><strong className="disposal-meta-customer">{group.customerName}</strong></span>
                    </div>
                    <div className="disposal-meta-action-inline-wrap">
                      <span className={`disposal-payment-badge disposal-header-action-button ${isPaid && isReported ? 'is-paid' : (isPaid ? 'is-mixed' : 'is-unpaid')}`.trim()} aria-label={`${group.customerName} 입금완/신고완 상태`}>{isPaid ? '입금완' : '입금전'}/{isReported ? '신고완' : '신고전'}</span>
                      {isTransferred ? <span className="disposal-transfer-badge disposal-header-action-button">결산반영완료</span> : <span className="disposal-transfer-badge disposal-header-action-button is-pending">결산대기</span>}
                    </div>
                  </div>
                  <div className="disposal-meta-row disposal-meta-row-middle disposal-meta-row-middle-with-action">
                    <button type="button" className="disposal-meta-link-button disposal-meta-location-link" onClick={() => navigate(`/disposal/forms/${group.recordId}`)} aria-label={`${group.customerName} 폐기양식으로 이동`}>
                      <span className="disposal-meta-location">{group.location}</span>
                    </button>
                    <div className="disposal-meta-row-end-actions">
                      {!isTransferred && (
                        <button
                          type="button"
                          className="ghost disposal-header-action-button disposal-settlement-action-button"
                          onClick={() => moveToSettlement(group.recordId)}
                          aria-label={`${group.customerName} 결산처리`}
                        >
                          결산처리
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="disposal-list-grid disposal-list-grid-customer">
                <div className="disposal-list-grid-row disposal-list-grid-head">
                  <div className="disposal-list-grid-check-cell">
                    <input type="checkbox" checked={allGroupChecked} onChange={e => {
                      const nextKeys = group.rows.map(row => row.key)
                      setSelectedRowKeys(prev => e.target.checked ? Array.from(new Set([...prev, ...nextKeys])) : prev.filter(key => !nextKeys.includes(key)))
                    }} aria-label="그룹 선택" />
                  </div>
                  <div>품목</div>
                  <div>수량</div>
                  <div>개당비용</div>
                  <div>신고합계</div>
                  <div>수수료</div>
                  <div>매출액</div>
                  <div className="disposal-list-grid-head-status"><span>입금</span><span>일시</span></div>
                  <div className="disposal-list-grid-head-status"><span>신고</span><span>여부</span></div>
                </div>
                {group.rows.map((row) => {
                  const isAlertFocusedRow = hasUnreportedAlertFocus && !!alertRecordId && group.recordId === alertRecordId && !row.reportDone
                  return (
                  <div key={row.key} className={`disposal-list-grid-row disposal-list-grid-data-row${isAlertFocusedRow ? ' disposal-list-grid-data-row-unreported-highlight' : ''}`.trim()}>
                    <div className="disposal-list-grid-check-cell">
                      <input type="checkbox" checked={selectedRowKeys.includes(row.key)} onChange={e => toggleRowSelection(row.key, e.target.checked)} aria-label={`${group.customerName} ${row.itemName} 선택`} />
                    </div>
                    <button type="button" className="disposal-list-grid-button disposal-list-grid-button-customer" onClick={() => navigate(`/disposal/forms/${group.recordId}`)}>
                      <span>{row.itemName}</span>
                      <span>{formatNumber(row.quantity)}</span>
                      <span>{formatCurrency(row.unitCost)}</span>
                      <span>{formatCurrency(row.reportAmount)}</span>
                      <span>{formatCurrency(row.feeAmount)}</span>
                      <span>{formatCurrency(row.finalAmount)}</span>
                    </button>
                    <div
                      role="button"
                      tabIndex={0}
                      className="disposal-list-grid-payment-cell disposal-list-grid-cell-action"
                      onClick={() => openBulkPaymentModal(group.recordId)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBulkPaymentModal(group.recordId) } }}
                      aria-label={`${group.customerName} ${row.itemName} 입금결산 열기`}
                    >
                      {formatPaymentCellDisplay(row)}
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      className="disposal-list-grid-payment-cell disposal-list-grid-cell-action"
                      onClick={() => toggleReportStatus(group.recordId, row.key)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleReportStatus(group.recordId, row.key) } }}
                      aria-label={`${group.customerName} ${row.itemName} 신고여부 전환`}
                    >
                      {statusMark(row.reportDone)}
                    </div>
                  </div>
                  )
                })}
                <div className="disposal-list-grid-row disposal-list-grid-summary-row">
                  <div />
                  <div className="strong">합계</div>
                  <div>{formatNumber(group.totals.quantity)}</div>
                  <div>{formatCurrency(group.totals.unitCost)}</div>
                  <div>{formatCurrency(group.totals.reportAmount)}</div>
                  <div>{formatCurrency(group.totals.feeAmount)}</div>
                  <div>{formatCurrency(group.totals.finalAmount)}</div>
                  <div className="disposal-list-grid-payment-cell">
                    <label className="disposal-payment-toggle" aria-label="입금일시 전체 전환">
                      <input type="checkbox" checked={isPaid} onChange={e => confirmBulkStatusChange(group.recordId, 'payment', e.target.checked)} />
                    </label>
                  </div>
                  <div className="disposal-list-grid-payment-cell">
                    <label className="disposal-payment-toggle" aria-label="신고 여부 전체 전환">
                      <input type="checkbox" checked={isReported} onChange={e => confirmBulkStatusChange(group.recordId, 'report', e.target.checked)} />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </section>


      <DisposalBulkPaymentModal
        open={!!bulkPaymentModal?.open}
        group={bulkPaymentModal?.group}
        rows={bulkPaymentModal?.rows}
        paymentDates={bulkPaymentDates}
        reportStatuses={bulkReportStatuses}
        onChangeDate={(rowKey, value) => setBulkPaymentDates(prev => ({ ...prev, [rowKey]: value }))}
        onChangeReportStatus={(rowKey, value) => setBulkReportStatuses(prev => ({ ...prev, [rowKey]: !!value }))}
        onApplyAllDates={applyAllBulkPaymentDates}
        onApplyAllReports={applyAllBulkReportStatuses}
        onConfirm={confirmBulkPaymentDates}
        onClose={closeBulkPaymentModal}
      />

      <DisposalConfirmModal
        open={!!pendingNavigationPath && pendingSettlementMessages.length > 0}
        message={pendingSettlementMessages.join('\n')}
        onConfirm={confirmPendingNavigation}
        onCancel={cancelPendingNavigation}
      />
    </div>
  )
}


function formatGroupDate(value) {
  if (!value) return '날짜 미지정'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('ko-KR')
}

function formatMonthDayLabel(value) {
  if (!value) return '날짜 미지정'
  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) ? `${String(value).trim()}T00:00:00` : value
  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}

function getSavedDateKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || 'unknown')
  return date.toISOString().slice(0, 10)
}

function getMonthKey(value) {
  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) ? `${String(value).trim()}T00:00:00` : value
  const date = new Date(normalizedValue)
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

function getSettlementMonthSource(record) {
  const eligibleItems = getSettlementEligibleItems(record)
  const eligibleTimes = eligibleItems
    .map(item => getDateValueParts(item?.paymentSettledAt)?.date?.getTime?.())
    .filter(value => Number.isFinite(value))

  if (eligibleTimes.length) {
    return new Date(Math.min(...eligibleTimes)).toISOString()
  }

  return record?.settlementTransferredAt || record?.savedAt || record?.disposalDate || new Date().toISOString()
}

function buildMonthFilteredSettlementRecord(record, monthKey) {
  const matchedItems = getSettlementEligibleItems(record).filter(item => getMonthKey(item?.paymentSettledAt) === monthKey)
  if (!matchedItems.length) return null
  return {
    ...record,
    items: matchedItems.map(item => ({ ...item })),
  }
}

function filterRecordsByMonth(records, monthKey) {
  return (records || [])
    .map(record => buildMonthFilteredSettlementRecord(record, monthKey))
    .filter(Boolean)
}

function buildDailySettlementSummary(groups = []) {
  const mapped = new Map()
  ;(groups || []).forEach(group => {
    const key = String(group?.disposalDate || '날짜 미지정')
    if (!mapped.has(key)) {
      mapped.set(key, {
        key,
        label: key,
        customerCount: 0,
        totalQty: 0,
        totalReportAmount: 0,
        totalFinalAmount: 0,
        totalPaidFinalAmount: 0,
      })
    }
    const target = mapped.get(key)
    target.customerCount += 1
    target.totalQty += safeNumber(group?.totals?.quantity)
    target.totalReportAmount += safeNumber(group?.totals?.reportAmount)
    target.totalFinalAmount += safeNumber(group?.totals?.finalAmount)
    if (group?.paymentStatus === '완료') target.totalPaidFinalAmount += safeNumber(group?.totals?.finalAmount)
  })
  return Array.from(mapped.values()).sort((a, b) => String(a.key).localeCompare(String(b.key), 'ko'))
}

function buildSettlementGroups(records) {
  const grouped = new Map()
  sortRecords(records, 'latest').forEach((record) => {
    const settledAt = record?.settlementTransferredAt || record?.savedAt || new Date().toISOString()
    const key = String(getSavedDateKey(settledAt) || '날짜 미지정')
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: String(formatGroupDate(settledAt)),
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
    ['집계대상', '입금일자 기준', '목록정렬', '최신 저장순', '표시방식', '날짜별 그룹'],
    ['안내', '아래 목록에서 항목 클릭 시 상세 입력 화면으로 이동', '', '', '', ''],
  ]
}

function formatMonthShortLabel(monthKey) {
  const [yearText, monthText] = String(monthKey || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '월 미지정'
  return `${String(year).slice(-2)}년 ${month}월`
}

function buildSettlementMonthlySalesTable(monthLabel, monthlyRecords) {
  const totals = monthlyRecords.reduce((acc, record) => {
    const metrics = getRecordSettlementMetrics(record)
    acc.count += 1
    acc.customers.add(String(record?.customerName || '').trim())
    acc.totalQty += metrics.totalQty
    acc.totalReport += metrics.reportAmount
    acc.totalFee += metrics.feeAmount
    acc.totalCancel += metrics.cancelAmount
    acc.totalSales += metrics.minimumFee
    return acc
  }, {
    count: 0,
    customers: new Set(),
    totalQty: 0,
    totalReport: 0,
    totalFee: 0,
    totalCancel: 0,
    totalSales: 0,
  })
  const averages = groupMonthlyRecordCount(monthlyRecords)
  return [
    ['월 매출표', monthLabel],
    ['총 등록건수', `${formatNumber(totals.count)}건`],
    ['고객 수', `${formatNumber(totals.customers.size)}명`],
    ['총 품목수', `${formatNumber(totals.totalQty)}개`],
    ['폐기신고액', `${formatNumber(totals.totalReport)}원`],
    ['폐기수수료', `${formatNumber(totals.totalFee)}원`],
    ['취소신고액', `${formatNumber(totals.totalCancel)}원`],
    ['매출액', `${formatNumber(totals.totalSales)}원`],
    ['일평균 매출액', `${formatNumber(averages.minimumAverage)}원`],
  ]
}

function getSettlementPaymentDateDisplay(record) {
  const dates = Array.from(new Set(
    getSettlementEligibleItems(record)
      .map(item => formatShortDate(item?.paymentSettledAt))
      .filter(Boolean)
  ))
  if (!dates.length) return '-'
  if (dates.length === 1) return dates[0]
  return dates.join(', ')
}

function compareSettlementFieldValue(record, field) {
  if (field === 'platform') {
    return String(record?.platform || '').trim() || '-'
  }
  if (field === 'paymentDate') {
    return getSettlementPaymentDateDisplay(record)
  }
  if (field === 'customerName') {
    return String(record?.customerName || '').trim() || '-'
  }
  return String(record?.disposalDate || getSavedDateKey(record?.savedAt) || '')
}

function getSettlementSortPrimitive(record, field) {
  if (field === 'paymentDate') {
    const timestamps = getSettlementEligibleItems(record)
      .map(item => getDateValueParts(item?.paymentSettledAt)?.date?.getTime?.())
      .filter(value => Number.isFinite(value))
    return timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY
  }
  if (field === 'disposalDate') {
    const dateValue = getDateValueParts(record?.disposalDate || getSavedDateKey(record?.savedAt))?.date?.getTime?.()
    return Number.isFinite(dateValue) ? dateValue : Number.POSITIVE_INFINITY
  }
  if (field === 'customerName') {
    return String(record?.customerName || '').trim().toLowerCase()
  }
  if (field === 'platform') {
    return String(record?.platform || '').trim().toLowerCase()
  }
  return String(compareSettlementFieldValue(record, field) || '').trim().toLowerCase()
}

function normalizeSettlementSearchValue(record, field) {
  const raw = compareSettlementFieldValue(record, field)
  return String(raw || '').replace(/\s+/g, '').toLowerCase()
}

function buildSettlementSearchValue(record) {
  const baseValues = [
    record?.platform,
    record?.customerName,
    record?.location,
    record?.disposalDate,
    getSettlementPaymentDateDisplay(record),
  ]
  const itemValues = getSettlementEligibleItems(record).flatMap(item => [
    item?.itemName,
    item?.note,
    item?.reportNo,
    item?.paymentSettledAt,
  ])
  return [...baseValues, ...itemValues]
    .map(value => String(value || '').replace(/\s+/g, '').toLowerCase())
    .filter(Boolean)
    .join(' ')
}

function matchesSettlementSearch(record, query, field) {
  const normalizedQuery = String(query || '').replace(/\s+/g, '').toLowerCase()
  if (!normalizedQuery) return true
  const fieldValue = normalizeSettlementSearchValue(record, field)
  if (fieldValue.includes(normalizedQuery)) return true
  return buildSettlementSearchValue(record).includes(normalizedQuery)
}

function sortSettlementRecords(records, field = 'disposalDate', direction = 'desc') {
  const sorted = [...records].sort((a, b) => {
    const aValue = getSettlementSortPrimitive(a, field)
    const bValue = getSettlementSortPrimitive(b, field)
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return aValue - bValue
    }
    return String(aValue).localeCompare(String(bValue), 'ko')
  })
  return direction === 'desc' ? sorted.reverse() : sorted
}

function buildSettlementMonthlyRows(monthlyRecords, field = 'disposalDate', direction = 'asc') {
  const byDate = new Map()
  monthlyRecords.forEach(record => {
    const dateKey = String(record?.disposalDate || getSavedDateKey(record?.savedAt) || '날짜 미지정')
    if (!byDate.has(dateKey)) byDate.set(dateKey, [])
    byDate.get(dateKey).push(record)
  })
  const rows = []
  const groupedEntries = Array.from(byDate.entries())
    .map(([dateKey, records]) => ({
      dateKey,
      records: sortSettlementRecords(records, field, direction),
    }))
    .sort((a, b) => {
      if (field === 'disposalDate') {
        const aTime = getDateValueParts(a.dateKey)?.date?.getTime?.()
        const bTime = getDateValueParts(b.dateKey)?.date?.getTime?.()
        const aValue = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY
        const bValue = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY
        return direction === 'desc' ? bValue - aValue : aValue - bValue
      }
      const aRecord = a.records[0] || {}
      const bRecord = b.records[0] || {}
      const aValue = getSettlementSortPrimitive(aRecord, field)
      const bValue = getSettlementSortPrimitive(bRecord, field)
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction === 'desc' ? bValue - aValue : aValue - bValue
      }
      const result = String(aValue || '').localeCompare(String(bValue || ''), 'ko')
      return direction === 'desc' ? -result : result
    })
  groupedEntries.forEach(({ dateKey, records }) => {
    const summary = records.reduce((acc, record) => {
      const metrics = getRecordSettlementMetrics(record)
      acc.customerCount += 1
      acc.totalQty += metrics.totalQty
      acc.totalReport += metrics.reportAmount
      acc.totalFee += metrics.feeAmount
      acc.totalCancel += metrics.cancelAmount
      acc.totalSales += metrics.minimumFee
      return acc
    }, { customerCount:0, totalQty:0, totalReport:0, totalFee:0, totalCancel:0, totalSales:0 })
    rows.push({
      key: `summary-${dateKey}`,
      kind: 'summary',
      dateKey,
      toggleKey: dateKey,
      cells: [
        dateKey,
        Array.from(new Set(records.map(getSettlementPaymentDateDisplay).filter(value => value && value !== '-'))).join(' / ') || '-',
        `${formatNumber(summary.customerCount)}건`,
        '합계',
        `[${formatMonthDayLabel(dateKey)} 합계]`,
        `${formatNumber(summary.totalQty)}개`,
        `${formatNumber(summary.totalReport)}원`,
        `${formatNumber(summary.totalFee)}원`,
        `${formatNumber(summary.totalCancel)}원`,
        `${formatNumber(summary.totalSales)}원`,
        '펼치기',
      ],
    })
    records.forEach((record, index) => {
      const metrics = getRecordSettlementMetrics(record)
      const detailToggleKey = `detail-items-${record.id}`
      rows.push({
        key: `detail-${record.id}-${index}`,
        kind: 'detail',
        parentKey: dateKey,
        toggleKey: detailToggleKey,
        recordId: record.id,
        cells: [
          dateKey,
          getSettlementPaymentDateDisplay(record),
          String(index + 1),
          record?.platform || '-',
          record?.customerName || '-',
          `${formatNumber(metrics.totalQty)}개`,
          `${formatNumber(metrics.reportAmount)}원`,
          `${formatNumber(metrics.feeAmount)}원`,
          `${formatNumber(metrics.cancelAmount)}원`,
          `${formatNumber(metrics.minimumFee)}원`,
          '품목보기',
        ],
      })
      getSettlementEligibleItems(record).forEach((item, itemIndex) => {
        const quantity = safeNumber(item?.quantity)
        const unitCost = safeNumber(item?.unitCost)
        const reportAmount = quantity * unitCost
        const feeAmount = Math.round(reportAmount * 0.3)
        const finalAmount = reportAmount + feeAmount
        const noteText = String(item?.note || '').trim()
        const reportNoText = String(item?.reportNo || '').trim()
        const itemNote = [reportNoText ? `번호 ${reportNoText}` : '', noteText].filter(Boolean).join(' · ') || '-'
        rows.push({
          key: `detail-item-${record.id}-${itemIndex}`,
          kind: 'item',
          parentKey: dateKey,
          detailParentKey: detailToggleKey,
          recordId: record.id,
          cells: [
            '',
            formatShortDate(item?.paymentSettledAt) || '-',
            `${index + 1}-${itemIndex + 1}`,
            '품목',
            `└ ${String(item?.itemName || '').trim() || '-'} `,
            `${formatNumber(quantity)}개`,
            `${formatNumber(reportAmount)}원`,
            `${formatNumber(feeAmount)}원`,
            '0원',
            `${formatNumber(finalAmount)}원`,
            itemNote,
          ],
        })
      })
    })
  })
  return rows
}

function getSettlementPaymentDateKey(record) {
  const eligibleItems = getSettlementEligibleItems(record)
  const timestamps = eligibleItems
    .map(item => getDateValueParts(item?.paymentSettledAt)?.date?.getTime?.())
    .filter(value => Number.isFinite(value))
  if (!timestamps.length) return '날짜 미지정'
  return getSavedDateKey(new Date(Math.min(...timestamps)).toISOString())
}

function groupMonthlyRecordCount(monthlyRecords) {
  const days = new Map()
  monthlyRecords.forEach(record => {
    const key = String(getSettlementPaymentDateKey(record) || '날짜 미지정')
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
  const eligibleItems = getSettlementEligibleItems(record)
  const totals = eligibleItems.reduce((acc, item) => {
    const quantity = safeNumber(item?.quantity)
    const unitCost = safeNumber(item?.unitCost)
    const reportAmount = quantity * unitCost
    const feeAmount = Math.round(reportAmount * 0.3)
    const finalAmount = reportAmount + feeAmount
    acc.totalQty += quantity
    acc.reportAmount += reportAmount
    acc.feeAmount += feeAmount
    acc.minimumFee += finalAmount
    return acc
  }, { totalQty: 0, reportAmount: 0, feeAmount: 0, minimumFee: 0 })
  return {
    totalQty: totals.totalQty,
    reportAmount: totals.reportAmount,
    feeAmount: totals.feeAmount,
    cancelAmount: 0,
    minimumFee: totals.minimumFee,
  }
}

export function DisposalSettlementsPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [monthKey, setMonthKey] = useState(getMonthKey(new Date().toISOString()))
  const [expandedKeys, setExpandedKeys] = useState({})
  const [settlementFilterFieldInput, setSettlementFilterFieldInput] = useState('paymentDate')
  const [settlementDateStartInput, setSettlementDateStartInput] = useState('')
  const [settlementDateEndInput, setSettlementDateEndInput] = useState('')
  const [settlementSortDirectionInput, setSettlementSortDirectionInput] = useState('asc')
  const [settlementSearchInput, setSettlementSearchInput] = useState('')

  const [settlementFilterField, setSettlementFilterField] = useState('paymentDate')
  const [settlementDateStart, setSettlementDateStart] = useState('')
  const [settlementDateEnd, setSettlementDateEnd] = useState('')
  const [settlementSortDirection, setSettlementSortDirection] = useState('asc')
  const [settlementSearchQuery, setSettlementSearchQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadServerRecords() {
      let loaded = loadRecords().filter(record => !!record?.settlementTransferredAt && getSettlementEligibleItems(record).length > 0)
      try {
        loaded = (await bootstrapDisposalRecords()).filter(record => !!record?.settlementTransferredAt && getSettlementEligibleItems(record).length > 0)
      } catch {}
      if (cancelled) return
      setRecords(loaded)
      if (loaded.length) {
        setMonthKey(getMonthKey(getSettlementMonthSource(loaded[0]) || new Date().toISOString()))
      }
    }
    loadServerRecords()
    return () => { cancelled = true }
  }, [])

  const monthlyRecords = useMemo(() => filterRecordsByMonth(records, monthKey), [records, monthKey])
  const filteredSettlementRecords = useMemo(() => {
    const normalizedQuery = String(settlementSearchQuery || '').replace(/\s+/g, '').toLowerCase()
    const dateFiltered = monthlyRecords.filter(record => {
      const paymentDateValue = getSettlementSortPrimitive(record, 'paymentDate')
      if (Number.isFinite(paymentDateValue)) {
        return isWithinCustomDateRange(new Date(paymentDateValue).toISOString(), settlementDateStart, settlementDateEnd)
      }
      return false
    })
    const filtered = normalizedQuery
      ? dateFiltered.filter(record => matchesSettlementSearch(record, normalizedQuery, settlementFilterField))
      : dateFiltered
    return sortSettlementRecords(filtered, settlementFilterField, settlementSortDirection)
  }, [monthlyRecords, settlementFilterField, settlementDateStart, settlementDateEnd, settlementSortDirection, settlementSearchQuery])
  const monthLabel = useMemo(() => formatMonthShortLabel(monthKey), [monthKey])
  const salesTableRows = useMemo(() => buildSettlementMonthlySalesTable(monthLabel, monthlyRecords), [monthLabel, monthlyRecords])
  const settlementRows = useMemo(() => buildSettlementMonthlyRows(filteredSettlementRecords, settlementFilterField, settlementSortDirection), [filteredSettlementRecords, settlementFilterField, settlementSortDirection])
  const settlementTotals = useMemo(() => filteredSettlementRecords.reduce((acc, record) => {
    const metrics = getRecordSettlementMetrics(record)
    acc.count += 1
    acc.totalQty += metrics.totalQty
    acc.totalReport += metrics.reportAmount
    acc.totalFee += metrics.feeAmount
    acc.totalCancel += metrics.cancelAmount
    acc.totalSales += metrics.minimumFee
    return acc
  }, { count: 0, totalQty: 0, totalReport: 0, totalFee: 0, totalCancel: 0, totalSales: 0 }), [filteredSettlementRecords])
  const effectiveExpandedKeys = useMemo(() => {
    const next = { ...expandedKeys }
    const normalizedQuery = String(settlementSearchQuery || '').trim()
    if (normalizedQuery) {
      settlementRows.forEach((row) => {
        if (row.kind === 'summary' && row.toggleKey) next[row.toggleKey] = true
        if (row.kind === 'detail' && row.parentKey && row.toggleKey) {
          next[row.parentKey] = true
          next[row.toggleKey] = true
        }
      })
    }
    return next
  }, [expandedKeys, settlementRows, settlementSearchQuery])
  const visibleRows = useMemo(() => settlementRows.filter((row) => {
    if (row.kind === 'summary') return true
    if (row.kind === 'detail') return !!effectiveExpandedKeys[row.parentKey]
    if (row.kind === 'item') return !!effectiveExpandedKeys[row.parentKey] && !!effectiveExpandedKeys[row.detailParentKey]
    return false
  }), [settlementRows, effectiveExpandedKeys])

  function toggleRow(key) {
    setExpandedKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function applySettlementSearch() {
    const trimmedQuery = settlementSearchInput.trim()
    setSettlementSearchQuery(trimmedQuery)
    if (!trimmedQuery) {
      setExpandedKeys({})
    }
  }

  useEffect(() => {
    setSettlementDateStart(settlementDateStartInput)
  }, [settlementDateStartInput])

  useEffect(() => {
    setSettlementDateEnd(settlementDateEndInput)
  }, [settlementDateEndInput])

  useEffect(() => {
    setSettlementFilterField(settlementFilterFieldInput)
  }, [settlementFilterFieldInput])

  useEffect(() => {
    setSettlementSortDirection(settlementSortDirectionInput)
  }, [settlementSortDirectionInput])


  useEffect(() => {
    setSettlementDateStartInput('')
    setSettlementDateEndInput('')
    setSettlementDateStart('')
    setSettlementDateEnd('')
    setSettlementFilterFieldInput('paymentDate')
    setSettlementFilterField('paymentDate')
    setSettlementSortDirectionInput('asc')
    setSettlementSortDirection('asc')
  }, [monthKey])

  return (
    <div className="stack-page disposal-page">
      <DisposalCategoryTabs current="settlements" onNavigate={(path) => navigate(path)} />
      <section className="card disposal-month-switch-card disposal-month-switch-card-compact disposal-month-switch-card-inline">
        <div className="disposal-month-switch-inline-group">
          <button
            type="button"
            className="ghost disposal-month-nav-button"
            aria-label="이전 달"
            title="이전 달"
            onClick={() => setMonthKey(prev => shiftMonthKey(prev, -1))}
          >
            ◀
          </button>
          <div className="disposal-month-switch-title">{monthLabel}</div>
          <button
            type="button"
            className="ghost disposal-month-nav-button"
            aria-label="다음 달"
            title="다음 달"
            onClick={() => setMonthKey(prev => shiftMonthKey(prev, 1))}
          >
            ▶
          </button>
        </div>
      </section>

      <section className="card disposal-monthly-sheet-card">
        <div className="disposal-sales-sheet disposal-sales-sheet-two-col">
          {salesTableRows.map((row, rowIndex) => (
            <div key={`sales-row-${rowIndex}`} className={`disposal-sales-sheet-row disposal-sales-sheet-row-two-col ${rowIndex === 0 ? 'is-title' : ''}`}>
              {row.map((cell, cellIndex) => (
                <div key={`sales-cell-${rowIndex}-${cellIndex}`} className="disposal-sales-sheet-cell">{cell || ''}</div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card disposal-monthly-sheet-card">
        <div className="disposal-sheet-title">월 결산표</div>
        <div className="disposal-settlement-inline-controls disposal-settlement-inline-controls-single-row">
          <label
            className={`disposal-settlement-custom-date-field disposal-settlement-date-placeholder ${!settlementDateStartInput ? 'is-empty' : ''}`}
            data-placeholder="최소기간입력"
          >
            <input
              type="date"
              value={settlementDateStartInput}
              onChange={e => setSettlementDateStartInput(e.target.value)}
              aria-label="월 결산표 최소기간 필터"
            />
          </label>
          <label
            className={`disposal-settlement-custom-date-field disposal-settlement-date-placeholder ${!settlementDateEndInput ? 'is-empty' : ''}`}
            data-placeholder="최대기간입력"
          >
            <input
              type="date"
              value={settlementDateEndInput}
              onChange={e => setSettlementDateEndInput(e.target.value)}
              aria-label="월 결산표 최대기간 필터"
            />
          </label>
          <select value={settlementFilterFieldInput} onChange={e => setSettlementFilterFieldInput(e.target.value)} aria-label="월 결산표 구분 필터">
            {SETTLEMENT_PRIMARY_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={settlementSortDirectionInput} onChange={e => setSettlementSortDirectionInput(e.target.value)} aria-label="월 결산표 정렬기준 필터">
            {SETTLEMENT_SORT_DIRECTION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input
            className="disposal-settlement-search-input"
            value={settlementSearchInput}
            onChange={e => setSettlementSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applySettlementSearch() }}
            placeholder="키워드 검색"
            aria-label="월 결산표 검색"
          />
          <button type="button" className="ghost disposal-action-button disposal-search-text-button" onClick={applySettlementSearch} aria-label="월 결산표 검색 실행">검색</button>
        </div>
        {settlementRows.length === 0 ? (
          <div className="empty-state">저장된 폐기결산 내역이 없습니다.</div>
        ) : (
          <div className="disposal-month-settlement-table simple-sheet">
            <div className="disposal-month-settlement-row disposal-month-settlement-head">
              <div>폐기일자</div>
              <div>입금일자</div>
              <div>건수</div>
              <div>구분</div>
              <div>고객명</div>
              <div>품목수</div>
              <div>폐기신고액</div>
              <div>폐기수수료</div>
              <div>취소신고액</div>
              <div>매출액</div>
              <div>비고</div>
            </div>
            {visibleRows.map(row => row.kind === 'summary' ? (
              <div key={row.key} className="disposal-month-settlement-row disposal-month-settlement-summary" onClick={() => toggleRow(row.toggleKey)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(row.toggleKey) } }}>
                {row.cells.map((cell, index) => (
                  <div key={`${row.key}-${index}`} className={index === 10 ? 'toggle-cell' : ''}>
                    {index === 10 ? (
                      <button type="button" className="disposal-month-settlement-toggle-button" onClick={(e) => { e.stopPropagation(); toggleRow(row.toggleKey) }}>{effectiveExpandedKeys[row.toggleKey] ? '접기' : '펼치기'}</button>
                    ) : cell}
                  </div>
                ))}
              </div>
            ) : row.kind === 'detail' ? (
              <div key={row.key} className="disposal-month-settlement-row disposal-month-settlement-detail" onClick={() => toggleRow(row.toggleKey)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(row.toggleKey) } }}>
                {row.cells.map((cell, index) => (
                  <div
                    key={`${row.key}-${index}`}
                    className={[
                      index === 10 ? 'toggle-cell' : '',
                      index === 9 ? 'disposal-month-settlement-sales-cell' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {index === 4 ? (
                      <button type="button" className="disposal-month-settlement-link-button" onClick={(e) => { e.stopPropagation(); toggleRow(row.toggleKey) }}>{cell}</button>
                    ) : index === 10 ? (
                      <button type="button" className="disposal-month-settlement-toggle-button" onClick={(e) => { e.stopPropagation(); toggleRow(row.toggleKey) }}>{effectiveExpandedKeys[row.toggleKey] ? '품목접기' : '품목펼치기'}</button>
                    ) : cell}
                  </div>
                ))}
              </div>
            ) : (
              <div key={row.key} className="disposal-month-settlement-row disposal-month-settlement-item">
                {row.cells.map((cell, index) => (
                  <div key={`${row.key}-${index}`}>{cell}</div>
                ))}
              </div>
            ))}
            <div className="disposal-month-settlement-row disposal-month-settlement-total">
              <div>합계</div>
              <div>-</div>
              <div>{`${formatNumber(settlementTotals.count)}건`}</div>
              <div>합계</div>
              <div>[전체 합계]</div>
              <div>{`${formatNumber(settlementTotals.totalQty)}개`}</div>
              <div>{`${formatNumber(settlementTotals.totalReport)}원`}</div>
              <div>{`${formatNumber(settlementTotals.totalFee)}원`}</div>
              <div>{`${formatNumber(settlementTotals.totalCancel)}원`}</div>
              <div>{`${formatNumber(settlementTotals.totalSales)}원`}</div>
              <div>-</div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
