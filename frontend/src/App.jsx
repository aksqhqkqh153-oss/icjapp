import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AUTH_EXPIRED_EVENT, api, clearSession, getApiBase, getRememberedLogin, getStoredUser, setSession, uploadFile } from './api'
import { SETTLEMENT_DATA } from './settlementData'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { createPortal } from 'react-dom'
import WarehousePage from './WarehousePage'
import StorageStatusPage from './StorageStatusPage'
import { DisposalFormsPage, DisposalHubPage, DisposalJurisdictionRegistryPage, DisposalListPage, DisposalPreviewPage, DisposalSettlementsPage } from './DisposalPages'
import { WORK_SHIFT_TEMPLATE } from './workScheduleTemplate'

const PAGE_TITLES = {
  '/': '홈',
  '/map': '지도',
  '/friends': '친구',
  '/chats': '채팅',
  '/schedule': '일정',
  '/schedule/new': '일정등록',
  '/schedule/handless': '손없는날등록',
  '/work-schedule': '스케줄',
  '/profile': '프로필',
  '/meetups': '모임',
  '/boards': '게시판',
  '/notifications': '알림',
  '/search': '검색',
  '/settings': '설정',
  '/policies': '규정',
  '/work-shift-schedule': '근무스케줄',
  '/admin-mode': '관리자모드',
  '/reports': '신고관리',
  '/workday-history': '일시작종료',
  '/settlements': '결산자료',
  '/settlements/complaints-check': '컴플확인',
  '/settlements/ladder-dispatch': '사다리배차',
  '/settlements/handover': '인수인계서',
  '/settlements/materials-summary': '자재결산',
  '/soomgo-review-finder': '숨고리뷰찾기',
  '/warehouse': '창고현황',
  '/materials': '자재구매/현황',
  '/storage-status': '짐보관현황',
  '/menu-permissions': '메뉴권한',
  '/quotes': '견적',
  '/quote-forms': '견적',
  '/operations-dashboard': '대쉬보드',
  '/disposal': '폐기',
  '/disposal/forms': '폐기양식',
  '/disposal/forms/preview': '폐기견적서 전체 미리보기',
  '/disposal/list': '폐기목록',
  '/disposal/settlements': '폐기결산',
  '/disposal/jurisdictions': '관할구역등록',
  '/memo-pad': '메모장',
}

const APP_THEME_STORAGE_KEY = 'icj_app_theme'
const LAYOUT_GUIDE_BODY_CLASS = 'layout-guide-enabled'
const HTML_INSPECTOR_BODY_CLASS = 'html-inspector-enabled'
const TEXT_EDIT_BODY_CLASS = 'text-edit-enabled'
const SETTLEMENT_OVERRIDE_STORAGE_KEY = 'icj_settlement_overrides_v20260408'

function eventImageList(raw) {
  if (Array.isArray(raw) && raw.length) return raw.filter(Boolean)
  const text = String(raw || '').trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.filter(Boolean)
    } catch (_) {}
  }
  if (text.includes('\n')) return text.split(/\r?\n/).map(v => v.trim()).filter(Boolean)
  if (text.includes(',') && !text.startsWith('data:')) {
    const parts = text.split(',').map(v => v.trim()).filter(Boolean)
    if (parts.length > 1) return parts
  }
  return [text]
}

function escapePopupHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}


function buildMarkerMetaLabel(item, options = {}) {
  const showName = Boolean(options?.showName)
  const showBranch = Boolean(options?.showBranch)
  const showPosition = Boolean(options?.showPosition)
  const showCustomer = Boolean(options?.showCustomer)

  if (!item) return { left: '', right: '' }

  if (item.type === 'customer-start' || item.type === 'customer-end') {
    return { left: '', right: showCustomer ? String(item.customerName || '').trim() : '' }
  }

  if (item.type === 'business-start' || item.type === 'business-end') {
    const left = showBranch && item.branchNo ? `${item.branchNo}호점` : ''
    const right = showName ? String(item.accountName || '').trim() : ''
    return { left, right }
  }

  if (item.type === 'staff-start' || item.type === 'staff-end') {
    const left = showPosition ? String(item.positionTitle || '').trim() : ''
    const right = showName ? String(item.accountName || '').trim() : ''
    return { left, right }
  }

  if (item.type === 'moving' || item.type === 'stopped') {
    const left = showBranch && item.branchNo ? `${item.branchNo}호점` : (showPosition ? String(item.positionTitle || '').trim() : '')
    const right = showName ? String(item.accountName || '').trim() : ''
    return { left, right }
  }

  return { left: '', right: '' }
}

function openScheduleEditLogPopup(logs = []) {
  const popup = window.open('', 'schedule-edit-logs', 'width=820,height=640,scrollbars=yes,resizable=yes')
  if (!popup) {
    window.alert('팝업이 차단되어 수정기록 창을 열 수 없습니다. 브라우저 팝업 차단을 해제해 주세요.')
    return
  }
  const rows = Array.isArray(logs) && logs.length
    ? logs.map(log => `
      <tr>
        <td>${escapePopupHtml(log?.created_label || '-')}</td>
        <td>${escapePopupHtml(log?.account_name || '알 수 없음')}</td>
        <td>${escapePopupHtml(log?.change_summary || '-')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" class="empty">수정기록이 없습니다.</td></tr>'

  popup.document.open()
  popup.document.write(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>수정기록</title>
  <style>
    body { font-family: Arial, 'Malgun Gothic', sans-serif; margin: 0; background: #f8fafc; color: #111827; }
    .wrap { padding: 18px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    h1 { margin: 0; font-size: 18px; }
    button { border: 1px solid #d1d5db; background: #fff; border-radius: 10px; padding: 8px 12px; cursor: pointer; }
    .table-box { border: 1px solid #e5e7eb; background: #fff; border-radius: 14px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #f1f5f9; text-align: left; font-size: 13px; vertical-align: top; word-break: break-word; }
    th { background: #f8fafc; font-weight: 700; }
    tr:last-child td { border-bottom: 0; }
    .empty { text-align: center; color: #64748b; padding: 26px 12px; }
    .col-date { width: 170px; }
    .col-name { width: 140px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <h1>수정기록</h1>
      <button type="button" onclick="window.close()">닫기</button>
    </div>
    <div class="table-box">
      <table>
        <thead>
          <tr>
            <th class="col-date">수정일자</th>
            <th class="col-name">계정이름</th>
            <th>수정내용</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`)
  popup.document.close()
  popup.focus()
}

function normalizeAppTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light'
}

function getStoredThemePreference() {
  try {
    return normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY))
  } catch (_) {
    return 'light'
  }
}

function applyAppTheme(theme) {
  const nextTheme = normalizeAppTheme(theme)
  if (typeof document === 'undefined') return nextTheme
  document.documentElement.setAttribute('data-theme', nextTheme)
  if (document.body) document.body.setAttribute('data-theme', nextTheme)
  const themeColorMeta = document.querySelector('meta[name="theme-color"]')
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', nextTheme === 'dark' ? '#111827' : '#ffffff')
  }
  return nextTheme
}

function applyLayoutGuideMode(enabled) {
  if (typeof document === 'undefined') return !!enabled
  const active = !!enabled
  if (document.body) document.body.classList.toggle(LAYOUT_GUIDE_BODY_CLASS, active)
  if (document.documentElement) document.documentElement.classList.toggle(LAYOUT_GUIDE_BODY_CLASS, active)
  return active
}

function applyHtmlInspectorMode(enabled) {
  if (typeof document === 'undefined') return !!enabled
  const active = !!enabled
  if (document.body) document.body.classList.toggle(HTML_INSPECTOR_BODY_CLASS, active)
  if (document.documentElement) document.documentElement.classList.toggle(HTML_INSPECTOR_BODY_CLASS, active)
  try {
    window.dispatchEvent(new CustomEvent('icj-html-inspector-mode', { detail: { enabled: active } }))
  } catch (_) {}
  return active
}

function applyTextEditMode(enabled) {
  if (typeof document === 'undefined') return !!enabled
  const active = !!enabled
  if (document.body) document.body.classList.toggle(TEXT_EDIT_BODY_CLASS, active)
  if (document.documentElement) document.documentElement.classList.toggle(TEXT_EDIT_BODY_CLASS, active)
  return active
}

function escapeSelectorToken(value) {
  const raw = String(value || '')
  if (!raw) return ''
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(raw)
  return raw.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}

function buildHtmlInspectorSelector(element) {
  if (!(element instanceof Element)) return ''
  if (element.id) return `#${escapeSelectorToken(element.id)}`
  const parts = []
  let current = element
  while (current instanceof Element && parts.length < 6) {
    let part = current.tagName.toLowerCase()
    if (current.classList?.length) {
      part += '.' + Array.from(current.classList).slice(0, 3).map(escapeSelectorToken).join('.')
    }
    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(node => node.tagName === current.tagName)
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
    }
    parts.unshift(part)
    if (current.id) break
    current = current.parentElement
  }
  return parts.join(' > ')
}

function buildHtmlInspectorPayload(element) {
  if (!(element instanceof Element)) return null
  const rect = element.getBoundingClientRect()
  const textPreview = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  const payload = {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    className: element.className || '',
    selector: buildHtmlInspectorSelector(element),
    textPreview,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    html: element.outerHTML,
  }
  return payload
}

function pickComputedStyle(style, keys) {
  return Object.fromEntries(keys.map((key) => [key, style?.[key] || '']))
}

function buildInspectorAttributes(element) {
  if (!(element instanceof Element)) return {}
  return Array.from(element.attributes || []).reduce((acc, attr) => {
    acc[attr.name] = attr.value
    return acc
  }, {})
}

function getElementTextValue(element) {
  if (!(element instanceof Element)) return ''
  return String(element.innerText || element.textContent || element.getAttribute('value') || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function estimateComponentPath(element) {
  if (!(element instanceof Element)) return ''
  const route = window.location?.pathname || '/'
  if (route.startsWith('/map')) return 'frontend/src/App.jsx :: MapPage'
  if (route.startsWith('/schedule')) return 'frontend/src/App.jsx :: CalendarPage / ScheduleFormPage'
  if (route.startsWith('/work-schedule')) return 'frontend/src/App.jsx :: WorkSchedulePage'
  if (route.startsWith('/admin-mode')) return 'frontend/src/App.jsx :: AdminModePage'
  return 'frontend/src/App.jsx'
}

function collectActiveStylesheetNames() {
  if (typeof document === 'undefined') return []
  const hrefs = Array.from(document.styleSheets || []).map((sheet) => {
    try {
      const href = sheet?.href || ''
      if (href) return href.split('/').pop() || href
      const owner = sheet?.ownerNode
      if (owner?.tagName === 'STYLE') return 'inline-style'
    } catch (_) {}
    return ''
  }).filter(Boolean)
  return Array.from(new Set(hrefs)).slice(0, 20)
}

function buildAiUiContextPayload(element, options = {}) {
  if (!(element instanceof Element)) return null
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const parentDepth = Math.max(0, Math.min(6, Number(options.parentDepth || 3)))
  const siblingLimit = Math.max(0, Math.min(10, Number(options.siblingLimit || 6)))
  const parentChain = []
  let current = element.parentElement
  let depth = 0
  while (current && depth < parentDepth) {
    const currentRect = current.getBoundingClientRect()
    parentChain.push({
      tagName: current.tagName,
      id: current.id || '',
      className: typeof current.className === 'string' ? current.className : '',
      selector: buildHtmlInspectorSelector(current),
      text: getElementTextValue(current).slice(0, 180),
      rect: {
        x: Math.round(currentRect.x),
        y: Math.round(currentRect.y),
        width: Math.round(currentRect.width),
        height: Math.round(currentRect.height),
      },
    })
    current = current.parentElement
    depth += 1
  }
  const siblings = siblingLimit > 0
    ? Array.from(element.parentElement?.children || [])
      .filter((node) => node !== element)
      .slice(0, siblingLimit)
      .map((node) => {
        const nodeRect = node.getBoundingClientRect()
        return {
          tagName: node.tagName,
          id: node.id || '',
          className: typeof node.className === 'string' ? node.className : '',
          selector: buildHtmlInspectorSelector(node),
          text: getElementTextValue(node).slice(0, 120),
          rect: {
            x: Math.round(nodeRect.x),
            y: Math.round(nodeRect.y),
            width: Math.round(nodeRect.width),
            height: Math.round(nodeRect.height),
          },
        }
      })
    : []
  const computedStyle = pickComputedStyle(style, [
    'display', 'position', 'top', 'right', 'bottom', 'left',
    'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
    'lineHeight', 'letterSpacing', 'textAlign', 'width', 'height',
    'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'marginTop',
    'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'border', 'borderRadius', 'boxShadow',
    'gap', 'justifyContent', 'alignItems', 'flexDirection', 'gridTemplateColumns',
    'zIndex', 'opacity', 'whiteSpace', 'overflow', 'textOverflow'
  ])
  const route = options.pathname || window.location?.pathname || '/'
  return {
    exportedAt: new Date().toISOString(),
    pageMeta: {
      pageName: options.pageName || pageTitle(route),
      route,
      fullUrl: window.location?.href || route,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      theme: document.documentElement?.getAttribute('data-theme') || document.body?.getAttribute('data-theme') || 'light',
      breakpoint: window.innerWidth <= 768 ? 'mobile' : (window.innerWidth <= 1200 ? 'tablet' : 'desktop'),
      menuPath: options.menuPath || '',
    },
    currentUser: {
      id: options.user?.id || null,
      name: options.user?.name || options.user?.nickname || '',
      nickname: options.user?.nickname || '',
      grade: options.user?.grade ?? null,
      roleLabel: options.user?.grade === 1 ? '관리자' : String(options.user?.position_title || ''),
    },
    targetElement: {
      selector: buildHtmlInspectorSelector(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      classList: Array.from(element.classList || []),
      role: element.getAttribute('role') || '',
      name: element.getAttribute('name') || '',
      type: element.getAttribute('type') || '',
      text: getElementTextValue(element),
      attributes: buildInspectorAttributes(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      computedStyle,
      html: element.outerHTML,
    },
    context: {
      parentChain,
      siblings,
      activeCssFiles: collectActiveStylesheetNames(),
      componentPathGuess: estimateComponentPath(element),
      clickHandlerGuess: typeof element.onclick === 'function' ? 'inline onclick' : '',
    },
    request: {
      goal: String(options.request?.goal || '').trim(),
      similarScreen: String(options.request?.similarScreen || '').trim(),
      priorityDevice: String(options.request?.priorityDevice || '').trim(),
      constraints: String(options.request?.constraints || '').trim(),
    },
  }
}

function buildAiUiContextText(payload) {
  if (!payload) return ''
  return [
    `[페이지]`,
    `- ${payload.pageMeta?.pageName || '-'}`,
    `- 경로: ${payload.pageMeta?.route || '-'}`,
    `- 뷰포트: ${payload.pageMeta?.viewport?.width || '-'} x ${payload.pageMeta?.viewport?.height || '-'}`,
    `- 테마: ${payload.pageMeta?.theme || '-'}`,
    '',
    `[선택 요소]`,
    `- selector: ${payload.targetElement?.selector || '-'}`,
    `- tag: ${payload.targetElement?.tag || '-'}`,
    `- text: ${payload.targetElement?.text || '-'}`,
    `- rect: ${payload.targetElement?.rect?.width || '-'} x ${payload.targetElement?.rect?.height || '-'} @ (${payload.targetElement?.rect?.x || '-'}, ${payload.targetElement?.rect?.y || '-'})`,
    '',
    `[요청]`,
    `- goal: ${payload.request?.goal || '-'}`,
    `- similarScreen: ${payload.request?.similarScreen || '-'}`,
    `- priorityDevice: ${payload.request?.priorityDevice || '-'}`,
    `- constraints: ${payload.request?.constraints || '-'}`,
    '',
    `[JSON]`,
    JSON.stringify(payload, null, 2),
  ].join('\n')
}

function downloadInspectorFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch (_) {
    return false
  }
}

async function copyHtmlInspectorPayload(element) {
  const payload = buildHtmlInspectorPayload(element)
  if (!payload) return false
  const message = [
    `selector: ${payload.selector || payload.tagName}`,
    `tag: ${payload.tagName}`,
    `id: ${payload.id || '-'}`,
    `class: ${payload.className || '-'}`,
    `text: ${payload.textPreview || '-'}`,
    `rect: ${payload.rect.width}x${payload.rect.height} @ (${payload.rect.x}, ${payload.rect.y})`,
    '',
    payload.html,
  ].join('\n')
  window.__icjLastHtmlInspectData = payload
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(message)
      return true
    }
  } catch (_) {}
  try {
    const textarea = document.createElement('textarea')
    textarea.value = message
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    textarea.remove()
    return success
  } catch (_) {
    return false
  }
}

function buildInspectorClipboardText(payload, selectedSections = {}) {
  if (!payload) return ''
  const sections = []
  const pushSection = (title, value) => {
    if (!value) return
    sections.push(`[${title}]`)
    sections.push(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    sections.push('')
  }
  const targetElement = payload.targetElement || {}
  const context = payload.context || {}
  const pageMeta = payload.pageMeta || {}
  const selectionSummary = {
    selector: targetElement.selector || '-',
    tag: targetElement.tag || '-',
    id: targetElement.id || '-',
    classList: targetElement.classList || [],
    text: targetElement.text || '',
    rect: targetElement.rect || {},
  }
  if (selectedSections.selector) pushSection('HTML 요소', selectionSummary)
  if (selectedSections.html) pushSection('HTML 원본', targetElement.html || '')
  if (selectedSections.style) pushSection('스타일', targetElement.computedStyle || {})
  if (selectedSections.attributes) pushSection('속성', targetElement.attributes || {})
  if (selectedSections.rect) pushSection('위치/크기', targetElement.rect || {})
  if (selectedSections.pageMeta) pushSection('페이지 정보', pageMeta)
  if (selectedSections.componentPath) pushSection('컴포넌트 추정 경로', context.componentPathGuess || '')
  if (selectedSections.parentChain) pushSection('부모 요소', context.parentChain || [])
  if (selectedSections.siblings) pushSection('형제 요소', context.siblings || [])
  if (selectedSections.request) pushSection('요청 메모', payload.request || {})
  return sections.join('\n').trim()
}

function HtmlInspectorPanel({
  open,
  payload,
  selectedSelector,
  options,
  onChangeOption,
  onChangeSection,
  selectedSections,
  anchorStyle,
  onClear,
  onClose,
  onCopyConfirm,
  onCopyJson,
  onSaveJson,
  onSaveTxt,
}) {
  if (!open) return null
  const jsonText = payload ? JSON.stringify(payload, null, 2) : ''
  return createPortal(
    <div className="ai-ui-inspector-panel" style={anchorStyle || undefined} onClick={(event) => event.stopPropagation()}>
      <div className="between ai-ui-inspector-panel-head">
        <div>
          <strong>HTML 요소 정보 추출</strong>
          <div className="muted tiny-text">Ctrl + 클릭한 요소 아래에 열리며, 체크한 정보만 복사됩니다.</div>
        </div>
        <button type="button" className="small ghost" onClick={onClose}>닫기</button>
      </div>
      <div className="stack compact-gap ai-ui-inspector-panel-body">
        <div className="card ai-ui-inspector-summary-card">
          <div className="muted tiny-text">현재 선택</div>
          <div className="small-text ai-ui-inspector-selector">{selectedSelector || '선택된 요소 없음'}</div>
        </div>
        <div className="ai-ui-inspector-checklist">
          <label><input type="checkbox" checked={!!selectedSections.selector} onChange={e => onChangeSection('selector', e.target.checked)} />HTML 요소</label>
          <label><input type="checkbox" checked={!!selectedSections.style} onChange={e => onChangeSection('style', e.target.checked)} />스타일</label>
          <label><input type="checkbox" checked={!!selectedSections.html} onChange={e => onChangeSection('html', e.target.checked)} />outerHTML</label>
          <label><input type="checkbox" checked={!!selectedSections.attributes} onChange={e => onChangeSection('attributes', e.target.checked)} />속성</label>
          <label><input type="checkbox" checked={!!selectedSections.rect} onChange={e => onChangeSection('rect', e.target.checked)} />위치/크기</label>
          <label><input type="checkbox" checked={!!selectedSections.pageMeta} onChange={e => onChangeSection('pageMeta', e.target.checked)} />페이지 정보</label>
          <label><input type="checkbox" checked={!!selectedSections.componentPath} onChange={e => onChangeSection('componentPath', e.target.checked)} />컴포넌트 경로</label>
          <label><input type="checkbox" checked={!!selectedSections.parentChain} onChange={e => onChangeSection('parentChain', e.target.checked)} />부모 요소</label>
          <label><input type="checkbox" checked={!!selectedSections.siblings} onChange={e => onChangeSection('siblings', e.target.checked)} />형제 요소</label>
          <label><input type="checkbox" checked={!!selectedSections.request} onChange={e => onChangeSection('request', e.target.checked)} />요청 메모</label>
        </div>
        <div className="ai-ui-inspector-actions">
          <button type="button" className="small" onClick={onCopyConfirm} disabled={!payload}>확인 후 복사</button>
          <button type="button" className="small ghost" onClick={onClear}>선택해제</button>
          <button type="button" className="small ghost" onClick={onCopyJson} disabled={!payload}>JSON 복사</button>
          <button type="button" className="small ghost" onClick={onSaveJson} disabled={!payload}>JSON 저장</button>
          <button type="button" className="small ghost" onClick={onSaveTxt} disabled={!payload}>TXT 저장</button>
        </div>
        <div className="ai-ui-inspector-grid">
          <label>
            <span>부모 단계</span>
            <input type="number" min="0" max="6" value={options.parentDepth} onChange={(e) => onChangeOption('parentDepth', Number(e.target.value || 0))} />
          </label>
          <label>
            <span>형제 요소 수</span>
            <input type="number" min="0" max="10" value={options.siblingLimit} onChange={(e) => onChangeOption('siblingLimit', Number(e.target.value || 0))} />
          </label>
        </div>
        <label>
          <span>원하는 수정사항</span>
          <textarea rows="2" value={options.goal} onChange={(e) => onChangeOption('goal', e.target.value)} placeholder="예: 버튼 간격 축소, 모바일 한 줄 유지" />
        </label>
        <div className="ai-ui-inspector-grid">
          <label>
            <span>비슷하게 맞출 화면</span>
            <input value={options.similarScreen} onChange={(e) => onChangeOption('similarScreen', e.target.value)} placeholder="예: 메인홈 상단 버튼" />
          </label>
          <label>
            <span>제약사항</span>
            <input value={options.constraints} onChange={(e) => onChangeOption('constraints', e.target.value)} placeholder="예: 폭 유지, 밖으로 넘치지 않게" />
          </label>
        </div>
        <label>
          <span>미리보기 JSON</span>
          <textarea className="ai-ui-inspector-json" rows="10" value={jsonText} readOnly placeholder="Ctrl + 클릭으로 요소를 선택하면 JSON이 생성됩니다." />
        </label>
      </div>
    </div>,
    document.body,
  )
}

function pageTitle(pathname) {
  if (pathname.startsWith('/schedule/new')) return '일정등록'
  if (/^\/schedule\/\d+\/edit$/.test(pathname)) return '일정수정'
  if (/^\/schedule\/\d+$/.test(pathname)) return '일정상세'
  if (pathname === '/disposal/forms/preview') return '폐기견적서 전체 미리보기'
  if (/^\/disposal\/forms\/[^/]+$/.test(pathname)) return '폐기양식 상세'
  if (pathname.startsWith('/chats/direct/') || pathname.startsWith('/chats/group/')) return '채팅방'
  return PAGE_TITLES[pathname] || '앱'
}


function MenuIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

function BellIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4.5a4.5 4.5 0 0 0-4.5 4.5v2.17c0 .88-.27 1.74-.78 2.46L5.7 15.1a1 1 0 0 0 .82 1.58h10.96a1 1 0 0 0 .82-1.58l-1.02-1.47a4.24 4.24 0 0 1-.78-2.46V9A4.5 4.5 0 0 0 12 4.5Z" />
      <path d="M9.75 18.25a2.25 2.25 0 0 0 4.5 0" />
    </svg>
  )
}

function SettingsIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.25 3.9h3.5l.45 2.13c.42.14.82.31 1.2.51l1.9-1.06 2.47 2.47-1.06 1.9c.2.38.37.78.51 1.2l2.13.45v3.5l-2.13.45c-.14.42-.31.82-.51 1.2l1.06 1.9-2.47 2.47-1.9-1.06c-.38.2-.78.37-1.2.51l-.45 2.13h-3.5l-.45-2.13a8.1 8.1 0 0 1-1.2-.51l-1.9 1.06-2.47-2.47 1.06-1.9a8.1 8.1 0 0 1-.51-1.2l-2.13-.45v-3.5l2.13-.45c.14-.42.31-.82.51-1.2l-1.06-1.9 2.47-2.47 1.9 1.06c.38-.2.78-.37 1.2-.51l.45-2.13Z" />
      <circle cx="12" cy="12" r="2.85" />
    </svg>
  )
}

function ArrowLeftIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 5.5 8.5 12 15 18.5" />
      <path d="M9 12h9" />
    </svg>
  )
}

function SearchIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  )
}

const DEFAULT_ALERT_SETTINGS = {
  mobileEnabled: true,
  appEnabled: true,
  repeatHours: 1,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  mobileTypes: { assignment: true, time: true, address: true },
  appTypes: { assignment: true, time: true, address: true },
}

function deepMerge(base, extra) {
  const output = Array.isArray(base) ? [...base] : { ...base }
  if (!extra || typeof extra !== 'object') return output
  Object.entries(extra).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value)
    } else {
      output[key] = value
    }
  })
  return output
}

function normalizeAlertSettings(rawPrefs) {
  return deepMerge(DEFAULT_ALERT_SETTINGS, rawPrefs?.alertSettings || {})
}

function scheduleNotificationCategory(type) {
  const value = String(type || '')
  if (value.includes('assignment')) return 'assignment'
  if (value.includes('time')) return 'time'
  if (value.includes('address')) return 'address'
  return 'assignment'
}

function isScheduleAlertNotification(item) {
  return ['work_schedule_assignment', 'work_schedule_assignment_added', 'work_schedule_assignment_removed', 'work_schedule_assignment_change', 'work_schedule_time_change', 'work_schedule_address_change', 'calendar_assignment_change', 'calendar_assignment_added', 'calendar_assignment_removed', 'calendar_time_change', 'calendar_address_change'].includes(String(item?.type || ''))
}

function getNotificationDisplayParts(item) {
  const type = String(item?.type || '')
  const body = String(item?.body || '')
  const title = String(item?.title || '')
  const compactMatch = body.match(/(\d{1,2}월\s*\d{1,2}일).*?([\w가-힣()]+)\s*고객/)
  const nameMatch = body.match(/([가-힣A-Za-z0-9_]+)\s*(대표|부대표|호점대표|팀장|부팀장|본부장|상담실장|상담팀장|상담사원|직원)/)
  const dateText = compactMatch?.[1]?.replace(/\s+/g, ' ') || ''
  const customerText = compactMatch?.[2] || ''
  const assigneeText = nameMatch ? `${nameMatch[1]} ${nameMatch[2]}` : ''
  if (['work_schedule_assignment_change', 'calendar_assignment_change', 'work_schedule_assignment_added', 'calendar_assignment_added', 'work_schedule_assignment_removed', 'calendar_assignment_removed'].includes(type)) {
    const action = type.includes('removed') ? '삭제' : '배정'
    return { title: '스케줄 변경', compact: true, dateText, customerText, assigneeText, action }
  }
  return { title, compact: false, body: formatNotificationBodyText(type, body) }
}

function formatNotificationBodyText(type, body) {
  if (['work_schedule_assignment_added', 'work_schedule_assignment_removed', 'calendar_assignment_added', 'calendar_assignment_removed'].includes(String(type || ''))) {
    return String(body || '').replace(/고객\s+일정/g, '고객\n일정')
  }
  return String(body || '')
}

function formatNotificationBodyForDevice(item, isMobile) {
  const display = getNotificationDisplayParts(item)
  if (display.compact) {
    return (
      <span className="notification-compact-body">
        <span>{display.dateText || '-'} {display.customerText || '고객'} 고객 | </span>
        <span>{display.assigneeText || '담당자'} </span>
        <span className={display.action === '삭제' ? 'notification-action-delete' : 'notification-action-assign'}>{display.action}</span>
      </span>
    )
  }
  const body = String(display.body || '')
  if (!isMobile) return body.replace(/\n+/g, ' ')
  return body
}

function parseTimeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function isNowInQuietHours(settings) {
  if (!settings?.quietHoursEnabled) return false
  const start = parseTimeToMinutes(settings.quietStart)
  const end = parseTimeToMinutes(settings.quietEnd)
  if (start == null || end == null) return false
  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  if (start === end) return true
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

function alertStorageKey(userId, channel) {
  return `icj_alert_state_${channel}_${userId || 'guest'}`
}

function loadAlertShownMap(userId, channel) {
  try {
    const raw = localStorage.getItem(alertStorageKey(userId, channel))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function saveAlertShownMap(userId, channel, value) {
  try {
    localStorage.setItem(alertStorageKey(userId, channel), JSON.stringify(value || {}))
  } catch (_) {}
}

const BRANCH_NUMBER_OPTIONS = [0, ...Array.from({ length: 50 }, (_, index) => index + 1)]

const ROLE_OPTIONS = [
  { value: 1, label: '관리자' },
  { value: 2, label: '부관리자' },
  { value: 3, label: '중간관리자' },
  { value: 4, label: '사업자권한' },
  { value: 5, label: '직원권한' },
  { value: 6, label: '일반권한' },
  { value: 7, label: '기타권한' },
]

const POSITION_OPTIONS = ['대표', '부대표', '호점대표', '팀장', '부팀장', '직원', '본부장', '상담실장', '상담팀장', '상담사원']
const GENDER_OPTIONS = ['남성', '여성']

const POSITION_PERMISSION_OPTIONS = ['미지정', ...POSITION_OPTIONS]

const POLICY_CONTENT_DEFAULTS = {
  vacation: {
    business: {
      label: '사업자',
      allowed: user => Number(user?.grade || 6) <= 4,
      defaultContent: [
        '개요',
        '',
        '사업자 연차 사용 규정',
        '',
        '구분',
        '분기마다 4일의 연차',
        '1분기 4일 / 2분기 4일 / 3분기 4일 / 4분기 4일',
        '',
        '분기구분',
        '1월 / 2월 / 3월 / 4월 / 5월 / 6월 / 7월 / 8월 / 9월 / 10월 / 11월 / 12월',
        '',
        '연간 가능한 총 사용일수',
        '총 16일',
        '',
        '기본신청기준',
        '- 가능: 2주(14일) 전 미리 신청 시 가능',
        '- 가능: 주말, 공휴일, 손 없는 날 사용 가능',
        '- 불가: 14일 이내 신청',
        '- 불가: 이미 풀 스케줄일 경우',
        '- 예외: 급작스런 경조사 및 특수한 날은 사유에 따라 승인 가능',
        '',
        '특별신청기준',
        '결혼식 / 신혼여행 시 기타로 분류',
        '',
        '개요',
        '',
        '사업자 월차 사용 규정',
        '',
        '구분',
        '월마다 1일의 월차',
        '1월~12월 각 월 1일',
        '',
        '연간 가능한 총 사용일수',
        '총 12일',
        '',
        '기본신청기준',
        '- 가능: 1주(7일) 전 미리 신청 시 가능',
        '- 불가: 7일 이내 신청',
        '- 불가: 주말, 공휴일, 손 없는 날, 이미 풀 스케줄일 경우',
        '- 불가: 월차와 연차를 같은 달에 동시 사용',
      ].join('\n'),
    },
    field: {
      label: '현장직원',
      allowed: user => Number(user?.grade || 6) <= 5,
      defaultContent: '현장직원 휴가 규정을 입력해 주세요.',
    },
    office: {
      label: '본사직원',
      allowed: user => Number(user?.grade || 6) <= 4,
      defaultContent: '본사직원 휴가 규정을 입력해 주세요.',
    },
  },
  welfare: {
    business: {
      label: '사업자',
      allowed: user => Number(user?.grade || 6) <= 4,
      defaultContent: '사업자 복지 규정을 입력해 주세요.',
    },
    field: {
      label: '현장직원',
      allowed: user => Number(user?.grade || 6) <= 5,
      defaultContent: '현장직원 복지 규정을 입력해 주세요.',
    },
    office: {
      label: '본사직원',
      allowed: user => Number(user?.grade || 6) <= 4,
      defaultContent: '본사직원 복지 규정을 입력해 주세요.',
    },
  },
  schedule: {
    common: {
      label: '공용',
      allowed: user => Number(user?.grade || 9) <= 5,
      defaultContent: '공용 스케줄 규정을 입력해 주세요.',
    },
  },
}

const POLICY_CATEGORY_OPTIONS = [
  { id: 'vacation', label: '휴가' },
  { id: 'welfare', label: '복지' },
  { id: 'schedule', label: '스케줄' },
]
function normalizeGenderValue(value) {
  const gender = String(value || '').trim()
  if (!gender) return ''
  const lowered = gender.toLowerCase()
  if (['남', '남자', 'male', 'm'].includes(lowered)) return '남성'
  if (['여', '여자', 'female', 'f'].includes(lowered)) return '여성'
  return GENDER_OPTIONS.includes(gender) ? gender : ''
}

function normalizeBranchNo(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isAssignedBranchNo(value) {
  return value !== '' && value !== null && value !== undefined && !Number.isNaN(Number(value))
}

function branchOptionLabel(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '본점 또는 미지정'
  return num === 0 ? '본점' : `${num}호점`
}

function branchDisplayLabel(value, fallback = '본점/미지정') {
  if (!isAssignedBranchNo(value)) return fallback
  return branchOptionLabel(value)
}

function resolveBusinessBranchNo(item = {}) {
  if (isAssignedBranchNo(item?.branch_no)) return Number(item.branch_no)
  const text = `${String(item?.name || '').trim()} ${String(item?.nickname || '').trim()} ${String(item?.email || '').trim()}`.trim()
  if (text.includes('심진수')) return 0
  return null
}

function branchEditorLabel(item = {}) {
  const branchNo = resolveBusinessBranchNo(item)
  if (branchNo === 0) return '0본점'
  if (Number.isFinite(branchNo)) return `${branchNo}호점`
  return '본점/미지정'
}


function formatFullDateLabel(value) {
  const raw = String(value || '').slice(0, 10)
  return raw || '-'
}

function formatRequesterBranchLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  if (raw === 'TEMP_BRANCH' || raw === '임시') return '임시'
  const normalized = raw.replace(/^BRANCH_/, '').replace(/^0+(?=\d)/, '')
  if (/^\d+$/.test(normalized)) return `${normalized}호점`
  if (raw.endsWith('호점')) return raw
  return raw
}

function normalizeFlexibleLoginId(value) {
  return Array.from(String(value || '').trim().toLowerCase())
    .filter(char => /[^\W_]/u.test(char))
    .join('')
    .slice(0, 30)
}

function parseRequesterMeta(request) {
  const requesterBranchLabel = String(request?.requester_branch_label || request?.requester_branch_code || '').trim()
  const requesterDisplayName = String(request?.requester_display_name || request?.requester_user_name || request?.requester_nickname || '').trim()
  const requesterName = String(request?.requester_name || '').trim()
  const fallbackBranch = requesterBranchLabel || (isAssignedBranchNo(request?.branch_no) ? branchOptionLabel(request.branch_no) : '-')
  const fallbackName = requesterDisplayName || String(request?.name || request?.nickname || '').trim()
  const uniqueId = String(
    request?.requester_unique_id
    || request?.requester_account_unique_id
    || request?.account_unique_id
    || request?.unique_id
    || request?.user_unique_id
    || ''
  ).trim()

  if (requesterBranchLabel || requesterDisplayName) {
    return {
      branch: fallbackBranch,
      name: requesterDisplayName || fallbackName || '-',
      uniqueId: uniqueId || '-',
    }
  }

  const match = requesterName.match(/^\s*([^\s]+호점)\s*(.*)$/)
  if (match) {
    return {
      branch: match[1] || fallbackBranch,
      name: match[2] || fallbackName || match[1] || '-',
      uniqueId: uniqueId || '-',
    }
  }

  return {
    branch: fallbackBranch,
    name: requesterName || fallbackName || '-',
    uniqueId: uniqueId || '-',
  }
}

const ADMIN_SORT_OPTIONS = [
  { value: 'group_number', label: '구분 기준' },
  { value: 'account_type', label: '사업자 / 직원 분류' },
  { value: 'vehicle_available', label: '차량가용여부기준' },
  { value: 'position_title', label: '직급별 기준' },
  { value: 'role', label: '직책별 기준' },
  { value: 'grade', label: '계정권한 기준' },
  { value: 'created_desc', label: '최신가입순' },
  { value: 'email', label: '아이디 기준' },
  { value: 'custom', label: '사용자 지정' },
]

const ADMIN_CUSTOM_SORT_FIELDS = [
  { value: 'group_number', label: '구분 기준' },
  { value: 'account_type', label: '사업자 / 직원 분류' },
  { value: 'vehicle_available', label: '차량가용여부기준' },
  { value: 'position_title', label: '직급별 기준' },
  { value: 'role', label: '직책별 기준' },
  { value: 'grade', label: '계정권한 기준' },
  { value: 'created_desc', label: '최신가입순' },
  { value: 'email', label: '아이디 기준' },
]

function sortMenuItemsByLabel(items = []) {
  return [...items].sort((left, right) => String(left?.label || '').localeCompare(String(right?.label || ''), 'ko-KR'))
}

const MENU_PERMISSION_SECTIONS = [
  {
    id: 'common',
    label: '공용',
    items: [
      { id: 'reviews', label: '리뷰', path: '/reviews' },
      { id: 'warehouse', label: '창고현황', path: '/warehouse' },
      { id: 'quotes', label: '견적', path: '/quotes' },
      { id: 'workday-history', label: '일시작종료', path: '/workday-history' },
      { id: 'policies', label: '규정', path: '/policies' },
      { id: 'work-shift-schedule', label: '근무스케줄', path: '/work-shift-schedule' },
    ],
  },
  {
    id: 'head-office',
    label: '본사용',
    items: [
      { id: 'settlements', label: '결산자료', path: '/settlements' },
      { id: 'storage-status', label: '짐보관현황', path: '/storage-status' },
      { id: 'disposal', label: '폐기', path: '/disposal' },
      { id: 'soomgo-review-finder', label: '숨고리뷰찾기', path: '/soomgo-review-finder' },
      { id: 'reports', label: '신고관리', path: '/reports' },
      { id: 'memo-pad', label: '메모장', path: '/memo-pad' },
    ],
  },
  {
    id: 'business',
    label: '사업자용',
    items: [
      { id: 'materials', label: '자재구매/현황', path: '/materials' },
    ],
  },
  {
    id: 'employee',
    label: '직원용',
    items: [
      { id: 'points', label: '포인트', path: '/points' },
    ],
  },
  {
    id: 'admin',
    label: '관리자모드',
    items: [
      { id: 'admin-mode', label: '관리자모드', path: '/admin-mode', adminOnly: true },
      { id: 'menu-permissions', label: '메뉴권한', path: '/menu-permissions', adminOnly: true },
    ],
  },
].map(section => ({
  ...section,
  items: sortMenuItemsByLabel(section.items || []),
}))

const MENU_PERMISSION_ITEMS = MENU_PERMISSION_SECTIONS.flatMap(section => [
  { key: `section:${section.id}`, type: 'section', sectionId: section.id, label: section.label },
  ...section.items.map(item => ({ ...item, key: `item:${item.id}`, type: 'item', sectionId: section.id })),
])

const MENU_LOCK_ITEMS = MENU_PERMISSION_SECTIONS.flatMap(section => (
  section.items
    .filter(item => !!item.path)
    .map(item => ({
      id: item.id,
      label: item.label,
      path: item.path,
      sectionId: section.id,
      sectionLabel: section.label,
      adminOnly: !!item.adminOnly,
    }))
))


const QUICK_ACTION_MENU_ITEMS = MENU_PERMISSION_SECTIONS.flatMap(section => (section.items || []).map(item => ({
  id: `menu-${item.id}`,
  label: item.label,
  kind: 'link',
  path: item.path,
  adminOnly: !!item.adminOnly,
  sourceSectionId: section.id,
})))

const QUICK_ACTION_TOPBAR_ITEMS = [
  { id: 'menu-home', label: '홈', kind: 'link', path: '/' },
  { id: 'menu-search', label: '검색', kind: 'link', path: '/search' },
  { id: 'menu-notifications', label: '알림', kind: 'link', path: '/notifications' },
  { id: 'menu-settings', label: '설정', kind: 'link', path: '/settings' },
  { id: 'menu-profile', label: '프로필', kind: 'link', path: '/profile' },
]

const SETTLEMENT_MENU_GROUPS = [
  {
    id: 'daily',
    label: '일일',
    items: [
      { key: 'daily-settlement', label: '일일결산', path: '/settlements?tab=daily' },
      { key: 'soomgo-review-finder', label: '숨고리뷰찾기', path: '/soomgo-review-finder' },
      { key: 'complaints-check', label: '컴플확인', path: '/settlements/complaints-check' },
      { key: 'ladder-dispatch', label: '사다리배차', path: '/settlements/ladder-dispatch' },
    ],
  },
  {
    id: 'weekly',
    label: '주간',
    items: [
      { key: 'weekly-settlement', label: '주간결산', path: '/settlements?tab=weekly' },
      { key: 'storage-status', label: '짐보관현황', path: '/storage-status' },
      { key: 'handover', label: '인수인계서', path: '/settlements/handover' },
    ],
  },
  {
    id: 'monthly',
    label: '월간',
    items: [
      { key: 'monthly-settlement', label: '월간결산', path: '/settlements?tab=monthly' },
      { key: 'materials-summary', label: '자재결산', path: '/settlements/materials-summary' },
    ],
  },
]

function buildDefaultMenuLocks() {
  return MENU_LOCK_ITEMS.reduce((acc, item) => {
    acc[item.id] = true
    return acc
  }, {})
}

function parseMenuLocks(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw || {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function normalizeMenuLocks(raw) {
  const defaults = buildDefaultMenuLocks()
  const parsed = parseMenuLocks(raw)
  Object.entries(parsed).forEach(([key, value]) => {
    if (typeof defaults[key] === 'boolean' && typeof value === 'boolean') {
      defaults[key] = value
    }
  })
  return defaults
}

function isMenuLockedForUser(user, menuLocks, itemId) {
  if (Number(user?.grade || 6) <= 2) return false
  const normalized = normalizeMenuLocks(menuLocks)
  if (typeof normalized[itemId] === 'boolean') return !normalized[itemId]
  return false
}

function findLockedMenuItemByPath(pathname) {
  if (!pathname) return null
  const normalizedPath = String(pathname).trim()
  return MENU_LOCK_ITEMS.find(item => normalizedPath === item.path || normalizedPath.startsWith(`${item.path}/`)) || null
}

function effectivePositionTitle(user) {
  const title = String(user?.position_title || '').trim()
  if (title) return title
  if (Number(user?.branch_no || 0) > 0) return '호점대표'
  return '미지정'
}

function isAdministrator(user) {
  return Number(user?.grade || 6) === 1
}

function parseMenuPermissions(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw || {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function buildDefaultMenuPermissions() {
  const defaults = {}
  MENU_PERMISSION_ITEMS.forEach(entry => {
    defaults[entry.key] = POSITION_PERMISSION_OPTIONS.reduce((acc, position) => {
      acc[position] = true
      return acc
    }, {})
  })
  return defaults
}

function normalizeMenuPermissions(raw) {
  const parsed = parseMenuPermissions(raw)
  const defaults = buildDefaultMenuPermissions()
  Object.entries(parsed).forEach(([key, value]) => {
    if (!defaults[key] || typeof value !== 'object' || !value) return
    POSITION_PERMISSION_OPTIONS.forEach(position => {
      if (typeof value[position] === 'boolean') defaults[key][position] = value[position]
    })
  })
  return defaults
}

function canViewMenuEntry(user, permissionMap, entryKey) {
  if (Number(user?.grade || 6) === 1) return true
  const position = effectivePositionTitle(user)
  const row = permissionMap?.[entryKey]
  if (!row) return true
  if (typeof row[position] === 'boolean') return row[position]
  return row['미지정'] ?? true
}

function gradeLabel(grade) {
  return ROLE_OPTIONS.find(item => item.value === Number(grade))?.label || '일반권한'
}

function canAccessAdminMode(user) {
  return Number(user?.grade || 6) <= 2 || Number(user?.grade || 6) <= Number(user?.permission_config?.admin_mode_access_grade || 2)
}

function isReadOnlyMember(user) {
  return Number(user?.grade || 6) === 6
}

function canAccessStaffRoutes(user) {
  return Number(user?.grade || 6) <= 5
}

function isEmployeeRestrictedUser(user) {
  const accountType = String(user?.account_type || '').trim().toLowerCase()
  return accountType === 'employee' || Number(user?.grade || 6) === 5
}

function canUseMaterialsPurchase(user) {
  return !isEmployeeRestrictedUser(user)
}

function canAccessMenuSectionByGrade(user, sectionId) {
  const grade = Number(user?.grade || 6)
  if (grade <= 2) return true
  if (sectionId === 'common') return grade !== 6 && grade !== 7
  if (sectionId === 'head-office') return grade <= 2
  if (sectionId === 'business') return grade <= 4
  if (sectionId === 'employee') return grade <= 5
  if (sectionId === 'admin') return grade <= 2
  return true
}

function canAccessMenuItemByUser(user, item, permissionMap, menuLocks) {
  if (!item) return false
  if (!canAccessStaffRoutes(user)) return false
  if (!canAccessMenuSectionByGrade(user, item.sectionId)) return false
  if (item.adminOnly && !canAccessAdminMode(user)) return false
  if (isEmployeeRestrictedUser(user) && ['materials', 'workday-history', 'settlements'].includes(item.id)) return false
  if (isMenuLockedForUser(user, menuLocks, item.id)) return false
  return canViewMenuEntry(user, permissionMap, `section:${item.sectionId}`) && canViewMenuEntry(user, permissionMap, `item:${item.id}`)
}

function canUserAccessPath(user, pathname, permissionMap, menuLocks) {
  const normalizedPath = String(pathname || '').trim()
  if (!normalizedPath) return false
  if (['/', '/search', '/notifications', '/settings', '/profile'].includes(normalizedPath)) {
    return canAccessStaffRoutes(user)
  }
  if (normalizedPath === '/materials?tab=myRequests' || normalizedPath === '/materials?tab=sales') {
    return canAccessStaffRoutes(user) && !isEmployeeRestrictedUser(user)
  }
  if (normalizedPath === '/materials?tab=requesters' || normalizedPath === '/materials?tab=settlements') {
    return canAccessStaffRoutes(user) && Number(user?.grade || 6) <= 2
  }
  if (normalizedPath === '/operations-dashboard') {
    return canAccessStaffRoutes(user) && Number(user?.grade || 6) <= 2
  }
  const lockedItem = findLockedMenuItemByPath(normalizedPath)
  if (lockedItem) return canAccessMenuItemByUser(user, lockedItem, permissionMap, menuLocks)
  if (normalizedPath.startsWith('/settlements')) return canAccessStaffRoutes(user) && !isEmployeeRestrictedUser(user)
  if (normalizedPath === '/memo-pad') return canAccessStaffRoutes(user) && Number(user?.grade || 6) <= 2
  return canAccessStaffRoutes(user)
}

function AccessDeniedRedirect({ message = '권한이 없습니다.' }) {
  const navigate = useNavigate()
  useEffect(() => {
    const timer = window.setTimeout(() => navigate('/', { replace: true, state: { notice: message } }), 1200)
    return () => window.clearTimeout(timer)
  }, [message, navigate])
  return <div className="card error">{message}</div>
}

function parseExcludedBusinessSlots(value) {
  const output = Array(6).fill('')
  if (!value) return output
  let tokens = []
  if (Array.isArray(value)) {
    tokens = value
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) tokens = parsed
    } catch (_) {}
    if (tokens.length === 0) {
      tokens = value.split(/[\n,]/).map(token => token.trim()).filter(Boolean)
    }
  }
  tokens
    .map(item => {
      const match = String(item).match(/(\d{1,2})/)
      return match ? String(Number(match[1])) : ''
    })
    .filter(Boolean)
    .slice(0, 6)
    .forEach((token, index) => { output[index] = token })
  return output
}

function serializeExcludedBusinessSlots(slots) {
  return slots.filter(Boolean).map(value => `${value}호점`).join(', ')
}

function buildExcludedBusinessDetailsFromSlots(slots = [], options = [], reasons = []) {
  const optionMap = new Map((options || []).map(option => [String(option.value), option]))
  return (slots || []).map((value, index) => {
    const key = String(value || '').trim()
    if (!key) return null
    const option = optionMap.get(key) || {}
    return {
      branch_no: Number(key),
      name: String(option.name || option.label || `${key}호점`).replace(/^\[[^\]]+\]\s*/, '').trim(),
      reason: String((reasons || [])[index] || '').trim(),
      user_id: Number(option.userId || 0) || null,
    }
  }).filter(Boolean)
}

const BASE_QUICK_ACTION_LIBRARY = [
  { id: 'friendCount', label: '친구 수', kind: 'metric', metricKey: 'friendCount', path: '/friends' },
  { id: 'requestCount', label: '친구요청', kind: 'metric', metricKey: 'requestCount', path: '/friends?panel=requests' },
  { id: 'point', label: '포인트', kind: 'placeholder' },
  { id: 'warehouse', label: '창고현황', kind: 'placeholder' },
  { id: 'materials', label: '자재 신청현황', multiline: true, kind: 'link', path: '/materials?tab=myRequests' },
  { id: 'materialsBuy', label: '자재구매', kind: 'link', path: '/materials?tab=sales' },
  { id: 'materialsRequesters', label: '신청목록', kind: 'metric', metricKey: 'pendingMaterialsRequesterCount', path: '/materials?tab=requesters', adminOnly: true },
  { id: 'materialsSettlement', label: '구매결산', kind: 'link', path: '/materials?tab=settlements', adminOnly: true },
  { id: 'storageStatus', label: '짐보관\n현황', multiline: true, kind: 'placeholder' },
  { id: 'memoPad', label: '메모장', kind: 'link', path: '/memo-pad', adminOnly: true },
  { id: 'ladderDispatch', label: '사다리\n배차', multiline: true, kind: 'link', path: '/settlements/ladder-dispatch', adminOnly: true },
  { id: 'soomgoReviewFinder', label: '숨고리뷰', kind: 'link', path: '/soomgo-review-finder', adminOnly: true },
  { id: 'dailySettlement', label: '일일결산', kind: 'link', path: '/settlements?tab=daily', adminOnly: true },
  { id: 'weeklySettlement', label: '주간결산', kind: 'link', path: '/settlements?tab=weekly', adminOnly: true },
  { id: 'monthlySettlement', label: '월간결산', kind: 'link', path: '/settlements?tab=monthly', adminOnly: true },
  { id: 'materialSummary', label: '자재결산', kind: 'link', path: '/settlements/materials-summary', adminOnly: true },
  { id: 'settlements', label: '결산자료', kind: 'link', path: '/settlements' },
  { id: 'operationsDashboard', label: '대쉬보드', kind: 'link', path: '/operations-dashboard', adminOnly: true },
]
const DEFAULT_QUICK_ACTION_IDS = ['point', 'warehouse', 'materials', 'materialsBuy', 'materialsRequesters', 'materialsSettlement', 'storageStatus', 'settlements', 'operationsDashboard']
const ADMIN_EXTRA_QUICK_ACTION_IDS = ['memoPad', 'ladderDispatch', 'soomgoReviewFinder', 'dailySettlement', 'weeklySettlement', 'monthlySettlement', 'materialSummary']
const HOME_SECTION_ORDER_DEFAULT = ['quick', 'upcoming']
const HOME_HOLD_SECONDS_DEFAULT = 1
const QUICK_DRAG_HOLD_MS = 500
const QUICK_LAYOUT_OPTIONS = [
  { id: '3x3', label: '3*3', columns: 3, previewType: 'grid' },
  { id: '4x4', label: '4*4', columns: 4, previewType: 'grid' },
  { id: '5x5', label: '5*5', columns: 5, previewType: 'grid' },
  { id: '6x6', label: '6*6', columns: 6, previewType: 'grid' },
  { id: 'list', label: '목록형', columns: 1, previewType: 'list' },
]
const QUICK_ACTION_LIBRARY = [...BASE_QUICK_ACTION_LIBRARY, ...QUICK_ACTION_TOPBAR_ITEMS, ...QUICK_ACTION_MENU_ITEMS].filter((item, index, array) => array.findIndex(entry => entry.id === item.id) === index)

const QUICK_ACTION_LIMIT = 36
const QUICK_ACTION_PREPARING_IDS = new Set([
  'point',
  'warehouse',
  'materials',
  'materialsBuy',
  'materialsRequesters',
  'materialsSettlement',
  'storageStatus',
  'memoPad',
  'ladderDispatch',
  'soomgoReviewFinder',
  'dailySettlement',
  'weeklySettlement',
  'monthlySettlement',
  'materialSummary',
  'settlements',
])

function isQuickActionPreparingLockedForUser(user, itemId) {
  return Number(user?.grade || 6) > 2 && QUICK_ACTION_PREPARING_IDS.has(String(itemId || ''))
}

function homeSettingsStorageKey(userId) {
  return `icj_home_settings_${userId || 'guest'}`
}

function getHomeSettings(userId) {
  const fallback = {
    sectionOrder: [...HOME_SECTION_ORDER_DEFAULT],
    workday: { holdSeconds: HOME_HOLD_SECONDS_DEFAULT, enabled: true, hideOnHome: false },
    quickLayout: '5x5',
    activeWorkState: { started: false, updatedAt: '', startTime: '', endTime: '', workDate: '' },
  }
  try {
    const raw = localStorage.getItem(homeSettingsStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const knownIds = new Set(HOME_SECTION_ORDER_DEFAULT)
    const sectionOrder = Array.isArray(parsed?.sectionOrder) ? parsed.sectionOrder.filter(item => knownIds.has(item)) : fallback.sectionOrder
    const workday = parsed?.workday && typeof parsed.workday === 'object' ? parsed.workday : {}
    const activeWorkState = parsed?.activeWorkState && typeof parsed.activeWorkState === 'object' ? parsed.activeWorkState : {}
    const missing = HOME_SECTION_ORDER_DEFAULT.filter(item => !sectionOrder.includes(item))
    return {
      sectionOrder: [...sectionOrder, ...missing],
      workday: {
        holdSeconds: Math.max(1, Math.min(10, Number(workday.holdSeconds || HOME_HOLD_SECONDS_DEFAULT))),
        enabled: workday.enabled !== false,
        hideOnHome: !!workday.hideOnHome,
      },
      quickLayout: QUICK_LAYOUT_OPTIONS.some(option => option.id === String(parsed?.quickLayout || '')) ? String(parsed.quickLayout) : '5x5',
      activeWorkState: {
        started: !!activeWorkState.started,
        updatedAt: String(activeWorkState.updatedAt || ''),
        startTime: String(activeWorkState.startTime || ''),
        endTime: String(activeWorkState.endTime || ''),
        workDate: String(activeWorkState.workDate || ''),
      },
    }
  } catch (_) {
    return fallback
  }
}

function saveHomeSettings(userId, nextState) {
  localStorage.setItem(homeSettingsStorageKey(userId), JSON.stringify(nextState))
}

function quickActionStorageKey(userId) {
  return `icj_quick_actions_${userId || 'guest'}`
}

function friendGroupStorageKey(userId) {
  return `icj_friend_groups_${userId || 'guest'}`
}

function friendMenuKey(section, itemId) {
  return `${section || 'friend'}-${itemId}`
}

function profileCoverStorageKey(userId) {
  return `icj_profile_cover_${userId || 'guest'}`
}

function loadProfileCover(userId) {
  try { return localStorage.getItem(profileCoverStorageKey(userId)) || '' } catch { return '' }
}

function saveProfileCover(userId, value) {
  try {
    if (!value) localStorage.removeItem(profileCoverStorageKey(userId))
    else localStorage.setItem(profileCoverStorageKey(userId), value)
  } catch {}
}

function getQuickActionState(userId) {
  const fallbackArchived = QUICK_ACTION_LIBRARY.map(item => item.id).filter(id => !DEFAULT_QUICK_ACTION_IDS.includes(id))
  const fallback = { active: [...DEFAULT_QUICK_ACTION_IDS], archived: fallbackArchived }
  try {
    const raw = localStorage.getItem(quickActionStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const known = new Set(QUICK_ACTION_LIBRARY.map(item => item.id))
    const active = Array.isArray(parsed?.active) ? parsed.active.filter(id => known.has(id)) : fallback.active
    const archived = Array.isArray(parsed?.archived) ? parsed.archived.filter(id => known.has(id) && !active.includes(id)) : fallback.archived.filter(id => !active.includes(id))
    const missing = QUICK_ACTION_LIBRARY.map(item => item.id).filter(id => !active.includes(id) && !archived.includes(id))
    return { active: active.slice(0, QUICK_ACTION_LIMIT), archived: [...archived, ...missing] }
  } catch (_) {
    return fallback
  }
}

function saveQuickActionState(userId, nextState) {
  localStorage.setItem(quickActionStorageKey(userId), JSON.stringify(nextState))
}

function getQuickActionListBadgeCount(item, summary) {
  if (!item) return 0
  if (item.kind === 'metric') return Math.max(0, Number(summary?.[item.metricKey] ?? 0) || 0)
  return 0
}

function getQuickActionListDetail(item, summary, user) {
  if (!item) return ''
  if (item.kind === 'metric') {
    const count = getQuickActionListBadgeCount(item, summary)
    return count > 0 ? `확인 필요 ${count}건` : '확인할 알림이 없습니다.'
  }
  if (item.kind === 'placeholder') return '준비중'
  if (item.adminOnly && Number(user?.grade || 6) > 2) return '관리자 전용'
  const detailMap = {
    materials: '내 자재 신청 현황 확인',
    materialsBuy: '자재 구매 화면으로 이동',
    materialsRequesters: '신청목록 화면으로 이동',
    materialsSettlement: '구매결산 화면으로 이동',
    storageStatus: '준비중',
    memoPad: '메모장 화면으로 이동',
    ladderDispatch: '사다리 배차 화면으로 이동',
    soomgoReviewFinder: '숨고리뷰 화면으로 이동',
    dailySettlement: '일일결산 화면으로 이동',
    weeklySettlement: '주간결산 화면으로 이동',
    monthlySettlement: '월간결산 화면으로 이동',
    materialSummary: '자재결산 화면으로 이동',
    settlements: '결산자료 화면으로 이동',
    operationsDashboard: '대쉬보드 화면으로 이동',
    point: '준비중',
    warehouse: '준비중',
  }
  return detailMap[item.id] || '바로가기'
}


function getFriendGroupState(userId) {
  const fallback = { categories: [], groups: [], assignments: {} }
  try {
    const raw = localStorage.getItem(friendGroupStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const categories = Array.isArray(parsed?.categories)
      ? parsed.categories
        .map(item => ({ id: String(item?.id || ''), name: String(item?.name || '').trim() }))
        .filter(item => item.id && item.name)
      : []
    const groups = Array.isArray(parsed?.groups)
      ? parsed.groups
        .map(item => ({ id: String(item?.id || ''), name: String(item?.name || '').trim(), category_id: String(item?.category_id || item?.categoryId || '') }))
        .filter(item => item.id && item.name)
      : []
    return {
      categories,
      groups,
      assignments: parsed?.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {},
    }
  } catch (_) {
    return fallback
  }
}

function saveFriendGroupState(userId, nextState) {
  localStorage.setItem(friendGroupStorageKey(userId), JSON.stringify(nextState))
}

function loadDisposalAdminAlertItems() {
  try {
    const raw = localStorage.getItem('icj_disposal_records_v2') || localStorage.getItem('icj_disposal_records_v1') || '[]'
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const alerts = []
    parsed.forEach((record) => {
      if (!record || typeof record !== 'object') return
      if (!record?.settlementTransferredAt) return
      const items = Array.isArray(record?.items) ? record.items : []
      const hasUnreportedSettlementItem = items.some((item) => {
        const paymentDone = !!item?.paymentDone
        const paymentSettledAt = String(item?.paymentSettledAt || '').trim()
        const reportDone = !!item?.reportDone
        return paymentDone && !!paymentSettledAt && !reportDone
      })
      if (!hasUnreportedSettlementItem) return
      alerts.push({
        key: String(record?.id || `${record?.disposalDate || ''}-${record?.customerName || ''}-${record?.location || ''}`),
        disposalDate: String(record?.disposalDate || '').trim() || '-',
        customerName: String(record?.customerName || '').trim() || '고객',
        message: `(${String(record?.disposalDate || '').trim() || '-'}) 폐기 예정인 ${String(record?.customerName || '').trim() || '고객'} 고객님의 폐기 신고접수가 되어 있지 않습니다.`,
      })
    })
    return alerts
  } catch (_) {
    return []
  }
}

function disposalAdminAlertSignature(items = []) {
  return (items || []).map(item => `${item.key}:${item.disposalDate}:${item.customerName}`).sort().join('|')
}

function DisposalAdminAlertModal({ open, items = [], onClose, onOpenSettlements }) {
  if (!open || !items.length) return null
  return (
    <div className="disposal-confirm-overlay disposal-admin-alert-overlay" role="dialog" aria-modal="true" onMouseDown={(event) => {
      if (event.target !== event.currentTarget) return
      onClose?.()
    }}>
      <div className="disposal-confirm-card disposal-admin-alert-card">
        <div className="disposal-bulk-payment-header">
          <div className="disposal-bulk-payment-title">폐기 신고 미접수 알림</div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {items.map((item) => (
            <div key={item.key} className="card" style={{ padding: '12px 14px' }}>
              <strong>{item.disposalDate}</strong>
              <div style={{ marginTop: 6 }}>{item.customerName}</div>
              <div className="muted small-text" style={{ marginTop: 6 }}>{item.message}</div>
            </div>
          ))}
        </div>
        <div className="disposal-confirm-actions">
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
          <button type="button" onClick={onOpenSettlements}>폐기결산 보기</button>
        </div>
      </div>
    </div>
  )
}


function isLeaderPosition(positionTitle) {
  return ['대표', '부대표', '호점대표'].includes(String(positionTitle || '').trim())
}

function getFriendPrimaryBadge(item) {
  if (!item) return ''
  if (isLeaderPosition(item.position_title)) {
    const branchNo = String(item.branch_no || item.branch_code || item.group_number || '').trim()
    return branchNo ? `${branchNo}호점` : '호점'
  }
  return String(item.position_title || item.grade_label || item.role || '직원').trim()
}

function getFriendDisplayName(item) {
  return String(item?.name || item?.nickname || item?.login_id || '회원').trim() || '회원'
}

function getFriendIntro(item, fallback = '한줄소개가 없습니다.') {
  return item?.one_liner || item?.bio || item?.region || fallback
}

function chatPinnedOrderStorageKey(userId) {
  return `icj_chat_pinned_order_${userId || 'guest'}`
}

function loadChatPinnedOrder(userId) {
  try {
    const raw = localStorage.getItem(chatPinnedOrderStorageKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveChatPinnedOrder(userId, order) {
  try {
    localStorage.setItem(chatPinnedOrderStorageKey(userId), JSON.stringify(Array.from(new Set(order.filter(Boolean)))))
  } catch {}
}

function Layout({ children, user, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expandedMenuItems, setExpandedMenuItems] = useState({ disposal: false, settlements: false })
  const menuRef = useRef(null)
  const settingsRef = useRef(null)
  const [badges, setBadges] = useState({ notification_count: 0, chat_count: 0, friend_request_count: 0, menu_count: 0 })
  const [disposalAdminAlerts, setDisposalAdminAlerts] = useState([])
  const [disposalAdminAlertOpen, setDisposalAdminAlertOpen] = useState(false)
  const isScheduleView = location.pathname === '/schedule'
  const isWorkScheduleView = location.pathname === '/work-schedule'
  const isWideScheduleLayout = isScheduleView
  const isSearchView = location.pathname === '/search'
  const bottomLinks = [
    ['/', '홈'],
    ['/map', '지도'],
    ['/friends', '친구'],
    ['/chats', '채팅'],
    ['/schedule', '일정'],
    ['/work-schedule', '스케줄'],
  ]
  const isBottomActive = (to) => {
    if (to === '/') return location.pathname === '/'
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }
  const menuPermissions = useMemo(() => normalizeMenuPermissions(user?.permission_config?.menu_permissions_json), [user?.permission_config?.menu_permissions_json])
  const menuLocks = useMemo(() => normalizeMenuLocks(user?.permission_config?.menu_locks_json), [user?.permission_config?.menu_locks_json])
  const employeeRestricted = isEmployeeRestrictedUser(user)
  const topMenuSections = useMemo(() => {
    const grade = Number(user?.grade || 6)
    const isPrivilegedMenuUser = grade <= 2
    return MENU_PERMISSION_SECTIONS
      .map(section => ({
        ...section,
        visible: (() => {
          if (isPrivilegedMenuUser) return true
          if (section.id === 'common') return grade !== 6 && grade !== 7
          if (section.id === 'head-office') return grade <= 2
          if (section.id === 'business') return grade <= 4
          if (section.id === 'employee') return grade <= 5
          if (section.id === 'admin') return grade <= 2
          return true
        })() && (isPrivilegedMenuUser || canViewMenuEntry(user, menuPermissions, `section:${section.id}`)),
        items: sortMenuItemsByLabel(section.items.filter(item => {
          if (isPrivilegedMenuUser) return true
          if (employeeRestricted && ['materials', 'workday-history', 'settlements'].includes(item.id)) return false
          if (item.adminOnly && !canAccessAdminMode(user)) return false
          if (isMenuLockedForUser(user, menuLocks, item.id)) return false
          return canViewMenuEntry(user, menuPermissions, `item:${item.id}`)
        })),
      }))
      .filter(section => section.visible && section.items.length > 0)
  }, [employeeRestricted, menuLocks, menuPermissions, user])

  useEffect(() => {
    setMenuOpen(false)
    setSettingsOpen(false)
    setExpandedMenuItems({ disposal: false })
  }, [location.pathname])

  useEffect(() => {
    function handleOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
      if (settingsRef.current && !settingsRef.current.contains(event.target)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [isMobile])

  useEffect(() => {
    let ignore = false
    async function loadBadges() {
      try {
        const result = await api('/api/badges-summary')
        if (!ignore) setBadges(result || { notification_count: 0, chat_count: 0, friend_request_count: 0, menu_count: 0 })
      } catch (_) {
        if (!ignore) setBadges({ notification_count: 0, chat_count: 0, friend_request_count: 0, menu_count: 0 })
      }
    }
    loadBadges()
    const timer = window.setInterval(loadBadges, 15000)
    return () => {
      ignore = true
      window.clearInterval(timer)
    }
  }, [location.pathname, user?.id])

  useEffect(() => {
    const grade = Number(user?.grade || 6)
    if (grade > 2) {
      setDisposalAdminAlerts([])
      setDisposalAdminAlertOpen(false)
      return undefined
    }
    const syncDisposalAlerts = () => {
      const nextItems = loadDisposalAdminAlertItems()
      const nextSignature = disposalAdminAlertSignature(nextItems)
      setDisposalAdminAlerts(nextItems)
      if (!nextItems.length) {
        setDisposalAdminAlertOpen(false)
        try {
          sessionStorage.removeItem(`icj_disposal_admin_alert_seen_${user?.id || 'guest'}`)
        } catch (_) {}
        return
      }
      try {
        const seenKey = `icj_disposal_admin_alert_seen_${user?.id || 'guest'}`
        const previousSignature = sessionStorage.getItem(seenKey) || ''
        if (previousSignature !== nextSignature) {
          sessionStorage.setItem(seenKey, nextSignature)
          setDisposalAdminAlertOpen(true)
        }
      } catch (_) {
        setDisposalAdminAlertOpen(true)
      }
    }
    syncDisposalAlerts()
    window.addEventListener('storage', syncDisposalAlerts)
    window.addEventListener('focus', syncDisposalAlerts)
    window.addEventListener('icj-disposal-records-updated', syncDisposalAlerts)
    return () => {
      window.removeEventListener('storage', syncDisposalAlerts)
      window.removeEventListener('focus', syncDisposalAlerts)
      window.removeEventListener('icj-disposal-records-updated', syncDisposalAlerts)
    }
  }, [user?.grade, user?.id, location.pathname])

  function renderBottomLabel(to, label) {
    const count = to === '/chats' ? Number(badges.chat_count || 0) : to === '/friends' ? Number(badges.friend_request_count || 0) : 0
    return (
      <span className="bottom-nav-label-wrap">
        <span>{label}</span>
        {count > 0 && <span className="bottom-nav-badge">{count > 99 ? '99+' : count}</span>}
      </span>
    )
  }

  return (
    <div className={`app-shell${isWideScheduleLayout ? ' schedule-wide' : ''}`}>
      <DisposalAdminAlertModal
        open={disposalAdminAlertOpen && disposalAdminAlerts.length > 0}
        items={disposalAdminAlerts}
        onClose={() => setDisposalAdminAlertOpen(false)}
        onOpenSettlements={() => {
          setDisposalAdminAlertOpen(false)
          navigate('/disposal/settlements')
        }}
      />
      {isSearchView ? (
        <header className="topbar topbar-fixed topbar-search-mode">
          <div className="topbar-search-shell">
            <button type="button" className="ghost icon-button topbar-icon-button" onClick={() => navigate(-1)} aria-label="뒤로">
              <ArrowLeftIcon className="topbar-icon-svg" />
            </button>
            <div className="topbar-search-title">검색</div>
          </div>
        </header>
      ) : (
      <header className="topbar topbar-fixed">
        <div className="topbar-left">
          <div className="dropdown-wrap" ref={menuRef}>
            <button type="button" className="ghost icon-button topbar-icon-button menu-button-with-badge" onClick={() => setMenuOpen(v => !v)} aria-label="메뉴">
              <MenuIcon className="topbar-icon-svg" />
            </button>
            {menuOpen && (
              <div className="dropdown-menu left menu-category-dropdown">
                {topMenuSections.map(section => (
                  <div key={section.id} className="menu-category-block">
                    <div className="menu-category-title">{section.label}</div>
                    {section.items.length === 0 ? (
                      <div className="dropdown-item muted menu-category-empty">표시 가능한 메뉴가 없습니다.</div>
                    ) : section.items.map(item => {
                      if (item.id === 'disposal') {
                        const expanded = !!expandedMenuItems.disposal
                        const disposalLinks = [
                          { key: 'forms', label: '양식', path: '/disposal/forms' },
                          { key: 'list', label: '목록', path: '/disposal/list' },
                          { key: 'settlements', label: '결산', path: '/disposal/settlements' },
                        ]
                        return (
                          <div key={item.id} className="menu-category-submenu">
                            <button
                              type="button"
                              className="dropdown-item menu-category-item menu-category-item-expand"
                              onClick={() => setExpandedMenuItems(prev => ({ ...prev, disposal: !prev.disposal }))}
                            >
                              <span>{item.label}</span>
                              <span className="menu-category-expand-icon">{expanded ? '−' : '+'}</span>
                            </button>
                            {expanded ? (
                              <div className="menu-category-submenu-list">
                                {disposalLinks.map(link => (
                                  <button
                                    key={link.key}
                                    type="button"
                                    className="dropdown-item menu-category-item menu-category-subitem"
                                    onClick={() => {
                                      navigate(link.path)
                                      setMenuOpen(false)
                                    }}
                                  >
                                    {link.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      }
                      if (item.id === 'settlements') {
                        const expanded = !!expandedMenuItems.settlements
                        return (
                          <div key={item.id} className="menu-category-submenu">
                            <button
                              type="button"
                              className="dropdown-item menu-category-item menu-category-item-expand"
                              onClick={() => setExpandedMenuItems(prev => ({ ...prev, settlements: !prev.settlements }))}
                            >
                              <span>{item.label}</span>
                              <span className="menu-category-expand-icon">{expanded ? '−' : '+'}</span>
                            </button>
                            {expanded ? (
                              <div className="menu-category-submenu-list">
                                {SETTLEMENT_MENU_GROUPS.map(group => (
                                  <div key={group.id} className="menu-category-submenu-group">
                                    <div className="menu-category-submenu-group-title">{group.label}</div>
                                    {group.items.map(link => (
                                      <button
                                        key={link.key}
                                        type="button"
                                        className="dropdown-item menu-category-item menu-category-subitem"
                                        onClick={() => {
                                          navigate(link.path)
                                          setMenuOpen(false)
                                        }}
                                      >
                                        {link.label}
                                      </button>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      }
                      return (
                        <button key={item.id} type="button" className="dropdown-item menu-category-item" onClick={() => {
                          navigate(item.path)
                          setMenuOpen(false)
                        }}>
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                ))}
                {isAdministrator(user) && (
                  <div className="menu-category-footer">
                    <button type="button" className="dropdown-item menu-permission-button" onClick={() => {
                      navigate('/menu-permissions')
                      setMenuOpen(false)
                    }}>
                      메뉴권한
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="page-heading">{pageTitle(location.pathname)}</div>
        <div className="topbar-right">
          <button type="button" className={location.pathname === '/search' ? 'ghost icon-button topbar-icon-button active-icon' : 'ghost icon-button topbar-icon-button'} onClick={() => navigate('/search')} aria-label="검색">
            <SearchIcon className="topbar-icon-svg" />
          </button>
          <button type="button" className={location.pathname === '/notifications' ? 'ghost icon-button topbar-icon-button active-icon notification-icon-button' : 'ghost icon-button topbar-icon-button notification-icon-button'} onClick={() => navigate('/notifications')} aria-label="알림">
            <BellIcon className="topbar-icon-svg" />
            {Number(badges.notification_count || 0) > 0 && <span className="notification-badge">{badges.notification_count > 99 ? '99+' : badges.notification_count}</span>}
          </button>
          <div className="dropdown-wrap" ref={settingsRef}>
            <button type="button" className={location.pathname === '/settings' ? 'ghost icon-button topbar-icon-button active-icon' : 'ghost icon-button topbar-icon-button'} onClick={() => setSettingsOpen(v => !v)} aria-label="설정">
              <SettingsIcon className="topbar-icon-svg" />
            </button>
            {settingsOpen && (
              <div className="dropdown-menu right">
                {canAccessAdminMode(user) && <button type="button" className="dropdown-item" onClick={() => navigate('/admin-mode')}>관리자모드</button>}
                <button type="button" className="dropdown-item" onClick={() => navigate('/profile')}>프로필</button>
                <button type="button" className="dropdown-item" onClick={() => navigate('/settings')}>설정</button>
                <button type="button" className="dropdown-item danger-text" onClick={onLogout}>로그아웃</button>
              </div>
            )}
          </div>
        </div>
      </header>
      )}
      <main className={`page-container${location.pathname === '/' ? ' page-container-home' : ''}${location.pathname === '/map' ? ' page-container-map' : ''}${location.pathname === '/friends' ? ' page-container-friends' : ''}${location.pathname.startsWith('/chat') ? ' page-container-chat' : ''}${isSearchView ? ' page-container-search' : ''}${(location.pathname.startsWith('/chats/direct/') || location.pathname.startsWith('/chats/group/')) ? ' page-container-chat-room' : ''}${isWideScheduleLayout ? ' schedule-wide' : ''}${isWorkScheduleView ? ' work-schedule-wide' : ''}`}>{children}</main>
      <nav className="bottom-nav">
        {bottomLinks.map(([to, label]) => (
          <Link key={to} className={isBottomActive(to) ? 'bottom-nav-item active' : 'bottom-nav-item'} to={to}>
            {renderBottomLabel(to, label)}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function AuthPage({ onLogin }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState({ login_id: 'admin', password: 'admin1234' })
  const [autoLogin, setAutoLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const notice = location.state?.notice || ''
  useEffect(() => {
    api('/api/demo-accounts').then(setAccounts).catch(() => {})
  }, [])
  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setSession(data.access_token, data.user, true)
      onLogin(data.user)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>로그인</h1>
        <p className="muted">로그인 후 앱 메인 화면으로 이동합니다.</p>
        {notice ? <div className="card notice-text" style={{ marginBottom: 12 }}>{notice}</div> : null}
        <form onSubmit={submit} className="stack">
          <input value={form.login_id} onChange={e => setForm({ ...form, login_id: e.target.value })} placeholder="아이디" autoComplete="username" />
          <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="비밀번호" autoComplete="current-password" />
          <div className="muted auto-login-check">로그인 상태는 로그아웃 전까지 유지됩니다.</div>
          <button disabled={loading}>{loading ? '로그인 중...' : '로그인'}</button>
          {error && <div className="error">{error}</div>}
        </form>
        <div className="auth-guest-quote-box">
          <div className="auth-guest-quote-title">로그인 없이도 견적 요청이 가능합니다.</div>
          <div className="auth-guest-quote-help">이름과 연락처만 먼저 입력한 뒤, 당일이사 또는 짐보관이사를 선택해서 바로 견적을 접수할 수 있습니다.</div>
          <Link to="/guest-quote" className="auth-guest-quote-button">로그인 없이 견적 받기</Link>
        </div>
        <div className="inline-actions auth-link-row auth-link-row-three">
          <Link to="/signup" className="ghost-link">회원가입</Link>
          <Link to="/find-account" className="ghost-link">계정찾기</Link>
          <Link to="/reset-password" className="ghost-link">비밀번호 재설정</Link>
        </div>
        <div className="demo-box">
          <strong>등록 계정</strong>
          <div className="demo-list demo-list-accounts">
            {accounts.map(acc => (
              <button
                key={acc.login_id || acc.email}
                type="button"
                className="demo-item demo-item-account"
                onClick={() => setForm(prev => ({ ...prev, login_id: acc.login_id || acc.email || '', password: '' }))}
              >
                <span className="demo-account-group">{acc.group_number || '0'}</span>
                <span className="demo-account-name">{acc.name || acc.nickname || '-'}</span>
                <span className="demo-account-id">{acc.login_id || acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function SignupPage({ onLogin }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '',
    password: '',
    nickname: '',
    gender: '',
    birth_year: '',
    region: '',
    phone: '',
    recovery_email: '',
    vehicle_number: '',
    branch_no: '',
  })
  const [error, setError] = useState('')
  const branchOptions = BRANCH_NUMBER_OPTIONS

  async function submit(e) {
    e.preventDefault()
    setError('')
    const requiredFields = [
      ['아이디', form.email],
      ['비밀번호', form.password],
      ['닉네임', form.nickname],
      ['성별', form.gender],
      ['생년', form.birth_year],
      ['지역', form.region],
      ['연락처', form.phone],
      ['복구 이메일', form.recovery_email],
    ]
    const missing = requiredFields.filter(([, value]) => !String(value || '').trim()).map(([label]) => label)
    if (missing.length) {
      setError(`다음 필수 항목을 입력해 주세요: ${missing.join(', ')}`)
      return
    }
    try {
      const payload = {
        ...form,
        email: form.email.trim(),
        password: form.password.trim(),
        nickname: form.nickname.trim(),
        gender: form.gender.trim(),
        birth_year: Number(form.birth_year),
        region: form.region.trim(),
        phone: form.phone.trim(),
        recovery_email: form.recovery_email.trim(),
        vehicle_number: form.vehicle_number.trim(),
        branch_no: normalizeBranchNo(form.branch_no),
      }
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (data?.pending_approval) {
        window.alert(data?.message || '회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.')
        navigate('/login', { replace: true, state: { notice: data?.message || '회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' } })
        return
      }
      setSession(data.access_token, data.user, true)
      onLogin(data.user)
      navigate('/')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>회원가입</h1>
        <form onSubmit={submit} className="stack">
          <input type="text" placeholder="아이디 *" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          <input type="password" placeholder="비밀번호 *" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
          <input placeholder="닉네임 *" value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} required />
          <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} required><option value="">성별 선택 *</option>{GENDER_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select>
          <input type="number" placeholder="생년 *" value={form.birth_year} onChange={e => setForm({ ...form, birth_year: e.target.value })} required />
          <input placeholder="지역 *" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} required />
          <input placeholder="연락처 *" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required />
          <input type="email" placeholder="복구 이메일 *" value={form.recovery_email} onChange={e => setForm({ ...form, recovery_email: e.target.value })} required />
          <input placeholder="차량번호 (선택)" value={form.vehicle_number} onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />
          <select value={form.branch_no} onChange={e => setForm({ ...form, branch_no: e.target.value })}>
            <option value="">호점 선택 (선택)</option>
            {branchOptions.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
          </select>
          <button>가입 후 로그인</button>
          {error && <div className="error">{error}</div>}
        </form>
        <Link to="/login" className="ghost-link">로그인으로 돌아가기</Link>
      </section>
    </div>
  )
}

function FindAccountPage() {
  const [form, setForm] = useState({ nickname: '', phone: '', recovery_email: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const data = await api('/api/auth/find-account', {
        method: 'POST',
        body: JSON.stringify({
          nickname: form.nickname.trim(),
          phone: form.phone.trim(),
          recovery_email: form.recovery_email.trim(),
        }),
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>계정찾기</h1>
        <p className="muted">닉네임, 연락처, 복구 이메일이 모두 일치하면 등록된 아이디를 확인할 수 있습니다.</p>
        <form onSubmit={submit} className="stack">
          <input placeholder="닉네임" value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} required />
          <input placeholder="연락처" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required />
          <input type="email" placeholder="복구 이메일" value={form.recovery_email} onChange={e => setForm({ ...form, recovery_email: e.target.value })} required />
          <button disabled={loading}>{loading ? '조회 중...' : '계정 찾기'}</button>
        </form>
        {result && <div className="success">확인된 아이디: <strong>{result.account_id}</strong></div>}
        {error && <div className="error">{error}</div>}
        <Link to="/login" className="ghost-link">로그인으로 돌아가기</Link>
      </section>
    </div>
  )
}

function ResetPasswordPage() {
  const [requestForm, setRequestForm] = useState({ recovery_email: '' })
  const [confirmForm, setConfirmForm] = useState({ recovery_email: '', code: '', email: '', new_password: '' })
  const [demoCode, setDemoCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function requestCode(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const data = await api('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify(requestForm),
      })
      setDemoCode(data.demo_code || '')
      setConfirmForm({ ...confirmForm, recovery_email: requestForm.recovery_email })
      setMessage(`복구 코드가 발급되었습니다.${data.demo_code ? ` 데모 코드: ${data.demo_code}` : ''}`)
    } catch (err) {
      setError(err.message)
    }
  }
  async function confirm(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const data = await api('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify(confirmForm),
      })
      setMessage(data.message)
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-card wide">
        <h1>비밀번호 재설정</h1>
        <div className="grid2">
          <form onSubmit={requestCode} className="stack">
            <h3>1. 복구 코드 요청</h3>
            <input placeholder="복구 이메일" value={requestForm.recovery_email} onChange={e => setRequestForm({ recovery_email: e.target.value })} />
            <button>코드 요청</button>
            {demoCode && <div className="info">데모 코드: {demoCode}</div>}
          </form>
          <form onSubmit={confirm} className="stack">
            <h3>2. 코드 확인 후 비밀번호 변경</h3>
            <input placeholder="복구 이메일" value={confirmForm.recovery_email} onChange={e => setConfirmForm({ ...confirmForm, recovery_email: e.target.value })} />
            <input placeholder="인증 코드" value={confirmForm.code} onChange={e => setConfirmForm({ ...confirmForm, code: e.target.value })} />
            <input placeholder="로그인 아이디" value={confirmForm.email} onChange={e => setConfirmForm({ ...confirmForm, email: e.target.value })} />
            <input type="password" placeholder="새 비밀번호" value={confirmForm.new_password} onChange={e => setConfirmForm({ ...confirmForm, new_password: e.target.value })} />
            <button>비밀번호 변경</button>
          </form>
        </div>
        {message && <div className="success">{message}</div>}
      {readOnly && <div className="card muted">일반 등급은 스케줄 화면을 관람만 할 수 있습니다.</div>}
        {error && <div className="error">{error}</div>}
        <Link to="/login" className="ghost-link">로그인으로 이동</Link>
      </section>
    </div>
  )
}

function WorkdayHistoryPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    async function loadLogs() {
      try {
        const response = await api('/api/workday/logs')
        if (!ignore) setItems(Array.isArray(response?.items) ? response.items : [])
      } catch (err) {
        if (!ignore) setError(err.message || '기록을 불러오지 못했습니다.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    loadLogs()
    return () => { ignore = true }
  }, [])

  return (
    <div className="stack-page">
      <section className="card">
        <div className="between align-center">
          <h2>일시작종료</h2>
          <div className="muted small-text">일자별 시작/종료 기록</div>
        </div>
        {loading && <div className="muted">불러오는 중...</div>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && (
          <div className="list">
            {items.map(item => (
              <div key={`${item.work_date}-${item.id}`} className="list-item block">
                <div className="between">
                  <strong>{item.work_date}</strong>
                  <span className="muted">{item.end_time ? '종료완료' : item.start_time ? '진행중' : '대기'}</span>
                </div>
                <div className="admin-summary-line admin-summary-line-primary">
                  <span>[시작 {item.start_time || '-'}]</span>
                  <span>[종료 {item.end_time || '-'}]</span>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="muted">기록이 없습니다.</div>}
          </div>
        )}
      </section>
    </div>
  )
}

function HomePage() {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const menuPermissions = useMemo(() => normalizeMenuPermissions(currentUser?.permission_config?.menu_permissions_json), [currentUser?.permission_config?.menu_permissions_json])
  const menuLocks = useMemo(() => normalizeMenuLocks(currentUser?.permission_config?.menu_locks_json), [currentUser?.permission_config?.menu_locks_json])
  const employeeRestricted = isEmployeeRestrictedUser(currentUser)
  const [summary, setSummary] = useState(null)
  const [homePrefs, setHomePrefs] = useState({ quickListMode: false })
  const [quickState, setQuickState] = useState(() => getQuickActionState(currentUser?.id))
  const [editingQuick, setEditingQuick] = useState(false)
  const [homeSettingsOpen, setHomeSettingsOpen] = useState(false)
  const [quickLayoutOpen, setQuickLayoutOpen] = useState(false)
  const [quickLayoutPreview, setQuickLayoutPreview] = useState('')
  const [homeSettings, setHomeSettings] = useState(() => getHomeSettings(currentUser?.id))
  const [draggingQuickId, setDraggingQuickId] = useState('')
  const [dragOverQuickId, setDragOverQuickId] = useState('')
  const [dragReadyQuickId, setDragReadyQuickId] = useState('')
  const quickTouchStateRef = useRef({ active: false, armed: false, quickId: '', moved: false })
  const quickDragSuppressClickRef = useRef(false)
  const quickCardRefs = useRef(new Map())
  const quickCardPrevRectsRef = useRef(new Map())
  const [holdProgress, setHoldProgress] = useState(false)
  const [workdayStatus, setWorkdayStatus] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const holdTimerRef = useRef(null)
  const quickDragHoldTimerRef = useRef(null)
  const workdayTapRef = useRef({ lastAt: 0 })


  useLayoutEffect(() => {
    const nextRects = new Map()
    quickState.active.forEach(id => {
      const node = quickCardRefs.current.get(id)
      if (node) {
        nextRects.set(id, node.getBoundingClientRect())
      }
    })

    quickState.active.forEach(id => {
      const node = quickCardRefs.current.get(id)
      const prevRect = quickCardPrevRectsRef.current.get(id)
      const nextRect = nextRects.get(id)
      if (!node || !prevRect || !nextRect) return
      const deltaX = prevRect.left - nextRect.left
      const deltaY = prevRect.top - nextRect.top
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return
      node.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0px, 0px)' },
        ],
        {
          duration: 220,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      )
    })

    quickCardPrevRectsRef.current = nextRects
  }, [quickState.active])

  useEffect(() => {
    async function load() {
      const [friends, upcoming, prefs] = await Promise.all([
        api('/api/friends'),
        api('/api/home/upcoming-schedules?days=5'),
        api('/api/preferences').catch(() => ({})),
      ])
      let pendingMaterialsRequesterCount = 0
      try {
        if (!employeeRestricted && Number(currentUser?.grade || 6) <= 2) {
          const materials = await api('/api/materials/overview')
          pendingMaterialsRequesterCount = Array.isArray(materials?.pending_requests) ? materials.pending_requests.length : 0
        }
      } catch (_) {}
      setHomePrefs({ quickListMode: !!prefs?.quickListMode })
      setSummary({
        friendCount: friends.friends.length,
        requestCount: friends.received_requests.length,
        pendingMaterialsRequesterCount,
        upcomingCount: (upcoming.days || []).reduce((acc, day) => acc + (day.items?.length || 0), 0),
        upcomingDays: upcoming.days || [],
        upcomingItems: (upcoming.days || []).flatMap(day => (day.items || []).map((item, index) => ({ ...item, dayDate: day.date, dayLabel: day.label, sortKey: `${day.date}-${String(index).padStart(3, '0')}` }))).sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey))),
      })
    }
    load().catch(() => {})
  }, [])

  useEffect(() => {
    setQuickState(getQuickActionState(currentUser?.id))
    setHomeSettings(getHomeSettings(currentUser?.id))
    setHomePrefs({ quickListMode: false })
  }, [currentUser?.id])

  useEffect(() => {
    let ignore = false
    async function loadWorkdayStatus() {
      try {
        const response = await api('/api/workday/status')
        if (ignore) return
        const item = response?.today || null
        setWorkdayStatus(response || null)
        if (item) {
          const savedHomeSettings = getHomeSettings(currentUser?.id)
          updateHomeSettings({
            ...savedHomeSettings,
            activeWorkState: {
              started: !!response?.active,
              updatedAt: item.updated_at || item.ended_at || item.started_at || '',
              startTime: item.start_time || '',
              endTime: item.end_time || '',
              workDate: item.work_date || '',
            },
          })
        }
      } catch (_) {}
    }
    loadWorkdayStatus()
    return () => {
      ignore = true
    }
  }, [currentUser?.id])

  useEffect(() => {
    const activeState = homeSettings.activeWorkState
    if (!activeState?.started || !activeState?.workDate || !activeState?.startTime) {
      const latest = workdayStatus?.today
      if (latest?.start_time && latest?.end_time) {
        const [sh, sm] = String(latest.start_time).split(':').map(Number)
        const [eh, em] = String(latest.end_time).split(':').map(Number)
        if (Number.isFinite(sh) && Number.isFinite(sm) && Number.isFinite(eh) && Number.isFinite(em)) {
          setElapsedSeconds(Math.max(0, (eh * 60 + em) - (sh * 60 + sm)) * 60)
          return
        }
      }
      setElapsedSeconds(0)
      return
    }
    const tick = () => {
      const startAt = new Date(`${activeState.workDate}T${activeState.startTime}:00`)
      const diff = Math.max(0, Math.floor((Date.now() - startAt.getTime()) / 1000))
      setElapsedSeconds(diff)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [homeSettings.activeWorkState, workdayStatus])

  function formatElapsed(totalSeconds) {
    const safe = Math.max(0, Number(totalSeconds) || 0)
    const hours = String(Math.floor(safe / 3600)).padStart(2, '0')
    const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0')
    const seconds = String(safe % 60).padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }

  function clearQuickDragHoldTimer() {
    if (quickDragHoldTimerRef.current) {
      window.clearTimeout(quickDragHoldTimerRef.current)
      quickDragHoldTimerRef.current = null
    }
  }

  function armQuickDrag(quickId) {
    if (!quickId) return
    setDragReadyQuickId(quickId)
    setDraggingQuickId(quickId)
    setDragOverQuickId(quickId)
    quickTouchStateRef.current = { ...quickTouchStateRef.current, active: true, armed: true, quickId }
    quickDragSuppressClickRef.current = true
  }

  function startQuickDragHold(quickId) {
    clearQuickDragHoldTimer()
    setDragReadyQuickId('')
    quickDragHoldTimerRef.current = window.setTimeout(() => {
      armQuickDrag(quickId)
      quickDragHoldTimerRef.current = null
    }, QUICK_DRAG_HOLD_MS)
  }

  async function handleWorkdayToggleAction() {
    if (!homeSettings.workday.enabled) return
    const nextAction = homeSettings.activeWorkState?.started ? 'end' : 'start'
    try {
      const response = await api('/api/workday/toggle', { method: 'POST', body: JSON.stringify({ action: nextAction }) })
      const item = response?.item || {}
      const nextState = {
        ...homeSettings,
        activeWorkState: {
          started: nextAction === 'start',
          updatedAt: item.updated_at || item.ended_at || item.started_at || new Date().toISOString(),
          startTime: item.start_time || '',
          endTime: item.end_time || '',
          workDate: item.work_date || '',
        },
      }
      updateHomeSettings(nextState)
      setWorkdayStatus({ active: nextAction === 'start', today: item })
      window.alert(nextAction === 'start' ? '일시작 처리되었습니다.' : '일종료 처리되었습니다.')
    } catch (err) {
      window.alert(err.message || '일시작/일종료 저장 중 오류가 발생했습니다.')
    }
  }

  function handleWorkdayDoubleClickLike() {
    const now = Date.now()
    if (now - Number(workdayTapRef.current.lastAt || 0) <= 350) {
      workdayTapRef.current.lastAt = 0
      handleWorkdayToggleAction()
      return
    }
    workdayTapRef.current.lastAt = now
  }

  function updateQuickState(nextState) {
    setQuickState(nextState)
    saveQuickActionState(currentUser?.id, nextState)
  }

  function updateHomeSettings(nextState) {
    setHomeSettings(nextState)
    saveHomeSettings(currentUser?.id, nextState)
  }

  function moveHomeSection(sectionId, direction) {
    const order = [...homeSettings.sectionOrder]
    const index = order.indexOf(sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    updateHomeSettings({ ...homeSettings, sectionOrder: order })
  }

  function startHoldAction() {
    setHoldProgress(true)
  }

  function stopHoldAction() {
    setHoldProgress(false)
  }

  function moveQuickAction(index, direction) {
    const next = [...quickState.active]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    updateQuickState({ ...quickState, active: next })
  }

  function reorderQuickActionsById(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return
    const next = [...quickState.active]
    const fromIndex = next.indexOf(draggedId)
    const toIndex = next.indexOf(targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    updateQuickState({ ...quickState, active: next })
  }

  function swapQuickActionsById(firstId, secondId) {
    if (!firstId || !secondId || firstId === secondId) return
    const next = [...quickState.active]
    const firstIndex = next.indexOf(firstId)
    const secondIndex = next.indexOf(secondId)
    if (firstIndex < 0 || secondIndex < 0) return
    ;[next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]]
    updateQuickState({ ...quickState, active: next })
  }

  function archiveQuickAction(id) {
    updateQuickState({ active: quickState.active.filter(item => item !== id), archived: [...quickState.archived, id] })
  }

  function restoreQuickAction(id) {
    if (quickState.active.length >= QUICK_ACTION_LIMIT) {
      window.alert(`빠른 확인은 최대 ${QUICK_ACTION_LIMIT}개까지 배치할 수 있습니다.`)
      return
    }
    updateQuickState({ active: [...quickState.active, id], archived: quickState.archived.filter(item => item !== id) })
  }

  function handleQuickActionClick(item) {
    if (isQuickActionPreparingLockedForUser(currentUser, item.id)) {
      window.alert('준비 중입니다.')
      return
    }
    if (item.kind === 'placeholder') return
    if (item.path?.includes('?')) {
      navigate(item.path)
      return
    }
    if (item.path) {
      navigate(item.path)
      return
    }
    window.alert(`${item.label} 기능은 다음 업데이트에서 연결할 예정입니다.`)
  }

  function resetQuickDragState() {
    clearQuickDragHoldTimer()
    setDraggingQuickId('')
    setDragOverQuickId('')
    setDragReadyQuickId('')
    quickTouchStateRef.current = { active: false, armed: false, quickId: '', moved: false }
  }

  function handleQuickDragStart(quickId) {
    armQuickDrag(quickId)
  }

  function handleQuickMouseRelease(quickId) {
    clearQuickDragHoldTimer()
    const currentQuickId = draggingQuickId || dragReadyQuickId || quickTouchStateRef.current.quickId
    if (currentQuickId && (!quickId || currentQuickId === quickId)) {
      window.setTimeout(() => {
        quickDragSuppressClickRef.current = false
      }, 160)
      resetQuickDragState()
    }
  }

  function handleQuickDragEnter(quickId) {
    if (!draggingQuickId || !quickId || draggingQuickId === quickId) return
    setDragOverQuickId(quickId)
  }

  function handleQuickDrop(quickId) {
    const draggedId = draggingQuickId || quickTouchStateRef.current.quickId
    if (!draggedId || !quickId) {
      resetQuickDragState()
      return
    }
    swapQuickActionsById(draggedId, quickId)
    resetQuickDragState()
  }

  function handleQuickTouchStart(event, quickId) {
    quickTouchStateRef.current = {
      active: true,
      armed: false,
      quickId,
      moved: false,
      startX: event.touches?.[0]?.clientX ?? 0,
      startY: event.touches?.[0]?.clientY ?? 0,
    }
    startQuickDragHold(quickId)
  }

  function handleQuickTouchMove(event) {
    const current = quickTouchStateRef.current
    if (!current?.active) return
    const touch = event.touches?.[0]
    if (!touch) return
    const dx = Math.abs((touch.clientX ?? 0) - (current.startX ?? 0))
    const dy = Math.abs((touch.clientY ?? 0) - (current.startY ?? 0))
    if (!current.armed && (dx > 6 || dy > 6)) {
      clearQuickDragHoldTimer()
      quickTouchStateRef.current = { active: false, armed: false, quickId: '', moved: false }
      return
    }
    if (!current.armed) return
    event.preventDefault()
    if (dx > 6 || dy > 6) {
      current.moved = true
      quickDragSuppressClickRef.current = true
    }
    const element = document.elementFromPoint(touch.clientX, touch.clientY)
    const quickTarget = element?.closest?.('[data-quick-id]')
    const quickId = quickTarget?.dataset?.quickId || ''
    if (quickId && quickId !== dragOverQuickId) setDragOverQuickId(quickId)
  }

  function handleQuickTouchEnd() {
    const current = quickTouchStateRef.current
    clearQuickDragHoldTimer()
    if (current?.armed && current?.moved && current.quickId && dragOverQuickId && current.quickId !== dragOverQuickId) {
      swapQuickActionsById(current.quickId, dragOverQuickId)
    }
    window.setTimeout(() => {
      quickDragSuppressClickRef.current = false
    }, 160)
    resetQuickDragState()
  }

  function handleQuickTouchCancel() {
    clearQuickDragHoldTimer()
    window.setTimeout(() => {
      quickDragSuppressClickRef.current = false
    }, 160)
    resetQuickDragState()
  }

  const quickLibrary = useMemo(() => {
    let base = [...QUICK_ACTION_LIBRARY]
    base = base.filter(item => {
      if (isQuickActionPreparingLockedForUser(currentUser, item.id)) return true
      if (item.adminOnly && Number(currentUser?.grade || 6) > 2) return false
      if (item.path) return canUserAccessPath(currentUser, item.path, menuPermissions, menuLocks)
      if (item.id === 'point') return canUserAccessPath(currentUser, '/points', menuPermissions, menuLocks)
      if (item.id === 'warehouse') return canUserAccessPath(currentUser, '/warehouse', menuPermissions, menuLocks)
      if (item.id === 'storageStatus') return canUserAccessPath(currentUser, '/storage-status', menuPermissions, menuLocks)
      if (item.id === 'settlements') return canUserAccessPath(currentUser, '/settlements', menuPermissions, menuLocks)
      return true
    })
    if (employeeRestricted) {
      const hiddenQuickIds = new Set(['materials', 'materialsBuy', 'materialsRequesters', 'materialsSettlement', 'settlements'])
      base = base.filter(item => isQuickActionPreparingLockedForUser(currentUser, item.id) || !hiddenQuickIds.has(item.id))
    }
    return base
  }, [employeeRestricted, currentUser, menuLocks, menuPermissions])

  const activeQuickItems = useMemo(() => {
    const activeIds = [...quickState.active].filter(id => quickLibrary.some(item => item.id === id))
    if (Number(currentUser?.grade || 6) <= 2) {
      ADMIN_EXTRA_QUICK_ACTION_IDS.forEach(id => {
        if (quickLibrary.some(item => item.id === id) && !activeIds.includes(id)) activeIds.push(id)
      })
    }
    return activeIds.slice(0, QUICK_ACTION_LIMIT).map(id => quickLibrary.find(item => item.id === id)).filter(Boolean)
  }, [quickState.active, quickLibrary, currentUser?.grade])
  const archivedQuickItems = useMemo(() => quickState.archived.map(id => quickLibrary.find(item => item.id === id)).filter(Boolean), [quickState.archived, quickLibrary])

  const homeSections = useMemo(() => {
    const sections = {
      quick: (
        <section className="card" key="quick">
          <div className="between quick-check-head">
            <h2>빠른 확인</h2>
            <div className="inline-actions wrap">
              <div className="dropdown-wrap">
                <button type="button" className="small ghost" onClick={() => setHomeSettingsOpen(v => !v)}>설정</button>
                {homeSettingsOpen && (
                  <div className="dropdown-menu right home-settings-menu">
                    <div className="menu-category-block">
                      <button
                        type="button"
                        className={`menu-category-title menu-category-title-button ${quickLayoutOpen ? 'is-open' : ''}`.trim()}
                        onClick={() => setQuickLayoutOpen(v => !v)}
                      >
                        배열변경
                      </button>
                      {quickLayoutOpen && (
                        <div className="stack compact quick-layout-panel">
                          <div className="quick-layout-group-label">[배열로 변경]</div>
                          {QUICK_LAYOUT_OPTIONS.filter(option => option.previewType === 'grid').map(option => (
                            <div key={`layout-option-${option.id}`} className="quick-edit-row quick-layout-row">
                              <button type="button" className={`small ${homeSettings.quickLayout === option.id ? '' : 'ghost'}`.trim()} onClick={() => updateHomeSettings({ ...homeSettings, quickLayout: option.id })}>[{option.label}]</button>
                              <button type="button" className="small ghost" onClick={() => setQuickLayoutPreview(option.id)}>미리보기</button>
                            </div>
                          ))}
                          <div className="quick-layout-group-label">[목록형으로 변경]</div>
                          {QUICK_LAYOUT_OPTIONS.filter(option => option.previewType === 'list').map(option => (
                            <div key={`layout-option-${option.id}`} className="quick-edit-row quick-layout-row">
                              <button type="button" className={`small ${homeSettings.quickLayout === option.id ? '' : 'ghost'}`.trim()} onClick={() => updateHomeSettings({ ...homeSettings, quickLayout: option.id })}>[{option.label}]</button>
                              <button type="button" className="small ghost" onClick={() => setQuickLayoutPreview(option.id)}>미리보기</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="small ghost" onClick={() => setEditingQuick(v => !v)}>{editingQuick ? '편집닫기' : '편집'}</button>
            </div>
          </div>
          {homeSettings.quickLayout === 'list' ? (
            <div className="quick-check-list" role="list">
              {activeQuickItems.map(item => {
                const preparingLocked = isQuickActionPreparingLockedForUser(currentUser, item.id)
                const isDisabled = item.kind === 'placeholder' || preparingLocked
                const badgeCount = preparingLocked ? 0 : getQuickActionListBadgeCount(item, summary)
                const labelText = String((item.id === 'materials' ? '자재 신청현황' : item.label) || '').replace(/\n/g, ' ')
                const detailText = preparingLocked ? '준비중' : getQuickActionListDetail(item, summary, currentUser)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`quick-check-list-row ${isDisabled ? 'quick-check-card-disabled' : ''}`.trim()}
                    onClick={() => handleQuickActionClick(item)}
                    disabled={isDisabled}
                  >
                    <span className="quick-check-list-title">{labelText}</span>
                    <span className="quick-check-list-detail">{detailText}</span>
                    <strong className="quick-check-list-badge">{badgeCount}</strong>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={`quick-check-grid quick-check-grid-layout-${homeSettings.quickLayout || '5x5'}`.trim()}>
              {activeQuickItems.map(item => {
                const preparingLocked = isQuickActionPreparingLockedForUser(currentUser, item.id)
                const topText = preparingLocked
                  ? '준비중'
                  : item.kind === 'metric'
                    ? String(summary?.[item.metricKey] ?? 0)
                    : (item.kind === 'placeholder' ? '준비중' : '')
                const isDisabled = item.kind === 'placeholder' || preparingLocked
                const labelText = item.id === 'materials' ? '자재\n신청현황' : String(item.label || '')
                const isDraggingCard = draggingQuickId === item.id
                const isDropTarget = dragOverQuickId === item.id && draggingQuickId && draggingQuickId !== item.id
                const isDragReady = dragReadyQuickId === item.id
                return (
                  <button
                    key={item.id}
                    ref={node => {
                      if (node) quickCardRefs.current.set(item.id, node)
                      else quickCardRefs.current.delete(item.id)
                    }}
                    data-quick-id={item.id}
                    draggable={dragReadyQuickId === item.id}
                    type="button"
                    className={`quick-check-card quick-check-draggable ${isDisabled ? 'quick-check-card-disabled' : ''}${isDragReady ? ' drag-ready' : ''}${isDraggingCard ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`.trim()}
                    onMouseDown={() => startQuickDragHold(item.id)}
                    onMouseUp={() => handleQuickMouseRelease(item.id)}
                    onMouseLeave={clearQuickDragHoldTimer}
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', item.id)
                      handleQuickDragStart(item.id)
                    }}
                    onDragEnter={() => handleQuickDragEnter(item.id)}
                    onDragOver={event => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      handleQuickDragEnter(item.id)
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      handleQuickDrop(item.id)
                    }}
                    onDragEnd={resetQuickDragState}
                    onTouchStart={event => handleQuickTouchStart(event, item.id)}
                    onTouchMove={handleQuickTouchMove}
                    onTouchEnd={handleQuickTouchEnd}
                    onTouchCancel={handleQuickTouchCancel}
                    onClick={() => {
                      if (quickDragSuppressClickRef.current) return
                      handleQuickActionClick(item)
                    }}
                    disabled={isDisabled}
                  >
                    <span className="quick-check-drag-badge" aria-hidden="true">⋮⋮</span>
                    {topText ? <strong>{topText}</strong> : null}
                    <span style={item.multiline || labelText.includes('\n') ? { whiteSpace: 'pre-line' } : undefined}>{labelText}</span>
                  </button>
                )
              })}
            </div>
          )}
          {quickLayoutPreview && (
            <div className="quick-layout-preview-backdrop" onClick={() => setQuickLayoutPreview('')}>
              <div className="card quick-layout-preview-modal" onClick={event => event.stopPropagation()}>
                <div className="between">
                  <strong>{QUICK_LAYOUT_OPTIONS.find(option => option.id === quickLayoutPreview)?.label || '미리보기'}</strong>
                  <button type="button" className="small ghost" onClick={() => setQuickLayoutPreview('')}>닫기</button>
                </div>
                {QUICK_LAYOUT_OPTIONS.find(option => option.id === quickLayoutPreview)?.previewType === 'list' ? (
                  <div className="quick-layout-preview-list">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div key={`list-preview-${index}`} className="quick-layout-preview-list-row">
                        <strong>[기능이름]</strong>
                        <span>[설명]</span>
                        <em>[비고]</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="quick-layout-preview-grid"
                    style={{ gridTemplateColumns: `repeat(${QUICK_LAYOUT_OPTIONS.find(option => option.id === quickLayoutPreview)?.columns || 3}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: Math.pow(QUICK_LAYOUT_OPTIONS.find(option => option.id === quickLayoutPreview)?.columns || 3, 2) }).map((_, index) => (
                      <div key={`grid-preview-${index}`} className="quick-layout-preview-cell">[버튼]</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {editingQuick && (
            <div className="quick-check-editor card inset-card">
              <strong>빠른 확인 편집</strong>
              <div className="stack compact">
                {activeQuickItems.map((item, index) => (
                  <div key={`active-${item.id}`} className="quick-edit-row">
                    <span>{String(item.label || '').replace('\n', ' ')}</span>
                    <div className="inline-actions wrap end">
                      <button type="button" className="small ghost" onClick={() => moveQuickAction(index, -1)}>위로</button>
                      <button type="button" className="small ghost" onClick={() => moveQuickAction(index, 1)}>아래로</button>
                      <button type="button" className="small ghost" onClick={() => archiveQuickAction(item.id)}>보관</button>
                    </div>
                  </div>
                ))}
                {activeQuickItems.length === 0 && <div className="muted">배치된 버튼이 없습니다.</div>}
              </div>
              <div className="friends-section-label">보관함</div>
              <div className="stack compact">
                {archivedQuickItems.map(item => (
                  <div key={`archived-${item.id}`} className="quick-edit-row">
                    <span>{String(item.label || '').replace('\n', ' ')}</span>
                    <button type="button" className="small" onClick={() => restoreQuickAction(item.id)}>추가</button>
                  </div>
                ))}
                {archivedQuickItems.length === 0 && <div className="muted">보관된 버튼이 없습니다.</div>}
              </div>
            </div>
          )}
        </section>
      ),
      workday: null,
      upcoming: (
        <section className="card home-upcoming-card" key="upcoming">
          <div className="between"><h2>다가오는 일정</h2><Link to="/work-schedule" className="ghost-link">스케줄로 이동</Link></div>
          <div className="list upcoming-schedule-list compact-home-list">
            {(summary?.upcomingItems || []).map((item, index) => (
              <div className="list-item block upcoming-day-group compact-item" key={`${item.dayDate}-${index}`}>
                <strong>[{item.dayLabel}] [{item.time_text}] [{item.customer_name}]</strong>
                <div className="upcoming-line compact-line">[{item.representative_text}] [{item.staff_text}] [{item.start_address}]</div>
              </div>
            ))}
            {summary && (summary.upcomingItems || []).length === 0 && <div className="muted">내 계정에 배정된 5일 이내 스케줄이 없습니다.</div>}
            {!summary && <div className="muted">불러오는 중...</div>}
          </div>
        </section>
      ),
    }
    return homeSettings.sectionOrder.map(sectionId => sections[sectionId]).filter(Boolean)
  }, [activeQuickItems, archivedQuickItems, currentUser?.grade, editingQuick, employeeRestricted, holdProgress, homePrefs.quickListMode, homeSettings, homeSettingsOpen, quickState.active, summary])

  return (
    <div className="stack-page home-page">
      {homeSections}
    </div>
  )
}

function ProfilePage({ onUserUpdate }) {
  const [form, setForm] = useState(null)
  const [originalForm, setOriginalForm] = useState(null)
  const [message, setMessage] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const branchOptions = BRANCH_NUMBER_OPTIONS

  useEffect(() => {
    api('/api/profile').then(data => {
      const nextForm = { ...data.user, new_password: '' }
      setForm(nextForm)
      setOriginalForm(nextForm)
    })
  }, [])

  if (!form) return <div className="card">불러오는 중...</div>

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function profileFieldValueLabel(key, value) {
    if (key === 'branch_no') {
      return branchOptions.find(option => Number(option.value) === Number(normalizeBranchNo(value)))?.label || String(value || '-')
    }
    if (key === 'birth_year') return String(value || '')
    if (key === 'interests') {
      if (Array.isArray(value)) return value.join(', ') || '-'
      return String(value || '').trim() || '-'
    }
    return String(value ?? '').trim() || '-'
  }

  function buildProfileChangeSummary(payload) {
    const source = originalForm || {}
    const rows = []
    const fieldLabels = [
      ['login_id', '아이디'],
      ['nickname', '닉네임'],
      ['phone', '연락처'],
      ['recovery_email', '복구이메일'],
      ['region', '지역'],
      ['gender', '성별'],
      ['birth_year', '출생연도'],
      ['vehicle_number', '차량번호'],
      ['branch_no', '호점'],
      ['marital_status', '결혼여부'],
      ['resident_address', '주민등록주소'],
      ['business_name', '상호'],
      ['business_number', '사업자번호'],
      ['business_type', '업태'],
      ['business_item', '종목'],
      ['business_address', '사업장주소'],
      ['bank_name', '은행명'],
      ['bank_account', '계좌번호'],
      ['mbti', 'MBTI'],
      ['google_email', '구글이메일'],
      ['resident_id', '주민번호'],
      ['one_liner', '한줄소개'],
      ['bio', '프로필소개'],
      ['photo_url', '프로필이미지URL'],
      ['interests', '관심사'],
    ]
    for (const [key, label] of fieldLabels) {
      const beforeValue = key === 'branch_no' ? normalizeBranchNo(source[key]) : source[key]
      const afterValue = key === 'branch_no' ? normalizeBranchNo(payload[key]) : payload[key]
      const beforeLabel = profileFieldValueLabel(key, beforeValue)
      const afterLabel = profileFieldValueLabel(key, afterValue)
      if (beforeLabel !== afterLabel) {
        rows.push(`- ${label}를 [${beforeLabel}]에서 [${afterLabel}]로 변경합니다.`)
      }
    }
    if (String(payload.new_password || '').trim()) {
      rows.push(`- 비밀번호를 [현재 값 확인 불가]에서 [${String(payload.new_password)}]로 변경합니다.`)
    }
    return rows
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      login_id: normalizeFlexibleLoginId(form.login_id || ''),
      email: normalizeFlexibleLoginId(form.login_id || ''),
      nickname: form.nickname || '',
      region: form.region || '서울',
      bio: form.bio || '',
      one_liner: form.one_liner || '',
      interests: Array.isArray(form.interests)
        ? form.interests
        : String(form.interests || '').split(',').map(v => v.trim()).filter(Boolean),
      photo_url: form.photo_url || '',
      phone: form.phone || '',
      recovery_email: form.recovery_email || '',
      gender: form.gender || '',
      birth_year: Number(form.birth_year || 1990),
      vehicle_number: form.vehicle_number || '',
      branch_no: normalizeBranchNo(form.branch_no),
      marital_status: form.marital_status || '',
      resident_address: form.resident_address || '',
      business_name: form.business_name || '',
      business_number: form.business_number || '',
      business_type: form.business_type || '',
      business_item: form.business_item || '',
      business_address: form.business_address || '',
      bank_account: form.bank_account || '',
      bank_name: form.bank_name || '',
      mbti: form.mbti || '',
      google_email: form.google_email || '',
      resident_id: form.resident_id || '',
      new_password: form.new_password || '',
    }
    const changeSummary = buildProfileChangeSummary(payload)
    if (!changeSummary.length) {
      setMessage('변경된 항목이 없습니다.')
      return
    }
    const confirmed = window.confirm(`아래 내용으로 프로필을 변경하시겠습니까?\n\n${changeSummary.join('\n')}`)
    if (!confirmed) return
    const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    const nextForm = { ...data.user, new_password: '' }
    setForm(nextForm)
    setOriginalForm(nextForm)
    onUserUpdate(data.user)
    setMessage('프로필이 저장되었습니다.')
  }

  async function saveLocation() {
    const data = await api('/api/profile/location', {
      method: 'POST',
      body: JSON.stringify({ latitude: Number(form.latitude), longitude: Number(form.longitude), region: form.region }),
    })
    setForm(prev => ({ ...data.user, new_password: prev.new_password || '' }))
    onUserUpdate(data.user)
    setMessage('위치가 저장되었습니다.')
  }

  async function handleProfilePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    setMessage('')
    try {
      const uploaded = await uploadFile(file, 'profile')
      setForm(prev => ({ ...prev, photo_url: uploaded.url }))
      setMessage('프로필 이미지가 업로드되었습니다. 저장 버튼을 눌러 반영하세요.')
    } catch (err) {
      setMessage(err.message)
    } finally {
      setUploadingPhoto(false)
      e.target.value = ''
    }
  }

  return (
    <div className="card profile-page-card">
      <div className="profile-header">
        <div>
          <h2>프로필</h2>
          <div className="muted">설정 &gt; 프로필에서 계정 정보를 수정할 수 있습니다.</div>
        </div>
        <div className="profile-badges">
          <span className="profile-badge">{form.grade_label || '일반'}</span>
          <span className="profile-badge ghost">{branchDisplayLabel(form.branch_no, '본점/미지정')}</span>
        </div>
      </div>

      <form onSubmit={save} className="profile-form-layout">
        <section className="profile-section">
          <h3>기본 계정 정보</h3>
          <div className="profile-grid two">
            <label className="field-block">
              <span>아이디</span>
              <input value={form.login_id || ''} onChange={e => updateField('login_id', normalizeFlexibleLoginId(e.target.value))} placeholder="아이디" />
            </label>
            <label className="field-block">
              <span>새 비밀번호</span>
              <input type="password" value={form.new_password || ''} onChange={e => updateField('new_password', e.target.value)} placeholder="변경 시에만 입력" />
            </label>
            <label className="field-block">
              <span>이름</span>
              <input value={form.nickname || ''} onChange={e => updateField('nickname', e.target.value)} placeholder="이름" />
            </label>
            <label className="field-block">
              <span>직급</span>
              <select value={form.position_title || ''} disabled className="readonly-input">
                <option value="">미지정</option>
                {POSITION_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="field-block">
              <span>권한</span>
              <input value={form.grade_label || ''} readOnly className="readonly-input" />
            </label>
            <label className="field-block">
              <span>호점</span>
              <select value={isAssignedBranchNo(form.branch_no) ? String(form.branch_no) : ''} onChange={e => updateField('branch_no', e.target.value)} disabled={Number(form.grade || 6) !== 1} className={Number(form.grade || 6) !== 1 ? 'readonly-input' : ''}>
                <option value="">본점 또는 미지정</option>
                {branchOptions.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
              </select>
            </label>
            <label className="field-block">
              <span>연락처</span>
              <input value={form.phone || ''} onChange={e => updateField('phone', e.target.value)} placeholder="연락처" />
            </label>
            <label className="field-block">
              <span>복구 이메일</span>
              <input value={form.recovery_email || ''} onChange={e => updateField('recovery_email', e.target.value)} placeholder="복구 이메일" />
            </label>
            <label className="field-block">
              <span>구글 아이디</span>
              <input value={form.google_email || ''} onChange={e => updateField('google_email', e.target.value)} placeholder="구글 아이디" />
            </label>
          </div>
        </section>

        <section className="profile-section">
          <h3>개인 정보</h3>
          <div className="profile-grid three">
            <label className="field-block">
              <span>생년월일</span>
              <input value={form.resident_id || ''} onChange={e => updateField('resident_id', e.target.value)} placeholder="예: 950109" />
            </label>
            <label className="field-block">
              <span>출생연도</span>
              <input type="number" value={form.birth_year || 1990} onChange={e => updateField('birth_year', Number(e.target.value))} placeholder="출생연도" />
            </label>
            <label className="field-block">
              <span>결혼</span>
              <input value={form.marital_status || ''} onChange={e => updateField('marital_status', e.target.value)} placeholder="결혼 여부" />
            </label>
            <label className="field-block">
              <span>성별</span>
              <select value={form.gender || ''} onChange={e => updateField('gender', e.target.value)}><option value="">성별 선택</option>{GENDER_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select>
            </label>
            <label className="field-block">
              <span>MBTI</span>
              <input value={form.mbti || ''} onChange={e => updateField('mbti', e.target.value)} placeholder="MBTI" />
            </label>
            <label className="field-block">
              <span>지역</span>
              <input value={form.region || ''} onChange={e => updateField('region', e.target.value)} placeholder="지역" />
            </label>
          </div>
          <label className="field-block">
            <span>집주소</span>
            <textarea rows={3} value={form.resident_address || ''} onChange={e => updateField('resident_address', e.target.value)} placeholder="집주소" />
          </label>
        </section>

        <section className="profile-section">
          <h3>사업자 정보</h3>
          <div className="profile-grid two">
            <label className="field-block">
              <span>상호명</span>
              <input value={form.business_name || ''} onChange={e => updateField('business_name', e.target.value)} placeholder="상호명" />
            </label>
            <label className="field-block">
              <span>사업자 등록번호</span>
              <input value={form.business_number || ''} onChange={e => updateField('business_number', e.target.value)} placeholder="사업자 등록번호" />
            </label>
            <label className="field-block">
              <span>업태</span>
              <textarea rows={3} value={form.business_type || ''} onChange={e => updateField('business_type', e.target.value)} placeholder="업태" />
            </label>
            <label className="field-block">
              <span>종목</span>
              <textarea rows={3} value={form.business_item || ''} onChange={e => updateField('business_item', e.target.value)} placeholder="종목" />
            </label>
            <label className="field-block">
              <span>차량 번호</span>
              <input value={form.vehicle_number || ''} onChange={e => updateField('vehicle_number', e.target.value)} placeholder="차량 번호" />
            </label>
            <label className="field-block">
              <span>은행</span>
              <input value={form.bank_name || ''} onChange={e => updateField('bank_name', e.target.value)} placeholder="은행" />
            </label>
            <label className="field-block">
              <span>계좌번호</span>
              <input value={form.bank_account || ''} onChange={e => updateField('bank_account', e.target.value)} placeholder="계좌번호" />
            </label>
            <label className="field-block">
              <span>한줄 소개</span>
              <input value={form.one_liner || ''} onChange={e => updateField('one_liner', e.target.value)} placeholder="한줄 소개" />
            </label>
          </div>
          <label className="field-block">
            <span>사업장 소재지</span>
            <textarea rows={3} value={form.business_address || ''} onChange={e => updateField('business_address', e.target.value)} placeholder="사업장 소재지" />
          </label>
        </section>

        <section className="profile-section">
          <h3>프로필 표시 정보</h3>
          <div className="profile-grid photo">
            <label className="field-block">
              <span>프로필 소개</span>
              <textarea rows={4} value={form.bio || ''} onChange={e => updateField('bio', e.target.value)} placeholder="프로필 소개" />
            </label>
            <label className="field-block">
              <span>관심사</span>
              <input value={Array.isArray(form.interests) ? form.interests.join(', ') : form.interests || ''} onChange={e => updateField('interests', e.target.value)} placeholder="관심사 (쉼표로 구분)" />
            </label>
            <label className="field-block">
              <span>프로필 이미지 URL</span>
              <input value={form.photo_url || ''} onChange={e => updateField('photo_url', e.target.value)} placeholder="프로필 이미지 URL" />
            </label>
            <label className="field-block">
              <span>프로필 이미지 업로드</span>
              <input type="file" accept="image/*" onChange={handleProfilePhotoUpload} disabled={uploadingPhoto} />
            </label>
            <label className="field-block">
              <span>위도</span>
              <input value={form.latitude || ''} onChange={e => updateField('latitude', e.target.value)} placeholder="위도" />
            </label>
            <label className="field-block">
              <span>경도</span>
              <input value={form.longitude || ''} onChange={e => updateField('longitude', e.target.value)} placeholder="경도" />
            </label>
          </div>
        </section>

        <div className="profile-actions">
          <button type="submit">프로필 저장</button>
          <button type="button" className="ghost" onClick={saveLocation}>위치 저장</button>
        </div>
        {message && <div className="success">{message}</div>}
      </form>
    </div>
  )
}

function FriendsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [users, setUsers] = useState([])
  const [data, setData] = useState({ friends: [], received_requests: [], sent_requests: [] })
  const [profile, setProfile] = useState(null)
  const [follows, setFollows] = useState([])
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [addSearchMode, setAddSearchMode] = useState('nickname')
  const [addSearchText, setAddSearchText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const currentUser = getStoredUser()
  const [groupState, setGroupState] = useState(() => getFriendGroupState(currentUser?.id))
  const [selectedGroupCategoryId, setSelectedGroupCategoryId] = useState('all')
  const [openFriendMenuId, setOpenFriendMenuId] = useState(null)
  const [groupPicker, setGroupPicker] = useState({ open: false, friend: null })
  const [groupRenamePicker, setGroupRenamePicker] = useState({ open: false, mode: 'rename' })
  const [categoryEditor, setCategoryEditor] = useState({ open: false, mode: 'rename' })
  const [groupCreateModalOpen, setGroupCreateModalOpen] = useState(false)
  const [groupSectionMenuOpen, setGroupSectionMenuOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupCategoryId, setNewGroupCategoryId] = useState('')
  const [editingGroupName, setEditingGroupName] = useState('')
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [editingGroupCategoryId, setEditingGroupCategoryId] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [profilePreview, setProfilePreview] = useState({ mode: '', friend: null, section: '' })
  const [profileEditForm, setProfileEditForm] = useState(null)
  const [myCoverUrl, setMyCoverUrl] = useState(() => loadProfileCover(getStoredUser()?.id))

  async function load() {
    const [u, f, me, followList] = await Promise.all([
      api('/api/users'),
      api('/api/friends'),
      api('/api/profile'),
      api('/api/follows'),
    ])
    setUsers(u)
    setData(f)
    setProfile(me.user)
    setFollows(followList)
  }

  useEffect(() => { load().catch(() => {}) }, [])
  useEffect(() => {
    const panelName = searchParams.get('panel') || ''
    if (panelName) setPanel(panelName)
  }, [searchParams])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 1400)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    setGroupState(getFriendGroupState(currentUser?.id))
    setSelectedGroupCategoryId('all')
  }, [currentUser?.id])

  async function doAction(fn, successText = '처리되었습니다.') {
    setMessage('')
    await fn()
    setMessage(successText)
    await load()
  }

  function saveGroupState(nextState) {
    setGroupState(nextState)
    saveFriendGroupState(currentUser?.id, nextState)
  }

  const followedIds = useMemo(() => new Set((follows || []).map(item => item.id)), [follows])
  const favorites = useMemo(() => data.friends.filter(friend => followedIds.has(friend.id)), [data.friends, followedIds])
  const normalizedQuery = searchText.trim().toLowerCase()
  const normalizedAddQuery = addSearchText.trim().toLowerCase()
  const filteredFriends = useMemo(() => {
    if (!normalizedQuery) return data.friends
    return data.friends.filter(friend => [friend.nickname, friend.one_liner, friend.region].join(' ').toLowerCase().includes(normalizedQuery))
  }, [data.friends, normalizedQuery])
  const candidateUsers = useMemo(() => {
    const friendIds = new Set(data.friends.map(item => item.id))
    const myId = currentUser?.id
    return users.filter(item => {
      if (friendIds.has(item.id) || item.id === myId) return false
      if (!normalizedAddQuery) return true
      const nicknameField = String(item.nickname || '').toLowerCase()
      const nameField = String(item.name || item.full_name || item.real_name || item.username || '').toLowerCase()
      return addSearchMode === 'name' ? nameField.includes(normalizedAddQuery) : nicknameField.includes(normalizedAddQuery)
    })
  }, [users, data.friends, currentUser?.id, normalizedAddQuery, addSearchMode])
  const receivedProfiles = useMemo(() => data.received_requests.map(req => ({ ...req, profile: users.find(item => item.id === req.requester_id) || {} })), [data.received_requests, users])
  const sentRequestIds = useMemo(() => new Set((data.sent_requests || []).filter(req => req.status === 'pending').map(req => req.target_user_id)), [data.sent_requests])
  const groupCategories = useMemo(() => (groupState.categories || []).map(category => ({ ...category, id: String(category.id) })), [groupState.categories])
  const groupedFriends = useMemo(() => (groupState.groups || []).map(group => ({
    ...group,
    id: String(group.id),
    category_id: String(group.category_id || ''),
    items: data.friends.filter(friend => String(groupState.assignments?.[friend.id] || '') === String(group.id)),
  })), [groupState, data.friends])
  const groupedFriendsFiltered = useMemo(() => {
    if (selectedGroupCategoryId === 'all') return groupedFriends
    if (selectedGroupCategoryId === 'uncategorized') return groupedFriends.filter(group => !String(group.category_id || '').trim())
    return groupedFriends.filter(group => String(group.category_id || '') === String(selectedGroupCategoryId))
  }, [groupedFriends, selectedGroupCategoryId])

  useEffect(() => {
    function closeMenus(event) {
      if (!event.target.closest('.dropdown-wrap.friend-inline-wrap')) setOpenFriendMenuId(null)
      if (!event.target.closest('.dropdown-wrap.friends-main-menu')) setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenus)
    document.addEventListener('touchstart', closeMenus)
    return () => {
      document.removeEventListener('mousedown', closeMenus)
      document.removeEventListener('touchstart', closeMenus)
    }
  }, [])

  function goDirectChat(targetId) {
    navigate(`/chats/direct/${targetId}`)
  }

  async function toggleFavorite(item) {
    const active = followedIds.has(item.id)
    if (active) {
      const ok = window.confirm('즐겨찾기를 해제하시겠습니까?')
      if (!ok) return
    }
    await api(`/api/follows/${item.id}`, { method: 'POST' })
    await load()
  }

  function openGroupPicker(item) {
    if (!(groupState.groups || []).length) {
      window.alert('먼저 메뉴에서 그룹을 추가해 주세요.')
      return
    }
    setSelectedGroupId(String(groupState.assignments?.[item.id] || ''))
    setGroupPicker({ open: true, friend: item })
    setOpenFriendMenuId(null)
  }

  function applyFriendGroup() {
    if (!groupPicker.friend) return
    const nextAssignments = { ...(groupState.assignments || {}) }
    if (!selectedGroupId) delete nextAssignments[groupPicker.friend.id]
    else nextAssignments[groupPicker.friend.id] = selectedGroupId
    saveGroupState({ ...groupState, assignments: nextAssignments })
    setGroupPicker({ open: false, friend: null })
  }

  async function removeFriend(item) {
    const ok = window.confirm(`${item.nickname || '회원'}님을 친구 목록에서 삭제하시겠습니까?`)
    if (!ok) return
    await api(`/api/friends/${item.id}`, { method: 'DELETE' })
    await load()
  }

  async function blockFriend(item) {
    const ok = window.confirm(`${item.nickname || '회원'}님을 차단하시겠습니까?`)
    if (!ok) return
    await api(`/api/block/${item.id}`, { method: 'POST', body: JSON.stringify({ reason: '친구 화면에서 차단' }) })
    await api(`/api/friends/${item.id}`, { method: 'DELETE' })
    await load()
  }

  function createGroup() {
    const name = window.prompt('새 그룹명을 입력하세요.')
    if (!name || !name.trim()) return
    const nextGroup = { id: `g${Date.now()}`, name: name.trim() }
    saveGroupState({ ...groupState, groups: [...(groupState.groups || []), nextGroup] })
  }

  function openGroupEditor(mode) {
    if (!(groupState.groups || []).length) {
      window.alert(mode === 'rename' ? '수정할 그룹이 없습니다.' : '삭제할 그룹이 없습니다.')
      return
    }
    const first = groupState.groups[0]
    setGroupRenamePicker({ open: true, mode })
    setSelectedGroupId(first?.id || '')
    setEditingGroupName(first?.name || '')
    setEditingGroupCategoryId(String(first?.category_id || ''))
    setMenuOpen(false)
    setGroupSectionMenuOpen(false)
  }

  function openCreateGroupModal() {
    setNewGroupName('')
    setNewGroupCategoryId('')
    setGroupCreateModalOpen(true)
    setMenuOpen(false)
    setGroupSectionMenuOpen(false)
  }

  function submitCreateGroup() {
    const name = newGroupName.trim()
    if (!name) {
      window.alert('그룹명을 입력해 주세요.')
      return
    }
    const nextGroup = { id: `g${Date.now()}`, name, category_id: String(newGroupCategoryId || '') }
    saveGroupState({
      ...groupState,
      groups: [...(groupState.groups || []), nextGroup],
    })
    setGroupCreateModalOpen(false)
    setNewGroupName('')
    setNewGroupCategoryId('')
  }

  function createCategory() {
    const name = window.prompt('새 카테고리명을 입력하세요.')
    if (!name || !name.trim()) return
    const nextCategory = { id: `c${Date.now()}`, name: name.trim() }
    saveGroupState({
      ...groupState,
      categories: [...(groupState.categories || []), nextCategory],
    })
    setMenuOpen(false)
    setGroupSectionMenuOpen(false)
  }

  function openCategoryEditor(mode) {
    if (!(groupState.categories || []).length) {
      window.alert(mode === 'rename' ? '수정할 카테고리가 없습니다.' : '삭제할 카테고리가 없습니다.')
      return
    }
    const first = groupState.categories[0]
    setCategoryEditor({ open: true, mode })
    setSelectedCategoryId(String(first?.id || ''))
    setEditingCategoryName(first?.name || '')
    setMenuOpen(false)
    setGroupSectionMenuOpen(false)
  }

  function submitCategoryEditor() {
    const target = (groupState.categories || []).find(category => String(category.id) === String(selectedCategoryId))
    if (!target) return
    if (categoryEditor.mode === 'rename') {
      const nextName = editingCategoryName.trim()
      if (!nextName) {
        window.alert('카테고리명을 입력해 주세요.')
        return
      }
      saveGroupState({
        ...groupState,
        categories: (groupState.categories || []).map(category => category.id === target.id ? { ...category, name: nextName } : category),
      })
    } else {
      saveGroupState({
        ...groupState,
        categories: (groupState.categories || []).filter(category => category.id !== target.id),
        groups: (groupState.groups || []).map(group => String(group.category_id || '') === String(target.id) ? { ...group, category_id: '' } : group),
      })
      if (String(selectedGroupCategoryId) === String(target.id)) setSelectedGroupCategoryId('all')
    }
    setCategoryEditor({ open: false, mode: 'rename' })
    setSelectedCategoryId('')
    setEditingCategoryName('')
  }

  function submitGroupEditor() {
    const target = groupState.groups.find(group => String(group.id) === String(selectedGroupId))
    if (!target) return
    if (groupRenamePicker.mode === 'rename') {
      const nextName = editingGroupName.trim()
      if (!nextName) {
        window.alert('그룹명을 입력해 주세요.')
        return
      }
      saveGroupState({ ...groupState, groups: groupState.groups.map(group => group.id === target.id ? { ...group, name: nextName } : group) })
    } else {
      const nextAssignments = { ...(groupState.assignments || {}) }
      Object.keys(nextAssignments).forEach(friendId => {
        if (String(nextAssignments[friendId]) === String(target.id)) delete nextAssignments[friendId]
      })
      saveGroupState({ groups: groupState.groups.filter(group => group.id !== target.id), assignments: nextAssignments })
    }
    setGroupRenamePicker({ open: false, mode: 'rename' })
    setSelectedGroupId('')
    setEditingGroupName('')
  }

  async function openMyProfileCard() {
    try {
      const data = await api('/api/profile')
      const me = data?.user || profile
      setProfilePreview({ mode: 'card', friend: { ...me, cover_url: loadProfileCover(me?.id) }, section: 'me' })
    } catch (error) {
      window.alert(error.message)
    }
  }

  function openMyProfileEditor() {
    const me = profilePreview.friend || profile
    if (!me) return
    setProfileEditForm({
      email: me.email || profile?.email || '',
      nickname: me.nickname || '',
      position_title: me.position_title || '',
      region: me.region || '서울',
      bio: me.bio || '',
      one_liner: me.one_liner || '',
      interests: Array.isArray(me.interests) ? me.interests : [],
      photo_url: me.photo_url || '',
      cover_url: loadProfileCover(me.id || profile?.id),
      phone: me.phone || '',
      recovery_email: me.recovery_email || '',
      gender: me.gender || '',
      birth_year: Number(me.birth_year || 1990),
      vehicle_number: me.vehicle_number || '',
      branch_no: me.branch_no ?? null,
      marital_status: me.marital_status || '',
      resident_address: me.resident_address || '',
      business_name: me.business_name || '',
      business_number: me.business_number || '',
      business_type: me.business_type || '',
      business_item: me.business_item || '',
      business_address: me.business_address || '',
      bank_account: me.bank_account || '',
      bank_name: me.bank_name || '',
      mbti: me.mbti || '',
      google_email: me.google_email || '',
      resident_id: me.resident_id || '',
      new_password: '',
    })
    setProfilePreview(prev => ({ ...prev, mode: 'edit' }))
  }

  async function updateMyProfileField(patch = {}) {
    const latest = await api('/api/profile')
    const base = latest?.user || profile
    const payload = {
      email: base?.email || '', nickname: base?.nickname || '', position_title: base?.position_title || '', region: base?.region || '서울',
      bio: base?.bio || '', one_liner: base?.one_liner || '', interests: Array.isArray(base?.interests) ? base.interests : [], photo_url: base?.photo_url || '',
      phone: base?.phone || '', recovery_email: base?.recovery_email || '', gender: base?.gender || '', birth_year: Number(base?.birth_year || 1990),
      vehicle_number: base?.vehicle_number || '', branch_no: base?.branch_no ?? null, marital_status: base?.marital_status || '', resident_address: base?.resident_address || '',
      business_name: base?.business_name || '', business_number: base?.business_number || '', business_type: base?.business_type || '', business_item: base?.business_item || '', business_address: base?.business_address || '',
      bank_account: base?.bank_account || '', bank_name: base?.bank_name || '', mbti: base?.mbti || '', google_email: base?.google_email || '', resident_id: base?.resident_id || '', new_password: '',
      ...patch,
    }
    const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    return result?.user
  }

  async function handleProfileImageUpload(kind, file) {
    if (!file) return
    const uploaded = await uploadFile(file, kind === 'cover' ? 'profile-cover' : 'profile-photo')
    const url = uploaded?.url || ''
    if (kind === 'cover') {
      saveProfileCover(profile?.id, url)
      setMyCoverUrl(url)
      setProfileEditForm(prev => prev ? { ...prev, cover_url: url } : prev)
      setProfilePreview(prev => prev?.friend ? { ...prev, friend: { ...prev.friend, cover_url: url } } : prev)
      return
    }
    const updatedUser = await updateMyProfileField({ photo_url: url, one_liner: profileEditForm?.one_liner ?? profile?.one_liner ?? '' })
    if (updatedUser) {
      setProfile(updatedUser)
      setProfileEditForm(prev => prev ? { ...prev, photo_url: updatedUser.photo_url || '' } : prev)
      setProfilePreview(prev => prev?.friend ? { ...prev, friend: { ...updatedUser, cover_url: loadProfileCover(updatedUser.id) } } : prev)
    }
  }

  async function saveMyProfileEditor() {
    if (!profileEditForm) return
    const { cover_url, ...payload } = profileEditForm
    const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    saveProfileCover(profile?.id, cover_url || '')
    setMyCoverUrl(cover_url || '')
    if (result?.user) {
      setProfile(result.user)
      setProfilePreview({ mode: 'card', friend: { ...result.user, cover_url: cover_url || '' }, section: 'me' })
      setProfileEditForm(null)
    }
  }

  function FriendRow({ item, actions = null, section = 'friends', variant = 'friend' }) {
    const isFavorite = followedIds.has(item.id)
    const primaryBadge = getFriendPrimaryBadge(item)
    const displayName = getFriendDisplayName(item)
    const intro = getFriendIntro(item, variant === 'request' ? '친구 요청을 보냈습니다.' : variant === 'add' ? '친구추가 가능한 계정입니다.' : '한줄소개가 없습니다.')
    const menuId = friendMenuKey(section, item.id)
    const defaultActions = variant === 'request'
      ? actions
      : variant === 'add'
        ? actions
        : (
        <button
          type="button"
          className={isFavorite ? 'favorite-friend-button friend-card-favorite is-active' : 'favorite-friend-button friend-card-favorite'}
          onClick={() => toggleFavorite(item).catch(err => window.alert(err.message))}
          aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      )
    return (
      <div className={`friend-row-card upgraded friend-card-structured ${variant === 'request' ? 'request-variant' : variant === 'add' ? 'add-variant' : 'list-variant'}`}>
        <button type="button" className="friend-avatar-button" onClick={() => setProfilePreview({ mode: 'image', friend: item, section })}>
          <AvatarCircle src={item.photo_url} label={displayName} className="friend-avatar" />
        </button>
        <div className="friend-card-content">
          <div className="friend-card-head-row">
            <button type="button" className="friend-card-title-button" onClick={() => setProfilePreview({ mode: 'card', friend: item, section })}>
              <span className="friend-primary-badge">{primaryBadge}</span>
              <span className="friend-row-title">{displayName}</span>
            </button>
            <div className="dropdown-wrap friend-inline-wrap top-menu">
              <button type="button" className="small ghost" onClick={() => setOpenFriendMenuId(prev => prev === menuId ? null : menuId)}>메뉴</button>
              <div className={`dropdown-menu right inline-friend-menu ${openFriendMenuId === menuId ? 'open-inline-menu' : ''}`}>
                {variant === 'friend' && <button type="button" className="dropdown-item" onClick={() => openGroupPicker(item)}>그룹설정</button>}
                {variant === 'friend' && <button type="button" className="dropdown-item" onClick={() => removeFriend(item).catch(err => window.alert(err.message))}>친구삭제</button>}
                <button type="button" className="dropdown-item danger-text" onClick={() => blockFriend(item).catch(err => window.alert(err.message))}>{variant === 'request' ? '차단' : variant === 'add' ? '계정차단' : '친구차단'}</button>
              </div>
            </div>
          </div>
          <div className="friend-card-bottom-row">
            <button type="button" className="friend-row-body clickable-profile friend-card-profile-button" onClick={() => setProfilePreview({ mode: 'card', friend: item, section })}>
              <div className="friend-row-subtitle">{intro}</div>
            </button>
            <div className={`friend-card-action-slot ${variant === 'request' ? 'request-actions' : 'favorite-actions'}`}>
              {defaultActions}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const previewFriend = profilePreview.friend

  return (
    <div className="stack-page friends-page">
      <section className="card friends-shell">
        <div className="friends-topbar">
          <div></div>
          <div className="friends-top-actions">
            <button type="button" className="ghost icon-button" onClick={() => setSearchOpen(v => !v)}>검색</button>
            <button type="button" className="ghost icon-button" onClick={() => { setPanel('add'); setSearchParams({ panel: 'add' }) }}>추가</button>
            <div className="dropdown-wrap friends-main-menu">
              <button type="button" className="ghost icon-button menu-button-with-badge" onClick={() => setMenuOpen(v => !v)}>메뉴{data.received_requests.length > 0 && <span className="notification-badge menu-badge">{data.received_requests.length}</span>}</button>
              {menuOpen && (
                <div className="dropdown-menu right">
                  <button type="button" className="dropdown-item" onClick={() => { setPanel('add'); setMenuOpen(false); setSearchParams({ panel: 'add' }) }}>친구추가</button>
                  <button type="button" className="dropdown-item friends-request-menu-item" onClick={() => { setPanel('requests'); setMenuOpen(false); setSearchParams({ panel: 'requests' }) }}>
                    <span className="friends-request-menu-item-label">친구요청목록</span>
                    {data.received_requests.length > 0 ? <span className="notification-badge friends-request-inline-badge">{data.received_requests.length}</span> : null}
                  </button>
                  <button type="button" className="dropdown-item" onClick={() => { openCreateGroupModal(); setMenuOpen(false) }}>그룹추가</button>
                  <button type="button" className="dropdown-item" onClick={() => openGroupEditor('rename')}>그룹편집</button>
                  <button type="button" className="dropdown-item" onClick={() => openGroupEditor('delete')}>그룹삭제</button>
                  <button type="button" className="dropdown-item" onClick={() => { createCategory(); setMenuOpen(false) }}>카테고리추가</button>
                  <button type="button" className="dropdown-item" onClick={() => openCategoryEditor('rename')}>카테고리편집</button>
                  <button type="button" className="dropdown-item" onClick={() => openCategoryEditor('delete')}>카테고리삭제</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {searchOpen && <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="친구 검색" className="friends-search-input" />}

        <div className="friends-section-label">내 정보</div>
        {profile && (
          <button type="button" className="my-profile-card clickable-profile" onClick={() => openMyProfileCard().catch(err => window.alert(err.message))}>
            <AvatarCircle src={profile.photo_url} label={profile.nickname} className="friend-avatar large" size={56} />
            <div className="friend-row-body">
              <div className="friend-row-title">{profile.nickname}</div>
              <div className="friend-row-subtitle">{profile.one_liner || profile.bio || '한줄소개를 입력해 주세요.'}</div>
            </div>
          </button>
        )}

        <div className="friends-section-label">즐겨찾기</div>
        <div className="friends-group-list">
          {favorites.length > 0 ? favorites.map(item => <FriendRow key={`fav-${item.id}`} item={item} section="favorite" />) : <div className="muted">즐겨찾기 친구가 없습니다.</div>}
        </div>

        <div className="friends-section-label friends-section-label-with-menu friends-group-header-inline">
          <div className="friends-group-title-inline">
            <span>그룹</span>
            <div className="friend-group-category-filter friend-group-category-filter-inline">
              <button type="button" className={selectedGroupCategoryId === 'all' ? 'small active' : 'small ghost'} onClick={() => setSelectedGroupCategoryId('all')}>전체</button>
              {groupCategories.map(category => (
                <button key={category.id} type="button" className={selectedGroupCategoryId === category.id ? 'small active' : 'small ghost'} onClick={() => setSelectedGroupCategoryId(category.id)}>{category.name}</button>
              ))}
              <button type="button" className={selectedGroupCategoryId === 'uncategorized' ? 'small active' : 'small ghost'} onClick={() => setSelectedGroupCategoryId('uncategorized')}>미분류</button>
            </div>
          </div>
          <div className="dropdown-wrap friends-group-menu">
            <button type="button" className="ghost small" onClick={() => setGroupSectionMenuOpen(v => !v)}>메뉴</button>
            {groupSectionMenuOpen && (
              <div className="dropdown-menu right">
                <button type="button" className="dropdown-item" onClick={openCreateGroupModal}>그룹추가</button>
                <button type="button" className="dropdown-item" onClick={() => openGroupEditor('delete')}>그룹삭제</button>
                <button type="button" className="dropdown-item" onClick={() => openGroupEditor('rename')}>그룹수정</button>
              </div>
            )}
          </div>
        </div>
        <div className="friends-group-list grouped-stack">
          {groupedFriendsFiltered.length > 0 ? groupedFriendsFiltered.map(group => (
            <div key={group.id} className="group-card-block">
              <div className="group-card-header-line">
                <strong>{group.name}</strong>
                <span className="group-category-chip">{groupCategories.find(category => String(category.id) === String(group.category_id || ''))?.name || '미분류'}</span>
              </div>
              <div className="friends-group-list inner">
                {group.items.length > 0 ? group.items.map(item => <FriendRow key={`group-${group.id}-${item.id}`} item={item} section={`group-${group.id}`} />) : <div className="muted">배정된 친구가 없습니다.</div>}
              </div>
            </div>
          )) : <div className="muted">표시할 그룹이 없습니다.</div>}
        </div>

        <div className="friends-section-label">전체친구</div>
        <div className="friends-group-list">
          {filteredFriends.length > 0 ? filteredFriends.map(item => <FriendRow key={`friend-${item.id}`} item={item} section="all" />) : <div className="muted">표시할 친구가 없습니다.</div>}
        </div>

        {panel === 'add' && (
          <section className="friends-subpanel friends-add-panel">
            <div className="friends-add-panel-title">친구추가</div>
            <div className="friends-add-top-row">
              <div className="friend-add-search-tabs friends-add-mode-tabs">
                <button type="button" className={addSearchMode === 'nickname' ? 'small active' : 'small ghost'} onClick={() => setAddSearchMode('nickname')}>닉네임</button>
                <button type="button" className={addSearchMode === 'name' ? 'small active' : 'small ghost'} onClick={() => setAddSearchMode('name')}>이름</button>
              </div>
              <button type="button" className="ghost small" onClick={() => { setPanel(''); setSearchParams({}) }}>닫기</button>
            </div>
            <div className="friend-add-search-box friends-add-search-shell">
              <input
                value={addSearchText}
                onChange={e => setAddSearchText(e.target.value)}
                placeholder={addSearchMode === 'name' ? '이름으로 검색' : '닉네임으로 검색'}
                className="friends-search-input friend-add-search-input"
              />
            </div>
            <div className="friends-group-list friends-add-results">
              {candidateUsers.map(item => {
                const displayName = item.name || item.full_name || item.real_name || item.username || '이름 미등록'
                const oneLiner = item.one_liner || item.bio || item.region || '친구추가 가능한 계정입니다.'
                const normalizedItem = {
                  ...item,
                  name: displayName,
                  one_liner: oneLiner,
                }
                return (
                  <FriendRow
                    key={`candidate-${item.id}`}
                    item={normalizedItem}
                    section="add"
                    variant="add"
                    actions={sentRequestIds.has(item.id)
                      ? <button type="button" className="small ghost" disabled>요청완료</button>
                      : (
                        <button
                          type="button"
                          className="small"
                          onClick={() => doAction(async () => {
                            await api(`/api/friends/request/${item.id}`, { method: 'POST' })
                            setToast(`${item.nickname || item.name || '회원'}님에게 친구요청을 신청했습니다.`)
                          }, `${item.nickname || item.name || '회원'}님에게 친구요청을 신청했습니다.`)}
                        >
                          요청
                        </button>
                      )}
                  />
                )
              })}
              {candidateUsers.length === 0 && <div className="muted">검색 조건에 맞는 계정이 없습니다.</div>}
            </div>
          </section>
        )}

        {panel === 'requests' && (
          <section className="friends-subpanel">
            <div className="between"><strong>친구요청목록 {data.received_requests.length > 0 ? `(${data.received_requests.length})` : ''}</strong><button type="button" className="ghost small" onClick={() => { setPanel(''); setSearchParams({}) }}>닫기</button></div>
            <div className="friends-group-list">
              {receivedProfiles.map(req => (
                <FriendRow
                  key={`req-${req.id}`}
                  item={{ ...req.profile, nickname: req.profile.nickname || req.requester_nickname, one_liner: req.profile.one_liner || req.profile.region || '친구 요청을 보냈습니다.' }}
                  section="requests"
                  variant="request"
                  actions={
                    <div className="inline-actions wrap">
                      <button className="small" onClick={() => doAction(() => api(`/api/friends/respond/${req.id}`, { method: 'POST', body: JSON.stringify({ action: 'accepted' }) }), '친구 요청을 수락했습니다.')}>수락</button>
                      <button className="small ghost" onClick={() => doAction(() => api(`/api/friends/respond/${req.id}`, { method: 'POST', body: JSON.stringify({ action: 'rejected' }) }), '친구 요청을 거절했습니다.')}>거절</button>
                    </div>
                  }
                />
              ))}
              {receivedProfiles.length === 0 && <div className="muted">받은 친구 요청이 없습니다.</div>}
            </div>
          </section>
        )}

        {message && <div className="success">{message}</div>}
        {toast && <div className="mention-toast action-toast">{toast}</div>}
      </section>

      {groupCreateModalOpen && (
        <div className="sheet-backdrop" onClick={() => setGroupCreateModalOpen(false)}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">그룹추가</div>
            <div className="stack">
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="그룹명" />
              <select value={newGroupCategoryId} onChange={e => setNewGroupCategoryId(e.target.value)}>
                <option value="">미분류</option>
                {groupCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <div className="inline-actions wrap end">
                <button type="button" className="ghost" onClick={() => setGroupCreateModalOpen(false)}>닫기</button>
                <button type="button" onClick={submitCreateGroup}>저장</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {groupPicker.open && (
        <div className="sheet-backdrop" onClick={() => setGroupPicker({ open: false, friend: null })}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">그룹설정</div>
            <div className="stack">
              <div className="muted">{groupPicker.friend?.nickname} 님을 배정할 그룹을 선택하세요.</div>
              <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)}>
                <option value="">그룹 해제</option>
                {(groupState.groups || []).map(group => <option key={group.id} value={group.id}>{group.name}{group.category_id ? ` · ${groupCategories.find(category => String(category.id) === String(group.category_id))?.name || ''}` : ''}</option>)}
              </select>
              <div className="inline-actions wrap end">
                <button type="button" className="ghost" onClick={() => setGroupPicker({ open: false, friend: null })}>닫기</button>
                <button type="button" onClick={applyFriendGroup}>적용</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {groupRenamePicker.open && (
        <div className="sheet-backdrop" onClick={() => setGroupRenamePicker({ open: false, mode: 'rename' })}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">{groupRenamePicker.mode === 'rename' ? '그룹명편집' : '그룹삭제'}</div>
            <div className="stack">
              <select value={selectedGroupId} onChange={e => {
                const group = (groupState.groups || []).find(item => String(item.id) === e.target.value)
                setSelectedGroupId(e.target.value)
                setEditingGroupName(group?.name || '')
                setEditingGroupCategoryId(String(group?.category_id || ''))
              }}>
                {(groupState.groups || []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              {groupRenamePicker.mode === 'rename' && (
                <>
                  <input value={editingGroupName} onChange={e => setEditingGroupName(e.target.value)} placeholder="새 그룹명" />
                  <select value={editingGroupCategoryId} onChange={e => setEditingGroupCategoryId(e.target.value)}>
                    <option value="">미분류</option>
                    {groupCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </>
              )}
              {groupRenamePicker.mode === 'delete' && <div className="muted">선택한 그룹을 삭제하면 해당 그룹 배정만 해제되고 전체 친구 목록은 유지됩니다.</div>}
              <div className="inline-actions wrap end">
                <button type="button" className="ghost" onClick={() => setGroupRenamePicker({ open: false, mode: 'rename' })}>닫기</button>
                <button type="button" className={groupRenamePicker.mode === 'delete' ? 'danger-text' : ''} onClick={submitGroupEditor}>{groupRenamePicker.mode === 'rename' ? '저장' : '삭제'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {categoryEditor.open && (
        <div className="sheet-backdrop" onClick={() => setCategoryEditor({ open: false, mode: 'rename' })}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">{categoryEditor.mode === 'rename' ? '카테고리편집' : '카테고리삭제'}</div>
            <div className="stack">
              <select value={selectedCategoryId} onChange={e => {
                const category = (groupState.categories || []).find(item => String(item.id) === e.target.value)
                setSelectedCategoryId(e.target.value)
                setEditingCategoryName(category?.name || '')
              }}>
                {(groupState.categories || []).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              {categoryEditor.mode === 'rename' && <input value={editingCategoryName} onChange={e => setEditingCategoryName(e.target.value)} placeholder="새 카테고리명" />}
              {categoryEditor.mode === 'delete' && <div className="muted">삭제된 카테고리에 속한 그룹은 미분류로 유지됩니다.</div>}
              <div className="inline-actions wrap end">
                <button type="button" className="ghost" onClick={() => setCategoryEditor({ open: false, mode: 'rename' })}>닫기</button>
                <button type="button" className={categoryEditor.mode === 'delete' ? 'danger-text' : ''} onClick={submitCategoryEditor}>{categoryEditor.mode === 'rename' ? '저장' : '삭제'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewFriend && profilePreview.mode === 'image' && (
        <div className="profile-preview-backdrop" onClick={() => setProfilePreview({ mode: '', friend: null })}>
          <div className="profile-image-viewer" onClick={e => e.stopPropagation()}>
            <AvatarCircle src={previewFriend.photo_url} label={previewFriend.nickname} size={220} className="friend-avatar-preview" />
          </div>
        </div>
      )}

      {previewFriend && profilePreview.mode === 'card' && (
        <div className="profile-preview-backdrop" onClick={() => setProfilePreview({ mode: '', friend: null, section: '' })}>
          <div className="profile-preview-card" onClick={e => e.stopPropagation()}>
            <div className="profile-preview-cover" style={previewFriend.cover_url ? { backgroundImage: `url(${previewFriend.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
              {profilePreview.section === 'me' && (
                <div className="dropdown-wrap profile-preview-menu">
                  <button type="button" className="small ghost" onClick={e => { e.stopPropagation(); setOpenFriendMenuId(prev => prev === 'my-profile-preview' ? null : 'my-profile-preview') }}>메뉴</button>
                  <div className={`dropdown-menu right inline-friend-menu ${openFriendMenuId === 'my-profile-preview' ? 'open-inline-menu' : ''}`}>
                    <button type="button" className="dropdown-item" onClick={() => { setOpenFriendMenuId(null); openMyProfileEditor() }}>상세 프로필 편집</button>
                  </div>
                </div>
              )}
            </div>
            <div className="profile-preview-main">
              <AvatarCircle src={previewFriend.photo_url} label={previewFriend.nickname} size={88} className="profile-preview-avatar" />
              <div className="profile-preview-name">{previewFriend.nickname || '회원'}</div>
              <div className="profile-preview-oneliner">{previewFriend.one_liner || previewFriend.bio || previewFriend.region || '한줄소개가 없습니다.'}</div>
              <div className="inline-actions wrap center profile-preview-actions">
                {profilePreview.section === 'me' ? (
                  <button type="button" onClick={() => goDirectChat(previewFriend.id)}>나에게 채팅</button>
                ) : (
                  <>
                    <button type="button" onClick={() => goDirectChat(previewFriend.id)}>채팅</button>
                    <button type="button" className="ghost" onClick={() => window.alert('음성 기능은 다음 단계에서 연결됩니다.')}>음성</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {profilePreview.mode === 'edit' && profileEditForm && (
        <div className="profile-preview-backdrop" onClick={() => { setProfilePreview(prev => ({ ...prev, mode: 'card' })); setProfileEditForm(null) }}>
          <div className="profile-preview-card profile-edit-card" onClick={e => e.stopPropagation()}>
            <div className="profile-preview-cover editable profile-cover-button" style={profileEditForm.cover_url ? { backgroundImage: `url(${profileEditForm.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} onClick={() => document.getElementById('profile-cover-input')?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('profile-cover-input')?.click() }}>
              <input id="profile-cover-input" type="file" accept="image/*" hidden onChange={e => handleProfileImageUpload('cover', e.target.files?.[0]).catch(err => window.alert(err.message))} />
              <div className="inline-actions wrap center profile-media-actions">
                <span className="small ghost profile-cover-hint">배경화면을 눌러 변경</span>
                <button type="button" className="ghost small" onClick={e => { e.stopPropagation(); setProfileEditForm(prev => ({ ...prev, cover_url: '' })) }}>배경화면 삭제(기본그림)</button>
              </div>
            </div>
            <div className="profile-preview-main">
              <button type="button" className="ghost profile-avatar-edit-button" onClick={() => document.getElementById('profile-photo-input')?.click()}>
                <AvatarCircle src={profileEditForm.photo_url} label={profileEditForm.nickname} size={88} className="profile-preview-avatar" />
              </button>
              <input id="profile-photo-input" type="file" accept="image/*" hidden onChange={e => handleProfileImageUpload('photo', e.target.files?.[0]).catch(err => window.alert(err.message))} />
              <div className="inline-actions wrap center profile-media-actions">
                <button type="button" className="ghost small" onClick={async () => { const updated = await updateMyProfileField({ photo_url: '', one_liner: profileEditForm.one_liner }); setProfile(updated); setProfileEditForm(prev => ({ ...prev, photo_url: '' })) }}>프로필 삭제(기본그림)</button>
                <label className="small profile-upload-label">프로필 추가 및 변경<input type="file" accept="image/*" hidden onChange={e => handleProfileImageUpload('photo', e.target.files?.[0]).catch(err => window.alert(err.message))} /></label>
              </div>
              <input value={profileEditForm.nickname} onChange={e => setProfileEditForm(prev => ({ ...prev, nickname: e.target.value }))} placeholder="닉네임" />
              <button type="button" className="profile-edit-oneliner clickable" onClick={() => { const next = window.prompt('한줄소개를 입력하세요.', profileEditForm.one_liner || ''); if (next !== null) setProfileEditForm(prev => ({ ...prev, one_liner: next })) }}>
                {profileEditForm.one_liner || '한줄소개를 눌러 입력해 주세요.'}
              </button>
              <div className="inline-actions wrap center profile-preview-actions">
                <button type="button" className="ghost" onClick={() => { setProfilePreview(prev => ({ ...prev, mode: 'card' })); setProfileEditForm(null) }}>취소</button>
                <button type="button" onClick={() => saveMyProfileEditor().catch(err => window.alert(err.message))}>저장</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const CHAT_CATEGORIES = [
  ['all', '전체'],
  ['general', '일반'],
  ['group', '단체'],
  ['favorite', '즐겨찾기'],
]

const QUICK_REACTIONS = ['👍', '❤️', '👏', '🔥', '✅']

const CHAT_PLUS_ACTIONS = [
  ['image', '이미지첨부'],
  ['file', '파일첨부'],
  ['voiceRoom', '음성방개설'],
  ['voiceMessage', '음성메세지'],
  ['shareLocation', '내위치공유'],
  ['schedule', '카톡방일정'],
]

const ENCLOSED_NUMBERS = {
  1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨', 10: '⑩',
  11: '⑪', 12: '⑫', 13: '⑬', 14: '⑭', 15: '⑮', 16: '⑯', 17: '⑰', 18: '⑱', 19: '⑲', 20: '⑳',
  21: '㉑', 22: '㉒', 23: '㉓', 24: '㉔', 25: '㉕', 26: '㉖', 27: '㉗', 28: '㉘', 29: '㉙', 30: '㉚',
  31: '㉛', 32: '㉜', 33: '㉝', 34: '㉞', 35: '㉟', 36: '㊱', 37: '㊲', 38: '㊳', 39: '㊴', 40: '㊵',
  41: '㊶', 42: '㊷', 43: '㊸', 44: '㊹', 45: '㊺', 46: '㊻', 47: '㊼', 48: '㊽', 49: '㊾', 50: '㊿',
}



function formatChatUpdatedAt(value) {
  const raw = String(value || '')
  if (!raw) return ''
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return raw.slice(5, 16).replace('T', ' ')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

function AvatarCircle({ src, label, size = 44, className = '' }) {
  const fallback = (String(label || '').trim()[0] || '•')
  return src ? (
    <img src={src} alt={label || '프로필'} className={`avatar-circle ${className}`.trim()} style={{ width: size, height: size }} />
  ) : (
    <div className={`avatar-circle avatar-fallback ${className}`.trim()} style={{ width: size, height: size }}>{fallback}</div>
  )
}

function RoomAvatar({ room }) {
  if (room.room_type === 'group') return <AvatarCircle label={room.title || '단체'} className="room-avatar" />
  return <AvatarCircle src={room.target_user?.photo_url} label={room.target_user?.nickname || room.title} className="room-avatar" />
}

function resolveScheduleStartTime(value) {
  return value && value !== '미정' ? value : '00:00'
}

function resolveScheduleCustomerName(value) {
  return String(value || '').trim() || '(성함)'
}

function isDepositPending(item) {
  return !item.deposit_method || item.deposit_method === '계약금입금전'
}

function buildDepositLine(item) {
  if (isDepositPending(item)) return '계약금 입금전'
  return [item.deposit_method, item.deposit_amount].filter(Boolean).join(' / ') || '계약금 입금완료'
}

function buildSchedulePrimaryLine(item) {
  const startDisplay = resolveScheduleStartTime(item.start_time)
  const platformDisplay = item.platform || '플랫폼미정'
  const customerDisplay = resolveScheduleCustomerName(item.customer_name)
  const costDisplay = buildCostSummary(item)
  return [startDisplay, platformDisplay, customerDisplay, costDisplay].join(' ').trim()
}

function buildMobileScheduleLines(item) {
  const authorDisplay = item.created_by_nickname || item.author_nickname || '작성자'
  return {
    line1: buildSchedulePrimaryLine(item),
    line2: buildDepositLine(item),
    line3: `[${item.department_info || '미지정'}] [${authorDisplay}]`,
    depositPending: isDepositPending(item),
  }
}

function buildRoomPath(item) {
  return item.room_type === 'group' ? `/chats/group/${item.room_ref}` : `/chats/direct/${item.room_ref}`
}

function useLongPress(onLongPress, delay = 550) {
  let timer = null
  const start = (event) => {
    clearTimeout(timer)
    timer = setTimeout(() => onLongPress(event), delay)
  }
  const clear = () => clearTimeout(timer)
  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
    onContextMenu: (event) => {
      event.preventDefault()
      onLongPress(event)
    },
  }
}

function AttachmentPreview({ message }) {
  if (message.attachment_type === 'image' && message.attachment_url) {
    return <img className="chat-image-preview" src={message.attachment_url} alt={message.attachment_name || '첨부 이미지'} />
  }
  if (message.attachment_type === 'file' && message.attachment_url) {
    return <a className="attachment-link" href={message.attachment_url} download={message.attachment_name || '첨부파일'}>{message.attachment_name || '첨부파일 다운로드'}</a>
  }
  if (message.attachment_type === 'location' && message.attachment_url) {
    return <a className="attachment-link" href={message.attachment_url} target="_blank" rel="noreferrer">공유된 위치 보기</a>
  }
  return null
}

function ChatActionSheet({ title, actions, reactions, onReact, onClose }) {
  if (!actions) return null
  return (
    <div className="profile-preview-backdrop" onClick={onClose}>
      <div className="chat-popup-menu" onClick={e => e.stopPropagation()}>
        {title && <div className="sheet-title">{title}</div>}
        {!!reactions?.length && (
          <div className="chat-action-reaction-bar">
            {reactions.map(emoji => (
              <button key={emoji} type="button" className="chat-action-emoji-button" onClick={() => { onReact?.(emoji); onClose?.() }}>{emoji}</button>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          {actions.map(action => (
            <button key={action.label} type="button" className={action.danger ? 'sheet-action danger-text' : 'sheet-action'} onClick={() => { action.onClick?.(); onClose?.() }}>{action.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}


function ChatsPage() {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const [category, setCategory] = useState('all')
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [actionRoom, setActionRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sortMode, setSortMode] = useState('recent')
  const [pinArrangeOpen, setPinArrangeOpen] = useState(false)
  const roomPressTimerRef = useRef(null)
  const roomPressHandledRef = useRef(null)
  const [pinOrder, setPinOrder] = useState(() => loadChatPinnedOrder(currentUser?.id))
  const chatCustomCategoryKey = useMemo(() => `icj_chat_custom_categories_${currentUser?.id || 'guest'}`, [currentUser?.id])
  const chatRoomCategoryKey = useMemo(() => `icj_chat_room_categories_${currentUser?.id || 'guest'}`, [currentUser?.id])
  const [customCategories, setCustomCategories] = useState(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = JSON.parse(window.localStorage.getItem(`icj_chat_custom_categories_${currentUser?.id || 'guest'}`) || '[]')
      return Array.isArray(raw) ? raw.map(item => ({ id: String(item?.id || item?.value || ''), label: String(item?.label || item?.name || '').trim() })).filter(item => item.id && item.label) : []
    } catch {
      return []
    }
  })
  const [roomCategoryMap, setRoomCategoryMap] = useState(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = JSON.parse(window.localStorage.getItem(`icj_chat_room_categories_${currentUser?.id || 'guest'}`) || '{}')
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  })
  const [deleteCategoryOpen, setDeleteCategoryOpen] = useState(false)
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState('')
  const [friendList, setFriendList] = useState([])
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false)
  const [createGroupRoomTitle, setCreateGroupRoomTitle] = useState('')
  const [createGroupSelections, setCreateGroupSelections] = useState({})
  const [createGroupSubmitting, setCreateGroupSubmitting] = useState(false)

  useEffect(() => {
    setPinOrder(loadChatPinnedOrder(currentUser?.id))
  }, [currentUser?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(chatCustomCategoryKey, JSON.stringify(customCategories))
  }, [chatCustomCategoryKey, customCategories])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(chatRoomCategoryKey, JSON.stringify(roomCategoryMap))
  }, [chatRoomCategoryKey, roomCategoryMap])

  useEffect(() => {
    if (!customCategories.length) {
      setDeleteCategoryOpen(false)
      setDeleteCategoryTarget('')
      return
    }
    if (!customCategories.some(item => String(item.id) === String(deleteCategoryTarget))) {
      setDeleteCategoryTarget(customCategories[0]?.id || '')
    }
  }, [customCategories, deleteCategoryTarget])

  const visibleChatCategories = useMemo(() => ([
    ['all', '전체'],
    ['favorite', '즐겨찾기'],
    ...customCategories.map(item => [item.id, item.label]),
  ]), [customCategories])

  function updatePinOrder(updater) {
    setPinOrder(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveChatPinnedOrder(currentUser?.id, next)
      return next
    })
  }

  async function load() {
    setLoading(true)
    try {
      const [items, userList, friendData] = await Promise.all([
        api('/api/chat-list'),
        api('/api/users'),
        api('/api/friends').catch(() => ({ friends: [] })),
      ])
      setRooms(items)
      setUsers(userList)
      setFriendList(Array.isArray(friendData?.friends) ? friendData.friends : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [category])

  async function updateRoomSetting(room, patch) {
    const endpoint = room.room_type === 'group'
      ? `/api/chat-rooms/group/${room.room_ref}/settings`
      : `/api/chat-rooms/direct/${room.room_ref}/settings`
    await api(endpoint, { method: 'PUT', body: JSON.stringify(patch) })
    if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) {
      updatePinOrder(prev => {
        const filtered = prev.filter(id => id !== room.id)
        return patch.pinned ? [room.id, ...filtered] : filtered
      })
    }
    await load()
  }

  async function handleInvite(room) {
    const selectable = users.filter(item => String(item.id) !== String(room.room_ref))
    const guide = selectable.map(item => `${item.id}: ${item.nickname}`).join('\n')
    const picked = window.prompt(`초대할 회원 번호를 입력하세요.
${guide}`)
    if (!picked) return
    if (room.room_type === 'group') {
      await api(`/api/group-rooms/${room.room_ref}/invite`, { method: 'POST', body: JSON.stringify({ user_id: Number(picked) }) })
    } else {
      const res = await api(`/api/direct-chat/${room.room_ref}/invite`, { method: 'POST', body: JSON.stringify({ user_id: Number(picked) }) })
      navigate(`/chats/group/${res.room_id}`)
      return
    }
    alert('초대가 완료되었습니다.')
    await load()
  }

  async function handleLeave(room) {
    if (room.room_type === 'group') {
      await api(`/api/group-rooms/${room.room_ref}/leave`, { method: 'POST' })
    } else {
      await updateRoomSetting(room, { hidden: true })
      return
    }
    await load()
  }

  function handleAddCustomCategory() {
    const label = window.prompt('카테고리 이름을 입력하세요.')
    const trimmed = String(label || '').trim()
    if (!trimmed) return
    const duplicated = customCategories.some(item => item.label === trimmed)
    if (duplicated) {
      window.alert('이미 같은 이름의 카테고리가 있습니다.')
      return
    }
    const id = `custom-${Date.now()}`
    setCustomCategories(prev => [...prev, { id, label: trimmed }])
    setCategory(id)
  }

  function handleDeleteCustomCategory() {
    if (!customCategories.length) {
      window.alert('삭제할 카테고리가 없습니다.')
      return
    }
    setDeleteCategoryOpen(prev => !prev)
    setDeleteCategoryTarget(prev => {
      if (prev && customCategories.some(item => item.id === prev)) return prev
      return customCategories.find(item => item.id === category)?.id || customCategories[0]?.id || ''
    })
  }

  function confirmDeleteCustomCategory() {
    const target = customCategories.find(item => String(item.id) === String(deleteCategoryTarget))
    if (!target) {
      window.alert('삭제할 카테고리를 선택해 주세요.')
      return
    }
    const confirmed = window.confirm('카테고리 항목을 삭제하시겠습니까?')
    if (!confirmed) return

    setCustomCategories(prev => prev.filter(item => item.id !== target.id))
    setRoomCategoryMap(prev => {
      const next = { ...prev }
      Object.keys(next).forEach(roomId => {
        if (String(next[roomId] || '') === String(target.id)) delete next[roomId]
      })
      return next
    })
    if (String(category) === String(target.id)) setCategory('all')
    setDeleteCategoryOpen(false)
    setDeleteCategoryTarget('')
  }


  async function handleAssignRoomCategory(room) {
    if (!customCategories.length) {
      window.alert('먼저 + 버튼으로 카테고리를 추가해 주세요.')
      return
    }
    const guide = ['0: 카테고리 해제', ...customCategories.map((item, index) => `${index + 1}: ${item.label}`)].join('\n')
    const picked = window.prompt(`카테고리를 선택하세요.\n${guide}`)
    if (picked === null) return
    const index = Number(String(picked).trim())
    if (!Number.isFinite(index) || index < 0 || index > customCategories.length) {
      window.alert('올바른 번호를 입력해 주세요.')
      return
    }
    const nextCategoryId = index === 0 ? '' : customCategories[index - 1].id
    setRoomCategoryMap(prev => {
      const next = { ...prev }
      if (nextCategoryId) next[room.id] = nextCategoryId
      else delete next[room.id]
      return next
    })
  }

  function handleCreateGroupRoom() {
    setCreateGroupRoomTitle('')
    setCreateGroupSelections({})
    setCreateGroupModalOpen(true)
  }

  function toggleCreateGroupSelection(userId) {
    const key = String(userId)
    setCreateGroupSelections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function submitCreateGroupRoom() {
    const title = String(createGroupRoomTitle || '').trim()
    if (!title) {
      window.alert('채팅방 이름을 입력해 주세요.')
      return
    }
    const selectedMemberIds = Object.keys(createGroupSelections).filter(key => createGroupSelections[key]).map(value => Number(value)).filter(Number.isFinite)
    setCreateGroupSubmitting(true)
    try {
      const created = await api('/api/group-rooms', {
        method: 'POST',
        body: JSON.stringify({ title, description: '', region: '', member_ids: selectedMemberIds }),
      })
      setMenuOpen(false)
      setCreateGroupModalOpen(false)
      navigate(`/chats/group/${created.room_id || created.id}`)
    } catch (error) {
      window.alert(error?.message || '채팅방 개설 중 오류가 발생했습니다.')
    } finally {
      setCreateGroupSubmitting(false)
    }
  }

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pinRankMap = new Map(pinOrder.map((id, index) => [id, index]))
    const ordered = [...rooms].sort((a, b) => {
      const aPinned = Boolean(a.pinned)
      const bPinned = Boolean(b.pinned)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      if (aPinned && bPinned) {
        const aRank = pinRankMap.has(a.id) ? pinRankMap.get(a.id) : Number.MAX_SAFE_INTEGER
        const bRank = pinRankMap.has(b.id) ? pinRankMap.get(b.id) : Number.MAX_SAFE_INTEGER
        if (aRank !== bRank) return aRank - bRank
      }
      if (sortMode === 'name') {
        return String(a.title || a.target_user?.nickname || '').localeCompare(String(b.title || b.target_user?.nickname || ''), 'ko')
      }
      return String(b.updated_at || b.last_message_at || '').localeCompare(String(a.updated_at || a.last_message_at || ''))
    })
    let categoryFiltered = ordered
    if (category === 'favorite') categoryFiltered = ordered.filter(room => room.favorite)
    else if (category !== 'all') categoryFiltered = ordered.filter(room => String(roomCategoryMap?.[room.id] || '') === String(category))
    if (!q) return categoryFiltered
    return categoryFiltered.filter(room => [room.title, room.subtitle, room.target_user?.nickname].join(' ').toLowerCase().includes(q))
  }, [rooms, query, pinOrder, category, roomCategoryMap, sortMode])

  const pinnedRooms = useMemo(() => filteredRooms.filter(room => room.pinned), [filteredRooms])

  function movePinnedRoom(roomId, direction) {
    updatePinOrder(prev => {
      const next = prev.filter(id => pinnedRooms.some(room => room.id === id))
      const currentIndex = next.indexOf(roomId)
      if (currentIndex < 0) return next
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= next.length) return next
      const clone = [...next]
      const [moved] = clone.splice(currentIndex, 1)
      clone.splice(targetIndex, 0, moved)
      return clone
    })
  }

  function clearRoomPressTimer() {
    if (roomPressTimerRef.current) {
      window.clearTimeout(roomPressTimerRef.current)
      roomPressTimerRef.current = null
    }
  }

  function handleRoomPressStart(room) {
    clearRoomPressTimer()
    roomPressTimerRef.current = window.setTimeout(() => {
      roomPressHandledRef.current = room.id
      setActionRoom(room)
    }, 500)
  }

  function handleRoomPressEnd() {
    clearRoomPressTimer()
  }

  function handleRoomActivate(event, room) {
    if (roomPressHandledRef.current === room.id) {
      roomPressHandledRef.current = null
      event.preventDefault()
      return
    }
    navigate(buildRoomPath(room))
  }

  function handleRoomContextMenu(event, room) {
    event.preventDefault()
    clearRoomPressTimer()
    roomPressHandledRef.current = room.id
    setActionRoom(room)
  }


  const roomActions = actionRoom ? [
    { label: '채팅방 이름변경', onClick: async () => {
      const nextName = window.prompt('새 채팅방 이름을 입력하세요.', actionRoom.title || '')
      if (nextName === null) return
      await updateRoomSetting(actionRoom, { custom_name: nextName })
    } },
    ...((actionRoom.room_type === 'group' && actionRoom.room?.can_manage) || actionRoom.room_type !== 'group' ? [{ label: '채팅방 초대', onClick: async () => { await handleInvite(actionRoom) } }] : []),
    { label: '채팅방 나가기', danger: true, onClick: async () => { await handleLeave(actionRoom) } },
    { label: actionRoom.pinned ? '채팅방 상단고정 해제' : '채팅방 상단고정', onClick: async () => { await updateRoomSetting(actionRoom, { pinned: !actionRoom.pinned }) } },
    { label: actionRoom.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가', onClick: async () => { await updateRoomSetting(actionRoom, { favorite: !actionRoom.favorite }) } },
    { label: '카테고리 지정', onClick: async () => { await handleAssignRoomCategory(actionRoom) } },
    { label: actionRoom.muted ? '채팅방 알람켜기' : '채팅방 알람끄기', onClick: async () => { await updateRoomSetting(actionRoom, { muted: !actionRoom.muted }) } },
  ] : null

  return (
    <div className="stack-page chat-page-layout">
      <section className="card chat-category-shell">
        <div className="chat-category-toolbar">
          <div className="chat-category-scroll" role="tablist" aria-label="채팅 카테고리">
            <div className="chat-category-row evenly-spaced chat-category-row-spaced chat-category-row-scrollable">
              {visibleChatCategories.map(([value, label]) => (
                <button key={value} type="button" className={category === value ? 'small chat-tab active equal-width selected-toggle' : 'small ghost chat-tab equal-width'} onClick={() => setCategory(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="chat-category-mini-actions">
            <button type="button" className="small ghost chat-tab chat-tab-mini" onClick={handleAddCustomCategory} aria-label="카테고리 추가">+</button>
            <button type="button" className={`small ghost chat-tab chat-tab-mini${deleteCategoryOpen ? ' active' : ''}`} onClick={handleDeleteCustomCategory} aria-label="카테고리 삭제">-</button>
          </div>
        </div>
      </section>


      {createGroupModalOpen && createPortal(
        <div className="schedule-popup-backdrop chat-category-delete-backdrop" onClick={() => !createGroupSubmitting && setCreateGroupModalOpen(false)}>
          <section className="schedule-popup-card chat-group-create-modal" onClick={event => event.stopPropagation()}>
            <div className="chat-category-delete-topbar chat-group-create-topbar">
              <button type="button" className="ghost small chat-category-delete-back" onClick={() => !createGroupSubmitting && setCreateGroupModalOpen(false)} aria-label="뒤로가기">←</button>
              <strong className="chat-category-delete-title">채팅개설</strong>
              <span className="chat-category-delete-topbar-spacer" aria-hidden="true" />
            </div>
            <div className="chat-group-create-body chat-group-create-body-stacked">
              <div className="chat-group-create-pane chat-group-create-name-pane full-width">
                <input value={createGroupRoomTitle} onChange={e => setCreateGroupRoomTitle(e.target.value)} placeholder="채팅방이름" />
              </div>
              <div className="chat-group-create-pane chat-group-create-friends-pane full-width">
                <div className="chat-group-create-friend-list chat-group-create-friend-list-inline">
                  {friendList.length ? friendList.map(friend => (
                    <label key={`group-friend-${friend.id}`} className="chat-group-create-friend-row">
                      <input type="checkbox" checked={!!createGroupSelections[String(friend.id)]} onChange={() => toggleCreateGroupSelection(friend.id)} />
                      <span>{friend.nickname || friend.name || friend.login_id || `회원 ${friend.id}`}</span>
                    </label>
                  )) : <div className="muted">표시할 친구가 없습니다.</div>}
                </div>
              </div>
            </div>
            <div className="inline-actions end chat-group-create-actions">
              <button type="button" className="small" disabled={createGroupSubmitting} onClick={submitCreateGroupRoom}>{createGroupSubmitting ? '개설 중...' : '초대하기'}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {deleteCategoryOpen && createPortal(
        <div className="schedule-popup-backdrop chat-category-delete-backdrop" onClick={() => setDeleteCategoryOpen(false)}>
          <section className="schedule-popup-card chat-category-delete-modal chat-category-delete-modal-centered" onClick={event => event.stopPropagation()}>
            <div className="chat-category-delete-topbar">
              <button type="button" className="ghost small chat-category-delete-back" onClick={() => setDeleteCategoryOpen(false)} aria-label="뒤로가기">←</button>
              <strong className="chat-category-delete-title">카테고리삭제</strong>
              <span className="chat-category-delete-topbar-spacer" aria-hidden="true" />
            </div>
            <div className="chat-category-delete-panel centered">
              <select value={deleteCategoryTarget} onChange={e => setDeleteCategoryTarget(e.target.value)}>
                {customCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <button type="button" className="small danger chat-category-delete-submit" onClick={confirmDeleteCustomCategory}>삭제</button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <section className="card chat-list-card">
        <div className="chat-list-toolbar chat-list-toolbar-separated">
          <div className="chat-list-toolbar-top chat-list-toolbar-top-right">
            <div className="chat-search-trigger chat-search-trigger-top-right chat-search-inline-row">
              <label className="chat-list-filter-dropdown" aria-label="정렬 필터">
                <span className="chat-list-filter-label">필터</span>
                <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="chat-list-filter-select">
                  <option value="name">이름순</option>
                  <option value="recent">최근등록순</option>
                </select>
              </label>
              <div className={`chat-list-search-inline-wrap${searchOpen ? ' open' : ''}`}>
                {searchOpen && (
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="채팅방 검색" aria-label="채팅방 검색" className="chat-list-search-inline-input" />
                )}
                <button type="button" className="ghost icon-button chat-list-icon-button" onClick={() => setSearchOpen(v => !v)} aria-label="검색">
                  <SearchIcon className="topbar-icon-svg" />
                </button>
              </div>
              <div className="dropdown-wrap">
                <button type="button" className="ghost icon-button chat-list-icon-button" onClick={() => setMenuOpen(v => !v)} aria-label="메뉴">
                  <MenuIcon className="topbar-icon-svg" />
                </button>
                {menuOpen && (
                  <div className="dropdown-menu right">
                    <button type="button" className="dropdown-item" onClick={() => { handleCreateGroupRoom(); setMenuOpen(false) }}>채팅개설</button>
                    <button type="button" className="dropdown-item" onClick={() => { setPinArrangeOpen(true); setMenuOpen(false) }}>채팅방고정 위치변경</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {loading ? <div className="muted">불러오는 중...</div> : (
          <div className="chat-room-list chat-room-list-spaced">
            {filteredRooms.map(room => (
              <button
                key={`${room.room_type}-${room.room_ref}`}
                type="button"
                className="chat-room-row"
                onClick={(event) => handleRoomActivate(event, room)}
                onMouseDown={() => handleRoomPressStart(room)}
                onMouseUp={handleRoomPressEnd}
                onMouseLeave={handleRoomPressEnd}
                onTouchStart={() => handleRoomPressStart(room)}
                onTouchEnd={handleRoomPressEnd}
                onTouchCancel={handleRoomPressEnd}
                onContextMenu={(event) => handleRoomContextMenu(event, room)}
              >
                <RoomAvatar room={room} />
                <div className="chat-room-body-single">
                  <div className="chat-room-topline">
                    <strong className="chat-room-name-single">{room.title}</strong>
                    {room.pinned && <span className="chat-pin-indicator" aria-label="고정">📌</span>}
                    <span className="muted chat-room-datetime">{formatChatUpdatedAt(room.updated_at || room.last_message_at || '')}</span>
                  </div>
                  <div className="chat-room-subtitle-two-line">{room.subtitle || room.last_message || '대화를 시작해 보세요.'}</div>
                </div>
              </button>
            ))}
            {filteredRooms.length === 0 && <div className="muted">표시할 채팅방이 없습니다.</div>}
          </div>
        )}
      </section>
      <ChatActionSheet title={actionRoom?.title} actions={roomActions} onClose={() => setActionRoom(null)} />
      {pinArrangeOpen && (
        <div className="profile-preview-backdrop" onClick={() => setPinArrangeOpen(false)}>
          <div className="chat-popup-menu" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">고정 채팅방 위치변경</div>
            <div className="stack compact-gap pin-arrange-list">
              {pinnedRooms.map((room, index) => (
                <div key={room.id} className="pin-arrange-item">
                  <span className="pin-arrange-title">{room.title}</span>
                  <div className="inline-actions">
                    <button type="button" className="small ghost" disabled={index === 0} onClick={() => movePinnedRoom(room.id, 'up')}>위로</button>
                    <button type="button" className="small ghost" disabled={index === pinnedRooms.length - 1} onClick={() => movePinnedRoom(room.id, 'down')}>아래로</button>
                  </div>
                </div>
              ))}
              {pinnedRooms.length === 0 && <div className="muted">상단 고정된 채팅방이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function ChatRoomPage({ roomType }) {
  const navigate = useNavigate()
  const params = useParams()
  const isMobile = useIsMobile()
  const [roomData, setRoomData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [pickerOpenFor, setPickerOpenFor] = useState(null)
  const [replyTarget, setReplyTarget] = useState(null)
  const [chatActionSheet, setChatActionSheet] = useState(null)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [memberProfilePreview, setMemberProfilePreview] = useState(null)
  const [hiddenMessageIds, setHiddenMessageIds] = useState(() => new Set())
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState(() => new Set())
  const imageInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const roomId = roomType === 'group' ? params.roomId : params.targetUserId

  async function loadRoom() {
    setLoading(true)
    try {
      const data = roomType === 'group'
        ? await api(`/api/group-rooms/${roomId}/messages`)
        : await api(`/api/chat/${roomId}`)
      setRoomData(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRoom().catch(() => setLoading(false))
  }, [roomType, roomId])

  useEffect(() => {
    if (!roomData?.pending_mentions?.length) return
    roomData.pending_mentions.forEach(item => {
      api(`/api/chat-mentions/${item.id}/seen`, { method: 'POST' }).catch(() => {})
    })
  }, [roomData?.pending_mentions])

  async function handleSend(event) {
    event?.preventDefault?.()
    if (sending) return
    const trimmed = message.trim()
    if (!trimmed && !selectedFile) return
    setSending(true)
    try {
      let attachmentPayload = {}
      if (selectedFile) {
        const uploaded = await uploadFile(selectedFile, 'chat')
        const isImage = String(selectedFile.type || '').startsWith('image/')
        attachmentPayload = {
          attachment_name: uploaded.original_name || selectedFile.name,
          attachment_url: uploaded.url,
          attachment_type: isImage ? 'image' : 'file',
        }
      }
      const payload = {
        message: trimmed,
        reply_to_id: replyTarget?.id || null,
        mention_user_id: null,
        ...attachmentPayload,
      }
      if (roomType === 'group') {
        await api(`/api/group-rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await api(`/api/chat/${roomId}`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setMessage('')
      setSelectedFile(null)
      setReplyTarget(null)
      await loadRoom()
    } finally {
      setSending(false)
    }
  }

  async function handleReaction(messageId, emoji) {
    const endpoint = roomType === 'group'
      ? `/api/group-messages/${messageId}/reactions`
      : `/api/dm-messages/${messageId}/reactions`
    await api(endpoint, { method: 'POST', body: JSON.stringify({ emoji }) })
    await loadRoom()
  }

  async function handleStartVoice() {
    try {
      if (roomType === 'group') {
        window.alert('단체 음성통화 기능은 다음 단계에서 연동 예정입니다.')
        return
      }
      const existing = await api(`/api/chat/${roomId}/voice-room`)
      if (existing?.id || existing?.room?.id || existing?.room_id) {
        window.alert('이미 진행 중인 음성통화 방이 있습니다.')
        return
      }
      await api(`/api/chat/${roomId}/voice-room`, { method: 'POST' })
      window.alert('음성통화 요청을 보냈습니다.')
    } catch (error) {
      window.alert(error.message)
    }
  }

  async function handleSendSharedLocation() {
    if (!navigator.geolocation) {
      window.alert('현재 브라우저에서는 위치 공유를 지원하지 않습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const payload = {
          message: '내 위치를 공유했습니다.',
          reply_to_id: replyTarget?.id || null,
          mention_user_id: null,
          attachment_name: '공유 위치',
          attachment_url: `https://maps.google.com/?q=${lat},${lng}`,
          attachment_type: 'location',
        }
        if (roomType === 'group') {
          await api(`/api/group-rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
        } else {
          await api(`/api/chat/${roomId}`, { method: 'POST', body: JSON.stringify(payload) })
        }
        setPlusMenuOpen(false)
        setReplyTarget(null)
        await loadRoom()
      } catch (error) {
        window.alert(error.message)
      }
    }, () => {
      window.alert('위치 권한이 허용되지 않아 현재 위치를 공유할 수 없습니다.')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 })
  }


  function toggleHiddenMessage(messageId) {
    setHiddenMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  function toggleBookmarkMessage(messageId) {
    setBookmarkedMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  async function shareMessage(item) {
    const text = item.message || item.attachment_name || '메시지'
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
    }
    await navigator.clipboard?.writeText(text)
    window.alert('메시지 내용을 클립보드에 복사했습니다.')
  }

  async function sendMessageToSelf(item) {
    const currentUser = getStoredUser()
    if (!currentUser?.id) {
      window.alert('로그인이 필요합니다.')
      return
    }
    const text = item.message || item.attachment_name || '공유 메시지'
    try {
      await api(`/api/chat/${currentUser.id}`, {
        method: 'POST',
        body: JSON.stringify({ message: `[나에게] ${text}`, reply_to_id: null, mention_user_id: null }),
      })
      window.alert('나와의 채팅방으로 메시지를 보냈습니다.')
    } catch (error) {
      window.alert(error.message)
    }
  }

  async function captureMessageText(item) {
    const text = item.message || item.attachment_name || '메시지'
    await navigator.clipboard?.writeText(text)
    window.alert('메시지 내용을 복사했습니다. 필요한 경우 화면 캡처를 진행해 주세요.')
  }

  function deleteMessageLocal(item) {
    if (!window.confirm('이 메시지를 현재 화면에서 숨기시겠습니까?')) return
    toggleHiddenMessage(item.id)
  }

  function openReplyComposer(item) {
    setReplyTarget(item)
    setChatActionSheet(null)
    setMessage(prev => prev || '')
  }

  function openMessageActions(item) {
    setChatActionSheet({
      title: '메시지 메뉴',
      reactions: ['👍', '❤️', '😂', '👏', '🔥'],
      onReact: emoji => {
        setPickerOpenFor(null)
        handleReaction(item.id, emoji).catch(err => window.alert(err.message))
      },
      actions: [
        { label: hiddenMessageIds.has(item.id) ? '가리기 해제' : '가리기', onClick: () => toggleHiddenMessage(item.id) },
        { label: '답장', onClick: () => openReplyComposer(item) },
        { label: '공유', onClick: () => { shareMessage(item).catch(err => window.alert(err.message)) } },
        { label: '나에게', onClick: () => { sendMessageToSelf(item).catch(err => window.alert(err.message)) } },
        { label: bookmarkedMessageIds.has(item.id) ? '책갈피 해제' : '책갈피', onClick: () => toggleBookmarkMessage(item.id) },
        { label: '캡쳐', onClick: () => { captureMessageText(item).catch?.(err => window.alert(err.message)) } },
        ...(String(item.sender_id) === String(getStoredUser()?.id) ? [{ label: '삭제', danger: true, onClick: () => deleteMessageLocal(item) }] : []),
      ],
    })
  }

  function handlePlusAction(action) {
    setPlusMenuOpen(false)
    if (action === 'image') {
      imageInputRef.current?.click()
      return
    }
    if (action === 'file') {
      fileInputRef.current?.click()
      return
    }
    if (action === 'voiceRoom') {
      handleStartVoice().catch(err => window.alert(err.message))
      return
    }
    if (action === 'shareLocation') {
      handleSendSharedLocation().catch?.(() => {})
      return
    }
    if (action === 'voiceMessage') {
      window.alert('음성메세지 기능은 다음 단계에서 연결됩니다.')
      return
    }
    if (action === 'schedule') {
      window.alert('카톡방일정 기능은 다음 단계에서 연결됩니다.')
    }
  }

  const roomTitle = roomType === 'group'
    ? roomData?.room?.title || '단체 채팅방'
    : roomData?.target_user?.nickname || '1:1 채팅'

  const currentUser = getStoredUser()
  const roomMembers = roomType === 'group'
    ? (roomData?.members || [])
    : [currentUser, roomData?.target_user].filter(Boolean)

  const roomMemberCount = roomMembers.length
  const messages = (roomData?.messages || []).filter(item => !hiddenMessageIds.has(item.id))

  function isGroupedMessage(currentItem, previousItem) {
    if (!currentItem || !previousItem) return false
    if (String(currentItem.sender_id || '') !== String(previousItem.sender_id || '')) return false
    const currentTime = new Date(currentItem.created_at || '').getTime()
    const previousTime = new Date(previousItem.created_at || '').getTime()
    if (Number.isNaN(currentTime) || Number.isNaN(previousTime)) return false
    return currentTime - previousTime <= 60 * 1000
  }

  function openMemberProfile(member) {
    setMemberProfilePreview({ ...member, cover_url: loadProfileCover(member?.id) })
  }

  function goDirectChatWithUser(targetId) {
    if (!targetId) return
    setMembersOpen(false)
    setMemberProfilePreview(null)
    navigate(`/chats/${targetId}`)
  }

  return (
    <div className="stack-page chat-room-page-shell">
      <section className="card chat-room-card segmented-chat-layout">
        <header className="chat-room-topbar-section">
          <div className="chat-room-topbar-grid">
            <div className="chat-room-topbar-left">
              <button type="button" className="ghost icon-button chat-header-icon-button" onClick={() => navigate('/chats')} aria-label="뒤로"><ArrowLeftIcon className="topbar-icon-svg" /></button>
              <div className="chat-room-heading compact">
                <strong>{roomTitle}</strong>
                <button type="button" className="chat-member-count-button" onClick={() => setMembersOpen(true)}>{roomMemberCount}명</button>
              </div>
            </div>
            <div className="chat-room-topbar-actions">
              <button type="button" className="ghost icon-button chat-header-icon-button" onClick={() => window.alert('채팅방 검색 기능은 다음 단계에서 연결됩니다.')} aria-label="검색"><SearchIcon className="topbar-icon-svg" /></button>
              <button type="button" className="ghost icon-button chat-header-icon-button" onClick={() => setChatActionSheet({ title: roomTitle, actions: [{ label: '참여자 보기', onClick: () => setMembersOpen(true) }] })} aria-label="메뉴"><MenuIcon className="topbar-icon-svg" /></button>
            </div>
          </div>
        </header>

        <div className="chat-room-messages-section">
          <div className="chat-room-messages">
            {loading && <div className="muted">대화 내용을 불러오는 중...</div>}
            {!loading && messages.length === 0 && <div className="muted">아직 메시지가 없습니다. 첫 메시지를 보내보세요.</div>}
            {!loading && messages.map((item, index) => {
              const mine = String(item.sender_id) === String(currentUser?.id)
              const previousItem = index > 0 ? messages[index - 1] : null
              const groupedWithPrevious = isGroupedMessage(item, previousItem)
              const longPressHandlers = isMobile ? useLongPress(() => openMessageActions(item), 500) : {}
              return (
                <div key={item.id} className={`chat-message-row${mine ? ' mine' : ''}${groupedWithPrevious ? ' grouped' : ''}`} {...longPressHandlers}>
                  {!mine && !groupedWithPrevious && <AvatarCircle src={item.sender?.photo_url} label={item.sender?.nickname || '회원'} size={36} className="chat-message-avatar" />}
                  {!mine && groupedWithPrevious && <div className="chat-message-avatar-spacer" aria-hidden="true" />}
                  <div className={`chat-message-content${mine ? ' mine' : ''}${groupedWithPrevious ? ' grouped' : ''}`}>
                    {!mine && !groupedWithPrevious && (
                      <div className="chat-message-headerline">
                        <strong>{item.sender?.nickname || '회원'}</strong>
                        <span className="muted">{formatChatUpdatedAt(item.created_at || '')}</span>
                      </div>
                    )}
                    <div className={`chat-message-bubble-row${mine ? ' mine' : ''}${groupedWithPrevious ? ' grouped' : ''}`}>
                      {!isMobile && mine && (
                        <div className={`chat-message-tools inline${mine ? ' mine' : ''}`}>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => openReplyComposer(item)}>답장</button>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => setPickerOpenFor(pickerOpenFor === item.id ? null : item.id)}>반응</button>
                        </div>
                      )}
                      {mine && !groupedWithPrevious && <span className="chat-message-inline-time muted">{formatChatUpdatedAt(item.created_at || '')}</span>}
                      <div className={`chat-bubble${mine ? ' mine' : ''}`}>
                        {item.reply_to?.message && <div className="chat-reply-preview">↳ {item.reply_to.message}</div>}
                        {item.message && <div className="chat-bubble-text">{item.message}</div>}
                        <AttachmentPreview message={item} />
                      </div>
                      {!isMobile && !mine && (
                        <div className={`chat-message-tools inline${mine ? ' mine' : ''}`}>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => openReplyComposer(item)}>답장</button>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => setPickerOpenFor(pickerOpenFor === item.id ? null : item.id)}>반응</button>
                        </div>
                      )}
                    </div>
                    {(item.reaction_summary || []).length > 0 && (
                      <div className={`chat-message-reaction-summary${mine ? ' mine' : ''}`}>
                        {(item.reaction_summary || []).map(reaction => (
                          <button
                            key={`${item.id}-${reaction.emoji}`}
                            type="button"
                            className="reaction-pill"
                            onClick={() => handleReaction(item.id, reaction.emoji).catch(err => window.alert(err.message))}
                          >
                            {reaction.emoji} {reaction.count}
                          </button>
                        ))}
                      </div>
                    )}
                    {pickerOpenFor === item.id && (
                      <div className="emoji-picker-row">
                        {['👍', '❤️', '😂', '👏', '🔥'].map(emoji => (
                          <button
                            key={`${item.id}-${emoji}`}
                            type="button"
                            className="emoji-button"
                            onClick={() => {
                              setPickerOpenFor(null)
                              handleReaction(item.id, emoji).catch(err => window.alert(err.message))
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="chat-room-compose-section">
          {replyTarget && (
            <div className="chat-reply-draft-bar">
              <div className="chat-reply-draft-text">
                <strong>{replyTarget.sender?.nickname || '회원'}에게 답장</strong>
                <div>{replyTarget.message || replyTarget.attachment_name || '첨부 메시지'}</div>
              </div>
              <button type="button" className="small ghost" onClick={() => setReplyTarget(null)}>취소</button>
            </div>
          )}
          {selectedFile && (
            <div className="chat-selected-file-bar">
              <span>{selectedFile.name}</span>
              <button type="button" className="small ghost" onClick={() => setSelectedFile(null)}>제거</button>
            </div>
          )}
          <form className="chat-compose-box compact" onSubmit={handleSend}>
            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={event => setSelectedFile(event.target.files?.[0] || null)} />
            <input ref={fileInputRef} type="file" hidden onChange={event => setSelectedFile(event.target.files?.[0] || null)} />
            <button type="button" className="chat-plus-button" onClick={() => setPlusMenuOpen(true)} aria-label="채팅 부가 기능">＋</button>
            <input
              value={message}
              onChange={event => setMessage(event.target.value)}
              placeholder="메시지를 입력하세요"
              className="chat-message-input"
            />
            <button type="submit" className="chat-send-button" disabled={sending}>{sending ? '전송중' : '전송'}</button>
          </form>
        </div>
      </section>

      <ChatActionSheet
        title={chatActionSheet?.title}
        actions={chatActionSheet?.actions}
        reactions={chatActionSheet?.reactions}
        onReact={chatActionSheet?.onReact}
        onClose={() => setChatActionSheet(null)}
      />

      {plusMenuOpen && (
        <div className="sheet-backdrop sheet-backdrop-bottom" onClick={() => setPlusMenuOpen(false)}>
          <div className="chat-bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">채팅 부가 기능</div>
            <div className="chat-plus-grid">
              {CHAT_PLUS_ACTIONS.map(([value, label]) => (
                <button key={value} type="button" className="chat-plus-action" onClick={() => handlePlusAction(value)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {membersOpen && (
        <div className="profile-preview-backdrop" onClick={() => setMembersOpen(false)}>
          <div className="chat-popup-menu member-list-popup" onClick={e => e.stopPropagation()}>
            <div className="member-list-popup-header">
              <button type="button" className="small ghost member-list-back-button" onClick={() => setMembersOpen(false)}>뒤로</button>
              <div className="sheet-title member-list-title">참여 인원 {roomMemberCount}명</div>
              <span className="member-list-header-spacer" aria-hidden="true" />
            </div>
            <div className="chat-member-list">
              {roomMembers.map(member => (
                <button key={`member-${member.id || member.nickname}`} type="button" className="chat-member-list-item clickable" onClick={() => openMemberProfile(member)}>
                  <AvatarCircle src={member.photo_url} label={member.nickname || '회원'} size={40} />
                  <span>{member.nickname || '회원'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {memberProfilePreview && (
        <div className="profile-preview-backdrop" onClick={() => setMemberProfilePreview(null)}>
          <div className="profile-preview-card" onClick={e => e.stopPropagation()}>
            <div className="profile-preview-cover" style={memberProfilePreview.cover_url ? { backgroundImage: `url(${memberProfilePreview.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
            <div className="profile-preview-main">
              <AvatarCircle src={memberProfilePreview.photo_url} label={memberProfilePreview.nickname} size={88} className="profile-preview-avatar" />
              <div className="profile-preview-name">{memberProfilePreview.nickname || '회원'}</div>
              <div className="profile-preview-oneliner">{memberProfilePreview.one_liner || memberProfilePreview.bio || memberProfilePreview.region || '한줄소개가 없습니다.'}</div>
              <div className="inline-actions wrap center profile-preview-actions">
                <button type="button" onClick={() => goDirectChatWithUser(memberProfilePreview.id)}>채팅</button>
                {String(memberProfilePreview.id) !== String(currentUser?.id) && <button type="button" className="ghost" onClick={() => window.alert('음성 기능은 다음 단계에서 연결됩니다.')}>음성</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



function splitScheduleAssigneeNames(value) {
  return String(value || '')
    .replace(/[\[\]]/g, ' ')
    .split(/[,\n\/|]+/)
    .map(token => token.trim())
    .flatMap(token => token.split(/\s{2,}/).map(part => part.trim()))
    .filter(Boolean)
}

function buildUserIdentityTokens(user = {}) {
  return [
    user.name,
    user.nickname,
    user.display_name,
    user.email,
    user.username,
    user.login_id,
    user.user_id,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
}

function findTaggedUsersForSchedule(scheduleItem, users = []) {
  const names = [
    ...splitScheduleAssigneeNames(scheduleItem?.representative_text),
    ...splitScheduleAssigneeNames(scheduleItem?.staff_text),
  ]
  const normalizedNames = [...new Set(names.map(name => name.replace(/\s+/g, '').toLowerCase()).filter(Boolean))]
  if (!normalizedNames.length) return []
  return users.filter(user => {
    const tokens = buildUserIdentityTokens(user).map(token => token.replace(/\s+/g, '').toLowerCase())
    return normalizedNames.some(name => tokens.some(token => token && (token === name || token.includes(name) || name.includes(token))))
  })
}

function getUserBaseAddress(user = {}) {
  return String(user?.resident_address || user?.business_address || user?.region || '').trim()
}

function normalizeMarkerPositionTitle(value) {
  return String(value || '')
    .replace(/님/g, '')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s+/g, '')
    .trim()
}

function isExecutivePositionTitle(value) {
  const title = normalizeMarkerPositionTitle(value)
  return ['대표', '부대표', '호점대표'].some(keyword => title.includes(keyword))
}

function isStaffPositionTitle(value) {
  const title = normalizeMarkerPositionTitle(value)
  return ['팀장', '부팀장', '직원', '현장직원', '본사직원'].some(keyword => title.includes(keyword))
}

function resolveStaffMarkerTone(user = {}) {
  const title = normalizeMarkerPositionTitle(user.position_title || user.position || user.grade_name || '')
  if (isExecutivePositionTitle(title)) return 'executive'
  return 'staff'
}

function haversineDistanceKm(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY
  const lat1 = Number(a.lat)
  const lon1 = Number(a.lng)
  const lat2 = Number(b.lat)
  const lon2 = Number(b.lng)
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY
  const toRad = value => value * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function buildAddressSimilarityScore(source, target) {
  const a = String(source || '').trim()
  const b = String(target || '').trim()
  if (!a || !b) return -1
  const aTokens = a.split(/\s+/).filter(Boolean)
  const bTokens = new Set(b.split(/\s+/).filter(Boolean))
  let score = 0
  aTokens.forEach((token, index) => {
    if (bTokens.has(token)) score += Math.max(1, 4 - index)
  })
  return score
}

const KOREA_ADDRESS_FALLBACK_CENTERS = {
  '서울': { lat: 37.5665, lng: 126.9780 },
  '경기': { lat: 37.2636, lng: 127.0286 },
  '인천': { lat: 37.4563, lng: 126.7052 },
  '부산': { lat: 35.1796, lng: 129.0756 },
  '대구': { lat: 35.8714, lng: 128.6014 },
  '광주': { lat: 35.1595, lng: 126.8526 },
  '대전': { lat: 36.3504, lng: 127.3845 },
  '울산': { lat: 35.5384, lng: 129.3114 },
  '세종': { lat: 36.4800, lng: 127.2890 },
  '강원': { lat: 37.8228, lng: 128.1555 },
  '충북': { lat: 36.6357, lng: 127.4917 },
  '충남': { lat: 36.6588, lng: 126.6728 },
  '전북': { lat: 35.8202, lng: 127.1089 },
  '전남': { lat: 34.8161, lng: 126.4629 },
  '경북': { lat: 36.5760, lng: 128.5056 },
  '경남': { lat: 35.2383, lng: 128.6926 },
  '제주': { lat: 33.4996, lng: 126.5312 },
  '서울 강서구': { lat: 37.5509, lng: 126.8495 },
  '서울 양천구': { lat: 37.5169, lng: 126.8666 },
  '서울 구로구': { lat: 37.4954, lng: 126.8874 },
  '서울 금천구': { lat: 37.4569, lng: 126.8956 },
  '서울 영등포구': { lat: 37.5264, lng: 126.8962 },
  '서울 동작구': { lat: 37.5124, lng: 126.9393 },
  '서울 관악구': { lat: 37.4782, lng: 126.9515 },
  '서울 서초구': { lat: 37.4837, lng: 127.0324 },
  '서울 강남구': { lat: 37.5172, lng: 127.0473 },
  '서울 송파구': { lat: 37.5145, lng: 127.1059 },
  '서울 강동구': { lat: 37.5301, lng: 127.1238 },
  '서울 마포구': { lat: 37.5663, lng: 126.9019 },
  '서울 서대문구': { lat: 37.5792, lng: 126.9368 },
  '서울 은평구': { lat: 37.6176, lng: 126.9227 },
  '서울 종로구': { lat: 37.5735, lng: 126.9790 },
  '서울 중구': { lat: 37.5636, lng: 126.9976 },
  '서울 용산구': { lat: 37.5324, lng: 126.9900 },
  '서울 성동구': { lat: 37.5634, lng: 127.0369 },
  '서울 광진구': { lat: 37.5384, lng: 127.0822 },
  '서울 동대문구': { lat: 37.5744, lng: 127.0396 },
  '서울 중랑구': { lat: 37.6066, lng: 127.0926 },
  '서울 성북구': { lat: 37.5894, lng: 127.0167 },
  '서울 강북구': { lat: 37.6398, lng: 127.0257 },
  '서울 도봉구': { lat: 37.6688, lng: 127.0471 },
  '서울 노원구': { lat: 37.6542, lng: 127.0568 },
  '경기 고양시': { lat: 37.6584, lng: 126.8320 },
  '경기 파주시': { lat: 37.7600, lng: 126.7802 },
  '경기 의정부시': { lat: 37.7381, lng: 127.0338 },
  '경기 양주시': { lat: 37.7853, lng: 127.0458 },
  '경기 남양주시': { lat: 37.6360, lng: 127.2165 },
  '경기 구리시': { lat: 37.5943, lng: 127.1296 },
  '경기 하남시': { lat: 37.5392, lng: 127.2149 },
  '경기 성남시': { lat: 37.4200, lng: 127.1267 },
  '경기 용인시': { lat: 37.2411, lng: 127.1776 },
  '경기 수원시': { lat: 37.2636, lng: 127.0286 },
  '경기 부천시': { lat: 37.5034, lng: 126.7660 },
  '경기 안양시': { lat: 37.3943, lng: 126.9568 },
  '경기 광명시': { lat: 37.4786, lng: 126.8646 },
  '경기 김포시': { lat: 37.6152, lng: 126.7156 },
  '경기 시흥시': { lat: 37.3803, lng: 126.8029 },
  '경기 안산시': { lat: 37.3219, lng: 126.8309 },
  '경기 여주시': { lat: 37.2982, lng: 127.6376 },
  '경기 이천시': { lat: 37.2722, lng: 127.4350 },
  '경기 양평군': { lat: 37.4918, lng: 127.4876 },
  '인천 부평구': { lat: 37.5070, lng: 126.7219 },
  '인천 계양구': { lat: 37.5371, lng: 126.7378 },
  '인천 서구': { lat: 37.5453, lng: 126.6758 },
  '인천 남동구': { lat: 37.4473, lng: 126.7314 },
  '인천 미추홀구': { lat: 37.4635, lng: 126.6506 },
}

function normalizeAdministrativeAddress(address) {
  return String(address || '')
    .replace(/서울특별시/g, '서울')
    .replace(/부산광역시/g, '부산')
    .replace(/대구광역시/g, '대구')
    .replace(/인천광역시/g, '인천')
    .replace(/광주광역시/g, '광주')
    .replace(/대전광역시/g, '대전')
    .replace(/울산광역시/g, '울산')
    .replace(/세종특별자치시/g, '세종')
    .replace(/경기도/g, '경기')
    .replace(/강원특별자치도|강원도/g, '강원')
    .replace(/충청북도/g, '충북')
    .replace(/충청남도/g, '충남')
    .replace(/전라북도|전북특별자치도/g, '전북')
    .replace(/전라남도/g, '전남')
    .replace(/경상북도/g, '경북')
    .replace(/경상남도/g, '경남')
    .replace(/제주특별자치도|제주도/g, '제주')
    .replace(/특별시/g, '')
    .replace(/광역시/g, '')
    .replace(/특별자치시/g, '')
    .replace(/특별자치도/g, '')
    .replace(/자치시/g, '')
    .replace(/자치도/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveFallbackPointFromAddress(address) {
  const normalized = normalizeAdministrativeAddress(address)
  if (!normalized) return null
  const keys = Object.keys(KOREA_ADDRESS_FALLBACK_CENTERS).sort((a, b) => b.length - a.length)
  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length >= 3) {
    const key3 = `${tokens[0]} ${tokens[1]} ${tokens[2]}`
    if (KOREA_ADDRESS_FALLBACK_CENTERS[key3]) return { ...KOREA_ADDRESS_FALLBACK_CENTERS[key3], label: normalized, approximate: true }
  }
  if (tokens.length >= 2) {
    const key2 = `${tokens[0]} ${tokens[1]}`
    if (KOREA_ADDRESS_FALLBACK_CENTERS[key2]) return { ...KOREA_ADDRESS_FALLBACK_CENTERS[key2], label: normalized, approximate: true }
  }
  const directKey = keys.find(key => normalized === key || normalized.startsWith(`${key} `))
  if (directKey) return { ...KOREA_ADDRESS_FALLBACK_CENTERS[directKey], label: normalized, approximate: true }
  const compact = normalized.replace(/\s+/g, ' ').trim()
  const provinceOnlyMap = {
    '서울': '서울 종로구',
    '경기': '경기 수원시',
    '인천': '인천 미추홀구',
    '부산': '부산',
    '대구': '대구',
    '광주': '광주',
    '대전': '대전',
    '울산': '울산',
    '세종': '세종',
    '강원': '강원',
    '충북': '충북',
    '충남': '충남',
    '전북': '전북',
    '전남': '전남',
    '경북': '경북',
    '경남': '경남',
    '제주': '제주',
  }
  if (provinceOnlyMap[compact] && KOREA_ADDRESS_FALLBACK_CENTERS[provinceOnlyMap[compact]]) {
    return { ...KOREA_ADDRESS_FALLBACK_CENTERS[provinceOnlyMap[compact]], label: normalized, approximate: true }
  }
  const bareToken = tokens[0] || ''
  const matchedKey = keys.find(key => key.endsWith(` ${compact}`))
    || keys.find(key => key.endsWith(` ${bareToken}`))
    || keys.find(key => key.includes(` ${compact}`))
    || keys.find(key => key.includes(` ${bareToken}`))
  if (matchedKey) return { ...KOREA_ADDRESS_FALLBACK_CENTERS[matchedKey], label: normalized, approximate: true }
  return null
}

function sanitizeGeocodeAddress(address) {
  const normalized = String(address || '').trim()
  if (!normalized) return ''
  return normalized
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/([0-9가-힣])([A-Za-z]{1,4})$/g, '$1')
    .replace(/,+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function geocodeAddress(address) {
  const normalized = sanitizeGeocodeAddress(address)
  if (!normalized) return null
  const memoryCache = window.__icjGeocodeCache = window.__icjGeocodeCache || {}
  if (memoryCache[normalized]) return memoryCache[normalized]
  try {
    const storageKey = `icj_geocode_${normalized}`
    const stored = window.localStorage.getItem(storageKey)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
        memoryCache[normalized] = parsed
        return parsed
      }
    }
  } catch (_) {}

  const fallbackPoint = deriveFallbackPointFromAddress(normalized)
  if (fallbackPoint && Number.isFinite(Number(fallbackPoint.lat)) && Number.isFinite(Number(fallbackPoint.lng))) {
    const normalizedPoint = { lat: Number(fallbackPoint.lat), lng: Number(fallbackPoint.lng), label: normalized, approximate: true }
    memoryCache[normalized] = normalizedPoint
    try {
      window.localStorage.setItem(`icj_geocode_${normalized}`, JSON.stringify(normalizedPoint))
    } catch (_) {}
    return normalizedPoint
  }

  return null
}

function extractScheduleAssignedNames(item, kind = 'business') {
  const keys = kind === 'business'
    ? ['representative1', 'representative2', 'representative3']
    : ['staff1', 'staff2', 'staff3']
  const direct = keys.map(key => String(item?.[key] || '').trim()).filter(Boolean)
  if (direct.length) return [...new Set(direct)]
  const merged = String(
    kind === 'business'
      ? (item?.representative_names || item?.representative_text || '')
      : (item?.staff_names || item?.staff_text || '')
  ).trim()
  if (!merged) return []
  return [...new Set(merged.split(/[\n,\/]+/).map(token => token.trim()).filter(Boolean))]
}

async function resolveMapDepartureData(scheduleItems = [], users = []) {
  const filteredItems = (scheduleItems || []).filter(item => String(item?.start_address || item?.location || item?.end_address || '').trim())
  const uniqueAddresses = [...new Set(filteredItems.flatMap(item => ([
    sanitizeGeocodeAddress(item.start_address || item.location || ''),
    sanitizeGeocodeAddress(item.end_address || ''),
  ])).filter(Boolean))]
  const addressPoints = {}
  await Promise.all(uniqueAddresses.map(async address => {
    addressPoints[address] = await geocodeAddress(address)
  }))

  const eligibleUsers = (users || []).filter(user => {
    const title = normalizeMarkerPositionTitle(user?.position_title || user?.position || user?.grade_name || '')
    return isExecutivePositionTitle(title) || isStaffPositionTitle(title)
  })

  const accountCandidates = []
  for (const user of eligibleUsers) {
    const address = getUserBaseAddress(user)
    if (!address) continue
    const point = await geocodeAddress(address)
    accountCandidates.push({
      id: `account-${user.id}`,
      scheduleId: null,
      userId: user.id,
      displayName: user.name || user.nickname || user.display_name || user.email || '미지정',
      nickname: user.nickname || user.name || user.display_name || user.email || '미지정',
      positionTitle: user.position_title || user.position || '',
      branchNo: user.branch_no || user.branch || user.branchNumber || '',
      address,
      point,
      tone: resolveStaffMarkerTone(user),
      markerKind: resolveStaffMarkerTone(user) === 'executive' ? 'business-start' : 'staff-start',
    })
  }

  const accountMap = new Map()
  accountCandidates.forEach(item => {
    const key = `${item.userId}-${item.address}`
    if (!accountMap.has(key)) accountMap.set(key, item)
  })
  const accountMarkers = [...accountMap.values()].filter(item => item.point)

  const customerMarkers = filteredItems.flatMap(item => {
    const startAddress = sanitizeGeocodeAddress(item.start_address || item.location || '')
    const endAddress = sanitizeGeocodeAddress(item.end_address || '')
    return [
      {
        id: `customer-start-${item.id}`,
        scheduleId: item.id,
        title: item.customer_name || item.title || '고객',
        address: startAddress,
        point: addressPoints[startAddress] || null,
        raw: item,
        markerKind: 'customer-start',
      },
      {
        id: `customer-end-${item.id}`,
        scheduleId: item.id,
        title: item.customer_name || item.title || '고객',
        address: endAddress,
        point: addressPoints[endAddress] || null,
        raw: item,
        markerKind: 'customer-end',
      },
    ].filter(entry => entry.address && entry.point)
  })

  const accountEndMarkers = filteredItems.flatMap(item => {
    const endAddress = sanitizeGeocodeAddress(item.end_address || '')
    const endPoint = addressPoints[endAddress] || null
    if (!endAddress || !endPoint) return []
    const customerLabel = item.customer_name || item.title || '고객'
    const businessNames = extractScheduleAssignedNames(item, 'business')
    const staffNames = extractScheduleAssignedNames(item, 'staff')
    return [
      ...businessNames.map((name, index) => ({
        id: `business-end-${item.id}-${index}-${name}`,
        scheduleId: item.id,
        title: customerLabel,
        displayName: name,
        address: endAddress,
        point: endPoint,
        raw: item,
        markerKind: 'business-end',
      })),
      ...staffNames.map((name, index) => ({
        id: `staff-end-${item.id}-${index}-${name}`,
        scheduleId: item.id,
        title: customerLabel,
        displayName: name,
        address: endAddress,
        point: endPoint,
        raw: item,
        markerKind: 'staff-end',
      })),
    ]
  })

  const customerList = filteredItems.map(item => {
    const address = sanitizeGeocodeAddress(item.start_address || item.location || '')
    const customerPoint = addressPoints[address] || null
    const nearest = accountMarkers
      .map(account => ({
        ...account,
        distanceKm: haversineDistanceKm(customerPoint, account.point),
        similarityScore: buildAddressSimilarityScore(address, account.address),
      }))
      .sort((a, b) => {
        const aDistance = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY
        const bDistance = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY
        if (aDistance !== bDistance) return aDistance - bDistance
        return b.similarityScore - a.similarityScore
      })[0] || null
    const rankedAccounts = accountMarkers
      .map(account => ({
        ...account,
        distanceKm: haversineDistanceKm(customerPoint, account.point),
        similarityScore: buildAddressSimilarityScore(address, account.address),
      }))
      .sort((a, b) => {
        const aDistance = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.POSITIVE_INFINITY
        const bDistance = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.POSITIVE_INFINITY
        if (aDistance !== bDistance) return aDistance - bDistance
        return b.similarityScore - a.similarityScore
      })
    const businessCandidates = rankedAccounts.filter(account => account.tone === 'executive').slice(0, 3)
    const staffCandidates = rankedAccounts.filter(account => account.tone !== 'executive').slice(0, 3)
    return {
      id: `customer-list-${item.id}`,
      title: item.customer_name || item.title || '고객',
      address,
      point: customerPoint,
      visitTime: item.visit_time || item.start_time || '',
      departmentInfo: item.department_info || '',
      startTime: item.start_time || '',
      nearestLabel: nearest ? `${nearest.displayName || nearest.nickname}${Number.isFinite(nearest.distanceKm) ? ` · 약 ${nearest.distanceKm.toFixed(1)}` : ''}` : '가까운 계정 계산 대기',
      businessCandidates,
      staffCandidates,
      geocodeApproximate: Boolean(customerPoint?.approximate),
      raw: item,
    }
  })

  return { customerMarkers, accountMarkers, accountEndMarkers, customerList }
}

function MapPage() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const markerLayerRef = useRef(null)
  const watchIdRef = useRef(null)
  const shareToastTimerRef = useRef(null)
  const dateInputRef = useRef(null)
  const [users, setUsers] = useState([])
  const [accountUsers, setAccountUsers] = useState([])
  const [scheduleItems, setScheduleItems] = useState([])
  const [shareNotice, setShareNotice] = useState('')
  const [mapFilterOpen, setMapFilterOpen] = useState(false)
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false)
  const [mapDisplayOpen, setMapDisplayOpen] = useState(false)
  const [mapDisplay2Open, setMapDisplay2Open] = useState(false)
  const [mapFilter, setMapFilter] = useState('live')
  const [mapDisplayOptions, setMapDisplayOptions] = useState({
    customerStart: true,
    customerEnd: false,
    businessStart: true,
    staffStart: true,
  })
  const [mapDisplayLabelOptions, setMapDisplayLabelOptions] = useState({
    showName: false,
    showBranch: false,
    showPosition: false,
    showCustomer: false,
  })
  const [selectedDate, setSelectedDate] = useState(() => fmtDate(new Date()))
  const [departureData, setDepartureData] = useState({ customerMarkers: [], accountMarkers: [], accountEndMarkers: [], customerList: [] })
  const [shareStatus, setShareStatus] = useState({ eligible: false, consent_granted: false, sharing_enabled: false, active_now: false, active_assignment: null })

  function showShareNotice(message) {
    setShareNotice(message)
    if (shareToastTimerRef.current) window.clearTimeout(shareToastTimerRef.current)
    shareToastTimerRef.current = window.setTimeout(() => setShareNotice(''), 2600)
  }

  function buildMapUsersWithDemo(list) {
    const base = Array.isArray(list) ? [...list] : []
    const hasDemo = base.some(item => String(item?.id) === 'demo-vehicle')
    if (!hasDemo) {
      base.push({
        id: 'demo-vehicle',
        nickname: '테스트 차량',
        branch_no: 99,
        vehicle_number: '테스트-0000',
        region: '서울 테스트위치',
        latitude: 37.5665,
        longitude: 126.978,
        map_status: { status_text: '현위치 서울 테스트위치에 있고 정차 중', current_location: '서울 테스트위치', is_moving: false },
      })
    }
    return base
  }

  async function loadMapUsers() {
    try {
      const list = await api('/api/map-users')
      setUsers(buildMapUsersWithDemo(list || []))
    } catch (_) {
      setUsers(buildMapUsersWithDemo([]))
    }
  }

  async function loadAccountUsers() {
    try {
      const list = await api('/api/users')
      setAccountUsers(Array.isArray(list) ? list : [])
    } catch (_) {
      setAccountUsers([])
    }
  }

  async function loadSchedules(dateValue = selectedDate) {
    try {
      const list = await api(`/api/calendar/events?start_date=${dateValue}&end_date=${dateValue}`)
      setScheduleItems(Array.isArray(list) ? list : [])
    } catch (_) {
      setScheduleItems([])
    }
  }

  async function refreshStatus() {
    try {
      const status = await api('/api/location-sharing/status')
      setShareStatus(status || {})
    } catch (_) {}
  }

  useEffect(() => {
    loadMapUsers().catch(() => {})
    loadAccountUsers().catch(() => {})
    loadSchedules(selectedDate).catch(() => {})
    refreshStatus().catch(() => {})
    return () => {
      if (shareToastTimerRef.current) window.clearTimeout(shareToastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    loadSchedules(selectedDate).catch(() => {})
  }, [selectedDate])

  useEffect(() => {
    let ignore = false
    async function updateDeparture() {
      if (mapFilter === 'live') return
      const resolved = await resolveMapDepartureData(scheduleItems, accountUsers)
      if (!ignore) setDepartureData(resolved)
    }
    updateDeparture().catch(() => {
      if (!ignore) setDepartureData({ customerMarkers: [], accountMarkers: [], accountEndMarkers: [], customerList: [] })
    })
    return () => { ignore = true }
  }, [mapFilter, scheduleItems, accountUsers])

  async function handleToggleShare(nextEnabled) {
    if (!nextEnabled) {
      await api('/api/location-sharing/consent', { method: 'POST', body: JSON.stringify({ enabled: false }) })
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      await refreshStatus()
      return
    }
    const status = await api('/api/location-sharing/status')
    if (!status?.eligible) {
      window.alert('차량번호와 호점이 등록된 계정에서만 사용할 수 있습니다.')
      return
    }
    if (!isMobile) {
      window.alert('내 위치 공유는 모바일에서만 실제 위치가 갱신됩니다. PC 로그인 상태에서는 위치가 업데이트되지 않습니다.')
    }
    const approved = window.confirm('배정된 일정 시간대(시작 1시간 전 ~ 종료 30분 후)에만 위치를 공유합니다. 계속하시겠습니까?')
    if (!approved) return
    await api('/api/location-sharing/consent', { method: 'POST', body: JSON.stringify({ enabled: true }) })
    await refreshStatus()
    showShareNotice('내위치 공유가 켜져 있습니다. 배정 시간대에 자동 공유됩니다.')
  }

  useEffect(() => {
    let cancelled = false
    async function syncWatcher() {
      try {
        const status = await api('/api/location-sharing/status')
        if (cancelled) return
        setShareStatus(status || {})
        if (!status?.sharing_enabled || !Array.isArray(status?.today_assignments) || status.today_assignments.length === 0 || !navigator.geolocation || !isMobile) {
          if (watchIdRef.current !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
          }
          return
        }
        if (watchIdRef.current !== null) return
        watchIdRef.current = navigator.geolocation.watchPosition(async pos => {
          try {
            const currentUser = getStoredUser()
            await api('/api/profile/location', {
              method: 'POST',
              body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, region: currentUser?.region || '서울' }),
            })
            if (!cancelled) loadMapUsers().catch(() => {})
          } catch (_) {}
        }, () => {
          showShareNotice('위치 권한이 거부되어 지도 공개를 진행할 수 없습니다.')
        }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })
      } catch (_) {}
    }
    syncWatcher()
    const timer = window.setInterval(syncWatcher, 45000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true }).setView([37.5665, 126.9780], 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    leafletRef.current = map
    return () => {
      map.remove()
      leafletRef.current = null
    }
  }, [])

  const activeMarkers = useMemo(() => {
    const customer = (departureData.customerMarkers || [])
      .filter(item => {
        if (item.markerKind === 'customer-start') return mapDisplayOptions.customerStart
        if (item.markerKind === 'customer-end') return mapDisplayOptions.customerEnd
        return false
      })
      .map(item => ({
        type: item.markerKind === 'customer-end' ? 'customer-end' : 'customer-start',
        id: item.id,
        lat: item.point?.lat,
        lng: item.point?.lng,
        label: '',
        customerName: item.title || '고객',
        popup: `<strong>${item.title}</strong><br/>${item.markerKind === 'customer-end' ? '도착지' : '출발지'}<br/>${item.address}`,
      }))
    const accounts = (departureData.accountMarkers || [])
      .filter(item => {
        if (item.markerKind === 'business-start') return mapDisplayOptions.businessStart
        if (item.markerKind === 'staff-start') return mapDisplayOptions.staffStart
        return false
      })
      .map(item => ({
        type: item.markerKind === 'business-start' ? 'business-start' : 'staff-start',
        id: item.id,
        lat: item.point?.lat,
        lng: item.point?.lng,
        label: '',
        accountName: item.displayName || item.nickname || '',
        branchNo: item.branchNo || '',
        positionTitle: item.positionTitle || '',
        popup: `<strong>${item.displayName || item.nickname}</strong><br/>${item.positionTitle || '계정'}<br/>${item.address}`,
      }))
    if (mapFilter === 'departure') {
      return [...customer, ...accounts].filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    }
    if (mapFilter === 'all') {
      return [...accounts].filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    }
    return (users || []).map(item => ({
      type: item.map_status?.is_moving ? 'moving' : 'stopped',
      id: item.id,
      lat: Number(item.latitude),
      lng: Number(item.longitude),
      label: ENCLOSED_NUMBERS[item.branch_no] || String(item.branch_no || '?'),
      accountName: item.name || item.nickname || item.display_name || '',
      branchNo: item.branch_no || '',
      positionTitle: item.position_title || item.position || item.grade_name || '',
      popup: `<strong>${item.branch_no || '-'}호점</strong><br/>${item.nickname}<br/>${item.vehicle_number || '-'}<br/>${item.region}`,
    })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
  }, [mapFilter, users, departureData, mapDisplayOptions])

  useEffect(() => {
    if (!leafletRef.current || !markerLayerRef.current) return
    markerLayerRef.current.clearLayers()
    if (activeMarkers.length === 0) return
    const bounds = []
    activeMarkers.forEach(item => {
      const markerClass = item.type === 'customer-start'
        ? 'branch-marker customer-start'
        : item.type === 'customer-end'
          ? 'branch-marker customer-end'
          : item.type === 'business-start'
            ? 'branch-marker business-start'
            : item.type === 'staff-start'
              ? 'branch-marker staff-start'
              : item.type === 'business-end'
                ? 'branch-marker business-end'
                : item.type === 'staff-end'
                  ? 'branch-marker staff-end'
                  : item.type === 'moving'
                    ? 'branch-marker moving'
                    : 'branch-marker stopped'
      const markerSize = item.type === 'moving' || item.type === 'stopped' ? 28 : 9
      const metaLabel = buildMarkerMetaLabel(item, mapDisplayLabelOptions)
      const leftLabelHtml = metaLabel.left ? `<span class="branch-marker-meta-left">${escapePopupHtml(metaLabel.left)}</span>` : ''
      const rightLabelHtml = metaLabel.right ? `<span class="branch-marker-meta-right">${escapePopupHtml(metaLabel.right)}</span>` : ''
      const metaHtml = (leftLabelHtml || rightLabelHtml) ? `<div class="branch-marker-meta">${leftLabelHtml}${rightLabelHtml}</div>` : ''
      const markerHtml = `<div class="branch-marker-stack"><div class="${markerClass}">${item.label}</div>${metaHtml}</div>`
      const icon = L.divIcon({ className: 'branch-marker-wrap', html: markerHtml, iconSize: [Math.max(markerSize, 96), markerSize + (metaHtml ? 24 : 0)], iconAnchor: [markerSize / 2, markerSize / 2] })
      L.marker([item.lat, item.lng], { icon }).bindPopup(item.popup).addTo(markerLayerRef.current)
      bounds.push([item.lat, item.lng])
    })
    if (bounds.length === 1) leafletRef.current.setView(bounds[0], 12)
    else leafletRef.current.fitBounds(bounds, { padding: [30, 30] })
  }, [activeMarkers, mapDisplayLabelOptions])

  function handlePickDate(value) {
    if (!value) return
    setSelectedDate(value)
    setMapFilter('departure')
    setMapFilterOpen(false)
    setMapSettingsOpen(false)
    setMapDisplayOpen(false)
    setMapDisplay2Open(false)
  }

  function insertTemplateToken(token) {
    setTemplateDraft(prev => {
      const base = String(prev || '')
      if (!base.trim()) return String(token || '')
      return `${base}${base.endsWith('\n') ? '' : ' '}${String(token || '')}`
    })
  }

  function openDatePicker() {
    try {
      dateInputRef.current?.showPicker?.()
    } catch (_) {
      dateInputRef.current?.focus?.()
      dateInputRef.current?.click?.()
    }
  }

  function handleFocusDepartureItem(item) {
    const lat = Number(item?.point?.lat)
    const lng = Number(item?.point?.lng)
    if (!leafletRef.current || !Number.isFinite(lat) || !Number.isFinite(lng)) return
    leafletRef.current.setView([lat, lng], 15, { animate: true })
    markerLayerRef.current?.eachLayer?.(layer => {
      const target = layer?.getLatLng?.()
      if (!target) return
      if (Math.abs(target.lat - lat) < 0.000001 && Math.abs(target.lng - lng) < 0.000001) {
        try { layer.openPopup?.() } catch (_) {}
      }
    })
  }

  const [departureExpanded, setDepartureExpanded] = useState({})
  const [displayLegendHelpOpen, setDisplayLegendHelpOpen] = useState(false)

  const allMarkerSummary = useMemo(() => ({
    businessStart: (departureData.accountMarkers || []).filter(item => item.markerKind === 'business-start' && mapDisplayOptions.businessStart).length,
    staffStart: (departureData.accountMarkers || []).filter(item => item.markerKind === 'staff-start' && mapDisplayOptions.staffStart).length,
  }), [departureData, mapDisplayOptions])

  function formatCandidateList(items = []) {
    if (!items.length) return '계산 대기'
    return items
      .map((candidate, index) => `${index + 1}순위 : ${candidate.displayName || candidate.nickname}${Number.isFinite(candidate.distanceKm) ? `/${candidate.distanceKm.toFixed(1)}` : ''}`)
      .join(' | ')
  }

  function toggleDepartureItem(item) {
    setDepartureExpanded(prev => ({ ...prev, [item.id]: !prev?.[item.id] }))
    handleFocusDepartureItem(item)
  }

  return (
    <div className="stack-page">
      <section className="card map-card enhanced-map-card">
        <div className={`map-card-head ${isMobile ? 'mobile' : ''}`}>
          <div className="map-overlay-controls">
            <div className="map-filter-date-wrap">
              <button type="button" className="map-overlay-button" onClick={openDatePicker} aria-label="날짜 선택">날짜</button>
              <input ref={dateInputRef} type="date" className="map-hidden-date-input" value={selectedDate} onChange={e => handlePickDate(e.target.value)} />
            </div>
            <div className="map-filter-wrap">
              <button type="button" className="map-overlay-button" onClick={() => { setMapFilterOpen(prev => !prev); setMapSettingsOpen(false); setMapDisplayOpen(false) }}>필터</button>
              {mapFilterOpen && (
                <div className="map-filter-popover map-filter-popover-side">
                  <button type="button" className={mapFilter === 'live' ? 'small selected-toggle' : 'small ghost'} onClick={() => { setMapFilter('live'); setMapFilterOpen(false) }}>실시간</button>
                  <button type="button" className={mapFilter === 'all' ? 'small selected-toggle' : 'small ghost'} onClick={() => { setMapFilter('all'); setMapFilterOpen(false) }}>전체</button>
                  <button type="button" className={mapFilter === 'departure' ? 'small selected-toggle' : 'small ghost'} onClick={() => { setMapFilter('departure'); setMapFilterOpen(false) }}>출발지</button>
                </div>
              )}
            </div>
            <div className="map-filter-wrap">
              <button type="button" className="map-overlay-button" onClick={() => { setMapDisplayOpen(prev => !prev); setMapDisplay2Open(false); setMapFilterOpen(false); setMapSettingsOpen(false) }} aria-label="표기1">표기1</button>
              {mapDisplayOpen && (
                <div className="map-filter-popover map-filter-popover-side map-settings-popover">
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayOptions.customerStart} onChange={e => setMapDisplayOptions(prev => ({ ...prev, customerStart: e.target.checked }))} /> <span className="marker-legend-icon customer-start" /> 고출</label>
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayOptions.customerEnd} onChange={e => setMapDisplayOptions(prev => ({ ...prev, customerEnd: e.target.checked }))} /> <span className="marker-legend-icon customer-end" /> 고도</label>
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayOptions.businessStart} onChange={e => setMapDisplayOptions(prev => ({ ...prev, businessStart: e.target.checked }))} /> <span className="marker-legend-icon business-start" /> 사출</label>
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayOptions.staffStart} onChange={e => setMapDisplayOptions(prev => ({ ...prev, staffStart: e.target.checked }))} /> <span className="marker-legend-icon staff-start" /> 직출</label>
                  <button type="button" className="small ghost map-display-help-button" onClick={() => setDisplayLegendHelpOpen(true)}>설명</button>
                </div>
              )}
            </div>
            <div className="map-filter-wrap">
              <button type="button" className="map-overlay-button" onClick={() => { setMapDisplay2Open(prev => !prev); setMapDisplayOpen(false); setMapFilterOpen(false); setMapSettingsOpen(false) }} aria-label="표기2">표기2</button>
              {mapDisplay2Open && (
                <div className="map-filter-popover map-filter-popover-side map-settings-popover">
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayLabelOptions.showName} onChange={e => setMapDisplayLabelOptions(prev => ({ ...prev, showName: e.target.checked }))} /> 이름</label>
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayLabelOptions.showBranch} onChange={e => setMapDisplayLabelOptions(prev => ({ ...prev, showBranch: e.target.checked }))} /> 호점</label>
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayLabelOptions.showPosition} onChange={e => setMapDisplayLabelOptions(prev => ({ ...prev, showPosition: e.target.checked }))} /> 직급</label>
                  <label className="map-display-check"><input type="checkbox" checked={!!mapDisplayLabelOptions.showCustomer} onChange={e => setMapDisplayLabelOptions(prev => ({ ...prev, showCustomer: e.target.checked }))} /> 고객명</label>
                </div>
              )}
            </div>
            <div className="map-filter-wrap">
              <button type="button" className="map-overlay-button" onClick={() => { setMapSettingsOpen(prev => !prev); setMapFilterOpen(false); setMapDisplayOpen(false); setMapDisplay2Open(false) }} aria-label="설정">설정</button>
              {mapSettingsOpen && (
                <div className="map-filter-popover map-filter-popover-side map-settings-popover">
                  <label className="share-toggle map-share-toggle popover-share-toggle">
                    <span>내위치 공유</span>
                    <input type="checkbox" checked={Boolean(shareStatus?.sharing_enabled)} onChange={e => handleToggleShare(e.target.checked).catch(err => window.alert(err.message))} />
                    <span className="share-toggle-slider" />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
        {shareNotice && <div className="map-toast-notice">{shareNotice}</div>}
        <div ref={mapRef} className="real-map-canvas" />
        {displayLegendHelpOpen && (
          <div className="map-legend-help-backdrop" onClick={() => setDisplayLegendHelpOpen(false)}>
            <div className="card stack compact-gap map-legend-help-modal" onClick={event => event.stopPropagation()}>
              <div className="between map-legend-help-head">
                <strong>출발지 표기 설명</strong>
                <button type="button" className="small ghost" onClick={() => setDisplayLegendHelpOpen(false)}>닫기</button>
              </div>
              <div className="map-legend-help-list">
                <div><span className="marker-legend-icon customer-start" /> 고출 : 고객 출발지</div>
                <div><span className="marker-legend-icon customer-end" /> 고도 : 고객 도착지</div>
                <div><span className="marker-legend-icon business-start" /> 사출 : 대표 / 부대표 / 호점대표 출발지</div>
                <div><span className="marker-legend-icon staff-start" /> 직출 : 팀장 / 부팀장 / 직원 출발지</div>
              </div>
              <div className="muted">하단 출발지 목록의 거리 표시는 고객 출발지 기준 예상 거리(km)입니다.</div>
            </div>
          </div>
        )}

        <div className="vehicle-list-panel">
          {mapFilter === 'departure' ? (
            <>
              <div className="vehicle-list-title departure-list-title-row">
                <div className="departure-list-title-main">
                  <span>출발지 목록 - {selectedDate}</span>
                  <span className="departure-distance-legend">* 거리 : km</span>
                </div>
              </div>
              <div className="vehicle-list-items">
                {(departureData.customerList || []).map(item => {
                  const summaryTime = item.startTime || item.visitTime || '-'
                  const isExpanded = !!departureExpanded?.[item.id]
                  return (
                    <div key={item.id} className={`vehicle-list-item stopped departure-list-item${isExpanded ? ' expanded' : ' collapsed'}`} onClick={() => toggleDepartureItem(item)}>
                      <div className="departure-summary-row">
                        <span className="departure-summary-chip">{item.departmentInfo || '일정'}</span>
                        <span className="departure-summary-time">{summaryTime}</span>
                        <strong className="departure-summary-customer">{item.title}</strong>
                        {isExpanded && (
                          <button
                            type="button"
                            className="small ghost departure-detail-button"
                            onClick={event => { event.stopPropagation(); navigate(`/schedule/${item.raw?.id}`) }}
                          >
                            상세일정
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <>
                          <div className="vehicle-list-line sub departure-detail-line">
                            <strong>출발지 :</strong>
                            <span>{item.address || '-'}</span>
                            {item.geocodeApproximate && <em className="departure-approx-note">(주소 중심 좌표 기준)</em>}
                          </div>
                          <div className="vehicle-list-line sub departure-detail-line departure-rank-line">
                            <strong>사업자 :</strong>
                            <span className="departure-rank-text">{formatCandidateList(item.businessCandidates)}</span>
                          </div>
                          <div className="vehicle-list-line sub departure-detail-line departure-rank-line">
                            <strong>직원 :</strong>
                            <span className="departure-rank-text">{formatCandidateList(item.staffCandidates)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
                {!(departureData.customerList || []).length && <div className="muted">선택한 날짜의 출발지 일정이 없습니다.</div>}
              </div>
            </>
          ) : (
            <>
              <div className="vehicle-list-title">차량 목록</div>
              <div className="vehicle-list-items">
                {users.map(item => {
                  const statusText = item.map_status?.status_text || `현위치 ${item.map_status?.current_location || item.region || '-'}에 있고 정차 중`
                  return (
                    <div key={item.id} className={`vehicle-list-item ${item.map_status?.is_moving ? 'moving' : 'stopped'}`}>
                      <div className="vehicle-list-line primary">
                        <strong>[{item.branch_no}호점]</strong>
                        <span>[{statusText}]</span>
                      </div>
                      {item.map_status?.is_moving && (
                        <>
                          <div className="vehicle-list-line sub">* {item.branch_no}호점 이동소요시간 카카오맵 API 연동 후 표시 예정</div>
                          <div className="vehicle-list-line sub">* {item.branch_no}호점 예상도착시간 카카오맵 API 연동 후 표시 예정</div>
                        </>
                      )}
                    </div>
                  )
                })}
                {users.length === 0 && <div className="muted">지도에 표시할 차량 위치가 없습니다.</div>}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}


function MeetupsPage() {

  const [meetups, setMeetups] = useState([])
  const [reviews, setReviews] = useState([])
  const [form, setForm] = useState({ title: '', place: '', meetup_date: '', start_time: '', end_time: '', content: '', cautions: '', notes: '' })
  const [review, setReview] = useState({ schedule_id: '', content: '' })
  async function load() {
    const [m, r] = await Promise.all([api('/api/meetup-schedules'), api('/api/meetup-reviews')])
    setMeetups(m)
    setReviews(r)
  }
  useEffect(() => { load() }, [])
  async function createMeetup(e) {
    e.preventDefault()
    await api('/api/meetup-schedules', { method: 'POST', body: JSON.stringify(form) })
    setForm({ title: '', place: '', meetup_date: '', start_time: '', end_time: '', content: '', cautions: '', notes: '' })
    load()
  }
  async function createReview(e) {
    e.preventDefault()
    await api('/api/meetup-reviews', { method: 'POST', body: JSON.stringify({ schedule_id: Number(review.schedule_id), content: review.content }) })
    setReview({ schedule_id: '', content: '' })
    load()
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>모임 일정 등록</h2>
        <form onSubmit={createMeetup} className="stack">
          <input placeholder="모임 제목" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input placeholder="장소" value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} />
          <input type="date" placeholder="모임 날짜" value={form.meetup_date} onChange={e => setForm({ ...form, meetup_date: e.target.value })} />
          <div className="grid2">
            <input type="time" placeholder="시작 시간" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
            <input type="time" placeholder="종료 시간" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
          </div>
          <textarea placeholder="모임 내용" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
          <textarea placeholder="주의사항" value={form.cautions} onChange={e => setForm({ ...form, cautions: e.target.value })} />
          <textarea placeholder="추가 메모" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <button>등록</button>
        </form>
      </section>
      <section className="card">
        <h2>모임 목록 / 후기</h2>
        <div className="list">
          {meetups.map(item => (
            <div className="list-item block" key={item.id}>
              <div><strong>{getNotificationDisplayParts(item).title || item.title}</strong></div>
              <div className="muted">{item.meetup_date} {item.start_time}-{item.end_time} / {item.place}</div>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
        <form onSubmit={createReview} className="stack">
          <input placeholder="일정 번호" value={review.schedule_id} onChange={e => setReview({ ...review, schedule_id: e.target.value })} />
          <textarea placeholder="후기 내용" value={review.content} onChange={e => setReview({ ...review, content: e.target.value })} />
          <button>후기 등록</button>
        </form>
        <div className="list">
          {reviews.map(item => (
            <div key={item.id} className="list-item block">
              <strong>{item.user.nickname}</strong>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function BoardsPage() {
  const [category, setCategory] = useState('free')
  const [posts, setPosts] = useState([])
  const [form, setForm] = useState({ title: '', content: '' })
  const categories = [
    ['free', '자유'],
    ['anonymous', '익명'],
    ['tips', '팁'],
  ]
  async function load() {
    const data = await api(`/api/boards/${category}`)
    setPosts(data)
  }
  useEffect(() => { load() }, [category])
  async function createPost(e) {
    e.preventDefault()
    await api(`/api/boards/${category}`, { method: 'POST', body: JSON.stringify(form) })
    setForm({ title: '', content: '' })
    load()
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>게시판</h2>
        <div className="inline-actions wrap">
          {categories.map(([value, label]) => <button key={value} className={category === value ? 'small selected-toggle' : 'small ghost'} onClick={() => setCategory(value)}>{label}</button>)}
        </div>
        <div className="list">
          {posts.map(item => (
            <div className="list-item block" key={item.id}>
              <strong>{getNotificationDisplayParts(item).title || item.title}</strong>
              <div className="muted">{item.user.nickname} / {item.created_at}</div>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>게시글 작성</h2>
        <form onSubmit={createPost} className="stack">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="제목" />
          <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="내용" />
          <button>등록</button>
        </form>
      </section>
    </div>
  )
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}
function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}
function addDays(date, amount) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}
function fmtDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildMonthDays(date) {
  const start = startOfMonth(date)
  const firstGridDate = addDays(start, -start.getDay())
  return Array.from({ length: 42 }, (_, index) => addDays(firstGridDate, index))
}

function isSameMonthDate(left, right) {
  if (!left || !right) return false
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

const DEFAULT_DEPARTMENT_OPTIONS = [
  '미정',
  '본사업무',
  '당일이사 2인 업무',
  '당일이사 3인 이상업무',
  '짐보관이사 2인 업무',
  '짐보관이사 3인 이상업무',
  '당일이사 1인 업무',
  '연차',
  '월차',
  '기타(예비군, 병가, 조사 등)',
  '손 없는 날',
  '이청잘 휴가',
]

const DEPARTMENT_AUTO_ASSIGN_OPTIONS = [
  '당일이사 1인 업무',
  '당일이사 2인 업무',
  '당일이사 3인 이상업무',
  '짐보관이사 2인 업무',
  '짐보관이사 3인 이상업무',
]

const DEFAULT_DEPARTMENT_COLOR_MAP = {
  '미정': '#000000',
  '본사업무': '#2563eb',
  '당일이사 1인 업무': '#2563eb',
  '당일이사 2인 업무': '#1d4ed8',
  '당일이사 3인 이상업무': '#1e40af',
  '짐보관이사 2인 업무': '#0ea5e9',
  '짐보관이사 3인 이상업무': '#0369a1',
  '연차': '#8b5cf6',
  '월차': '#7c3aed',
  '기타(예비군, 병가, 조사 등)': '#64748b',
  '손 없는 날': '#16a34a',
  '이청잘 휴가': '#f59e0b',
}

function getStoredDepartmentOptions() {
  if (typeof window === 'undefined') return [...DEFAULT_DEPARTMENT_OPTIONS]
  try {
    const raw = window.localStorage.getItem('icj_department_options')
    if (!raw) return [...DEFAULT_DEPARTMENT_OPTIONS]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_DEPARTMENT_OPTIONS]
    const cleaned = parsed.map(item => String(item || '').trim()).filter(Boolean)
    const unique = Array.from(new Set(cleaned))
    if (!unique.includes('미정')) unique.unshift('미정')
    return unique.length ? unique : [...DEFAULT_DEPARTMENT_OPTIONS]
  } catch {
    return [...DEFAULT_DEPARTMENT_OPTIONS]
  }
}

function getStoredDepartmentColorMap() {
  if (typeof window === 'undefined') return { ...DEFAULT_DEPARTMENT_COLOR_MAP }
  try {
    const raw = window.localStorage.getItem('icj_department_color_map')
    if (!raw) return { ...DEFAULT_DEPARTMENT_COLOR_MAP }
    return { ...DEFAULT_DEPARTMENT_COLOR_MAP, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_DEPARTMENT_COLOR_MAP }
  }
}

const PLATFORM_OPTIONS = ['숨고', '오늘', '공홈']
const DEPOSIT_METHOD_OPTIONS = ['계약금입금전', '계좌이체', '숨고페이']
const DEPOSIT_AMOUNT_OPTIONS = ['50,000원', '100,000원']

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false))
  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return isMobile
}

function formatNumericAmount(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('ko-KR')
}

function formatMoneyDisplay(value) {
  const formatted = formatNumericAmount(value)
  return formatted ? `${formatted}원` : ''
}

function formatRangeAmount(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/([\d,]+)\s*[~\-]\s*([\d,]+)/)
  if (!match) return ''
  return `${formatNumericAmount(match[1])} ~ ${formatNumericAmount(match[2])}`
}

function getReadableTextColor(hexColor) {
  const hex = String(hexColor || '').trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b)
  return luminance >= 160 ? '#111827' : '#ffffff'
}

function getDepartmentOptionTextColor(label, backgroundColor) {
  if (String(label || '').trim() === '당일이사 1인 업무') return '#111827'
  return getReadableTextColor(backgroundColor)
}

function getDepartmentOptionStyle(label, backgroundColor) {
  return {
    backgroundColor,
    color: getDepartmentOptionTextColor(label, backgroundColor),
    borderTop: '1px solid #111111',
    borderBottom: '1px solid #111111',
    boxShadow: 'inset 0 0 0 1px #111111',
  }
}

function parseScheduleAddressBundle(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim()
  if (!text) return null
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return null
  let startAddress = ''
  let endAddress = ''
  let reservationName = ''
  let reservationPhone = ''

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    if (/^출발지\s*[:：]/.test(normalized)) {
      const value = normalized.replace(/^출발지\s*[:：]\s*/, '').trim()
      if (!startAddress) startAddress = value
      else if (!endAddress) endAddress = value
      continue
    }
    if (/^도착지\s*[:：]/.test(normalized)) {
      const value = normalized.replace(/^도착지\s*[:：]\s*/, '').trim()
      if (!endAddress) endAddress = value
      continue
    }
    if (/^(성함\s*\/\s*연락처|예약자명\s*\/\s*연락처|예약자명|성함)\s*[:：]/.test(normalized)) {
      const value = normalized.replace(/^(성함\s*\/\s*연락처|예약자명\s*\/\s*연락처|예약자명|성함)\s*[:：]\s*/, '').trim()
      const phoneMatch = value.match(/(01[016789][-\s]?\d{3,4}[-\s]?\d{4})/)
      if (phoneMatch) {
        reservationPhone = phoneMatch[1].replace(/\s+/g, '')
        reservationName = value.replace(phoneMatch[1], '').replace(/[()]/g, ' ').trim()
      } else {
        reservationName = value
      }
    }
  }

  if (!startAddress && !endAddress && !reservationName && !reservationPhone) return null
  return { startAddress, endAddress, reservationName, reservationPhone }
}

function buildCostSummary(form) {
  const rangeAmount = formatRangeAmount(form.amount1)
  if (rangeAmount) return `금액미정 / ${rangeAmount}`
  const primary = formatMoneyDisplay(form.amount1)
  if (primary) return primary
  return '금액미정'
}

function buildCostTitlePart(form) {
  const rangeAmount = formatRangeAmount(form.amount1)
  if (rangeAmount) return `((금액미정)) (${rangeAmount})`
  return `((${buildCostSummary(form)}))`
}

function buildScheduleTypeTitlePart(scheduleType) {
  const normalized = String(scheduleType || '').trim()
  if (!normalized || normalized === '선택') return ''
  return normalized
}

function buildScheduleTitle(form) {
  const startDisplay = resolveScheduleStartTime(form.visit_time || form.start_time)
  const scheduleTypeDisplay = buildScheduleTypeTitlePart(form.schedule_type)
  const platformDisplay = form.platform || '플랫폼미정'
  const customerDisplay = resolveScheduleCustomerName(form.customer_name)
  const costDisplay = buildCostTitlePart(form)
  return [startDisplay, scheduleTypeDisplay, platformDisplay, customerDisplay, costDisplay].filter(Boolean).join(' ').trim()
}

function normalizeShortDateInput(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const groups = raw.split(/[^\d]+/).filter(Boolean)
  if (groups.length >= 3) {
    const [yearRaw, monthRaw, dayRaw] = groups
    const year = yearRaw.slice(-2).padStart(2, '0')
    const month = monthRaw.padStart(2, '0')
    const day = dayRaw.padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  }
  if (digits.length === 8) {
    return `${digits.slice(2, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return raw
}

function toIsoDateInputValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{2}-\d{2}-\d{2}$/.test(raw)) return `20${raw}`
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  if (digits.length === 6) return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  return ''
}

function displayShortDate(value) {
  if (!value) return ''
  return toIsoDateInputValue(value) || normalizeShortDateInput(value)
}

function formatShortDateForInput(value) {
  const iso = toIsoDateInputValue(value)
  if (!iso) return normalizeShortDateInput(value)
  return iso.slice(2)
}

function normalizeScheduleDateInput(rawValue, fallbackValue = '') {
  const raw = String(rawValue || '').trim()
  if (!raw) return toIsoDateInputValue(fallbackValue) || ''
  const short = normalizeShortDateInput(raw)
  const iso = toIsoDateInputValue(short)
  return iso || toIsoDateInputValue(fallbackValue) || ''
}

function formatSelectedDateLabel(value) {
  if (!value) return '날짜를 선택해 주세요.'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`
}

function applyAlphaToHex(hex, alpha = '22') {
  const raw = String(hex || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return `${raw}${alpha}`
  return raw || '#2563eb'
}

function eventTimeLine(item) {
  const start = item.start_time || '미정'
  const end = item.end_time || '미정'
  const endDayStart = item.move_end_start_time || ''
  const endDayEnd = item.move_end_end_time || ''
  if (endDayStart || endDayEnd) {
    return `${start} ~ ${end} / 종료일 ${endDayStart || '미정'} ~ ${endDayEnd || '미정'}`
  }
  return `${start} ~ ${end}`
}

function ScheduleCardLine({ item, mobileCompact = false, colorized = false }) {
  const colorStyle = colorized ? { background: applyAlphaToHex(item.color, '24'), borderColor: applyAlphaToHex(item.color, '88') } : undefined
  const lines = buildMobileScheduleLines(item)
  if (mobileCompact) {
    return (
      <div className="schedule-line-mobile" style={colorStyle}>
        <div className="schedule-line-mobile-title">{lines.line1}</div>
        <div className={lines.depositPending ? 'schedule-line-mobile-deposit pending' : 'schedule-line-mobile-deposit confirmed'}>{lines.line2}</div>
        <div className="schedule-line-mobile-meta">{lines.line3}</div>
      </div>
    )
  }
  return (
    <div className="schedule-line-default" style={colorStyle}>
      <div className="schedule-line-default-title">{lines.line1}</div>
      <div className={lines.depositPending ? 'schedule-line-default-deposit pending' : 'schedule-line-default-deposit confirmed'}>{lines.line2}</div>
      <div className="schedule-line-default-meta">{lines.line3}</div>
    </div>
  )
}


function normalizeBusinessExclusionDetails(items = [], fallback = []) {
  const seeded = Array.isArray(items) && items.length > 0
    ? items.map(item => ({
        name: String(item?.name || item?.label || '').trim(),
        reason: String(item?.reason || '').trim(),
        branch_no: resolveBusinessBranchNo(item),
      }))
    : (fallback || []).map(item => {
        const raw = String(item || '').trim()
        const match = raw.match(/^(.*?)(?:\s*\(사유\s*:\s*(.*?)\))?$/)
        return { name: String(match?.[1] || raw).replace(/-열외$/, '').trim(), reason: String(match?.[2] || '').trim(), branch_no: null }
      })
  while (seeded.length < 1) seeded.push({ name: '', reason: '', branch_no: null })
  return seeded
}

function normalizeStaffExclusionDetails(items = [], fallback = []) {
  const seeded = Array.isArray(items) && items.length > 0
    ? items.map(item => ({ name: String(item?.name || '').trim(), reason: String(item?.reason || '').trim() }))
    : (fallback || []).map(item => {
        const raw = String(item || '').trim()
        const match = raw.match(/^(.*?)(?:\s*\(사유\s*:\s*(.*?)\))?$/)
        return { name: String(match?.[1] || raw).replace(/-열외$/, '').trim(), reason: String(match?.[2] || '').trim() }
      })
  while (seeded.length < 1) seeded.push({ name: '', reason: '' })
  return seeded.slice(0, 1)
}

function compactExclusionDetails(items = []) {
  return (items || []).map(item => ({
    name: String(item?.name || '').trim(),
    reason: String(item?.reason || '').trim(),
    branch_no: resolveBusinessBranchNo(item),
  })).filter(item => item.name)
}

function exclusionCount(items = []) {
  return compactExclusionDetails(items).length
}

function renderExclusionText(items = [], emptyLabel = '-') {
  const normalized = compactExclusionDetails(items)
  if (normalized.length === 0) return emptyLabel
  return normalized.map(item => `${item.name}(${item.reason || '-'})`).join(' / ')
}

function formatBusinessExceptionLabel(item = {}) {
  const branchNo = resolveBusinessBranchNo(item)
  const branchLabel = branchNo === 0 ? '[0본점]' : (Number.isFinite(branchNo) ? `[${branchNo}호점]` : '[미지정]')
  const nameLabel = item?.name ? `[${item.name}]` : '[이름미지정]'
  const reasonLabel = `[${String(item?.reason || '').trim() || '-'}]`
  return `${branchLabel} ${nameLabel} ${reasonLabel}`
}

function formatBusinessExceptionDetailLine(item = {}) {
  const branchNo = resolveBusinessBranchNo(item)
  const branchLabel = branchNo === 0 ? '0본점' : (Number.isFinite(branchNo) ? `${branchNo}호점` : '미지정')
  const businessName = String(item?.name || '').trim() || '이름미지정'
  const reason = String(item?.reason || '').trim() || '-'
  return `* [${branchLabel} ${businessName}] : ${reason}`
}

function copyTextToClipboard(value) {
  const text = String(value || '').trim()
  if (!text) return Promise.reject(new Error('복사할 내용이 없습니다.'))
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!ok) throw new Error('copy failed')
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

function highlightTaggedNames(value, currentUser) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const keys = [currentUser?.nickname, currentUser?.name, currentUser?.username, currentUser?.email]
    .map(v => String(v || '').trim().toLowerCase())
    .filter(Boolean)
  const parts = raw.split(/\s*\/\s*/)
  return parts.map((part, index) => {
    const normalized = String(part || '').trim()
    const match = normalized && keys.some(key => normalized.toLowerCase().includes(key))
    return (
      <React.Fragment key={`${normalized}-${index}`}>
        <span className={match ? 'schedule-tagged-name is-me' : 'schedule-tagged-name'}>{normalized || '-'}</span>
        {index < parts.length - 1 ? <span className="schedule-tagged-separator"> / </span> : null}
      </React.Fragment>
    )
  })
}

function CalendarPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const canEditAssignmentFields = canEditScheduleAssignments(currentUser)
  const initialDate = searchParams.get('date') || fmtDate(new Date())
  const initialMonth = (() => {
    const parsed = new Date(`${initialDate}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? startOfMonth(new Date()) : startOfMonth(parsed)
  })()
  const [items, setItems] = useState([])
  const [workDays, setWorkDays] = useState([])
  const [monthCursor, setMonthCursor] = useState(initialMonth)
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [overflowPopup, setOverflowPopup] = useState({ dateKey: '', items: [], title: '', x: 0, y: 0, daySummary: null })
  const [calendarStatusDate, setCalendarStatusDate] = useState('')
  const [calendarStatusForm, setCalendarStatusForm] = useState(buildDayStatusForm(null))
  const [mobileStatusPopup, setMobileStatusPopup] = useState(null)
  const [calendarStatusEditMode, setCalendarStatusEditMode] = useState(false)
  const [businessExclusionDraft, setBusinessExclusionDraft] = useState(() => normalizeBusinessExclusionDetails())
  const [staffExclusionDraft, setStaffExclusionDraft] = useState(() => normalizeStaffExclusionDetails())
  const [legendOpen, setLegendOpen] = useState(false)
  const [vehicleListPopup, setVehicleListPopup] = useState({ open: false, title: '', items: [] })
  const [exceptionManagerOpen, setExceptionManagerOpen] = useState(false)
  const [exceptionAccounts, setExceptionAccounts] = useState([])
  const [exceptionLoading, setExceptionLoading] = useState(false)
  const [exceptionAction, setExceptionAction] = useState('add')
  const [exceptionForm, setExceptionForm] = useState({ user_id: '', start_date: initialDate, end_date: initialDate, reason: '' })
  const [exceptionItems, setExceptionItems] = useState([])
  const [editingExceptionId, setEditingExceptionId] = useState(null)
  const [mobileCalendarCollapsed, setMobileCalendarCollapsed] = useState(false)
  const [detailPopupEventId, setDetailPopupEventId] = useState(null)
  const days = useMemo(() => buildMonthDays(monthCursor), [monthCursor])

  async function load() {
    const firstDate = fmtDate(days[0] || new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1))
    const lastDate = fmtDate(days[days.length - 1] || new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0))
    const [calendarData, workData] = await Promise.all([
      api(`/api/calendar/events?start_date=${firstDate}&end_date=${lastDate}`),
      api(`/api/work-schedule?start_date=${firstDate}&days=42`),
    ])
    setItems(Array.isArray(calendarData) ? calendarData : (Array.isArray(calendarData?.items) ? calendarData.items : []))
    setWorkDays(Array.isArray(workData?.days) ? workData.days : (Array.isArray(workData) ? workData : []))
  }
  useEffect(() => { load().catch(() => {}) }, [monthCursor, days])
  useEffect(() => {
    const preset = searchParams.get('date')
    if (preset) {
      setSelectedDate(preset)
      const parsed = new Date(`${preset}T00:00:00`)
      if (!Number.isNaN(parsed.getTime())) {
        setMonthCursor(startOfMonth(parsed))
      }
    }
  }, [searchParams])

  const monthLabel = useMemo(() => `${monthCursor.getFullYear()}년 ${monthCursor.getMonth() + 1}월`, [monthCursor])
  const grouped = useMemo(() => {
    const safeItems = Array.isArray(items) ? items : []
    const map = new Map()
    safeItems.forEach(item => {
      const key = item?.event_date
      if (!key) return
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    })
    for (const [, value] of map.entries()) {
      value.sort((a, b) => {
        const aTime = a.start_time === '미정' ? '99:99' : a.start_time
        const bTime = b.start_time === '미정' ? '99:99' : b.start_time
        return `${aTime}-${a.id}`.localeCompare(`${bTime}-${b.id}`)
      })
    }
    return map
  }, [items])
  const visibleLaneCount = 3
  const workDayMap = useMemo(() => {
    const safeDays = Array.isArray(workDays) ? workDays : []
    return new Map(safeDays.filter(day => day?.date).map(day => [day.date, day]))
  }, [workDays])
  const detailItems = grouped.get(selectedDate) || []
  const selectedDaySummary = workDayMap.get(selectedDate) || buildDayStatusForm({ date: selectedDate })

  function openDateForm(date) {
    navigate(`/schedule/new?date=${fmtDate(date)}`)
  }

  function selectDate(date) {
    const key = fmtDate(date)
    setSelectedDate(key)
    navigate(`/schedule?date=${key}`, { replace: true })
  }

  function moveMonth(amount) {
    const nextMonth = addMonths(monthCursor, amount)
    setMonthCursor(nextMonth)
    const nextSelected = fmtDate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1))
    setSelectedDate(nextSelected)
    navigate(`/schedule?date=${nextSelected}`, { replace: true })
  }

  function goToToday() {
    const today = new Date()
    const todayKey = fmtDate(today)
    setMonthCursor(startOfMonth(today))
    setSelectedDate(todayKey)
    navigate(`/schedule?date=${todayKey}`, { replace: true })
  }

  function openOverflowPopup(date, dayItems, event, title = '일정목록', daySummaryOverride = null) {
    if (event) event.stopPropagation()
    const rect = event?.currentTarget?.getBoundingClientRect?.()
    const viewportWidth = window.innerWidth || 1280
    const viewportHeight = window.innerHeight || 900
    const gap = 12
    const estimatedPopupWidth = Math.min(720, Math.max(320, viewportWidth - (gap * 2)))
    const estimatedPopupHeight = Math.min(720, Math.max(280, Math.round(viewportHeight * 0.76)))
    let anchorX = 24
    let anchorY = 120

    if (rect) {
      const centeredLeft = rect.left + (rect.width / 2) - (estimatedPopupWidth / 2)
      const openBelow = rect.bottom + 8 + estimatedPopupHeight <= viewportHeight - gap || rect.top < estimatedPopupHeight
      anchorX = Math.min(viewportWidth - estimatedPopupWidth - gap, Math.max(gap, centeredLeft))
      anchorY = openBelow
        ? Math.min(viewportHeight - estimatedPopupHeight - gap, rect.bottom + 8)
        : Math.max(gap, rect.top - estimatedPopupHeight - 8)
    }

    const dateKey = fmtDate(date)
    const popupDaySummary = daySummaryOverride || workDayMap.get(dateKey) || buildDayStatusForm({ date: dateKey })
    setOverflowPopup({ dateKey, items: dayItems, title, x: anchorX, y: anchorY, daySummary: popupDaySummary })
  }

  function closeOverflowPopup() {
    setOverflowPopup({ dateKey: '', items: [], title: '', x: 0, y: 0, daySummary: null })
  }

  function openScheduleDetailPopup(item) {
    const linkedId = Number(item?.event_id || item?.id || 0)
    if (String(item?.entry_type || 'calendar') !== 'calendar' || linkedId <= 0) return
    navigate(`/schedule/${linkedId}`)
  }

  function closeScheduleDetailPopup(shouldReload = false) {
    setDetailPopupEventId(null)
    if (shouldReload) load().catch(() => {})
  }

  function openCalendarStatus(daySummary) {
    const nextForm = buildDayStatusForm(daySummary)
    setCalendarStatusForm(nextForm)
    setCalendarStatusDate(daySummary.date)
    setMobileStatusPopup(daySummary)
    setCalendarStatusEditMode(false)
    setBusinessExclusionDraft(normalizeBusinessExclusionDetails(nextForm.excluded_business_details, daySummary?.excluded_business_names || []))
    setStaffExclusionDraft(normalizeStaffExclusionDetails(nextForm.excluded_staff_details, daySummary?.excluded_staff_names || []))
  }

  function closeCalendarStatusPopup() {
    setCalendarStatusDate('')
    setMobileStatusPopup(null)
    setCalendarStatusEditMode(false)
  }

  function openVehicleListPopup(daySummary) {
    const items = Array.isArray(daySummary?.available_vehicle_accounts) ? daySummary.available_vehicle_accounts : []
    setVehicleListPopup({
      open: true,
      title: `${formatSelectedDateLabel(daySummary?.date || selectedDate)} 가용차량 목록`,
      items,
    })
  }

  function closeVehicleListPopup() {
    setVehicleListPopup({ open: false, title: '', items: [] })
  }

  function updateBusinessExclusion(index, field, value) {
    setBusinessExclusionDraft(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  function updateStaffExclusion(index, field, value) {
    setStaffExclusionDraft(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  async function submitCalendarStatus(e) {
    e.preventDefault()
    const normalizedBusiness = compactExclusionDetails(businessExclusionDraft)
    const normalizedStaff = compactExclusionDetails(staffExclusionDraft)
    const payload = {
      ...calendarStatusForm,
      available_vehicle_count: Number(selectedDaySummary?.available_vehicle_count || 0),
      excluded_business_details: normalizedBusiness,
      excluded_staff_details: normalizedStaff,
      excluded_business: normalizedBusiness.map(item => item.name).join(', '),
      excluded_staff: normalizedStaff.map(item => item.name).join(', '),
    }
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify(payload) })
    closeCalendarStatusPopup()
    await load()
  }

  async function callVehicleExclusionManagerApi(accountId, action = 'list', payload = null, exclusionId = null) {
    const primaryBase = `/api/admin/accounts/${accountId}/vehicle-exclusions`
    const aliasBase = `/api/admin/vehicle-exclusions/${accountId}`
    const attempt = async (path, options = {}) => api(path, options)
    const isRetryable = error => {
      const message = String(error?.message || '')
      return message.includes('(404)') || message.includes('(405)') || message.includes('Not Found') || message.includes('Method Not Allowed')
    }
    try {
      if (action === 'list') return await attempt(primaryBase)
      if (action === 'create') return await attempt(primaryBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'update') return await attempt(`${primaryBase}/${exclusionId}`, { method: 'PUT', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${primaryBase}/${exclusionId}`, { method: 'DELETE' })
      throw new Error('지원하지 않는 차량열외 요청입니다.')
    } catch (error) {
      if (!isRetryable(error)) throw error
      if (action === 'list') return await attempt(aliasBase)
      if (action === 'create') return await attempt(aliasBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'update') return await attempt(`${aliasBase}/${exclusionId}`, { method: 'PUT', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${aliasBase}/${exclusionId}`, { method: 'DELETE' })
      throw error
    }
  }

  async function fetchExceptionItemsForDate(dateKey = selectedDate) {
    try {
      const result = await api(`/api/work-schedule?start_date=${encodeURIComponent(dateKey)}&days=1`)
      const day = Array.isArray(result?.days) ? result.days[0] : null
      return Array.isArray(day?.auto_unavailable_business) ? day.auto_unavailable_business : []
    } catch {
      return []
    }
  }

  async function openExceptionManager() {
    if (Number(currentUser?.grade || 6) > 2) return
    setExceptionManagerOpen(true)
    setExceptionAction('add')
    setEditingExceptionId(null)
    setExceptionForm({ user_id: '', start_date: selectedDate, end_date: selectedDate, reason: '' })
    setExceptionLoading(true)
    try {
      const adminData = await api('/api/admin-mode')
      const accounts = (adminData?.accounts || [])
        .filter(item => Number(item?.branch_no || 0) > 0)
        .map(item => ({
          id: item.id,
          branch_no: item.branch_no,
          name: item.name || item.nickname || item.email || `계정 ${item.id}`,
          label: `[${item.branch_no}호점] ${item.name || item.nickname || item.email || `계정 ${item.id}`}`,
        }))
      setExceptionAccounts(accounts)
      const dayItems = await fetchExceptionItemsForDate(selectedDate)
      setExceptionItems(dayItems)
      if (accounts.length) {
        setExceptionForm(prev => ({ ...prev, user_id: prev.user_id || String(accounts[0].id) }))
      }
    } catch (error) {
      window.alert(error.message || '열외관리 데이터를 불러오지 못했습니다.')
      setExceptionManagerOpen(false)
    } finally {
      setExceptionLoading(false)
    }
  }

  function startExceptionEdit(item) {
    setExceptionAction('edit')
    setEditingExceptionId(item?.exclusion_id || item?.id || null)
    setExceptionForm({
      user_id: String(item?.user_id || ''),
      start_date: String(item?.start_date || selectedDate),
      end_date: String(item?.end_date || selectedDate),
      reason: String(item?.reason || ''),
    })
  }

  async function submitExceptionAction() {
    const userId = Number(exceptionForm.user_id || 0)
    if (userId <= 0) {
      window.alert('열외 계정을 선택해 주세요.')
      return
    }
    const payload = { start_date: exceptionForm.start_date || selectedDate, end_date: exceptionForm.end_date || selectedDate, reason: exceptionForm.reason || '' }
    setExceptionLoading(true)
    try {
      if (exceptionAction === 'edit' && editingExceptionId) {
        await callVehicleExclusionManagerApi(userId, 'update', payload, editingExceptionId)
      } else {
        await callVehicleExclusionManagerApi(userId, 'create', payload)
      }
      await load()
      const refreshed = await fetchExceptionItemsForDate(selectedDate)
      setExceptionItems(refreshed)
      setExceptionAction('add')
      setEditingExceptionId(null)
      setExceptionForm(prev => ({ ...prev, start_date: selectedDate, end_date: selectedDate, reason: '' }))
    } catch (error) {
      window.alert(error.message || '열외관리 저장에 실패했습니다.')
    } finally {
      setExceptionLoading(false)
    }
  }

  async function deleteExceptionItem(item) {
    const targetId = Number(item?.user_id || 0)
    const exclusionId = Number(item?.exclusion_id || 0)
    if (targetId <= 0 || exclusionId <= 0) return
    const targetName = String(item?.display_name || item?.name || item?.nickname || item?.email || '해당 사업자').trim()
    const confirmed = window.confirm(`[${targetName}]님을 열외목록에서 삭제하겠습니까?`)
    if (!confirmed) return
    setExceptionLoading(true)
    try {
      await callVehicleExclusionManagerApi(targetId, 'delete', null, exclusionId)
      await load()
      const refreshed = await fetchExceptionItemsForDate(selectedDate)
      setExceptionItems(refreshed)
    } catch (error) {
      window.alert(error.message || '열외삭제에 실패했습니다.')
    } finally {
      setExceptionLoading(false)
    }
  }

  return (
    <div className={`stack-page schedule-page${isMobile ? ' mobile' : ''}`}>
      <section className={`card schedule-card${isMobile && mobileCalendarCollapsed ? ' mobile-calendar-collapsed' : ''}`}>
        <div className="calendar-toolbar upgraded schedule-toolbar-updated">
          <div className="schedule-toolbar-main-row single-line">
            <div className="schedule-toolbar-side schedule-toolbar-side-left">
              <button type="button" className="small ghost schedule-today-button" onClick={goToToday}>오늘</button>
            </div>
            <div className="schedule-toolbar-center">
              <div className="inline-actions schedule-month-nav">
                <button type="button" className="ghost small icon-month-button" onClick={() => moveMonth(-1)} aria-label="이전 달">◀</button>
                <strong className="schedule-month-label">{monthLabel}</strong>
                <button type="button" className="ghost small icon-month-button" onClick={() => moveMonth(1)} aria-label="다음 달">▶</button>
              </div>
            </div>
            <div className={`inline-actions schedule-toolbar-actions compact-inline${isMobile ? ' mobile-inline' : ' desktop-inline'}`}>
              {!readOnly && <button type="button" className="small ghost schedule-toolbar-icon-button schedule-add-button" onClick={() => navigate(`/schedule/new?date=${selectedDate || fmtDate(new Date())}`)} title="일정등록" aria-label="일정등록"><span>+</span></button>}
              {!readOnly && <button type="button" className="small ghost schedule-toolbar-icon-button schedule-handless-button" onClick={() => navigate(`/schedule/handless?month=${fmtDate(monthCursor).slice(0, 7)}`)}><span>손</span></button>}
              <button type="button" className="small ghost schedule-toolbar-icon-button schedule-settings-button" onClick={() => setLegendOpen(true)} title="설정" aria-label="설정"><span>⚙</span></button>
            </div>
          </div>
        </div>
        {(!isMobile || !mobileCalendarCollapsed) && (<>
          <div className="calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day} className="weekday">{day}</div>)}</div>
          <div className={`calendar-grid schedule-grid detail-mode${isMobile ? ' mobile-calendar-grid' : ''}`}>
          {days.map((date, idx) => {
            const key = date ? fmtDate(date) : `blank-${idx}`
            const today = date && fmtDate(date) === fmtDate(new Date())
            const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6)
            const isSelected = date && fmtDate(date) === selectedDate
            const dayItems = date ? (grouped.get(fmtDate(date)) || []) : []
            const visibleItems = dayItems.slice(0, visibleLaneCount)
            const extraCount = Math.max(dayItems.length - visibleLaneCount, 0)
            const hasWorkDayData = Boolean(date && workDayMap.has(fmtDate(date)))
            const daySummary = date ? (workDayMap.get(fmtDate(date)) || buildDayStatusForm({ date: fmtDate(date) })) : null
            const dayCapacity = hasWorkDayData && daySummary ? analyzeScheduleDayCapacity(daySummary) : null
            const dayCapacityClass = hasWorkDayData && daySummary ? buildCalendarDayStatusClass(daySummary) : ''
            const isFriday = date && date.getDay() === 5
            const isSaturday = date && date.getDay() === 6
            const shouldHighlightDayKind = Boolean(date && (isFriday || isSaturday || daySummary?.is_handless_day))
            const isCurrentMonth = date ? isSameMonthDate(date, monthCursor) : false
            return (
              <div key={key} className={date ? `calendar-cell schedule-cell detail-cell${today ? ' today' : ''}${isWeekend ? ' weekend' : ''}${isSelected ? ' selected' : ''}${dayCapacityClass ? ` ${dayCapacityClass}` : ''}${!isCurrentMonth ? ' outside-month-cell' : ''}` : 'calendar-cell empty'}>
                {date && (
                  <>
                    <div className="calendar-cell-topline schedule-header-line">
                      <button type="button" className={`calendar-date-select ${dayCapacityClass} ${isSelected ? 'is-selected' : ''}`.trim()} title={dayCapacity?.detail || ''} onClick={() => selectDate(date)}>
                        <span className="calendar-date">{date.getDate()}</span>
                      </button>
                      {!isMobile && (
                        <div className="calendar-top-actions filled">
                          <button type="button" className="calendar-entry-band secondary filled" onClick={(event) => openOverflowPopup(date, daySummary?.entries || [], event, '스케줄목록', daySummary)}>
                            <span className="calendar-entry-label two-line schedule-single-line">스케줄</span>
                          </button>
                          <button type="button" className="calendar-entry-band filled schedule-add-band" onClick={() => openDateForm(date)} title="일정등록" aria-label="일정등록">
                            <span className="calendar-entry-label plus-only">+</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {isMobile ? (
                      <button type="button" className={`calendar-day-summary-button redesigned mobile-compact`} title={dayCapacity?.detail || ''} onClick={() => selectDate(date)}>
                        <div className="calendar-mobile-summary-stack compact-topline">
                          <span className={`calendar-handless-pill mobile-compact ${daySummary?.is_handless_day ? 'active' : 'inactive'}${shouldHighlightDayKind ? ' special-attention' : ''}`}>{daySummary?.is_handless_day ? '손없는날' : '일반'}</span>
                        </div>
                      </button>
                    ) : (
                      <div className="calendar-day-status-row">
                        <button type="button" className="calendar-day-summary-button redesigned split-layout" title={dayCapacity?.detail || ''} onClick={() => openCalendarStatus(daySummary)}>
                          <span className="calendar-day-summary-vehicle">{String(daySummary?.available_vehicle_count ?? 0).padStart(2, '0')}</span>
                          <span className="calendar-day-summary-chip">A:{String(daySummary?.status_a_count ?? 0).padStart(2, '0')}</span>
                          <span className="calendar-day-summary-chip">B:{String(daySummary?.status_b_count ?? 0).padStart(2, '0')}</span>
                          <span className="calendar-day-summary-chip">C:{String(daySummary?.status_c_count ?? 0).padStart(2, '0')}</span>
                        </button>
                        <div className={`calendar-handless-banner split-layout ${daySummary?.is_handless_day ? 'handless' : 'general'}${shouldHighlightDayKind ? ' special-attention' : ''}`}><span>{daySummary?.is_handless_day ? '손' : '일'}</span></div>
                      </div>
                    )}

                    {!isMobile && (
                      <div className="calendar-lanes-stack" role="button" tabIndex={0} onClick={() => selectDate(date)}>
                        <div className="calendar-lanes">
                          {visibleItems.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              className="calendar-lane filled clickable"
                              style={{ background: item.color || '#2563eb', color: getReadableTextColor(item.color || '#2563eb'), boxShadow: `inset 0 0 0 1px ${applyAlphaToHex(item.color, '55')}` }}
                              title={item.title}
                              onClick={(event) => {
                                event.stopPropagation()
                                navigate(`/schedule/${item.id}`)
                              }}
                            >
                              <span className="calendar-lane-color-block" aria-hidden="true" style={{ background: item.color || '#2563eb' }} />
                              <span className="calendar-lane-title">{item.title}</span>
                            </button>
                          ))}
                          {Array.from({ length: Math.max(visibleLaneCount - visibleItems.length, 0) }).map((_, laneIndex) => (
                            <span key={`empty-${key}-${laneIndex}`} className="calendar-lane" />
                          ))}
                        </div>
                        <div className="calendar-plus-row">
                          <button type="button" className={`calendar-more-indicator single-plus${dayItems.length > 0 ? ' has-items' : ''}`} onClick={(event) => openOverflowPopup(date, dayItems, event, '일정목록', daySummary)} title="전체 일정 보기" aria-label="전체 일정 보기">+</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
          </div>
        </>)}

        {isMobile && (
          <div className={`mobile-schedule-detail-panel${mobileCalendarCollapsed ? ' collapsed' : ''}`}>
            <button type="button" className="mobile-schedule-detail-toggle-indicator" onClick={() => setMobileCalendarCollapsed(prev => !prev)} aria-label={mobileCalendarCollapsed ? '달력 펼치기' : '달력 접기'}>
              {mobileCalendarCollapsed ? '▼' : '▲'}
            </button>
            <div className="mobile-schedule-detail-head single-row-summary">
              <strong className="mobile-schedule-selected-date">{formatSelectedDateLabel(selectedDate)}</strong>
              <div className="mobile-schedule-detail-meta summary-inline-row">
                <span className={`mobile-schedule-kind-chip ${selectedDaySummary?.is_handless_day ? 'handless' : 'general'}`}>{selectedDaySummary?.is_handless_day ? '손' : '일'}</span>
                <div className="mobile-schedule-status-button" aria-label="가용차량수 요약">
                  <span className="mobile-schedule-vehicle-chip centered">가용차량수 {String(selectedDaySummary?.available_vehicle_count ?? 0).padStart(2, '0')}</span>
                  <span className="mobile-schedule-vehicle-inline centered">A: {String(selectedDaySummary?.status_a_count ?? 0).padStart(2, '0')} / B: {String(selectedDaySummary?.status_b_count ?? 0).padStart(2, '0')} / C: {String(selectedDaySummary?.status_c_count ?? 0).padStart(2, '0')}</span>
                </div>
              </div>
            </div>
            {mobileCalendarCollapsed && (
              <div className="schedule-popup-list embedded">
                {detailItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="detail-schedule-item popup-item colorized"
                    style={{ background: applyAlphaToHex(item.color, '24'), borderColor: applyAlphaToHex(item.color, '88') }}
                    onClick={() => openScheduleDetailPopup(item)}
                  >
                    <ScheduleCardLine item={item} colorized={false} />
                  </button>
                ))}
                {detailItems.length === 0 && <div className="muted">등록된 일정이 없습니다.</div>}
              </div>
            )}
          </div>
        )}
      </section>

      {legendOpen && <ScheduleLegendModal onClose={() => setLegendOpen(false)} />}

      {calendarStatusDate && (
        <div className="schedule-popup-backdrop" onClick={closeCalendarStatusPopup}>
          <section className="schedule-popup-card day-status-popup expanded" onClick={event => event.stopPropagation()}>
            <form onSubmit={submitCalendarStatus} className="work-day-status-editor popup detailed">
              <div className="between work-day-status-editor-head">
                <button type="button" className="ghost small" onClick={closeCalendarStatusPopup}>닫기</button>
                {!readOnly && (
                  <div className="inline-actions wrap">
                    {!calendarStatusEditMode ? (
                      <button type="button" className="small ghost" onClick={() => setCalendarStatusEditMode(true)}>편집</button>
                    ) : (
                      <button type="submit" className="small">저장</button>
                    )}
                  </div>
                )}
              </div>
              <div className="work-day-status-summary-top detailed">
                <button type="button" className="work-day-status-line-button" onClick={() => openVehicleListPopup(selectedDaySummary)}><span className="work-day-status-line">가용차량 {String(calendarStatusForm.available_vehicle_count ?? 0).padStart(2, '0')} / A {String(calendarStatusForm.status_a_count ?? 0).padStart(2, '0')} / B {String(calendarStatusForm.status_b_count ?? 0).padStart(2, '0')} / C {String(calendarStatusForm.status_c_count ?? 0).padStart(2, '0')}</span></button>
                <div className={`calendar-handless-pill ${calendarStatusForm.is_handless_day ? 'active' : ''}`}>{calendarStatusForm.is_handless_day ? '손없음' : '일반'}</div>
              </div>

              {!calendarStatusEditMode && (
                <div className="day-status-detail-view stack">
                  <div className="day-status-detail-row">
                    <strong>가용차량</strong>
                    <button type="button" className="ghost small" onClick={() => openVehicleListPopup(selectedDaySummary)}>{String(calendarStatusForm.available_vehicle_count ?? 0).padStart(2, '0')}대 보기</button>
                  </div>
                  <div className="day-status-detail-row">
                    <strong>A/B/C</strong>
                    <span>A {String(calendarStatusForm.status_a_count ?? 0).padStart(2, '0')}건 · B {String(calendarStatusForm.status_b_count ?? 0).padStart(2, '0')}건 · C {String(calendarStatusForm.status_c_count ?? 0).padStart(2, '0')}건</span>
                  </div>
                  <div className="day-status-detail-row block">
                    <div className="between day-status-exclusion-head">
                      <strong>* 열외자 : {exclusionCount(businessExclusionDraft) + exclusionCount(staffExclusionDraft) + ((selectedDaySummary?.auto_unavailable_business || []).length)}건</strong>
                      {Number(currentUser?.grade || 6) <= 2 ? <button type="button" className="small ghost" onClick={openExceptionManager}>열외관리</button> : null}
                    </div>
                    <div className="day-status-exclusion-group">
                      <div className="day-status-exclusion-heading">- 사업자 : [{(selectedDaySummary?.auto_unavailable_business || []).length}명]</div>
                      {(selectedDaySummary?.auto_unavailable_business || []).length ? (
                        <div className="day-status-exclusion-bullets">
                          {(selectedDaySummary.auto_unavailable_business || []).map(item => (
                            <div key={`auto-exclusion-${item.exclusion_id || item.user_id}-${item.start_date || ''}`} className="day-status-exclusion-bullet">{formatBusinessExceptionDetailLine(item)}</div>
                          ))}
                        </div>
                      ) : <div className="muted">표시할 사업자 열외가 없습니다.</div>}
                    </div>
                    <div className="day-status-exclusion-group">
                      <div className="day-status-exclusion-heading">- 직원 : {renderExclusionText(staffExclusionDraft)}</div>
                    </div>
                  </div>
                  {calendarStatusForm.day_memo ? (
                    <div className="day-status-detail-row block">
                      <strong>상세 메모</strong>
                      <div className="muted">{calendarStatusForm.day_memo}</div>
                    </div>
                  ) : null}
                </div>
              )}

              {calendarStatusEditMode && !readOnly && (
                <>
                  <div className="work-day-status-editor-grid">
                    <label>가용차량수(자동연동)<input type="number" min="0" value={calendarStatusForm.available_vehicle_count} readOnly disabled /></label>
                    <label>A : 숫자입력칸<input type="number" min="0" value={calendarStatusForm.status_a_count} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, status_a_count: Number(e.target.value || 0) })} /></label>
                    <label>B : 숫자입력칸<input type="number" min="0" value={calendarStatusForm.status_b_count} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, status_b_count: Number(e.target.value || 0) })} /></label>
                    <label>C : 숫자입력칸<input type="number" min="0" value={calendarStatusForm.status_c_count} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, status_c_count: Number(e.target.value || 0) })} /></label>
                  </div>
                  <label className="checkbox-line"><input type="checkbox" checked={Boolean(calendarStatusForm.is_handless_day)} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, is_handless_day: e.target.checked })} /> 손없는날 지정</label>
                  <div className="status-exclusion-editor stack">
                    <div className="status-exclusion-title">사업자 열외 편집</div>
                    {businessExclusionDraft.map((item, index) => (
                      <div key={`business-exclusion-${index}`} className="status-exclusion-row">
                        <input value={item.name} onChange={e => updateBusinessExclusion(index, 'name', e.target.value)} placeholder="대표자 입력칸" />
                        <input value={item.reason} onChange={e => updateBusinessExclusion(index, 'reason', e.target.value)} placeholder="사유 입력칸" />
                      </div>
                    ))}
                  </div>
                  <div className="status-exclusion-editor stack">
                    <div className="status-exclusion-title">직원 열외 편집</div>
                    {staffExclusionDraft.map((item, index) => (
                      <div key={`staff-exclusion-${index}`} className="status-exclusion-row">
                        <input value={item.name} onChange={e => updateStaffExclusion(index, 'name', e.target.value)} placeholder="직원 입력칸" />
                        <input value={item.reason} onChange={e => updateStaffExclusion(index, 'reason', e.target.value)} placeholder="사유 입력칸" />
                      </div>
                    ))}
                  </div>
                  <textarea value={calendarStatusForm.day_memo} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, day_memo: e.target.value })} placeholder="상세 메모 입력" className="work-day-status-editor-memo" />
                </>
              )}
            </form>
          </section>
        </div>
      )}

      {vehicleListPopup.open && (
        <div className="schedule-popup-backdrop" onClick={closeVehicleListPopup}>
          <section className="schedule-popup-card vehicle-list-popup" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>{vehicleListPopup.title}</strong>
                <div className="muted">가용차량 {String((vehicleListPopup.items || []).length).padStart(2, '0')}대 목록입니다.</div>
              </div>
              <button type="button" className="ghost small" onClick={closeVehicleListPopup}>닫기</button>
            </div>
            <div className="vehicle-list-stack">
              {(vehicleListPopup.items || []).map((item, index) => (
                <div key={`${item.branch_no || 'x'}-${item.display_name || index}`} className="vehicle-list-row">{item.label}</div>
              ))}
              {!(vehicleListPopup.items || []).length && <div className="muted">표시할 가용차량 목록이 없습니다.</div>}
            </div>
          </section>
        </div>
      )}

      {exceptionManagerOpen && (
        <div className="schedule-popup-backdrop" onClick={() => setExceptionManagerOpen(false)}>
          <section className="schedule-popup-card exception-manager-popup" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>열외관리</strong>
                <div className="muted">관리자 / 부관리자만 차량열외 데이터를 추가·편집·삭제할 수 있습니다.</div>
              </div>
              <button type="button" className="ghost small" onClick={() => setExceptionManagerOpen(false)}>닫기</button>
            </div>
            <div className="inline-actions wrap exception-manager-actions">
              <button type="button" className={exceptionAction === 'add' ? 'small' : 'small ghost'} onClick={() => { setExceptionAction('add'); setEditingExceptionId(null); setExceptionForm(prev => ({ ...prev, start_date: selectedDate, end_date: selectedDate, reason: '' })) }}>열외추가</button>
              <button type="button" className={exceptionAction === 'edit' ? 'small' : 'small ghost'} onClick={() => setExceptionAction('edit')}>열외편집</button>
              <button type="button" className="small ghost" onClick={() => setExceptionAction('delete')}>열외삭제</button>
            </div>
            <div className="exception-manager-grid">
              <label>사업자
                <select value={exceptionForm.user_id} onChange={e => setExceptionForm(prev => ({ ...prev, user_id: e.target.value }))}>
                  <option value="">선택</option>
                  {exceptionAccounts.map(item => <option key={`exception-account-${item.id}`} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>시작일<input type="date" value={exceptionForm.start_date} onChange={e => setExceptionForm(prev => ({ ...prev, start_date: e.target.value }))} /></label>
              <label>종료일<input type="date" value={exceptionForm.end_date} onChange={e => setExceptionForm(prev => ({ ...prev, end_date: e.target.value }))} /></label>
              <label className="exception-reason-field">열외사유<textarea rows={2} value={exceptionForm.reason} onChange={e => setExceptionForm(prev => ({ ...prev, reason: e.target.value }))} placeholder="열외사유 입력" /></label>
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small" disabled={exceptionLoading} onClick={submitExceptionAction}>{exceptionAction === 'edit' ? '편집저장' : '열외추가'}</button>
            </div>
            <div className="day-status-exclusion-list exception-manager-list">
              {(exceptionItems || []).map(item => (
                <div key={`manager-ex-${item.exclusion_id || item.user_id}-${item.start_date || ''}`} className="exception-manager-item">
                  <div className="exception-manager-text">{formatBusinessExceptionLabel(item)}<div className="muted tiny-text">{item.start_date} ~ {item.end_date}</div></div>
                  <div className="inline-actions wrap">
                    <button type="button" className="small ghost" onClick={() => startExceptionEdit(item)}>열외편집</button>
                    <button type="button" className="small ghost" onClick={() => deleteExceptionItem(item)}>열외삭제</button>
                  </div>
                </div>
              ))}
              {!(exceptionItems || []).length && <div className="muted">선택한 날짜의 사업자 열외 데이터가 없습니다.</div>}
            </div>
          </section>
        </div>
      )}

      {detailPopupEventId && (
        <div className="schedule-popup-backdrop schedule-detail-popup-backdrop" onClick={() => closeScheduleDetailPopup(false)}>
          <section className="schedule-popup-card schedule-detail-popup-card" onClick={event => event.stopPropagation()}>
            <ScheduleDetailContent eventId={detailPopupEventId} embedded onClose={closeScheduleDetailPopup} />
          </section>
        </div>
      )}

      {overflowPopup.dateKey && (
        <div className="schedule-inline-overlay schedule-inline-overlay-pass-through">
          <section className="schedule-inline-popup-card schedule-inline-popup-card-expanded" style={{ left: overflowPopup.x, top: overflowPopup.y }} onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head schedule-popup-head-expanded">
              <div className="schedule-popup-head-main">
                <strong>{formatSelectedDateLabel(overflowPopup.dateKey)}</strong>
              </div>
              <button type="button" className="ghost small schedule-popup-close-x" onClick={closeOverflowPopup}>X</button>
            </div>
            <div className="schedule-popup-summary-bar">
              <span className="schedule-popup-summary-chip">가용차량수 {String(overflowPopup.daySummary?.available_vehicle_count ?? 0).padStart(2, '0')}</span>
              <span className="schedule-popup-summary-chip">A: {String(overflowPopup.daySummary?.status_a_count ?? 0).padStart(2, '0')}</span>
              <span className="schedule-popup-summary-chip">B: {String(overflowPopup.daySummary?.status_b_count ?? 0).padStart(2, '0')}</span>
              <span className="schedule-popup-summary-chip">C: {String(overflowPopup.daySummary?.status_c_count ?? 0).padStart(2, '0')}</span>
              <span className={`schedule-popup-summary-chip kind ${overflowPopup.daySummary?.is_handless_day ? 'handless' : 'general'}`}>{overflowPopup.daySummary?.is_handless_day ? '손없는날' : '일반'}</span>
            </div>
            <div className="schedule-popup-list-title">기본일정들</div>
            <div className="schedule-popup-list">
              {overflowPopup.items.map(item => {
                const isWorkEntry = item.entry_type === 'manual' || item.source_summary === ''
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="detail-schedule-item popup-item colorized schedule-popup-item-expanded"
                    style={{ background: applyAlphaToHex(item.color || '#334155', '24'), borderColor: applyAlphaToHex(item.color || '#334155', '88') }}
                    onClick={() => {
                      closeOverflowPopup()
                      if (!isWorkEntry && item.event_id) openScheduleDetailPopup(item)
                    }}
                  >
                    <ScheduleCardLine item={item} colorized={false} />
                  </button>
                )
              })}
              {overflowPopup.items.length === 0 && <div className="muted">등록된 일정이 없습니다.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function emptyWorkScheduleForm(scheduleDate) {
  return {
    id: '',
    entry_type: 'manual',
    event_id: null,
    schedule_date: scheduleDate,
    schedule_time: '',
    customer_name: '',
    representative_names: '',
    staff_names: '',
    memo: '',
  }
}

function buildWorkScheduleForm(item, scheduleDate = '') {
  const addressValue = String(item?.start_address || item?.location || item?.origin_address || item?.memo || '').trim()
  return {
    id: item?.id ?? '',
    entry_type: item?.entry_type || 'manual',
    event_id: item?.event_id ?? null,
    schedule_date: item?.schedule_date || scheduleDate || '',
    schedule_time: item?.schedule_time || '',
    customer_name: item?.customer_name || '',
    representative_names: normalizeAssigneeValueForSave(item?.representative_names || [item?.representative1, item?.representative2, item?.representative3].filter(Boolean).join(' / ')),
    staff_names: normalizeAssigneeValueForSave(item?.staff_names || [item?.staff1, item?.staff2, item?.staff3].filter(Boolean).join(' / ')),
    memo: item?.memo || '',
    address_text: addressValue,
  }
}

function buildAbcInlineText(item) {
  const a = Number(item?.status_a_count || 0)
  const b = Number(item?.status_b_count || 0)
  const c = Number(item?.status_c_count || 0)
  return `A: ${String(a).padStart(2, '0')} / B: ${String(b).padStart(2, '0')} / C: ${String(c).padStart(2, '0')}`
}

function toNonNegativeInt(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(Math.trunc(parsed), 0)
}

function analyzeScheduleDayCapacity(daySummary) {
  const available = toNonNegativeInt(daySummary?.available_vehicle_count)
  const a = toNonNegativeInt(daySummary?.status_a_count)
  const b = toNonNegativeInt(daySummary?.status_b_count)
  const c = toNonNegativeInt(daySummary?.status_c_count)
  const morningUsed = a + b
  const remainingMorning = available - morningUsed
  const afternoonCapacity = a + Math.max(remainingMorning, 0)
  const remainingAfternoon = afternoonCapacity - c
  const hasMismatch = c > afternoonCapacity
  const effectiveRemaining = remainingMorning > 0 ? remainingMorning : Math.max(remainingAfternoon, 0)

  let level = 'normal'
  let label = '여유'
  if (hasMismatch) {
    level = 'error'
    label = '일정오류'
  } else if (remainingMorning <= 0 && remainingAfternoon <= 0) {
    level = 'full'
    label = '완전마감'
  } else if (effectiveRemaining <= 1) {
    level = 'critical'
    label = '완전마감 직전'
  } else if (effectiveRemaining === 2) {
    level = 'warning'
    label = '마감 거의 직전'
  }

  const detail = hasMismatch
    ? `일정오류 · 가용 ${available} / A ${a} / B ${b} / C ${c} / 오전잔여 ${Math.max(remainingMorning, 0)} / 오후가능 ${afternoonCapacity} / 초과 ${Math.max(c - afternoonCapacity, 0)}`
    : `${label} · 가용 ${available} / A ${a} / B ${b} / C ${c} / 오전잔여 ${Math.max(remainingMorning, 0)} / 오후잔여 ${Math.max(remainingAfternoon, 0)}`

  return {
    available,
    a,
    b,
    c,
    morningUsed,
    remainingMorning,
    afternoonCapacity,
    remainingAfternoon,
    effectiveRemaining,
    hasMismatch,
    level,
    label,
    detail,
  }
}

function buildCalendarDayStatusClass(daySummary) {
  const analysis = analyzeScheduleDayCapacity(daySummary)
  return `calendar-day-state-${analysis.level}`
}

function ScheduleLegendModal({ onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card schedule-legend-modal" onClick={event => event.stopPropagation()}>
        <div className="between">
          <strong>표 설명</strong>
          <button type="button" className="small ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="stack compact-gap schedule-legend-body">
          <div><strong>일자 칸 색상의미</strong></div>
          <div className="schedule-legend-list">
            <div><span className="schedule-legend-chip full">검정</span> 완전 마감</div>
            <div><span className="schedule-legend-chip critical">빨강</span> 완전 마감 직전(차량 1대 여유)</div>
            <div><span className="schedule-legend-chip warning">노랑</span> 마감 거의 직전(차량 2대 여유)</div>
            <div><span className="schedule-legend-chip normal">흰색</span> 여유(차량 3대 이상 여유)</div>
            <div><span className="schedule-legend-chip error">분홍</span> 일정 오류 또는 검토 필요</div>
          </div>
          <div><strong>가용 차량수</strong> : 실제 출동 가능한 차량 수입니다.<br />* [가맹점 총 차량수] - [열외차량] = [가용차량수]을 의미합니다.</div>
          <div><strong>A</strong> : 오후 재출동 가능한 오전일정<br /><strong>B</strong> : 오후 재출동 불가한 오전일정<br /><strong>C</strong> : 오후 2시 30분 이후 일정</div>
          <div><strong>손없음</strong> : 손 없는 날에 해당<br /><strong>일반</strong> : 일반 날짜</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}


function buildTextEditableSelector(element) {
  if (!(element instanceof Element)) return ''
  const direct = buildHtmlInspectorSelector(element)
  if (direct) return direct
  const editable = element.closest('[data-text-edit-key], h1, h2, h3, h4, h5, h6, strong, span, p, label, button, a, th, td, div')
  if (!(editable instanceof Element)) return ''
  return buildHtmlInspectorSelector(editable)
}

function normalizeTextOverrideList(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(item => ({
      path: String(item?.path || '*').trim() || '*',
      selector: String(item?.selector || '').trim(),
      text: String(item?.text ?? ''),
    }))
    .filter(item => item.selector)
}

function applyTextOverridesForPath(overrides = [], pathName = '') {
  if (typeof document === 'undefined') return
  const normalizedPath = String(pathName || window.location?.pathname || '').trim() || '/'
  normalizeTextOverrideList(overrides).forEach(item => {
    if (item.path !== '*' && item.path !== normalizedPath) return
    const target = document.querySelector(item.selector)
    if (!(target instanceof Element)) return
    target.textContent = item.text
  })
}

function extractAssigneeDisplayName(token) {
  const raw = String(token || '').trim()
  if (!raw) return ''
  const bracketMatches = [...raw.matchAll(/\[([^\]]+)\]/g)].map(match => String(match[1] || '').trim()).filter(Boolean)
  if (bracketMatches.length >= 2) return bracketMatches[1]
  if (bracketMatches.length === 1) return bracketMatches[0]
  return raw.replace(/^@+/, '').trim()
}

function normalizeAssigneeValueForSave(value) {
  return splitScheduleNames(value).join(' / ')
}

function splitScheduleNames(value) {
  return String(value || '')
    .split(/[\n,/]+/)
    .map(token => extractAssigneeDisplayName(token))
    .map(token => token.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function resolveScheduleAssigneeRole(user = {}) {
  const title = normalizeMarkerPositionTitle(user?.position_title || user?.position || user?.grade_name || '')
  if (['대표', '부대표', '호점대표'].includes(title)) return 'business'
  if (['팀장', '부팀장', '직원'].includes(title)) return 'staff'
  return ''
}

function buildAssigneeTagValue(user) {
  const displayName = String(user?.name || user?.nickname || user?.email || '').trim()
  const role = resolveScheduleAssigneeRole(user)
  const branchNo = Number(user?.branch_no)
  const branchLabel = Number.isFinite(branchNo) && branchNo >= 0 ? `${branchNo}호점` : '미지정'
  const positionLabel = String(user?.position_title || user?.position || user?.grade_name || '').trim() || '미지정'
  const phoneLabel = String(user?.phone || user?.email || '').trim()
  if (!displayName) return ''
  if (role === 'business') return `[${branchLabel}] [${displayName}]${phoneLabel ? ` [${phoneLabel}]` : ''}`
  if (role === 'staff') return `[${positionLabel}] [${displayName}]${phoneLabel ? ` [${phoneLabel}]` : ''}`
  return `[${displayName}]${phoneLabel ? ` [${phoneLabel}]` : ''}`
}

function buildAssigneeOptionMeta(user) {
  const role = resolveScheduleAssigneeRole(user)
  if (role === 'business') {
    const branchNo = Number(user?.branch_no)
    const branchLabel = Number.isFinite(branchNo) && branchNo >= 0 ? `${branchNo}호점` : '미지정'
    const displayName = String(user?.name || user?.nickname || user?.email || '').trim() || '-'
    const phoneLabel = String(user?.phone || user?.email || '').trim() || '-'
    return `[${branchLabel}] [${displayName}] [${phoneLabel}]`
  }
  if (role === 'staff') {
    const positionLabel = String(user?.position_title || user?.position || user?.grade_name || '').trim() || '미지정'
    const displayName = String(user?.name || user?.nickname || user?.email || '').trim() || '-'
    const phoneLabel = String(user?.phone || user?.email || '').trim() || '-'
    return `[${positionLabel}] [${displayName}] [${phoneLabel}]`
  }
  const parts = [String(user?.name || user?.nickname || user?.email || '').trim(), String(user?.phone || user?.email || '').trim()].filter(Boolean)
  return parts.join(' · ')
}

function filterAssignableUsers(users, query, selectedValues = [], predicate = null) {
  const normalized = String(query || '').replace(/^@+/, '').trim().toLowerCase()
  const selectedSet = new Set((selectedValues || []).map(item => String(item || '').trim()).filter(Boolean))
  return (users || [])
    .filter(user => {
      const value = buildAssigneeTagValue(user)
      if (!value || selectedSet.has(value)) return false
      if (predicate && !predicate(user)) return false
      if (!normalized) return true
      const haystack = [
        user?.name,
        user?.nickname,
        user?.email,
        user?.phone,
        user?.vehicle_number,
        user?.branch_no,
        user?.position_title,
        buildAssigneeTagValue(user),
      ].join(' ').toLowerCase()
      return haystack.includes(normalized)
    })
    .slice(0, 8)
}

function AssigneeInput({ label, value, onChange, users, placeholder, predicate = null, maxCount = 3, inputLike = false, showMeta = false, disabled = false, inputClassName = '' }) {
  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState('')
  const [portalStyle, setPortalStyle] = useState(null)
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0)
  const shellRef = useRef(null)
  const inputRef = useRef(null)
  const selectedValues = useMemo(() => splitScheduleNames(value), [value])
  const normalizedQuery = String(query || '').replace(/^@+/, '').trim()
  const shouldShowSuggestions = String(query || '').includes('@')
  const suggestions = useMemo(() => shouldShowSuggestions ? filterAssignableUsers(users, query, selectedValues, predicate) : [], [users, query, selectedValues, predicate, shouldShowSuggestions])

  useEffect(() => {
    if (!shouldShowSuggestions || suggestions.length === 0) {
      setHighlightedSuggestionIndex(0)
      return
    }
    setHighlightedSuggestionIndex(prev => Math.min(prev, suggestions.length - 1))
  }, [shouldShowSuggestions, suggestions])

  function syncNext(values) {
    if (disabled) return
    onChange(values.slice(0, maxCount).join(' / '))
  }

  function removeChip(target) {
    syncNext(selectedValues.filter(selected => selected !== target))
    setActiveChip('')
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function addByText(raw) {
    const token = String(raw || '').replace(/^@+/, '').trim()
    if (!token) {
      setQuery('')
      setHighlightedSuggestionIndex(0)
      return
    }
    if (selectedValues.includes(token)) {
      setQuery('')
      setHighlightedSuggestionIndex(0)
      return
    }
    syncNext([...selectedValues, token])
    setQuery('')
    setActiveChip('')
    setHighlightedSuggestionIndex(0)
  }

  function handleKeyDown(event) {
    if (disabled) return
    if (shouldShowSuggestions && suggestions.length > 0 && event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedSuggestionIndex(prev => Math.min(prev + 1, suggestions.length - 1))
      return
    }
    if (shouldShowSuggestions && suggestions.length > 0 && event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedSuggestionIndex(prev => Math.max(prev - 1, 0))
      return
    }
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (shouldShowSuggestions && suggestions.length > 0) {
        const picked = suggestions[Math.min(highlightedSuggestionIndex, suggestions.length - 1)] || suggestions[0]
        if (picked) addByText(buildAssigneeTagValue(picked))
      }
      return
    }
    if (event.key === 'Backspace' && !query && selectedValues.length > 0) {
      event.preventDefault()
      syncNext(selectedValues.slice(0, -1))
      setActiveChip('')
    }
  }

  useLayoutEffect(() => {
    if (!shouldShowSuggestions || suggestions.length === 0 || !shellRef.current) {
      setPortalStyle(null)
      return
    }
    const updatePosition = () => {
      const shellRect = shellRef.current?.getBoundingClientRect()
      const inputRect = inputRef.current?.getBoundingClientRect()
      const anchorRect = shellRect || inputRect
      if (!anchorRect) return
      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || anchorRect.width
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || anchorRect.bottom
      const longestText = suggestions.reduce((max, user) => {
        const tagValue = buildAssigneeTagValue(user)
        const meta = showMeta ? buildAssigneeOptionMeta(user) : ''
        return Math.max(max, tagValue.length, meta.length)
      }, 0)
      const baseWidth = Math.max(shellRect?.width || 0, inputRect?.width || 0, 168)
      const estimatedWidth = Math.min(viewportWidth - 16, Math.max(baseWidth, Math.min(viewportWidth - 16, (longestText * 9) + 44)))
      const anchorLeft = shellRect?.left ?? inputRect?.left ?? anchorRect.left
      const anchorRight = inputRect?.right ?? shellRect?.right ?? anchorRect.right
      const anchorBottom = inputRect?.bottom ?? shellRect?.bottom ?? anchorRect.bottom
      const maxLeft = Math.max(8, viewportWidth - estimatedWidth - 8)
      const preferredRightAlignedLeft = anchorRight - estimatedWidth
      const safeLeft = Math.min(Math.max(8, preferredRightAlignedLeft), maxLeft)
      const safeTop = Math.min(anchorBottom + 6, viewportHeight - 8)
      setPortalStyle({
        position: 'fixed',
        top: safeTop,
        left: safeLeft,
        width: estimatedWidth,
        maxWidth: viewportWidth - 16,
        zIndex: 5000,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [shouldShowSuggestions, suggestions, showMeta, query])

  const suggestionLayer = !disabled && shouldShowSuggestions && suggestions.length > 0 && portalStyle ? createPortal(
    <div className="assignee-suggestion-list portal" style={portalStyle}>
      {suggestions.map((user, index) => {
        const tagValue = buildAssigneeTagValue(user)
        return (
          <button
            key={`${label || 'assignee'}-${user.id}`}
            type="button"
            className={`assignee-suggestion-item${highlightedSuggestionIndex === index ? ' active' : ''}`}
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setHighlightedSuggestionIndex(index)}
            onClick={() => addByText(tagValue)}
          >
            <strong>{tagValue}</strong>
            {showMeta ? <span>{buildAssigneeOptionMeta(user)}</span> : null}
          </button>
        )
      })}
    </div>,
    document.body,
  ) : null

  return (
    <div className="stack compact-gap assignee-field-wrap">
      {label && <label>{label}</label>}
      <div className={`assignee-input-shell${inputLike ? ' input-like' : ''}${inputClassName ? ` ${inputClassName}` : ''}`} ref={shellRef}>
        <div className={`assignee-chip-list${inputLike ? ' input-like' : ''}${disabled ? ' disabled' : ''}${inputClassName ? ` ${inputClassName}` : ''}`} onClick={() => { if (!disabled) inputRef.current?.focus() }}>
          {selectedValues.map((item, index) => {
            const isActive = activeChip === item
            const displayName = extractAssigneeDisplayName(item)
            return (
              <button
                key={item}
                type="button"
                className={`assignee-chip assignee-chip-text${isActive ? ' active' : ''}`}
                onClick={() => { if (!disabled) setActiveChip(prev => prev === item ? '' : item) }}
                title={displayName}
              >
                <span>{displayName}{index < selectedValues.length - 1 ? ',' : ''}</span>
                {isActive && <span className="assignee-chip-remove-inline" onClick={event => { event.stopPropagation(); removeChip(item) }}>×</span>}
              </button>
            )
          })}
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            disabled={disabled}
            onChange={e => {
              if (disabled) return
              setQuery(e.target.value)
              setActiveChip('')
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              window.setTimeout(() => {
                setActiveChip('')
                setQuery('')
              }, 120)
            }}
          />
        </div>
      </div>
      {suggestionLayer}
    </div>
  )
}

function workScheduleHeading(index) {
  if (index === 0) return '당일스케줄'
  if (index === 1) return '내일스케줄'
  if (index === 2) return '모레스케줄'
  return `${index + 1}일치 스케줄`
}

function workScheduleDateLine(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`
}

function buildDayStatusForm(day) {
  return {
    schedule_date: day?.date || fmtDate(new Date()),
    excluded_business: day?.excluded_business || '',
    excluded_staff: day?.excluded_staff || '',
    excluded_business_details: day?.excluded_business_details || [],
    excluded_staff_details: day?.excluded_staff_details || [],
    available_vehicle_count: Number(day?.available_vehicle_count || 0),
    available_vehicle_accounts: day?.available_vehicle_accounts || [],
    auto_unavailable_business: day?.auto_unavailable_business || [],
    status_a_count: Number(day?.status_a_count || 0),
    status_b_count: Number(day?.status_b_count || 0),
    status_c_count: Number(day?.status_c_count || 0),
    day_memo: day?.day_memo || '',
    is_handless_day: Boolean(day?.is_handless_day),
  }
}


function HandlessDaysPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const monthParam = searchParams.get('month')
  const baseDate = monthParam ? new Date(`${monthParam}-01T00:00:00`) : startOfMonth(new Date())
  const [monthCursor, setMonthCursor] = useState(Number.isNaN(baseDate.getTime()) ? startOfMonth(new Date()) : startOfMonth(baseDate))
  const [workDays, setWorkDays] = useState([])
  const [selectedDates, setSelectedDates] = useState(new Set())
  const isMobile = useIsMobile()
  const days = useMemo(() => buildMonthDays(monthCursor), [monthCursor])

  async function load() {
    const firstDate = fmtDate(days[0] || new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1))
    const data = await api(`/api/work-schedule?start_date=${firstDate}&days=42`)
    setWorkDays(data.days || [])
    setSelectedDates(new Set((data.days || []).filter(item => item.is_handless_day).map(item => item.date)))
  }

  useEffect(() => { load().catch(() => {}) }, [monthCursor, days])

  const dayMap = useMemo(() => new Map(workDays.map(item => [item.date, item])), [workDays])
  const monthLabel = `${monthCursor.getFullYear()}년 ${monthCursor.getMonth() + 1}월`

  async function saveSelected() {
    const visibleDates = days.filter(date => isSameMonthDate(date, monthCursor)).map(date => fmtDate(date))
    await api('/api/work-schedule/handless-bulk', {
      method: 'POST',
      body: JSON.stringify({ month: fmtDate(monthCursor).slice(0, 7), visible_dates: visibleDates, selected_dates: Array.from(selectedDates) }),
    })
    window.alert('손없는날 설정이 저장되었습니다.')
    navigate(`/schedule?date=${fmtDate(monthCursor)}`)
  }

  function toggleDate(key) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="stack-page">
      <section className={`card schedule-card handless-page${isMobile ? ' mobile' : ''}`}>
        <div className="calendar-toolbar upgraded handless-toolbar-centered">
          <div className="handless-toolbar-spacer" aria-hidden="true" />
          <div className="handless-toolbar-month-nav">
            <button type="button" className="ghost small icon-month-button" onClick={() => setMonthCursor(addMonths(monthCursor, -1))}>◀</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="ghost small icon-month-button" onClick={() => setMonthCursor(addMonths(monthCursor, 1))}>▶</button>
          </div>
          <div className="inline-actions wrap handless-toolbar-actions">
            <button type="button" className="ghost small handless-toolbar-action-button" onClick={() => navigate('/schedule')}>닫기</button>
            <button type="button" className="small handless-toolbar-action-button" onClick={() => saveSelected().catch(err => window.alert(err.message))}>저장</button>
          </div>
        </div>
        <div className="calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day} className="weekday">{day}</div>)}</div>
        <div className="calendar-grid handless-grid">
          {days.map((date, idx) => {
            const key = fmtDate(date)
            const active = selectedDates.has(fmtDate(date))
            const isCurrentMonth = isSameMonthDate(date, monthCursor)
            const dayInfo = dayMap.get(key)
            return (
              <div key={key} className={`calendar-cell handless-picker-cell${active ? ' selected handless-day-cell' : ''}${!isCurrentMonth ? ' outside-month-cell' : ''}`}>
                <button type="button" className="handless-date-button" onClick={() => toggleDate(fmtDate(date))}>
                  <span className={`handless-date-number${active ? ' active' : ''}`}>{date.getDate()}</span>
                  {dayInfo?.is_handless_day && <span className="calendar-handless-pill mobile-compact active handless-inline-pill">손없음</span>}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function WorkSchedulePage() {
  const isMobile = useIsMobile()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const canEditAssignmentFields = canEditScheduleAssignments(currentUser)
  const todayKey = fmtDate(new Date())
  const [viewStartDate, setViewStartDate] = useState(todayKey)
  const [daysData, setDaysData] = useState([])
  const [loading, setLoading] = useState(true)
  const [entryForm, setEntryForm] = useState(emptyWorkScheduleForm(fmtDate(new Date())))
  const [activeFormDate, setActiveFormDate] = useState('')
  const [noteForm, setNoteForm] = useState({ schedule_date: '', excluded_business_slots: [''], excluded_business_reasons: [''], excluded_staff: '' })
  const businessSlotCount = Math.max(1, noteForm.excluded_business_slots.length, noteForm.excluded_business_reasons.length)
  const [noteDeleteMode, setNoteDeleteMode] = useState(false)
  const [noteDeleteChecks, setNoteDeleteChecks] = useState([])

  function setBusinessSlotCount(nextCount) {
    const safeCount = Math.max(1, Number(nextCount) || 1)
    setNoteForm(prev => ({
      ...prev,
      excluded_business_slots: Array.from({ length: safeCount }, (_, index) => String(prev.excluded_business_slots?.[index] || '')),
      excluded_business_reasons: Array.from({ length: safeCount }, (_, index) => String(prev.excluded_business_reasons?.[index] || '')),
    }))
  }
  const [activeNoteDate, setActiveNoteDate] = useState('')
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState('')
  const [editingForm, setEditingForm] = useState(emptyWorkScheduleForm(fmtDate(new Date())))
  const [bulkEditDate, setBulkEditDate] = useState('')
  const [bulkForms, setBulkForms] = useState({})
  const [bulkDeleteChecks, setBulkDeleteChecks] = useState({})
  const [activeStatusDate, setActiveStatusDate] = useState('')
  const [statusForm, setStatusForm] = useState(buildDayStatusForm(null))
  const [assignableUsers, setAssignableUsers] = useState([])
  const [businessExclusionOptions, setBusinessExclusionOptions] = useState([])
  const [detailPopupEventId, setDetailPopupEventId] = useState(null)

  const businessAssigneePredicate = useCallback(user => resolveScheduleAssigneeRole(user) === 'business', [])
  const staffAssigneePredicate = useCallback(user => resolveScheduleAssigneeRole(user) === 'staff', [])

  async function load() {
    setLoading(true)
    try {
      const requests = [api(`/api/work-schedule?start_date=${encodeURIComponent(viewStartDate)}&days=7`), api('/api/users')]
      if (!readOnly) requests.push(api('/api/admin-mode').catch(() => null))
      const [data, users, adminData] = await Promise.all(requests)
      setDaysData(data.days || [])
      const me = getStoredUser(); setAssignableUsers(me ? [me, ...(users || [])] : (users || []))
      if (!readOnly) {
        const branches = (adminData?.branches || [])
          .filter(item => !item?.archived_in_branch_status)
          .map(item => {
            const branchNo = resolveBusinessBranchNo(item)
            const displayName = item.name || item.nickname || item.email || (branchNo === 0 ? '본점' : (Number.isFinite(branchNo) ? `${branchNo}호점` : '미지정'))
            const isShimJinSu = String(displayName || '').trim() === '심진수'
            const normalizedBranchNo = isShimJinSu ? 0 : branchNo
            const branchLabel = normalizedBranchNo === 0 ? '0본점' : (Number.isFinite(normalizedBranchNo) ? `${normalizedBranchNo}호점` : '본점/미지정')
            return {
              value: String(normalizedBranchNo ?? item.branch_no ?? ''),
              label: `[${branchLabel}] [${displayName}]`,
              name: displayName,
              userId: item.id,
              branch_no: normalizedBranchNo,
              sortPriority: isShimJinSu ? -1 : (normalizedBranchNo === 0 ? 0 : 1),
            }
          })
          .sort((a, b) => {
            const priorityDiff = Number(a.sortPriority || 0) - Number(b.sortPriority || 0)
            if (priorityDiff !== 0) return priorityDiff
            const branchDiff = Number(a.branch_no || 999) - Number(b.branch_no || 999)
            if (branchDiff !== 0) return branchDiff
            return String(a.name || '').localeCompare(String(b.name || ''), 'ko')
          })
        setBusinessExclusionOptions(branches)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [viewStartDate])

  const canMoveToNextDate = viewStartDate < todayKey

  function moveScheduleWindow(amount) {
    setViewStartDate(fmtDate(addDays(new Date(`${viewStartDate}T00:00:00`), amount)))
  }

  function goTodaySchedule() {
    setViewStartDate(todayKey)
  }

  function openCreate(dateText) {
    setActiveFormDate(dateText)
    setEntryForm(emptyWorkScheduleForm(dateText))
    setMessage('')
  }

  function closeEntryForm() {
    setActiveFormDate('')
  }

  function openNotes(day) {
    setActiveNoteDate(day.date)
    setNoteDeleteMode(false)
    setNoteDeleteChecks([])
    const details = Array.isArray(day.excluded_business_details) ? day.excluded_business_details : []
    const rawSlots = details.length ? details.map(item => String(item?.branch_no || '').trim()) : parseExcludedBusinessSlots(day.excluded_business)
    const rawReasons = details.length ? details.map(item => String(item?.reason || '').trim()) : []
    const trimmed = trimExcludedBusinessRows(rawSlots.length ? rawSlots : [''], rawReasons.length ? rawReasons : [''])
    setNoteForm({
      schedule_date: day.date,
      excluded_business_slots: trimmed.slots.length ? trimmed.slots : [''],
      excluded_business_reasons: trimmed.reasons.length ? trimmed.reasons : [''],
      excluded_staff: day.excluded_staff || '',
    })
    setMessage('')
  }

  function closeNotes() {
    setActiveNoteDate('')
    setNoteDeleteMode(false)
    setNoteDeleteChecks([])
  }


  function addExcludedBusinessRow() {
    setBusinessSlotCount(businessSlotCount + 1)
  }

  function trimExcludedBusinessRows(nextSlots, nextReasons) {
    const trimmedSlots = [...nextSlots]
    const trimmedReasons = [...nextReasons]
    while (trimmedSlots.length > 1) {
      const lastIndex = trimmedSlots.length - 1
      if (String(trimmedSlots[lastIndex] || '').trim() || String(trimmedReasons[lastIndex] || '').trim()) break
      trimmedSlots.pop()
      trimmedReasons.pop()
    }
    return { slots: trimmedSlots, reasons: trimmedReasons }
  }

  function toggleNoteDeleteCheck(index) {
    setNoteDeleteChecks(prev => prev.includes(index) ? prev.filter(item => item !== index) : [...prev, index].sort((a, b) => a - b))
  }

  function applyNoteDeleteSelection() {
    if (!noteDeleteMode) {
      setNoteDeleteMode(true)
      setNoteDeleteChecks([])
      return
    }
    if (!noteDeleteChecks.length) {
      setNoteDeleteMode(false)
      return
    }
    const nextSlots = noteForm.excluded_business_slots.filter((_, index) => !noteDeleteChecks.includes(index))
    const nextReasons = (noteForm.excluded_business_reasons || Array(businessSlotCount).fill('')).filter((_, index) => !noteDeleteChecks.includes(index))
    const trimmed = trimExcludedBusinessRows(nextSlots, nextReasons)
    setNoteForm({
      ...noteForm,
      excluded_business_slots: trimmed.slots.length ? trimmed.slots : [''],
      excluded_business_reasons: trimmed.reasons.length ? trimmed.reasons : [''],
    })
    setNoteDeleteChecks([])
    setNoteDeleteMode(false)
  }


  function isEntryFormChanged(form) {
    return Boolean(
      String(form.schedule_time || '').trim()
      || String(form.customer_name || '').trim()
      || String(form.representative_names || '').trim()
      || String(form.staff_names || '').trim()
      || String(form.memo || '').trim()
    )
  }

  async function submitEntry(e) {
    e.preventDefault()
    if (!isEntryFormChanged(entryForm)) {
      closeEntryForm()
      return
    }
    await api('/api/work-schedule/entries', { method: 'POST', body: JSON.stringify({ ...entryForm, schedule_time: entryForm.schedule_time || '' }) })
    setMessage('스케줄이 등록되었습니다.')
    closeEntryForm()
    await load()
  }

  async function submitNotes(e) {
    e.preventDefault()
    const duplicated = noteForm.excluded_business_slots.filter(Boolean).some((value, index, arr) => arr.indexOf(value) !== index)
    if (duplicated) {
      window.alert('중첩된 선택입니다. 다른 사업자를 입력하세요')
      return
    }
    const hasMissingReason = noteForm.excluded_business_slots.some((value, index) => String(value || '').trim() && !String(noteForm.excluded_business_reasons?.[index] || '').trim())
    if (hasMissingReason) {
      window.alert('사업자 열외사유를 입력해 주세요.')
      return
    }
    const excludedBusinessDetails = buildExcludedBusinessDetailsFromSlots(noteForm.excluded_business_slots, businessExclusionOptions, noteForm.excluded_business_reasons)
    const payload = {
      schedule_date: noteForm.schedule_date,
      excluded_business: serializeExcludedBusinessSlots(noteForm.excluded_business_slots),
      excluded_business_details: excludedBusinessDetails,
      excluded_staff: noteForm.excluded_staff,
    }
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify(payload) })
    setMessage('열외자 목록이 저장되었습니다.')
    closeNotes()
    await load()
  }

  function openScheduleDetailPopup(item) {
    const linkedId = Number(item?.event_id || item?.id || 0)
    if (String(item?.entry_type || '') !== 'calendar' || linkedId <= 0) return
    navigate(`/schedule/${linkedId}`)
  }

  function closeScheduleDetailPopup(shouldReload = false) {
    setDetailPopupEventId(null)
    if (shouldReload) load().catch(() => {})
  }

  function rowKey(dayDate, item) {
    return `${dayDate}-${item.id}`
  }

  function formatSummary(item) {
    const timeText = item.schedule_time || '미정'
    const customerText = item.customer_name || '(고객명)'
    const repText = item.representative_names || '-'
    const staffText = item.staff_names || '-'
    const memoText = item.memo || '-'
    return `(${timeText}) (${customerText}) (${repText}) (${staffText}) (${memoText})`
  }

  function openRowEdit(dayDate, item) {
    setEditingKey(rowKey(dayDate, item))
    setEditingForm(buildWorkScheduleForm(item, dayDate))
    setMessage('')
  }

  function closeRowEdit() {
    setEditingKey('')
  }

  function openBulkEdit(day) {
    if (bulkEditDate === day.date) {
      setBulkEditDate('')
      setBulkDeleteChecks(prev => ({ ...prev, [day.date]: [] }))
      return
    }
    setBulkEditDate(day.date)
    setBulkForms(prev => ({
      ...prev,
      [day.date]: day.entries.map(item => buildWorkScheduleForm(item, day.date)),
    }))
    setBulkDeleteChecks(prev => ({ ...prev, [day.date]: [] }))
    setMessage('')
  }

  async function deleteScheduleForm(form) {
    const entryType = String(form?.entry_type || 'manual')
    const eventId = form?.event_id
    const rawId = String(form?.id || '')
    if (entryType === 'calendar' && eventId) {
      await api(`/api/calendar/events/${eventId}`, { method: 'DELETE' })
      return
    }
    const entryId = rawId.replace(/^manual-/, '')
    if (!entryId) return
    await api(`/api/work-schedule/entries/${entryId}`, { method: 'DELETE' })
  }

  function updateBulkForm(dayDate, index, field, value) {
    setBulkForms(prev => ({
      ...prev,
      [dayDate]: (prev[dayDate] || []).map((form, formIndex) => formIndex === index ? { ...form, [field]: value } : form),
    }))
  }

  async function saveScheduleForm(form) {
    const normalizedTime = normalizeScheduleTimeInput(form.schedule_time || '', form.schedule_time || '')
    if (form.entry_type === 'calendar' && form.event_id) {
      const existing = await api(`/api/calendar/events/${form.event_id}`)
      const repNames = splitScheduleNames(form.representative_names)
      const staffNames = splitScheduleNames(form.staff_names)
      const payload = {
        ...existing,
        start_time: normalizedTime || '미정',
        customer_name: form.customer_name || '',
        content: form.memo || '',
        representative1: repNames[0] || '',
        representative2: repNames[1] || '',
        representative3: repNames[2] || '',
        staff1: staffNames[0] || '',
        staff2: staffNames[1] || '',
        staff3: staffNames[2] || '',
      }
      await api(`/api/calendar/events/${form.event_id}`, { method: 'PUT', body: JSON.stringify(payload) })
      return
    }
    const entryId = String(form.id || '').replace(/^manual-/, '')
    await api(`/api/work-schedule/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify({
        schedule_date: form.schedule_date,
        schedule_time: normalizedTime || '',
        customer_name: form.customer_name || '',
        representative_names: normalizeAssigneeValueForSave(form.representative_names || ''),
        staff_names: normalizeAssigneeValueForSave(form.staff_names || ''),
        memo: form.memo || '',
      }),
    })
  }

  async function submitRowEdit(e) {
    e.preventDefault()
    await saveScheduleForm(editingForm)
    setMessage('스케줄이 수정되었습니다.')
    closeRowEdit()
    await load()
  }

  async function handleDeleteRowEdit() {
    await deleteScheduleForm(editingForm)
    setMessage('스케줄이 삭제되었습니다.')
    closeRowEdit()
    await load()
  }

  function toggleBulkDeleteCheck(dayDate, index, checked) {
    setBulkDeleteChecks(prev => {
      const current = Array.isArray(prev?.[dayDate]) ? prev[dayDate] : []
      const next = checked ? [...new Set([...current, index])].sort((a, b) => a - b) : current.filter(item => item !== index)
      return { ...prev, [dayDate]: next }
    })
  }

  function buildBulkDeleteMessage(forms = []) {
    if (!forms.length) return ''
    if (forms.length === 1) {
      const target = forms[0]
      const timeText = String(target?.schedule_time || '미정').trim() || '미정'
      const customerText = String(target?.customer_name || '고객').trim() || '고객'
      return `${timeText} ${customerText} 고객의 일정을 삭제하겠습니까?`
    }
    return `${forms.length}개의 선택한 일정을 삭제하겠습니까?`
  }

  async function applyBulkDelete(dayDate) {
    const indexes = Array.isArray(bulkDeleteChecks?.[dayDate]) ? bulkDeleteChecks[dayDate] : []
    if (!indexes.length) {
      window.alert('삭제할 일정을 체크해 주세요.')
      return
    }
    const forms = (bulkForms[dayDate] || []).filter((_, index) => indexes.includes(index))
    if (!forms.length) return
    const confirmed = window.confirm(buildBulkDeleteMessage(forms))
    if (!confirmed) return
    for (const form of forms) {
      await deleteScheduleForm(form)
    }
    setMessage('스케줄이 삭제되었습니다.')
    setBulkDeleteChecks(prev => ({ ...prev, [dayDate]: [] }))
    setBulkEditDate('')
    await load()
  }

  async function submitBulkEdit(dayDate) {
    const forms = bulkForms[dayDate] || []
    for (const form of forms) {
      await saveScheduleForm(form)
    }
    setMessage('일자별 스케줄이 전체 수정되었습니다.')
    setBulkEditDate('')
    await load()
  }

  function openStatusEditor(day) {
    setStatusForm(buildDayStatusForm(day))
    setActiveStatusDate(day.date)
  }

  async function submitStatusEditor(e) {
    e.preventDefault()
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify({ ...statusForm, available_vehicle_count: Number(daysData.find(item => item.date === activeStatusDate)?.available_vehicle_count || 0) }) })
    setMessage('일정현황 정보가 저장되었습니다.')
    setActiveStatusDate('')
    await load()
  }


  function isBulkDeleteChecked(dayDate, index) {
    return Array.isArray(bulkDeleteChecks?.[dayDate]) && bulkDeleteChecks[dayDate].includes(index)
  }

  function isBulkDeleteAllChecked(dayDate) {
    const forms = bulkForms[dayDate] || []
    const checks = bulkDeleteChecks?.[dayDate] || []
    return forms.length > 0 && forms.every((_, index) => checks.includes(index))
  }

  function toggleBulkDeleteAll(dayDate, checked) {
    setBulkDeleteChecks(prev => ({
      ...prev,
      [dayDate]: checked ? (bulkForms[dayDate] || []).map((_, index) => index) : [],
    }))
  }

  return (
    <div className={`stack-page work-schedule-page${isMobile ? ' mobile' : ''}`}>
      {message && <div className="success">{message}</div>}
      {loading && <div className="card">불러오는 중...</div>}
      {!loading && daysData.map((day, index) => {
        const businessCount = day.excluded_business_names?.length || 0
        const staffCount = day.excluded_staff_names?.length || 0
        const isBulkEdit = bulkEditDate === day.date
        const dayBulkForms = bulkForms[day.date] || []
        return (
          <section key={day.date} className={`card work-schedule-day${day.entries.length > 0 ? ' has-entries' : ' empty-day'}`}>
            <div className={`work-schedule-mobile-group-shell${isMobile ? ' mobile' : ''}`}>
              <div className={`between work-schedule-head${isMobile ? ' work-schedule-mobile-block' : ''}`}>
                {index === 0 ? (
                  <div className="work-schedule-headline work-schedule-headline-with-nav work-schedule-headline-two-row">
                    <div className="work-schedule-heading-title-row">
                      <strong>{workScheduleHeading(index)}</strong>
                    </div>
                    <div className="work-schedule-heading-sub-row">
                      <button type="button" className="ghost small work-schedule-today-button" onClick={goTodaySchedule}>오늘</button>
                      <div className="work-schedule-headline-center">
                        <button type="button" className="ghost small work-schedule-nav-button" onClick={() => moveScheduleWindow(-1)} aria-label="이전 날짜">◀</button>
                        <div className="work-schedule-heading-copy work-schedule-heading-copy-date-only">
                          <span className="muted work-schedule-date-inline">{workScheduleDateLine(day.date)}</span>
                        </div>
                        {canMoveToNextDate ? <button type="button" className="ghost small work-schedule-nav-button" onClick={() => moveScheduleWindow(1)} aria-label="다음 날짜">▶</button> : <span className="work-schedule-nav-spacer" aria-hidden="true" />}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="work-schedule-headline">
                    <strong>{workScheduleHeading(index)}</strong>
                    <span className="muted work-schedule-date-inline">{workScheduleDateLine(day.date)}</span>
                  </div>
                )}
              </div>

              <div className={`work-schedule-main-top${isMobile ? ' work-schedule-mobile-stack' : ''}`}>
                <button
                  type="button"
                  className={`work-day-status-button${isMobile ? ' work-schedule-mobile-block centered-mobile-vehicle is-static-mobile-vehicle' : ''}`}
                  onClick={isMobile ? undefined : () => openStatusEditor(day)}
                  disabled={!isMobile && readOnly}
                >
                <span className="work-day-status-vehicle">가용차량수 {String(day.available_vehicle_count ?? 0).padStart(2, '0')}</span>
                <span className="work-day-status-divider" />
                <span className="work-day-status-summary">A: {String(day.status_a_count ?? 0).padStart(2, '0')} / B: {String(day.status_b_count ?? 0).padStart(2, '0')} / C: {String(day.status_c_count ?? 0).padStart(2, '0')}</span>
              </button>

              <section className={`work-schedule-section${isMobile ? ' work-schedule-mobile-block' : ''}`}>
                <div className="between work-schedule-section-head">
                  <div className="work-schedule-section-title-wrap">
                    <strong className="work-schedule-section-title">스케줄 목록</strong>
                  </div>
                  {!readOnly && (
                    <div className="inline-actions wrap">
                      {isBulkEdit && <button type="button" className="small ghost danger-outline top-delete-button" onClick={() => applyBulkDelete(day.date).catch(err => window.alert(err.message))}>삭제</button>}
                      <button type="button" className="small ghost" onClick={() => {
                        if (isBulkEdit) {
                          submitBulkEdit(day.date).catch(err => window.alert(err.message))
                          return
                        }
                        openBulkEdit(day)
                      }}>{isBulkEdit ? '저장' : '수정'}</button>
                    </div>
                  )}
                </div>

            {activeFormDate === day.date && !readOnly && (
              <form onSubmit={submitEntry} className="work-schedule-entry-form">
                <div className="work-schedule-table header">
                  <div>시간</div><div>고객명</div><div>담당대표명1/2/3</div><div>직원명1/2/3</div><div>기타메모</div>
                </div>
                <div className="work-schedule-table work-schedule-assignee-table">
                  {!canEditAssignmentFields && <div className="muted small-text">사업자/직원 편성은 지정 직급만 수정할 수 있습니다.</div>}
                  <input value={entryForm.schedule_time} placeholder="09:00" onChange={e => setEntryForm({ ...entryForm, schedule_time: normalizeScheduleTimeInput(e.target.value, e.target.value) })} />
                  <input value={entryForm.customer_name} placeholder="고객명" onChange={e => setEntryForm({ ...entryForm, customer_name: e.target.value })} />
                  <AssigneeInput inputLike disabled={!canEditAssignmentFields} users={assignableUsers} predicate={businessAssigneePredicate} value={entryForm.representative_names} onChange={value => setEntryForm({ ...entryForm, representative_names: value })} placeholder="@ 입력 후 사업자 선택" />
                  <AssigneeInput inputLike disabled={!canEditAssignmentFields} users={assignableUsers} predicate={staffAssigneePredicate} value={entryForm.staff_names} onChange={value => setEntryForm({ ...entryForm, staff_names: value })} placeholder="@ 입력 후 직원 선택" />
                  <input value={entryForm.memo} placeholder="기타 메모" onChange={e => setEntryForm({ ...entryForm, memo: e.target.value })} />
                </div>
                <div className="inline-actions wrap">
                  <button>저장</button>
                </div>
              </form>
            )}

            <div className="work-schedule-list unified-list">
              {isMobile && day.entries.length > 0 && !isBulkEdit && (
                <div className="work-schedule-mobile-five-col header">
                  <span className="work-schedule-mobile-cell time">시간</span>
                  <span className="work-schedule-mobile-cell customer">고객명</span>
                  <span className="work-schedule-mobile-cell business">사업자</span>
                  <span className="work-schedule-mobile-cell staff">직원</span>
                  <span className="work-schedule-mobile-cell copy">출주소</span>
                </div>
              )}
              {day.entries.length > 0 && !isBulkEdit && day.entries.map(item => {
                const key = rowKey(day.date, item)
                const isEditing = editingKey === key
                const businessNames = [item.representative1, item.representative2, item.representative3]
                  .map(value => String(value || '').trim())
                  .filter(Boolean)
                  .join(' / ') || String(item.representative_names || '').trim() || '-'
                const staffNames = [item.staff1, item.staff2, item.staff3]
                  .map(value => String(value || '').trim())
                  .filter(Boolean)
                  .join(' / ') || String(item.staff_names || '').trim() || '-'
                const addressText = String(item.start_address || item.location || item.origin_address || '-').trim() || '-'
                return (
                  <div key={key} className={`work-schedule-line-item${item.entry_type === 'calendar' ? ' calendar-linked' : ' manual-linked'}${isMobile ? ' mobile-four-col' : ''}`} onClick={() => openScheduleDetailPopup(item)}>
                    <div className="work-schedule-line-head no-row-edit-button">
                      <div className="work-schedule-line-body">
                        {isMobile ? (
                          <div className="work-schedule-mobile-five-col" title={`${item.schedule_time || '미정'} ${item.customer_name || '고객명'} ${businessNames} ${staffNames}`}>
                            <span className="work-schedule-mobile-cell time">{item.schedule_time || '미정'}</span>
                            <span className="work-schedule-mobile-cell customer">{item.customer_name || '고객명'}</span>
                            <span className="work-schedule-mobile-cell business">{highlightTaggedNames(businessNames, currentUser)}</span>
                            <span className="work-schedule-mobile-cell staff">{highlightTaggedNames(staffNames, currentUser)}</span>
                            <button type="button" className="ghost mini-copy-button work-schedule-mobile-copy-button" onClick={e => { e.stopPropagation(); handleCopyAddress('출발지', addressText) }}>복사</button>
                          </div>
                        ) : (
                          <div className="work-schedule-line-summary work-schedule-line-summary-with-copy" title={`${item.schedule_time || '미정'} | ${item.customer_name || '고객명'} | ${item.platform || '플랫폼미정'} | ${businessNames} | ${staffNames} | ${addressText}`}>
                            <span className="work-schedule-line-summary-text primary">{`${item.schedule_time || '미정'} ${item.customer_name || '고객명'} ${item.platform || '플랫폼미정'}`}</span>
                            <span className="work-schedule-line-summary-text business">{highlightTaggedNames(businessNames, currentUser)}</span>
                            <span className="work-schedule-line-summary-text staff">{highlightTaggedNames(staffNames, currentUser)}</span>
                            <button type="button" className="ghost mini-copy-button work-schedule-copy-button" onClick={e => { e.stopPropagation(); handleCopyAddress('출발지', addressText) }}>복사</button>
                          </div>
                        )}
                      </div>
                    </div>
                    {!isMobile && isEditing && !readOnly && (
                      <form onSubmit={submitRowEdit} className="work-schedule-inline-editor" onClick={e => e.stopPropagation()}>
                        <div className="work-schedule-inline-grid work-schedule-assignee-grid one-line">
                          <input value={editingForm.schedule_time} placeholder="시간" onChange={e => setEditingForm({ ...editingForm, schedule_time: normalizeScheduleTimeInput(e.target.value, e.target.value) })} />
                          <input value={editingForm.customer_name} placeholder="고객명" onChange={e => setEditingForm({ ...editingForm, customer_name: e.target.value })} />
                          <AssigneeInput inputLike disabled={!canEditAssignmentFields} users={assignableUsers} predicate={businessAssigneePredicate} value={editingForm.representative_names} onChange={value => setEditingForm({ ...editingForm, representative_names: value })} placeholder="@ 입력 후 사업자 선택" />
                          <AssigneeInput inputLike disabled={!canEditAssignmentFields} users={assignableUsers} predicate={staffAssigneePredicate} value={editingForm.staff_names} onChange={value => setEditingForm({ ...editingForm, staff_names: value })} placeholder="@ 입력 후 직원 선택" />
                          <input value={editingForm.memo} placeholder="메모" onChange={e => setEditingForm({ ...editingForm, memo: e.target.value })} className="schedule-inline-memo" />
                        </div>
                        <div className="inline-actions wrap end schedule-edit-actions">
                          <button type="submit">저장</button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}

              {day.entries.length > 0 && isBulkEdit && (
                <form onSubmit={e => { e.preventDefault(); submitBulkEdit(day.date) }} className="work-schedule-bulk-editor" onClick={e => e.stopPropagation()}>
                  <div className="work-schedule-table header compact-single-line with-check-column">
                    <div><input type="checkbox" checked={isBulkDeleteAllChecked(day.date)} onChange={e => toggleBulkDeleteAll(day.date, e.target.checked)} aria-label="전체선택" /></div><div>시간</div><div>고객명</div><div>사업자</div><div>직원</div><div>주소</div>
                  </div>
                  {dayBulkForms.map((form, index) => (
                    <div key={`${day.date}-bulk-${form.id}-${index}`} className="work-schedule-inline-editor bulk-row compact-one-line-row">
                      <div className="work-schedule-bulk-row-shell with-check-column">
                        <label className="schedule-row-check-cell">
                          <input type="checkbox" checked={isBulkDeleteChecked(day.date, index)} onChange={e => toggleBulkDeleteCheck(day.date, index, e.target.checked)} aria-label={`${form.schedule_time || '미정'} ${form.customer_name || '고객'} 일정 선택`} />
                        </label>
                        <div className="work-schedule-inline-grid work-schedule-assignee-grid one-line compact-single-line with-check-column">
                          <input className="schedule-bulk-time-input" value={form.schedule_time} placeholder="시간" readOnly disabled onChange={e => updateBulkForm(day.date, index, 'schedule_time', normalizeScheduleTimeInput(e.target.value, e.target.value))} />
                          <input className="schedule-bulk-customer-input" value={form.customer_name} placeholder="고객명" readOnly disabled onChange={e => updateBulkForm(day.date, index, 'customer_name', e.target.value)} />
                          <AssigneeInput inputLike inputClassName="schedule-bulk-assignee-input" disabled={!canEditAssignmentFields} users={assignableUsers} predicate={businessAssigneePredicate} value={form.representative_names} onChange={value => updateBulkForm(day.date, index, 'representative_names', value)} placeholder="@ 입력 후 사업자 선택" />
                          <AssigneeInput inputLike inputClassName="schedule-bulk-assignee-input" disabled={!canEditAssignmentFields} users={assignableUsers} predicate={staffAssigneePredicate} value={form.staff_names} onChange={value => updateBulkForm(day.date, index, 'staff_names', value)} placeholder="@ 입력 후 직원 선택" />
                          <input value={form.address_text || form.memo} placeholder="주소" readOnly disabled className="schedule-inline-memo schedule-inline-address schedule-bulk-address-input" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="inline-actions wrap end schedule-edit-actions" />
                </form>
              )}

              {day.entries.length === 0 && <div className="muted">등록된 스케줄이 없습니다.</div>}
            </div>
              </section>

              {activeStatusDate === day.date && !readOnly && (
                <form onSubmit={submitStatusEditor} className="work-day-status-editor">
                  <div className="between work-day-status-editor-head">
                    <button type="button" className="ghost small" onClick={() => setActiveStatusDate('')}>뒤로가기</button>
                    <button type="submit" className="small">저장</button>
                  </div>
                  <div className="work-day-status-editor-grid">
                    <label>가용차량수(자동연동)<input type="number" min="0" value={statusForm.available_vehicle_count} readOnly disabled /></label>
                    <label>A : 숫자입력칸<input type="number" min="0" value={statusForm.status_a_count} onChange={e => setStatusForm({ ...statusForm, status_a_count: Number(e.target.value || 0) })} /></label>
                    <label>B : 숫자입력칸<input type="number" min="0" value={statusForm.status_b_count} onChange={e => setStatusForm({ ...statusForm, status_b_count: Number(e.target.value || 0) })} /></label>
                    <label>C : 숫자입력칸<input type="number" min="0" value={statusForm.status_c_count} onChange={e => setStatusForm({ ...statusForm, status_c_count: Number(e.target.value || 0) })} /></label>
                  </div>
                  <textarea value={statusForm.day_memo} onChange={e => setStatusForm({ ...statusForm, day_memo: e.target.value })} placeholder="상세 메모 입력" className="work-day-status-editor-memo" />
                </form>
              )}
            </div>

            <section className={`work-schedule-section work-exclusion-section${isMobile ? ' work-schedule-mobile-block' : ''}`}>
              <div className="between work-schedule-section-head">
                <div className="work-schedule-section-title-wrap">
                  <strong className="work-schedule-section-title">열외자 목록</strong>
                </div>
                {!readOnly && activeNoteDate === day.date && (
                  <div className="inline-actions wrap work-excluded-edit-actions">
                    <button type="button" className="small ghost" onClick={applyNoteDeleteSelection}>삭제</button>
                    <button type="button" className="small ghost" onClick={addExcludedBusinessRow}>추가</button>
                  </div>
                )}
                {!readOnly && <button type="button" className="small ghost" onClick={() => activeNoteDate === day.date ? closeNotes() : openNotes(day)}>{activeNoteDate === day.date ? '편집닫기' : '열외자편집'}</button>}
              </div>

            {activeNoteDate === day.date && !readOnly && (
              <form onSubmit={submitNotes} className="work-notes-form">
                <div className="stack compact-gap">
                  <label>열외자 목록 - 사업자</label>
                  <div className="work-excluded-business-grid with-reason">
                    {Array.from({ length: businessSlotCount }, (_, index) => noteForm.excluded_business_slots[index] || '').map((slot, index) => (
                      <div key={`${day.date}-business-${index}`} className={`work-excluded-business-row ${noteDeleteMode ? 'delete-mode' : ''}`.trim()}>
                        {noteDeleteMode && (
                          <label className="checkbox-line work-excluded-checkbox">
                            <input type="checkbox" checked={noteDeleteChecks.includes(index)} onChange={() => toggleNoteDeleteCheck(index)} />
                          </label>
                        )}
                        <select value={slot} onChange={e => {
                          const nextValue = e.target.value
                          if (nextValue && noteForm.excluded_business_slots.some((selected, slotIndex) => slotIndex !== index && selected === nextValue)) {
                            window.alert('중첩된 선택입니다. 다른 사업자를 입력하세요')
                            return
                          }
                          const next = [...noteForm.excluded_business_slots]
                          next[index] = nextValue
                          setNoteForm({ ...noteForm, excluded_business_slots: next })
                        }}>
                          <option value="">선택 안 함</option>
                          {businessExclusionOptions.map(option => (
                            <option key={option.value} value={option.value} disabled={noteForm.excluded_business_slots.some((selected, slotIndex) => slotIndex !== index && selected === option.value)}>{option.label}</option>
                          ))}
                        </select>
                        <input value={noteForm.excluded_business_reasons?.[index] || ''} placeholder="열외 사유" onChange={e => {
                          const nextReasons = [...(noteForm.excluded_business_reasons || Array(businessSlotCount).fill(''))]
                          nextReasons[index] = e.target.value
                          setNoteForm({ ...noteForm, excluded_business_reasons: nextReasons })
                        }} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="stack compact-gap">
                  <label>열외자 목록 - 직원</label>
                  <textarea value={noteForm.excluded_staff} placeholder="직원명-사유 / 직원명-사유" onChange={e => setNoteForm({ ...noteForm, excluded_staff: e.target.value })} />
                </div>
                <div className="inline-actions wrap">
                  <button>열외자 저장</button>
                  <button type="button" className="ghost" onClick={applyNoteDeleteSelection}>삭제</button>
                  <button type="button" className="ghost" onClick={addExcludedBusinessRow}>추가</button>
                  <button type="button" className="ghost" onClick={closeNotes}>닫기</button>
                </div>
              </form>
            )}

            <div className="work-schedule-exclusion">
              <div className="work-schedule-exclusion-row"><strong>사업자</strong><span>{businessCount ? day.excluded_business_names.join(' / ') : '-'}</span></div>
              <div className="work-schedule-exclusion-row"><strong>직원</strong><span>{staffCount ? day.excluded_staff_names.join(' / ') : '-'}</span></div>
            </div>
            </section>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function normalizeScheduleTimeInput(rawValue, fallback = '') {
  if (rawValue === '미정') return '미정'
  const value = String(rawValue || '').trim()
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length === 4) {
    const hours = Number(digits.slice(0, 2))
    const minutes = Number(digits.slice(2, 4))
    if (hours >= 0 && hours <= 24 && minutes >= 0 && minutes <= 59 && !(hours === 24 && minutes > 0)) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    }
  }
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (match) {
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours >= 0 && hours <= 24 && minutes >= 0 && minutes <= 59 && !(hours === 24 && minutes > 0)) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    }
  }
  return fallback || value
}

function ScheduleFormPage({ mode }) {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const canEditAssignmentFields = canEditScheduleAssignments(currentUser)
  const { eventId } = useParams()
  const [searchParams] = useSearchParams()
  const presetDate = searchParams.get('date') || fmtDate(new Date())
  const [loading, setLoading] = useState(mode === 'edit')
  const [error, setError] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [preview, setPreview] = useState('')
  const visitTimeInputRef = useRef(null)
  const mobilePlatformSelectRef = useRef(null)
  const desktopPlatformSelectRef = useRef(null)
  const customerNameInputRef = useRef(null)
  const amountInputRef = useRef(null)
  const depositMethodSelectRef = useRef(null)
  const depositAmountSelectRef = useRef(null)
  const scheduleEditorFormRef = useRef(null)
  const [titleLocked, setTitleLocked] = useState(true)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [departmentColorConfigOpen, setDepartmentColorConfigOpen] = useState(false)
  const [departmentOptions, setDepartmentOptions] = useState(() => getStoredDepartmentOptions())
  const [departmentColorMap, setDepartmentColorMap] = useState(() => getStoredDepartmentColorMap())
  const [editingDepartmentOption, setEditingDepartmentOption] = useState('')
  const [departmentDeleteChecks, setDepartmentDeleteChecks] = useState([])
  const settingsMenuRef = useRef(null)

  function handleScheduleEditorKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
      e.preventDefault()
      scheduleEditorFormRef.current?.requestSubmit?.()
    }
  }
  const [visitTimeText, setVisitTimeText] = useState('')
  const [startTimeText, setStartTimeText] = useState('')
  const [endTimeText, setEndTimeText] = useState('')
  const [endDateStartTimeText, setEndDateStartTimeText] = useState('')
  const [endDateEndTimeText, setEndDateEndTimeText] = useState('')
  const [assignableUsers, setAssignableUsers] = useState([])
  const memoTextareaRef = useRef(null)
  const [startDateText, setStartDateText] = useState(() => formatShortDateForInput(presetDate))
  const [endDateText, setEndDateText] = useState(() => formatShortDateForInput(presetDate))
  const [form, setForm] = useState({
    title: '',
    content: '',
    event_date: presetDate,
    visit_time: '미정',
    start_time: '미정',
    end_time: '미정',
    location: '',
    color: '#2563eb',
    move_start_date: presetDate,
    move_end_date: presetDate,
    move_end_start_time: '미정',
    move_end_end_time: '미정',
    start_address: '',
    end_address: '',
    platform: PLATFORM_OPTIONS[0],
    customer_name: '',
    department_info: '당일이사 2인 업무',
    schedule_type: '선택',
    status_a_count: 0,
    status_b_count: 0,
    status_c_count: 0,
    amount1: '',
    amount2: '',
    amount_item: '',
    deposit_method: DEPOSIT_METHOD_OPTIONS[0],
    deposit_amount: DEPOSIT_AMOUNT_OPTIONS[0],
    representative1: '',
    representative2: '',
    representative3: '',
    staff1: '',
    staff2: '',
    staff3: '',
    image_data: '',
    deposit_datetime: '',
    reservation_name: '',
    reservation_phone: '',
  })

  useEffect(() => {
    if (mode !== 'edit') {
      setForm(prev => ({
        ...prev,
        event_date: presetDate,
        move_start_date: prev.move_start_date || presetDate,
        move_end_date: prev.move_end_date || presetDate,
        department_info: prev.department_info || '당일이사 2인 업무',
        color: departmentColorMap[prev.department_info || '당일이사 2인 업무'] || prev.color,
      }))
      setStartDateText(formatShortDateForInput(presetDate))
      setEndDateText(formatShortDateForInput(presetDate))
      setVisitTimeText(prev => prev || '')
      api('/api/users').then(users => setAssignableUsers(users || [])).catch(() => {})
      return
    }
    async function loadDetail() {
      setLoading(true)
      setError('')
      try {
        const [data, users] = await Promise.all([
          api(`/api/calendar/events/${eventId}`),
          api('/api/users'),
        ])
        const me = getStoredUser(); setAssignableUsers(me ? [me, ...(users || [])] : (users || []))
        setForm({
          title: data.title || '',
          content: data.content || '',
          event_date: data.event_date || presetDate,
          visit_time: data.visit_time || '미정',
          start_time: data.start_time || '미정',
          end_time: data.end_time || '미정',
          location: data.location || '',
          color: data.color || '#2563eb',
          move_start_date: toIsoDateInputValue(data.move_start_date || data.event_date || presetDate) || presetDate,
          move_end_date: toIsoDateInputValue(data.move_end_date || data.event_date || presetDate) || presetDate,
          move_end_start_time: data.move_end_start_time || '미정',
          move_end_end_time: data.move_end_end_time || '미정',
          start_address: data.start_address || data.location || '',
          end_address: data.end_address || '',
          platform: data.platform || PLATFORM_OPTIONS[0],
          customer_name: data.customer_name || '',
          department_info: data.department_info || '당일이사 2인 업무',
          schedule_type: data.schedule_type || (Number(data.status_b_count || 0) > 0 ? 'B' : Number(data.status_c_count || 0) > 0 ? 'C' : Number(data.status_a_count || 0) > 0 ? 'A' : '선택'),
          status_a_count: Number(data.status_a_count || 0),
          status_b_count: Number(data.status_b_count || 0),
          status_c_count: Number(data.status_c_count || 0),
          amount1: data.amount1 || '',
          amount2: data.amount2 || '',
          amount_item: data.amount_item || '',
          deposit_method: data.deposit_method || DEPOSIT_METHOD_OPTIONS[0],
          deposit_amount: data.deposit_amount || DEPOSIT_AMOUNT_OPTIONS[0],
          representative1: data.representative1 || '',
          representative2: data.representative2 || '',
          representative3: data.representative3 || '',
          staff1: data.staff1 || '',
          staff2: data.staff2 || '',
          staff3: data.staff3 || '',
          image_data: data.image_data || '',
          deposit_datetime: data.deposit_datetime || '',
          reservation_name: data.reservation_name || '',
          reservation_phone: data.reservation_phone || '',
        })
        setPreview(data.image_data || '')
        setVisitTimeText(data.visit_time && data.visit_time !== '미정' ? data.visit_time : '')
        setStartTimeText(data.start_time && data.start_time !== '미정' ? data.start_time : '')
        setEndTimeText(data.end_time && data.end_time !== '미정' ? data.end_time : '')
        setEndDateStartTimeText(data.move_end_start_time && data.move_end_start_time !== '미정' ? data.move_end_start_time : '')
        setEndDateEndTimeText(data.move_end_end_time && data.move_end_end_time !== '미정' ? data.move_end_end_time : '')
        setStartDateText(formatShortDateForInput(data.move_start_date || data.event_date || presetDate))
        setEndDateText(formatShortDateForInput(data.move_end_date || data.event_date || presetDate))
        setTitleLocked(!(data.title || '').trim() || (data.title || '').trim() === buildScheduleTitle({ ...data, amount1: data.amount1 || '' }).trim())
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [mode, eventId, presetDate])

  useEffect(() => {
    if (!titleLocked) return
    setForm(prev => ({ ...prev, title: buildScheduleTitle(prev) }))
  }, [form.visit_time, form.platform, form.customer_name, form.amount1, titleLocked])

  useEffect(() => {
    const mappedColor = departmentColorMap[form.department_info]
    if (!mappedColor || mappedColor === form.color) return
    setForm(prev => ({ ...prev, color: departmentColorMap[prev.department_info] || prev.color }))
  }, [form.department_info, departmentColorMap])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('icj_department_options', JSON.stringify(departmentOptions))
  }, [departmentOptions])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('icj_department_color_map', JSON.stringify(departmentColorMap))
  }, [departmentColorMap])

  useEffect(() => {
    if (!form.department_info) return
    if (departmentOptions.includes(form.department_info)) return
    setDepartmentOptions(prev => [form.department_info, ...prev])
  }, [form.department_info, departmentOptions])

  useEffect(() => {
    if (form.visit_time === '미정') {
      setVisitTimeText('')
      return
    }
    setVisitTimeText(form.visit_time || '')
  }, [form.visit_time])

  useEffect(() => {
    if (form.start_time === '미정') {
      setStartTimeText('')
      return
    }
    setStartTimeText(form.start_time || '')
  }, [form.start_time])

  useEffect(() => {
    if (loading) return
    requestAnimationFrame(() => {
      visitTimeInputRef.current?.focus()
      visitTimeInputRef.current?.select?.()
    })
  }, [loading, mode, eventId, presetDate])

  useEffect(() => {
    if (form.end_time === '미정') {
      setEndTimeText('')
      return
    }
    setEndTimeText(form.end_time || '')
  }, [form.end_time])

  useEffect(() => {
    if (form.move_end_start_time === '미정') {
      setEndDateStartTimeText('')
      return
    }
    setEndDateStartTimeText(form.move_end_start_time || '')
  }, [form.move_end_start_time])

  useEffect(() => {
    if (form.move_end_end_time === '미정') {
      setEndDateEndTimeText('')
      return
    }
    setEndDateEndTimeText(form.move_end_end_time || '')
  }, [form.move_end_end_time])

  useEffect(() => {
    setStartDateText(formatShortDateForInput(form.move_start_date || presetDate))
  }, [form.move_start_date, presetDate])

  useEffect(() => {
    setEndDateText(formatShortDateForInput(form.move_end_date || form.move_start_date || presetDate))
  }, [form.move_end_date, form.move_start_date, presetDate])

  useEffect(() => {
    const el = memoTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 156)}px`
  }, [form.content])

  function commitDateField(field, rawValue, fallbackValue) {
    const normalized = normalizeScheduleDateInput(rawValue, fallbackValue)
    const baseValue = normalized || toIsoDateInputValue(fallbackValue) || presetDate
    const safeValue = field === 'move_end_date' && form.move_start_date && baseValue < form.move_start_date ? form.move_start_date : baseValue
    setForm(prev => {
      const next = { ...prev, [field]: safeValue }
      if (field === 'move_start_date') {
        next.event_date = safeValue
        if (!prev.move_end_date || prev.move_end_date < safeValue) next.move_end_date = safeValue
      }
      return next
    })
    if (field === 'move_start_date') {
      setStartDateText(formatShortDateForInput(safeValue))
      if (!form.move_end_date || form.move_end_date < safeValue) setEndDateText(formatShortDateForInput(safeValue))
    }
    if (field === 'move_end_date') {
      setEndDateText(formatShortDateForInput(safeValue))
    }
    return safeValue
  }

  function getSyncedScheduleTimePatch(field, value) {
    if (field === 'visit_time' || field === 'start_time') {
      return {
        visit_time: value,
        start_time: value,
      }
    }
    return { [field]: value }
  }

  function commitVisitTimeInput(rawValue) {
    const normalized = normalizeScheduleTimeInput(rawValue, form.visit_time === '미정' ? '' : form.visit_time)
    if (normalized === '미정') {
      setForm(prev => ({ ...prev, ...getSyncedScheduleTimePatch('visit_time', '미정') }))
      setVisitTimeText('')
      setStartTimeText('')
      return normalized
    }
    if (!normalized) {
      setForm(prev => ({ ...prev, ...getSyncedScheduleTimePatch('visit_time', '미정') }))
      setVisitTimeText('')
      setStartTimeText('')
      return ''
    }
    setForm(prev => ({ ...prev, ...getSyncedScheduleTimePatch('visit_time', normalized) }))
    setVisitTimeText(normalized)
    setStartTimeText(normalized)
    return normalized
  }


  function commitGenericTimeInput(field, rawValue, currentValue, setText) {
    const normalized = normalizeScheduleTimeInput(rawValue, currentValue === '미정' ? '' : currentValue)
    const syncedFields = getSyncedScheduleTimePatch(field, normalized || '미정')
    if (normalized === '미정') {
      setForm(prev => ({ ...prev, ...syncedFields }))
      setText('')
      if (field === 'start_time') {
        setVisitTimeText('')
      }
      return normalized
    }
    if (!normalized) {
      setForm(prev => ({ ...prev, ...syncedFields }))
      setText('')
      if (field === 'start_time') {
        setVisitTimeText('')
      }
      return ''
    }
    setForm(prev => ({ ...prev, ...syncedFields }))
    setText(normalized)
    if (field === 'start_time') {
      setVisitTimeText(normalized)
    }
    return normalized
  }

  function focusNextField(ref) {
    requestAnimationFrame(() => ref?.current?.focus())
  }

  function handleVisitTimeKeyDown(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      const normalized = commitVisitTimeInput(visitTimeText)
      if (normalized) {
        e.preventDefault()
        focusNextField(desktopPlatformSelectRef)
      }
    }
  }

  function handleVisitTimeBlur() {
    commitVisitTimeInput(visitTimeText)
  }


  function handleStartTimeBlur() {
    commitGenericTimeInput('start_time', startTimeText, form.start_time, setStartTimeText)
  }

  function handleEndTimeBlur() {
    commitGenericTimeInput('end_time', endTimeText, form.end_time, setEndTimeText)
  }

  function handleEndDateStartTimeBlur() {
    commitGenericTimeInput('move_end_start_time', endDateStartTimeText, form.move_end_start_time, setEndDateStartTimeText)
  }

  function handleEndDateEndTimeBlur() {
    commitGenericTimeInput('move_end_end_time', endDateEndTimeText, form.move_end_end_time, setEndDateEndTimeText)
  }

  function handleStartAddressChange(rawValue) {
    const nextValue = String(rawValue || '')
    const parsed = parseScheduleAddressBundle(nextValue)
    setForm(prev => {
      const next = {
        ...prev,
        start_address: nextValue,
        location: nextValue,
      }
      if (parsed?.startAddress) {
        next.start_address = parsed.startAddress
        next.location = parsed.startAddress
      }
      if (parsed?.endAddress) next.end_address = parsed.endAddress
      if (parsed?.reservationName) next.reservation_name = parsed.reservationName
      if (parsed?.reservationPhone) next.reservation_phone = parsed.reservationPhone
      return next
    })
  }

  async function handleImageChange(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) {
      setPreview('')
      setForm(prev => ({ ...prev, image_data: '' }))
      return
    }
    setUploadingImage(true)
    setError('')
    try {
      const uploadedUrls = []
      for (const file of files) {
        const uploaded = await uploadFile(file, 'schedule')
        if (uploaded?.url) uploadedUrls.push(uploaded.url)
      }
      const merged = [...eventImageList(form.image_data), ...uploadedUrls].join('\n')
      setPreview(merged)
      setForm(prev => ({ ...prev, image_data: merged }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingImage(false)
      e.target.value = ''
    }
  }

  function changeTimeField(field, value) {
    const normalized = normalizeScheduleTimeInput(value, value)
    setForm(prev => ({ ...prev, ...getSyncedScheduleTimePatch(field, normalized) }))
    if (field === 'visit_time' || field === 'start_time') {
      const nextText = normalized === '미정' ? '' : normalized
      setVisitTimeText(nextText)
      setStartTimeText(nextText)
    }
    if (field === 'move_end_start_time') {
      setEndDateStartTimeText(normalized === '미정' ? '' : normalized)
    }
    if (field === 'move_end_end_time') {
      setEndDateEndTimeText(normalized === '미정' ? '' : normalized)
    }
    if (field === 'end_time') {
      setEndTimeText(normalized === '미정' ? '' : normalized)
    }
  }

  function updateRepresentativeNames(value) {
    const [first, second, third] = splitScheduleNames(value)
    setForm(prev => ({ ...prev, representative1: first || '', representative2: second || '', representative3: third || '' }))
  }

  function updateStaffNames(value) {
    const [first, second, third] = splitScheduleNames(value)
    setForm(prev => ({ ...prev, staff1: first || '', staff2: second || '', staff3: third || '' }))
  }

  function toggleDepartmentDeleteCheck(option) {
    setDepartmentDeleteChecks(prev => prev.includes(option) ? prev.filter(item => item !== option) : [...prev, option])
  }

  async function handleDeleteDepartmentOptions() {
    const targets = departmentDeleteChecks.filter(option => option && option !== '미정')
    if (!targets.length) {
      window.alert('삭제할 항목을 선택해 주세요.')
      return
    }
    const confirmed = window.confirm(`선택한 ${targets.length}개 항목을 삭제하시겠습니까?\n기존 일정에 반영된 항목은 '미정'으로 변경됩니다.`)
    if (!confirmed) return
    try {
      await api('/api/calendar/events/department-replace', { method: 'POST', body: JSON.stringify({ from_values: targets, to_value: '미정', to_color: '#000000' }) })
      setDepartmentOptions(prev => {
        const filtered = prev.filter(option => !targets.includes(option))
        return filtered.includes('미정') ? filtered : ['미정', ...filtered]
      })
      setDepartmentColorMap(prev => {
        const next = { ...prev, ['미정']: '#000000' }
        targets.forEach(option => { delete next[option] })
        return next
      })
      setForm(prev => targets.includes(prev.department_info) ? { ...prev, department_info: '미정', color: '#000000' } : prev)
      setDepartmentDeleteChecks([])
      setEditingDepartmentOption('')
      window.alert('선택한 부서/인원 항목을 삭제했습니다.')
    } catch (err) {
      window.alert(err.message || '부서/인원 항목 삭제에 실패했습니다.')
    }
  }

  function handleAddDepartmentOption() {
    const baseLabel = '새 항목'
    let candidate = baseLabel
    let index = 2
    while (departmentOptions.includes(candidate)) {
      candidate = `${baseLabel} ${index}`
      index += 1
    }
    setDepartmentOptions(prev => [candidate, ...prev])
    setDepartmentColorMap(prev => ({ ...prev, [candidate]: prev[candidate] || '#2563eb' }))
    setEditingDepartmentOption(candidate)
  }

  function renameDepartmentOption(previousName, nextNameRaw) {
    const previous = String(previousName || '').trim()
    const nextName = String(nextNameRaw || '').trim()
    if (!previous) {
      setEditingDepartmentOption('')
      return
    }
    if (!nextName || previous === nextName) {
      setEditingDepartmentOption('')
      return
    }
    if (departmentOptions.includes(nextName)) {
      setEditingDepartmentOption('')
      return
    }
    setDepartmentOptions(prev => prev.map(option => (option === previous ? nextName : option)))
    setDepartmentColorMap(prev => {
      const updated = { ...prev }
      updated[nextName] = prev[previous] || '#2563eb'
      delete updated[previous]
      return updated
    })
    setForm(prev => ({
      ...prev,
      department_info: prev.department_info === previous ? nextName : prev.department_info,
      color: prev.department_info === previous ? (departmentColorMap[previous] || prev.color) : prev.color,
    }))
    setEditingDepartmentOption('')
  }

  async function handleDeleteCurrentSchedule() {
    if (mode !== 'edit' || !eventId) return
    const confirmed = window.confirm('현재 일정을 삭제하시겠습니까?')
    if (!confirmed) return
    try {
      await api(`/api/calendar/events/${eventId}`, { method: 'DELETE' })
      navigate('/schedule')
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    const normalizedScheduleType = String(form.schedule_type || '선택')
    const normalizedScheduleGroup = normalizedScheduleType.replace(/[()]/g, '')
    const normalizedMoveStartDate = normalizeScheduleDateInput(startDateText, form.move_start_date || presetDate)
    const normalizedMoveEndDate = normalizeScheduleDateInput(endDateText, form.move_end_date || form.move_start_date || presetDate)
    const normalizedStartTime = normalizeScheduleTimeInput(startTimeText, form.start_time || '미정') || form.start_time || '미정'
    const normalizedEndTime = normalizeScheduleTimeInput(endTimeText, form.end_time || '미정') || form.end_time || '미정'
    const normalizedEndStartTime = normalizeScheduleTimeInput(endDateStartTimeText, form.move_end_start_time || '미정') || form.move_end_start_time || '미정'
    const normalizedEndEndTime = normalizeScheduleTimeInput(endDateEndTimeText, form.move_end_end_time || '미정') || form.move_end_end_time || '미정'
    const isStorageSchedule = ['짐보관이사 2인 업무', '짐보관이사 3인 이상업무'].includes(String(form.department_info || '').trim())
    if (isStorageSchedule) {
      if (!normalizedMoveStartDate || !normalizedMoveEndDate) {
        setError('짐보관 일정은 시작일과 종료일을 모두 선택해야 합니다.')
        return
      }
      if (!normalizedStartTime) {
        setError('짐보관 일정은 시작시각을 입력하거나 미정으로 체크해야 합니다.')
        return
      }
    }
    const payload = {
      ...form,
      schedule_type: normalizedScheduleType,
      status_a_count: normalizedScheduleGroup === 'A' ? 1 : 0,
      status_b_count: normalizedScheduleGroup === 'B' ? 1 : 0,
      status_c_count: normalizedScheduleGroup === 'C' ? 1 : 0,
      title: titleLocked ? buildScheduleTitle(form) : (form.title || buildScheduleTitle(form)),
      event_date: normalizedMoveStartDate || presetDate,
      move_start_date: normalizedMoveStartDate || presetDate,
      move_end_date: normalizedMoveEndDate || normalizedMoveStartDate || presetDate,
      start_time: normalizedStartTime,
      end_time: normalizedEndTime,
      move_end_start_time: normalizedEndStartTime,
      move_end_end_time: normalizedEndEndTime,
      location: form.start_address || '',
      amount2: '',
      amount_item: '',
      reservation_name: form.reservation_name || '',
      reservation_phone: form.reservation_phone || '',
    }
    try {
      if (mode === 'edit') {
        await api(`/api/calendar/events/${eventId}`, { method: 'PUT', body: JSON.stringify(payload) })
        navigate(`/schedule/${eventId}`)
      } else {
        await api('/api/calendar/events', { method: 'POST', body: JSON.stringify(payload) })
        navigate(`/schedule?date=${payload.event_date}`)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const titlePreview = titleLocked ? buildScheduleTitle(form) : (form.title || buildScheduleTitle(form))


  if (loading) return <div className="card">불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card schedule-editor-card">
        <form ref={scheduleEditorFormRef} onSubmit={submit} onKeyDown={handleScheduleEditorKeyDown} className="stack schedule-editor-form">
          <div className="schedule-form-topbar schedule-form-topbar-compact">
            <button
              type="button"
              className="ghost small icon-only"
              aria-label={mode === 'edit' ? '상세로 돌아가기' : '달력으로 돌아가기'}
              onClick={() => navigate(mode === 'edit' ? `/schedule/${eventId}` : '/schedule')}
            >
              ←
            </button>
            <div className="inline-actions end schedule-topbar-actions">
              <button type="button" className="ghost small" onClick={() => window.alert('연동 기능은 준비만 완료된 상태이며, 추후 견적 목록 연동 시 활성화됩니다.')}>연동</button>
              <div className="schedule-settings-anchor" ref={settingsMenuRef}>
                <button type="button" className={settingsMenuOpen ? 'ghost small active-icon' : 'ghost small'} onClick={() => setSettingsMenuOpen(v => !v)}>설정</button>
                {settingsMenuOpen && (
                  <div className="schedule-settings-mini-menu">
                    <button
                      type="button"
                      className="schedule-settings-mini-item"
                      onClick={() => {
                        setSettingsMenuOpen(false)
                        setDepartmentColorConfigOpen(true)
                      }}
                    >
                      부서/인원 색상편집
                    </button>
                  </div>
                )}
              </div>
              <button type="submit" className="small schedule-save-button top-save-button">수정</button>
            </div>
          </div>
          <div className="schedule-form-grid-3 schedule-editor-compact-grid schedule-editor-main-info-row">
            <div className="stack compact-gap schedule-compact-field schedule-type-field">
              <label>일정구분</label>
              <select className="schedule-select-no-arrow" value={form.schedule_type || '선택'} onChange={e => setForm({ ...form, schedule_type: e.target.value })}>
                <option value="선택">일정구분</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="(A)">(A)</option>
                <option value="(B)">(B)</option>
                <option value="(C)">(C)</option>
              </select>
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-title-field">
              <label>일정제목</label>
              <input value={titlePreview} placeholder="일정제목" readOnly={titleLocked} className={`readonly-input ${titleLocked ? '' : 'editable-title-input'}`.trim()} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-title-action-field">
              <label>편집</label>
              <button type="button" className="ghost small schedule-title-toggle-button" onClick={() => {
                if (titleLocked) {
                  setTitleLocked(false)
                  setForm(prev => ({ ...prev, title: prev.title || buildScheduleTitle(prev) }))
                  return
                }
                setTitleLocked(true)
                setForm(prev => ({ ...prev, title: buildScheduleTitle(prev) }))
              }}>{titleLocked ? '편집' : '완료'}</button>
            </div>
          </div>
          {departmentColorConfigOpen && (
            <div className="schedule-settings-modal-backdrop" onClick={() => { setEditingDepartmentOption(''); setDepartmentDeleteChecks([]); setDepartmentColorConfigOpen(false) }}>
              <div className="schedule-settings-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="부서/인원 색상편집">
                <div className="schedule-settings-modal-header schedule-settings-modal-header-editor">
                  <button type="button" className="ghost small icon-only schedule-settings-back-button" aria-label="뒤로가기" onClick={() => { setEditingDepartmentOption(''); setDepartmentDeleteChecks([]); setDepartmentColorConfigOpen(false) }}>←</button>
                  <strong>부서/인원 색상편집</strong>
                  <div className="schedule-settings-modal-header-actions">
                    <button type="button" className="small ghost" onClick={handleDeleteDepartmentOptions}>삭제</button>
                    <button type="button" className="small schedule-settings-add-button" onClick={handleAddDepartmentOption}>추가</button>
                  </div>
                </div>
                <div className="schedule-settings-grid compact-color-grid">
                  {departmentOptions.map(option => (
                    <div key={`dept-color-${option}`} className="schedule-color-edit-row">
                      <label className="check center-check schedule-color-edit-check">
                        <input type="checkbox" checked={departmentDeleteChecks.includes(option)} onChange={() => toggleDepartmentDeleteCheck(option)} disabled={option === '미정'} />
                      </label>
                      {editingDepartmentOption === option ? (
                        <input
                          className="schedule-color-edit-name-input"
                          autoFocus
                          defaultValue={option}
                          maxLength={40}
                          onBlur={e => renameDepartmentOption(option, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              renameDepartmentOption(option, e.currentTarget.value)
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setEditingDepartmentOption('')
                            }
                          }}
                        />
                      ) : (
                        <button type="button" className="schedule-color-edit-label-button" title={option} onClick={() => setEditingDepartmentOption(option)}>
                          <span className="schedule-color-edit-label">{option}</span>
                        </button>
                      )}
                      <input type="color" aria-label={`${option} 색상`} value={departmentColorMap[option] || '#2563eb'} onChange={e => setDepartmentColorMap(prev => ({ ...prev, [option]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="schedule-form-grid-3 schedule-editor-compact-grid schedule-editor-visit-row">
            <div className="stack compact-gap schedule-compact-field">
              <label>방문시각</label>
              <div className="inline-actions visit-time-actions">
                <input
                  ref={visitTimeInputRef}
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="방문시각"
                  value={visitTimeText}
                  onChange={e => setVisitTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleVisitTimeBlur}
                  onKeyDown={handleVisitTimeKeyDown}

                />
                <button type="button" tabIndex={-1} className={form.visit_time === '미정' ? 'ghost small active-icon mobile-visit-undecided' : 'ghost small mobile-visit-undecided'} onClick={() => changeTimeField('visit_time', form.visit_time === '미정' ? '09:00' : '미정')}>미정</button>
              </div>
            </div>
            <div className="stack compact-gap schedule-compact-field platform-select-field">
              <label>플랫폼</label>
              <select
                className="schedule-select-no-arrow"
                aria-label="플랫폼"
                ref={desktopPlatformSelectRef}
                value={form.platform}
                onChange={e => setForm({ ...form, platform: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault()
                    focusNextField(customerNameInputRef)
                  }
                }}
              >
                {PLATFORM_OPTIONS.map(platform => <option key={platform} value={platform}>{platform}</option>)}
              </select>
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-customer-field">
              <label>고객명</label>
              <input ref={customerNameInputRef} value={form.customer_name} placeholder="고객명" onChange={e => setForm({ ...form, customer_name: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(amountInputRef) } }} />
            </div>
          </div>
          <div className="schedule-form-grid-3 schedule-editor-compact-grid schedule-editor-amount-row">
            <div className="stack compact-gap schedule-compact-field schedule-amount-field">
              <label>이사금액</label>
              <input ref={amountInputRef} inputMode="numeric" value={form.amount1} placeholder="이사금액" onChange={e => setForm({ ...form, amount1: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(depositMethodSelectRef) } }} />
            </div>
            <div className="stack compact-gap schedule-compact-field">
              <label>계약방법</label>
              <select className="schedule-select-no-arrow" ref={depositMethodSelectRef} aria-label="계약방법" value={form.deposit_method} onChange={e => setForm({ ...form, deposit_method: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(depositAmountSelectRef) } }}>
                {DEPOSIT_METHOD_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-deposit-amount-field">
              <label>계약금액</label>
              <select className="schedule-select-no-arrow" ref={depositAmountSelectRef} aria-label="계약금액" value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: e.target.value })}>
                {DEPOSIT_AMOUNT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>
          <div className="schedule-form-grid-2 schedule-editor-compact-grid schedule-media-row">
            <div className="stack compact-gap schedule-compact-field schedule-photo-field">
              <label>사진첨부</label>
              <div className="schedule-upload-row compact-upload-row compact-schedule-upload-row">
                <label className={`icon-upload-trigger compact-upload-trigger${uploadingImage ? ' disabled' : ''}`}>
                  <input type="file" accept="image/*" multiple onChange={handleImageChange} disabled={uploadingImage} className="visually-hidden" />
                  <span className="icon-upload-symbol" aria-hidden="true">📎</span>
                  <span className="sr-only">사진첨부</span>
                </label>
                {uploadingImage && <div className="muted upload-status-text">업로드 중...</div>}
                {preview && (
                  <div className="image-preview-wrap compact-image-preview schedule-upload-preview-grid">
                    {eventImageList(preview).slice(0, 4).map((src, index) => (
                      <img key={`${src}-${index}`} src={src} alt={`일정 첨부 미리보기 ${index + 1}`} className="image-preview schedule-upload-preview-image" />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-department-field">
              <label>부서/인원</label>
              <select className="schedule-color-select" aria-label="부서/인원" value={form.department_info} style={{ backgroundColor: departmentColorMap[form.department_info] || form.color || '#2563eb', color: getDepartmentOptionTextColor(form.department_info, departmentColorMap[form.department_info] || form.color || '#2563eb'), border: '1px solid #111111' }} onChange={e => setForm(prev => ({ ...prev, department_info: e.target.value, color: departmentColorMap[e.target.value] || prev.color }))}>
                {departmentOptions.map(option => {
                  const optionColor = departmentColorMap[option] || '#2563eb'
                  return <option key={option} value={option} style={getDepartmentOptionStyle(option, optionColor)}>{option}</option>
                })}
              </select>
            </div>
          </div>
          <div className="stack compact-gap schedule-compact-field schedule-memo-field">
            <label>메모</label>
            <textarea ref={memoTextareaRef} value={form.content} placeholder="메모" onChange={e => setForm({ ...form, content: e.target.value })} className="schedule-memo-box auto-grow" rows={6} />
          </div>
          <div className="schedule-form-grid-4 schedule-editor-compact-grid schedule-date-time-compact-row schedule-date-time-short-row">
            <div className="stack compact-gap schedule-compact-field schedule-date-badge-field">
              <label>구분</label>
              <input type="text" value="시" readOnly className="schedule-date-badge-input" aria-label="시작일 구분" />
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-date-field schedule-date-short-field">
              <label>시작일</label>
              <input type="text" inputMode="numeric" aria-label="시작일" placeholder="26-04-13" value={startDateText} onChange={e => setStartDateText(e.target.value.replace(/[^\d-]/g, '').slice(0, 8))} onBlur={() => commitDateField('move_start_date', startDateText, form.move_start_date || presetDate)} />
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-time-field">
              <label>시작시각</label>
              <div className="inline-actions schedule-time-actions">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="시작시각"
                  value={startTimeText}
                  onChange={e => setStartTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleStartTimeBlur}
                />
                <button type="button" className={form.start_time === '미정' ? 'ghost small active-icon mobile-visit-undecided mobile-time-undecided' : 'ghost small mobile-visit-undecided mobile-time-undecided'} onClick={() => changeTimeField('start_time', form.start_time === '미정' ? '09:00' : '미정')}>미정</button>
              </div>
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-time-field">
              <label>종료예상시각</label>
              <div className="inline-actions schedule-time-actions">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="종료예상시각"
                  value={endTimeText}
                  onChange={e => setEndTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleEndTimeBlur}
                />
                <button type="button" className={form.end_time === '미정' ? 'ghost small active-icon mobile-visit-undecided mobile-time-undecided' : 'ghost small mobile-visit-undecided mobile-time-undecided'} onClick={() => changeTimeField('end_time', form.end_time === '미정' ? '10:00' : '미정')}>미정</button>
              </div>
            </div>
          </div>
          <div className="schedule-form-grid-4 schedule-editor-compact-grid schedule-date-time-compact-row schedule-date-time-short-row">
            <div className="stack compact-gap schedule-compact-field schedule-date-badge-field">
              <label>구분</label>
              <input type="text" value="종" readOnly className="schedule-date-badge-input" aria-label="종료일 구분" />
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-date-field schedule-date-short-field">
              <label>종료일</label>
              <input type="text" inputMode="numeric" aria-label="종료일" placeholder="26-04-13" value={endDateText} onChange={e => setEndDateText(e.target.value.replace(/[^\d-]/g, '').slice(0, 8))} onBlur={() => commitDateField('move_end_date', endDateText, form.move_end_date || form.move_start_date || presetDate)} />
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-time-field">
              <label>시작시각</label>
              <div className="inline-actions schedule-time-actions">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="시작시각"
                  value={endDateStartTimeText}
                  onChange={e => setEndDateStartTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleEndDateStartTimeBlur}
                />
                <button type="button" className={form.move_end_start_time === '미정' ? 'ghost small active-icon mobile-visit-undecided mobile-time-undecided' : 'ghost small mobile-visit-undecided mobile-time-undecided'} onClick={() => changeTimeField('move_end_start_time', form.move_end_start_time === '미정' ? '09:00' : '미정')}>미정</button>
              </div>
            </div>
            <div className="stack compact-gap schedule-compact-field schedule-time-field">
              <label>종료예상시각</label>
              <div className="inline-actions schedule-time-actions">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="종료예상시각"
                  value={endDateEndTimeText}
                  onChange={e => setEndDateEndTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleEndDateEndTimeBlur}
                />
                <button type="button" className={form.move_end_end_time === '미정' ? 'ghost small active-icon mobile-visit-undecided mobile-time-undecided' : 'ghost small mobile-visit-undecided mobile-time-undecided'} onClick={() => changeTimeField('move_end_end_time', form.move_end_end_time === '미정' ? '10:00' : '미정')}>미정</button>
              </div>
            </div>
          </div>
          <div className="stack compact-gap schedule-compact-field">
            <label>출발지 상세주소</label>
            <input value={form.start_address} placeholder="출발지 상세주소" onChange={e => handleStartAddressChange(e.target.value)} />
          </div>
          <div className="stack compact-gap schedule-compact-field">
            <label>도착지 상세주소</label>
            <input value={form.end_address} placeholder="도착지 상세주소" onChange={e => setForm({ ...form, end_address: e.target.value })} />
          </div>
          <div className="schedule-form-grid-2 schedule-editor-compact-grid">
            <div className="stack compact-gap schedule-compact-field">
              <label>예약자명</label>
              <input value={form.reservation_name || ''} placeholder="예약자명" onChange={e => setForm({ ...form, reservation_name: e.target.value })} />
            </div>
            <div className="stack compact-gap schedule-compact-field">
              <label>연락처</label>
              <input value={form.reservation_phone || ''} placeholder="연락처" onChange={e => setForm({ ...form, reservation_phone: e.target.value })} />
            </div>
          </div>
          <div className="stack compact-gap schedule-compact-field">
            <label>예약금 입금일시</label>
            <input value={form.deposit_datetime || ''} placeholder="예약금 입금일시" onChange={e => setForm({ ...form, deposit_datetime: e.target.value })} />
          </div>
          <div className="schedule-form-grid-2 schedule-assignee-grid schedule-editor-assignee-grid">
            <AssigneeInput label="담당대표" users={assignableUsers} value={[form.representative1, form.representative2, form.representative3].filter(Boolean).join(' / ')} onChange={updateRepresentativeNames} placeholder="담당대표" />
            <AssigneeInput label="담당직원" users={assignableUsers} value={[form.staff1, form.staff2, form.staff3].filter(Boolean).join(' / ')} onChange={updateStaffNames} placeholder="담당직원" />
          </div>
          {error && <div className="error">{error}</div>}

        </form>
      </section>
    </div>
  )
}

function ScheduleDetailContent({ eventId, embedded = false, onClose = null }) {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const canEditCurrentSchedule = canEditCalendarSchedule(currentUser)
  const [item, setItem] = useState(null)
  const [comments, setComments] = useState([])
  const [editLogs, setEditLogs] = useState([])
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [commentMenuId, setCommentMenuId] = useState(null)
  const [commentActionLoadingId, setCommentActionLoadingId] = useState(null)
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentForm, setCommentForm] = useState({ content: '', image_data: '' })
  const departmentColorMap = useMemo(() => getStoredDepartmentColorMap(), [])
  const detailImages = useMemo(() => eventImageList(item?.image_list?.length ? item.image_list : item?.image_data).slice(0, 5), [item])

  const load = useCallback(async () => {
    try {
      const [eventData, commentData, logData] = await Promise.all([
        api(`/api/calendar/events/${eventId}`),
        api(`/api/calendar/events/${eventId}/comments`).catch(() => []),
        api(`/api/calendar/events/${eventId}/edit-logs`).catch(() => []),
      ])
      setItem(eventData)
      setComments(Array.isArray(commentData) ? commentData : [])
      setEditLogs(Array.isArray(logData) ? logData : [])
      setError('')
    } catch (err) {
      setError(err.message || '일정상세를 불러오지 못했습니다.')
    }
  }, [eventId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    function handleWindowClick() {
      setMenuOpen(false)
      setCommentMenuId(null)
    }
    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [])

  async function handleDeleteSchedule() {
    if (!item?.id || deleting) return
    const confirmed = window.confirm('현재 일정을 삭제하시겠습니까?')
    if (!confirmed) return
    setDeleting(true)
    try {
      await api(`/api/calendar/events/${item.id}`, { method: 'DELETE' })
      if (embedded) {
        if (typeof onClose === 'function') onClose(true)
        return
      }
      navigate('/schedule')
    } catch (err) {
      window.alert(err.message || '일정 삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleCommentSubmit(e) {
    e.preventDefault()
    const content = String(commentForm.content || '').trim()
    const image_data = String(commentForm.image_data || '').trim()
    if (!content && !image_data) {
      window.alert('댓글 또는 사진을 입력해 주세요.')
      return
    }
    setCommentSubmitting(true)
    try {
      await api(`/api/calendar/events/${eventId}/comments`, { method: 'POST', body: JSON.stringify({ content, image_data }) })
      setCommentForm({ content: '', image_data: '' })
      await load()
    } catch (err) {
      window.alert(err.message || '댓글 등록에 실패했습니다.')
    } finally {
      setCommentSubmitting(false)
    }
  }

  async function handleCommentImageUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    try {
      const uploadedList = []
      for (const file of files) {
        const uploaded = await uploadFile(file, 'schedule')
        if (uploaded?.url) uploadedList.push(uploaded.url)
      }
      setCommentForm(prev => {
        const current = eventImageList(prev.image_data)
        return { ...prev, image_data: [...current, ...uploadedList].join('\n') }
      })
    } catch (err) {
      window.alert(err.message || '댓글 파일 업로드에 실패했습니다.')
    } finally {
      e.target.value = ''
    }
  }

  async function handleCopyAddress(label, value) {
    try {
      await copyTextToClipboard(value)
      window.alert(`${label} 주소를 복사했습니다.`)
    } catch (err) {
      window.alert(err.message || '주소 복사에 실패했습니다.')
    }
  }

  async function handleCommentEdit(comment) {
    const nextContent = window.prompt('댓글 수정', String(comment?.content || ''))
    setCommentMenuId(null)
    if (nextContent === null) return
    setCommentActionLoadingId(comment.id)
    try {
      await api(`/api/calendar/events/${eventId}/comments/${comment.id}`, { method: 'PUT', body: JSON.stringify({ content: nextContent, image_data: comment?.image_data || '' }) })
      await load()
    } catch (err) {
      window.alert(err.message || '댓글 수정에 실패했습니다.')
    } finally {
      setCommentActionLoadingId(null)
    }
  }

  async function handleCommentDelete(comment) {
    if (!window.confirm('현재 댓글을 삭제하시겠습니까?')) return
    setCommentMenuId(null)
    setCommentActionLoadingId(comment.id)
    try {
      await api(`/api/calendar/events/${eventId}/comments/${comment.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      window.alert(err.message || '댓글 삭제에 실패했습니다.')
    } finally {
      setCommentActionLoadingId(null)
    }
  }

  function formatLogDate(value) {
    if (!value) return '-'
    try {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      const year = String(date.getFullYear()).slice(-2)
      const month = date.getMonth() + 1
      const day = date.getDate()
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${year}. ${month}. ${day}. ${hour}:${minute}`
    } catch (_) {
      return value
    }
  }

  const amountText = item?.amount1 || item?.amount2 || item?.amount_item || ''
  const depositAmountText = item?.deposit_amount || ''
  const depositBefore = String(item?.deposit_method || '').trim() === '계약금입금전'
  const headerMeta = [
    item?.start_time || item?.visit_time || '시간미정',
    item?.schedule_type || '일반',
    item?.platform || '플랫폼미정',
    item?.customer_name || '고객명미정',
    amountText ? `(${amountText})` : '(금액미정)',
    depositBefore ? '입금전' : [item?.deposit_method, depositAmountText].filter(Boolean).join(' '),
  ].filter(Boolean)
  const headerTitle = headerMeta.join(' ')
  const reps = [item?.representative1, item?.representative2, item?.representative3].filter(Boolean)
  const staffs = [item?.staff1, item?.staff2, item?.staff3].filter(Boolean)
  const departmentColor = departmentColorMap[item?.department_info] || item?.color || '#2563eb'
  const departmentTextColor = getReadableTextColor(departmentColor)

  if (error) return <div className="card error">{error}</div>
  if (!item) return <div className="card">불러오는 중...</div>

  return (
    <div className={`stack-page schedule-detail-page-v2${embedded ? ' embedded-schedule-detail-page' : ''}`}>
      <section className={`card schedule-detail-card-v2${embedded ? ' embedded' : ''}`}>
        <div className="schedule-detail-sticky-stack">
          <div className="schedule-detail-author-bar">
            <div className="schedule-detail-author-text">글 작성자명 : {item.created_by_nickname || '계정 이름'}</div>
            <div className="schedule-detail-author-actions">
              {canEditCurrentSchedule && <button type="button" className="ghost small" onClick={() => navigate(`/schedule/${item.id}/edit`)}>수정</button>}
              <div className="dropdown-wrap" onClick={e => e.stopPropagation()}>
                <button type="button" className="ghost small" onClick={() => setMenuOpen(v => !v)}>설정</button>
                {menuOpen && (
                  <div className="dropdown-menu right schedule-detail-setting-menu">
                    <button type="button" className="dropdown-item" onClick={() => { openScheduleEditLogPopup(editLogs.map(log => ({ ...log, created_label: formatLogDate(log.created_at) }))); setMenuOpen(false) }}>수정기록</button>
                    {canEditCurrentSchedule ? (
                      <button type="button" className="dropdown-item danger" onClick={handleDeleteSchedule} disabled={deleting}>{deleting ? '삭제 중...' : '일정삭제'}</button>
                    ) : null}
                  </div>
                )}
              </div>
              {embedded && onClose ? <button type="button" className="ghost small" onClick={() => onClose(false)}>닫기</button> : null}
            </div>
          </div>
          <div className="schedule-detail-summary-bar">
            <div className="schedule-detail-title-line" title={headerTitle}>{headerTitle}</div>
          </div>
          <div className="schedule-detail-assignment-bar schedule-detail-assignment-bar-singleline">
            <span className="schedule-detail-chip schedule-detail-chip-department" style={{ backgroundColor: departmentColor, color: departmentTextColor, borderColor: departmentColor }}>{item.department_info || '부서/인원 미지정'}</span>
            <span className="schedule-detail-chip schedule-detail-assignee-chip" title={`담당대표 : ${reps.length ? reps.join(', ') : '-'}`}>담당대표 : {reps.length ? reps.join(', ') : '-'}</span>
            <span className="schedule-detail-chip schedule-detail-assignee-chip" title={`담당직원 : ${staffs.length ? staffs.join(', ') : '-'}`}>담당직원 : {staffs.length ? staffs.join(', ') : '-'}</span>
          </div>
          <div className="schedule-detail-copy-bar">
            <button type="button" className="ghost small schedule-detail-copy-button" onClick={() => handleCopyAddress('출발지', item.start_address)}>출발지 복사</button>
            <button type="button" className="ghost small schedule-detail-copy-button" onClick={() => handleCopyAddress('도착지', item.end_address)}>도착지 복사</button>
          </div>
        </div>

        <div className="schedule-detail-scroll-region">
          <div className="schedule-detail-content-body">
            <div className={`schedule-detail-image-grid count-${Math.min(Math.max(detailImages.length || 1, 1), 4)}`}>
              {detailImages.length ? detailImages.slice(0, 5).map((src, index) => (
                <div key={`${src}-${index}`} className="schedule-detail-image-tile"><img src={src} alt={`첨부파일 ${index + 1}`} className="schedule-detail-image" /></div>
              )) : <div className="schedule-detail-empty-box">첨부파일이 없습니다.</div>}
            </div>
            <div className="schedule-detail-memo-box">{item.content || '메모가 없습니다.'}</div>
          </div>

          <div className="schedule-detail-comments-section">
            <div className="schedule-detail-comments-title">댓글창</div>
            <div className="schedule-detail-comments-list">
              {comments.length ? comments.map(comment => {
                const commentImages = eventImageList(comment.image_list?.length ? comment.image_list : comment.image_data)
                return (
                  <div key={comment.id} className="schedule-comment-card">
                    <div className="schedule-comment-meta-row">
                      <div className="schedule-comment-meta">[{formatLogDate(comment.created_at)}] [{comment.user?.nickname || comment.user?.name || '프로필명'}]</div>
                      <div className="dropdown-wrap" onClick={e => e.stopPropagation()}>
                        <button type="button" className="ghost small schedule-comment-settings-button" onClick={() => setCommentMenuId(prev => prev === comment.id ? null : comment.id)}>설정</button>
                        {commentMenuId === comment.id ? (
                          <div className="dropdown-menu right schedule-comment-setting-menu">
                            <button type="button" className="dropdown-item" onClick={() => handleCommentEdit(comment)} disabled={commentActionLoadingId === comment.id}>수정</button>
                            <button type="button" className="dropdown-item danger" onClick={() => handleCommentDelete(comment)} disabled={commentActionLoadingId === comment.id}>삭제</button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {commentImages.length ? (
                      <div className={`schedule-comment-image-grid count-${Math.min(Math.max(commentImages.length, 1), 4)}`}>
                        {commentImages.slice(0, 4).map((src, index) => <div key={`${src}-${index}`} className="schedule-comment-image-tile"><img src={src} alt={`댓글 사진 ${index + 1}`} className="schedule-comment-image" /></div>)}
                      </div>
                    ) : null}
                    {comment.content ? <div className="schedule-comment-content">{comment.content}</div> : null}
                    <div className="schedule-comment-actions">🙂 💬</div>
                  </div>
                )
              }) : <div className="muted">등록된 댓글이 없습니다.</div>}
            </div>
          </div>
        </div>
      </section>

      <form className={`schedule-detail-comment-composer${embedded ? ' embedded' : ''}`} onSubmit={handleCommentSubmit}>
        <label className="schedule-comment-attach-button">
          ＋
          <input type="file" accept="image/*" multiple hidden onChange={handleCommentImageUpload} />
        </label>
        <input
          className="schedule-detail-comment-input"
          value={commentForm.content}
          onChange={e => setCommentForm(prev => ({ ...prev, content: e.target.value }))}
          placeholder={commentForm.image_data ? '사진과 함께 댓글 입력' : '댓글 입력칸'}
        />
        {commentForm.image_data ? <div className="schedule-comment-upload-hint">사진 {eventImageList(commentForm.image_data).length}개 첨부됨</div> : null}
        <button type="submit" className="primary small" disabled={commentSubmitting}>{commentSubmitting ? '등록중' : '입력'}</button>
      </form>
    </div>
  )
}

function ScheduleDetailPage() {
  const { eventId } = useParams()
  return <ScheduleDetailContent eventId={eventId} />
}

function NotificationsPage({ user }) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const canReviewSignupRequests = Number(user?.grade || 0) <= 2
  const [items, setItems] = useState([])
  const [prefs, setPrefs] = useState({})
  const [settingsView, setSettingsView] = useState('list')
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const alertSettings = useMemo(() => normalizeAlertSettings(prefs), [prefs])

  async function load() {
    const [n, p] = await Promise.all([api('/api/notifications'), api('/api/preferences')])
    setItems((n || []).filter(item => !['follow', 'favorite'].includes(String(item?.type || ''))))
    setPrefs(p || {})
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function handleNotificationClick(item) {
    try {
      if (!item?.is_read) {
        await api(`/api/notifications/${item.id}/read`, { method: 'POST' })
      }
    } catch (_) {}
    if (item?.type === 'friend_request') {
      navigate('/friends?panel=requests')
      return
    }
    if (item?.type === 'materials_pending_settlement' || item?.type === 'materials_purchase_request') {
      navigate('/materials?tab=requesters')
      return
    }
    if (item?.type === 'signup_request' && canReviewSignupRequests) {
      navigate('/admin-mode?panel=signup-approvals')
      return
    }
    await load().catch(() => {})
  }

  function updateAlertSettings(path, value) {
    setPrefs(prev => {
      const nextSettings = deepMerge(normalizeAlertSettings(prev), {})
      if (path.length === 1) {
        nextSettings[path[0]] = value
      } else if (path.length === 2) {
        nextSettings[path[0]] = { ...(nextSettings[path[0]] || {}), [path[1]]: value }
      }
      return { ...prev, alertSettings: nextSettings }
    })
  }

  async function saveAlertSettings() {
    setSaving(true)
    try {
      await api('/api/preferences', { method: 'POST', body: JSON.stringify({ data: { ...prefs, alertSettings } }) })
      setPrefs(prev => ({ ...prev, alertSettings }))
      setSettingsMenuOpen(false)
      window.alert('알림 설정이 저장되었습니다.')
    } catch (error) {
      window.alert(error.message || '알림 설정 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function requestBrowserPermission() {
    if (typeof Notification === 'undefined') {
      window.alert('현재 환경에서는 휴대폰 알림 권한 요청을 지원하지 않습니다.')
      return
    }
    try {
      const result = await Notification.requestPermission()
      window.alert(result === 'granted' ? '휴대폰 알림 권한이 허용되었습니다.' : '휴대폰 알림 권한이 허용되지 않았습니다.')
    } catch (_) {
      window.alert('알림 권한 요청 중 오류가 발생했습니다.')
    }
  }

  const scheduleItems = items.filter(item => isScheduleAlertNotification(item))
  const generalItems = items.filter(item => !isScheduleAlertNotification(item))

  function renderAlertSettings(channel) {
    const isMobile = channel === 'mobile'
    const typeMap = isMobile ? alertSettings.mobileTypes : alertSettings.appTypes
    return (
      <section className="card">
        <div className="between align-center notification-settings-header">
          <button type="button" className="ghost small notification-back-button" onClick={() => setSettingsView('list')}>←</button>
          <h2>{isMobile ? '휴대폰 알림' : '앱 내 알림'}</h2>
          <span />
        </div>
        <div className="stack">
          <label className="check"><input type="checkbox" checked={isMobile ? !!alertSettings.mobileEnabled : !!alertSettings.appEnabled} onChange={e => updateAlertSettings([isMobile ? 'mobileEnabled' : 'appEnabled'], e.target.checked)} /> {isMobile ? '휴대폰 알림 사용' : '앱 내 알림 사용'}</label>
          <div className="quote-inline-grid three compact-grid">
            <label>반복 알림 간격(시간)<input type="number" min="1" max="24" className="quote-form-input" value={alertSettings.repeatHours} onChange={e => updateAlertSettings(['repeatHours'], Math.max(1, Math.min(24, Number(e.target.value || 1))))} /></label>
            <label>조용한 시간 시작<input type="time" className="quote-form-input" value={alertSettings.quietStart} onChange={e => updateAlertSettings(['quietStart'], e.target.value)} /></label>
            <label>조용한 시간 종료<input type="time" className="quote-form-input" value={alertSettings.quietEnd} onChange={e => updateAlertSettings(['quietEnd'], e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={!!alertSettings.quietHoursEnabled} onChange={e => updateAlertSettings(['quietHoursEnabled'], e.target.checked)} /> 지정한 시간에는 알림 울리지 않기</label>
          <div className="stack notification-type-settings">
            <strong>알림 유형</strong>
            <label className="check"><input type="checkbox" checked={!!typeMap.assignment} onChange={e => updateAlertSettings([isMobile ? 'mobileTypes' : 'appTypes', 'assignment'], e.target.checked)} /> 스케줄 변경 알림</label>
            <label className="check"><input type="checkbox" checked={!!typeMap.time} onChange={e => updateAlertSettings([isMobile ? 'mobileTypes' : 'appTypes', 'time'], e.target.checked)} /> 이사시간 변경 알림</label>
            <label className="check"><input type="checkbox" checked={!!typeMap.address} onChange={e => updateAlertSettings([isMobile ? 'mobileTypes' : 'appTypes', 'address'], e.target.checked)} /> 출발지 주소변경 알림</label>
          </div>
          {isMobile && <div className="inline-actions wrap"><button type="button" className="ghost" onClick={requestBrowserPermission}>권한 허용 요청</button><div className="muted small-text">브라우저/앱 환경에서 지원되는 경우 시스템 알림으로 표시됩니다.</div></div>}
          <div className="inline-actions wrap"><button type="button" onClick={saveAlertSettings} disabled={saving}>{saving ? '저장 중...' : '설정 저장'}</button></div>
        </div>
      </section>
    )
  }

  return (
    <div className="grid2 notifications-page-grid notifications-page-grid-stacked">
      {settingsView === 'mobile' ? renderAlertSettings('mobile') : settingsView === 'app' ? renderAlertSettings('app') : (
        <>
          <section className="card">
            <div className="between align-center notification-page-topbar">
              <h2>스케줄 알림</h2>
              <div className="dropdown-wrap">
                <button type="button" className="ghost small" onClick={() => setSettingsMenuOpen(v => !v)}>설정</button>
                {settingsMenuOpen && (
                  <div className="dropdown-menu right notification-settings-menu">
                    <button type="button" className="dropdown-item" onClick={() => { setSettingsView('mobile'); setSettingsMenuOpen(false) }}>휴대폰 알림</button>
                    <button type="button" className="dropdown-item" onClick={() => { setSettingsView('app'); setSettingsMenuOpen(false) }}>앱 내 알림</button>
                  </div>
                )}
              </div>
            </div>
            <div className="list">
              {scheduleItems.map(item => (
                <button key={item.id} type="button" className={item.is_read ? 'list-item block notification-item' : 'list-item block notification-item unread'} onClick={() => handleNotificationClick(item)}>
                  <strong>{getNotificationDisplayParts(item).title || item.title}</strong>
                  <div style={{ whiteSpace: 'pre-line' }}>{formatNotificationBodyForDevice(item, isMobile)}</div>
                </button>
              ))}
              {scheduleItems.length === 0 && <div className="muted">스케줄 알림이 없습니다.</div>}
            </div>
          </section>
          <section className="card">
            <h2>일반 알림</h2>
            <div className="list">
              {generalItems.map(item => (
                <button key={item.id} type="button" className={item.is_read ? 'list-item block notification-item' : 'list-item block notification-item unread'} onClick={() => handleNotificationClick(item)}>
                  <strong>{getNotificationDisplayParts(item).title || item.title}</strong>
                  <div style={{ whiteSpace: 'pre-line' }}>{formatNotificationBodyForDevice(item, isMobile)}</div>
                </button>
              ))}
              {generalItems.length === 0 && <div className="muted">알림이 없습니다.</div>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}


function PointsPage() {
  return (
    <div className="stack-page">
      <section className="card">
        <h2>포인트</h2>
        <div className="muted">포인트 기능은 다음 업데이트에서 연결할 예정입니다.</div>
      </section>
    </div>
  )
}


const QUOTE_FORM_RADIO_OPTIONS = {
  household: ['1인 가구 or 1인 분가', '2인 가구', '3인 가구 이상', '기타(사무실이사, 일반용달)'],
  structure: ['원룸', '복층원룸', '1.5룸', '투룸', '쓰리룸 이상'],
  area: ['7평 이하', '8평 ~ 10평', '11평 ~ 15평', '15평 초과'],
  elevator: ['가능', '불가능'],
  destinationElevator: ['가능', '불가능', '미정(도착지가 정해지지 않은 경우)'],
  wasteService: ['희망 (신고부터 수거까지 원스탑 서비스)', '비희망 (신고는 고객님이, 운반은 저희가)'],
  companion: ['희망 (장거리 이동 동승 불가)', '비희망'],
}

const QUOTE_FORM_MOVE_TYPES = ['일반이사', '반포장이사(추천)', '포장이사']
const QUOTE_FORM_PREMIUM_OPTIONS = ['침대 이중 비닐 커버(위생 보호)', '위생 덧신 착용(청결)']
const QUOTE_FORM_FURNITURE_OPTIONS = ['해당 사항 없음(가전/가구 없음)', '침대(프레임 X)', '침대(프레임 O)', '건조기', '세탁기', '워시타워(건조기+세탁기)', '소파(3-4인)', 'TV(65인치 이하)', 'TV(65인치 초과)', '에어컨', '에어컨 철거 필요(철거 안 되어 있을 경우 필수 체크)', '스타일러(높이 191CM 이하)', '스타일러(높이 191CM 초과)', '양문형 냉장고', '일반냉장고(300L 초과)', '책장(높이 191CM 초과)', '옷장(높이 191CM 이하)', '옷장(높이 191CM 초과)', '왕자행거(봉형)', '드레스룸 행거(시스템행거 / 수납장 있는 행거)']
const QUOTE_FORM_DISASSEMBLY_OPTIONS = ['해당 사항 없음(분해/조립 필요 가전/가구 없음)', '일반 침대 프레임', '모션 배드 침대', '돌침대', '벙커 침대 프레임', '비데', '블라인드 / 커텐', '왕자 행거(봉형)', '드레스룸 행거(시스템 행거 / 수납장 있는 행거)', '책 있음(50권 이상)']
const QUOTE_FORM_LARGE_ITEM_OPTIONS = ['해당 사항 없음(폐기물 없음)', '스타일러', '세탁기', '건조기', '양문형 냉장고', '책장(높이 191cm 초과)', '드레스룸 행거(시스템 행거 / 수납장 있는 행거)', '옷장']

const PRIVACY_NOTICE_TEXT = `이청잘 이집청년 이사잘하네(이하 ‘이청잘’)는 개인정보 보호법 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리하기 위해 필요한 범위에서 개인정보를 처리합니다.

수집 목적: 견적 안내, 상담 연락, 접수 내역 관리, 고객 문의 대응
보유 기간: 견적/상담 처리 완료 후 관련 법령 및 내부 기준에 따라 보관
수집 항목: 고객 성함, 연락처, 주소, 이사 희망일, 가전/가구 및 옵션 정보 등 신청 양식에 직접 입력한 정보

본 양식은 상담 및 견적 발송 목적의 접수용이며, 제출 시 관리자가 접수 목록과 상세 내용을 확인할 수 있습니다.`


function validateGuestCustomerName(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) return '이름(또는 닉네임)을 입력해 주세요.'
  if (/[^A-Za-z0-9가-힣\s]/.test(value)) return '이름에는 특수문자를 사용할 수 없습니다.'
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(value)) return '한글 이름은 자음/모음 단독 입력 없이 완성형으로 입력해 주세요.'

  const compact = value.replace(/\s+/g, '')
  const hasHangul = /[가-힣]/.test(compact)
  const hasAlpha = /[A-Za-z]/.test(compact)
  const hasDigit = /\d/.test(compact)

  if (hasHangul && !hasAlpha && !hasDigit) {
    if (compact.length < 2) return '한글 이름은 2자리 이상 입력해 주세요.'
    return ''
  }
  if (!hasHangul && hasAlpha && !hasDigit) {
    if (compact.length < 4) return '영문 이름은 4자리 이상 입력해 주세요.'
    return ''
  }
  if (!hasHangul && !hasAlpha && hasDigit) {
    if (compact.length < 4) return '숫자 이름은 4자리 이상 입력해 주세요.'
    return ''
  }
  if (hasHangul) {
    if (compact.length < 2) return '한글과 영문/숫자를 함께 쓰는 경우 2자리 이상 입력해 주세요.'
    return ''
  }
  if (compact.length < 4) return '영문과 숫자 조합 이름은 4자리 이상 입력해 주세요.'
  return ''
}



function formatPhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

function formatQuoteDesiredDate(item) {
  const value = String(item?.desired_date || '').trim()
  if (value) return value
  const payload = item?.payload || {}
  if (item?.form_type === 'storage') return [payload.storage_start_date, payload.storage_end_date].filter(Boolean).join(' ~ ')
  return payload.move_date || '-'
}

function formatQuoteFieldValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-'
  if (value === null || value === undefined) return '-'
  const text = String(value).trim()
  return text || '-'
}

function QuoteField({ label, required = false, children, hint = '' }) {
  return <div className="quote-form-group"><label className="quote-form-label">{required ? '＊ ' : ''}{label}</label>{hint && <div className="quote-form-hint">{hint}</div>}{children}</div>
}


function OperationsDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const result = await api('/api/operations/dashboard', { cache: 'no-store' })
        if (!ignore) setData(result)
      } catch (err) {
        if (!ignore) setError(err.message || '대쉬보드 정보를 불러오지 못했습니다.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    return () => { ignore = true }
  }, [])

  return <div className="stack-page">
    <section className="card">
      <div className="between align-center">
        <div>
          <h2>운영 대쉬보드</h2>
          <div className="muted small-text">자동 견적, CRM, 결산, 증빙, 출퇴근 기능의 준비/활성 상태를 한 화면에서 확인합니다.</div>
        </div>
        <button type="button" className="small ghost" onClick={() => window.location.reload()}>새로고침</button>
      </div>
      {loading && <div className="muted">불러오는 중...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && data && <>
        <div className="quote-detail-grid">
          <div className="quote-detail-section"><h4>오늘 운영</h4><dl>{[
            ['오늘 일정 수', `${data.today?.schedule_count ?? 0}건`],
            ['배정 인원 수', `${data.today?.assigned_people_count ?? 0}명`],
            ['오늘 매출 합계', `${Number(data.today?.sales_amount ?? 0).toLocaleString()}원`],
            ['오늘 계약금 합계', `${Number(data.today?.deposit_amount ?? 0).toLocaleString()}원`],
          ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
          <div className="quote-detail-section"><h4>최근 30일</h4><dl>{[
            ['최근 30일 견적 접수', `${data.month?.quote_count ?? 0}건`],
            ['최근 30일 매출 합계', `${Number(data.month?.sales_amount ?? 0).toLocaleString()}원`],
            ['최근 30일 계약금 합계', `${Number(data.month?.deposit_amount ?? 0).toLocaleString()}원`],
            ['활성 차량 위치 수', `${data.operations?.live_vehicle_count ?? 0}건`],
          ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
          <div className="quote-detail-section"><h4>운영 자동화 준비 상태</h4>
            <div className="stack compact">
              {(data.feature_status || []).map(item => <div key={item.key} className="quick-edit-row"><span>{item.label}</span><strong>{item.status}</strong></div>)}
            </div>
          </div>
        </div>
        <div className="quote-detail-grid">
          <div className="quote-detail-section"><h4>CRM 중복 고객 후보</h4>
            <div className="stack compact">
              {(data.operations?.repeat_customer_candidates || []).length === 0 ? <div className="muted">중복 고객 후보가 없습니다.</div> : (data.operations?.repeat_customer_candidates || []).map((item, index) => <div key={`${item.contact_phone}-${index}`} className="quick-edit-row"><span>{item.contact_phone}</span><strong>{item.count}회</strong></div>)}
            </div>
          </div>
          <div className="quote-detail-section"><h4>현장 운영 데이터</h4><dl>{[
            ['증빙 파일 등록 수', `${data.operations?.evidence_count ?? 0}건`],
            ['체크리스트 생성 수', `${data.operations?.checklist_count ?? 0}건`],
          ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
        </div>
      </>}
    </section>
  </div>
}

function QuoteRadioGroup({ name, value, options, onChange }) {
  return <div className="quote-choice-list">{options.map(option => <label key={option} className={`quote-choice quote-choice-radio ${value === option ? 'selected' : ''}`.trim()}><input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} /><span>{option}</span></label>)}</div>
}

function QuoteCheckboxGroup({ values, options, onChange }) {
  const current = Array.isArray(values) ? values : []
  function toggle(option) {
    if (current.includes(option)) onChange(current.filter(item => item !== option))
    else onChange([...current, option])
  }
  return <div className="quote-choice-list">{options.map(option => <label key={option} className={`quote-choice quote-choice-check ${current.includes(option) ? 'selected' : ''}`.trim()}><input type="checkbox" checked={current.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}</div>
}


function QuoteFormsPage({ user, guestMode = false }) {
  const navigate = useNavigate()
  const isAdminUser = !guestMode && canAccessAdminMode(user)
  const [mode, setMode] = useState('')
  const [pageTab, setPageTab] = useState('form')
  const [listTypeTab, setListTypeTab] = useState('same_day')
  const [submitting, setSubmitting] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [adminItems, setAdminItems] = useState([])
  const [detailItem, setDetailItem] = useState(null)
  const [operationsPreview, setOperationsPreview] = useState(null)
  const [operationsLoading, setOperationsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [guestIntro, setGuestIntro] = useState({
    customer_name: user?.name || user?.nickname || '',
    contact_phone: user?.phone || '',
  })
  const [guestIntroCompleted, setGuestIntroCompleted] = useState(!guestMode)
  const [submittedSummary, setSubmittedSummary] = useState(null)
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState(() => {
    try {
      const raw = localStorage.getItem('icj_quote_favorites')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : []
    } catch (_) {
      return []
    }
  })
  const buildBaseForm = (nameValue = user?.name || user?.nickname || '', phoneValue = user?.phone || '') => ({
    privacy_agreed: false,
    customer_name: nameValue,
    move_date: '',
    storage_start_date: '',
    storage_end_date: '',
    household: '',
    structure: '',
    area: '',
    origin_address: '',
    origin_address_detail: '',
    origin_elevator: '',
    destination_address: '',
    destination_address_detail: '',
    destination_elevator: '',
    move_types: [],
    contact_phone: phoneValue,
    premium_options: [],
    furniture_types: [],
    extra_furniture: '',
    duplicate_furniture: '',
    disassembly_types: [],
    extra_disassembly: '',
    duplicate_disassembly: '',
    large_item_types: [],
    extra_large_items: '',
    duplicate_large_items: '',
    waste_service: '',
    companion_preference: '',
    via_address: '',
    via_address_detail: '',
    via_elevator: '',
    via_pickup_items: '',
    via_drop_items: '',
    move_scope_notice: false,
    kakao_notice: false,
    request_memo: '',
  })
  const [form, setForm] = useState(() => buildBaseForm())

  useEffect(() => {
    if (pageTab === 'list' && isAdminUser) loadAdminList()
  }, [pageTab, isAdminUser])

  useEffect(() => {
    try {
      localStorage.setItem('icj_quote_favorites', JSON.stringify(favoriteIds))
    } catch (_) {}
  }, [favoriteIds])

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleGuestIntroChange(key, value) {
    setGuestIntro(prev => ({ ...prev, [key]: value }))
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function proceedGuestIntro(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    const nameError = validateGuestCustomerName(guestIntro.customer_name)
    if (nameError) {
      setError(nameError)
      return
    }
    if (!String(guestIntro.contact_phone || '').trim()) {
      setError('연락처를 입력해 주세요.')
      return
    }
    const trimmedName = String(guestIntro.customer_name || '').trim()
    const trimmedPhone = String(guestIntro.contact_phone || '').trim()
    setGuestIntro({ customer_name: trimmedName, contact_phone: trimmedPhone })
    setForm(prev => ({ ...prev, customer_name: trimmedName, contact_phone: trimmedPhone }))
    setGuestIntroCompleted(true)
  }

  function selectMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    setError('')
    setSubmittedSummary(null)
  }

  function resetModeSelection() {
    setMode('')
    setMessage('')
    setError('')
    setSubmittedSummary(null)
  }

  function openPrivacyModal() {
    setPrivacyModalOpen(true)
  }

  function closePrivacyModal(agree = false) {
    setPrivacyModalOpen(false)
    if (agree) updateField('privacy_agreed', true)
  }

  function resetFormForCurrentUser() {
    const nextName = guestMode ? guestIntro.customer_name : (user?.name || user?.nickname || '')
    const nextPhone = guestMode ? guestIntro.contact_phone : (user?.phone || '')
    setForm(buildBaseForm(nextName, nextPhone))
  }

  function restartGuestFlow() {
    setSubmittedSummary(null)
    setMode('')
    setMessage('')
    setError('')
    if (guestMode) {
      setGuestIntroCompleted(false)
    }
    resetFormForCurrentUser()
  }

  function buildPayload() {
    const payload = { ...form, request_kind: mode === 'storage' ? '짐보관이사' : '당일이사' }
    const desiredDate = mode === 'storage'
      ? [form.storage_start_date, form.storage_end_date].filter(Boolean).join(' ~ ')
      : form.move_date
    return {
      form_type: mode === 'storage' ? 'storage' : 'same_day',
      requester_name: form.customer_name,
      contact_phone: form.contact_phone,
      desired_date: desiredDate,
      summary_title: `${mode === 'storage' ? '짐보관이사' : '당일이사'} · ${form.customer_name || '고객'}`,
      privacy_agreed: !!form.privacy_agreed,
      payload,
    }
  }

  async function submitForm(e) {
    e.preventDefault()
    setMessage('')
    setError('')
    if (!form.privacy_agreed) { setError('개인정보 수집 및 이용 동의가 필요합니다.'); return }
    if (!form.customer_name.trim()) { setError('고객 성함을 입력해 주세요.'); return }
    if (!form.contact_phone.trim()) { setError('견적 받으실 연락처를 입력해 주세요.'); return }
    if (mode === 'storage') {
      if (!form.storage_start_date || !form.storage_end_date) { setError('짐보관 시작/종료 일자를 입력해 주세요.'); return }
    } else if (!form.move_date) { setError('이사 희망 날짜를 입력해 주세요.'); return }
    setSubmitting(true)
    try {
      await api('/api/quote-forms/submit', { method: 'POST', body: JSON.stringify(buildPayload()) })
      const summaryDate = mode === 'storage'
        ? [form.storage_start_date, form.storage_end_date].filter(Boolean).join(' ~ ')
        : form.move_date
      setSubmittedSummary({
        customer_name: form.customer_name,
        contact_phone: form.contact_phone,
        desired_date: summaryDate || '-',
        origin_address: [form.origin_address, form.origin_address_detail].filter(Boolean).join(' '),
        destination_address: [form.destination_address, form.destination_address_detail].filter(Boolean).join(' '),
      })
      setMessage('양식이 정상 접수되었습니다. 관리자는 견적목록에서 내용을 확인할 수 있습니다.')
      resetFormForCurrentUser()
      if (isAdminUser) {
        setPageTab('list')
        loadAdminList()
      }
    } catch (err) {
      setError(err.message || '양식 접수 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function loadAdminList() {
    setListLoading(true)
    setError('')
    try {
      const result = await api('/api/admin/quote-forms')
      const nextItems = result.items || []
      setAdminItems(nextItems)
      if (nextItems.length > 0) {
        const matched = detailItem ? nextItems.find(item => item.id === detailItem.id) : nextItems[0]
        setDetailItem(matched || nextItems[0])
      } else {
        setDetailItem(null)
      }
    } catch (err) {
      setError(err.message || '견적목록을 불러오지 못했습니다.')
    } finally {
      setListLoading(false)
    }
  }

  async function openDetail(itemId) {
    setDetailLoading(true)
    setOperationsPreview(null)
    try {
      const result = await api(`/api/admin/quote-forms/${itemId}`)
      setDetailItem(result.item || null)
    } catch (err) {
      setError(err.message || '상세작성양식을 불러오지 못했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }


  async function loadOperationsPreview(itemId = detailItem?.id) {
    if (!itemId) return
    setOperationsLoading(true)
    try {
      const result = await api(`/api/admin/quote-forms/${itemId}/operations-preview`, { cache: 'no-store' })
      setOperationsPreview(result.preview || null)
    } catch (err) {
      setError(err.message || '운영 미리보기를 불러오지 못했습니다.')
    } finally {
      setOperationsLoading(false)
    }
  }

  async function downloadEstimateExcel(itemId = detailItem?.id) {
    if (!itemId) return
    try {
      const token = sessionStorage.getItem('icj_token') || localStorage.getItem('icj_token') || ''
      const base = getApiBase()
      const response = await fetch(`${base}/api/admin/quote-forms/${itemId}/estimate-excel`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || '견적 엑셀 다운로드에 실패했습니다.')
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `estimate_${itemId}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || '견적 엑셀 다운로드에 실패했습니다.')
    }
  }

  function toggleFavorite(itemId) {
    setFavoriteIds(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId])
  }

  function toggleSelected(itemId) {
    setSelectedIds(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId])
  }

  function toggleSelectAll(checked) {
    if (!checked) {
      setSelectedIds([])
      return
    }
    setSelectedIds(filteredAdminItems.map(item => item.id))
  }

  const currentDesiredLabel = detailItem?.form_type === 'storage' ? '짐보관 시작 / 종료 일자' : '이사 희망 날짜'
  const adminDetailPayload = detailItem?.payload || {}
  const filteredAdminItems = adminItems.filter(item => listTypeTab === 'storage' ? item.form_type === 'storage' : item.form_type !== 'storage')
  const allSelected = filteredAdminItems.length > 0 && filteredAdminItems.every(item => selectedIds.includes(item.id))

  return <div className="stack-page quote-forms-page quotes-page">
    <section className="card quote-form-shell">
      <div className="quote-form-title-block">
        <h2>{guestMode && mode ? `${mode === 'storage' ? '짐보관이사 상세 견적요청서' : '당일이사 상세 견적요청서'}` : guestMode && !mode ? '' : '견적'}</h2>
        {!guestMode && <div className="quote-form-note">견적양식 작성과 관리자용 견적목록을 한 화면에서 관리합니다.</div>}
      </div>

      {!guestMode && <div className="quote-page-tabs">
        <button type="button" className={pageTab === 'form' ? 'active' : ''} onClick={() => setPageTab('form')}>견적양식</button>
        <button type="button" className={pageTab === 'list' ? 'active' : ''} onClick={() => setPageTab('list')}>견적목록</button>
      </div>}

      {message && <div className="success-banner">{message}</div>}
      {error && <div className="error-banner">{error}</div>}

      {(pageTab === 'form' || guestMode) && <>
        {guestMode && !guestIntroCompleted && !submittedSummary && (
          <section className="quote-mode-select-card quote-guest-intro-card">
            <div className="quote-step-header centered">
              <button type="button" className="quote-step-nav-text" onClick={() => navigate('/login')}>로그인이동</button>
              <div className="quote-step-title quote-step-title-two-line"><span>로그인 없이 견적받기</span><span>(비회원)(1단계)</span></div>
              <span className="quote-step-nav-spacer" aria-hidden="true">로그인이동</span>
            </div>
            <div className="quote-form-mode-intro quote-guest-intro-layout refined">
              <div className="quote-guest-intro-title">이름과 연락처 입력</div>
              <div className="quote-guest-intro-help emphasis">※ 안내 : 이름 작성은 고객 구분을 위해 필요한 정보이며, 연락처는 문의주신 견적요청서에 대해 답변드리기 위한 용도로 사용됩니다.</div>
              <form className="quote-guest-intro-form" onSubmit={proceedGuestIntro}>
                <label className="quote-input-block">
                  <span>＊ 이름(또는 닉네임)</span>
                  <input className="quote-form-input" placeholder="예: 성규 / 규A1 / mover01" value={guestIntro.customer_name} onChange={e => handleGuestIntroChange('customer_name', e.target.value)} />
                </label>
                <label className="quote-input-block">
                  <span>＊ 연락처</span>
                  <input className="quote-form-input" inputMode="numeric" maxLength={13} placeholder="010-0000-0000" value={guestIntro.contact_phone} onChange={e => handleGuestIntroChange('contact_phone', formatPhoneDigits(e.target.value))} />
                </label>
                <div className="quote-guest-intro-help-panel">
                  <div className="quote-guest-intro-help-title">입력 조건</div>
                  <ul className="quote-guest-intro-help-list muted tiny-text">
                    <li>이름에는 특수문자를 사용할 수 없습니다.</li>
                    <li>한글은 완성형 2자리 이상 입력해야 합니다. 예: 성규</li>
                    <li>영문만 또는 숫자만 입력하는 경우 4자리 이상이어야 합니다.</li>
                    <li>한글과 영문/숫자를 함께 입력하는 경우 2자리 이상이면 가능합니다. 예: 성01, 규A1</li>
                  </ul>
                </div>
                <div className="quote-submit-bar guest-intro-submit"><button type="submit">다음 단계</button></div>
              </form>
            </div>
          </section>
        )}

        {!submittedSummary && (!guestMode || guestIntroCompleted) && !mode && (
          <section className="quote-mode-select-card quote-mode-select-compact">
            {guestMode && (
              <div className="quote-step-header centered">
                <button type="button" className="quote-step-nav-text" onClick={() => setGuestIntroCompleted(false)}>이전</button>
                <div className="quote-step-title quote-step-title-two-line"><span>로그인 없이 견적받기</span><span>(비회원)(2단계)</span></div>
                <span className="quote-step-nav-spacer" aria-hidden="true">이전</span>
              </div>
            )}
            <div className="quote-form-mode-intro quote-step-body">
              <div className="quote-form-mode-title centered">이사방법 선택</div>
              <div className="quote-mode-choice-row style-ref">
                <button type="button" className="quote-mode-button compact styled-choice" onClick={() => selectMode('same_day')}><span className="choice-name">당일이사</span><span className="choice-arrow">→</span></button>
              </div>
              <div className="quote-mode-help centered">짐 보관 필요 없이 바로 입주 가능한 경우</div>
              <div className="quote-mode-choice-row style-ref">
                <button type="button" className="quote-mode-button compact styled-choice" onClick={() => selectMode('storage')}><span className="choice-name">짐보관이사</span><span className="choice-arrow">→</span></button>
              </div>
              <div className="quote-mode-help centered">당일에 바로 입주가 안되어 짐을 보관해뒀다가 추후에 입주를 해야할 경우</div>
            </div>
          </section>
        )}

        {!submittedSummary && (!!mode) && <>
        {guestMode && (
          <div className="quote-step-card stage-three">
            <div className="quote-step-header centered quote-step-header-boxed">
              <button type="button" className="quote-step-nav-text" onClick={resetModeSelection}>이전</button>
              <div className="quote-step-heading-group">
                <div className="quote-step-title quote-step-title-two-line"><span>로그인 없이 견적받기</span><span>(비회원)(3단계)</span></div>
                <div className="quote-step-subtitle centered">{mode === 'storage' ? '짐보관이사 상세 견적요청서' : '당일이사 상세 견적요청서'}</div>
              </div>
              <span className="quote-step-nav-spacer" aria-hidden="true">이전</span>
            </div>
          </div>
        )}
        <div className="quote-move-type-table-wrapper compact integrated">
          <table className="quote-move-type-table compact-table">
            <tbody>
              <tr><th></th><th></th><th>일반이사</th><th className="blue">반포장이사(추천)</th><th className="red">포장이사</th></tr>
              <tr><th rowSpan="2" className="sky">출발지</th><th className="sky">짐포장</th><td>고객님</td><td rowSpan="3" className="blue">이청잘</td><td rowSpan="4" className="red">이청잘</td></tr>
              <tr><th className="sky">가전/가구포장</th><td>이청잘</td></tr>
              <tr><th rowSpan="2" className="rose">도착지</th><th className="rose">가전/가구 배치</th><td>이청잘</td></tr>
              <tr><th className="rose">짐 뒷정리</th><td>고객님</td><td className="blue">고객님</td></tr>
            </tbody>
          </table>
        </div>

        <form className="quote-form-body" onSubmit={submitForm}>
          <section className="quote-form-section">
            <QuoteField label="개인정보 수집 및 이용 동의" required>
              <div className="quote-privacy-actions">
                <button type="button" className="ghost small" onClick={openPrivacyModal}>상세보기</button>
                <label className="quote-choice quote-choice-check quote-inline-check"><input type="checkbox" checked={form.privacy_agreed} onChange={e => updateField('privacy_agreed', e.target.checked)} /><span>개인정보 수집 및 이용에 동의합니다.</span></label>
              </div>
            </QuoteField>
            <QuoteField label="고객 성함" required><input className="quote-form-input" value={form.customer_name} onChange={e => updateField('customer_name', e.target.value)} /></QuoteField>
            {mode === 'storage' ? <div className="quote-inline-grid two"><QuoteField label="짐보관 시작 희망일" required><input type="date" className="quote-form-input" value={form.storage_start_date} onChange={e => updateField('storage_start_date', e.target.value)} /></QuoteField><QuoteField label="짐보관 종료 희망일" required><input type="date" className="quote-form-input" value={form.storage_end_date} onChange={e => updateField('storage_end_date', e.target.value)} /></QuoteField></div> : <QuoteField label="이사 희망 날짜" required><input type="date" className="quote-form-input" value={form.move_date} onChange={e => updateField('move_date', e.target.value)} /></QuoteField>}
            <div className="quote-inline-grid three">
              <QuoteField label="출발지 거주 가구원" required><QuoteRadioGroup name="household" value={form.household} options={QUOTE_FORM_RADIO_OPTIONS.household} onChange={value => updateField('household', value)} /></QuoteField>
              <QuoteField label="출발지 구조" required><QuoteRadioGroup name="structure" value={form.structure} options={QUOTE_FORM_RADIO_OPTIONS.structure} onChange={value => updateField('structure', value)} /></QuoteField>
              <QuoteField label="출발지 평수" required><QuoteRadioGroup name="area" value={form.area} options={QUOTE_FORM_RADIO_OPTIONS.area} onChange={value => updateField('area', value)} /></QuoteField>
            </div>
            <div className="quote-inline-grid two">
              <QuoteField label="출발지 주소" required><input className="quote-form-input" placeholder="주소" value={form.origin_address} onChange={e => updateField('origin_address', e.target.value)} /><input className="quote-form-input" placeholder="상세주소" value={form.origin_address_detail} onChange={e => updateField('origin_address_detail', e.target.value)} /></QuoteField>
              <QuoteField label="출발지 엘레베이터" required><QuoteRadioGroup name="originElevator" value={form.origin_elevator} options={QUOTE_FORM_RADIO_OPTIONS.elevator} onChange={value => updateField('origin_elevator', value)} /></QuoteField>
            </div>
            <div className="quote-inline-grid two">
              <QuoteField label="도착지 주소" required><input className="quote-form-input" placeholder="주소" value={form.destination_address} onChange={e => updateField('destination_address', e.target.value)} /><input className="quote-form-input" placeholder="상세주소" value={form.destination_address_detail} onChange={e => updateField('destination_address_detail', e.target.value)} /></QuoteField>
              <QuoteField label="도착지 엘레베이터" required><QuoteRadioGroup name="destinationElevator" value={form.destination_elevator} options={QUOTE_FORM_RADIO_OPTIONS.destinationElevator} onChange={value => updateField('destination_elevator', value)} /></QuoteField>
            </div>
            <QuoteField label="희망 이사 종류" required><QuoteCheckboxGroup values={form.move_types} options={QUOTE_FORM_MOVE_TYPES} onChange={value => updateField('move_types', value)} /></QuoteField>
            <QuoteField label="견적 받으실 연락처" required><input className="quote-form-input" inputMode="numeric" maxLength={13} placeholder="010-0000-0000" value={form.contact_phone} onChange={e => updateField('contact_phone', formatPhoneDigits(e.target.value))} /></QuoteField>
          </section>

          <section className="quote-form-section">
            <QuoteField label="프리미엄 추가 옵션(무료)"><QuoteCheckboxGroup values={form.premium_options} options={QUOTE_FORM_PREMIUM_OPTIONS} onChange={value => updateField('premium_options', value)} /></QuoteField>
            <QuoteField label="가전/가구 종류" required><QuoteCheckboxGroup values={form.furniture_types} options={QUOTE_FORM_FURNITURE_OPTIONS} onChange={value => updateField('furniture_types', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="위에 없는 중형/대형 가전/가구 별도 기재"><input className="quote-form-input" placeholder="ex) 소파(2인) / tv장" value={form.extra_furniture} onChange={e => updateField('extra_furniture', e.target.value)} /></QuoteField>
              <QuoteField label="가전/가구 2개 이상 별도 기재"><input className="quote-form-input" placeholder="ex) 행거 2개 / 옷장 191cm 초과 2개" value={form.duplicate_furniture} onChange={e => updateField('duplicate_furniture', e.target.value)} /></QuoteField>
            </div>
            <QuoteField label="분해/조립 필요 가전/가구 및 책" required><QuoteCheckboxGroup values={form.disassembly_types} options={QUOTE_FORM_DISASSEMBLY_OPTIONS} onChange={value => updateField('disassembly_types', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="위에 없는 분해/조립 필요 가전/가구"><input className="quote-form-input" placeholder="ex) 블라인드 / 커텐 / 행거" value={form.extra_disassembly} onChange={e => updateField('extra_disassembly', e.target.value)} /></QuoteField>
              <QuoteField label="분해/조립 필요 가전/가구 2개 이상 기재"><input className="quote-form-input" placeholder="ex) 행거 2개 / 커텐 2개 / 블라인드 3개" value={form.duplicate_disassembly} onChange={e => updateField('duplicate_disassembly', e.target.value)} /></QuoteField>
            </div>
            <QuoteField label="대형 가전/가구 / 폐기물" required hint="* 폐기물 대리 신고 서비스 가능합니다."><QuoteCheckboxGroup values={form.large_item_types} options={QUOTE_FORM_LARGE_ITEM_OPTIONS} onChange={value => updateField('large_item_types', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="위에 없는 중/대형 가전/가구 별도 기재"><input className="quote-form-input" value={form.extra_large_items} onChange={e => updateField('extra_large_items', e.target.value)} /></QuoteField>
              <QuoteField label="중/대형 가전/가구 2개 이상 별도 기재"><input className="quote-form-input" value={form.duplicate_large_items} onChange={e => updateField('duplicate_large_items', e.target.value)} /></QuoteField>
            </div>
          </section>

          <section className="quote-form-section">
            <QuoteField label="폐기물 원스탑 신고 서비스 접수 희망"><QuoteRadioGroup name="wasteService" value={form.waste_service} options={QUOTE_FORM_RADIO_OPTIONS.wasteService} onChange={value => updateField('waste_service', value)} /></QuoteField>
            <QuoteField label="동승 희망 여부"><QuoteRadioGroup name="companion" value={form.companion_preference} options={QUOTE_FORM_RADIO_OPTIONS.companion} onChange={value => updateField('companion_preference', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="경유지 주소" hint="경유지가 있는 경우에만 작성"><input className="quote-form-input" placeholder="주소" value={form.via_address} onChange={e => updateField('via_address', e.target.value)} /><input className="quote-form-input" placeholder="상세주소" value={form.via_address_detail} onChange={e => updateField('via_address_detail', e.target.value)} /></QuoteField>
              <QuoteField label="경유지 엘레베이터"><QuoteRadioGroup name="viaElevator" value={form.via_elevator} options={QUOTE_FORM_RADIO_OPTIONS.elevator} onChange={value => updateField('via_elevator', value)} /></QuoteField>
            </div>
            <div className="quote-inline-grid two">
              <QuoteField label="경유지 상차 물품"><input className="quote-form-input" value={form.via_pickup_items} onChange={e => updateField('via_pickup_items', e.target.value)} /></QuoteField>
              <QuoteField label="경유지 하차 물품"><input className="quote-form-input" value={form.via_drop_items} onChange={e => updateField('via_drop_items', e.target.value)} /></QuoteField>
            </div>
            <QuoteField label="추가 메모"><textarea className="quote-form-textarea" value={form.request_memo} onChange={e => updateField('request_memo', e.target.value)} /></QuoteField>
            <div className="quote-notice-stack">
              <label className="quote-choice quote-choice-check quote-inline-check"><input type="checkbox" checked={form.move_scope_notice} onChange={e => updateField('move_scope_notice', e.target.checked)} /><span>'이청잘'은 원룸/투룸/소형이사 전문 브랜드이며, 집/짐량 사이즈에 따라 견적 발송이 제한될 수 있음을 확인했습니다.</span></label>
              <label className="quote-choice quote-choice-check quote-inline-check"><input type="checkbox" checked={form.kakao_notice} onChange={e => updateField('kakao_notice', e.target.checked)} /><span>견적은 카카오톡으로 발송되며, 전화번호로 친구 추가 허용이 필요함을 확인했습니다.</span></label>
            </div>
          </section>

          <div className="quote-submit-bar"><button type="submit" disabled={submitting}>{submitting ? '접수 중...' : '신청 보내기'}</button></div>
        </form>
        </>}

        {privacyModalOpen && <div className="modal-overlay" onClick={() => closePrivacyModal(true)}>
          <div className="modal-card quote-privacy-modal" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <h3>개인정보 수집 및 이용 동의</h3>
              <button type="button" className="ghost small" onClick={() => closePrivacyModal(true)}>닫기</button>
            </div>
            <pre className="quote-privacy-modal-text">{PRIVACY_NOTICE_TEXT}</pre>
          </div>
        </div>}

        {submittedSummary && <section className="quote-mode-select-card quote-completion-card">
          <div className="quote-form-mode-intro">
            <div className="quote-form-mode-title">최종 접수 완료</div>
            <div className="quote-completion-message">{submittedSummary.customer_name} {submittedSummary.contact_phone} {submittedSummary.desired_date} {submittedSummary.origin_address || '-'} {submittedSummary.destination_address || '-'} 이사 견적요청 접수가 완료되었습니다.</div>
            <div className="quote-completion-actions row gap wrap">
              <button type="button" onClick={restartGuestFlow}>새 견적 다시 작성</button>
              {guestMode ? <button type="button" className="ghost" onClick={() => navigate('/login')}>로그인 화면으로 이동</button> : <button type="button" className="ghost" onClick={() => { setSubmittedSummary(null); setMode(''); }}>견적 화면으로 돌아가기</button>}
            </div>
          </div>
        </section>}
      </>}

      {pageTab === 'list' && !isAdminUser && !guestMode && <section className="card quote-admin-list-card"><div className="muted">견적목록은 관리자/부관리자 계정에서 확인할 수 있습니다.</div></section>}

      {pageTab === 'list' && isAdminUser && <div className="quote-admin-layout">
        <section className="card quote-admin-list-card">
          <div className="between quote-list-toolbar">
            <div className="quote-list-tabs">
              <button type="button" className={listTypeTab === 'same_day' ? 'active' : ''} onClick={() => setListTypeTab('same_day')}>당일이사</button>
              <button type="button" className={listTypeTab === 'storage' ? 'active' : ''} onClick={() => setListTypeTab('storage')}>짐보관이사</button>
            </div>
            <button type="button" className="ghost small" onClick={loadAdminList} disabled={listLoading}>{listLoading ? '불러오는 중...' : '새로고침'}</button>
          </div>

          <div className="quote-list-table-wrapper">
            <table className="quote-list-table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allSelected} onChange={e => toggleSelectAll(e.target.checked)} /></th>
                  <th>즐겨찾기</th>
                  <th>견적양식작성시각</th>
                  <th>고객성함</th>
                  <th>이사희망날짜</th>
                  <th>출발지가구원</th>
                  <th>댓글수</th>
                  <th>메뉴</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdminItems.length === 0 ? <tr><td colSpan="8" className="quote-list-empty">접수된 견적이 없습니다.</td></tr> : filteredAdminItems.map(item => {
                  const payload = item.payload || {}
                  const isFavorite = favoriteIds.includes(item.id)
                  const isChecked = selectedIds.includes(item.id)
                  return <tr key={item.id} className={detailItem?.id === item.id ? 'active' : ''} onClick={() => openDetail(item.id)}>
                    <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={isChecked} onChange={() => toggleSelected(item.id)} /></td>
                    <td onClick={e => e.stopPropagation()}><button type="button" className={`quote-star-button ${isFavorite ? 'active' : ''}`} onClick={() => toggleFavorite(item.id)} aria-label="즐겨찾기">{isFavorite ? '★' : '☆'}</button></td>
                    <td>{String(item.created_at || '').replace('T', ' ').slice(0, 16) || '-'}</td>
                    <td>{item.requester_name || '-'}</td>
                    <td>{formatQuoteDesiredDate(item)}</td>
                    <td>{payload.household || '-'}</td>
                    <td>{Number(payload.comment_count || 0)}</td>
                    <td><button type="button" className="quote-menu-button" onClick={(e) => { e.stopPropagation(); openDetail(item.id) }}>⋮</button></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card quote-admin-detail-card">
          <div className="between"><h3>상세작성양식</h3>{detailLoading && <span className="muted">불러오는 중...</span>}</div>
          {!detailItem ? <div className="muted">목록에서 견적을 선택해 주세요.</div> : <div className="quote-admin-detail-body">
            <div className="inline-actions wrap end quote-detail-actions">
              <button type="button" className="small" onClick={() => loadOperationsPreview()} disabled={operationsLoading}>{operationsLoading ? '분석 중...' : 'AI견적미리보기'}</button>
              <button type="button" className="small ghost" onClick={() => downloadEstimateExcel()}>견적추출</button>
            </div>
            <div className="quote-detail-hero"><div><div className="quote-detail-title">{detailItem.summary_title || '-'}</div><div className="quote-detail-meta">접수유형: {detailItem.form_type === 'storage' ? '짐보관이사' : '당일이사'}</div><div className="quote-detail-meta">접수일: {String(detailItem.created_at || '').replace('T', ' ').slice(0, 16)}</div></div><div className="quote-detail-badges"><span>{detailItem.requester_name || '-'}</span><span>{detailItem.contact_phone || '-'}</span><span>{formatQuoteDesiredDate(detailItem)}</span></div></div>
            <div className="quote-detail-grid">
              <div className="quote-detail-section"><h4>기본 정보</h4><dl>{[
                ['고객 성함', adminDetailPayload.customer_name],
                [currentDesiredLabel, formatQuoteDesiredDate(detailItem)],
                ['출발지 거주 가구원', adminDetailPayload.household],
                ['출발지 구조', adminDetailPayload.structure],
                ['출발지 평수', adminDetailPayload.area],
                ['출발지 주소', [adminDetailPayload.origin_address, adminDetailPayload.origin_address_detail].filter(Boolean).join(' ')],
                ['출발지 엘레베이터', adminDetailPayload.origin_elevator],
                ['도착지 주소', [adminDetailPayload.destination_address, adminDetailPayload.destination_address_detail].filter(Boolean).join(' ')],
                ['도착지 엘레베이터', adminDetailPayload.destination_elevator],
                ['연락처', adminDetailPayload.contact_phone || detailItem.contact_phone],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
              <div className="quote-detail-section"><h4>세부 옵션</h4><dl>{[
                ['희망 이사 종류', joinQuoteValue(adminDetailPayload.move_types)],
                ['프리미엄 추가 옵션', joinQuoteValue(adminDetailPayload.premium_options)],
                ['가전/가구 종류', joinQuoteValue(adminDetailPayload.furniture_types)],
                ['추가 가전/가구', joinQuoteValue([adminDetailPayload.extra_furniture, adminDetailPayload.duplicate_furniture])],
                ['분해/조립 필요 가전/가구', joinQuoteValue(adminDetailPayload.disassembly_types)],
                ['추가 분해/조립', joinQuoteValue([adminDetailPayload.extra_disassembly, adminDetailPayload.duplicate_disassembly])],
                ['대형 가전/가구 / 폐기물', joinQuoteValue(adminDetailPayload.large_item_types)],
                ['대형 추가기재', joinQuoteValue([adminDetailPayload.extra_large_items, adminDetailPayload.duplicate_large_items])],
                ['폐기물 원스탑 신고 서비스 접수 희망', adminDetailPayload.waste_service],
                ['동승 희망 여부', adminDetailPayload.companion_preference],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
              <div className="quote-detail-section"><h4>경유지 / 메모</h4><dl>{[
                ['경유지 주소', joinQuoteValue([adminDetailPayload.via_address, adminDetailPayload.via_address_detail])],
                ['경유지 엘레베이터', adminDetailPayload.via_elevator],
                ['경유지 상차 물품', adminDetailPayload.via_pickup_items],
                ['경유지 하차 물품', adminDetailPayload.via_drop_items],
                ['추가 메모', adminDetailPayload.request_memo],
                ['원룸/투룸/소형이사 고지 확인', boolLabel(adminDetailPayload.move_scope_notice)],
                ['카카오톡 친구 추가 고지 확인', boolLabel(adminDetailPayload.kakao_notice)],
                ['개인정보 수집 이용 동의', boolLabel(adminDetailPayload.privacy_agreed)],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
            </div>
            {operationsPreview && <div className="quote-detail-grid">
              <div className="quote-detail-section"><h4>AI 견적 요약</h4><dl>{[
                ['예상 견적 범위', `${Number(operationsPreview.estimate?.estimated_low || 0).toLocaleString()}원 ~ ${Number(operationsPreview.estimate?.estimated_high || 0).toLocaleString()}원`],
                ['추천 인원', `${operationsPreview.estimate?.recommended_crew || 0}명`],
                ['추천 차량', `${operationsPreview.estimate?.recommended_vehicle_count || 0}대`],
                ['난이도', operationsPreview.estimate?.difficulty_grade],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl><div className="stack compact">{(operationsPreview.estimate?.explanation_lines || []).map((line, index) => <div key={`exp-${index}`} className="muted tiny-text">- {line}</div>)}</div></div>
              <div className="quote-detail-section"><h4>일정 충돌 분석</h4><dl>{[
                ['희망일', operationsPreview.schedule_analysis?.target_date],
                ['가용 차량 수', operationsPreview.schedule_analysis?.available_vehicle_count ?? '미등록'],
                ['기등록 차량 수', operationsPreview.schedule_analysis?.scheduled_vehicle_count ?? 0],
                ['판정', operationsPreview.schedule_analysis?.conflict_level],
                ['권장 조치', operationsPreview.schedule_analysis?.recommended_action],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
              <div className="quote-detail-section"><h4>CRM / 계약금 / 체크리스트</h4><dl>{[
                ['재방문 고객 후보', `${operationsPreview.crm_matches?.length || 0}건`],
                ['계약금 알림', operationsPreview.deposit_alert?.message],
                ['추천 체크리스트', operationsPreview.recommended_checklist?.name],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl>
                <div className="stack compact">
                  {(operationsPreview.crm_matches || []).slice(0, 3).map(item => <div key={`crm-${item.id}`} className="muted tiny-text">- {item.customer_name || '-'} / {item.desired_date || '-'} / {item.summary_title || '-'}</div>)}
                  {(operationsPreview.recommended_checklist?.items || []).slice(0, 5).map((item, index) => <div key={`cl-${index}`} className="muted tiny-text">- {item.label}</div>)}
                </div>
              </div>
            </div>}
          </div>}
        </section>
      </div>}
    </section>
  </div>
}



function joinQuoteValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value
}

function boolLabel(value) {
  return value ? '확인' : '-'
}

function QuoteDetailRow({ label, value }) {
  return <div className="quote-detail-row"><dt>{label}</dt><dd>{formatQuoteFieldValue(value)}</dd></div>
}

function PlaceholderFeaturePage({ title, description }) {
  return (
    <div className="stack-page">
      <section className="card">
        <h2>{title}</h2>
        <div className="muted">{description}</div>
      </section>
    </div>
  )
}

function MenuLockGuard({ user, children }) {
  const location = useLocation()
  const lockedItem = findLockedMenuItemByPath(location.pathname)
  if (lockedItem && isMenuLockedForUser(user, user?.permission_config?.menu_locks_json, lockedItem.id)) {
    return <AccessDeniedRedirect message={`현재 '${lockedItem.label}' 메뉴는 잠금 상태입니다.`} />
  }
  return children
}

function MenuPermissionPage() {
  const currentUser = getStoredUser()
  const isAdminUser = isAdministrator(currentUser)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [configForm, setConfigForm] = useState({
    total_vehicle_count: '',
    branch_count_override: '',
    admin_mode_access_grade: 2,
    role_assign_actor_max_grade: 3,
    role_assign_target_min_grade: 3,
    account_suspend_actor_max_grade: 3,
    account_suspend_target_min_grade: 3,
    signup_approve_actor_max_grade: 3,
    signup_approve_target_min_grade: 7,
    menu_permissions_json: '',
    menu_locks_json: '',
  })
  const [permissionMap, setPermissionMap] = useState(() => buildDefaultMenuPermissions())

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await api('/api/admin-mode')
        if (ignore) return
        const nextConfig = {
          total_vehicle_count: String(response.config?.total_vehicle_count || ''),
          branch_count_override: String(response.config?.branch_count_override || response.branch_count || ''),
          ...response.permission_config,
        }
        setConfigForm(nextConfig)
        setPermissionMap(normalizeMenuPermissions(nextConfig.menu_permissions_json))
      } catch (err) {
        if (!ignore) setError(err.message || '메뉴권한 정보를 불러오지 못했습니다.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    return () => { ignore = true }
  }, [])

  function togglePermission(entryKey, position) {
    setPermissionMap(prev => ({
      ...prev,
      [entryKey]: {
        ...(prev[entryKey] || {}),
        [position]: !(prev[entryKey]?.[position] ?? true),
      },
    }))
  }

  async function savePermissions() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const nextConfig = { ...configForm, menu_permissions_json: JSON.stringify(permissionMap) }
      await api('/api/admin-mode/config', { method: 'POST', body: JSON.stringify(nextConfig) })
      setConfigForm(nextConfig)
      const storedUser = getStoredUser()
      if (storedUser) {
        const nextUser = { ...storedUser, permission_config: { ...(storedUser.permission_config || {}), ...nextConfig } }
        sessionStorage.setItem('icj_user', JSON.stringify(nextUser))
        if (getRememberedLogin()) localStorage.setItem('icj_user', JSON.stringify(nextUser))
      }
      setMessage('메뉴권한 설정이 저장되었습니다.')
    } catch (err) {
      setError(err.message || '메뉴권한 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdminUser) return <AccessDeniedRedirect message="관리자만 메뉴권한을 변경할 수 있습니다." />
  if (loading) return <div className="card">메뉴권한 정보를 불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card">
        <div className="between admin-mode-section-head">
          <div>
            <h2>메뉴권한</h2>
            <div className="muted">카테고리와 개별 메뉴를 직급별로 노출/비노출 설정할 수 있습니다.</div>
          </div>
          <button type="button" className="small" onClick={savePermissions} disabled={saving}>{saving ? '저장중...' : '메뉴권한 저장'}</button>
        </div>
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}
        <div className="menu-permission-table-wrap">
          <table className="menu-permission-table">
            <thead>
              <tr>
                <th>메뉴</th>
                {POSITION_PERMISSION_OPTIONS.map(position => <th key={position}>{position}</th>)}
              </tr>
            </thead>
            <tbody>
              {MENU_PERMISSION_ITEMS.map(entry => (
                <tr key={entry.key} className={entry.type === 'section' ? 'menu-permission-section-row' : ''}>
                  <td><div className={entry.type === 'section' ? 'menu-permission-label section' : 'menu-permission-label item'}>{entry.label}</div></td>
                  {POSITION_PERMISSION_OPTIONS.map(position => (
                    <td key={`${entry.key}-${position}`}>
                      <label className="check center-check">
                        <input type="checkbox" checked={!!permissionMap?.[entry.key]?.[position]} onChange={() => togglePermission(entry.key, position)} />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}


const MEMO_PAD_ROWS = 10
const MEMO_PAD_COLS = 5

function memoPadStorageKey(userId) {
  return `icj_memo_pad_${userId || 'guest'}`
}

function createEmptyMemoPadGrid() {
  return Array.from({ length: MEMO_PAD_ROWS }, () => Array.from({ length: MEMO_PAD_COLS }, () => ''))
}

function normalizeMemoPadGrid(rawGrid) {
  const base = createEmptyMemoPadGrid()
  return base.map((row, rowIndex) => row.map((_, colIndex) => String(rawGrid?.[rowIndex]?.[colIndex] || '')))
}

function getMemoPadState(userId) {
  const fallback = { grid: createEmptyMemoPadGrid(), archive: [] }
  try {
    const raw = localStorage.getItem(memoPadStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const archive = Array.isArray(parsed?.archive) ? parsed.archive.map(item => ({
      id: String(item?.id || `memo-${Date.now()}`),
      row: Number(item?.row || 0),
      col: Number(item?.col || 0),
      title: String(item?.title || ''),
      content: String(item?.content || ''),
      updatedAt: String(item?.updatedAt || ''),
    })) : []
    return {
      grid: normalizeMemoPadGrid(parsed?.grid),
      archive,
    }
  } catch (_) {
    return fallback
  }
}

function saveMemoPadState(userId, nextState) {
  localStorage.setItem(memoPadStorageKey(userId), JSON.stringify({
    grid: normalizeMemoPadGrid(nextState?.grid),
    archive: Array.isArray(nextState?.archive) ? nextState.archive : [],
  }))
}

function buildMemoArchiveTitle(content, row, col) {
  const compact = String(content || '').replace(/\s+/g, ' ').trim()
  return compact.slice(0, 30) || `${row + 1}행 ${col + 1}열 메모`
}

function getLadderStorageUserKey() {
  try {
    const user = getStoredUser?.() || {}
    return String(user?.id || user?.username || user?.user_id || 'guest')
  } catch (_) {
    return 'guest'
  }
}

function ladderBranchStorageKey(userKey) {
  return `icj_ladder_branch_db_${userKey || 'guest'}`
}

function ladderTemplateStorageKey(userKey) {
  return `icj_ladder_template_${userKey || 'guest'}`
}

function ladderSavedListStorageKey(userKey) {
  return `icj_ladder_saved_list_${userKey || 'guest'}`
}

const LADDER_TEMPLATE_DEFAULT = [
  '★ {{date}} {{move_time}} {{customer_name}} ★',
  '※ 출발지 -> 도착지 이동소요시간 : {{travel_time}}',
  '',
  '{{date}} 예상 배차 말씀드립니다',
  '',
  'ㅇ 작업 : {{work}}',
  '',
  'ㅇ 주소 : {{addr}}',
  '',
  'ㅇ 층수 : {{floor}}',
  '',
  'ㅇ 작업 시간 : {{work_time}}',
  '',
  'ㅇ 이름 : {{branch_name}}',
  '',
  'ㅇ 연락처 : {{branch_phone}}',
  '',
  '{{cost_title}}{{cost}}',
].join('\n')

const LADDER_BRANCH_DB = {
  '1호점': { name: '임채영', phone: '010-6614-7795' },
  '2호점': { name: '박우민', phone: '010-2479-2742' },
  '3호점': { name: '장준영', phone: '010-4162-4429' },
  '4호점': { name: '송지훈', phone: '010-4037-1632' },
  '5호점': { name: '신백윤', phone: '010-6300-5512' },
  '6호점': { name: '심훈', phone: '010-9461-7299' },
  '7호점': { name: '손영재', phone: '010-2998-8344' },
  '8호점': { name: '최명권', phone: '010-4035-7378' },
  '9호점': { name: '정경호', phone: '010-2641-9701' },
  '10호점': { name: '백인환', phone: '010-7497-3060' },
  '11호점': { name: '황인준', phone: '010-8995-3372' },
  '본점': { name: '심진수', phone: '010-9441-6704' },
}
const LADDER_FLOOR_OPTIONS = ['선택해주세요', ...Array.from({ length: 24 }, (_, index) => `${index + 1}층`), '25층 이상']
const LADDER_METHOD_OPTIONS = ['1톤 1대', '1톤 2대', '가구만']
const LADDER_DEFAULTS = {
  date: '12월 22일',
  work: '2톤 이상 내리는 작업',
  addr: '서울 송파구 삼전로8길 4',
  floor: '3층',
  time: '10시~11시 예상',
  branch_name: '이청잘 2호점 박우민',
  phone: '010-2479-2742',
  cost: '120,000',
}
const LADDER_PRICE_MAP = (() => {
  const map = {}
  const cost1_5 = { '1톤 1대': 120000, '1톤 2대': 150000, '가구만': 70000 }
  const cost6_7 = { '1톤 1대': 130000, '1톤 2대': 160000, '가구만': 80000 }
  const cost8_9 = { '1톤 1대': 140000, '1톤 2대': 170000, '가구만': 90000 }
  const cost10_11 = { '1톤 1대': 150000, '1톤 2대': 180000, '가구만': 100000 }
  const cost12_13 = { '1톤 1대': 160000, '1톤 2대': 190000, '가구만': 110000 }
  for (let i = 1; i <= 5; i += 1) map[`${i}층`] = cost1_5
  for (let i = 6; i <= 7; i += 1) map[`${i}층`] = cost6_7
  for (let i = 8; i <= 9; i += 1) map[`${i}층`] = cost8_9
  for (let i = 10; i <= 11; i += 1) map[`${i}층`] = cost10_11
  for (let i = 12; i <= 13; i += 1) map[`${i}층`] = cost12_13
  map['14층'] = { '1톤 1대': 170000, '1톤 2대': 200000, '가구만': 120000 }
  map['15층'] = { '1톤 1대': 180000, '1톤 2대': 210000, '가구만': 130000 }
  map['16층'] = { '1톤 1대': 190000, '1톤 2대': 220000, '가구만': 140000 }
  map['17층'] = { '1톤 1대': 200000, '1톤 2대': 230000, '가구만': 150000 }
  map['18층'] = { '1톤 1대': 220000, '1톤 2대': 250000, '가구만': 160000 }
  map['19층'] = { '1톤 1대': 230000, '1톤 2대': 260000, '가구만': 170000 }
  map['20층'] = { '1톤 1대': 250000, '1톤 2대': 280000, '가구만': 180000 }
  map['21층'] = { '1톤 1대': 280000, '1톤 2대': 310000, '가구만': '협의' }
  map['22층'] = { '1톤 1대': 310000, '1톤 2대': 340000, '가구만': '협의' }
  map['23층'] = { '1톤 1대': 340000, '1톤 2대': 370000, '가구만': '협의' }
  map['24층'] = { '1톤 1대': 370000, '1톤 2대': 400000, '가구만': '협의' }
  map['25층 이상'] = { '1톤 1대': '협의', '1톤 2대': '협의', '가구만': '협의' }
  return map
})()

const LADDER_TEMPLATE_HELP_GROUPS = [
  {
    title: '윗줄 정보 넣기',
    items: [
      { label: '날짜', token: '{{date}}' },
      { label: '이사시간', token: '{{move_time}}' },
      { label: '고객명', token: '{{customer_name}}' },
      { label: '이동시간', token: '{{travel_time}}' },
    ],
  },
  {
    title: '상세 항목 넣기',
    items: [
      { label: '작업', token: '{{work}}' },
      { label: '주소', token: '{{addr}}' },
      { label: '층수', token: '{{floor}}' },
      { label: '작업시간', token: '{{work_time}}' },
    ],
  },
  {
    title: '담당 호점 정보 넣기',
    items: [
      { label: '이름', token: '{{branch_name}}' },
      { label: '연락처', token: '{{branch_phone}}' },
      { label: '금액 제목', token: '{{cost_title}}' },
      { label: '금액', token: '{{cost}}' },
    ],
  },
]

const LADDER_INFO_ROWS = [
  ['2~5층', '5m ~ 13m', '1톤', '저층 작업. QT 차량도 가능.'],
  ['6~8층', '15m ~ 21m', '1톤', '1톤 차량의 한계 높이.'],
  ['9층', '약 24m', '1톤 / 2.5톤', '1톤 맥심 인출 또는 2.5톤 안전 작업.'],
  ['10~12층', '26m ~ 32m', '2.5톤', '1톤 작업 불가.'],
  ['13~14층', '34m ~ 37m', '2.5톤 / 3.5톤', '2.5톤 최대치 또는 3.5톤 여유 작업.'],
  ['15~16층', '40m ~ 43m', '3.5톤', '3.5톤 주력 구간.'],
  ['17층', '약 45m', '3.5톤 / 5톤', '3.5톤 맥심 인출 또는 5톤 여유 작업.'],
  ['18~20층', '48m ~ 54m', '5톤', '대형 차량 필수 구간.'],
  ['21~24층', '56m ~ 65m', '5톤', '5톤 차량의 주력 구간.'],
  ['25층 이상', '68m ~ 70m', '5톤 (70m급)', '국내 사다리차 최대 한계권.'],
]


function cloneLadderBranchDb() {
  return Object.fromEntries(Object.entries(LADDER_BRANCH_DB).map(([key, value]) => [key, { ...value }]))
}

function readLadderBranchDb(userKey) {
  try {
    const raw = localStorage.getItem(ladderBranchStorageKey(userKey))
    if (!raw) return cloneLadderBranchDb()
    const parsed = JSON.parse(raw)
    const base = cloneLadderBranchDb()
    if (!parsed || typeof parsed !== 'object') return base
    Object.entries(parsed).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return
      base[key] = {
        name: String(value.name || base[key]?.name || ''),
        phone: String(value.phone || base[key]?.phone || ''),
      }
    })
    return base
  } catch (_) {
    return cloneLadderBranchDb()
  }
}

function saveLadderBranchDb(userKey, branchDb) {
  try {
    localStorage.setItem(ladderBranchStorageKey(userKey), JSON.stringify(branchDb))
  } catch (_) {}
}

function readLadderTemplate(userKey) {
  try {
    const raw = localStorage.getItem(ladderTemplateStorageKey(userKey))
    return String(raw || LADDER_TEMPLATE_DEFAULT).trim() || LADDER_TEMPLATE_DEFAULT
  } catch (_) {
    return LADDER_TEMPLATE_DEFAULT
  }
}

function saveLadderTemplate(userKey, template) {
  try {
    localStorage.setItem(ladderTemplateStorageKey(userKey), String(template || LADDER_TEMPLATE_DEFAULT))
  } catch (_) {}
}

function readLadderSavedList(userKey) {
  try {
    const raw = localStorage.getItem(ladderSavedListStorageKey(userKey))
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        id: String(item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        date: String(item.date || ''),
        moveTime: String(item.moveTime || ''),
        customerName: String(item.customerName || ''),
        branch: String(item.branch || ''),
        text: String(item.text || ''),
        createdAt: String(item.createdAt || ''),
      }))
  } catch (_) {
    return []
  }
}

function saveLadderSavedList(userKey, items) {
  try {
    localStorage.setItem(ladderSavedListStorageKey(userKey), JSON.stringify(Array.isArray(items) ? items : []))
  } catch (_) {}
}

function createEmptyLadderForm(overrides = {}) {
  return {
    date: '',
    branch: '',
    moveTime: '',
    customerName: '',
    travelTime: '',
    start: createLadderLocationState(),
    end: createLadderLocationState(),
    ...overrides,
  }
}

function formatLadderDateLabelFromIso(isoDate) {
  if (!isoDate) return ''
  const parts = String(isoDate).split('-')
  if (parts.length !== 3) return ''
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!month || !day) return ''
  return `${month}월 ${day}일`
}


function normalizeLadderMoveTime(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) return ''
  if (/^\d{4}$/.test(value)) {
    return `${value.slice(0, 2)}:${value.slice(2)}`
  }
  const colonMatch = value.match(/^(\d{1,2}):(\d{2})$/)
  if (colonMatch) {
    return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`
  }
  return value
}

function buildLadderTemplateOutput(template, values) {
  const source = String(template || LADDER_TEMPLATE_DEFAULT)
  return source.replace(/{{\s*([a-z_]+)\s*}}/gi, (_, key) => String(values?.[key] ?? ''))
}

function formatLadderDefaultDate() {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  return `${next.getMonth() + 1}월 ${next.getDate()}일`
}

function createLadderLocationState() {
  return { enabled: false, work: '', addr: '', method: '', floor: '', time: '' }
}

function calcLadderCost(enabled, method, floor) {
  if (!enabled || !LADDER_PRICE_MAP[floor]) return { value: 0, negotiable: false, selected: false }
  const price = LADDER_PRICE_MAP[floor]?.[method]
  if (typeof price === 'string') return { value: price, negotiable: true, selected: true }
  return { value: Number(price || 0), negotiable: false, selected: true }
}

function getLadderPreviewModel(form, options = {}) {
  const currentDateVal = form.date || formatLadderDefaultDate()
  const branchDb = options?.branchDb || LADDER_BRANCH_DB
  const template = options?.template || LADDER_TEMPLATE_DEFAULT
  const branchData = branchDb[form.branch] || branchDb['2호점'] || { name: '', phone: '' }
  const branchLabel = form.branch || '2호점'
  const branchNameFull = `이청잘 ${branchLabel} ${branchData.name}`.trim()
  const branchPhone = branchData.phone
  const moveTimeRaw = String(form.moveTime || '').trim()
  const customerNameRaw = String(form.customerName || '').trim()
  const travelTimeRaw = String(form.travelTime || '').trim()
  const moveTimeVal = normalizeLadderMoveTime(moveTimeRaw) || '00:00'
  const useStart = !!form.start.enabled
  const useEnd = !!form.end.enabled
  const locationSuffix = useStart && useEnd ? '(출발지/도착지)' : useStart ? '(출발지)' : useEnd ? '(도착지)' : ''
  const customerNameVal = `${customerNameRaw || '홍길동'}${locationSuffix}`
  const travelTimeVal = travelTimeRaw || '0시간 00분'

  const sectionResult = (startVal, endVal, defaultVal) => {
    const startRaw = String(startVal || '').trim()
    const endRaw = String(endVal || '').trim()
    const startText = startRaw || defaultVal
    const endText = endRaw || defaultVal
    if (!useStart && !useEnd) return { text: defaultVal, isDefault: true }
    if (useStart && useEnd) {
      return {
        text: `
 * 출발지 : ${startText}
 * 도착지 : ${endText}`,
        isDefault: !startRaw && !endRaw,
      }
    }
    return useStart
      ? { text: startText, isDefault: !startRaw }
      : { text: endText, isDefault: !endRaw }
  }

  const floorResult = () => {
    const startSelected = !!form.start.floor && form.start.floor !== '선택해주세요'
    const endSelected = !!form.end.floor && form.end.floor !== '선택해주세요'
    const startFloor = startSelected ? form.start.floor : '미정'
    const endFloor = endSelected ? form.end.floor : '미정'
    if (!useStart && !useEnd) return { text: LADDER_DEFAULTS.floor, isDefault: true }
    if (useStart && useEnd) {
      return {
        text: `
 * 출발지 : ${startFloor}
 * 도착지 : ${endFloor}`,
        isDefault: !startSelected && !endSelected,
      }
    }
    return useStart
      ? { text: startFloor, isDefault: !startSelected }
      : { text: endFloor, isDefault: !endSelected }
  }

  const startCost = calcLadderCost(useStart, form.start.method, form.start.floor)
  const endCost = calcLadderCost(useEnd, form.end.method, form.end.floor)
  let costTitle = 'ㅇ 금액 : '
  let txtCost = LADDER_DEFAULTS.cost
  let costIsDefault = true
  if (useStart && useEnd) {
    costTitle = 'ㅇ 총금액 : '
    const total = (!startCost.negotiable && !endCost.negotiable)
      ? `${(Number(startCost.value || 0) + Number(endCost.value || 0)).toLocaleString()}`
      : '협의'
    txtCost = `${total}
  * 출발지 : ${startCost.negotiable ? '협의' : Number(startCost.value || 0).toLocaleString()}
  * 도착지 : ${endCost.negotiable ? '협의' : Number(endCost.value || 0).toLocaleString()}`
    costIsDefault = !startCost.selected && !endCost.selected
  } else if (useStart || useEnd) {
    const finalCost = useStart ? startCost : endCost
    txtCost = finalCost.negotiable ? '협의' : Number(finalCost.value || 0).toLocaleString()
    costIsDefault = !finalCost.selected
  }

  const workResult = sectionResult(form.start.work, form.end.work, LADDER_DEFAULTS.work)
  const addrResult = sectionResult(form.start.addr, form.end.addr, LADDER_DEFAULTS.addr)
  const floorResultValue = floorResult()
  const workTimeResult = sectionResult(form.start.time, form.end.time, LADDER_DEFAULTS.time)

  const values = {
    date: currentDateVal,
    move_time: moveTimeVal,
    customer_name: customerNameVal,
    travel_time: travelTimeVal,
    work: workResult.text,
    addr: addrResult.text,
    floor: floorResultValue.text,
    work_time: workTimeResult.text,
    branch_name: branchNameFull,
    branch_phone: branchPhone,
    cost_title: costTitle,
    cost: txtCost,
    branch: branchLabel,
  }

  const tokenStates = {
    date: !form.date,
    move_time: !moveTimeRaw,
    customer_name: !customerNameRaw,
    travel_time: !travelTimeRaw,
    work: workResult.isDefault,
    addr: addrResult.isDefault,
    floor: floorResultValue.isDefault,
    work_time: workTimeResult.isDefault,
    branch_name: !form.branch,
    branch_phone: !form.branch,
    cost_title: costIsDefault,
    cost: costIsDefault,
    branch: !form.branch,
  }

  let text = buildLadderTemplateOutput(template, values).replace(/\n{3,}/g, '\n\n').trim()
  if (options?.chatName === '사다리차 배차방') {
    const rawLines = text.split('\n')
    let removed = 0
    text = rawLines.filter(line => {
      if (removed < 2 && line.trim()) {
        removed += 1
        return false
      }
      return true
    }).join('\n').trimStart()
  }

  return { text, values, tokenStates, template }
}

function buildLadderPreviewNodes(template, values, tokenStates) {
  const source = String(template || LADDER_TEMPLATE_DEFAULT)
  const parts = []
  const regex = /{{\s*([a-z_]+)\s*}}/gi
  let lastIndex = 0
  let match
  let keyIndex = 0
  while ((match = regex.exec(source)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: source.slice(lastIndex, match.index), key: `text-${keyIndex}-${lastIndex}` })
    }
    const tokenKey = String(match[1] || '').toLowerCase()
    parts.push({
      type: 'token',
      tokenKey,
      text: String(values?.[tokenKey] ?? ''),
      isDefault: !!tokenStates?.[tokenKey],
      key: `token-${tokenKey}-${keyIndex}`,
    })
    lastIndex = regex.lastIndex
    keyIndex += 1
  }
  if (lastIndex < source.length) {
    parts.push({ type: 'text', text: source.slice(lastIndex), key: `text-tail-${lastIndex}` })
  }
  return parts
}

function buildLadderMessage(form, options = {}) {
  return getLadderPreviewModel(form, options).text
}

async function writeClipboardText(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (_) {}
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    return true
  } catch (_) {
    return false
  }
}

function LadderDispatchPage() {
  const userKey = useMemo(() => getLadderStorageUserKey(), [])
  const datePickerRef = useRef(null)
  const [branchDb, setBranchDb] = useState(() => readLadderBranchDb(userKey))
  const [templateText, setTemplateText] = useState(() => readLadderTemplate(userKey))
  const [form, setForm] = useState(() => createEmptyLadderForm({ date: formatLadderDefaultDate() }))
  const [copiedTarget, setCopiedTarget] = useState('')
  const [savedList, setSavedList] = useState(() => readLadderSavedList(userKey))
  const [savedListOpen, setSavedListOpen] = useState(false)
  const [savedSelections, setSavedSelections] = useState({})
  const [branchEditMenuOpen, setBranchEditMenuOpen] = useState(false)
  const [templateEditMenuOpen, setTemplateEditMenuOpen] = useState(false)
  const [branchEditorOpen, setBranchEditorOpen] = useState(false)
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const branchNames = useMemo(() => Object.keys(branchDb), [branchDb])
  const [branchEditorForm, setBranchEditorForm] = useState({ branch: '1호점', name: '', phone: '' })
  const [templateDraft, setTemplateDraft] = useState(templateText)
  const [travelTimeStatus, setTravelTimeStatus] = useState({ state: 'idle', message: '' })

  useEffect(() => {
    saveLadderBranchDb(userKey, branchDb)
  }, [branchDb, userKey])

  useEffect(() => {
    saveLadderTemplate(userKey, templateText)
  }, [templateText, userKey])

  useEffect(() => {
    saveLadderSavedList(userKey, savedList)
  }, [savedList, userKey])

  useEffect(() => {
    if (!branchNames.length) return
    setBranchEditorForm(prev => {
      const selected = prev.branch && branchDb[prev.branch] ? prev.branch : branchNames[0]
      const data = branchDb[selected] || { name: '', phone: '' }
      return { branch: selected, name: data.name || '', phone: data.phone || '' }
    })
  }, [branchDb, branchNames])
  useEffect(() => {
    const startAddress = String(form.start?.addr || '').trim()
    const endAddress = String(form.end?.addr || '').trim()
    if (!startAddress || !endAddress) {
      setTravelTimeStatus(prev => prev.state === 'idle' && !prev.message ? prev : { state: 'idle', message: '' })
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        setTravelTimeStatus({ state: 'loading', message: '이동시간 계산중...' })
        const response = await api(`/api/travel-time?start_address=${encodeURIComponent(startAddress)}&end_address=${encodeURIComponent(endAddress)}`, { icjCache: { skip: true } })
        const nextTravelTime = String(response?.duration_text || '').trim()
        if (nextTravelTime) {
          setForm(prev => prev.travelTime === nextTravelTime ? prev : { ...prev, travelTime: nextTravelTime })
        }
        const provider = response?.provider === 'kakao' ? '카카오맵' : response?.provider === 'naver' ? '네이버지도' : '예상치'
        const approximate = response?.approximate ? ' · 추정값' : ''
        setTravelTimeStatus({ state: 'done', message: `${provider} 기준 ${nextTravelTime || '-'}${approximate}` })
      } catch (error) {
        setTravelTimeStatus({ state: 'error', message: error instanceof Error ? error.message : '이동시간 계산에 실패했습니다.' })
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [form.start?.addr, form.end?.addr])

  const previewModel = useMemo(() => getLadderPreviewModel(form, { branchDb, template: templateText }), [branchDb, form, templateText])
  const messagePreview = previewModel.text
  const previewNodes = useMemo(() => buildLadderPreviewNodes(templateText, previewModel.values, previewModel.tokenStates), [previewModel.tokenStates, previewModel.values, templateText])

  function updateTopField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function updateLocation(section, key, value) {
    setForm(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }))
  }

  function openDatePicker() {
    const input = datePickerRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') input.showPicker()
    else {
      input.focus()
      input.click()
    }
  }

  function openBranchEditor() {
    const selected = form.branch || branchNames[0] || '1호점'
    const data = branchDb[selected] || { name: '', phone: '' }
    setBranchEditMenuOpen(false)
    setBranchEditorForm({ branch: selected, name: data.name || '', phone: data.phone || '' })
    setBranchEditorOpen(true)
  }

  function changeBranchEditorBranch(nextBranch) {
    const data = branchDb[nextBranch] || { name: '', phone: '' }
    setBranchEditorForm({ branch: nextBranch, name: data.name || '', phone: data.phone || '' })
  }

  function saveBranchEditor() {
    setBranchDb(prev => ({
      ...prev,
      [branchEditorForm.branch]: {
        name: String(branchEditorForm.name || '').trim(),
        phone: String(branchEditorForm.phone || '').trim(),
      },
    }))
    setBranchEditorOpen(false)
  }

  function openTemplateEditor() {
    setTemplateEditMenuOpen(false)
    setTemplateDraft(templateText)
    setTemplateEditorOpen(true)
  }

  function saveTemplateEditor() {
    setTemplateText(String(templateDraft || '').trim() || LADDER_TEMPLATE_DEFAULT)
    setTemplateEditorOpen(false)
  }

  async function copyMessage(chatName) {
    const text = buildLadderMessage(form, { chatName, branchDb, template: templateText })
    const ok = await writeClipboardText(text)
    if (ok) {
      setCopiedTarget(chatName)
      window.setTimeout(() => setCopiedTarget(''), 1600)
    } else {
      window.alert('클립보드 복사에 실패했습니다. 브라우저 권한을 확인해주세요.')
    }
  }

  function resetLadderForm() {
    if (!window.confirm('기본정보, 출발지정보, 도착지정보를 모두 초기화하시겠습니까?')) return
    setForm(prev => createEmptyLadderForm({ date: prev.date || '' }))
    setCopiedTarget('')
  }

  function saveCurrentLadderMessage() {
    const text = buildLadderMessage(form, { branchDb, template: templateText })
    const item = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: String(form.date || '').trim(),
      moveTime: normalizeLadderMoveTime(form.moveTime) || '',
      customerName: String(form.customerName || '').trim(),
      branch: String(form.branch || '').trim(),
      text,
      createdAt: new Date().toISOString(),
    }
    setSavedList(prev => [item, ...prev])
    setCopiedTarget('저장완료')
    window.setTimeout(() => setCopiedTarget(''), 1600)
  }

  function toggleSavedSelection(id, checked) {
    setSavedSelections(prev => ({ ...prev, [id]: checked }))
  }

  function deleteSelectedSavedItems() {
    const ids = Object.entries(savedSelections).filter(([, checked]) => checked).map(([id]) => id)
    if (!ids.length) {
      window.alert('삭제할 저장목록을 선택해주세요.')
      return
    }
    if (!window.confirm('선택한 저장목록을 삭제하시겠습니까?')) return
    const idSet = new Set(ids)
    setSavedList(prev => prev.filter(item => !idSet.has(item.id)))
    setSavedSelections({})
  }

  async function copySavedItemText(item) {
    const ok = await writeClipboardText(String(item?.text || ''))
    if (ok) {
      setCopiedTarget('저장목록 복사완료')
      window.setTimeout(() => setCopiedTarget(''), 1600)
    } else {
      window.alert('클립보드 복사에 실패했습니다. 브라우저 권한을 확인해주세요.')
    }
  }

  return (
    <div className="stack-page ladder-dispatch-page">
      <section className="card">
        <div className="between ladder-dispatch-head">
          <div />
          <div className="inline-actions wrap end ladder-top-actions">
            <button type="button" className="small" onClick={resetLadderForm}>초기화</button>
            <button type="button" className="small" onClick={() => setSavedListOpen(true)}>저장목록</button>
            <button type="button" className="small" onClick={saveCurrentLadderMessage}>저장</button>
          </div>
        </div>
        {copiedTarget && <div className="success ladder-copy-notice">{copiedTarget}용 문구를 클립보드에 복사했습니다.</div>}
        <div className="ladder-dispatch-layout">
          <div className="ladder-main-columns">
            <div className="ladder-preview-panel card inset-card">
              <div className="between ladder-panel-header">
                <div className="form-section-title ladder-panel-title">신청 양식 내용</div>
                <div className="ladder-edit-wrap">
                  <button type="button" className="small" onClick={() => setTemplateEditMenuOpen(prev => !prev)}>편집</button>
                  {templateEditMenuOpen && (
                    <div className="ladder-edit-menu">
                      <button type="button" onClick={openTemplateEditor}>기본양식편집</button>
                    </div>
                  )}
                </div>
              </div>
              <pre
                className="ladder-preview-textarea"
                onClick={() => copyMessage('신청 양식 내용')}
                title="클릭하면 전체 신청 양식 내용이 복사됩니다"
              >{previewNodes.map(part => part.type === 'token' ? <span key={part.key} className={part.isDefault ? 'ladder-token-default' : 'ladder-token-filled'}>{part.text}</span> : <span key={part.key}>{part.text}</span>)}</pre>
            </div>
            <div className="ladder-form-panel">
              <section className="card inset-card ladder-form-card">
                <div className="between ladder-panel-header">
                  <div className="form-section-title ladder-panel-title">기본정보</div>
                  <div className="ladder-edit-wrap">
                    <button type="button" className="small" onClick={() => setBranchEditMenuOpen(prev => !prev)}>편집</button>
                    {branchEditMenuOpen && (
                      <div className="ladder-edit-menu">
                        <button type="button" onClick={openBranchEditor}>호점정보변경</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="ladder-basic-grid">
                  <button type="button" className={`ladder-picker-button ${form.date ? 'filled' : ''}`} onClick={openDatePicker}>{form.date || '날짜선택'}</button>
                  <input ref={datePickerRef} className="ladder-hidden-date-input" type="date" onChange={e => updateTopField('date', formatLadderDateLabelFromIso(e.target.value))} />
                  <select value={form.branch} onChange={e => updateTopField('branch', e.target.value)}>
                    <option value="">호점선택</option>
                    {branchNames.map(item => {
                      const branchInfo = branchDb[item] || { name: '' }
                      const branchOptionLabel = branchInfo.name ? `${item}(${branchInfo.name})` : item
                      return <option key={item} value={item}>{branchOptionLabel}</option>
                    })}
                  </select>
                  <input type="text" value={form.moveTime} onChange={e => updateTopField('moveTime', e.target.value)} placeholder="이사시간 ex) 10:00" />
                  <input type="text" value={form.customerName} onChange={e => updateTopField('customerName', e.target.value)} placeholder="고객명 ex) 홍길동" />
                  <div className="ladder-travel-time-field">
                    <input type="text" value={form.travelTime} onChange={e => updateTopField('travelTime', e.target.value)} placeholder="이동시간 ex) 1시간 23분" />
                    {travelTimeStatus.message && <div className={`ladder-travel-time-hint ${travelTimeStatus.state}`}>{travelTimeStatus.message}</div>}
                  </div>
                </div>
              </section>
              {['start', 'end'].map(section => {
                const title = section === 'start' ? '출발지정보' : '도착지정보'
                const data = form[section]
                return (
                  <section key={section} className="card inset-card ladder-form-card">
                    <div className="between ladder-section-heading">
                      <div className="form-section-title ladder-panel-title">{title}</div>
                      <label className="check ladder-check-head"><input type="checkbox" checked={data.enabled} onChange={e => updateLocation(section, 'enabled', e.target.checked)} /> 사용</label>
                    </div>
                    <div className="ladder-location-grid">
                      <input className="ladder-span-3" type="text" value={data.work} onChange={e => updateLocation(section, 'work', e.target.value)} placeholder="작업 ex) 2톤 이상 내리는 작업" />
                      <textarea className="ladder-span-3 ladder-address-input" value={data.addr} onChange={e => updateLocation(section, 'addr', e.target.value)} placeholder={"주소 ex) 경기도 안양시 동안구 달안로 78\n609동 407호 (샛별한양아파트)"} rows={2} />
                      <select value={data.method} onChange={e => updateLocation(section, 'method', e.target.value)}>
                        <option value="">방법선택</option>
                        {LADDER_METHOD_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <select value={data.floor} onChange={e => updateLocation(section, 'floor', e.target.value)}>
                        <option value="">층수선택</option>
                        {LADDER_FLOOR_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <input type="text" value={data.time} onChange={e => updateLocation(section, 'time', e.target.value)} placeholder="작업시간 ex) 10시~11시 예상" />
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
          <div className="ladder-bottom-section">
            <div className="form-section-title ladder-bottom-title">사다리차 종류 / 길이 / 층수 정보</div>
            <div className="ladder-info-grid">
              <div className="card inset-card ladder-info-card">
                <strong>가격 기준</strong>
                <div className="muted small-text">층수와 방법 조합에 따라 금액이 자동 계산됩니다. 21층 이상 또는 일부 가구만 작업은 협의로 표시됩니다.</div>
              </div>
              <div className="card inset-card ladder-info-card">
                <strong>전송 안내</strong>
                <div className="muted small-text">PC와 모바일 모두 동일한 화면 구조로 사용하고, 채팅방별 전송 문구를 즉시 복사하도록 구성했습니다.</div>
              </div>
            </div>
            <div className="table-scroll ladder-table-wrap">
              <table className="form-table ladder-info-table">
                <thead><tr><th>층수</th><th>실제 높이(약)</th><th>권장 차량(제원)</th><th>비고</th></tr></thead>
                <tbody>
                  {LADDER_INFO_ROWS.map(row => <tr key={row[0]}>{row.map(cell => <td key={`${row[0]}-${cell}`}>{cell}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {savedListOpen && createPortal(
        <div className="modal-overlay" onClick={() => setSavedListOpen(false)}>
          <div className="modal-card ladder-modal-card ladder-saved-modal" onClick={e => e.stopPropagation()}>
            <div className="ladder-saved-header-row">
              <button type="button" className="small" onClick={() => setSavedListOpen(false)}>←</button>
              <strong>저장목록</strong>
              <button type="button" className="small" onClick={deleteSelectedSavedItems}>삭제</button>
            </div>
            <div className="ladder-saved-list">
              {savedList.length ? savedList.map(item => (
                <div key={item.id} className="ladder-saved-item-row">
                  <label className="ladder-saved-check"><input type="checkbox" checked={!!savedSelections[item.id]} onChange={e => toggleSavedSelection(item.id, e.target.checked)} /></label>
                  <button type="button" className="ladder-saved-item-button" onClick={() => copySavedItemText(item)}>
                    <span>{item.date || '-'}</span>
                    <span>{item.moveTime || '-'}</span>
                    <span>{item.customerName || '-'}</span>
                    <span>{item.branch || '-'}</span>
                  </button>
                </div>
              )) : <div className="muted small-text">저장된 목록이 없습니다.</div>}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {branchEditorOpen && createPortal(
        <div className="modal-overlay" onClick={() => setBranchEditorOpen(false)}>
          <div className="modal-card ladder-modal-card" onClick={e => e.stopPropagation()}>
            <div className="between"><strong>호점정보변경</strong><button type="button" className="small" onClick={() => setBranchEditorOpen(false)}>닫기</button></div>
            <div className="ladder-modal-grid">
              <select value={branchEditorForm.branch} onChange={e => changeBranchEditorBranch(e.target.value)}>
                {branchNames.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
              <input type="text" value={branchEditorForm.name} onChange={e => setBranchEditorForm(prev => ({ ...prev, name: e.target.value }))} placeholder="이름 입력" />
              <input type="text" value={branchEditorForm.phone} onChange={e => setBranchEditorForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="연락처 입력" />
            </div>
            <div className="inline-actions end"><button type="button" className="small" onClick={saveBranchEditor}>저장</button></div>
          </div>
        </div>,
        document.body,
      )}

      {templateEditorOpen && createPortal(
        <div className="modal-overlay" onClick={() => setTemplateEditorOpen(false)}>
          <div className="modal-card ladder-modal-card ladder-template-modal" onClick={e => e.stopPropagation()}>
            <div className="between"><strong>기본양식편집</strong><button type="button" className="small" onClick={() => setTemplateEditorOpen(false)}>닫기</button></div>
            <div className="muted small-text ladder-token-help">아래 한글 버튼을 눌러 필요한 항목을 쉽게 넣을 수 있습니다. 줄바꿈은 엔터로 입력하면 됩니다.</div>
            <div className="ladder-token-groups">
              {LADDER_TEMPLATE_HELP_GROUPS.map(group => (
                <div key={group.title} className="ladder-token-group">
                  <div className="ladder-token-group-title">{group.title}</div>
                  <div className="ladder-token-button-row">
                    {group.items.map(item => (
                      <button key={item.token} type="button" className="small ghost ladder-token-button" onClick={() => insertTemplateToken(item.token)}>{item.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <textarea className="ladder-template-editor" value={templateDraft} onChange={e => setTemplateDraft(e.target.value)} placeholder="예시)
★ {{date}} {{move_time}} {{customer_name}} ★
ㅇ 작업 : {{work}}" />
            <div className="inline-actions between wrap">
              <button type="button" className="small" onClick={() => setTemplateDraft(LADDER_TEMPLATE_DEFAULT)}>기본값 복원</button>
              <button type="button" className="small" onClick={saveTemplateEditor}>저장</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function MemoPadPage({ user }) {
  const [memoState, setMemoState] = useState(() => getMemoPadState(user?.id))
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [selectedArchiveIds, setSelectedArchiveIds] = useState([])
  const [editingArchiveItem, setEditingArchiveItem] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [rowColEditorOpen, setRowColEditorOpen] = useState(false)
  const [mergedMemoOpen, setMergedMemoOpen] = useState(false)

  useEffect(() => {
    setMemoState(getMemoPadState(user?.id))
    setArchiveOpen(false)
    setSelectedArchiveIds([])
    setEditingArchiveItem(null)
  }, [user?.id])

  const updateMemoState = useCallback((updater) => {
    setMemoState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveMemoPadState(user?.id, next)
      return next
    })
  }, [user?.id])

  function updateCell(rowIndex, colIndex, value) {
    updateMemoState(prev => {
      const nextGrid = prev.grid.map((row, index) => index === rowIndex ? row.map((cell, cellIndex) => cellIndex === colIndex ? value : cell) : row)
      return { ...prev, grid: nextGrid }
    })
  }

  function archiveCell(rowIndex, colIndex) {
    const content = String(memoState.grid?.[rowIndex]?.[colIndex] || '').trim()
    if (!content) {
      window.alert('내용이 있는 메모만 보관함에 저장할 수 있습니다.')
      return
    }
    const entryId = `memo-${Date.now()}-${rowIndex}-${colIndex}`
    updateMemoState(prev => ({
      ...prev,
      archive: [{
        id: entryId,
        row: rowIndex,
        col: colIndex,
        title: buildMemoArchiveTitle(content, rowIndex, colIndex),
        content,
        updatedAt: new Date().toISOString(),
      }, ...prev.archive],
    }))
    setArchiveOpen(true)
  }

  function toggleArchiveSelect(id, checked) {
    setSelectedArchiveIds(prev => checked ? [...new Set([...prev, id])] : prev.filter(item => item !== id))
  }

  function deleteSelectedArchive() {
    if (selectedArchiveIds.length === 0) {
      window.alert('삭제할 메모를 선택해 주세요.')
      return
    }
    updateMemoState(prev => ({ ...prev, archive: prev.archive.filter(item => !selectedArchiveIds.includes(item.id)) }))
    setSelectedArchiveIds([])
  }

  function saveArchiveEdit() {
    if (!editingArchiveItem) return
    const nextContent = String(editingArchiveItem.content || '')
    updateMemoState(prev => ({
      ...prev,
      archive: prev.archive.map(item => item.id === editingArchiveItem.id ? {
        ...item,
        title: buildMemoArchiveTitle(nextContent, item.row, item.col),
        content: nextContent,
        updatedAt: new Date().toISOString(),
      } : item),
    }))
    setEditingArchiveItem(null)
  }

  const mergedMemoEntries = useMemo(() => {
    const gridEntries = []
    ;(memoState.grid || []).forEach((row, rowIndex) => {
      ;(row || []).forEach((value, colIndex) => {
        const content = String(value || '').trim()
        if (!content) return
        gridEntries.push({
          id: `grid-${rowIndex}-${colIndex}`,
          source: 'grid',
          title: buildMemoArchiveTitle(content, rowIndex, colIndex),
          content,
          meta: `${rowIndex + 1}행 ${colIndex + 1}열`,
        })
      })
    })
    const archiveEntries = (memoState.archive || []).map(item => ({
      id: `archive-${item.id}`,
      source: 'archive',
      title: item.title || buildMemoArchiveTitle(item.content, item.row, item.col),
      content: String(item.content || ''),
      meta: `보관함 · ${item.row + 1}행 ${item.col + 1}열`,
    }))
    return [...gridEntries, ...archiveEntries]
  }, [memoState])

  return (
    <div className="stack-page memo-pad-page">
      <section className="card memo-pad-card-fixed">
        <div className="between memo-pad-head">
          <div>
            <h2>메모장</h2>
          </div>
          <div className="inline-actions wrap end memo-pad-head-actions">
            <button type="button" className="small" onClick={() => setArchiveOpen(true)}>보관함</button>
            <div className="dropdown-wrap memo-settings-wrap">
              <button type="button" className="small ghost" onClick={() => { setSettingsOpen(v => !v); setAdminMenuOpen(false) }}>설정</button>
              {settingsOpen && (
                <div className="dropdown-menu right open-inline-menu memo-settings-menu">
                  <button type="button" className="dropdown-item" onClick={() => setAdminMenuOpen(v => !v)}>메모관리자용</button>
                  {adminMenuOpen && (
                    <div className="memo-settings-submenu">
                      <button type="button" className="dropdown-item" onClick={() => { setRowColEditorOpen(true); setSettingsOpen(false); setAdminMenuOpen(false) }}>행열편집</button>
                      <button type="button" className="dropdown-item" onClick={() => { setMergedMemoOpen(true); setSettingsOpen(false); setAdminMenuOpen(false) }}>통합메모장</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="memo-pad-grid">
          {memoState.grid.map((row, rowIndex) => row.map((value, colIndex) => (
            <div key={`memo-cell-${rowIndex}-${colIndex}`} className="memo-pad-cell">
              <div className="memo-pad-cell-toolbar">
                <button type="button" className="memo-archive-button" onClick={() => archiveCell(rowIndex, colIndex)} aria-label="보관함에 저장">보관함</button>
              </div>
              <textarea
                value={value}
                onChange={event => updateCell(rowIndex, colIndex, event.target.value)}
                placeholder={`${rowIndex + 1}-${colIndex + 1}`}
              />
            </div>
          )))}
        </div>
      </section>

      {archiveOpen && (
        <div className="modal-backdrop" onClick={() => setArchiveOpen(false)}>
          <div className="modal-card memo-archive-modal" onClick={event => event.stopPropagation()}>
            <div className="between align-center">
              <div>
                <strong>보관함</strong>
                <div className="muted tiny-text">클릭하면 상세 편집창이 열립니다.</div>
              </div>
              <div className="inline-actions wrap end">
                <button type="button" className="small ghost" onClick={deleteSelectedArchive}>선택삭제</button>
                <button type="button" className="small ghost" onClick={() => setArchiveOpen(false)}>닫기</button>
              </div>
            </div>
            <div className="stack compact memo-archive-list">
              {memoState.archive.map(item => (
                <label key={item.id} className="memo-archive-row">
                  <input type="checkbox" checked={selectedArchiveIds.includes(item.id)} onChange={event => toggleArchiveSelect(item.id, event.target.checked)} onClick={event => event.stopPropagation()} />
                  <button type="button" className="memo-archive-open" onClick={() => setEditingArchiveItem({ ...item })}>
                    <span className="memo-archive-title">{item.title}</span>
                    <span className="memo-archive-meta">{item.row + 1}행 {item.col + 1}열</span>
                  </button>
                </label>
              ))}
              {memoState.archive.length === 0 && <div className="muted">보관된 메모가 없습니다.</div>}
            </div>
          </div>
        </div>
      )}

      {editingArchiveItem && (
        <div className="modal-backdrop" onClick={() => setEditingArchiveItem(null)}>
          <div className="modal-card memo-archive-editor" onClick={event => event.stopPropagation()}>
            <div className="between align-center">
              <strong>메모 상세 편집</strong>
              <div className="inline-actions wrap end">
                <button type="button" className="small ghost" onClick={() => setEditingArchiveItem(null)}>닫기</button>
                <button type="button" className="small" onClick={saveArchiveEdit}>저장</button>
              </div>
            </div>
            <div className="muted tiny-text">원본 위치: {editingArchiveItem.row + 1}행 {editingArchiveItem.col + 1}열</div>
            <textarea className="memo-archive-editor-textarea" value={editingArchiveItem.content} onChange={event => setEditingArchiveItem(prev => ({ ...prev, content: event.target.value }))} />
          </div>
        </div>
      )}

      {rowColEditorOpen && (
        <div className="modal-backdrop" onClick={() => setRowColEditorOpen(false)}>
          <div className="modal-card memo-admin-modal" onClick={event => event.stopPropagation()}>
            <div className="between align-center">
              <strong>행열편집</strong>
              <button type="button" className="small ghost" onClick={() => setRowColEditorOpen(false)}>닫기</button>
            </div>
            <div className="stack compact">
              <div className="memo-admin-grid-preview">
                <div>행 수: {MEMO_PAD_ROWS}</div>
                <div>열 수: {MEMO_PAD_COLS}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mergedMemoOpen && (
        <div className="modal-backdrop" onClick={() => setMergedMemoOpen(false)}>
          <div className="modal-card memo-admin-modal" onClick={event => event.stopPropagation()}>
            <div className="between align-center">
              <strong>통합메모장</strong>
              <button type="button" className="small ghost" onClick={() => setMergedMemoOpen(false)}>닫기</button>
            </div>
            <div className="stack compact memo-archive-list memo-integrated-list">
              {mergedMemoEntries.map(item => (
                <div key={item.id} className="memo-integrated-row">
                  <div className="memo-archive-title">{item.title}</div>
                  <div className="memo-archive-meta">{item.meta}</div>
                  <div className="memo-integrated-content">{item.content}</div>
                </div>
              ))}
              {mergedMemoEntries.length === 0 && <div className="muted">표시할 메모가 없습니다.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildAppSearchEntries(user, policyMap = {}) {
  const policyEntries = []
  Object.entries(POLICY_CONTENT_DEFAULTS).forEach(([categoryId, targets]) => {
    const categoryLabel = POLICY_CATEGORY_OPTIONS.find(item => item.id === categoryId)?.label || categoryId
    Object.entries(targets || {}).forEach(([targetId, config]) => {
      if (!config?.allowed?.(user)) return
      const key = `${categoryId}:${targetId}`
      const content = String(policyMap[key] ?? config.defaultContent ?? '')
      policyEntries.push({
        id: `policy-${key}`,
        category: '규정',
        type: '전환',
        title: `${categoryLabel} 규정 · ${config.label}`,
        description: `상단바 -> 메뉴 -> 규정 -> ${categoryLabel} -> ${config.label}`,
        path: '/policies',
        keywords: [categoryLabel, '규정', config.label, content].join(' '),
      })
    })
  })

  const staticEntries = [
    { id: 'home', category: '메뉴', type: '전환', title: '홈', description: '하단바 -> 홈', path: '/', keywords: '홈 메인' },
    { id: 'schedule', category: '메뉴', type: '전환', title: '일정', description: '하단바 -> 일정', path: '/schedule', keywords: '일정 스케줄 캘린더' },
    { id: 'work-schedule', category: '메뉴', type: '전환', title: '스케줄', description: '하단바 -> 스케줄', path: '/work-schedule', keywords: '스케줄 근무 일정' },
    { id: 'notifications', category: '메뉴', type: '전환', title: '알림', description: '상단바 -> 알림', path: '/notifications', keywords: '알림 공지' },
    { id: 'settings', category: '메뉴', type: '전환', title: '설정', description: '상단바 -> 설정', path: '/settings', keywords: '설정 테마' },
    { id: 'materials', category: '공용', type: '전환', title: '자재구매/현황', description: '상단바 -> 메뉴 -> 공용 -> 자재구매/현황', path: '/materials', keywords: '자재 구매 신청현황 신청목록 자재입고 구매결산 현재고' },
    { id: 'warehouse', category: '공용', type: '전환', title: '창고현황', description: '상단바 -> 메뉴 -> 공용 -> 창고현황', path: '/warehouse', keywords: '창고 현황' },
    { id: 'quotes', category: '공용', type: '전환', title: '견적', description: '상단바 -> 메뉴 -> 공용 -> 견적', path: '/quotes', keywords: '견적 이사견적' },
    { id: 'policies', category: '공용', type: '전환', title: '규정', description: '상단바 -> 메뉴 -> 공용 -> 규정', path: '/policies', keywords: '규정 휴가 복지 스케줄' },
    { id: 'work-shift-schedule', category: '공용', type: '전환', title: '근무스케줄', description: '상단바 -> 메뉴 -> 공용 -> 근무스케줄', path: '/work-shift-schedule', keywords: '근무스케줄 사업자 직원' },
    { id: 'disposal-forms', category: '본사용', type: '전환', title: '폐기양식', description: '상단바 -> 메뉴 -> 본사용 -> 폐기 -> 양식', path: '/disposal/forms', keywords: '폐기양식 폐기 신고' },
    { id: 'disposal-list', category: '본사용', type: '전환', title: '폐기목록', description: '상단바 -> 메뉴 -> 본사용 -> 폐기 -> 목록', path: '/disposal/list', keywords: '폐기목록 폐기 결산진행 입금' },
    { id: 'disposal-settlements', category: '본사용', type: '전환', title: '폐기결산', description: '상단바 -> 메뉴 -> 본사용 -> 폐기 -> 결산', path: '/disposal/settlements', keywords: '폐기결산 결산' },
    { id: 'memo-pad', category: '본사용', type: '전환', title: '메모장', description: '상단바 -> 메뉴 -> 본사용 -> 메모장', path: '/memo-pad', keywords: '메모장 보관함 자동저장' },
    { id: 'admin', category: '관리자모드', type: '전환', title: '관리자모드', description: '상단바 -> 설정 -> 관리자모드', path: '/admin-mode', keywords: '관리자모드 계정관리 운영현황' },
    { id: 'menu-permissions', category: '관리자모드', type: '전환', title: '메뉴권한', description: '상단바 -> 메뉴 -> 관리자모드 -> 메뉴권한', path: '/menu-permissions', keywords: '메뉴권한' },
  ]

  return [...staticEntries, ...policyEntries]
}

function AppSearchPage({ user }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  const [policyMap, setPolicyMap] = useState({})

  useEffect(() => {
    let ignore = false
    api('/api/policies-content')
      .then(result => {
        if (ignore) return
        setPolicyMap(result?.contents && typeof result.contents === 'object' ? result.contents : {})
      })
      .catch(() => {
        if (!ignore) setPolicyMap({})
      })
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    const current = searchParams.get('q') || ''
    if (current !== query) {
      const next = new URLSearchParams(searchParams)
      if (query.trim()) next.set('q', query)
      else next.delete('q')
      setSearchParams(next, { replace: true })
    }
  }, [query])

  useEffect(() => {
    const current = searchParams.get('q') || ''
    if (current !== query) setQuery(current)
  }, [searchParams])

  const allEntries = useMemo(() => buildAppSearchEntries(user, policyMap), [user, policyMap])
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = useMemo(() => {
    if (!normalizedQuery) return allEntries
    return allEntries.filter(item => [item.title, item.description, item.keywords, item.category, item.type].join(' ').toLowerCase().includes(normalizedQuery))
  }, [allEntries, normalizedQuery])

  const grouped = useMemo(() => {
    return filteredEntries.reduce((acc, item) => {
      const key = item.category || '기타'
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    }, {})
  }, [filteredEntries])

  return (
    <div className="stack-page app-search-page">
      <section className="card app-search-input-card">
        <div className="app-search-input-wrap">
          <SearchIcon className="topbar-icon-svg app-search-inline-icon" />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="메뉴, 규정, 기능명 검색"
            className="app-search-main-input"
          />
        </div>
      </section>

      <section className="card app-search-results-card">
        <div className="between align-center">
          <h2>검색 결과</h2>
          <div className="muted">{filteredEntries.length}건</div>
        </div>
        {!normalizedQuery ? <div className="muted">검색어를 입력하면 앱 내 이동 가능한 기능과 규정 내용을 함께 보여줍니다.</div> : null}
        {normalizedQuery && !filteredEntries.length ? <div className="muted">검색 결과가 없습니다.</div> : null}
        <div className="app-search-group-list">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="app-search-group-block">
              <div className="app-search-group-title">{group}</div>
              <div className="app-search-result-list">
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="app-search-result-item"
                    onClick={() => navigate(item.path)}
                  >
                    <div className="app-search-result-head">
                      <strong>{getNotificationDisplayParts(item).title || item.title}</strong>
                      <span>{item.type}</span>
                    </div>
                    <div className="app-search-result-desc">{item.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function PoliciesPage() {
  const user = getStoredUser()
  const canEdit = Number(user?.grade || 9) <= 2
  const [category, setCategory] = useState('vacation')
  const [selectedPolicy, setSelectedPolicy] = useState('business')
  const [policyMap, setPolicyMap] = useState({})
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordChecking, setPasswordChecking] = useState(false)

  const categoryMap = POLICY_CONTENT_DEFAULTS[category] || {}
  const policyEntries = Object.entries(categoryMap).map(([id, item]) => ({ id, ...item }))
  const currentPolicy = policyEntries.find(item => item.id === selectedPolicy) || policyEntries[0] || null
  const currentKey = currentPolicy ? `${category}:${currentPolicy.id}` : ''
  const currentContent = currentKey ? String(policyMap[currentKey] ?? currentPolicy?.defaultContent ?? '') : ''

  useEffect(() => {
    let ignore = false
    setLoading(true)
    api('/api/policies-content')
      .then(result => {
        if (ignore) return
        const nextMap = result?.contents && typeof result.contents === 'object' ? result.contents : {}
        setPolicyMap(nextMap)
      })
      .catch(() => {
        if (!ignore) setPolicyMap({})
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    const nextEntries = Object.entries(POLICY_CONTENT_DEFAULTS[category] || {}).map(([id, item]) => ({ id, ...item }))
    const current = nextEntries.find(item => item.id === selectedPolicy)
    if (!current || !current.allowed(user)) {
      const nextAllowed = nextEntries.find(item => item.allowed(user)) || nextEntries[0]
      if (nextAllowed && nextAllowed.id !== selectedPolicy) setSelectedPolicy(nextAllowed.id)
    }
  }, [category, selectedPolicy, user])

  useEffect(() => {
    setDraft(currentContent)
    setMessage('')
    setEditMode(false)
    setPasswordPromptOpen(false)
    setPasswordInput('')
  }, [currentContent, currentKey])

  async function handleEditUnlock() {
    if (!currentPolicy || !canEdit) return
    if (!passwordInput.trim()) {
      setMessage('비밀번호를 입력해 주세요.')
      return
    }
    setPasswordChecking(true)
    setMessage('')
    try {
      await api('/api/auth/verify-password', {
        method: 'POST',
        body: JSON.stringify({ password: passwordInput }),
      })
      setEditMode(true)
      setPasswordPromptOpen(false)
      setPasswordInput('')
      setMessage('편집 모드가 활성화되었습니다.')
    } catch (error) {
      setMessage(error.message || '비밀번호 확인에 실패했습니다.')
    } finally {
      setPasswordChecking(false)
    }
  }

  async function handleSave() {
    if (!currentPolicy || !canEdit || !editMode) return
    setSaving(true)
    setMessage('')
    try {
      const result = await api('/api/policies-content', {
        method: 'POST',
        body: JSON.stringify({ data: { category, target: currentPolicy.id, content: draft } }),
      })
      const nextMap = result?.contents && typeof result.contents === 'object' ? result.contents : {}
      setPolicyMap(nextMap)
      setEditMode(false)
      setMessage('저장되었습니다.')
    } catch (error) {
      setMessage(error.message || '저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack settings-page-shell">
      <section className="card settings-category-card">
        <div className="settings-category-row settings-category-row-top" role="tablist" aria-label="규정 카테고리">
          {POLICY_CATEGORY_OPTIONS.map(item => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card settings-theme-card">
        <div className="quick-check-grid quick-check-grid-16 policy-grid">
          {policyEntries.map(item => {
            const allowed = item.allowed(user)
            return (
              <button
                key={item.id}
                type="button"
                className={`quick-check-card ${selectedPolicy === item.id ? 'policy-card-active' : ''}`.trim()}
                onClick={() => allowed && setSelectedPolicy(item.id)}
                disabled={!allowed}
                title={allowed ? `${item.label} 규정 보기` : '현재 계정으로는 볼 수 없습니다.'}
              >
                <strong>{item.label}</strong>
                <span>{allowed ? '규정 보기' : '권한 없음'}</span>
              </button>
            )
          })}
        </div>

        {loading ? <div className="muted">불러오는 중...</div> : null}
        {!loading && currentPolicy?.allowed(user) ? (
          <div className="stack compact">
            <div className="list-item block">
              <strong>{currentPolicy.label} {POLICY_CATEGORY_OPTIONS.find(item => item.id === category)?.label || '규정'}</strong>
              {canEdit ? (
                <div className="stack compact policy-editor-wrap">
                  {!editMode ? (
                    <>
                      <div className="policy-content-prewrap">{currentContent}</div>
                      <div className="row gap policy-editor-actions">
                        <button type="button" className="primary" onClick={() => { setPasswordPromptOpen(prev => !prev); setMessage('') }}>편집</button>
                        {message ? <span className="muted">{message}</span> : null}
                      </div>
                      {passwordPromptOpen ? (
                        <div className="policy-password-gate">
                          <label className="stack compact-gap">
                            <span>현재 접속 중인 계정 비밀번호</span>
                            <input type="password" value={passwordInput} onChange={event => setPasswordInput(event.target.value)} placeholder="비밀번호 입력" autoComplete="current-password" />
                          </label>
                          <div className="row gap policy-editor-actions">
                            <button type="button" className="primary" onClick={handleEditUnlock} disabled={passwordChecking}>{passwordChecking ? '확인중...' : '편집 진행'}</button>
                            <button type="button" className="ghost" onClick={() => { setPasswordPromptOpen(false); setPasswordInput('') }}>취소</button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <textarea
                        className="input policy-editor-textarea"
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        rows={18}
                        placeholder="규정 내용을 입력해 주세요."
                      />
                      <div className="row gap policy-editor-actions">
                        <button type="button" className="primary" onClick={handleSave} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
                        <button type="button" className="ghost" onClick={() => { setDraft(currentContent); setEditMode(false); setMessage('') }}>취소</button>
                        {message ? <span className="muted">{message}</span> : null}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="policy-content-prewrap">{currentContent}</div>
              )}
            </div>
          </div>
        ) : null}
        {!loading && currentPolicy && !currentPolicy.allowed(user) ? <div className="error">현재 계정은 해당 규정을 볼 수 없습니다.</div> : null}
      </section>
    </div>
  )
}


function daysInMonthFromParts(year, month) {
  return new Date(year, month, 0).getDate()
}

function workShiftStorageKey(sectionId, year, month) {
  return `icj_work_shift_schedule_${sectionId}_${year}-${String(month).padStart(2, '0')}`
}

function cloneWorkShiftRows(rows = []) {
  return rows.map(row => ({ ...row, days: Array.isArray(row.days) ? [...row.days] : [], summary: Array.isArray(row.summary) ? [...row.summary] : [] }))
}

function computeWorkShiftSummary(days = []) {
  const normalized = days.map(value => String(value || '').trim())
  const count = target => normalized.filter(value => value === target).length
  const oneCount = count('1')
  const twoCount = count('2')
  const jangCount = count('장')
  const vacationCount = count('휴')
  const monthlyCount = count('월') > 0 ? 1 : 0
  const annualCount = count('연')
  const sickCount = count('병')
  const reserveCount = count('예')
  const etcCount = count('기')
  const inputTotal = oneCount + twoCount + jangCount
  const weighted = oneCount + (twoCount * 2) + jangCount
  const total = weighted + monthlyCount + annualCount + sickCount + reserveCount + etcCount
  return [String(inputTotal), String(oneCount), String(twoCount), String(jangCount), String(weighted), String(vacationCount), String(monthlyCount), String(annualCount), String(sickCount), String(reserveCount), String(etcCount), String(total)]
}

function workShiftLogStorageKey(sectionId, year, month) {
  return `icj_work_shift_schedule_log_${sectionId}_${year}-${String(month).padStart(2, '0')}`
}

function parseStoredWorkShiftRows(sectionId, year, month, fallbackRows = []) {
  if (typeof window === 'undefined') return cloneWorkShiftRows(fallbackRows)
  try {
    const raw = window.localStorage.getItem(workShiftStorageKey(sectionId, year, month))
    if (!raw) return cloneWorkShiftRows(fallbackRows)
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.rows)) {
      return cloneWorkShiftRows(parsed.rows)
    }
    return cloneWorkShiftRows(fallbackRows)
  } catch (_) {
    return cloneWorkShiftRows(fallbackRows)
  }
}

function buildYearlyWorkShiftSummary(sectionId, year, selectedRow, fallbackRows = []) {
  if (!selectedRow) {
    return {
      totalAnnualCount: 0,
      totalMonthlyLeaveCount: 0,
      quarterlyAnnualCounts: [0, 0, 0, 0],
    }
  }

  const targetGroup = String(selectedRow.c1 || '').trim()
  const targetName = String(selectedRow.c2 || '').trim()
  const quarterlyAnnualCounts = [0, 0, 0, 0]
  let totalAnnualCount = 0
  let totalMonthlyLeaveCount = 0

  for (let targetMonth = 1; targetMonth <= 12; targetMonth += 1) {
    const monthRows = parseStoredWorkShiftRows(sectionId, year, targetMonth, fallbackRows)
    const matchedRow = monthRows.find(row => {
      const rowName = String(row?.c2 || '').trim()
      const rowGroup = String(row?.c1 || '').trim()
      return rowName === targetName && rowGroup === targetGroup
    })
    if (!matchedRow) continue

    const normalizedDays = (matchedRow.days || []).map(value => String(value || '').trim())
    const annualCount = normalizedDays.filter(value => value === '연').length
    const monthlyCount = normalizedDays.some(value => value === '월') ? 1 : 0
    totalAnnualCount += annualCount
    totalMonthlyLeaveCount += monthlyCount
    quarterlyAnnualCounts[Math.floor((targetMonth - 1) / 3)] += annualCount
  }

  return {
    totalAnnualCount,
    totalMonthlyLeaveCount,
    quarterlyAnnualCounts,
  }
}

function createWorkShiftLogEntry({ userName, sectionLabel, cellLabel, beforeValue, afterValue }) {
  const stamp = new Date().toLocaleString('ko-KR')
  return {
    changedAt: stamp,
    accountName: userName || '알수없음',
    sectionLabel: sectionLabel || '-',
    cellLabel: cellLabel || '-',
    changeText: `${beforeValue || ''} -> ${afterValue || ''}`,
  }
}

function workShiftVacationStorageKey() {
  return 'icj_work_shift_vacation_requests'
}

function loadWorkShiftVacationRequests() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(workShiftVacationStorageKey())
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function saveWorkShiftVacationRequests(items) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(workShiftVacationStorageKey(), JSON.stringify(Array.isArray(items) ? items : []))
  } catch (_) {}
}

function canEditWorkShiftSchedule(user) {
  const grade = Number(user?.grade || 6)
  const positionTitle = String(user?.position_title || '').trim()
  return grade <= 2 || positionTitle === '부팀장'
}

function canEditCalendarSchedule(user) {
  const grade = Number(user?.grade || 9)
  const positionTitle = String(user?.position_title || '').trim()
  const allowedTitles = new Set(['대표', '부대표', '호점대표', '팀장', '부팀장', '본부장', '상담실장', '상담팀장', '상담사원'])
  return grade <= 2 || allowedTitles.has(positionTitle)
}

function canEditScheduleAssignments(user) {
  const grade = Number(user?.grade || 9)
  const positionTitle = String(user?.position_title || '').trim()
  const allowedTitles = new Set(['대표', '부대표', '호점대표', '팀장', '부팀장', '본부장', '상담실장', '상담팀장', '상담사원'])
  return grade <= 2 || allowedTitles.has(positionTitle)
}

function canSubmitWorkShiftVacation(user) {
  const grade = Number(user?.grade || 9)
  return grade >= 1 && grade <= 5
}

function resolveWorkShiftVacationSection(positionTitle) {
  const title = String(positionTitle || '').trim()
  if (['대표', '부대표', '호점대표'].includes(title)) return 'business'
  if (['팀장', '부팀장', '직원'].includes(title)) return 'field'
  if (['본부장', '상담실장', '상담팀장', '상담사원'].includes(title)) return 'hq'
  return 'field'
}

function getWorkShiftVacationSectionOptions() {
  return [
    { id: 'business', label: '사업자' },
    { id: 'field', label: '현장직원' },
    { id: 'hq', label: '본사직원' },
  ]
}

function toSpreadsheetColumnLabel(index) {
  let current = Number(index) + 1
  if (!Number.isFinite(current) || current <= 0) return ''
  let result = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    current = Math.floor((current - 1) / 26)
  }
  return result
}

function WorkShiftSchedulePage() {
  const isMobile = useIsMobile()
  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  const sectionOptions = [
    { id: 'business', label: '사업자' },
    { id: 'staff', label: '직원' },
  ]
  const vacationSectionOptions = getWorkShiftVacationSectionOptions()
  const [sectionId, setSectionId] = useState('business')
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [editNamesMode, setEditNamesMode] = useState(false)
  const [selectedRowKey, setSelectedRowKey] = useState('')
  const [activeCellKey, setActiveCellKey] = useState('')
  const template = WORK_SHIFT_TEMPLATE[sectionId] || WORK_SHIFT_TEMPLATE.business
  const [rows, setRows] = useState(() => cloneWorkShiftRows(template.rows || []))
  const dayCount = daysInMonthFromParts(year, month)
  const cellRefs = useRef({})
  const tableWrapRef = useRef(null)
  const dragStateRef = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false, suppressClick: false })
  const currentUser = getStoredUser()
  const currentUserName = String(currentUser?.name || currentUser?.nickname || currentUser?.email || '알수없음').trim()
  const [logOpen, setLogOpen] = useState(false)
  const [changeLogs, setChangeLogs] = useState([])
  const [workMode, setWorkMode] = useState('view')
  const canEditSchedule = canEditWorkShiftSchedule(currentUser)
  const canRequestVacation = canSubmitWorkShiftVacation(currentUser)
  const [vacationRequests, setVacationRequests] = useState(() => loadWorkShiftVacationRequests())
  const defaultVacationSectionId = resolveWorkShiftVacationSection(currentUser?.position_title)
  const [vacationForm, setVacationForm] = useState(() => ({
    sectionId: defaultVacationSectionId,
    requestType: '연차',
    startDate: '',
    endDate: '',
    reason: '',
    branchLabel: String(currentUser?.branch_no || '').trim(),
    applicantName: String(currentUser?.name || currentUser?.nickname || '').trim(),
  }))

  useEffect(() => {
    const templateSection = WORK_SHIFT_TEMPLATE[sectionId] || WORK_SHIFT_TEMPLATE.business
    const key = workShiftStorageKey(sectionId, year, month)
    let nextRows = cloneWorkShiftRows(templateSection.rows || [])
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.rows)) {
          nextRows = cloneWorkShiftRows(parsed.rows)
        }
      }
    } catch (_) {}
    nextRows = nextRows.map(row => ({ ...row, summary: computeWorkShiftSummary(row.days) }))
    setRows(nextRows)
    setSelectedRowKey(prev => prev || String(nextRows[0]?.row || nextRows[0]?.c2 || ''))
    setActiveCellKey('')
    cellRefs.current = {}
    try {
      const rawLogs = localStorage.getItem(workShiftLogStorageKey(sectionId, year, month))
      const parsedLogs = rawLogs ? JSON.parse(rawLogs) : []
      setChangeLogs(Array.isArray(parsedLogs) ? parsedLogs : [])
    } catch (_) {
      setChangeLogs([])
    }
  }, [sectionId, year, month])

  useEffect(() => {
    const key = workShiftStorageKey(sectionId, year, month)
    try {
      localStorage.setItem(key, JSON.stringify({ rows }))
    } catch (_) {}
  }, [rows, sectionId, year, month])

  useEffect(() => {
    const key = workShiftLogStorageKey(sectionId, year, month)
    try {
      localStorage.setItem(key, JSON.stringify(changeLogs))
    } catch (_) {}
  }, [changeLogs, sectionId, year, month])

  useEffect(() => {
    saveWorkShiftVacationRequests(vacationRequests)
  }, [vacationRequests])

  useEffect(() => {
    const resolvedSectionId = resolveWorkShiftVacationSection(currentUser?.position_title)
    setVacationForm(prev => ({
      ...prev,
      sectionId: resolvedSectionId,
      branchLabel: prev.branchLabel || String(currentUser?.branch_no || '').trim(),
      applicantName: prev.applicantName || String(currentUser?.name || currentUser?.nickname || '').trim(),
    }))
  }, [currentUser?.branch_no, currentUser?.name, currentUser?.nickname, currentUser?.position_title])

  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
  const yearOptions = Array.from({ length: 7 }, (_, index) => currentYear - 2 + index)
  const dayLabels = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1
    return day <= dayCount ? `${day}일` : ''
  })
  const tableColumnLabels = useMemo(() => {
    const totalColumns = 2 + 31 + ((template.summary || []).length)
    return Array.from({ length: totalColumns }, (_, index) => toSpreadsheetColumnLabel(index))
  }, [template.summary])

  function getCellKey(rowIndex, columnIndex) {
    return `${rowIndex}-${columnIndex}`
  }

  function isActiveCell(rowIndex, columnIndex) {
    return activeCellKey === getCellKey(rowIndex, columnIndex)
  }

  function appendChangeLog(cellLabel, beforeValue, afterValue) {
    if (String(beforeValue || '') === String(afterValue || '')) return
    const sectionLabel = (sectionOptions.find(option => option.id === sectionId)?.label) || '-'
    const entry = createWorkShiftLogEntry({
      userName: currentUserName,
      sectionLabel,
      cellLabel,
      beforeValue: String(beforeValue || ''),
      afterValue: String(afterValue || ''),
    })
    setChangeLogs(prev => [entry, ...prev].slice(0, 500))
  }

  function updateCell(rowIndex, dayIndex, value) {
    if (!editNamesMode || !canEditSchedule) return
    const nextValue = String(value || '').trim().slice(0, 2)
    const row = rows[rowIndex] || {}
    const beforeValue = String(row.days?.[dayIndex] || '')
    if (beforeValue === nextValue) return
    appendChangeLog(`${dayIndex + 3}열${rowIndex + 1}행`, beforeValue, nextValue)
    setRows(prev => prev.map((row, index) => {
      if (index !== rowIndex) return row
      const nextDays = [...row.days]
      nextDays[dayIndex] = nextValue
      return { ...row, days: nextDays, summary: computeWorkShiftSummary(nextDays) }
    }))
  }

  function updateRowName(rowIndex, value) {
    if (!editNamesMode || !canEditSchedule) return
    const beforeValue = String(rows[rowIndex]?.c2 || '')
    if (beforeValue === value) return
    appendChangeLog(`2열${rowIndex + 1}행`, beforeValue, value)
    setRows(prev => prev.map((row, index) => (index === rowIndex ? { ...row, c2: value } : row)))
  }

  function updateRowBranch(rowIndex, value) {
    if (!editNamesMode || !canEditSchedule) return
    const beforeValue = String(rows[rowIndex]?.c1 || '')
    if (beforeValue === value) return
    appendChangeLog(`1열${rowIndex + 1}행`, beforeValue, value)
    setRows(prev => prev.map((row, index) => (index === rowIndex ? { ...row, c1: value } : row)))
  }

  function addScheduleRow() {
    if (!canEditSchedule) return
    setRows(prev => {
      const nextRowNumber = prev.reduce((max, row) => Math.max(max, Number(row?.row || 0) || 0), 0) + 1
      const nextRow = {
        row: nextRowNumber,
        c1: '',
        c2: '',
        days: Array.from({ length: 31 }, () => ''),
        summary: computeWorkShiftSummary(Array.from({ length: 31 }, () => '')),
      }
      appendChangeLog(`1열${prev.length + 1}행`, '', '신규 행 추가')
      return [...prev, nextRow]
    })
  }

  function clearChangeLogs() {
    if (!window.confirm('편집기록을 모두 삭제할까요?')) return
    setChangeLogs([])
  }

  function registerCellRef(rowIndex, columnIndex, node) {
    if (!node) {
      delete cellRefs.current[`${rowIndex}-${columnIndex}`]
      return
    }
    cellRefs.current[`${rowIndex}-${columnIndex}`] = node
  }

  function focusCell(rowIndex, columnIndex) {
    const node = cellRefs.current[`${rowIndex}-${columnIndex}`]
    if (!node || node.disabled) return false
    node.focus()
    if (typeof node.select === 'function') {
      try { node.select() } catch (_) {}
    }
    return true
  }

  function moveFocus(rowIndex, columnIndex, key) {
    const maxRow = rows.length - 1
    const maxColumn = 32
    let nextRow = rowIndex
    let nextColumn = columnIndex
    if (key === 'ArrowLeft') nextColumn = Math.max(0, columnIndex - 1)
    if (key === 'ArrowRight') nextColumn = Math.min(maxColumn, columnIndex + 1)
    if (key === 'ArrowUp') nextRow = Math.max(0, rowIndex - 1)
    if (key === 'ArrowDown') nextRow = Math.min(maxRow, rowIndex + 1)
    if (nextRow === rowIndex && nextColumn === columnIndex) return

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const row = rows[nextRow]
      if (nextColumn > 1 && nextColumn - 1 >= dayCount + 1) {
        nextColumn = 0
      }
      if (nextColumn > 1 && !row) return
    }

    if (nextColumn > 1) {
      let guard = 0
      while (nextColumn > dayCount + 1 && guard < 31) {
        nextColumn += key === 'ArrowLeft' ? -1 : 1
        guard += 1
      }
      if (nextColumn > dayCount + 1 || nextColumn < 0) return
    }
    focusCell(nextRow, nextColumn)
  }

  function handleTablePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (editNamesMode && target?.closest('input, textarea, select, button, a, label')) return
    const wrapNode = tableWrapRef.current
    if (!wrapNode) return
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: wrapNode.scrollLeft,
      scrollTop: wrapNode.scrollTop,
      moved: false,
      suppressClick: false,
    }
    wrapNode.classList.add('is-dragging')
  }

  function handleTablePointerMove(event) {
    const wrapNode = tableWrapRef.current
    const drag = dragStateRef.current
    if (!wrapNode || !drag.active) return
    if (typeof event.buttons === 'number' && event.buttons === 0) {
      handleTablePointerUp()
      return
    }
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.moved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
      drag.moved = true
      drag.suppressClick = true
      if (document.activeElement instanceof HTMLElement && wrapNode.contains(document.activeElement)) {
        document.activeElement.blur()
      }
    }
    if (!drag.moved) return
    event.preventDefault()
    wrapNode.scrollLeft = drag.scrollLeft - deltaX
    wrapNode.scrollTop = drag.scrollTop - deltaY
  }

  function handleTablePointerUp() {
    const wrapNode = tableWrapRef.current
    const suppressClick = Boolean(dragStateRef.current?.suppressClick)
    dragStateRef.current = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false, suppressClick: false }
    wrapNode?.classList.remove('is-dragging')
    if (suppressClick) {
      window.setTimeout(() => {
        dragStateRef.current.suppressClick = false
      }, 0)
    }
  }

  useEffect(() => {
    function handleWindowPointerMove(event) {
      handleTablePointerMove(event)
    }

    function handleWindowPointerUp() {
      handleTablePointerUp()
    }

    function handleWindowBlur() {
      handleTablePointerUp()
    }

    function handleDocumentPointerLeave(event) {
      if (!event.relatedTarget) handleTablePointerUp()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('mouseleave', handleDocumentPointerLeave)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('mouseleave', handleDocumentPointerLeave)
    }
  }, [])

  const selectedRow = useMemo(() => rows.find(row => String(row.row || row.c2 || '') === String(selectedRowKey || '')) || rows[0] || null, [rows, selectedRowKey])
  const visibleVacationRequests = useMemo(() => {
    const myName = String(currentUser?.name || currentUser?.nickname || '').trim()
    const myEmail = String(currentUser?.email || '').trim()
    const items = Array.isArray(vacationRequests) ? [...vacationRequests] : []
    const filtered = canEditSchedule
      ? items
      : items.filter(item => String(item.applicantName || '').trim() === myName || String(item.email || '').trim() === myEmail)
    return filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  }, [vacationRequests, currentUser, canEditSchedule])

  function submitVacationRequest(event) {
    event.preventDefault()
    if (!canRequestVacation) {
      window.alert('현재 계정은 휴가신청 권한이 없습니다.')
      return
    }
    const applicantName = String(vacationForm.applicantName || currentUser?.name || currentUser?.nickname || '').trim()
    const startDate = String(vacationForm.startDate || '').trim()
    const endDate = String(vacationForm.endDate || '').trim()
    if (!applicantName || !startDate || !endDate) {
      window.alert('성명, 시작일, 종료일을 입력해주세요.')
      return
    }
    if (endDate < startDate) {
      window.alert('종료일은 시작일보다 빠를 수 없습니다.')
      return
    }
    const createdAt = new Date().toISOString()
    const payload = {
      id: `${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      createdAtLabel: new Date(createdAt).toLocaleString('ko-KR'),
      grade: Number(currentUser?.grade || 6),
      gradeLabel: gradeLabel(currentUser?.grade),
      positionTitle: String(currentUser?.position_title || '').trim(),
      email: String(currentUser?.email || '').trim(),
      sectionId: vacationForm.sectionId || defaultVacationSectionId,
      sectionLabel: (vacationSectionOptions.find(option => option.id === (vacationForm.sectionId || defaultVacationSectionId))?.label) || '사업자',
      requestType: String(vacationForm.requestType || '연차').trim(),
      startDate,
      endDate,
      reason: String(vacationForm.reason || '').trim(),
      branchLabel: String(vacationForm.branchLabel || currentUser?.branch_no || '').trim(),
      applicantName,
      status: '신청완료',
    }
    setVacationRequests(prev => [payload, ...prev])
    setVacationForm(prev => ({
      ...prev,
      requestType: '연차',
      startDate: '',
      endDate: '',
      reason: '',
      applicantName,
      branchLabel: String(prev.branchLabel || currentUser?.branch_no || '').trim(),
      sectionId: defaultVacationSectionId,
    }))
    window.alert('휴가신청이 접수되었습니다.')
  }

  const selectedSummary = useMemo(() => {
    if (!selectedRow) return null
    const normalized = (selectedRow.days || []).map(value => String(value || '').trim())
    const count = target => normalized.filter(value => value === target).length
    const vacationItems = [
      ['휴무', count('휴')],
      ['월차', count('월')],
      ['연차', count('연')],
      ['병가', count('병')],
      ['예비군', count('예')],
      ['기타', count('기')],
    ].filter(([, value]) => value > 0)
    const totalJobs = count('1') + count('2') + count('장')
    const yearlySummary = buildYearlyWorkShiftSummary(sectionId, year, selectedRow, template.rows || [])
    return {
      personName: String(selectedRow.c2 || '').trim() || '-',
      groupLabel: String(selectedRow.c1 || '').trim() || '-',
      oneCount: count('1'),
      twoCount: count('2'),
      totalJobs,
      longDistanceCount: count('장'),
      hasLongDistance: count('장') > 0,
      vacationItems,
      totalAnnualCount: yearlySummary.totalAnnualCount,
      totalMonthlyLeaveCount: yearlySummary.totalMonthlyLeaveCount,
      quarterlyAnnualCounts: yearlySummary.quarterlyAnnualCounts,
      monthlyAnnualCount: count('연'),
      monthlyMonthlyLeaveCount: count('월') > 0 ? 1 : 0,
      detailText: vacationItems.length ? vacationItems.map(([label, value]) => `${label}${value}`).join(', ') : '없음',
    }
  }, [sectionId, selectedRow, template.rows, year])

  return (
    <div className={`stack-page work-shift-screen-shell${isMobile ? ' mobile' : ' desktop'}`}>
      <div className="work-shift-top-tabs-shell">
        <div className="work-shift-top-tabs-card">
          <div className="settlement-tabs settlement-tabs-inline work-shift-mode-tabs" role="tablist" aria-label="근무스케줄 카테고리">
            <button type="button" className={workMode === 'vacation' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setWorkMode('vacation')}>휴가신청</button>
            <button type="button" className={workMode === 'view' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setWorkMode('view')}>편집/보기</button>
          </div>
        </div>
      </div>

      <section className="card work-shift-page-card">
        <div className={`work-shift-toolbar${isMobile ? ' mobile' : ''}`}>
          {workMode === 'view' ? (
            <div className="work-shift-control-row">
              <div className="inline-actions wrap work-shift-section-tabs">
                {sectionOptions.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    className={sectionId === option.id ? 'small selected-toggle' : 'small ghost'}
                    onClick={() => setSectionId(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="work-shift-toolbar-side">
                <div className="work-shift-toolbar-inline-row">
                  <div className="inline-actions work-shift-date-selectors work-shift-date-selectors-inline">
                    <select className="input small-select" value={year} onChange={event => setYear(Number(event.target.value) || currentYear)}>
                      {yearOptions.map(option => <option key={option} value={option}>{option}년</option>)}
                    </select>
                    <select className="input small-select" value={month} onChange={event => setMonth(Number(event.target.value) || currentMonth)}>
                      {monthOptions.map(option => <option key={option} value={option}>{option}월</option>)}
                    </select>
                  </div>
                  <div className="work-shift-toolbar-actions">
                    <button type="button" className={editNamesMode ? 'small selected-toggle' : 'small ghost'} onClick={() => canEditSchedule && setEditNamesMode(prev => !prev)} disabled={!canEditSchedule}>{editNamesMode ? '편집중' : '편집'}</button>
                    <button type="button" className={logOpen ? 'small selected-toggle' : 'small ghost'} onClick={() => setLogOpen(prev => !prev)}>설정</button>
                    <button type="button" className="small ghost" onClick={addScheduleRow} disabled={!canEditSchedule}>추가</button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {workMode === 'vacation' ? (
          <>
            <section className="work-shift-vacation-card">
              <div className="work-shift-vacation-head">
                <strong>휴가신청</strong>
                <span className="muted">관리자~직원 계정은 신청 가능 / 편집권한은 관리자, 부관리자, 부팀장만 허용</span>
              </div>
              {canRequestVacation ? (
                <form className="work-shift-vacation-form" onSubmit={submitVacationRequest}>
                  <label>
                    <span>구분</span>
                    <input
                      className="input"
                      value={(vacationSectionOptions.find(option => option.id === vacationForm.sectionId)?.label) || '-'}
                      readOnly
                    />
                  </label>
                  <label>
                    <span>휴가종류</span>
                    <select className="input" value={vacationForm.requestType} onChange={event => setVacationForm(prev => ({ ...prev, requestType: event.target.value }))}>
                      {['연차', '월차', '휴무', '병가', '예비군', '기타'].map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>호점</span>
                    <input className="input" value={vacationForm.branchLabel} onChange={event => setVacationForm(prev => ({ ...prev, branchLabel: event.target.value }))} placeholder="예: 본점 / 3호점" />
                  </label>
                  <label>
                    <span>성명</span>
                    <input className="input" value={vacationForm.applicantName} onChange={event => setVacationForm(prev => ({ ...prev, applicantName: event.target.value }))} placeholder="성명 입력" />
                  </label>
                  <label>
                    <span>시작일</span>
                    <input className="input" type="date" value={vacationForm.startDate} onChange={event => setVacationForm(prev => ({ ...prev, startDate: event.target.value }))} />
                  </label>
                  <label>
                    <span>종료일</span>
                    <input className="input" type="date" value={vacationForm.endDate} onChange={event => setVacationForm(prev => ({ ...prev, endDate: event.target.value }))} />
                  </label>
                  <label className="span-2">
                    <span>사유</span>
                    <textarea className="input" rows="3" value={vacationForm.reason} onChange={event => setVacationForm(prev => ({ ...prev, reason: event.target.value }))} placeholder="휴가 사유 입력" />
                  </label>
                  <div className="span-2 work-shift-vacation-submit-row">
                    <button type="submit">휴가신청 접수</button>
                  </div>
                </form>
              ) : (
                <div className="muted">현재 계정은 휴가신청 권한이 없습니다.</div>
              )}
            </section>

            <section className="work-shift-vacation-card">
              <div className="work-shift-vacation-head">
                <strong>{canEditSchedule ? '휴가신청 전체목록' : '내 휴가신청 목록'}</strong>
                <span className="muted">총 {visibleVacationRequests.length}건</span>
              </div>
              {visibleVacationRequests.length === 0 ? (
                <div className="muted">접수된 휴가신청이 없습니다.</div>
              ) : (
                <div className="work-shift-vacation-table-wrap">
                  <table className="work-shift-vacation-table">
                    <thead>
                      <tr>
                        <th>접수일시</th>
                        <th>구분</th>
                        <th>휴가종류</th>
                        <th>호점</th>
                        <th>성명</th>
                        <th>기간</th>
                        <th>사유</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleVacationRequests.map(item => (
                        <tr key={item.id}>
                          <td>{item.createdAtLabel}</td>
                          <td>{item.sectionLabel}</td>
                          <td>{item.requestType}</td>
                          <td>{item.branchLabel || '-'}</td>
                          <td>{item.applicantName || '-'}</td>
                          <td>{item.startDate} ~ {item.endDate}</td>
                          <td>{item.reason || '-'}</td>
                          <td>{item.status || '신청완료'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}

        {workMode === 'view' && logOpen ? (
          <section className="work-shift-log-card">
            <div className="work-shift-log-head">
              <strong>편집기록</strong>
              <button type="button" className="small ghost" onClick={clearChangeLogs}>기록삭제</button>
            </div>
            {changeLogs.length === 0 ? (
              <div className="muted">저장된 편집기록이 없습니다.</div>
            ) : (
              <div className="work-shift-log-table">
                <div className="work-shift-log-row head">
                  <div>변경일</div>
                  <div>계정이름</div>
                  <div>시트종류</div>
                  <div>셀위치</div>
                  <div>변경데이터값</div>
                </div>
                {changeLogs.map((log, index) => (
                  <div key={`work-shift-log-${index}`} className="work-shift-log-row">
                    <div>{log.changedAt}</div>
                    <div>{log.accountName}</div>
                    <div>{log.sectionLabel}</div>
                    <div>{log.cellLabel}</div>
                    <div>{log.changeText}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {workMode === 'view' && !canEditSchedule ? (
          <div className="work-shift-readonly-notice">현재 계정은 편집 권한이 없어 보기만 가능합니다.</div>
        ) : null}

        {workMode === 'view' && selectedSummary ? (
          <section className="work-shift-summary-card compact">
            <div className="work-shift-summary-compact-row primary">
              <span className="work-shift-summary-chip">호점 {selectedSummary.groupLabel}</span>
              <strong>성명 {selectedSummary.personName}</strong>
              <span>총건수 {selectedSummary.totalJobs}건</span>
              <span>1건 {selectedSummary.oneCount}</span>
              <span>2건 {selectedSummary.twoCount}</span>
              <span>장거리 {selectedSummary.longDistanceCount}</span>
            </div>
            <div className="work-shift-summary-compact-row">
              <span>총 연차 / 월차 사용수 : 연차 : {selectedSummary.totalAnnualCount} / 월차 : {selectedSummary.totalMonthlyLeaveCount}</span>
            </div>
            <div className="work-shift-summary-compact-row">
              <span>분기별 연차 사용 : 1분기 연차수 : {selectedSummary.quarterlyAnnualCounts[0]} | 2분기 연차수 : {selectedSummary.quarterlyAnnualCounts[1]} | 3분기 연차수 : {selectedSummary.quarterlyAnnualCounts[2]} | 4분기 연차수 : {selectedSummary.quarterlyAnnualCounts[3]}</span>
            </div>
            <div className="work-shift-summary-compact-row">
              <span>월 연차 사용 : {selectedSummary.monthlyAnnualCount}</span>
            </div>
            <div className="work-shift-summary-compact-row">
              <span>월간별 월차 사용 : {selectedSummary.monthlyMonthlyLeaveCount}</span>
            </div>
            <div className="work-shift-summary-detail">* 세부내용 : {selectedSummary.detailText}</div>
          </section>
        ) : null}

        {workMode === 'view' ? (
          <div
            ref={tableWrapRef}
            className="work-shift-table-wrap drag-scroll-enabled"
            onPointerDown={handleTablePointerDown}
            onPointerUp={handleTablePointerUp}
            onPointerCancel={handleTablePointerUp}
            onPointerLeave={() => { if (dragStateRef.current?.active) handleTablePointerUp() }}
            onClickCapture={event => {
              if (dragStateRef.current?.suppressClick) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
            onDragStart={event => event.preventDefault()}
          >
            <table className="work-shift-table spreadsheet-like">
              <thead>
                <tr className="work-shift-index-row">
                  <th className="sticky top-left row-index-head">구분</th>
                  {tableColumnLabels.map((label, index) => {
                    const extraClass = index === 0 ? 'sticky left col-index-branch' : index === 1 ? 'sticky left second col-index-person' : ''
                    return <th key={`col-label-${index}`} className={`work-shift-col-index ${extraClass}`.trim()}>{label}</th>
                  })}
                </tr>
                <tr className="work-shift-header-row">
                  <th className="sticky left row-index-head row-index-head-secondary">1</th>
                  <th className="sticky left col-main-head head-name name-cell-branch work-shift-head-cell">{sectionId === 'business' ? '호점' : '구분'}</th>
                  <th className="sticky left second col-main-head head-name name-cell-person work-shift-head-cell">성명</th>
                  {dayLabels.map((label, index) => <th key={index} className="head-day work-shift-head-cell">{label}</th>)}
                  {(template.summary || []).map((label, index) => <th key={`summary-${index}`} className="head-summary">{label || ' '}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const rowKey = String(row.row || row.c2 || rowIndex)
                  const selected = rowKey === String(selectedRowKey || '')
                  const branchActive = isActiveCell(rowIndex, 0)
                  const nameActive = isActiveCell(rowIndex, 1)
                  return (
                    <tr key={`${sectionId}-${row.row || rowIndex}`} className={selected ? 'is-selected' : ''} onClick={() => setSelectedRowKey(rowKey)}>
                      <td className="sticky left row-index-cell">{rowIndex + 2}</td>
                      <td className={`sticky left name-cell ${branchActive ? 'is-active-cell' : ''}`.trim()}>
                        {editNamesMode && canEditSchedule ? (
                          <input
                            className={`work-shift-branch-input ${branchActive ? 'is-active-input' : ''}`.trim()}
                            draggable={false}
                            value={row.c1 || ''}
                            ref={node => registerCellRef(rowIndex, 0, node)}
                            onFocus={() => {
                              setSelectedRowKey(rowKey)
                              setActiveCellKey(getCellKey(rowIndex, 0))
                            }}
                            onBlur={() => setActiveCellKey(prev => (prev === getCellKey(rowIndex, 0) ? '' : prev))}
                            onChange={event => updateRowBranch(rowIndex, event.target.value)}
                            onKeyDown={event => {
                              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                                event.preventDefault()
                                moveFocus(rowIndex, 0, event.key)
                              }
                            }}
                          />
                        ) : (row.c1 || '')}
                      </td>
                      <td className={`sticky left second name-cell ${nameActive ? 'is-active-cell' : ''}`.trim()}>
                        {editNamesMode && canEditSchedule ? (
                          <input
                            className={`work-shift-name-input ${nameActive ? 'is-active-input' : ''}`.trim()}
                            draggable={false}
                            value={row.c2 || ''}
                            ref={node => registerCellRef(rowIndex, 1, node)}
                            onFocus={() => {
                              setSelectedRowKey(rowKey)
                              setActiveCellKey(getCellKey(rowIndex, 1))
                            }}
                            onBlur={() => setActiveCellKey(prev => (prev === getCellKey(rowIndex, 1) ? '' : prev))}
                            onChange={event => updateRowName(rowIndex, event.target.value)}
                            onKeyDown={event => {
                              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                                event.preventDefault()
                                moveFocus(rowIndex, 1, event.key)
                              }
                            }}
                          />
                        ) : (row.c2 || '')}
                      </td>
                      {Array.from({ length: 31 }, (_, dayIndex) => {
                        const disabled = dayIndex + 1 > dayCount
                        const dayCellActive = isActiveCell(rowIndex, dayIndex + 2)
                        return (
                          <td key={dayIndex} className={`${disabled ? 'day-cell disabled' : 'day-cell'} ${dayCellActive ? 'is-active-cell' : ''}`.trim()}>
                            <input
                              className={`work-shift-input ${dayCellActive ? 'is-active-input' : ''}`.trim()}
                              draggable={false}
                              value={row.days?.[dayIndex] || ''}
                              onFocus={() => {
                                setSelectedRowKey(rowKey)
                                setActiveCellKey(getCellKey(rowIndex, dayIndex + 2))
                              }}
                              onBlur={() => setActiveCellKey(prev => (prev === getCellKey(rowIndex, dayIndex + 2) ? '' : prev))}
                              ref={node => registerCellRef(rowIndex, dayIndex + 2, node)}
                              onChange={event => updateCell(rowIndex, dayIndex, event.target.value)}
                              onKeyDown={event => {
                                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                                  event.preventDefault()
                                  moveFocus(rowIndex, dayIndex + 2, event.key)
                                }
                              }}
                              disabled={disabled || !editNamesMode || !canEditSchedule}
                            />
                          </td>
                        )
                      })}
                      {(row.summary || []).map((value, index) => <td key={`value-${index}`} className="summary-cell">{value}</td>)}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function SettingsPage({ onLogout }) {
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState({})
  const [blocks, setBlocks] = useState([])
  const [inquiry, setInquiry] = useState({ category: '기능문의', title: '', content: '' })
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [category, setCategory] = useState('theme')
  const [theme, setTheme] = useState(() => getStoredThemePreference())

  useEffect(() => {
    applyAppTheme(theme)
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
    } catch (_) {}
  }, [theme])

  async function load() {
    const [p, b] = await Promise.all([api('/api/preferences'), api('/api/blocked-users')])
    setPrefs(p)
    setBlocks(b)
    const savedTheme = p?.theme === 'dark' ? 'dark' : p?.theme === 'light' ? 'light' : getStoredThemePreference()
    setTheme(savedTheme)
  }
  useEffect(() => { load() }, [])

  async function savePrefs() {
    const nextPrefs = { ...prefs, theme }
    await api('/api/preferences', { method: 'POST', body: JSON.stringify({ data: nextPrefs }) })
    setPrefs(nextPrefs)
    setMessage('설정이 저장되었습니다.')
  }

  async function submitInquiry(e) {
    e.preventDefault()
    await api('/api/inquiries', { method: 'POST', body: JSON.stringify(inquiry) })
    setInquiry({ category: '기능문의', title: '', content: '' })
    setMessage('문의가 접수되었습니다.')
  }

  async function deleteAccount() {
    if (!window.confirm('계정삭제시 관련 정보가 삭제됩니다. 그래도 삭제하시겠습니까?')) {
      return
    }
    setDeleting(true)
    try {
      await api('/api/account', { method: 'DELETE' })
      window.alert('계정이 삭제되었습니다.')
      clearSession()
      navigate('/login', { replace: true })
      window.location.reload()
    } catch (error) {
      window.alert(error.message || '계정 삭제 중 오류가 발생했습니다.')
      setDeleting(false)
    }
  }

  return (
    <div className="stack settings-page-shell">
      <section className="card settings-category-card">
        <h2>설정</h2>
        <div className="settings-category-row">
          <button type="button" className={category === 'theme' ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'} onClick={() => setCategory('theme')}>테마변경</button>
          <button type="button" className={category === 'notifications' ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'} onClick={() => setCategory('notifications')}>알림설정</button>
          <button type="button" className={category === 'home' ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'} onClick={() => setCategory('home')}>목록형전환</button>
          <button type="button" className={category === 'blocked' ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'} onClick={() => setCategory('blocked')}>차단목록</button>
          <button type="button" className={category === 'inquiry' ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'} onClick={() => setCategory('inquiry')}>문의접수</button>
          <button type="button" className={category === 'account' ? 'ghost settings-category-chip active' : 'ghost settings-category-chip'} onClick={() => setCategory('account')}>계정관리</button>
        </div>
      </section>

      {category === 'theme' ? (
        <section className="card settings-theme-card">
          <h3>테마변경</h3>
          <div className="settings-theme-options">
            <button type="button" className={theme === 'light' ? 'ghost settings-theme-option active' : 'ghost settings-theme-option'} onClick={() => setTheme('light')}>흰색테마</button>
            <button type="button" className={theme === 'dark' ? 'ghost settings-theme-option active' : 'ghost settings-theme-option'} onClick={() => setTheme('dark')}>검정테마</button>
          </div>
          <div className="inline-actions wrap">
            <button type="button" onClick={savePrefs}>설정 저장</button>
          </div>
          {message ? <div className="success">{message}</div> : null}
        </section>
      ) : null}

      {category === 'notifications' ? (
        <section className="card">
          <h3>알림설정</h3>
          <label className="check"><input type="checkbox" checked={!!prefs.groupChatNotifications} onChange={e => setPrefs({ ...prefs, groupChatNotifications: e.target.checked })} /> 그룹채팅 알림</label>
          <label className="check"><input type="checkbox" checked={!!prefs.directChatNotifications} onChange={e => setPrefs({ ...prefs, directChatNotifications: e.target.checked })} /> 1:1 채팅 알림</label>
          <label className="check"><input type="checkbox" checked={!!prefs.likeNotifications} onChange={e => setPrefs({ ...prefs, likeNotifications: e.target.checked })} /> 좋아요 알림</label>
          <div className="inline-actions wrap">
            <button type="button" onClick={savePrefs}>설정 저장</button>
          </div>
          {message ? <div className="success">{message}</div> : null}
        </section>
      ) : null}


      {category === 'home' ? (
        <section className="card settings-theme-card">
          <h3>목록형전환</h3>
          <div className="settings-home-toggle-card">
            <div>
              <strong>빠른 확인 목록형전환</strong>
              <div className="muted small-text">ON으로 바꾸면 홈의 빠른 확인이 제목 / 세부내용 / 알림수 목록형으로 표시됩니다.</div>
            </div>
            <button
              type="button"
              className={prefs.quickListMode ? 'settings-toggle-button active' : 'settings-toggle-button'}
              onClick={() => setPrefs({ ...prefs, quickListMode: !prefs.quickListMode })}
              aria-pressed={!!prefs.quickListMode}
            >
              {prefs.quickListMode ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="inline-actions wrap">
            <button type="button" onClick={savePrefs}>설정 저장</button>
          </div>
          {message ? <div className="success">{message}</div> : null}
        </section>
      ) : null}

      {category === 'blocked' ? (
        <section className="card">
          <h3>차단 사용자</h3>
          <div className="list">
            {blocks.map(item => (
              <div className="list-item block" key={item.id}>
                <strong>{item.blocked_user.nickname}</strong>
                <div className="muted">{item.reason}</div>
              </div>
            ))}
            {blocks.length === 0 && <div className="muted">차단된 사용자가 없습니다.</div>}
          </div>
        </section>
      ) : null}

      {category === 'inquiry' ? (
        <section className="card">
          <h3>문의 접수</h3>
          <form onSubmit={submitInquiry} className="stack">
            <input value={inquiry.category} placeholder="문의 분류" onChange={e => setInquiry({ ...inquiry, category: e.target.value })} />
            <input value={inquiry.title} placeholder="문의 제목" onChange={e => setInquiry({ ...inquiry, title: e.target.value })} />
            <textarea value={inquiry.content} placeholder="문의 내용" onChange={e => setInquiry({ ...inquiry, content: e.target.value })} />
            <button>문의 등록</button>
          </form>
          {message ? <div className="success">{message}</div> : null}
        </section>
      ) : null}

      {category === 'account' ? (
        <section className="card">
          <h3>계정관리</h3>
          <div className="inline-actions wrap">
            <button type="button" className="danger" onClick={deleteAccount} disabled={deleting}>{deleting ? '삭제 중...' : '계정삭제'}</button>
            <button type="button" className="ghost" onClick={onLogout}>로그아웃</button>
          </div>
          <div className="muted small-text">계정삭제시 관련 정보가 삭제됩니다. 삭제 후에는 복구할 수 없습니다.</div>
        </section>
      ) : null}
    </div>
  )
}


function AdminModePage() {
  const currentUser = getStoredUser()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [accountManageOpen, setAccountManageOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [authorityOpen, setAuthorityOpen] = useState(false)
  const [materialsRequestDeleteOpen, setMaterialsRequestDeleteOpen] = useState(false)
  const [materialsRequestDeleteFilters, setMaterialsRequestDeleteFilters] = useState({ userId: 'all', startDate: '', endDate: '', status: 'all' })
  const [materialsRequestDeleteRows, setMaterialsRequestDeleteRows] = useState([])
  const [materialsRequestDeleteSelection, setMaterialsRequestDeleteSelection] = useState([])
  const [materialsRequestDeleteLoading, setMaterialsRequestDeleteLoading] = useState(false)
  const [materialsRequestDeleteSubmitting, setMaterialsRequestDeleteSubmitting] = useState(false)
  const [materialsTableSizeOpen, setMaterialsTableSizeOpen] = useState(false)
  const [menuLockOpen, setMenuLockOpen] = useState(false)
  const [menuLockMap, setMenuLockMap] = useState(() => buildDefaultMenuLocks())
  const [menuLockSaving, setMenuLockSaving] = useState(false)
  const [layoutGuideEnabled, setLayoutGuideEnabled] = useState(false)
  const [layoutGuideSaving, setLayoutGuideSaving] = useState(false)
  const [htmlInspectorEnabled, setHtmlInspectorEnabled] = useState(false)
  const [htmlInspectorSaving, setHtmlInspectorSaving] = useState(false)
  const [textEditEnabled, setTextEditEnabled] = useState(false)
  const [textEditSaving, setTextEditSaving] = useState(false)
  const [materialsTableEditor, setMaterialsTableEditor] = useState({ mode: 'width', target: 'sales' })
  const [materialsTableLayouts, setMaterialsTableLayouts] = useState(() => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, [...MATERIALS_TABLE_WIDTH_DEFAULTS[key]]])))
  const [materialsTableScaleSettings, setMaterialsTableScaleSettings] = useState(() => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, 100])))
  const [materialsTableSaving, setMaterialsTableSaving] = useState(false)
  const [accountManageTab, setAccountManageTab] = useState('list')
  const [accountDeleteSelection, setAccountDeleteSelection] = useState({})
  const [accountDeleteDialogOpen, setAccountDeleteDialogOpen] = useState(false)
  const [accountDeleteConfirmText, setAccountDeleteConfirmText] = useState('')
  const [selectedSwitchAccountId, setSelectedSwitchAccountId] = useState(null)
  const [switchLoading, setSwitchLoading] = useState(false)
  const [createForm, setCreateForm] = useState({
    login_id: '', email: '', google_email: '', account_status: 'active', password: '', name: '', nickname: '', gender: '', birth_year: 1995, region: '서울', phone: '', recovery_email: '', vehicle_number: '', branch_no: '', grade: 6, position_title: '', approved: true, vehicle_available: true,
  })
  const [configForm, setConfigForm] = useState({
    total_vehicle_count: '',
    branch_count_override: '',
    admin_mode_access_grade: 2,
    role_assign_actor_max_grade: 3,
    role_assign_target_min_grade: 3,
    account_suspend_actor_max_grade: 3,
    account_suspend_target_min_grade: 3,
    signup_approve_actor_max_grade: 3,
    signup_approve_target_min_grade: 7,
    menu_permissions_json: '',
  })
  const [accountRows, setAccountRows] = useState([])
  const [accountRowsSortBase, setAccountRowsSortBase] = useState([])
  const [branchRows, setBranchRows] = useState([])
  const [employeeRows, setEmployeeRows] = useState([])
  const [branchOpen, setBranchOpen] = useState({})
  const [employeeOpen, setEmployeeOpen] = useState({})
  const [branchEditMode, setBranchEditMode] = useState(false)
  const [employeeEditMode, setEmployeeEditMode] = useState(false)
  const [accountPage, setAccountPage] = useState(1)
  const [accountManagePages, setAccountManagePages] = useState({ list: 1, edit: 1, delete: 1 })
  const [accountListOpen, setAccountListOpen] = useState({})
  const [accountEditOpen, setAccountEditOpen] = useState({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusTab, setStatusTab] = useState('all')
  const [branchArchiveModalOpen, setBranchArchiveModalOpen] = useState(false)
  const [branchArchiveMode, setBranchArchiveMode] = useState('archive')
  const [branchArchiveSelection, setBranchArchiveSelection] = useState('')
  const [vehicleExceptionModal, setVehicleExceptionModal] = useState({ open: false, account: null, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: false })
  const [sortConfigs, setSortConfigs] = useState({ manage: { mode: 'group_number', keys: [] }, status: { mode: 'group_number', keys: [] }, authority: { mode: 'group_number', keys: [] } })
  const [sortModal, setSortModal] = useState({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })
  const [statusAddPickerOpen, setStatusAddPickerOpen] = useState({ branch: false, employee: false, hq: false })
  const [statusAddSelection, setStatusAddSelection] = useState({ branch: '', employee: '', hq: '' })
  const [statusMovePickerOpen, setStatusMovePickerOpen] = useState({ branch: false, employee: false, hq: false })
  const [statusMoveSelection, setStatusMoveSelection] = useState({ branch: '', employee: '', hq: '' })
  const [statusDeletePickerOpen, setStatusDeletePickerOpen] = useState({ branch: false, employee: false, hq: false })
  const [statusDeleteSelection, setStatusDeleteSelection] = useState({ branch: '', employee: '', hq: '' })
  const authoritySectionRef = useRef(null)
  const pendingApprovalSectionRef = useRef(null)
  const ACCOUNTS_PER_PAGE = 10

  function isStaffGradeValue(value) {
    return Number(value || 0) === 5
  }

  function enforceVehicleRules(item) {
    const next = { ...item }
    if (isStaffGradeValue(next?.grade)) {
      next.vehicle_available = false
    }
    return next
  }

  function parseVehicleAvailable(value) {
    if (value === false || value === 0 || value === '0' || value === 'false' || value === 'False' || value === '불가') return false
    return true
  }

  function normalizeAdminRow(item) {
    const accountType = item?.account_type || ((item?.role === 'business' || Number(item?.branch_no || 0) > 0) ? 'business' : 'employee')
    const rawGroupNumber = item?.group_number_text ?? item?.group_number ?? '0'
    return enforceVehicleRules({ ...item, group_number: String(rawGroupNumber || '0'), group_number_text: String(rawGroupNumber || '0'), gender: normalizeGenderValue(item?.gender), vehicle_available: parseVehicleAvailable(item?.vehicle_available), approved: !!item?.approved, account_type: accountType, new_password: '' })
  }

  function vehicleAvailableSelectValue(item) {
    return parseVehicleAvailable(item?.vehicle_available) ? '가용' : '불가'
  }

  const pendingSignupAccounts = useMemo(() => {
    return (accountRows || []).filter(item => Number(item?.grade || 0) === 7 || !item?.approved)
  }, [accountRows])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [response, materialsScaleResponse, desktopLayoutResponse, prefsResponse] = await Promise.all([
        api('/api/admin-mode'),
        api('/api/materials/table-scale').catch(() => ({ scales: {} })),
        api('/api/materials/table-layout?device=desktop').catch(() => ({ layouts: {} })),
        api('/api/preferences').catch(() => ({})),
      ])
      setData(response)
      setMaterialsTableScaleSettings(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, clampMaterialsScale(materialsScaleResponse?.scales?.[key] ?? prev[key] ?? 100)])))
      setMaterialsTableLayouts(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, normalizeMaterialsColumnWidths(key, desktopLayoutResponse?.layouts?.[key] ?? prev[key] ?? MATERIALS_TABLE_WIDTH_DEFAULTS[key], false)])))
      const nextConfigForm = {
        total_vehicle_count: String(response.config?.total_vehicle_count || ''),
        branch_count_override: String(response.config?.branch_count_override || response.branch_count || ''),
        ...response.permission_config,
      }
      setConfigForm(nextConfigForm)
      setMenuLockMap(normalizeMenuLocks(nextConfigForm.menu_locks_json))
      const nextLayoutGuideEnabled = !!prefsResponse?.layoutGuideEnabled
      const nextHtmlInspectorEnabled = !!prefsResponse?.htmlInspectorEnabled
      const nextTextEditEnabled = !!prefsResponse?.textEditEnabled
      setLayoutGuideEnabled(nextLayoutGuideEnabled)
      setHtmlInspectorEnabled(nextHtmlInspectorEnabled)
      setTextEditEnabled(nextTextEditEnabled)
      applyLayoutGuideMode(nextLayoutGuideEnabled)
      applyHtmlInspectorMode(nextHtmlInspectorEnabled)
      applyTextEditMode(nextTextEditEnabled)
      const normalizedAccounts = (response.accounts || []).map(normalizeAdminRow)
      setAccountRows(normalizedAccounts)
      setAccountRowsSortBase(normalizedAccounts)
      setBranchRows((response.branches || []).map(normalizeAdminRow))
      setEmployeeRows((response.employees || []).map(normalizeAdminRow))
      setAccountPage(1)
      setAccountManagePages({ list: 1, edit: 1, delete: 1, switch: 1 })
      setAccountListOpen({})
      setAccountEditOpen({})
      setAccountDeleteSelection({})
      setAccountDeleteDialogOpen(false)
      setAccountDeleteConfirmText('')
      setSelectedSwitchAccountId(null)
      setStatusAddPickerOpen({ branch: false, employee: false, hq: false })
      setStatusAddSelection({ branch: '', employee: '', hq: '' })
      setStatusMovePickerOpen({ branch: false, employee: false, hq: false })
      setStatusMoveSelection({ branch: '', employee: '', hq: '' })
      setStatusDeletePickerOpen({ branch: false, employee: false, hq: false })
      setStatusDeleteSelection({ branch: '', employee: '', hq: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const panel = String(searchParams.get('panel') || '').trim()
    if (panel !== 'signup-approvals') return
    setAuthorityOpen(true)
    window.setTimeout(() => {
      pendingApprovalSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [searchParams])

  async function saveConfig() {
    const nextConfig = { ...configForm, menu_locks_json: JSON.stringify(menuLockMap) }
    await api('/api/admin-mode/config', {
      method: 'POST',
      body: JSON.stringify(nextConfig),
    })
    const storedUser = getStoredUser()
    if (storedUser) {
      const nextUser = { ...storedUser, permission_config: { ...(storedUser.permission_config || {}), ...nextConfig } }
      sessionStorage.setItem('icj_user', JSON.stringify(nextUser))
      if (getRememberedLogin()) localStorage.setItem('icj_user', JSON.stringify(nextUser))
    }
    setConfigForm(nextConfig)
    setMessage('관리자모드 설정이 저장되었습니다.')
    await load()
  }

  const saveMenuLocks = useCallback(async () => {
    setMenuLockSaving(true)
    setMessage('')
    setError('')
    try {
      const nextConfig = { ...configForm, menu_locks_json: JSON.stringify(menuLockMap) }
      await api('/api/admin-mode/config', {
        method: 'POST',
        body: JSON.stringify(nextConfig),
      })
      setConfigForm(nextConfig)
      const storedUser = getStoredUser()
      if (storedUser) {
        const nextUser = { ...storedUser, permission_config: { ...(storedUser.permission_config || {}), ...nextConfig } }
        sessionStorage.setItem('icj_user', JSON.stringify(nextUser))
        if (getRememberedLogin()) localStorage.setItem('icj_user', JSON.stringify(nextUser))
      }
      setMessage('메뉴잠금 설정이 저장되었습니다.')
      await load()
    } catch (err) {
      setError(err.message || '메뉴잠금 저장 중 오류가 발생했습니다.')
    } finally {
      setMenuLockSaving(false)
    }
  }, [configForm, menuLockMap])


  const saveLayoutGuideSetting = useCallback(async (nextValue) => {
    setLayoutGuideSaving(true)
    setMessage('')
    setError('')
    try {
      const currentPrefs = await api('/api/preferences').catch(() => ({}))
      const nextPrefs = { ...(currentPrefs || {}), layoutGuideEnabled: !!nextValue }
      await api('/api/preferences', {
        method: 'POST',
        body: JSON.stringify({ data: nextPrefs }),
      })
      setLayoutGuideEnabled(!!nextValue)
      applyLayoutGuideMode(!!nextValue)
      setMessage(`관리용기능 · 테두리 표시가 ${nextValue ? 'ON' : 'OFF'}으로 저장되었습니다.`)
    } catch (err) {
      setError(err.message || '관리용기능 저장 중 오류가 발생했습니다.')
    } finally {
      setLayoutGuideSaving(false)
    }
  }, [])

  const saveHtmlInspectorSetting = useCallback(async (nextValue) => {
    setHtmlInspectorSaving(true)
    setMessage('')
    setError('')
    try {
      const currentPrefs = await api('/api/preferences').catch(() => ({}))
      const nextPrefs = { ...(currentPrefs || {}), htmlInspectorEnabled: !!nextValue }
      await api('/api/preferences', {
        method: 'POST',
        body: JSON.stringify({ data: nextPrefs }),
      })
      setHtmlInspectorEnabled(!!nextValue)
      applyHtmlInspectorMode(!!nextValue)
      setMessage(`관리용기능 · html 요소확인이 ${nextValue ? 'ON' : 'OFF'}으로 저장되었습니다.`)
    } catch (err) {
      setError(err.message || 'html 요소확인 저장 중 오류가 발생했습니다.')
    } finally {
      setHtmlInspectorSaving(false)
    }
  }, [])

  const saveTextEditSetting = useCallback(async (nextValue) => {
    setTextEditSaving(true)
    setMessage('')
    setError('')
    try {
      const currentPrefs = await api('/api/preferences').catch(() => ({}))
      const nextPrefs = { ...(currentPrefs || {}), textEditEnabled: !!nextValue }
      await api('/api/preferences', {
        method: 'POST',
        body: JSON.stringify({ data: nextPrefs }),
      })
      setTextEditEnabled(!!nextValue)
      applyTextEditMode(!!nextValue)
      setMessage(`관리용기능 · 텍스트 편집이 ${nextValue ? 'ON' : 'OFF'}으로 저장되었습니다.`)
    } catch (err) {
      setError(err.message || '텍스트 편집 저장 중 오류가 발생했습니다.')
    } finally {
      setTextEditSaving(false)
    }
  }, [])

  async function saveAccounts() {
    await api('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({ accounts: accountRows.map(({ id, grade, approved, position_title, vehicle_available }) => ({ id, grade: Number(grade), approved, position_title: position_title || '', vehicle_available: parseVehicleAvailable(vehicle_available) })) }),
    })
    setMessage('계정 권한 정보가 저장되었습니다.')
    await load()
  }

  async function approvePendingSignup(target) {
    if (!target?.id) return
    await api('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({
        accounts: [{
          id: target.id,
          grade: 6,
          approved: true,
          position_title: target.position_title || '',
          vehicle_available: parseVehicleAvailable(target.vehicle_available),
        }],
      }),
    })
    setMessage(`${target.name || target.nickname || target.email || '계정'} 계정을 일반 권한으로 승인했습니다.`)
    if (pendingSignupAccounts.filter(item => Number(item.id) !== Number(target.id)).length === 0) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('panel')
      setSearchParams(nextParams)
    }
    await load()
  }

  async function rejectPendingSignup(target) {
    if (!target?.id) return
    const label = target.name || target.nickname || target.email || `계정 ${target.id}`
    if (!window.confirm(`${label} 회원가입 신청을 거절하고 계정을 삭제할까요?`)) return
    await api('/api/admin/accounts/delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [Number(target.id)] }),
    })
    setMessage(`${label} 회원가입 신청을 거절했습니다.`)
    if (pendingSignupAccounts.filter(item => Number(item.id) !== Number(target.id)).length === 0) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('panel')
      setSearchParams(nextParams)
    }
    await load()
  }

  async function loadMaterialsDeleteRequests(nextFilters = materialsRequestDeleteFilters) {
    setMaterialsRequestDeleteLoading(true)
    try {
      const params = new URLSearchParams()
      if (String(nextFilters.userId || 'all') !== 'all') params.set('user_id', String(nextFilters.userId))
      if (String(nextFilters.status || 'all') !== 'all') params.set('status', String(nextFilters.status))
      if (String(nextFilters.startDate || '').trim()) params.set('start_date', String(nextFilters.startDate).trim())
      if (String(nextFilters.endDate || '').trim()) params.set('end_date', String(nextFilters.endDate).trim())
      const result = await api(`/api/admin/materials/purchase-requests${params.toString() ? `?${params.toString()}` : ''}`)
      setMaterialsRequestDeleteRows(Array.isArray(result?.requests) ? result.requests : [])
      setMaterialsRequestDeleteSelection([])
    } catch (err) {
      window.alert(err.message || '자재신청현황 데이터를 불러오지 못했습니다.')
    } finally {
      setMaterialsRequestDeleteLoading(false)
    }
  }

  async function deleteMaterialsDeleteRequests() {
    if (!materialsRequestDeleteSelection.length) {
      window.alert('삭제할 신청현황을 선택해 주세요.')
      return
    }
    if (!window.confirm('선택한 자재 신청현황을 삭제하시겠습니까?')) return
    setMaterialsRequestDeleteSubmitting(true)
    try {
      await api('/api/admin/materials/purchase-requests/delete', {
        method: 'POST',
        body: JSON.stringify({ request_ids: materialsRequestDeleteSelection }),
      })
      setMessage('선택한 자재 신청현황이 삭제되었습니다.')
      await loadMaterialsDeleteRequests()
    } catch (err) {
      window.alert(err.message || '자재 신청현황 삭제 중 오류가 발생했습니다.')
    } finally {
      setMaterialsRequestDeleteSubmitting(false)
    }
  }

  useEffect(() => {
    if (materialsRequestDeleteOpen) {
      loadMaterialsDeleteRequests()
    }
  }, [materialsRequestDeleteOpen])

  function updateMaterialsTableEditorField(field, value) {
    setMaterialsTableEditor(prev => ({ ...prev, [field]: value }))
  }

  function updateMaterialsTableWidth(target, index, value) {
    setMaterialsTableLayouts(prev => {
      const next = { ...prev }
      const current = Array.isArray(next[target]) ? [...next[target]] : [...(MATERIALS_TABLE_WIDTH_DEFAULTS[target] || [])]
      current[index] = clampMaterialsColumnWidth(value)
      next[target] = current
      return next
    })
  }

  async function saveMaterialsTableEditor() {
    setMaterialsTableSaving(true)
    try {
      if (materialsTableEditor.mode === 'width') {
        const target = materialsTableEditor.target
        const desktopWidths = normalizeMaterialsColumnWidths(target, materialsTableLayouts[target] || MATERIALS_TABLE_WIDTH_DEFAULTS[target] || [], false)
        const mobileWidths = normalizeMaterialsColumnWidths(target, materialsTableLayouts[target] || MATERIALS_TABLE_WIDTH_DEFAULTS[target] || [], true)
        const desktopLayouts = { [target]: desktopWidths }
        const mobileLayouts = { [target]: mobileWidths }
        await Promise.all([
          api('/api/materials/table-layout', {
            method: 'POST',
            body: JSON.stringify({ data: { device: 'desktop', layouts: desktopLayouts } }),
          }),
          api('/api/materials/table-layout', {
            method: 'POST',
            body: JSON.stringify({ data: { device: 'mobile', layouts: mobileLayouts } }),
          }),
        ])
        setMaterialsTableLayouts(prev => ({ ...prev, [target]: desktopWidths }))
        setMessage('표 가로 사이즈 설정이 저장되었습니다.')
      } else {
        const nextScales = Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, clampMaterialsScale(materialsTableScaleSettings[key] ?? 100)]))
        const response = await api('/api/materials/table-scale', {
          method: 'POST',
          body: JSON.stringify({ data: { scales: nextScales } }),
        })
        const savedScales = response?.scales || nextScales
        setMaterialsTableScaleSettings(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, clampMaterialsScale(savedScales[key] ?? prev[key] ?? 100)])))
        setMessage('표 가로 배율 설정이 저장되었습니다.')
      }
    } catch (error) {
      window.alert(error.message || '표 사이즈 설정 저장 중 오류가 발생했습니다.')
    } finally {
      setMaterialsTableSaving(false)
    }
  }

  function normalizeDetailPayload(row) {
    const rawGroupNumber = String(row.group_number_text ?? row.group_number ?? '0')
    return {
      id: row.id,
      name: row.name || '',
      nickname: row.nickname || '',
      account_unique_id: row.account_unique_id || '',
      gender: normalizeGenderValue(row.gender),
      birth_year: Number(row.birth_year || 1995),
      region: row.region || '',
      phone: row.phone || '',
      recovery_email: row.recovery_email || '',
      vehicle_number: row.vehicle_number || '',
      branch_no: row.branch_no ? Number(row.branch_no) : null,
      marital_status: row.marital_status || '',
      resident_address: row.resident_address || '',
      business_name: row.business_name || '',
      business_number: row.business_number || '',
      business_type: row.business_type || '',
      business_item: row.business_item || '',
      business_address: row.business_address || '',
      bank_account: row.bank_account || '',
      bank_name: row.bank_name || '',
      mbti: row.mbti || '',
      login_id: row.login_id || '',
      email: row.email || '',
      google_email: row.google_email || '',
      account_status: row.account_status || 'active',
      resident_id: row.resident_id || '',
      position_title: row.position_title || '',
      vehicle_available: isStaffGradeValue(row?.grade) ? false : parseVehicleAvailable(row.vehicle_available),
      show_in_branch_status: !!row.show_in_branch_status,
      show_in_employee_status: !!row.show_in_employee_status,
      show_in_field_employee_status: !!(row.show_in_field_employee_status ?? (row.show_in_employee_status && !row.show_in_hq_status)),
      show_in_hq_status: !!(row.show_in_hq_status),
      archived_in_branch_status: !!row.archived_in_branch_status,
      group_number: rawGroupNumber,
      group_number_text: rawGroupNumber,
      new_password: String(row.new_password || ''),
    }
  }

  function groupNumberDisplay(item) {
    return String(item?.group_number_text ?? item?.group_number ?? '0') || '0'
  }

  async function saveBranchDetails() {
    await api('/api/admin-mode/config', {
      method: 'POST',
      body: JSON.stringify(configForm),
    })
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: branchRows.map(normalizeDetailPayload) }),
    })
    setMessage('가맹현황 정보가 저장되었습니다.')
    setBranchEditMode(false)
    await load()
  }

  async function saveEmployeeDetails() {
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: employeeRows.map(normalizeDetailPayload) }),
    })
    setMessage('직원현황 정보가 저장되었습니다.')
    setEmployeeEditMode(false)
    await load()
  }

  async function saveAccountEdits() {
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: accountRows.map(normalizeDetailPayload) }),
    })
    await api('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({
        accounts: accountRows.map(row => ({
          id: row.id,
          grade: Number(row.grade || 6),
          approved: !!row.approved,
          position_title: row.position_title || '',
          vehicle_available: isStaffGradeValue(row?.grade) ? false : parseVehicleAvailable(row.vehicle_available),
        })),
      }),
    })
    setMessage('계정편집 정보가 저장되었습니다.')
    await load()
  }

  async function submitCreateAccount(e) {
    e.preventDefault()
    const requiredFields = [
      ['name', '이름'],
      ['login_id', '아이디'],
      ['password', '비밀번호'],
      ['nickname', '닉네임'],
    ]
    for (const [fieldKey, fieldLabel] of requiredFields) {
      if (!String(createForm?.[fieldKey] || '').trim()) {
        window.alert(`[${fieldLabel}]를 입력해주세요.`)
        return
      }
    }
    await api('/api/admin/accounts/create', {
      method: 'POST',
      body: JSON.stringify({
        ...createForm,
        login_id: String(createForm.login_id || '').trim(),
        email: String(createForm.email || '').trim(),
        google_email: String(createForm.google_email || '').trim(),
        account_status: String(createForm.account_status || 'active').trim() || 'active',
        password: String(createForm.password || ''),
        name: String(createForm.name || '').trim(),
        nickname: String(createForm.nickname || '').trim(),
        gender: normalizeGenderValue(createForm.gender),
        region: String(createForm.region || '').trim() || '서울',
        phone: String(createForm.phone || '').trim(),
        recovery_email: String(createForm.recovery_email || '').trim(),
        vehicle_number: String(createForm.vehicle_number || '').trim(),
        birth_year: Number(createForm.birth_year || 1995),
        branch_no: createForm.branch_no ? Number(createForm.branch_no) : null,
        grade: Number(createForm.grade || 6),
        position_title: Number(createForm.branch_no || '') > 0 ? '호점대표' : String(createForm.position_title || '').trim(),
        approved: !!createForm.approved,
        vehicle_available: isStaffGradeValue(createForm.grade) ? false : parseVehicleAvailable(createForm.vehicle_available),
      }),
    })
    setMessage('계정이 생성되었습니다.')
    setCreateForm({ login_id: '', email: '', google_email: '', account_status: 'active', password: '', name: '', nickname: '', gender: '', birth_year: 1995, region: '서울', phone: '', recovery_email: '', vehicle_number: '', branch_no: '', grade: 6, position_title: '', approved: true, vehicle_available: true })
    await load()
  }

  async function switchAccountType(targetType) {
    if (!selectedSwitchAccountId) {
      setMessage('전환할 계정을 먼저 선택해주세요.')
      return
    }
    setSwitchLoading(true)
    try {
      await api('/api/admin/accounts/switch-type', {
        method: 'POST',
        body: JSON.stringify({ user_id: Number(selectedSwitchAccountId), target_type: targetType }),
      })
      setMessage(targetType === 'business' ? '사업자 계정으로 전환되었습니다.' : '직원 계정으로 전환되었습니다.')
      await load()
    } finally {
      setSwitchLoading(false)
    }
  }

  function requestDeleteAccounts() {
    const ids = Object.entries(accountDeleteSelection).filter(([, checked]) => !!checked).map(([id]) => Number(id))
    if (!ids.length) {
      setMessage('삭제할 계정을 먼저 선택해주세요.')
      return
    }
    setAccountDeleteConfirmText('')
    setAccountDeleteDialogOpen(true)
  }

  async function submitDeleteAccountsConfirmed() {
    const ids = Object.entries(accountDeleteSelection).filter(([, checked]) => !!checked).map(([id]) => Number(id))
    if (!ids.length) {
      setAccountDeleteDialogOpen(false)
      setMessage('삭제할 계정을 먼저 선택해주세요.')
      return
    }
    if (accountDeleteConfirmText.trim() !== '삭제') {
      setMessage("삭제를 진행하려면 텍스트창에 '삭제'라고 입력해주세요.")
      return
    }
    await api('/api/admin/accounts/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    setMessage('선택한 계정이 삭제되었습니다.')
    setAccountDeleteSelection({})
    setAccountDeleteDialogOpen(false)
    setAccountDeleteConfirmText('')
    await load()
  }

  function toggleDeleteSelection(userId) {
    setAccountDeleteSelection(prev => ({ ...prev, [userId]: !prev[userId] }))
  }



  async function callVehicleExclusionApi(accountId, action = 'list', payload = null) {
    const primaryBase = `/api/admin/accounts/${accountId}/vehicle-exclusions`
    const aliasBase = `/api/admin/vehicle-exclusions/${accountId}`
    const attempt = async (path, options = {}) => api(path, options)
    const isRetryable = error => {
      const message = String(error?.message || '')
      return message.includes('(404)') || message.includes('(405)') || message.includes('Not Found') || message.includes('Method Not Allowed')
    }
    try {
      if (action === 'list') return await attempt(primaryBase)
      if (action === 'create') return await attempt(primaryBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${primaryBase}/${payload}`, { method: 'DELETE' })
      throw new Error('지원하지 않는 차량열외 요청입니다.')
    } catch (error) {
      if (!isRetryable(error)) throw error
      if (action === 'list') return await attempt(aliasBase)
      if (action === 'create') return await attempt(aliasBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${aliasBase}/${payload}`, { method: 'DELETE' })
      throw error
    }
  }

  function updateAccountRow(userId, patch) {
    const normalizedPatch = { ...patch }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'grade')) {
      normalizedPatch.grade = Number(normalizedPatch.grade || 6)
      normalizedPatch.grade_label = gradeLabel(normalizedPatch.grade)
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'login_id')) {
      const nextLoginId = normalizeFlexibleLoginId(normalizedPatch.login_id || '')
      normalizedPatch.login_id = nextLoginId
      normalizedPatch.email = nextLoginId
    }
    setAccountRows(prev => prev.map(item => item.id === userId ? enforceVehicleRules({ ...item, ...normalizedPatch }) : item))
    setBranchRows(prev => prev.map(item => item.id === userId ? enforceVehicleRules({ ...item, ...normalizedPatch }) : item))
    setEmployeeRows(prev => prev.map(item => item.id === userId ? enforceVehicleRules({ ...item, ...normalizedPatch }) : item))
  }

  async function openVehicleExceptionModal(account) {
    if (isStaffGradeValue(account?.grade)) {
      setMessage('직원 권한 계정은 차량열외를 설정할 수 없습니다.')
      return
    }
    setVehicleExceptionModal({ open: true, account, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: true })
    try {
      const response = await callVehicleExclusionApi(account.id, 'list')
      setVehicleExceptionModal(prev => ({ ...prev, items: response.items || [], loading: false }))
    } catch (error) {
      setMessage(error.message || '차량열외 목록을 불러오지 못했습니다. 백엔드 배포 상태와 API 경로를 확인해 주세요.')
      setVehicleExceptionModal(prev => ({ ...prev, loading: false, items: [] }))
    }
  }

  async function saveVehicleException() {
    if (!vehicleExceptionModal.account) return
    await callVehicleExclusionApi(vehicleExceptionModal.account.id, 'create', vehicleExceptionModal.form)
    const response = await callVehicleExclusionApi(vehicleExceptionModal.account.id, 'list')
    setVehicleExceptionModal(prev => ({ ...prev, items: response.items || [], form: { start_date: '', end_date: '', reason: '' } }))
    setMessage('차량열외 일정이 저장되었습니다.')
    await load()
  }

  async function deleteVehicleException(exclusionId) {
    if (!vehicleExceptionModal.account) return
    const response = await callVehicleExclusionApi(vehicleExceptionModal.account.id, 'delete', exclusionId)
    setVehicleExceptionModal(prev => ({ ...prev, items: response.items || prev.items }))
    setMessage('차량열외 일정이 삭제되었습니다.')
    await load()
  }

  function updateBranchRow(userId, patch) {
    setBranchRows(prev => prev.map(item => item.id === userId ? { ...item, ...patch } : item))
  }

  function updateEmployeeRow(userId, patch) {
    setEmployeeRows(prev => prev.map(item => item.id === userId ? { ...item, ...patch } : item))
  }

  function toggleBranch(id) {
    setBranchOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function isHeadOfficeRow(item) {
    const email = String(item?.email || '').trim()
    const name = String(item?.name || '').trim()
    const nickname = String(item?.nickname || '').trim()
    const position = String(item?.position_title || '').trim()
    return position.includes('본사') || ['이청잘A', '이청잘B', '이청잘C'].includes(email) || ['최성규', '이준희', '손지민'].includes(name) || ['최성규', '이준희', '손지민'].includes(nickname)
  }

  function applyStatusTargetToRow(source, target) {
    const nextRow = { ...source }
    if (target === 'branch') {
      nextRow.show_in_branch_status = true
      nextRow.archived_in_branch_status = false
      nextRow.show_in_field_employee_status = false
      nextRow.show_in_hq_status = false
      nextRow.show_in_employee_status = false
      if (!String(nextRow.position_title || '').trim()) nextRow.position_title = '호점대표'
    } else if (target === 'employee') {
      nextRow.show_in_branch_status = false
      nextRow.archived_in_branch_status = false
      nextRow.show_in_field_employee_status = true
      nextRow.show_in_hq_status = false
      nextRow.show_in_employee_status = true
      if (String(nextRow.position_title || '').includes('본사')) nextRow.position_title = '현장직원'
      if (!String(nextRow.position_title || '').trim()) nextRow.position_title = '현장직원'
    } else if (target === 'hq') {
      nextRow.show_in_branch_status = false
      nextRow.archived_in_branch_status = false
      nextRow.show_in_field_employee_status = false
      nextRow.show_in_hq_status = true
      nextRow.show_in_employee_status = true
      nextRow.position_title = '본사직원'
    }
    return nextRow
  }

  function syncStatusRowToCollections(nextRow) {
    setAccountRows(prev => prev.map(item => item.id === nextRow.id ? nextRow : item))
    setBranchRows(prev => {
      const exists = prev.some(item => item.id === nextRow.id)
      if (nextRow.show_in_branch_status) {
        return exists ? prev.map(item => item.id === nextRow.id ? nextRow : item) : [...prev, nextRow]
      }
      return prev.filter(item => item.id !== nextRow.id)
    })
    setEmployeeRows(prev => {
      const exists = prev.some(item => item.id === nextRow.id)
      if (nextRow.show_in_field_employee_status || nextRow.show_in_hq_status || nextRow.show_in_employee_status) {
        return exists ? prev.map(item => item.id === nextRow.id ? nextRow : item) : [...prev, nextRow]
      }
      return prev.filter(item => item.id !== nextRow.id)
    })
  }

  function addAccountToStatus(target) {
    const selectedId = Number(statusMoveSelection[target] || statusAddSelection[target] || 0)
    if (!selectedId) return
    const source = accountRows.find(item => Number(item.id) === selectedId)
    if (!source) return
    const nextRow = applyStatusTargetToRow(source, target)
    syncStatusRowToCollections(nextRow)
    setStatusAddSelection(prev => ({ ...prev, [target]: '' }))
    setStatusMoveSelection(prev => ({ ...prev, [target]: '' }))
    setStatusAddPickerOpen(prev => ({ ...prev, [target]: false }))
    setStatusMovePickerOpen(prev => ({ ...prev, [target]: false }))
  }

  function removeAccountFromStatus(target) {
    const selectedId = Number(statusDeleteSelection[target] || 0)
    if (!selectedId) return
    const source = accountRows.find(item => Number(item.id) === selectedId)
    if (!source) return
    const nextRow = { ...source }
    if (target === 'branch') {
      nextRow.show_in_branch_status = false
      nextRow.archived_in_branch_status = false
    } else if (target === 'employee') {
      nextRow.show_in_field_employee_status = false
      nextRow.show_in_employee_status = !!nextRow.show_in_hq_status
    } else if (target === 'hq') {
      nextRow.show_in_hq_status = false
      nextRow.show_in_employee_status = !!nextRow.show_in_field_employee_status
    } else {
      nextRow.show_in_employee_status = false
    }
    syncStatusRowToCollections(nextRow)
    setStatusDeleteSelection(prev => ({ ...prev, [target]: '' }))
    setStatusDeletePickerOpen(prev => ({ ...prev, [target]: false }))
  }

  function toggleBranchArchive(flag) {
    const selectedId = Number(branchArchiveSelection || 0)
    if (!selectedId) return
    setBranchRows(prev => prev.map(item => item.id === selectedId ? { ...item, archived_in_branch_status: flag } : item))
    setAccountRows(prev => prev.map(item => item.id === selectedId ? { ...item, archived_in_branch_status: flag } : item))
    setBranchArchiveSelection('')
  }

  function toggleAccountListRow(id) {
    setAccountListOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleAccountEditRow(id) {
    setAccountEditOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }


  function adminSortValue(item, key) {
    if (key === 'group_number') return String(item?.group_number ?? '0').padStart(6, '0')
    if (key === 'account_type') return item?.account_type === 'business' ? '0-business' : '1-employee'
    if (key === 'vehicle_available') return parseVehicleAvailable(item?.vehicle_available) ? '0-available' : '1-unavailable'
    if (key === 'position_title') return defaultPositionForRow(item) || 'zzz'
    if (key === 'role') return String(item?.role || '')
    if (key === 'grade') return String(Number(item?.grade || 999)).padStart(3, '0')
    if (key === 'created_desc') {
      const raw = item?.created_at ? Date.parse(item.created_at) : 0
      const ts = Number.isFinite(raw) ? raw : 0
      return String(9999999999999 - ts).padStart(13, '0')
    }
    if (key === 'email') return String(item?.email || '').toLowerCase()
    return ''
  }

  function applyAdminSort(rows, sectionKey) {
    const config = sortConfigs?.[sectionKey] || { mode: 'group_number', keys: [] }
    const activeKeys = config.mode === 'custom'
      ? (config.keys || []).filter(Boolean).slice(0, 5)
      : [config.mode || 'group_number']
    return [...rows].sort((left, right) => {
      for (const sortKey of activeKeys) {
        const av = adminSortValue(left, sortKey)
        const bv = adminSortValue(right, sortKey)
        if (av < bv) return -1
        if (av > bv) return 1
      }
      return Number(left?.id || 0) - Number(right?.id || 0)
    })
  }

  function openSortModal(section) {
    const existing = sortConfigs?.[section]?.keys || []
    setSortModal({ open: true, section, draftKeys: [...existing, '', '', '', ''].slice(0, 5) })
  }

  function applyCustomSort() {
    const keys = (sortModal.draftKeys || []).filter(Boolean)
    const uniqueKeys = Array.from(new Set(keys)).slice(0, 5)
    if (uniqueKeys.length < 2) {
      window.alert('사용자 지정 정렬은 최소 2개의 필터를 설정해야 합니다.')
      return
    }
    setSortConfigs(prev => ({ ...prev, [sortModal.section]: { mode: 'custom', keys: uniqueKeys } }))
    setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })
  }

  function handleSortModeChange(section, mode) {
    if (mode === 'custom') {
      openSortModal(section)
      return
    }
    setSortConfigs(prev => ({ ...prev, [section]: { mode, keys: [] } }))
  }

  const sortedAccountRows = applyAdminSort(accountRows, 'manage')
  const sortedAccountBaseRows = applyAdminSort(accountRowsSortBase, 'manage')
  const sortedAuthorityRows = applyAdminSort(accountRows, 'authority')
  const sortedBranchRows = applyAdminSort(branchRows, 'status')
  const sortedEmployeeRows = applyAdminSort(employeeRows, 'status')

  const pagedAccounts = (() => {
    const start = (accountPage - 1) * ACCOUNTS_PER_PAGE
    return sortedAuthorityRows.slice(start, start + ACCOUNTS_PER_PAGE)
  })()

  const pageCount = Math.max(1, Math.ceil(sortedAuthorityRows.length / ACCOUNTS_PER_PAGE))

  const searchResults = (() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return sortedAuthorityRows.filter(item => `${item.name || ''} ${item.nickname || ''} ${item.email || ''} ${item.account_unique_id || ''} ${item.phone || ''}`.toLowerCase().includes(q))
  })()

  const actorGrade = Number(currentUser?.grade || 6)
  const actorRoleLimit = Number(configForm.role_assign_actor_max_grade || 1)
  const targetRoleFloor = Number(configForm.role_assign_target_min_grade || 7)
  const franchisePositionSet = new Set(['대표', '부대표', '호점대표'])
  const visibleBranchRows = sortedBranchRows.filter(item => !item.archived_in_branch_status)
  const archivedBranchRows = sortedBranchRows.filter(item => item.archived_in_branch_status)
  const franchiseRows = visibleBranchRows.filter(item => franchisePositionSet.has(defaultPositionForRow(item)))
  const fieldEmployeeRows = sortedEmployeeRows.filter(item => item.show_in_field_employee_status || (item.show_in_employee_status && !item.show_in_hq_status && !isHeadOfficeRow(item)))
  const headOfficeRows = sortedEmployeeRows.filter(item => item.show_in_hq_status || (item.show_in_employee_status && isHeadOfficeRow(item)))
  const combinedStatusRows = applyAdminSort([...visibleBranchRows, ...fieldEmployeeRows, ...headOfficeRows.filter(item => !fieldEmployeeRows.some(emp => emp.id === item.id))], 'status')
  const franchiseCount = franchiseRows.length
  const derivedTotalVehicleCount = franchiseRows.filter(item => parseVehicleAvailable(item?.vehicle_available)).length
  const branchStatusCandidates = sortedAccountRows.filter(item => !visibleBranchRows.some(row => row.id === item.id))
  const employeeStatusCandidates = sortedAccountRows.filter(item => !fieldEmployeeRows.some(row => row.id === item.id))
  const headOfficeStatusCandidates = sortedAccountRows.filter(item => !headOfficeRows.some(row => row.id === item.id))
  const deletableAccounts = sortedAccountRows.filter(item => {
    if (Number(item.id) === Number(currentUser?.id || 0)) return false
    if (actorGrade === 1) return true
    if (actorGrade === 2) return Number(item.grade || 6) > 2
    return false
  })
  const selectedSwitchAccount = sortedAccountRows.find(item => Number(item.id) === Number(selectedSwitchAccountId || 0)) || null
  const statusMoveCandidates = {
    branch: branchStatusCandidates,
    employee: employeeStatusCandidates,
    hq: headOfficeStatusCandidates,
  }
  const statusDeleteCandidates = {
    branch: franchiseRows,
    employee: fieldEmployeeRows,
    hq: headOfficeRows,
  }
  const currentStatusCategoryKey = statusTab === 'hq' ? 'hq' : (statusTab === 'employee' ? 'employee' : 'branch')
  const showStatusCategoryActions = actorGrade === 1 && ['branch', 'employee', 'hq'].includes(statusTab)

  function canEditAccountGrade(targetUserId, targetCurrentGrade, nextGrade) {
    if (actorGrade === 1) return true
    if (actorGrade > actorRoleLimit) return false
    const safeCurrentGrade = Number(targetCurrentGrade || 6)
    const safeNextGrade = Number(nextGrade || safeCurrentGrade)
    if (safeCurrentGrade <= actorGrade) return false
    if (safeNextGrade <= actorGrade) return false
    if (safeNextGrade < targetRoleFloor) return false
    if (Number(targetUserId) === Number(currentUser?.id || 0) && safeNextGrade !== safeCurrentGrade) return false
    return true
  }

  function roleOptionsForTarget(target) {
    return ROLE_OPTIONS.map(option => ({
      ...option,
      disabled: !canEditAccountGrade(target.id, target.grade, option.value) || (actorGrade === 2 && option.value <= 2),
    }))
  }

  function defaultPositionForRow(row) {
    return row?.position_title || (Number(row?.branch_no || 0) > 0 ? '호점대표' : '')
  }

  function canEditPosition() {
    return actorGrade <= 2
  }

  function renderActionButton(top, bottom, onClick, extraClass = '') {
    return (
      <button type="button" className={`multiline-action-button ${extraClass}`.trim()} onClick={onClick}>
        <span>{top}<br />{bottom}</span>
      </button>
    )
  }

  function gradeOptionsWithSuffix(suffix) {
    return ROLE_OPTIONS.map(option => (
      <option key={option.value} value={option.value}>{option.label}까지{suffix || ''}</option>
    ))
  }

  function setManagePage(tab, pageNo) {
    setAccountManagePages(prev => ({ ...prev, [tab]: pageNo }))
  }

  function getPagedRows(rows, tab) {
    const pageNo = Number(accountManagePages[tab] || 1)
    const start = (pageNo - 1) * ACCOUNTS_PER_PAGE
    return rows.slice(start, start + ACCOUNTS_PER_PAGE)
  }

  function renderPagination(totalCount, tab) {
    const totalPageCount = Math.max(1, Math.ceil(totalCount / ACCOUNTS_PER_PAGE))
    return (
      <div className="admin-pagination">
        {Array.from({ length: totalPageCount }, (_, index) => index + 1).map(pageNo => (
          <button key={`${tab}-${pageNo}`} type="button" className={(accountManagePages[tab] || 1) === pageNo ? 'small selected-toggle' : 'small ghost'} onClick={() => setManagePage(tab, pageNo)}>{pageNo}</button>
        ))}
      </div>
    )
  }

  const pagedManageList = getPagedRows(sortedAccountRows, 'list')
  const pagedManageDeleteRows = getPagedRows(deletableAccounts, 'delete')
  const pagedManageEditRows = (() => {
    const liveMap = new Map(accountRows.map(item => [Number(item.id), item]))
    const stableRows = sortedAccountBaseRows.map(item => liveMap.get(Number(item.id)) || item)
    return getPagedRows(stableRows, 'edit')
  })()
  const pagedManageSwitchRows = getPagedRows(sortedAccountRows, 'switch')

  if (loading) return <div className="card">관리자 정보를 불러오는 중...</div>
  if (error) return <div className="card error">{error}</div>
  if (!data) return null

  return (
    <div className="admin-mode-page stack-page">
      {message && <div className="success">{message}</div>}

      {actorGrade <= 2 && (
        <section className="card admin-mode-card">
          <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setAccountManageOpen(v => !v)} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setAccountManageOpen(v => !v)
            }
          }}>
            <h2>계정관리</h2>
            <span className="admin-section-chevron">{accountManageOpen ? '−' : '+'}</span>
          </div>

          {accountManageOpen && (
            <div className="stack compact-gap">
              <div className="between admin-section-toolbar account-manage-toolbar-row">
                <div className="inline-actions wrap admin-section-tabbar account-manage-toolbar-left">
                  {accountManageTab !== 'create' && (
                    <select className="small admin-sort-select admin-sort-select-inline account-manage-sort-select" value={sortConfigs.manage.mode} onChange={e => handleSortModeChange('manage', e.target.value)}>
                      {ADMIN_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  )}
                </div>
                <div className="inline-actions wrap admin-section-save-actions account-manage-toolbar-actions">
                  <button type="button" className={accountManageTab === 'list' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('list')}>목록</button>
                  <button type="button" className={accountManageTab === 'edit' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('edit')}>수정</button>
                  <button type="button" className={accountManageTab === 'create' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('create')}>추가</button>
                  <button type="button" className={accountManageTab === 'switch' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('switch')}>전환</button>
                  <button type="button" className={accountManageTab === 'delete' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('delete')}>삭제</button>
                  {accountManageTab === 'create' && actorGrade <= 2 && (
                    <button type="submit" form="admin-create-account-form" className="small">계정생성</button>
                  )}
                  {accountManageTab === 'edit' && actorGrade <= 2 && (
                    <button type="button" className="small" onClick={saveAccountEdits}>저장</button>
                  )}
                  {accountManageTab === 'delete' && actorGrade <= 2 && (
                    <button type="button" className="small danger" onClick={requestDeleteAccounts}>삭제</button>
                  )}
                  {accountManageTab === 'switch' && actorGrade <= 2 && (
                    <>
                      <button type="button" className="small" onClick={() => switchAccountType('business')} disabled={switchLoading || !selectedSwitchAccount || selectedSwitchAccount?.account_type === 'business' || (actorGrade === 2 && Number(selectedSwitchAccount?.grade || 6) <= 2)}>사업자 전환</button>
                      <button type="button" className="small ghost" onClick={() => switchAccountType('employee')} disabled={switchLoading || !selectedSwitchAccount || selectedSwitchAccount?.account_type === 'employee' || (actorGrade === 2 && Number(selectedSwitchAccount?.grade || 6) <= 2)}>직원 전환</button>
                    </>
                  )}
                </div>
              </div>

              {accountManageTab === 'list' && (
                <>
                  <div className="admin-account-list-grid">
                    {pagedManageList.map(item => {
                      const isOpen = !!accountListOpen[item.id]
                      return (
                        <div key={`account-manage-list-${item.id}`} className="list-item block admin-detail-card compact-card collapsible-account-card">
                          <button type="button" className="admin-account-summary-button admin-account-summary-button-list" onClick={() => toggleAccountListRow(item.id)} aria-expanded={isOpen}>
                            <div className="admin-account-summary-line admin-account-summary-line-primary">
                              <span>[{groupNumberDisplay(item)}]</span>
                              <span>[{item.name || '-'}]</span>
                              <span>[{item.login_id || '-'}]</span>
                              <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                              <span>[{gradeLabel(item.grade)}]</span>
                            </div>
                            <div className="admin-account-summary-line admin-account-summary-line-secondary">
                              <span>[{item.account_unique_id || '-'}]</span>
                              <span>[{item.recovery_email || '-'}]</span>
                            </div>
                          </button>
                          {isOpen && (
                            <div className="admin-account-list-body">
                              <div><strong>구분숫자</strong> {groupNumberDisplay(item)}</div>
                              <div><strong>아이디</strong> {item.login_id || item.email || '-'}</div>
                              <div><strong>고유ID값</strong> {item.account_unique_id || '-'}</div>
                              <div><strong>이름</strong> {item.name || '-'}</div>
                              <div><strong>닉네임</strong> {item.nickname || '-'}</div>
                              <div><strong>직급</strong> {defaultPositionForRow(item) || '미지정'}</div>
                              <div><strong>권한등급</strong> {gradeLabel(item.grade)}</div>
                              <div><strong>연락처</strong> {item.phone || '-'}</div>
                              <div><strong>복구이메일</strong> {item.recovery_email || '-'}</div>
                              <div><strong>성별</strong> {item.gender || '-'}</div>
                              <div><strong>출생연도</strong> {item.birth_year || '-'}</div>
                              <div><strong>지역</strong> {item.region || '-'}</div>
                              <div><strong>차량번호</strong> {item.vehicle_number || '-'}</div>
                              <div><strong>호점</strong> {branchDisplayLabel(item.branch_no, '-')}</div>
                              <div><strong>결혼여부</strong> {item.marital_status || '-'}</div>
                              <div><strong>거주지주소</strong> {item.resident_address || '-'}</div>
                              <div><strong>사업자명</strong> {item.business_name || '-'}</div>
                              <div><strong>사업자번호</strong> {item.business_number || '-'}</div>
                              <div><strong>업태</strong> {item.business_type || '-'}</div>
                              <div><strong>종목</strong> {item.business_item || '-'}</div>
                              <div><strong>사업장주소</strong> {item.business_address || '-'}</div>
                              <div><strong>계좌번호</strong> {item.bank_account || '-'}</div>
                              <div><strong>은행명</strong> {item.bank_name || '-'}</div>
                              <div><strong>MBTI</strong> {item.mbti || '-'}</div>
                              <div><strong>구글이메일</strong> {item.google_email || '-'}</div>
                              <div><strong>주민등록번호</strong> {item.resident_id || '-'}</div>
                              <div><strong>승인상태</strong> {item.approved ? '승인됨' : '미승인'}</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {renderPagination(sortedAccountRows.length, 'list')}
                </>
              )}

              {accountManageTab === 'create' && (
                <form id="admin-create-account-form" onSubmit={submitCreateAccount} className="stack">
                  <div className="admin-inline-grid compact-inline-grid">
                    <label>이름 <input autoComplete="name" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} /></label>
                    <label>로그인 아이디 <input autoComplete="username" value={createForm.login_id} onChange={e => setCreateForm({ ...createForm, login_id: normalizeFlexibleLoginId(e.target.value) })} /></label>
                    <label>실제 이메일 <input type="email" autoComplete="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} /></label>
                    <label>구글용 이메일 <input type="email" value={createForm.google_email} onChange={e => setCreateForm({ ...createForm, google_email: e.target.value })} /></label>
                    <label>비밀번호 <input type="password" autoComplete="new-password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} /></label>
                    <label>닉네임 <input autoComplete="nickname" value={createForm.nickname} onChange={e => setCreateForm({ ...createForm, nickname: e.target.value })} /></label>
                    <label>성별 <select value={createForm.gender} onChange={e => setCreateForm({ ...createForm, gender: e.target.value })}><option value="">선택</option>{GENDER_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label>출생연도 <input value={createForm.birth_year} onChange={e => setCreateForm({ ...createForm, birth_year: e.target.value })} /></label>
                    <label>지역 <input value={createForm.region} onChange={e => setCreateForm({ ...createForm, region: e.target.value })} /></label>
                    <label>연락처 <input autoComplete="tel" value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} /></label>
                    <label>복구이메일 <input value={createForm.recovery_email} onChange={e => setCreateForm({ ...createForm, recovery_email: e.target.value })} /></label>
                    <label>계정상태
                      <select value={createForm.account_status} onChange={e => setCreateForm({ ...createForm, account_status: e.target.value })}>
                        <option value="active">사용중</option>
                        <option value="pending">승인대기</option>
                        <option value="suspended">일시정지</option>
                        <option value="retired">퇴사/종료</option>
                        <option value="deleted">계정삭제</option>
                      </select>
                    </label>
                    <label>차량번호 <input value={createForm.vehicle_number} onChange={e => setCreateForm({ ...createForm, vehicle_number: e.target.value })} /></label>
                    <label>호점
                      <select value={createForm.branch_no} onChange={e => setCreateForm({ ...createForm, branch_no: e.target.value })}>
                        <option value="">선택 안 함</option>
                        {BRANCH_NUMBER_OPTIONS.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
                      </select>
                    </label>
                    <label>권한등급
                      <select value={Number(createForm.grade)} onChange={e => setCreateForm({ ...createForm, grade: Number(e.target.value) })}>
                        {roleOptionsForTarget(createForm).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>직급
                      <select value={Number(createForm.branch_no || '') > 0 ? '호점대표' : (createForm.position_title || '')} onChange={e => setCreateForm({ ...createForm, position_title: e.target.value })} disabled={Number(createForm.branch_no || '') > 0}>
                        <option value="">미지정</option>
                        {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="check"><input type="checkbox" checked={!!createForm.approved} onChange={e => setCreateForm({ ...createForm, approved: e.target.checked })} /> 승인됨</label>
                  </div>
                </form>
              )}

              {accountManageTab === 'switch' && (
                <>
                  <div className="muted">계정을 선택한 뒤 우측 상단의 사업자 전환 / 직원 전환 버튼을 눌러 전환하세요. 기존 계정 정보는 유지됩니다.</div>
                  <div className="admin-account-switch-list">
                    {pagedManageSwitchRows.map(item => {
                      const isSelected = Number(selectedSwitchAccountId || 0) === Number(item.id)
                      return (
                        <button type="button" key={`account-switch-${item.id}`} className={`admin-account-switch-row ${isSelected ? 'selected' : ''}`.trim()} onClick={() => setSelectedSwitchAccountId(item.id)}>
                          <div className="admin-account-switch-main">
                            <strong>[{item.name || item.nickname || '-'}]</strong>
                            <span>[{item.login_id || '-'}]</span>
                            <span>[{item.account_unique_id || '-'}]</span>
                          </div>
                          <div className="admin-account-switch-sub muted">
                            <span>현재유형 : {item.account_type === 'business' ? '사업자' : '직원'}</span>
                            <span>직급 : {defaultPositionForRow(item) || '미지정'}</span>
                            <span>권한 : {gradeLabel(item.grade)}</span>
                          </div>
                        </button>
                      )
                    })}
                    {!sortedAccountRows.length && <div className="muted">전환할 계정이 없습니다.</div>}
                  </div>
                  {renderPagination(sortedAccountRows.length, 'switch')}
                </>
              )}

              {accountManageTab === 'edit' && (
                <>
                  <div className="admin-account-edit-list">
                    {pagedManageEditRows.map(item => {
                      const isOpen = !!accountEditOpen[item.id]
                      return (
                        <div key={`account-edit-${item.id}`} className="list-item block admin-detail-card compact-card collapsible-account-card">
                          <button type="button" className="admin-account-summary-button admin-account-summary-button-edit" onClick={() => toggleAccountEditRow(item.id)} aria-expanded={isOpen}>
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{item.name || '-'}]</span>
                            <span>[{item.login_id || '-'}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                            <span>[{gradeLabel(item.grade)}]</span>
                          </button>
                          {isOpen && (
                            <div className="admin-inline-grid compact-inline-grid admin-edit-expanded-grid">
                              <label>구분숫자 <input type="text" inputMode="numeric" pattern="[0-9]*" value={groupNumberDisplay(item)} onChange={e => { const nextValue = e.target.value.replace(/[^0-9]/g, ''); updateAccountRow(item.id, { group_number: nextValue === '' ? '0' : nextValue, group_number_text: nextValue === '' ? '0' : nextValue }) }} /></label>
                              <label>이름 <input value={item.name || ''} onChange={e => updateAccountRow(item.id, { name: e.target.value })} /></label>
                              <label>닉네임 <input value={item.nickname || ''} onChange={e => updateAccountRow(item.id, { nickname: e.target.value })} /></label>
                              <form id={`account-edit-form-${item.id}`} onSubmit={e => e.preventDefault()} style={{ display: 'none' }} />
                              <label>아이디 <input autoComplete="username" value={item.login_id || ''} onChange={e => updateAccountRow(item.id, { login_id: normalizeFlexibleLoginId(e.target.value) })} /></label>
                              <label>비밀번호 <input form={`account-edit-form-${item.id}`} type="password" autoComplete="new-password" value={item.new_password || ''} onChange={e => updateAccountRow(item.id, { new_password: e.target.value })} placeholder="변경 시에만 입력" /></label>
                              <label>고유ID값 <input value={item.account_unique_id || ''} onChange={e => updateAccountRow(item.id, { account_unique_id: e.target.value })} /></label>
                              <label>직급
                                <select value={defaultPositionForRow(item)} onChange={e => updateAccountRow(item.id, { position_title: e.target.value })}>
                                  <option value="">미지정</option>
                                  {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                              </label>
                              <label>권한등급
                                <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2}>
                                  {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                                </select>
                              </label>
                              <label>연락처 <input value={item.phone || ''} onChange={e => updateAccountRow(item.id, { phone: e.target.value })} /></label>
                              <label>복구이메일 <input value={item.recovery_email || ''} onChange={e => updateAccountRow(item.id, { recovery_email: e.target.value })} /></label>
                              <label>성별 <select value={item.gender || ''} onChange={e => updateAccountRow(item.id, { gender: e.target.value })}><option value="">선택</option>{GENDER_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
                              <label>출생연도 <input value={item.birth_year || ''} onChange={e => updateAccountRow(item.id, { birth_year: e.target.value })} /></label>
                              <label>지역 <input value={item.region || ''} onChange={e => updateAccountRow(item.id, { region: e.target.value })} /></label>
                              <label>차량번호 <input value={item.vehicle_number || ''} onChange={e => updateAccountRow(item.id, { vehicle_number: e.target.value })} /></label>
                              <label>호점
                                <select value={isAssignedBranchNo(item.branch_no) ? String(item.branch_no) : ''} onChange={e => updateAccountRow(item.id, { branch_no: normalizeBranchNo(e.target.value) })} disabled={actorGrade > 2}>
                                  <option value="">선택 안 함</option>
                                  {BRANCH_NUMBER_OPTIONS.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
                                </select>
                              </label>
                              <label>결혼여부 <input value={item.marital_status || ''} onChange={e => updateAccountRow(item.id, { marital_status: e.target.value })} /></label>
                              <label>거주지주소 <input value={item.resident_address || ''} onChange={e => updateAccountRow(item.id, { resident_address: e.target.value })} /></label>
                              <label>사업자명 <input value={item.business_name || ''} onChange={e => updateAccountRow(item.id, { business_name: e.target.value })} /></label>
                              <label>사업자번호 <input value={item.business_number || ''} onChange={e => updateAccountRow(item.id, { business_number: e.target.value })} /></label>
                              <label>업태 <input value={item.business_type || ''} onChange={e => updateAccountRow(item.id, { business_type: e.target.value })} /></label>
                              <label>종목 <input value={item.business_item || ''} onChange={e => updateAccountRow(item.id, { business_item: e.target.value })} /></label>
                              <label>사업장주소 <input value={item.business_address || ''} onChange={e => updateAccountRow(item.id, { business_address: e.target.value })} /></label>
                              <label>계좌번호 <input value={item.bank_account || ''} onChange={e => updateAccountRow(item.id, { bank_account: e.target.value })} /></label>
                              <label>은행명 <input value={item.bank_name || ''} onChange={e => updateAccountRow(item.id, { bank_name: e.target.value })} /></label>
                              <label>MBTI <input value={item.mbti || ''} onChange={e => updateAccountRow(item.id, { mbti: e.target.value })} /></label>
                              <label>구글이메일 <input value={item.google_email || ''} onChange={e => updateAccountRow(item.id, { google_email: e.target.value })} /></label>
                              <label>주민등록번호 <input value={item.resident_id || ''} onChange={e => updateAccountRow(item.id, { resident_id: e.target.value })} /></label>
                              <label className="check"><input type="checkbox" checked={!!item.show_in_branch_status} onChange={e => updateAccountRow(item.id, { show_in_branch_status: e.target.checked, show_in_field_employee_status: false, show_in_hq_status: false, show_in_employee_status: false })} /> 가맹현황 포함</label>
                              <label className="check"><input type="checkbox" checked={!!item.show_in_field_employee_status} onChange={e => updateAccountRow(item.id, { show_in_branch_status: false, show_in_field_employee_status: e.target.checked, show_in_hq_status: false, show_in_employee_status: e.target.checked })} /> 현장직원 포함</label>
                              <label className="check"><input type="checkbox" checked={!!item.show_in_hq_status} onChange={e => updateAccountRow(item.id, { show_in_branch_status: false, show_in_field_employee_status: false, show_in_hq_status: e.target.checked, show_in_employee_status: e.target.checked })} /> 본사직원 포함</label>
                              <label className="check"><input type="checkbox" checked={!!item.approved} onChange={e => updateAccountRow(item.id, { approved: e.target.checked })} /> 승인됨</label>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {renderPagination(sortedAccountRows.length, 'edit')}
                </>
              )}

              {accountManageTab === 'delete' && (
                <>
                  <div className="admin-delete-list">
                    {pagedManageDeleteRows.map(item => (
                      <label key={`delete-${item.id}`} className="admin-delete-row">
                        <input type="checkbox" checked={!!accountDeleteSelection[item.id]} onChange={() => toggleDeleteSelection(item.id)} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2} />
                        <span className="admin-delete-row-text">[{item.name || item.nickname || '이름 미입력'}] [{item.email || '-'}] [{item.account_unique_id || '-'}]</span>
                      </label>
                    ))}
                    {!deletableAccounts.length && <div className="muted">삭제 가능한 계정이 없습니다.</div>}
                  </div>
                  {renderPagination(deletableAccounts.length, 'delete')}
                </>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle admin-status-head" role="button" tabIndex={0} onClick={() => setStatusOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setStatusOpen(v => !v)
          }
        }}>
          <div className="inline-actions wrap admin-status-title-row">
            <h2>운영현황</h2>
            {statusOpen && (
              <div className="inline-actions wrap admin-status-category-tabs" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                <button type="button" className={statusTab === 'all' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('all')}>전체</button>
                <button type="button" className={statusTab === 'branch' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('branch')}>가맹대표</button>
                <button type="button" className={statusTab === 'employee' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('employee')}>현장직원</button>
                <button type="button" className={statusTab === 'hq' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('hq')}>본사직원</button>
              </div>
            )}
          </div>
          <span className="admin-section-chevron">{statusOpen ? '−' : '+'}</span>
        </div>
        {statusOpen && (
          <>
            <div className="between admin-section-toolbar admin-status-toolbar">
              <div className="inline-actions wrap admin-status-toolbar-spacer" />
              <div className="inline-actions wrap admin-section-save-actions">
                {actorGrade === 1 && ((statusTab === 'all' || statusTab === 'branch')
                  ? <button type="button" className="small" onClick={saveBranchDetails}>저장</button>
                  : <button type="button" className="small" onClick={saveEmployeeDetails}>저장</button>)}
                {showStatusCategoryActions && <button type="button" className="multiline-action-button" onClick={() => {
                  const key = currentStatusCategoryKey
                  setStatusMovePickerOpen(prev => ({ ...prev, [key]: !prev[key] }))
                  setStatusDeletePickerOpen(prev => ({ ...prev, [key]: false }))
                }}><span>계정정보<br />옮겨오기</span></button>}
                {actorGrade === 1 && <button type="button" className={((statusTab === 'all' || statusTab === 'branch') ? branchEditMode : employeeEditMode) ? 'small selected-toggle' : 'small ghost'} onClick={() => {
                  if (statusTab === 'all' || statusTab === 'branch') setBranchEditMode(v => !v)
                  else setEmployeeEditMode(v => !v)
                }}>수정</button>}
                {actorGrade === 1 && statusTab === 'branch' && <button type="button" className="small ghost" onClick={() => { setBranchArchiveModalOpen(true); setBranchArchiveMode('archive') }}>보관</button>}
                {showStatusCategoryActions && <button type="button" className={statusDeletePickerOpen[currentStatusCategoryKey] ? 'small selected-toggle' : 'small ghost'} onClick={() => {
                  const key = currentStatusCategoryKey
                  setStatusDeletePickerOpen(prev => ({ ...prev, [key]: !prev[key] }))
                  setStatusMovePickerOpen(prev => ({ ...prev, [key]: false }))
                }}>삭제</button>}
              </div>
            </div>
            {showStatusCategoryActions && statusMovePickerOpen[currentStatusCategoryKey] && (
              <div className="admin-status-add-row">
                <select value={statusMoveSelection[currentStatusCategoryKey]} onChange={e => setStatusMoveSelection(prev => ({ ...prev, [currentStatusCategoryKey]: e.target.value }))}>
                  <option value="">옮겨올 계정 선택</option>
                  {(statusMoveCandidates[currentStatusCategoryKey] || []).map(item => (
                    <option key={`${currentStatusCategoryKey}-candidate-${item.id}`} value={item.id}>
                      {(item.name || item.nickname || '이름 미입력')} / {item.email || '-'} / {item.account_unique_id || '-'}
                    </option>
                  ))}
                </select>
                <button type="button" className="small" onClick={() => addAccountToStatus(currentStatusCategoryKey)}>옮겨오기</button>
              </div>
            )}
            {showStatusCategoryActions && statusDeletePickerOpen[currentStatusCategoryKey] && (
              <div className="admin-status-add-row">
                <select value={statusDeleteSelection[currentStatusCategoryKey]} onChange={e => setStatusDeleteSelection(prev => ({ ...prev, [currentStatusCategoryKey]: e.target.value }))}>
                  <option value="">삭제할 계정 선택</option>
                  {(statusDeleteCandidates[currentStatusCategoryKey] || []).map(item => (
                    <option key={`${currentStatusCategoryKey}-delete-${item.id}`} value={item.id}>
                      {(item.name || item.nickname || '이름 미입력')} / {item.email || '-'} / {item.account_unique_id || '-'}
                    </option>
                  ))}
                </select>
                <button type="button" className="small ghost" onClick={() => removeAccountFromStatus(currentStatusCategoryKey)}>삭제하기</button>
              </div>
            )}
            {(statusTab === 'all' || statusTab === 'branch') && (
              <>
                <div className="admin-subtitle-row admin-status-metric-row">
                  <div className="admin-subtitle">가맹현황/상세정보</div>
                  <div className="admin-status-inline-metrics">
                    <label><span>가맹현황수</span><input value={String(franchiseCount || 0)} readOnly /></label>
                    <label><span>총차량수</span><input value={String(derivedTotalVehicleCount || 0)} readOnly /></label>
                  </div>
                </div>
                <div className="list">
                  {(statusTab === 'all' ? combinedStatusRows.filter(item => franchiseRows.some(branch => branch.id === item.id)) : franchiseRows).map(item => (
                    <div key={item.id} className="list-item block admin-detail-card compact-card">
                      <div className="between admin-detail-summary-row admin-detail-summary-row-clickable" onClick={() => toggleBranch(item.id)}>
                        <div className="admin-summary-lines branch-summary-lines">
                          <div className="admin-summary-line admin-summary-line-primary">
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                            <span>[{isAssignedBranchNo(item.branch_no) ? branchDisplayLabel(item.branch_no) : (/^0+$/.test(groupNumberDisplay(item)) ? '본점' : '미지정')}]</span>
                            <span>[{item.name || item.nickname || '이름 미입력'}]</span>
                            <span>[{item.phone || '연락처 미입력'}]</span>
                          </div>
                        </div>
                      </div>
                      {branchOpen[item.id] && (
                        <div className="stack compact-gap admin-detail-stack">
                          <div className="admin-inline-grid compact-inline-grid">
                            <label>이름 <input value={item.name || ''} onChange={e => updateBranchRow(item.id, { name: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>닉네임 <input value={item.nickname || ''} onChange={e => updateBranchRow(item.id, { nickname: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>연락처 <input value={item.phone || ''} onChange={e => updateBranchRow(item.id, { phone: e.target.value })} disabled={!branchEditMode} /></label>
                          </div>
                          <div className="admin-inline-grid compact-inline-grid">
                            <label>차량번호 <input value={item.vehicle_number || ''} onChange={e => updateBranchRow(item.id, { vehicle_number: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>직급 <input value={defaultPositionForRow(item)} onChange={e => updateBranchRow(item.id, { position_title: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>호점 <input value={isAssignedBranchNo(item.branch_no) ? String(item.branch_no) : (/^0+$/.test(groupNumberDisplay(item)) ? '본점' : '')} onChange={e => updateBranchRow(item.id, { branch_no: e.target.value === '본점' ? 0 : e.target.value })} disabled={!branchEditMode} /></label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {(statusTab === 'all' || statusTab === 'employee') && (
              <>
                <div className="admin-subtitle-row admin-status-metric-row">
                  <div className="admin-subtitle">현장직원/상세보기</div>
                  <div className="admin-status-inline-metrics single">
                    <label><span>현장직원수</span><input value={String(fieldEmployeeRows.length || 0)} readOnly /></label>
                  </div>
                </div>
                <div className="list">
                  {(statusTab === 'all' ? fieldEmployeeRows : fieldEmployeeRows).map(item => (
                    <div key={item.id} className="list-item block admin-detail-card compact-card">
                      <div className="between admin-detail-summary-row admin-detail-summary-row-clickable" onClick={() => toggleEmployee(item.id)}>
                        <div className="admin-summary-lines employee-summary-lines">
                          <div className="admin-summary-line admin-summary-line-primary">
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                            <span>[{item.name || item.nickname || '이름 미입력'}]</span>
                            <span>[{item.google_email || '구글 이메일 미입력'}]</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {(statusTab === 'all' || statusTab === 'hq') && (
              <>
                <div className="admin-subtitle-row admin-status-metric-row">
                  <div className="admin-subtitle">본사직원/상세보기</div>
                  <div className="admin-status-inline-metrics single">
                    <label><span>본사직원수</span><input value={String(headOfficeRows.length || 0)} readOnly /></label>
                  </div>
                </div>
                <div className="list">
                  {headOfficeRows.map(item => (
                    <div key={item.id} className="list-item block admin-detail-card compact-card">
                      <div className="between admin-detail-summary-row">
                        <div className="admin-summary-lines employee-summary-lines">
                          <div className="admin-summary-line admin-summary-line-primary">
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                            <span>[{item.name || item.nickname || '이름 미입력'}]</span>
                            <span>[{item.google_email || '구글 이메일 미입력'}]</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {branchArchiveModalOpen && createPortal(
              <div className="modal-overlay" onClick={() => setBranchArchiveModalOpen(false)}>
                <div className="modal-card" onClick={e => e.stopPropagation()}>
                  <div className="between">
                    <strong>보관함</strong>
                    <button type="button" className="small ghost" onClick={() => setBranchArchiveModalOpen(false)}>닫기</button>
                  </div>
                  <div className="inline-actions wrap">
                    <button type="button" className={branchArchiveMode === 'archive' ? 'small selected-toggle' : 'small ghost'} onClick={() => setBranchArchiveMode('archive')}>보관하기</button>
                    <button type="button" className={branchArchiveMode === 'restore' ? 'small selected-toggle' : 'small ghost'} onClick={() => setBranchArchiveMode('restore')}>불러오기</button>
                  </div>
                  <div className="admin-status-add-row">
                    <select value={branchArchiveSelection} onChange={e => setBranchArchiveSelection(e.target.value)}>
                      <option value="">{branchArchiveMode === 'archive' ? '보관할 가맹 선택' : '불러올 가맹 선택'}</option>
                      {(branchArchiveMode === 'archive' ? franchiseRows : archivedBranchRows).map(item => (
                        <option key={`archive-${item.id}`} value={item.id}>{item.name || item.nickname || '이름 미입력'} / {item.phone || '-'} / {branchDisplayLabel(item.branch_no)}</option>
                      ))}
                    </select>
                    <button type="button" className="small" onClick={() => toggleBranchArchive(branchArchiveMode === 'archive')}>{branchArchiveMode === 'archive' ? '보관하기' : '불러오기'}</button>
                  </div>
                  <div className="stack compact-gap">
                    {(archivedBranchRows.length ? archivedBranchRows : []).map(item => (
                      <div key={`archived-row-${item.id}`} className="quick-edit-row">
                        <span>{item.name || item.nickname || '이름 미입력'} / {item.phone || '-'} / {branchDisplayLabel(item.branch_no)}</span>
                      </div>
                    ))}
                    {archivedBranchRows.length === 0 && <div className="muted">보관된 가맹 정보가 없습니다.</div>}
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setAuthorityOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setAuthorityOpen(v => !v)
          }
        }}>
          <h2>계정권한</h2>
          <span className="admin-section-chevron">{authorityOpen ? '−' : '+'}</span>
        </div>
        {authorityOpen && (
          <>
            <div className="between admin-section-toolbar authority-toolbar-row">
              <div className="inline-actions wrap admin-section-tabbar authority-toolbar-left">
                <select className="small admin-sort-select admin-sort-select-inline authority-sort-select" value={sortConfigs.authority.mode} onChange={e => handleSortModeChange('authority', e.target.value)}>
                  {ADMIN_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="inline-actions wrap admin-section-save-actions authority-toolbar-actions">
                <button type="button" className="small" onClick={saveAccounts}>저장</button>
                {actorGrade === 1 && <button type="button" className="small ghost" onClick={() => navigate('/menu-permissions')}>메뉴권한</button>}
                <button type="button" className="small ghost admin-search-icon" onClick={() => setSearchOpen(true)}>검색</button>
              </div>
            </div>
            <div ref={pendingApprovalSectionRef} className="signup-approval-section">
              <div className="between signup-approval-section-head">
                <strong>회원가입 승인대기 목록</strong>
                <span className="muted small-text">대기 {pendingSignupAccounts.length}건</span>
              </div>
              {pendingSignupAccounts.length === 0 ? (
                <div className="muted signup-approval-empty">승인 대기 중인 회원가입 신청이 없습니다.</div>
              ) : (
                <div className="signup-approval-list">
                  {pendingSignupAccounts.map(item => (
                    <div key={`pending-signup-${item.id}`} className="signup-approval-row">
                      <div className="signup-approval-meta">
                        <strong>{item.name || item.nickname || '이름 미입력'}</strong>
                        <span>{item.email || '-'}</span>
                        <span>{item.phone || '-'}</span>
                        <span>{item.created_at ? String(item.created_at).replace('T', ' ').slice(0, 16) : '-'}</span>
                      </div>
                      <div className="signup-approval-actions">
                        <button type="button" className="small" onClick={() => approvePendingSignup(item)}>승인</button>
                        <button type="button" className="small ghost" onClick={() => rejectPendingSignup(item)}>거절</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="admin-account-table">
          {pagedAccounts.map(item => (
            <div key={item.id} className="admin-account-grid compact labeled-account-grid authority-grid-8 authority-grid-responsive">
              <div className="admin-select-field locked-field admin-field-group"><span>구분</span><input value={groupNumberDisplay(item)} readOnly disabled /></div>
              <div className="admin-select-field locked-field admin-field-branch"><span>호점</span><input value={isAssignedBranchNo(item.branch_no) ? String(item.branch_no) : ''} readOnly disabled /></div>
              <div className="admin-select-field locked-field admin-field-name"><span>이름</span><input value={item.name || item.nickname || ''} readOnly disabled /></div>
              <div className="admin-select-field locked-field admin-field-id"><span>아이디</span><input value={item.login_id || item.email || ''} readOnly disabled /></div>
              <label className="admin-select-field admin-field-vehicle-available">
                <span>차량가용여부</span>
                <select value={vehicleAvailableSelectValue(item)} onChange={e => updateAccountRow(item.id, { vehicle_available: e.target.value === '가용' })} disabled={isStaffGradeValue(item?.grade)}>
                  <option value="가용">가용</option>
                  <option value="불가">불가</option>
                </select>
              </label>
              <label className="admin-select-field admin-action-field admin-field-vehicle-exception">
                <span>차량열외</span>
                <button type="button" className="small ghost" onClick={() => openVehicleExceptionModal(item)} disabled={isStaffGradeValue(item?.grade)}>차량열외</button>
              </label>
              <label className="admin-select-field admin-field-position">
                <span>직급</span>
                <select value={defaultPositionForRow(item)} onChange={e => updateAccountRow(item.id, { position_title: e.target.value })} disabled={!canEditPosition(item)}>
                  <option value="">미지정</option>
                  {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="admin-select-field admin-field-grade">
                <span>계정권한</span>
                <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2}>
                  {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>
            <div className="admin-pagination">
              {Array.from({ length: pageCount }, (_, index) => index + 1).map(pageNo => (
                <button key={pageNo} type="button" className={accountPage === pageNo ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountPage(pageNo)}>{pageNo}</button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setMaterialsRequestDeleteOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setMaterialsRequestDeleteOpen(v => !v)
          }
        }}>
          <h2>자재신청현황삭제</h2>
          <span className="admin-section-chevron">{materialsRequestDeleteOpen ? '−' : '+'}</span>
        </div>
        {materialsRequestDeleteOpen && (
          <div className="stack compact-gap materials-table-admin-editor-body materials-table-admin-section-body">
            <div className="admin-inline-grid compact-inline-grid materials-table-admin-controls">
              <label>계정
                <select value={materialsRequestDeleteFilters.userId} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, userId: e.target.value }))}>
                  <option value="all">전체 계정</option>
                  {accountRows.map(item => (
                    <option key={`materials-delete-user-${item.id}`} value={item.id}>
                      {item.name || item.nickname || item.email || `계정 ${item.id}`} / {item.email || '-'}
                    </option>
                  ))}
                </select>
              </label>
              <label>상태
                <select value={materialsRequestDeleteFilters.status} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, status: e.target.value }))}>
                  <option value="all">전체</option>
                  <option value="pending">신청접수</option>
                  <option value="rejected">반려됨</option>
                  <option value="settled">결산완료</option>
                </select>
              </label>
              <label>시작일
                <input type="date" value={materialsRequestDeleteFilters.startDate} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, startDate: e.target.value }))} />
              </label>
              <label>종료일
                <input type="date" value={materialsRequestDeleteFilters.endDate} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, endDate: e.target.value }))} />
              </label>
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" disabled={materialsRequestDeleteLoading} onClick={() => loadMaterialsDeleteRequests()}>조회</button>
              <button type="button" className="small ghost" disabled={materialsRequestDeleteSubmitting || materialsRequestDeleteLoading} onClick={deleteMaterialsDeleteRequests}>삭제</button>
            </div>
            <div className="admin-account-table materials-admin-delete-table">
              {materialsRequestDeleteLoading ? (
                <div className="muted">불러오는 중...</div>
              ) : materialsRequestDeleteRows.length ? materialsRequestDeleteRows.map(request => {
                const meta = parseRequesterMeta(request)
                const checked = materialsRequestDeleteSelection.includes(request.id)
                return (
                  <label key={`materials-delete-row-${request.id}`} className="materials-admin-delete-row">
                    <div className="materials-admin-delete-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => setMaterialsRequestDeleteSelection(prev => e.target.checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))}
                      />
                    </div>
                    <div>{formatRequesterBranchLabel(meta.branch)}</div>
                    <div>{meta.name}</div>
                    <div>{meta.uniqueId || '-'}</div>
                    <div>{formatFullDateLabel(request.created_at)}</div>
                    <div>{materialsStageStatusLabel(request.status)}</div>
                    <div>{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</div>
                  </label>
                )
              }) : (
                <div className="muted">조건에 맞는 신청현황이 없습니다.</div>
              )}
            </div>
            <div className="muted tiny-text">선택한 신청현황은 모든 계정 화면에서 즉시 삭제됩니다.</div>
          </div>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setMaterialsTableSizeOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setMaterialsTableSizeOpen(v => !v)
          }
        }}>
          <h2>표 사이즈 조절</h2>
          <span className="admin-section-chevron">{materialsTableSizeOpen ? '−' : '+'}</span>
        </div>
        {materialsTableSizeOpen && (
          <div className="stack compact-gap materials-table-admin-editor-body materials-table-admin-section-body">
            <div className="admin-inline-grid compact-inline-grid materials-table-admin-controls">
              <label>기능
                <select value={materialsTableEditor.mode} onChange={e => updateMaterialsTableEditorField('mode', e.target.value)}>
                  {MATERIALS_TABLE_EDIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>화면
                <select value={materialsTableEditor.target} onChange={e => updateMaterialsTableEditorField('target', e.target.value)}>
                  {MATERIALS_TABLE_TARGET_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            {materialsTableEditor.mode === 'width' ? (
              <div className="materials-table-admin-width-list">
                {(MATERIALS_TABLE_COLUMN_LABELS[materialsTableEditor.target] || []).map((label, index) => (
                  <label key={`materials-table-width-${materialsTableEditor.target}-${index}`} className="materials-table-admin-width-row">
                    <span>{label}</span>
                    <input type="number" min="56" max="360" step="1" value={materialsTableLayouts[materialsTableEditor.target]?.[index] ?? ''} onChange={e => updateMaterialsTableWidth(materialsTableEditor.target, index, e.target.value)} />
                  </label>
                ))}
              </div>
            ) : (
              <label className="materials-table-admin-scale-field">
                <span>표 가로 배율 (%)</span>
                <input type="number" min="80" max="140" step="1" value={materialsTableScaleSettings[materialsTableEditor.target] ?? 100} onChange={e => setMaterialsTableScaleSettings(prev => ({ ...prev, [materialsTableEditor.target]: clampMaterialsScale(e.target.value) }))} />
              </label>
            )}
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" disabled={materialsTableSaving} onClick={() => saveMaterialsTableEditor()}>저장</button>
            </div>
            <div className="muted tiny-text">저장 시 모든 계정에 동일하게 적용됩니다.</div>
          </div>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setMenuLockOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setMenuLockOpen(v => !v)
          }
        }}>
          <h2>메뉴잠금</h2>
          <span className="admin-section-chevron">{menuLockOpen ? '−' : '+'}</span>
        </div>
        {menuLockOpen && (
          <div className="stack compact-gap materials-table-admin-editor-body materials-table-admin-section-body">
            <div className="menu-lock-admin-list">
              {MENU_PERMISSION_SECTIONS.map(section => {
                const items = MENU_LOCK_ITEMS.filter(item => item.sectionId === section.id)
                if (!items.length) return null
                return (
                  <div key={`menu-lock-section-${section.id}`} className="card menu-lock-admin-section">
                    <div className="between">
                      <strong>{section.label}</strong>
                      <span className="muted small-text">관리자 / 부관리자는 항상 사용 가능</span>
                    </div>
                    <div className="stack compact-gap menu-lock-admin-items">
                      {items.map(item => {
                        const enabled = !!menuLockMap?.[item.id]
                        return (
                          <div key={`menu-lock-item-${item.id}`} className="quick-edit-row menu-lock-admin-row">
                            <span>{item.label}</span>
                            <button type="button" className={enabled ? 'small selected-toggle' : 'small ghost danger'} onClick={() => toggleMenuLock(item.id)}>
                              {enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" disabled={menuLockSaving} onClick={saveMenuLocks}>{menuLockSaving ? '저장중...' : '저장'}</button>
            </div>
            <div className="muted tiny-text">OFF로 저장하면 해당 메뉴는 관리자/부관리자를 제외한 계정에서 숨김 처리되고, 직접 경로 접근도 차단됩니다.</div>
          </div>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head">
          <div>
            <h2>개발자기능</h2>
            <div className="muted tiny-text">테두리표시 / HTML 요소확인 / 텍스트 편집을 한 곳에서 제어합니다.</div>
          </div>
        </div>
        <div className="stack compact-gap admin-mode-section-body">
          <div className="between admin-mode-section-head">
            <h2>테두리표시</h2>
            <button
              type="button"
              className={layoutGuideEnabled ? 'small selected-toggle' : 'small ghost danger'}
              disabled={layoutGuideSaving}
              onClick={() => saveLayoutGuideSetting(!layoutGuideEnabled)}
            >
              {layoutGuideSaving ? '저장중...' : (layoutGuideEnabled ? 'ON' : 'OFF')}
            </button>
          </div>
          <div className="between admin-mode-section-head">
            <div>
              <h2>HTML 요소확인</h2>
              <div className="muted tiny-text">ON 후 현재 화면에서 Ctrl + 클릭하면 AI UI 컨텍스트 패널이 열리고 JSON/TXT 저장이 가능합니다.</div>
            </div>
            <button
              type="button"
              className={htmlInspectorEnabled ? 'small selected-toggle' : 'small ghost danger'}
              disabled={htmlInspectorSaving}
              onClick={() => saveHtmlInspectorSetting(!htmlInspectorEnabled)}
            >
              {htmlInspectorSaving ? '저장중...' : (htmlInspectorEnabled ? 'ON' : 'OFF')}
            </button>
          </div>
          <div className="between admin-mode-section-head">
            <div>
              <h2>텍스트 편집 (ON/OFF)</h2>
              <div className="muted tiny-text">ON 후 Alt + Shift + 클릭 시 현재 페이지 텍스트를 DB 기준으로 저장/반영합니다.</div>
            </div>
            <button
              type="button"
              className={textEditEnabled ? 'small selected-toggle' : 'small ghost danger'}
              disabled={textEditSaving}
              onClick={() => saveTextEditSetting(!textEditEnabled)}
            >
              {textEditSaving ? '저장중...' : (textEditEnabled ? 'ON' : 'OFF')}
            </button>
          </div>
        </div>
      </section>




      {sortModal.open && createPortal(
        <div className="modal-overlay" onClick={() => setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })}>
          <div className="modal-card admin-sort-modal" onClick={e => e.stopPropagation()}>
            <div className="between">
              <strong>사용자 지정 정렬</strong>
              <button type="button" className="small ghost" onClick={() => setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })}>닫기</button>
            </div>
            <div className="muted">최소 2개, 최대 5개 필터를 1순위부터 설정해 주세요.</div>
            <div className="stack compact-gap admin-sort-modal-body">
              {Array.from({ length: 5 }, (_, index) => (
                <label key={`custom-sort-${index}`}>
                  <span>{index + 1}순위</span>
                  <select value={sortModal.draftKeys[index] || ''} onChange={e => {
                    const next = [...sortModal.draftKeys]
                    next[index] = e.target.value
                    setSortModal(prev => ({ ...prev, draftKeys: next }))
                  }}>
                    <option value="">선택 안 함</option>
                    {ADMIN_CUSTOM_SORT_FIELDS.map(option => <option key={`${index}-${option.value}`} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" onClick={() => setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })}>취소</button>
              <button type="button" className="small" onClick={applyCustomSort}>적용</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {searchOpen && createPortal(
        <div className="modal-overlay" onClick={() => setSearchOpen(false)}>
          <div className="modal-card admin-search-modal" onClick={e => e.stopPropagation()}>
            <div className="between">
              <strong>계정 검색</strong>
              <button type="button" className="small ghost" onClick={() => setSearchOpen(false)}>닫기</button>
            </div>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="이름, 닉네임, 아이디, 고유ID, 연락처 검색" />
            <div className="admin-account-table admin-search-results">
              {searchResults.map(item => (
                <div key={item.id} className="admin-account-grid compact">
                  <div>{item.name || item.nickname}<div className="muted tiny-text">{item.account_unique_id || '-'}</div></div>
                  <div>{item.email}</div>
                  <select value={vehicleAvailableSelectValue(item)} onChange={e => updateAccountRow(item.id, { vehicle_available: e.target.value === '가용' })} disabled={isStaffGradeValue(item?.grade)}>
                    <option value="가용">가용</option>
                    <option value="불가">불가</option>
                  </select>
                  <button type="button" className="small ghost" onClick={() => openVehicleExceptionModal(item)} disabled={isStaffGradeValue(item?.grade)}>차량열외</button>
                  <select value={defaultPositionForRow(item)} onChange={e => updateAccountRow(item.id, { position_title: e.target.value })} disabled={!canEditPosition(item)}>
                    <option value="">미지정</option>
                    {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2}>
                    {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                  </select>
                </div>
              ))}
              {!searchResults.length && <div className="muted">검색 결과가 없습니다.</div>}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {vehicleExceptionModal.open && createPortal(
        <div className="modal-overlay" onClick={() => setVehicleExceptionModal({ open: false, account: null, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: false })}>
          <div className="modal-card vehicle-exclusion-modal" onClick={e => e.stopPropagation()}>
            <div className="between">
              <strong>차량열외 · {vehicleExceptionModal.account?.name || vehicleExceptionModal.account?.nickname || ''}</strong>
              <button type="button" className="small ghost" onClick={() => setVehicleExceptionModal({ open: false, account: null, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: false })}>닫기</button>
            </div>
            <div className="stack compact-gap">
              <div className="admin-inline-grid compact-inline-grid">
                <label>시작일<input type="date" value={vehicleExceptionModal.form.start_date} onChange={e => setVehicleExceptionModal(prev => ({ ...prev, form: { ...prev.form, start_date: e.target.value } }))} /></label>
                <label>종료일<input type="date" value={vehicleExceptionModal.form.end_date} onChange={e => setVehicleExceptionModal(prev => ({ ...prev, form: { ...prev.form, end_date: e.target.value } }))} /></label>
              </div>
              <label>열외사유<textarea rows={3} value={vehicleExceptionModal.form.reason} onChange={e => setVehicleExceptionModal(prev => ({ ...prev, form: { ...prev.form, reason: e.target.value } }))} placeholder="열외 사유를 입력해 주세요." /></label>
              <div className="inline-actions wrap"><button type="button" className="small" onClick={saveVehicleException}>열외일정 추가</button></div>
              <div className="stack compact-gap vehicle-exclusion-list">
                {vehicleExceptionModal.loading ? <div className="muted">불러오는 중...</div> : vehicleExceptionModal.items.map(item => (
                  <div key={item.id} className="vehicle-exclusion-item">
                    <div><strong>{item.start_date} ~ {item.end_date}</strong><div className="muted">{item.reason || '사유 미입력'}</div></div>
                    <button type="button" className="small ghost" onClick={() => deleteVehicleException(item.id)}>삭제</button>
                  </div>
                ))}
                {!vehicleExceptionModal.loading && !vehicleExceptionModal.items.length && <div className="muted">등록된 열외 일정이 없습니다.</div>}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {accountDeleteDialogOpen && createPortal(
        <div className="modal-overlay" onClick={() => setAccountDeleteDialogOpen(false)}>
          <div className="modal-card delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="stack compact-gap">
              <strong>계정을 삭제하시겠습니까?</strong>
              <div className="muted">계정을 삭제하려면 아래 텍스트창에 '삭제'라고 입력 후 삭제 버튼을 누르세요.</div>
              <input value={accountDeleteConfirmText} onChange={e => setAccountDeleteConfirmText(e.target.value)} placeholder="삭제" />
              <div className="inline-actions wrap">
                <button type="button" className="small ghost" onClick={() => setAccountDeleteDialogOpen(false)}>취소</button>
                <button type="button" className="small danger" onClick={submitDeleteAccountsConfirmed}>삭제</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function ReportsPage() {
  const [items, setItems] = useState([])
  async function load() {
    const data = await api('/api/admin/reports')
    setItems(data)
  }
  useEffect(() => { load() }, [])
  async function closeReport(id) {
    await api(`/api/admin/reports/${id}/close`, { method: 'POST' })
    load()
  }
  return (
    <div className="card">
      <h2>관리자 신고 관리</h2>
      <div className="list">
        {items.map(item => (
          <div key={item.id} className="list-item block">
            <div className="between">
              <strong>{item.reason}</strong>
              <span className={item.status === 'open' ? 'status-open' : 'status-closed'}>{item.status}</span>
            </div>
            <div className="muted">신고자: {item.reporter.nickname} / 대상: {item.target.nickname}</div>
            <div>{item.detail}</div>
            {item.status === 'open' && <button className="small" onClick={() => closeReport(item.id)}>종료 처리</button>}
          </div>
        ))}
        {items.length === 0 && <div className="muted">신고 내역이 없습니다.</div>}
      </div>
    </div>
  )
}


function LocationSharingAgent({ user }) {
  const watchIdRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function syncLocationSharing() {
      try {
        const status = await api('/api/location-sharing/status')
        if (cancelled) return
        const shouldWatch = Boolean(status?.sharing_enabled && status?.active_now)
        if (!shouldWatch) {
          if (watchIdRef.current !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
          }
          return
        }
        if (!navigator.geolocation || watchIdRef.current !== null) return
        watchIdRef.current = navigator.geolocation.watchPosition(async pos => {
          try {
            const currentUser = getStoredUser()
            await api('/api/profile/location', {
              method: 'POST',
              body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, region: currentUser?.region || '서울' }),
            })
          } catch (_) {}
        }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })
      } catch (_) {}
    }

    syncLocationSharing()
    const timer = window.setInterval(syncLocationSharing, 45000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [user?.id])

  return null
}


function formatSettlementValue(label, value) {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  if (raw === '#DIV/0!') return '0.0%'
  const numeric = Number(raw)
  if (!Number.isNaN(numeric) && /계약률/.test(String(label || ''))) {
    return `${(numeric * 100).toFixed(1)}%`
  }
  return raw
}


function cloneSettlementBlock(block) {
  return JSON.parse(JSON.stringify(block || {}))
}

function toSettlementNumber(value) {
  return Number(String(value ?? '').replace(/,/g, '').trim()) || 0
}

function recalculateSettlementBlock(block) {
  const cloned = cloneSettlementBlock(block)
  if (!cloned) return cloned

  const sourceCounts = { 숨고: 0, 오늘: 0, 공홈: 0 }
  ;(cloned.summaryRows || []).forEach(row => {
    const source = String(row?.source || '').trim()
    if (Object.prototype.hasOwnProperty.call(sourceCounts, source)) {
      sourceCounts[source] = toSettlementNumber(row?.count)
    }
  })
  const totalEstimate = sourceCounts.숨고 + sourceCounts.오늘 + sourceCounts.공홈
  const contractCount = toSettlementNumber((cloned.summaryRows || []).find(row => String(row?.label || '').includes('2. 총 계약 수(건)'))?.value)

  cloned.summaryRows = (cloned.summaryRows || []).map(row => {
    const label = String(row?.label || '')
    if (label.includes('1. 총 견적 발송 수(건)')) return { ...row, value: String(totalEstimate) }
    if (label.includes('3. 계약률')) {
      const rate = totalEstimate ? (contractCount / totalEstimate) : 0
      return { ...row, value: String(rate) }
    }
    return { ...row }
  })

  let totalPlatformReview = 0
  let totalBranchReview = 0
  let totalIssues = 0
  let totalScore = 0
  cloned.branchRows = (cloned.branchRows || []).map(row => {
    const platformCount = String(row?.platform || '').trim() ? toSettlementNumber(row?.platformCount) : (String(row?.platformCount || '').trim() ? toSettlementNumber(row?.platformCount) : '')
    const branchCount = toSettlementNumber(row?.branchCount)
    const issues = toSettlementNumber(row?.issues)
    const score = branchCount - (issues * 3)
    if (typeof platformCount === 'number') totalPlatformReview += platformCount
    totalBranchReview += branchCount
    totalIssues += issues
    totalScore += score
    return {
      ...row,
      platformCount: platformCount === '' ? '' : String(platformCount),
      branchCount: String(branchCount),
      issues: String(issues),
      score: String(score),
    }
  })

  cloned.total = {
    ...(cloned.total || {}),
    platformReview: String(totalPlatformReview),
    branchReview: String(totalBranchReview),
    issues: String(totalIssues),
    score: String(totalScore),
  }
  return cloned
}

function settlementDateKeyFromText(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const match = text.match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/)
  if (!match) return ''
  const year = match[1].length === 2 ? Number(`20${match[1]}`) : Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || !month || !day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getSettlementBlockDateKey(block) {
  if (!block) return ''
  const explicitKey = String(block?.settlementKey || block?.dateKey || '').trim()
  if (explicitKey) return explicitKey
  const monthKey = String(block?.monthKey || '').trim()
  if (monthKey) return `${monthKey}-01`
  const startKey = String(block?.weekKey || block?.rangeStart || block?.start || '').trim()
  if (startKey) return startKey
  return settlementDateKeyFromText(block?.date || '')
}

function getTodaySettlementDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatSettlementDynamicDateText(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토']
  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}.(${weekdayLabels[date.getDay()]}) 18:00 기준`
}

function getDynamicSettlementWeekStart(now = new Date()) {
  const current = new Date(now)
  const start = new Date(current)
  const weekday = current.getDay()
  const diffToSaturday = (weekday + 1) % 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - diffToSaturday)
  const refreshPoint = new Date(start)
  refreshPoint.setHours(9, 0, 0, 0)
  if (current.getTime() < refreshPoint.getTime()) {
    start.setDate(start.getDate() - 7)
  }
  return start
}

function buildDynamicSettlementDailyBlocks(blocks = [], now = new Date()) {
  const weekStart = getDynamicSettlementWeekStart(now)
  return (blocks || []).map((block, index) => {
    const mappedDate = new Date(weekStart)
    mappedDate.setDate(weekStart.getDate() + index)
    return {
      ...cloneSettlementBlock(block),
      date: formatSettlementDynamicDateText(mappedDate),
    }
  })
}

function applySettlementPlatformMetrics(blocks, platformMetrics, options = {}) {
  const reflectionMap = options.reflectionMap || {}
  const todayKey = options.todayKey || getTodaySettlementDateKey()
  return (blocks || []).map(block => {
    const cloned = cloneSettlementBlock(block)
    const dateKey = getSettlementBlockDateKey(cloned)
    if (dateKey && reflectionMap[dateKey]?.block) {
      const reflectedBlock = cloneSettlementBlock(reflectionMap[dateKey].block)
      reflectedBlock.reflectionMeta = reflectionMap[dateKey]
      return reflectedBlock
    }
    if (dateKey && dateKey !== todayKey) {
      return cloned
    }
    cloned.summaryRows = (cloned.summaryRows || []).map(row => {
      const metric = platformMetrics?.[row.source]
      if (!metric) return row
      return { ...row, count: String(metric.value ?? 0) }
    })
    return cloned
  })
}

function buildSettlementReflectionMap(records) {
  return Object.fromEntries((records || []).map(record => [record.settlement_date, record]))
}

function findPreferredSettlementIndex(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return 0
  const todayKey = getTodaySettlementDateKey()
  const todayIndex = blocks.findIndex(block => getSettlementBlockDateKey(block) === todayKey)
  if (todayIndex >= 0) return todayIndex
  return blocks.length - 1
}

function formatSettlementDateKeyLabel(dateKey) {
  if (!dateKey) return '-'
  const [year, month, day] = String(dateKey).split('-')
  if (!year || !month || !day) return dateKey
  return `${year}.${month}.${day}`
}

function parseSettlementDateKey(dateKey) {
  if (!dateKey) return null
  const [year, month, day] = String(dateKey).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function getSettlementWeekOfMonth(dateKey) {
  const date = parseSettlementDateKey(dateKey)
  if (!date) return 0
  return Math.floor((date.getDate() - 1) / 7) + 1
}

function formatWeeklySettlementTitle(block, fallbackIndex = 0) {
  const dateKey = getSettlementBlockDateKey(block)
  const date = parseSettlementDateKey(dateKey)
  if (!date) return `0주차 주간 결산`
  return `${getSettlementWeekOfMonth(dateKey)}주차 주간 결산`
}

function formatMonthlySettlementTitle(block, fallbackIndex = 0) {
  const dateKey = getSettlementBlockDateKey(block)
  const date = parseSettlementDateKey(dateKey)
  if (!date) return `0월 월간 결산`
  return `${date.getMonth() + 1}월 월간 결산`
}

function getSettlementWeekStartKey(dateKey) {
  const date = parseSettlementDateKey(dateKey)
  if (!date) return ''
  const copy = new Date(date)
  const weekday = copy.getDay()
  const diff = (weekday + 1) % 7
  copy.setDate(copy.getDate() - diff)
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`
}

function buildSettlementMonthlyPages(blocks = []) {
  const validBlocks = (blocks || []).filter(block => getSettlementBlockDateKey(block))
  const monthMap = new Map()
  validBlocks.forEach(block => {
    const dateKey = getSettlementBlockDateKey(block)
    const monthKey = String(dateKey || '').slice(0, 7)
    if (!monthKey) return
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { monthKey, blocks: [] })
    monthMap.get(monthKey).blocks.push(block)
  })

  const today = new Date()
  const todayYear = today.getFullYear()
  const yearValues = validBlocks.map(block => parseSettlementDateKey(getSettlementBlockDateKey(block))?.getFullYear()).filter(Number.isFinite)
  const startYear = Math.min(...yearValues, todayYear) - 1
  const endYear = Math.max(...yearValues, todayYear) + 1

  const pages = []
  for (let year = startYear; year <= endYear; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
      const entry = monthMap.get(monthKey) || { monthKey, blocks: [] }
      const start = `${monthKey}-01`
      const end = `${monthKey}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`
      const ordered = [...entry.blocks].sort((a, b) => String(getSettlementBlockDateKey(a)).localeCompare(String(getSettlementBlockDateKey(b))))
      pages.push({ ...entry, start, end, blocks: ordered })
    }
  }
  return pages
}

function buildAggregatedSettlementBlockFromBlocks(baseBlock, blocks = [], titleText = '', dateText = '') {
  if (!baseBlock) return null
  if (!blocks.length) return recalculateSettlementBlock(cloneSettlementBlock(baseBlock))
  const aggregated = cloneSettlementBlock(baseBlock)
  const metrics = blocks.reduce((acc, block) => {
    const current = summarizeSettlementRows(block?.summaryRows || [], block?.total || {})
    Object.keys(acc).forEach(key => { acc[key] += current[key] || 0 })
    return acc
  }, { 숨고: 0, 오늘: 0, 공홈: 0, 총견적: 0, 총계약: 0, 플랫폼리뷰: 0, 호점리뷰: 0, 이슈: 0 })
  aggregated.title = titleText || aggregated.title
  if (dateText) aggregated.date = dateText
  aggregated.summaryRows = (aggregated.summaryRows || []).map(row => {
    const source = String(row?.source || '').trim()
    if (source === '숨고' || source === '오늘' || source === '공홈') return { ...row, count: String(metrics[source] || 0) }
    const label = String(row?.label || '')
    if (label.includes('총 견적 발송 수')) return { ...row, value: String(metrics.총견적 || 0) }
    if (label.includes('총 계약 수')) return { ...row, value: String(metrics.총계약 || 0) }
    if (label.includes('계약률')) {
      const rate = metrics.총견적 ? (metrics.총계약 / metrics.총견적) : 0
      return { ...row, value: String(rate) }
    }
    return row
  })
  aggregated.total = { ...(aggregated.total || {}), platformReview: String(metrics.플랫폼리뷰 || 0), branchReview: String(metrics.호점리뷰 || 0), issues: String(metrics.이슈 || 0), score: String((metrics.호점리뷰 || 0) - ((metrics.이슈 || 0) * 3)) }
  return recalculateSettlementBlock(aggregated)
}

function formatSettlementDateShort(dateKey) {
  const date = parseSettlementDateKey(dateKey)
  if (!date) return dateKey || '-'
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`
}

function buildAllSettlementSourceBlocks(currentBlocks = [], records = []) {
  const map = new Map()
  ;(records || []).forEach(record => {
    const key = String(record?.settlement_date || '')
    if (!key || !record?.block) return
    map.set(key, cloneSettlementBlock(record.block))
  })
  ;(currentBlocks || []).forEach(block => {
    const key = getSettlementBlockDateKey(block)
    if (!key) return
    if (!map.has(key)) map.set(key, cloneSettlementBlock(block))
  })
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, block]) => block)
}

function buildSettlementWeeklyPages(blocks = []) {
  const validBlocks = (blocks || []).filter(block => getSettlementBlockDateKey(block))
  const map = new Map()
  validBlocks.forEach(block => {
    const dateKey = getSettlementBlockDateKey(block)
    const weekKey = getSettlementWeekStartKey(dateKey)
    if (!weekKey) return
    if (!map.has(weekKey)) map.set(weekKey, { weekKey, start: weekKey, blocks: [] })
    map.get(weekKey).blocks.push(block)
  })

  const today = new Date()
  const todayYear = today.getFullYear()
  const yearValues = validBlocks.map(block => parseSettlementDateKey(getSettlementBlockDateKey(block))?.getFullYear()).filter(Number.isFinite)
  const startYear = Math.min(...yearValues, todayYear) - 1
  const endYear = Math.max(...yearValues, todayYear) + 1
  const rangeStart = new Date(startYear, 0, 1)
  const rangeEnd = new Date(endYear, 11, 31)
  const rangeStartKey = getSettlementWeekStartKey(`${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, '0')}-${String(rangeStart.getDate()).padStart(2, '0')}`)
  const firstWeekStart = parseSettlementDateKey(rangeStartKey) || rangeStart

  const pages = []
  for (let cursor = new Date(firstWeekStart); cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 7)) {
    const start = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const endDate = new Date(cursor)
    endDate.setDate(endDate.getDate() + 6)
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`
    const entry = map.get(start) || { weekKey: start, blocks: [] }
    const ordered = [...entry.blocks].sort((a, b) => getSettlementBlockDateKey(a).localeCompare(getSettlementBlockDateKey(b)))
    pages.push({ ...entry, weekKey: start, start, end, blocks: ordered })
  }
  return pages
}

function findPreferredSettlementWeekIndex(pages = []) {
  if (!pages.length) return 0
  const todayKey = getTodaySettlementDateKey()
  const todayWeekKey = getSettlementWeekStartKey(todayKey)
  const idx = pages.findIndex(page => page.weekKey === todayWeekKey)
  if (idx >= 0) return idx
  const futureIdx = pages.findIndex(page => String(page.start) > todayKey)
  if (futureIdx >= 0) return futureIdx
  return pages.length - 1
}

function summarizeSettlementRows(summaryRows = [], total = {}) {
  const result = {
    숨고: 0,
    오늘: 0,
    공홈: 0,
    총견적: 0,
    총계약: 0,
    플랫폼리뷰: Number(total.platformReview || 0) || 0,
    호점리뷰: Number(total.branchReview || 0) || 0,
    이슈: Number(total.issues || 0) || 0,
  }
  ;(summaryRows || []).forEach(row => {
    const source = String(row?.source || '').trim()
    const count = Number(String(row?.count ?? 0).replace(/,/g, '')) || 0
    const value = Number(String(row?.value ?? 0).replace(/,/g, '')) || 0
    const label = String(row?.label || '')
    if (source && Object.prototype.hasOwnProperty.call(result, source)) result[source] += count
    if (label.includes('총 계약 수')) result.총계약 += value
  })
  result.총견적 = result.숨고 + result.오늘 + result.공홈
  return result
}

function buildAggregatedSettlementBlock(baseBlock, records = [], titleText = '') {
  if (!baseBlock) return null
  if (!records.length) return recalculateSettlementBlock(cloneSettlementBlock(baseBlock))
  const aggregated = cloneSettlementBlock(baseBlock)
  const metrics = records.reduce((acc, record) => {
    const current = summarizeSettlementRows(record?.block?.summaryRows || [], record?.block?.total || {})
    Object.keys(acc).forEach(key => {
      acc[key] += current[key] || 0
    })
    return acc
  }, { 숨고: 0, 오늘: 0, 공홈: 0, 총견적: 0, 총계약: 0, 플랫폼리뷰: 0, 호점리뷰: 0, 이슈: 0 })
  aggregated.title = titleText || aggregated.title
  aggregated.summaryRows = (aggregated.summaryRows || []).map(row => {
    const source = String(row?.source || '').trim()
    if (source === '숨고' || source === '오늘' || source === '공홈') {
      return { ...row, count: String(metrics[source] || 0) }
    }
    const label = String(row?.label || '')
    if (label.includes('총 견적 발송 수')) return { ...row, value: String(metrics.총견적 || 0) }
    if (label.includes('총 계약 수')) return { ...row, value: String(metrics.총계약 || 0) }
    if (label.includes('계약률')) {
      const rate = metrics.총견적 ? (metrics.총계약 / metrics.총견적) : 0
      return { ...row, value: String(rate) }
    }
    return row
  })
  aggregated.total = {
    ...(aggregated.total || {}),
    platformReview: String(metrics.플랫폼리뷰 || 0),
    branchReview: String(metrics.호점리뷰 || 0),
    issues: String(metrics.이슈 || 0),
    score: String((metrics.호점리뷰 || 0) - ((metrics.이슈 || 0) * 3)),
  }
  return recalculateSettlementBlock(aggregated)
}

function buildSettlementSheetRows(block) {
  const summaryRows = Array.isArray(block?.summaryRows) ? block.summaryRows : []
  const branchRows = Array.isArray(block?.branchRows) ? block.branchRows : []
  const rows = [
    [{ value: block?.title || '-', span: 6, className: 'sheet-title' }],
    [{ value: block?.date || '-', span: 6, className: 'sheet-date' }],
  ]

  if (block?.reflectionMeta?.reflected_at) {
    rows.push([{ value: `최종 반영 ${String(block.reflectionMeta.reflected_at).replace('T', ' ').slice(0, 16)} · ${block.reflectionMeta.reflected_by_name || '기록됨'}`, span: 6, className: 'sheet-reflected' }])
  }

  rows.push([
    { value: block?.summaryHeaders?.[0] || '', span: 2, className: 'sheet-head' },
    { value: block?.summaryHeaders?.[1] || '', span: 4, className: 'sheet-head' },
  ])

  summaryRows.forEach(row => {
    rows.push([
      { value: row?.source || '-', className: 'sheet-text center' },
      { value: formatSettlementValue(row?.label, row?.count), className: 'sheet-number' },
      { value: row?.label || '-', span: 3, className: 'sheet-text' },
      { value: formatSettlementValue(row?.label, row?.value), className: 'sheet-number' },
    ])
  })

  rows.push([
    { value: block?.reviewHeaders?.[0] || '', span: 2, className: 'sheet-head' },
    { value: block?.reviewHeaders?.[1] || '', span: 2, className: 'sheet-head' },
    { value: block?.reviewHeaders?.[2] || '', className: 'sheet-head' },
    { value: block?.reviewHeaders?.[3] || '', className: 'sheet-head' },
  ])

  branchRows.forEach(row => {
    rows.push([
      { value: row?.platform || '', className: 'sheet-text center' },
      { value: formatSettlementValue('', row?.platformCount), className: 'sheet-number' },
      { value: row?.branch || '-', className: 'sheet-text' },
      { value: formatSettlementValue('', row?.branchCount), className: 'sheet-number' },
      { value: formatSettlementValue('', row?.issues), className: 'sheet-number' },
      { value: formatSettlementValue('', row?.score), className: 'sheet-number' },
    ])
  })

  if (block?.total) {
    rows.push([
      { value: block.total.label || '총 계', className: 'sheet-total-label' },
      { value: formatSettlementValue('', block.total.platformReview), className: 'sheet-number sheet-total' },
      { value: '', className: 'sheet-total-gap' },
      { value: formatSettlementValue('', block.total.branchReview), className: 'sheet-number sheet-total' },
      { value: formatSettlementValue('', block.total.issues), className: 'sheet-number sheet-total' },
      { value: formatSettlementValue('', block.total.score), className: 'sheet-number sheet-total' },
    ])
  }

  return rows.slice(0, 20)
}

function SettlementSheetCard({ block, hideTitleDate = false }) {
  const sheetRows = buildSettlementSheetRows(block)
  const visibleRows = hideTitleDate ? sheetRows.filter((_, index) => index > 1) : sheetRows
  return (
    <section className="settlement-sheet settlement-sheet-excel card">
      <div className="settlement-excel-sheet" role="table" aria-label={block?.title || '결산표'}>
        {visibleRows.map((row, rowIndex) => (
          <div key={`${block?.title || 'sheet'}-row-${rowIndex}`} className="settlement-excel-row" role="row">
            {row.map((cell, cellIndex) => (
              <div
                key={`${block?.title || 'sheet'}-row-${rowIndex}-cell-${cellIndex}`}
                className={`settlement-excel-cell ${cell.className || ''}`.trim()}
                style={{ gridColumn: `span ${cell.span || 1}` }}
                role="cell"
              >
                {cell.value || ''}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function formatSettlementNextRunLabel(value) {
  if (!value) return '다음 예정 없음'
  const raw = String(value).replace('T', ' ')
  return `다음 예정 ${raw.slice(0, 16)}`
}

function formatSettlementSyncDetail(metric, label) {
  const updated = metric?.updated_at ? ` · 최근 연동 ${String(metric.updated_at).replace('T', ' ')}` : ''
  return `${label} 최신 합계: ${metric?.value ?? 0}건${updated}`
}

function SettlementRecordBoard({ recordsByType, onSaveDailyRecord, canEdit = false }) {
  const [recordTab, setRecordTab] = useState('daily')
  const [editingDate, setEditingDate] = useState('')
  const [editDraft, setEditDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const current = recordTab === 'weekly'
    ? (recordsByType.weekly_records || [])
    : recordTab === 'monthly'
      ? (recordsByType.monthly_records || [])
      : (recordsByType.daily_records || [])

  function openEditRecord(record) {
    setEditingDate(String(record?.settlement_date || ''))
    setEditDraft(cloneSettlementBlock(record?.block || {}))
  }

  function cancelEditRecord() {
    setEditingDate('')
    setEditDraft(null)
  }

  function updateDraft(path, value) {
    setEditDraft(prev => {
      const next = cloneSettlementBlock(prev || {})
      if (path[0] === 'summaryRows') next.summaryRows[path[1]][path[2]] = value
      else if (path[0] === 'branchRows') next.branchRows[path[1]][path[2]] = value
      else if (path[0] === 'total') next.total[path[1]] = value
      else next[path[0]] = value
      return next
    })
  }

  async function saveEditRecord(record) {
    if (!onSaveDailyRecord || !editDraft) return
    setSaving(true)
    try {
      await onSaveDailyRecord(record, editDraft)
      cancelEditRecord()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card settlement-record-board">
      <div className="between settlement-record-head">
        <div>
          <h3>결산기록</h3>
          <div className="muted">일일결산에서 결산반영을 누른 자료가 누적 저장됩니다.</div>
        </div>
        <div className="settlement-record-tabs">
          <button type="button" className={recordTab === 'daily' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setRecordTab('daily')}>일일</button>
          <button type="button" className={recordTab === 'weekly' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setRecordTab('weekly')}>주간</button>
          <button type="button" className={recordTab === 'monthly' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setRecordTab('monthly')}>월간</button>
        </div>
      </div>

      {!current.length && <div className="muted">아직 저장된 결산기록이 없습니다.</div>}

      <div className="settlement-record-list">
        {recordTab === 'daily' && current.map(record => {
          const isEditing = editingDate === String(record.settlement_date || '') && !!editDraft
          const block = isEditing ? editDraft : (record.block || {})
          return (
            <section key={`daily-${record.settlement_date}`} className="settlement-record-card card">
              <div className="between settlement-record-card-head">
                <strong>{formatSettlementDateKeyLabel(record.settlement_date)}</strong>
                <div className="inline-actions wrap end">
                  <span className="muted">반영 {String(record.reflected_at || '').replace('T', ' ').slice(0, 16)}</span>
                  {canEdit && !isEditing && <button type="button" className="small ghost" onClick={() => openEditRecord(record)}>편집</button>}
                  {canEdit && isEditing && <>
                    <button type="button" className="small ghost" onClick={cancelEditRecord}>취소</button>
                    <button type="button" className="small" onClick={() => saveEditRecord(record)} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
                  </>}
                </div>
              </div>
              <div className="muted">반영자 {record.reflected_by_name || '-'}</div>
              <div className="muted settlement-record-card-title">{block.title || record.title || ''}</div>
              {!isEditing && <div className="settlement-record-summary-grid">
                {(block.summaryRows || []).map((row, index) => (
                  <div key={`daily-summary-${record.settlement_date}-${index}`} className="settlement-record-mini-stat">
                    <span>{row.source || row.label || '-'}</span>
                    <strong>{formatSettlementValue(row.label, row.count || row.value)}</strong>
                  </div>
                ))}
              </div>}
              {isEditing && (
                <div className="settlement-edit-stack">
                  <label>제목<input value={block.title || ''} onChange={e => updateDraft(['title'], e.target.value)} /></label>
                  <label>날짜표기<input value={block.date || ''} onChange={e => updateDraft(['date'], e.target.value)} /></label>
                  <div className="settlement-edit-grid">
                    {(block.summaryRows || []).map((row, index) => (
                      <div key={`edit-summary-${record.settlement_date}-${index}`} className="settlement-edit-row">
                        <strong>{row.source || row.label || '-'}</strong>
                        <input value={row.count || ''} onChange={e => updateDraft(['summaryRows', index, 'count'], e.target.value)} placeholder="건수" />
                        <input value={row.value || ''} onChange={e => updateDraft(['summaryRows', index, 'value'], e.target.value)} placeholder="값" />
                      </div>
                    ))}
                  </div>
                  <div className="settlement-edit-grid">
                    {(block.branchRows || []).map((row, index) => (
                      <div key={`edit-branch-${record.settlement_date}-${index}`} className="settlement-edit-row settlement-edit-row-wide">
                        <strong>{row.branch || row.platform || `행 ${index + 1}`}</strong>
                        <input value={row.platformCount || ''} onChange={e => updateDraft(['branchRows', index, 'platformCount'], e.target.value)} placeholder="플랫폼리뷰" />
                        <input value={row.branchCount || ''} onChange={e => updateDraft(['branchRows', index, 'branchCount'], e.target.value)} placeholder="호점리뷰" />
                        <input value={row.issues || ''} onChange={e => updateDraft(['branchRows', index, 'issues'], e.target.value)} placeholder="이슈" />
                        <input value={row.score || ''} onChange={e => updateDraft(['branchRows', index, 'score'], e.target.value)} placeholder="점수" />
                      </div>
                    ))}
                  </div>
                  <div className="settlement-edit-grid settlement-edit-grid-total">
                    <label>플랫폼 리뷰<input value={block.total?.platformReview || ''} onChange={e => updateDraft(['total', 'platformReview'], e.target.value)} /></label>
                    <label>호점 리뷰<input value={block.total?.branchReview || ''} onChange={e => updateDraft(['total', 'branchReview'], e.target.value)} /></label>
                    <label>이슈<input value={block.total?.issues || ''} onChange={e => updateDraft(['total', 'issues'], e.target.value)} /></label>
                    <label>점수<input value={block.total?.score || ''} onChange={e => updateDraft(['total', 'score'], e.target.value)} /></label>
                  </div>
                </div>
              )}
            </section>
          )
        })}

        {recordTab !== 'daily' && current.map(item => (
          <section key={`${recordTab}-${item.period_key}`} className="settlement-record-card card">
            <div className="between settlement-record-card-head">
              <strong>{item.period_label}</strong>
              <span className="muted">{item.date_range?.start || ''} ~ {item.date_range?.end || ''}</span>
            </div>
            <div className="muted">기록일수 {item.record_count}일 · 마지막 반영 {String(item.last_reflected_at || '').replace('T', ' ').slice(0, 16)}</div>
            <div className="settlement-record-summary-grid settlement-record-summary-grid-wide">
              <div className="settlement-record-mini-stat"><span>숨고</span><strong>{item.summary?.숨고 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>오늘</span><strong>{item.summary?.오늘 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>공홈</span><strong>{item.summary?.공홈 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>총 견적</span><strong>{item.summary?.총견적 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>총 계약</span><strong>{item.summary?.총계약 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>계약률</span><strong>{formatSettlementValue('계약률', item.summary?.계약률 ?? 0)}</strong></div>
              <div className="settlement-record-mini-stat"><span>플랫폼 리뷰</span><strong>{item.summary?.플랫폼리뷰 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>호점 리뷰</span><strong>{item.summary?.호점리뷰 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>이슈</span><strong>{item.summary?.이슈 ?? 0}</strong></div>
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function loadSettlementOverrides() {
  if (typeof window === "undefined") return { daily: {}, weekly: {}, monthly: {} }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTLEMENT_OVERRIDE_STORAGE_KEY) || '{}')
    return {
      daily: parsed?.daily && typeof parsed.daily === 'object' ? parsed.daily : {},
      weekly: parsed?.weekly && typeof parsed.weekly === 'object' ? parsed.weekly : {},
      monthly: parsed?.monthly && typeof parsed.monthly === 'object' ? parsed.monthly : {},
    }
  } catch (_error) {
    return { daily: {}, weekly: {}, monthly: {} }
  }
}

function saveSettlementOverrides(nextOverrides) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SETTLEMENT_OVERRIDE_STORAGE_KEY, JSON.stringify({
      daily: nextOverrides?.daily || {},
      weekly: nextOverrides?.weekly || {},
      monthly: nextOverrides?.monthly || {},
    }))
  } catch (_error) {}
}

function applySettlementBlockOverrides(blocks = [], overrideMap = {}) {
  return (blocks || []).map(block => {
    const dateKey = getSettlementBlockDateKey(block)
    if (!dateKey) return block
    const override = overrideMap?.[dateKey]
    return override ? override : block
  })
}

function buildSettlementEditorDraft(block) {
  const cloned = cloneSettlementBlock(block)
  if (!cloned) return null
  cloned.summaryRows = (cloned.summaryRows || []).map(row => ({ ...row }))
  cloned.branchRows = (cloned.branchRows || []).map(row => ({ ...row }))
  cloned.total = { ...(cloned.total || {}) }
  return recalculateSettlementBlock(cloned)
}

function resetEditableSettlementBlock(block) {
  const cloned = buildSettlementEditorDraft(block)
  if (!cloned) return block
  cloned.summaryRows = (cloned.summaryRows || []).map(row => {
    const label = String(row?.label || '')
    const source = String(row?.source || '')
    if (['숨고', '오늘', '공홈'].includes(source)) {
      return { ...row, count: '0', value: label.includes('2. 총 계약 수(건)') ? '0' : row.value }
    }
    if (label.includes('2. 총 계약 수(건)')) {
      return { ...row, value: '0' }
    }
    return row
  })
  cloned.branchRows = (cloned.branchRows || []).map(row => ({
    ...row,
    platformCount: row?.platform ? '0' : (row?.platformCount || ''),
    branchCount: '0',
    issues: '0',
  }))
  return recalculateSettlementBlock(cloned)
}

function SettlementPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const categories = [
    { id: 'daily', label: '일일' },
    { id: 'weekly', label: '주간' },
    { id: 'monthly', label: '월간' },
    { id: 'records', label: '결산기록' },
  ]
  const settlementTabOptions = ['daily', 'weekly', 'monthly', 'records']
  const requestedSettlementTab = String(searchParams.get('tab') || 'daily').trim()
  const normalizedRequestedSettlementTab = settlementTabOptions.includes(requestedSettlementTab) ? requestedSettlementTab : 'daily'
  const [activeCategory, setActiveCategory] = useState(normalizedRequestedSettlementTab)
  const [syncStatus, setSyncStatus] = useState({ platforms: {}, enabled: false, is_running: false, last_message: '' })
  const [syncLoading, setSyncLoading] = useState(false)
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [soomgoEmail, setSoomgoEmail] = useState('')
  const [soomgoPassword, setSoomgoPassword] = useState('')
  const [ohouEmail, setOhouEmail] = useState('')
  const [ohouPassword, setOhouPassword] = useState('')
  const [soomgoAuthStateText, setSoomgoAuthStateText] = useState('')
  const [ohouAuthStateText, setOhouAuthStateText] = useState('')
  const [authStateLoading, setAuthStateLoading] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeSettingPlatform, setActiveSettingPlatform] = useState('')
  const [statusDetailOpen, setStatusDetailOpen] = useState(false)
  const [guidePlatform, setGuidePlatform] = useState('')
  const [guideLoading, setGuideLoading] = useState(false)
  const [guideData, setGuideData] = useState(null)
  const [recordsData, setRecordsData] = useState({ daily_records: [], weekly_records: [], monthly_records: [] })
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [reflectLoading, setReflectLoading] = useState(false)
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false)
  const [dailyIndex, setDailyIndex] = useState(0)
  const [weeklyIndex, setWeeklyIndex] = useState(0)
  const [monthlyIndex, setMonthlyIndex] = useState(0)
  const [dailyOverrideMap, setDailyOverrideMap] = useState(() => loadSettlementOverrides().daily)
  const [weeklyOverrideMap, setWeeklyOverrideMap] = useState(() => loadSettlementOverrides().weekly)
  const [monthlyOverrideMap, setMonthlyOverrideMap] = useState(() => loadSettlementOverrides().monthly)
  useEffect(() => {
    if (normalizedRequestedSettlementTab !== activeCategory) {
      setActiveCategory(normalizedRequestedSettlementTab)
    }
  }, [normalizedRequestedSettlementTab, activeCategory])

  const handleSettlementCategoryChange = useCallback((nextCategory) => {
    const nextTab = String(nextCategory || '').trim()
    if (!settlementTabOptions.includes(nextTab)) return
    if (nextTab === activeCategory && normalizedRequestedSettlementTab === nextTab) return
    setActiveCategory(nextTab)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', nextTab)
    setSearchParams(nextParams, { replace: true })
  }, [activeCategory, normalizedRequestedSettlementTab, searchParams, setSearchParams])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTarget, setEditorTarget] = useState('daily')
  const [editorDateKey, setEditorDateKey] = useState('')
  const [editorDraft, setEditorDraft] = useState(null)

  async function loadSyncStatus() {
    try {
      const data = await api('/api/settlement/platform-sync-status')
      setSyncStatus(data || { platforms: {} })
    } catch (error) {
      setSyncStatus(prev => ({ ...prev, last_message: error.message || '연동 상태를 불러오지 못했습니다.' }))
    }
  }

  async function loadRecords() {
    setRecordsLoading(true)
    try {
      const data = await api('/api/settlement/records')
      setRecordsData(data || { daily_records: [], weekly_records: [], monthly_records: [] })
    } catch (error) {
      setRecordsData({ daily_records: [], weekly_records: [], monthly_records: [] })
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    loadSyncStatus()
    loadRecords()
    const timer = window.setInterval(loadSyncStatus, 60000)
    return () => window.clearInterval(timer)
  }, [])

  async function handleRefreshSync() {
    setSyncLoading(true)
    try {
      const data = await api('/api/settlement/platform-sync/refresh', { method: 'POST' })
      setSyncStatus(data || { platforms: {} })
      window.alert('결산자료 연동이 완료되었습니다.')
    } catch (error) {
      window.alert(error.message || '데이터 연동 중 오류가 발생했습니다.')
    } finally {
      setSyncLoading(false)
    }
  }

  async function handleAuthStateUpload(platform) {
    const value = platform === '오늘' ? ohouAuthStateText : soomgoAuthStateText
    if (!String(value || '').trim()) {
      window.alert(`${platform} 인증 세션 JSON 내용을 붙여 넣어 주세요.`)
      return
    }
    setAuthStateLoading(platform)
    try {
      await api('/api/settlement/platform-auth-state', {
        method: 'POST',
        body: JSON.stringify({ platform, storage_state: String(value).trim() }),
      })
      if (platform === '오늘') setOhouAuthStateText('')
      else setSoomgoAuthStateText('')
      await loadSyncStatus()
      window.alert(`${platform} 인증 세션이 서버에 저장되었습니다. 다시 데이터 연동을 눌러 주세요.`)
    } catch (error) {
      window.alert(error.message || `${platform} 인증 세션 저장 중 오류가 발생했습니다.`)
    } finally {
      setAuthStateLoading('')
    }
  }

  async function handleSaveCredentials(platform) {
    const email = platform === '오늘' ? ohouEmail : soomgoEmail
    const password = platform === '오늘' ? ohouPassword : soomgoPassword
    if (!String(email || '').trim() || !String(password || '').trim()) {
      window.alert(`${platform} 아이디와 비밀번호를 입력해 주세요.`)
      return
    }
    setCredentialLoading(true)
    try {
      await api('/api/settlement/platform-credentials', {
        method: 'POST',
        body: JSON.stringify({ platform, email: String(email).trim(), password: String(password).trim() }),
      })
      if (platform === '오늘') setOhouPassword('')
      else setSoomgoPassword('')
      await loadSyncStatus()
      window.alert(`${platform} 계정 정보가 서버에 저장되었습니다. 다시 데이터 연동을 눌러 주세요.`)
    } catch (error) {
      window.alert(error.message || `${platform} 계정 저장 중 오류가 발생했습니다.`)
    } finally {
      setCredentialLoading(false)
    }
  }

  async function handleOpenGuide(platform) {
    setGuidePlatform(platform)
    setGuideLoading(true)
    try {
      const data = await api(`/api/settlement/platform-auth-guide?platform=${encodeURIComponent(platform)}`)
      setGuideData(data || null)
    } catch (error) {
      window.alert(error.message || `${platform} 설명서를 불러오지 못했습니다.`)
      setGuideData(null)
    } finally {
      setGuideLoading(false)
    }
  }

  function handleTogglePlatformSetting(platform) {
    setSettingsOpen(true)
    setGuideData(null)
    setGuidePlatform('')
    setActiveSettingPlatform(prev => (prev === platform ? '' : platform))
  }

  const reflectionMap = useMemo(() => buildSettlementReflectionMap(recordsData.daily_records || []), [recordsData.daily_records])
  const dailyBlocks = useMemo(
    () => applySettlementPlatformMetrics(buildDynamicSettlementDailyBlocks(SETTLEMENT_DATA.daily || []), syncStatus.platforms, { reflectionMap }),
    [syncStatus.platforms, reflectionMap],
  )
  const sortedDailyBlocks = useMemo(() => {
    const applied = applySettlementBlockOverrides(dailyBlocks, dailyOverrideMap)
    return [...applied].sort((left, right) => String(getSettlementBlockDateKey(left)).localeCompare(String(getSettlementBlockDateKey(right))))
  }, [dailyBlocks, dailyOverrideMap])
  const allSettlementSourceBlocks = useMemo(
    () => buildAllSettlementSourceBlocks(sortedDailyBlocks, recordsData.daily_records || []),
    [sortedDailyBlocks, recordsData.daily_records],
  )
  const weeklyBlocks = useMemo(() => {
    const pages = buildSettlementWeeklyPages(allSettlementSourceBlocks)
    const baseTemplate = cloneSettlementBlock((SETTLEMENT_DATA.weekly || [])[0] || (SETTLEMENT_DATA.daily || [])[0] || null)
    const mapped = pages.map((page, index) => {
      const firstBlock = page.blocks[0] || null
      const aggregated = buildAggregatedSettlementBlockFromBlocks(
        firstBlock || baseTemplate,
        page.blocks,
        formatWeeklySettlementTitle(firstBlock || { date: page.start }, index),
        `${formatSettlementDateShort(page.start)} ~ ${formatSettlementDateShort(page.end)} 금요일 18:00 기준`,
      )
      return { ...aggregated, settlementKey: page.start, weekKey: page.weekKey, rangeStart: page.start, rangeEnd: page.end }
    })
    return applySettlementBlockOverrides(mapped, weeklyOverrideMap)
  }, [allSettlementSourceBlocks, weeklyOverrideMap])
  const monthlyBlocks = useMemo(() => {
    const pages = buildSettlementMonthlyPages(allSettlementSourceBlocks)
    const baseTemplate = cloneSettlementBlock((SETTLEMENT_DATA.monthly || [])[0] || (SETTLEMENT_DATA.daily || [])[0] || null)
    const mapped = pages.map((page, index) => {
      const firstBlock = page.blocks[0] || null
      const aggregated = buildAggregatedSettlementBlockFromBlocks(
        firstBlock || baseTemplate,
        page.blocks,
        formatMonthlySettlementTitle(firstBlock || { date: page.start }, index),
        `${String(page.start || '').slice(0, 7)} 월간결산`,
      )
      return { ...aggregated, settlementKey: page.start, monthKey: page.monthKey, rangeStart: page.start, rangeEnd: page.end }
    })
    return applySettlementBlockOverrides(mapped, monthlyOverrideMap)
  }, [allSettlementSourceBlocks, monthlyOverrideMap])

  useEffect(() => {
    setDailyIndex(prev => {
      if (!sortedDailyBlocks.length) return 0
      if (prev >= 0 && prev < sortedDailyBlocks.length) return prev
      return findPreferredSettlementIndex(sortedDailyBlocks)
    })
  }, [sortedDailyBlocks])

  useEffect(() => {
    setWeeklyIndex(prev => {
      if (!weeklyBlocks.length) return 0
      if (prev >= 0 && prev < weeklyBlocks.length) return prev
      return weeklyBlocks.length - 1
    })
  }, [weeklyBlocks])

  useEffect(() => {
    setMonthlyIndex(prev => {
      if (!monthlyBlocks.length) return 0
      if (prev >= 0 && prev < monthlyBlocks.length) return prev
      return monthlyBlocks.length - 1
    })
  }, [monthlyBlocks])

  useEffect(() => {
    saveSettlementOverrides({ daily: dailyOverrideMap, weekly: weeklyOverrideMap, monthly: monthlyOverrideMap })
  }, [dailyOverrideMap, weeklyOverrideMap, monthlyOverrideMap])

  const soomgoMetric = syncStatus.platforms?.['숨고'] || { value: 0, updated_at: '', sync_message: '' }
  const ohouMetric = syncStatus.platforms?.['오늘'] || { value: 0, updated_at: '', sync_message: '' }
  const soomgoConfig = syncStatus.configs?.['숨고'] || syncStatus.config || {}
  const ohouConfig = syncStatus.configs?.['오늘'] || {}
  const nextRunLabel = formatSettlementNextRunLabel(syncStatus.next_run_at)
  const statusText = syncStatus.is_running ? '연동 진행 중' : (syncStatus.last_message || soomgoMetric.sync_message || ohouMetric.sync_message || '대기중')
  const activePlatform = activeSettingPlatform === '오늘' ? '오늘' : '숨고'
  const activeConfig = activePlatform === '오늘' ? ohouConfig : soomgoConfig
  const activeEmail = activePlatform === '오늘' ? ohouEmail : soomgoEmail
  const activePassword = activePlatform === '오늘' ? ohouPassword : soomgoPassword
  const activeAuthStateText = activePlatform === '오늘' ? ohouAuthStateText : soomgoAuthStateText
  const selectedDailyBlock = sortedDailyBlocks[dailyIndex] || null
  const selectedDailyBlockDateKey = getSettlementBlockDateKey(selectedDailyBlock)

  const selectedWeeklyBlock = weeklyBlocks[weeklyIndex] || null
  const selectedWeeklyBlockDateKey = getSettlementBlockDateKey(selectedWeeklyBlock)
  const selectedMonthlyBlock = monthlyBlocks[monthlyIndex] || null
  const selectedMonthlyDateKey = getSettlementBlockDateKey(selectedMonthlyBlock)
  const editableSummaryRows = useMemo(() => (editorDraft?.summaryRows || []).filter(row => ['숨고', '오늘', '공홈'].includes(String(row?.source || '').trim())), [editorDraft])
  const contractSummaryRowIndex = useMemo(() => (editorDraft?.summaryRows || []).findIndex(row => String(row?.label || '').includes('2. 총 계약 수(건)')), [editorDraft])

  async function handleRefreshMonthlySummary() {
    if (!selectedMonthlyBlock || !selectedMonthlyDateKey) {
      window.alert('종합할 월간결산 데이터가 없습니다.')
      return
    }
    const monthKey = String(selectedMonthlyDateKey).slice(0, 7)
    const monthRecords = (recordsData.daily_records || []).filter(record => String(record.settlement_date || '').startsWith(monthKey))
    if (!monthRecords.length) {
      window.alert('해당 월에 반영된 일일결산 기록이 아직 없습니다.')
      return
    }
    setMonthlySummaryLoading(true)
    try {
      const updatedBlock = buildAggregatedSettlementBlock(
        selectedMonthlyBlock,
        monthRecords,
        formatMonthlySettlementTitle(selectedMonthlyBlock, monthlyIndex),
      )
      setMonthlyOverrideMap(prev => ({
        ...prev,
        [selectedMonthlyDateKey]: {
          ...updatedBlock,
          title: formatMonthlySettlementTitle(updatedBlock, monthlyIndex),
        },
      }))
      window.alert(`${monthKey} 월간결산이 최신 일일결산 기준으로 종합 반영되었습니다.`)
    } finally {
      setMonthlySummaryLoading(false)
    }
  }

  async function handleReflectSettlement(block) {
    const targetDateKey = getSettlementBlockDateKey(block)
    if (!block || !targetDateKey) {
      window.alert('반영할 일일결산 데이터가 없습니다.')
      return
    }
    setReflectLoading(true)
    try {
      await api('/api/settlement/records/reflect', {
        method: 'POST',
        body: JSON.stringify({
          category: 'daily',
          settlement_date: targetDateKey,
          title: block.title || '',
          block,
        }),
      })
      await loadRecords()
      window.alert(`${formatSettlementDateKeyLabel(targetDateKey)} 결산이 최종 반영되었습니다.`)
    } catch (error) {
      window.alert(error.message || '결산반영 중 오류가 발생했습니다.')
    } finally {
      setReflectLoading(false)
    }
  }

  function setActiveEmailValue(value) {
    if (activePlatform === '오늘') setOhouEmail(value)
    else setSoomgoEmail(value)
  }

  function setActivePasswordValue(value) {
    if (activePlatform === '오늘') setOhouPassword(value)
    else setSoomgoPassword(value)
  }

  function setActiveAuthStateValue(value) {
    if (activePlatform === '오늘') setOhouAuthStateText(value)
    else setSoomgoAuthStateText(value)
  }


  async function handleSaveDailyRecord(record, blockDraft) {
    const targetDateKey = String(record?.settlement_date || getSettlementBlockDateKey(blockDraft) || '').trim()
    if (!targetDateKey) {
      window.alert('저장할 결산 날짜를 찾을 수 없습니다.')
      return
    }
    await api('/api/settlement/records/reflect', {
      method: 'POST',
      body: JSON.stringify({
        category: 'daily',
        settlement_date: targetDateKey,
        title: blockDraft?.title || record?.title || '',
        block: blockDraft,
      }),
    })
    await loadRecords()
    window.alert(`${formatSettlementDateKeyLabel(targetDateKey)} 일일결산이 저장되었습니다.`)
  }

  function handleOpenSettlementEditor(target, block) {
    const dateKey = getSettlementBlockDateKey(block)
    if (!block || !dateKey) {
      window.alert('수정할 결산 데이터를 찾을 수 없습니다.')
      return
    }
    setEditorTarget(target)
    setEditorDateKey(dateKey)
    setEditorDraft(buildSettlementEditorDraft(block))
    setEditorOpen(true)
  }

  function handleCloseSettlementEditor() {
    setEditorOpen(false)
    setEditorDraft(null)
    setEditorDateKey('')
  }

  function updateSettlementEditorDraft(section, index, field, value) {
    setEditorDraft(prev => {
      if (!prev) return prev
      const next = buildSettlementEditorDraft(prev)
      if (!next) return prev
      next[section][index][field] = value
      return recalculateSettlementBlock(next)
    })
  }

  function applySettlementOverride(target, dateKey, block) {
    if (target === 'weekly') {
      setWeeklyOverrideMap(prev => ({ ...prev, [dateKey]: buildSettlementEditorDraft(block) }))
      return
    }
    if (target === 'monthly') {
      setMonthlyOverrideMap(prev => ({ ...prev, [dateKey]: buildSettlementEditorDraft(block) }))
      return
    }
    setDailyOverrideMap(prev => ({ ...prev, [dateKey]: buildSettlementEditorDraft(block) }))
  }

  function handleSaveSettlementEditor() {
    if (!editorDraft || !editorDateKey) return
    applySettlementOverride(editorTarget, editorDateKey, editorDraft)
    handleCloseSettlementEditor()
    window.alert('결산 수정값이 저장되었습니다.')
  }

  function handleResetSettlementBlock(target, block) {
    const dateKey = getSettlementBlockDateKey(block)
    if (!block || !dateKey) {
      window.alert('초기화할 결산 데이터를 찾을 수 없습니다.')
      return
    }
    if (!window.confirm('수정 가능한 결산 수치를 0으로 초기화할까요?')) return
    applySettlementOverride(target, dateKey, resetEditableSettlementBlock(block))
    window.alert('수정 가능한 결산 수치를 0으로 초기화했습니다.')
  }


  let content = null
  if (activeCategory === 'records') {
    content = <SettlementRecordBoard recordsByType={recordsData} onSaveDailyRecord={handleSaveDailyRecord} canEdit={true} />
  } else if (activeCategory === 'daily') {
    content = selectedDailyBlock ? (
      <>
        <div className="settlement-day-nav card">
          <div className="settlement-day-nav-title-row settlement-day-nav-title-row-single-line">
            <div className="settlement-day-nav-title centered-nav-title single-line-settlement-title settlement-title-nav-inline">
              <button type="button" className="ghost small settlement-arrow-button" onClick={() => setDailyIndex(prev => Math.max(0, prev - 1))} disabled={dailyIndex <= 0}>◀</button>
              <strong>◀ 일간 결산 ▶</strong>
              <button type="button" className="ghost small settlement-arrow-button" onClick={() => setDailyIndex(prev => Math.min(sortedDailyBlocks.length - 1, prev + 1))} disabled={dailyIndex >= sortedDailyBlocks.length - 1}>▶</button>
            </div>
          </div>
          <div className="settlement-day-nav-control-row settlement-day-nav-control-row-title-actions fixed-two-line">
            <div className="settlement-day-nav-spacer" aria-hidden="true" />
            <div className="muted settlement-day-nav-date centered-date-pill">{selectedDailyBlock ? `${formatSettlementDateKeyLabel(selectedDailyBlockDateKey)} (${['일', '월', '화', '수', '목', '금', '토'][parseSettlementDateKey(selectedDailyBlockDateKey)?.getDay?.() ?? 0]}) 결산` : '-'}</div>
            <div className="settlement-day-nav-actions compact-right-actions">
              <button type="button" className="ghost small" onClick={() => handleOpenSettlementEditor('daily', selectedDailyBlock)}>수정</button>
              <button type="button" className="ghost small" onClick={() => handleResetSettlementBlock('daily', selectedDailyBlock)}>초기화</button>
            </div>
          </div>
        </div>
        <div className="settlement-sheet-grid settlement-sheet-grid-single">
          <div className="settlement-daily-week-card-wrap">
            <SettlementSheetCard block={selectedDailyBlock} hideTitleDate />
            <div className="settlement-inline-actions">
              <button type="button" onClick={() => handleReflectSettlement(selectedDailyBlock)} disabled={reflectLoading}>
                {reflectLoading ? '반영중...' : `${formatSettlementDateKeyLabel(selectedDailyBlockDateKey)} 결산반영`}
              </button>
            </div>
          </div>
        </div>
      </>
    ) : <div className="card muted">표시할 일일결산 데이터가 없습니다.</div>
  } else if (activeCategory === 'weekly') {
    content = selectedWeeklyBlock ? (
      <>
        <div className="settlement-day-nav card">
          <div className="settlement-day-nav-title-row settlement-day-nav-title-row-single-line">
            <div className="settlement-day-nav-title centered-nav-title single-line-settlement-title settlement-title-nav-inline">
              <button type="button" className="ghost small settlement-arrow-button" onClick={() => setWeeklyIndex(prev => Math.max(0, prev - 1))} disabled={weeklyIndex <= 0}>◀</button>
              <strong>◀ 주간 결산 ▶</strong>
              <button type="button" className="ghost small settlement-arrow-button" onClick={() => setWeeklyIndex(prev => Math.min(weeklyBlocks.length - 1, prev + 1))} disabled={weeklyIndex >= weeklyBlocks.length - 1}>▶</button>
            </div>
          </div>
          <div className="settlement-day-nav-control-row settlement-day-nav-control-row-title-actions fixed-two-line">
            <div className="settlement-day-nav-spacer" aria-hidden="true" />
            <div className="muted settlement-day-nav-date centered-date-pill">{formatWeeklySettlementTitle(selectedWeeklyBlock, weeklyIndex)}</div>
            <div className="settlement-day-nav-actions compact-right-actions">
              <button type="button" className="ghost small" onClick={() => handleOpenSettlementEditor('weekly', selectedWeeklyBlock)}>수정</button>
              <button type="button" className="ghost small" onClick={() => handleResetSettlementBlock('weekly', selectedWeeklyBlock)}>초기화</button>
            </div>
          </div>
        </div>
        <div className="settlement-sheet-grid settlement-sheet-grid-single">
          <SettlementSheetCard block={selectedWeeklyBlock} hideTitleDate />
        </div>
      </>
    ) : <div className="card muted">표시할 주간결산 데이터가 없습니다.</div>
  } else {
    content = selectedMonthlyBlock ? (
      <>
        <div className="settlement-day-nav card">
          <div className="settlement-day-nav-title-row settlement-day-nav-title-row-single-line">
            <div className="settlement-day-nav-title centered-nav-title single-line-settlement-title settlement-title-nav-inline">
              <button type="button" className="ghost small settlement-arrow-button" onClick={() => setMonthlyIndex(prev => Math.max(0, prev - 1))} disabled={monthlyIndex <= 0}>◀</button>
              <strong>◀ 월간 결산 ▶</strong>
              <button type="button" className="ghost small settlement-arrow-button" onClick={() => setMonthlyIndex(prev => Math.min(monthlyBlocks.length - 1, prev + 1))} disabled={monthlyIndex >= monthlyBlocks.length - 1}>▶</button>
            </div>
          </div>
          <div className="settlement-day-nav-control-row settlement-day-nav-control-row-title-actions fixed-two-line">
            <div className="settlement-day-nav-spacer" aria-hidden="true" />
            <div className="muted settlement-day-nav-date centered-date-pill">{formatMonthlySettlementTitle(selectedMonthlyBlock, monthlyIndex)}</div>
            <div className="settlement-day-nav-actions compact-right-actions">
              <button type="button" className="ghost small" onClick={() => handleOpenSettlementEditor('monthly', selectedMonthlyBlock)}>수정</button>
              <button type="button" className="ghost small" onClick={() => handleResetSettlementBlock('monthly', selectedMonthlyBlock)}>초기화</button>
            </div>
          </div>
        </div>
        <div className="settlement-sheet-grid settlement-sheet-grid-single">
          <SettlementSheetCard block={selectedMonthlyBlock} hideTitleDate />
        </div>
        <div className="settlement-float-actions">
          <button type="button" onClick={handleRefreshMonthlySummary} disabled={monthlySummaryLoading}>
            {monthlySummaryLoading ? '종합중...' : '월간결산종합'}
          </button>
        </div>
      </>
    ) : <div className="card muted">표시할 월간결산 데이터가 없습니다.</div>
  }

  return (
    <div className="stack-page settlement-page">
      {editorOpen && editorDraft ? (
        <div className="settlement-editor-backdrop" onClick={handleCloseSettlementEditor}>
          <div className="settlement-editor-modal card" onClick={event => event.stopPropagation()}>
            <div className="between settlement-editor-head">
              <strong>{editorTarget === 'daily' ? '일일 결산 수정' : (editorTarget === 'weekly' ? '주간 결산 수정' : '월간 결산 수정')}</strong>
              <button type="button" className="ghost small" onClick={handleCloseSettlementEditor}>닫기</button>
            </div>
            <div className="settlement-editor-sections">
              <section className="settlement-editor-section">
                <strong>플랫폼 발송 건수</strong>
                <div className="settlement-editor-grid compact">
                  {editableSummaryRows.map(row => {
                    const rowIndex = (editorDraft.summaryRows || []).findIndex(item => item === row)
                    return (
                      <label key={`summary-count-${row.source}`}>
                        <span>{row.source}</span>
                        <input value={row.count || ''} onChange={e => updateSettlementEditorDraft('summaryRows', rowIndex, 'count', e.target.value)} inputMode="numeric" />
                      </label>
                    )
                  })}
                </div>
              </section>
              <section className="settlement-editor-section">
                <strong>플랫폼 리뷰 건수</strong>
                <div className="settlement-editor-grid compact">
                  {(editorDraft.branchRows || []).filter(row => row?.platform).map(row => {
                    const rowIndex = (editorDraft.branchRows || []).findIndex(item => item === row)
                    return (
                      <label key={`platform-review-${row.platform}`}>
                        <span>{row.platform}</span>
                        <input value={row.platformCount || ''} onChange={e => updateSettlementEditorDraft('branchRows', rowIndex, 'platformCount', e.target.value)} inputMode="numeric" />
                      </label>
                    )
                  })}
                </div>
              </section>
              <section className="settlement-editor-section">
                <strong>각 호점별 누적리뷰 건수</strong>
                <div className="settlement-editor-grid">
                  {(editorDraft.branchRows || []).map((row, rowIndex) => (
                    <label key={`branch-review-${row.branch || rowIndex}`}>
                      <span>{row.branch || `행 ${rowIndex + 1}`}</span>
                      <input value={row.branchCount || ''} onChange={e => updateSettlementEditorDraft('branchRows', rowIndex, 'branchCount', e.target.value)} inputMode="numeric" />
                    </label>
                  ))}
                </div>
              </section>
              <section className="settlement-editor-section">
                <strong>이슈 건수</strong>
                <div className="settlement-editor-grid">
                  {(editorDraft.branchRows || []).map((row, rowIndex) => (
                    <label key={`issue-${row.branch || rowIndex}`}>
                      <span>{row.branch || `행 ${rowIndex + 1}`}</span>
                      <input value={row.issues || ''} onChange={e => updateSettlementEditorDraft('branchRows', rowIndex, 'issues', e.target.value)} inputMode="numeric" />
                    </label>
                  ))}
                </div>
              </section>
              <section className="settlement-editor-section">
                <strong>견적 발송 및 계약률 결산</strong>
                <div className="settlement-editor-grid compact single">
                  {contractSummaryRowIndex >= 0 ? (
                    <label>
                      <span>2. 총 계약 수(건)</span>
                      <input value={editorDraft.summaryRows?.[contractSummaryRowIndex]?.value || ''} onChange={e => updateSettlementEditorDraft('summaryRows', contractSummaryRowIndex, 'value', e.target.value)} inputMode="numeric" />
                    </label>
                  ) : <div className="muted">수정 가능한 계약 수 데이터가 없습니다.</div>}
                </div>
              </section>
            </div>
            <div className="settlement-editor-actions">
              <button type="button" className="ghost small" onClick={() => setEditorDraft(resetEditableSettlementBlock(editorDraft))}>수정칸 0으로 채우기</button>
              <button type="button" onClick={handleSaveSettlementEditor}>저장</button>
            </div>
          </div>
        </div>
      ) : null}
      <section className="card settlement-hero">
        <div className="settlement-hero-topbar">
          <div className="settlement-tabs settlement-tabs-inline" role="tablist" aria-label="결산 카테고리">
            {categories.map(tab => (
              <button key={tab.id} type="button" className={activeCategory === tab.id ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => handleSettlementCategoryChange(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="settlement-sync-actions settlement-sync-actions-inline-top">
            <button type="button" className="small" onClick={handleRefreshSync} disabled={syncLoading || syncStatus.is_running}>
              {syncLoading || syncStatus.is_running ? '연동중...' : '연동'}
            </button>
            <button type="button" className="ghost small settlement-gear-button" onClick={() => setSettingsOpen(prev => !prev)} aria-label="설정">
              ⚙
            </button>
          </div>
        </div>
        {statusDetailOpen && (
          <div className="settlement-status-detail card">
            <div className="muted">일일결산은 하루씩만 표시되며, 결산반영 버튼으로 결산기록에 저장됩니다.</div>
            <div className="muted settlement-sync-summary">{formatSettlementSyncDetail(soomgoMetric, '숨고')}</div>
            <div className="muted settlement-sync-summary">{formatSettlementSyncDetail(ohouMetric, '오늘')}</div>
            <div className="muted settlement-sync-summary">저장된 결산기록 {recordsLoading ? '불러오는 중...' : `${(recordsData.daily_records || []).length}건`}</div>
          </div>
        )}

        {settingsOpen && (
          <div className="settlement-settings-panel">
            <div className="settlement-settings-tabs">
              <button type="button" className={activeSettingPlatform === '숨고' ? 'small active' : 'small'} onClick={() => handleTogglePlatformSetting('숨고')}>숨고 인증세션</button>
              <button type="button" className={activeSettingPlatform === '오늘' ? 'small active' : 'small'} onClick={() => handleTogglePlatformSetting('오늘')}>오늘 인증세션</button>
            </div>

            {activeSettingPlatform && (
              <div className="settlement-credential-panel">
                <div className="between settlement-config-head">
                  <div>
                    <strong>{activePlatform} 인증세션 설정</strong>
                    <div className="muted settlement-sync-warning">
                      email 소스: <strong>{activeConfig.email_env || '없음'}</strong> · password 소스: <strong>{activeConfig.password_env || '없음'}</strong> · 인증세션: <strong>{activeConfig.auth_state_present ? '저장됨' : '없음'}</strong>
                    </div>
                  </div>
                  <button type="button" className="ghost small" onClick={() => handleOpenGuide(activePlatform)}>설명서</button>
                </div>

                <div className="settlement-credential-grid">
                  <input value={activeEmail} onChange={e => setActiveEmailValue(e.target.value)} placeholder={`${activePlatform} 아이디(이메일)`} />
                  <input type="password" value={activePassword} onChange={e => setActivePasswordValue(e.target.value)} placeholder={`${activePlatform} 비밀번호`} />
                  <button type="button" className="small" onClick={() => handleSaveCredentials(activePlatform)} disabled={credentialLoading}>{credentialLoading ? '저장중...' : `${activePlatform} 계정 저장`}</button>
                </div>

                <div className="muted settlement-sync-warning">
                  {activePlatform === '숨고' ? '숨고는 로그인 이후 바로 새로고침하지 말고 대시보드가 열린 상태에서 인증세션 저장을 진행해 주세요.' : '오늘의집은 파트너센터 이동 페이지가 열린 상태에서 인증세션 저장을 진행해 주세요.'}
                </div>

                <textarea className="settlement-auth-state-textarea" value={activeAuthStateText} onChange={e => setActiveAuthStateValue(e.target.value)} placeholder={`${activePlatform} storageState JSON 전체를 붙여 넣어 주세요.`} />
                <div className="settlement-sync-actions settlement-sync-actions-inline">
                  <button type="button" className="small" onClick={() => handleAuthStateUpload(activePlatform)} disabled={authStateLoading === activePlatform}>{authStateLoading === activePlatform ? '저장중...' : '인증세션 저장'}</button>
                </div>

                {guidePlatform === activePlatform && (
                  <div className="settlement-guide-card">
                    {guideLoading && <div className="muted">설명서를 불러오는 중입니다.</div>}
                    {!guideLoading && guideData && (
                      <>
                        <div className="settlement-guide-section">
                          <strong>{guideData.title}</strong>
                          <div className="muted">{guideData.description}</div>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>저장 경로</strong>
                          <ul>{(guideData.paths || []).map((item, index) => <li key={`path-${index}`}>{item}</li>)}</ul>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>터미널 명령어</strong>
                          <pre>{(guideData.commands || []).join('\n')}</pre>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>진행 절차</strong>
                          <ol>{(guideData.steps || []).map((item, index) => <li key={`step-${index}`}>{item}</li>)}</ol>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>인증세션 저장 버튼을 눌러야 하는 타이밍</strong>
                          <div>{guideData.timing}</div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </section>

      {content}
    </div>
  )
}


function clampMaterialsScale(value) {
  const parsed = Number(value || 100)
  if (!Number.isFinite(parsed)) return 100
  return Math.min(140, Math.max(80, Math.round(parsed)))
}

function materialsStageStatusLabel(status) {
  if (status === 'settled') return '결산완료'
  if (status === 'rejected') return '반려됨'
  return '신청접수'
}

function isMaterialsAdminUser(user) {
  return Number(user?.grade || 6) <= 2
}

const MATERIALS_TABLE_WIDTH_DEFAULTS = {
  sales: [150, 104, 90, 108, 124],
  confirm: [150, 104, 108, 124],
  incoming: [150, 104, 90, 96, 96, 120, 180],
  inventory: [150, 88, 96, 96, 104, 180],
  myRequests: [180, 108, 108, 124, 120],
  requesters: [72, 70, 92, 124, 124, 98],
  settlements: [72, 70, 92, 124, 124, 98],
  history: [112, 108, 150, 148, 148, 124],
}

const MATERIALS_TABLE_EDIT_OPTIONS = [
  { value: 'width', label: '표 가로 사이즈' },
  { value: 'scale', label: '표 가로 배율(%)' },
]

const MATERIALS_TABLE_TARGET_OPTIONS = [
  { value: 'sales', label: '자재구매(1/2)' },
  { value: 'confirm', label: '자재구매(2/2)' },
  { value: 'myRequests', label: '신청현황' },
  { value: 'requesters', label: '신청목록' },
  { value: 'incoming', label: '자재입고' },
  { value: 'settlements', label: '구매결산' },
  { value: 'history', label: '구매목록' },
]

const MATERIALS_TABLE_COLUMN_LABELS = {
  sales: ['구분', '물품가', '현재고', '구매수량', '합계금액'],
  confirm: ['구분', '물품가', '구매수량', '합계금액'],
  myRequests: ['구매물품', '구매가격', '구매수량', '합계가격', '결산처리상태'],
  requesters: ['선택', '호점', '이름', '구매신청일자', '결산처리완료일자', '물품총합계'],
  incoming: ['구분', '물품가', '현재고', '입고량', '출고량', '정산수량', '비고'],
  settlements: ['선택', '호점', '이름', '구매신청일자', '결산처리완료일자', '물품총합계'],
  history: ['선택', '호점', '이름', '구매신청일자', '결산처리완료일자', '물품총합계'],
}

function getMaterialsDeviceType(isMobile) {
  return isMobile ? 'mobile' : 'desktop'
}

function clampMaterialsColumnWidth(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return 80
  return Math.min(360, Math.max(56, Math.round(num)))
}

function normalizeMaterialsColumnWidths(key, values, isMobile) {
  const defaults = MATERIALS_TABLE_WIDTH_DEFAULTS[key] || []
  const minWidth = isMobile ? 52 : 64
  return defaults.map((fallback, index) => {
    const raw = Array.isArray(values) ? values[index] : undefined
    const base = raw == null || raw === '' ? fallback : raw
    return Math.max(minWidth, clampMaterialsColumnWidth(base))
  })
}

function buildMaterialsGridTemplate(key, widths, isMobile) {
  const normalized = normalizeMaterialsColumnWidths(key, widths, isMobile)
  if (isMobile) {
    const total = normalized.reduce((sum, width) => sum + width, 0) || 1
    return normalized.map(width => `minmax(0, ${(width / total * 100).toFixed(4)}%)`).join(' ')
  }
  return normalized.map(width => `${width}px`).join(' ')
}

function MaterialsPage({ user }) {

  const isMobile = useIsMobile()
  const employeeRestricted = isEmployeeRestrictedUser(user)
  const canPurchaseMaterials = canUseMaterialsPurchase(user)
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [activeTab, setActiveTab] = useState('sales')
  const [salesStep, setSalesStep] = useState(1)
  const [quantities, setQuantities] = useState({})
  const [requestNote, setRequestNote] = useState('')
  const [selectedRequestIds, setSelectedRequestIds] = useState([])
  const [myEditing, setMyEditing] = useState(false)
  const [mySelectedRequestIds, setMySelectedRequestIds] = useState([])
  const [myRequestDraft, setMyRequestDraft] = useState({})
  const [myPulseRequestIds, setMyPulseRequestIds] = useState([])
  const [myPulseQtyKeys, setMyPulseQtyKeys] = useState([])
  const [myPulseSaveCue, setMyPulseSaveCue] = useState(false)
  const [inventoryDraft, setInventoryDraft] = useState({})
  const [incomingDraft, setIncomingDraft] = useState({})
  const [incomingEntryDate, setIncomingEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [forceIncomingApply, setForceIncomingApply] = useState(false)
  const [notice, setNotice] = useState('')
  const [salesError, setSalesError] = useState('')
  const [settlementFilterDate, setSettlementFilterDate] = useState('')
  const [myRequestStartDate, setMyRequestStartDate] = useState('')
  const [myRequestEndDate, setMyRequestEndDate] = useState('')
  const [myRequestStatusFilter, setMyRequestStatusFilter] = useState('all')
  const [tableScaleSettings, setTableScaleSettings] = useState({ sales: 100, confirm: 100, myRequests: 100, incoming: 100, inventory: 100, requesters: 100, history: 100, settlements: 100 })
  const [tableColumnSettings, setTableColumnSettings] = useState(() => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, normalizeMaterialsColumnWidths(key, MATERIALS_TABLE_WIDTH_DEFAULTS[key], isMobile)])))
  const [requestDeleteMenuOpen, setRequestDeleteMenuOpen] = useState(false)
  const [requestDeletePopupOpen, setRequestDeletePopupOpen] = useState(false)
  const [requestDeleteRows, setRequestDeleteRows] = useState([])
  const [requestDeleteSelection, setRequestDeleteSelection] = useState([])
  const [requestDeleteDateFilter, setRequestDeleteDateFilter] = useState('')
  const requestDeleteDateOptions = Array.from(new Set(requestDeleteRows.map(request => String(request.created_at || '').slice(0, 10)).filter(Boolean))).sort((a, b) => b.localeCompare(a))
  const [requestDeleteLoading, setRequestDeleteLoading] = useState(false)
  const [requestDeleteSubmitting, setRequestDeleteSubmitting] = useState(false)
  const resizeStateRef = useRef(null)

  const accountGuide = '3333-29-1202673 카카오뱅크 (심진수)'
  const myRequestStartDateInputRef = useRef(null)
  const myRequestEndDateInputRef = useRef(null)

  function openCompactDatePicker(inputRef) {
    const input = inputRef?.current
    if (!input) return
    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }
    input.focus()
    input.click()
  }

  function formatCompactDateLabel(value) {
    if (!value) return '-- -- --'
    const raw = String(value).trim()
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (match) return `${match[1].slice(2)}-${match[2]}-${match[3]}`
    return raw
  }

  async function loadOverview(nextTab) {
    setLoading(true)
    try {
      const [result, scaleResult, layoutResult] = await Promise.all([
        api('/api/materials/overview'),
        api('/api/materials/table-scale').catch(() => ({ scales: {} })),
        api(`/api/materials/table-layout?device=${getMaterialsDeviceType(isMobile)}`).catch(() => ({ layouts: {} })),
      ])
      setData(result)
      const savedScale = scaleResult?.scales || {}
      setTableScaleSettings(prev => ({
        sales: clampMaterialsScale(savedScale.sales ?? prev.sales),
        confirm: clampMaterialsScale(savedScale.confirm ?? prev.confirm),
        myRequests: clampMaterialsScale(savedScale.myRequests ?? prev.myRequests),
        incoming: clampMaterialsScale(savedScale.incoming ?? prev.incoming),
        inventory: clampMaterialsScale(savedScale.inventory ?? prev.inventory),
        requesters: clampMaterialsScale(savedScale.requesters ?? prev.requesters),
        history: clampMaterialsScale(savedScale.history ?? prev.history),
        settlements: clampMaterialsScale(savedScale.settlements ?? prev.settlements),
      }))
      const savedLayouts = layoutResult?.layouts || {}
      setTableColumnSettings(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, normalizeMaterialsColumnWidths(key, savedLayouts[key] ?? prev[key] ?? MATERIALS_TABLE_WIDTH_DEFAULTS[key], isMobile)])))
      setInventoryDraft(Object.fromEntries((result.inventory_rows || []).map(row => [row.product_id, { incoming_qty: row.incoming_qty || 0, note: row.note || '' }])))
      setIncomingDraft(Object.fromEntries((result.products || []).map(row => {
        const inventoryRow = (result.inventory_rows || []).find(item => Number(item.product_id) === Number(row.id)) || {}
        return [row.id, { incoming_qty: 0, outgoing_qty: Number(inventoryRow.manual_outgoing_qty || 0), note: inventoryRow.note || '' }]
      })))
      setIncomingEntryDate(result?.today || new Date().toISOString().slice(0, 10))
      const tabs = buildVisibleTabs(result?.permissions || {})
      setActiveTab(nextTab && tabs.some(item => item.id === nextTab) ? nextTab : (tabs[0]?.id || 'sales'))
    } catch (error) {
      setNotice(error.message || '자재 데이터를 불러오지 못했습니다.')
      setSalesError('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOverview(searchParams.get('tab') || undefined)
  }, [searchParams])

  useEffect(() => {
    const nextDraft = {}
    for (const request of (data?.my_requests || [])) {
      for (const item of (request.items || [])) {
        nextDraft[`${request.id}-${item.product_id}`] = Number(item.quantity || 0)
      }
    }
    setMyRequestDraft(nextDraft)
    setMySelectedRequestIds([])
    setMyEditing(false)
    setMyPulseRequestIds([])
    setMyPulseQtyKeys([])
    setMyPulseSaveCue(false)
  }, [data?.my_requests])

  function buildVisibleTabs(permissions) {
    return [
      permissions.can_view_sales ? { id: 'sales', label: '자재구매' } : null,
      permissions.can_view_my_requests && !employeeRestricted ? { id: 'myRequests', label: '신청현황' } : null,
      permissions.can_view_requesters ? { id: 'requesters', label: '신청목록' } : null,
      permissions.can_manage_incoming ? { id: 'incoming', label: '자재입고' } : null,
      permissions.can_view_settlements ? { id: 'settlements', label: '구매결산' } : null,
      permissions.can_view_history ? { id: 'history', label: '구매목록' } : null,
    ].filter(Boolean)
  }

  const visibleTabs = buildVisibleTabs(data?.permissions || {})
  const productRows = data?.products || []
  const pendingRequests = data?.pending_requests || []
  const settledRequests = data?.settled_requests || []
  const historyRequests = data?.history_requests || []
  const myRequests = data?.my_requests || []
  const inventoryRows = data?.inventory_rows || []
  const isInventoryManager = Boolean(data?.permissions?.can_manage_inventory)
  const settlementDateOptions = Array.from(new Set(settledRequests.map(request => String(request.created_at || '').slice(0, 10)).filter(Boolean))).sort((a, b) => b.localeCompare(a))
  const filteredSettledRequests = settlementFilterDate ? settledRequests.filter(request => String(request.created_at || '').slice(0, 10) === settlementFilterDate) : settledRequests

  const cartRows = productRows
    .map(product => {
      const quantity = Math.max(0, Number(quantities[product.id] || 0))
      return {
        ...product,
        quantity,
        lineTotal: quantity * Number(product.unit_price || 0),
      }
    })
    .filter(product => product.quantity > 0)

  const cartTotal = cartRows.reduce((sum, item) => sum + item.lineTotal, 0)
  const insufficientCartItem = cartRows.find(item => Number(item.quantity || 0) > Number(item.current_stock || 0))

  function getTableScaleStyle(key) {
    const scale = clampMaterialsScale(tableScaleSettings[key])
    return { '--materials-table-scale': String(scale / 100) }
  }

  function getTableGridStyle(key) {
    return { gridTemplateColumns: buildMaterialsGridTemplate(key, tableColumnSettings[key], isMobile) }
  }

  function getRequestSheetGridStyle(key) {
    return { gridTemplateColumns: buildMaterialsGridTemplate(key, tableColumnSettings[key], isMobile) }
  }

  function renderResizableRowCells(labels) {
    return labels.map((label, index) => (
      <div key={`materials-head-${index}`} className="materials-resize-cell">
        <span>{label}</span>
      </div>
    ))
  }

  function updateQuantity(productId, value) {
    if (!canPurchaseMaterials) return
    const nextValue = String(value).replace(/[^\d]/g, '')
    const nextQuantity = nextValue ? Number(nextValue) : ''
    const product = productRows.find(item => Number(item.id) === Number(productId))
    const stock = Number(product?.current_stock || 0)
    if (nextValue && Number(nextQuantity) > stock) {
      window.alert('현재고보다 구매수량이 많습니다. 구매수량을 줄여주세요')
    }
    setQuantities(prev => ({ ...prev, [productId]: nextQuantity }))
  }

  async function submitPurchaseRequest() {
    if (!canPurchaseMaterials) {
      setNotice('직원 계정은 자재를 구매할 수 없습니다.')
      return
    }
    if (cartRows.length === 0) {
      setNotice('구매 수량을 입력한 뒤 진행해 주세요.')
      return
    }
    const confirmed = window.confirm('3333-29-1202673 카카오뱅크 (심진수)으로 입금하였습니까?')
    if (!confirmed) return
    setSaving(true)
    try {
      const createdResult = await api('/api/materials/purchase-requests', {
        method: 'POST',
        body: JSON.stringify({
          request_note: requestNote,
          items: cartRows.map(item => ({ product_id: item.id, quantity: item.quantity })),
        }),
      })
      if (createdResult?.request) {
        setData(prev => prev ? ({ ...prev, my_requests: [createdResult.request, ...(prev.my_requests || [])] }) : prev)
      }
      setNotice('자재구매 신청이 완료되었습니다. 신청현황 화면으로 이동합니다.')
      setSalesError('')
      setQuantities({})
      setRequestNote('')
      setSalesStep(1)
      await loadOverview('myRequests')
    } catch (error) {
      setNotice(error.message || '자재구매 신청 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function loadRequestDeleteRows() {
    if (!isMaterialsAdminUser(user)) return
    setRequestDeleteLoading(true)
    try {
      const result = await api('/api/admin/materials/purchase-requests')
      setRequestDeleteRows(Array.isArray(result?.requests) ? result.requests : [])
      setRequestDeleteSelection([])
    } catch (error) {
      window.alert(error.message || '현황기록삭제 목록을 불러오지 못했습니다.')
    } finally {
      setRequestDeleteLoading(false)
    }
  }

  async function openRequestDeletePopup() {
    setRequestDeleteMenuOpen(false)
    setRequestDeletePopupOpen(true)
    await loadRequestDeleteRows()
  }

  function closeRequestDeletePopup() {
    setRequestDeletePopupOpen(false)
    setRequestDeleteSelection([])
    setRequestDeleteDateFilter('')
  }

  const filteredRequestDeleteRows = requestDeleteRows.filter(request => {
    if (!requestDeleteDateFilter) return true
    const createdAt = String(request.created_at || '')
    return createdAt.slice(0, 10) === requestDeleteDateFilter
  })

  async function deleteSelectedRequestRows() {
    if (!requestDeleteSelection.length) {
      window.alert('삭제할 신청현황을 선택해 주세요.')
      return
    }
    if (!window.confirm('선택한 신청접수 묶음 기록을 완전히 삭제하시겠습니까?')) return
    setRequestDeleteSubmitting(true)
    try {
      await api('/api/admin/materials/purchase-requests/delete', {
        method: 'POST',
        body: JSON.stringify({ request_ids: requestDeleteSelection }),
      })
      setNotice('선택한 신청접수 기록이 완전히 삭제되었습니다.')
      await loadRequestDeleteRows()
      await loadOverview('myRequests')
    } catch (error) {
      window.alert(error.message || '현황기록삭제 처리 중 오류가 발생했습니다.')
    } finally {
      setRequestDeleteSubmitting(false)
    }
  }

  useEffect(() => {
    if (!requestDeletePopupOpen) return
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setRequestDeletePopupOpen(false)
        setRequestDeleteSelection([])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [requestDeletePopupOpen])

  async function settleSelectedRequests() {
    if (selectedRequestIds.length === 0) {
      setNotice('입금확인 처리할 구매신청자를 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/api/materials/purchase-requests/settle', {
        method: 'POST',
        body: JSON.stringify({ request_ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setNotice(`${result.settled_requests?.length || 0}건의 결산이 등록되었습니다.`)
      await loadOverview('settlements')
    } catch (error) {
      setNotice(error.message || '결산등록 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function rejectSelectedRequests() {
    if (selectedRequestIds.length === 0) {
      setNotice('결산반려 처리할 구매신청자를 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/api/materials/purchase-requests/reject', {
        method: 'POST',
        body: JSON.stringify({ request_ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setNotice(`${result.rejected_requests?.length || 0}건의 결산반려가 처리되었습니다.`)
      await loadOverview('requesters')
    } catch (error) {
      setNotice(error.message || '결산반려 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function unsettleSelectedRequests() {
    if (selectedRequestIds.length === 0) {
      setNotice('결산취소할 신청건을 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/api/materials/purchase-requests/unsettle', {
        method: 'POST',
        body: JSON.stringify({ request_ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setNotice(`${result.requests?.length || 0}건의 결산이 취소되었습니다.`)
      await loadOverview('settlements')
    } catch (error) {
      setNotice(error.message || '결산취소 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function saveIncomingStock() {
    const rows = Object.entries(incomingDraft)
      .map(([productId, row]) => ({ product_id: Number(productId), incoming_qty: Number(row?.incoming_qty || 0), outgoing_qty: Number(row?.outgoing_qty || 0), note: row?.note || '' }))
      .filter(row => row.product_id > 0 && (row.incoming_qty > 0 || row.outgoing_qty > 0 || String(row.note || '').trim()))
    if (!rows.length) {
      setNotice('입고량 또는 출고량을 1개 이상 입력해 주세요.')
      return
    }
    setSaving(true)
    try {
      await api('/api/materials/incoming', {
        method: 'POST',
        body: JSON.stringify({ entry_date: incomingEntryDate, rows, force_apply: forceIncomingApply }),
      })
      setNotice(forceIncomingApply ? '강제입력이 반영되었습니다. 입출고 기록은 남기지 않고 현재고만 조정했습니다.' : '자재입출고가 반영되었습니다.')
      await loadOverview('incoming')
    } catch (error) {
      setNotice(error.message || '자재입고 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function saveInventoryDraft() {
    setSaving(true)
    try {
      await api('/api/materials/inventory', {
        method: 'POST',
        body: JSON.stringify({
          rows: Object.entries(inventoryDraft).map(([productId, row]) => ({
            product_id: Number(productId),
            incoming_qty: Number(row?.incoming_qty || 0),
            note: row?.note || '',
          })),
        }),
      })
      setNotice('재고현황이 저장되었습니다.')
      await loadOverview('inventory')
    } catch (error) {
      setNotice(error.message || '재고현황 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function closeInventoryDay() {
    setSaving(true)
    try {
      await api('/api/materials/inventory/close', { method: 'POST' })
      setNotice('당일 자재 결산이 완료되었습니다.')
      await loadOverview('inventory')
    } catch (error) {
      setNotice(error.message || '당일 자재 결산 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function shareSettlements() {
    const tableOnly = (settledRequests || []).map(request => {
      const header = `${String(request.created_at || '').slice(0, 10)} | ${request.requester_name} | ${Number(request.total_amount || 0).toLocaleString('ko-KR')}원`
      const items = (request.items || []).filter(item => Number(item.quantity || 0) > 0).map(item => `- ${item.short_name || item.name}: ${item.quantity}`)
      return [header, ...items].join('\n')
    }).join('\n\n')
    const shareText = `[구매자결산표]\n${tableOnly || '공유할 결산 데이터가 없습니다.'}`
    try {
      if (navigator.share) {
        await navigator.share({ title: '구매자결산표', text: shareText })
      } else {
        await navigator.clipboard.writeText(shareText)
      }
      setNotice('구매자결산표를 공유용 텍스트로 준비했습니다. 카카오톡 직접 방 선택 연동은 현재 웹 환경 제약으로 브라우저 공유/복사 방식으로 처리됩니다.')
    } catch (error) {
      setNotice('공유를 준비하지 못했습니다.')
    }
  }


  function groupedMyRequests() {
    const groups = []
    const sorted = [...myRequests].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    for (const request of sorted) {
      const visibleItems = (request.items || []).filter(item => Number(item.quantity || 0) > 0 || myEditing)
      groups.push({
        ...request,
        visibleItems,
        totalAmount: visibleItems.reduce((sum, item) => sum + (Number(myRequestDraft[`${request.id}-${item.product_id}`] ?? item.quantity ?? 0) * Number(item.unit_price || 0)), 0),
      })
    }
    return groups
  }

  function filterMyRequests(groups) {
    return groups.filter(request => {
      const createdDate = String(request.created_at || '').slice(0, 10)
      if (myRequestStartDate && createdDate < myRequestStartDate) return false
      if (myRequestEndDate && createdDate > myRequestEndDate) return false
      const statusLabel = formatRequestStatusLabel(request.status, (request.visibleItems || [])[0]?.quantity)
      if (myRequestStatusFilter !== 'all') {
        const matches = {
          pending: statusLabel === '신청접수',
          rejected: statusLabel === '반려됨',
          settled: statusLabel === '결산완료',
          canceled: statusLabel === '취소접수',
        }
        if (!matches[myRequestStatusFilter]) return false
      }
      return true
    })
  }

  async function saveMyRequestEdits() {
    if (mySelectedRequestIds.length === 0) {
      setNotice('수정/취소할 신청건을 선택해 주세요.')
      return
    }

    const changeSummaries = []
    const updatePayloads = []

    for (const requestId of mySelectedRequestIds) {
      const request = myRequests.find(item => item.id === requestId)
      if (!request || ['settled','rejected'].includes(String(request.status || ''))) continue
      const rows = []
      let hasChanges = false
      for (const item of (request.items || [])) {
        const originalQty = Math.max(0, Number(item.quantity || 0))
        const nextQty = Math.max(0, Number(myRequestDraft[`${request.id}-${item.product_id}`] ?? item.quantity ?? 0))
        rows.push({
          product_id: Number(item.product_id),
          quantity: nextQty,
        })
        if (nextQty !== originalQty) {
          hasChanges = true
          const itemName = displayMyRequestItemName(item)
          if (nextQty === 0) {
            changeSummaries.push(`- [${String(request.created_at || '').slice(0, 10)}]으로 신청한 ${itemName} ${originalQty}개가 ${nextQty}개로 수정되어 물품을 취소하겠습니까?`)
          } else {
            changeSummaries.push(`- [${String(request.created_at || '').slice(0, 10)}]으로 신청한 ${itemName} ${originalQty}개가 ${nextQty}개로 수정하겠습니까?`)
          }
        }
      }
      if (hasChanges) {
        updatePayloads.push({ requestId, rows })
      }
    }

    if (updatePayloads.length === 0) {
      setNotice('변경된 신청수량이 없습니다.')
      return
    }

    const confirmed = window.confirm(`아래 내용으로 수정/취소를 진행합니다.\n\n${changeSummaries.join('\n')}`)
    if (!confirmed) return

    setSaving(true)
    try {
      for (const payload of updatePayloads) {
        await api('/api/materials/purchase-requests', {
          method: 'PUT',
          body: JSON.stringify({ request_ids: [payload.requestId], rows: payload.rows }),
        })
      }
      setNotice('신청수량 수정/취소가 반영되었습니다.')
      await loadOverview('myRequests')
    } catch (error) {
      setNotice(error.message || '신청현황 수정 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function displayMaterialName(product, compact = false) {
    const base = String(product?.name || '')
    if (!compact) return base
    if (base === '스티커 인쇄물') return '스티커'
    return base
  }

  function displayMyRequestItemName(item) {
    const full = String(item?.name || '').trim()
    if (full) return full
    const short = String(item?.short_name || '').trim()
    if (short === '노비') return '노란 비닐'
    if (short === '흰비') return '흰색 비닐'
    if (short === '침비') return '침대 비닐'
    return short || '물품'
  }

  function formatDateLabel(value) {
    const raw = String(value || '').slice(0, 10)
    if (!raw) return ''
    const parts = raw.split('-')
    if (parts.length !== 3) return raw.replace(/-/g, '.')
    return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`
  }


  function formatSettlementFilterLabel(value) {
    const raw = String(value || '').slice(0, 10)
    if (!raw) return '전체일자'
    return raw
  }


  function renderRequestListHeader(mode) {
    const selectable = mode === 'pending' || mode === 'settled'
    const requestGridKey = mode === 'pending' ? 'requesters' : 'settlements'
    return (
      <div className={`materials-request-sheet-row materials-request-sheet-head materials-request-sheet-head-${mode} ${selectable ? 'with-check' : ''}`.trim()} style={getRequestSheetGridStyle(requestGridKey)}>
        {selectable ? <div className="materials-request-sheet-check">선택</div> : null}
        <div>호점</div>
        <div>이름</div>
        <div>구매신청일자</div>
        <div>결산처리완료일자</div>
        <div>물품총합계</div>
      </div>
    )
  }


  function runTemporaryPulse(setter, values, duration = 2200) {
    setter(Array.isArray(values) ? values : [values])
    window.setTimeout(() => setter([]), duration)
  }

  function runSaveButtonPulse(duration = 2200) {
    setMyPulseSaveCue(true)
    window.setTimeout(() => setMyPulseSaveCue(false), duration)
  }

  function startMyRequestEditing() {
    setMyEditing(true)
    const pendingIds = (myRequests || [])
      .filter(request => String(request.status || '') !== 'settled')
      .map(request => request.id)
    if (pendingIds.length) {
      window.setTimeout(() => runTemporaryPulse(setMyPulseRequestIds, pendingIds), 60)
    }
  }

  function handleMyRequestSelection(request, checked) {
    setMySelectedRequestIds(prev => checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))
    if (checked) {
      runTemporaryPulse(setMyPulseRequestIds, [request.id])
      const qtyKeys = (request.items || []).map(item => `${request.id}-${item.product_id}`)
      if (qtyKeys.length) runTemporaryPulse(setMyPulseQtyKeys, qtyKeys)
    }
  }

  function handleMyRequestDraftChange(request, item, nextValue) {
    const normalized = String(nextValue).replace(/[^\d]/g, '')
    const key = `${request.id}-${item.product_id}`
    const parsed = normalized ? Number(normalized) : 0
    setMyRequestDraft(prev => ({ ...prev, [key]: parsed }))
    if (mySelectedRequestIds.includes(request.id)) {
      runTemporaryPulse(setMyPulseQtyKeys, [key])
    }
    const original = Number(item.quantity || 0)
    if (parsed !== original) {
      runSaveButtonPulse()
    }
  }

  function renderSettlementHeaderLabel(product) {
    const label = String(product?.short_name || displayMaterialName(product, true) || '').trim()
    const match = label.match(/^(.*?)(\([^)]*\))$/)
    if (!match) return label
    return (
      <span className="materials-sheet-header-label">
        <span>{match[1].trim()}</span>
        <span>{match[2]}</span>
      </span>
    )
  }

  function moveCaretToEnd(event) {
    const input = event?.target
    if (!input || typeof input.setSelectionRange !== 'function') return
    window.requestAnimationFrame(() => {
      const length = String(input.value || '').length
      try {
        input.setSelectionRange(length, length)
      } catch {
        // noop
      }
    })
  }


  function renderSettlementTable(requests) {
    if (!requests.length) {
      return <div className="card muted">표시할 데이터가 없습니다.</div>
    }
    const activeProducts = productRows.filter(product => Number(product.is_active ?? 1) !== 0)
    return (
      <section className="materials-settlement-sheet">
        <div className="materials-sheet-banner">◆ 일일 본사 자재 출고 / 입금 현황</div>
        <div className="materials-sheet-table-wrap" style={getTableScaleStyle('settlements')}>
          <table className="materials-sheet-table">
            <thead>
              <tr>
                <th rowSpan={2}>구매신청일</th>
                <th rowSpan={2}>이름</th>
                <th colSpan={activeProducts.length}>묶음 개수</th>
                <th rowSpan={2}>입금 총계</th>
              </tr>
              <tr>
                {activeProducts.map(product => (
                  <th key={`settlement-head-${product.id}`}>{renderSettlementHeaderLabel(product)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(request => {
                const qtyMap = Object.fromEntries((request.items || []).map(item => [Number(item.product_id), Number(item.quantity || 0)]))
                return (
                  <tr key={`settlement-row-${request.id}`}>
                    <td>{formatDateLabel(request.created_at)}</td>
                    <td className="materials-sheet-name">{parseRequesterMeta(request).name}</td>
                    {activeProducts.map(product => (
                      <td key={`settlement-${request.id}-${product.id}`} className="materials-sheet-number">{qtyMap[Number(product.id)] || ''}</td>
                    ))}
                    <td className="materials-sheet-number materials-sheet-total">{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    )
  }


  function renderTabButton(tab) {
    const active = activeTab === tab.id
    return (
      <button key={tab.id} type="button" className={active ? 'ghost materials-tab active' : 'ghost materials-tab'} onClick={() => {
        setNotice('')
        setSalesError('')
        setSalesStep(1)
        setActiveTab(tab.id)
      }}>
        {tab.label}
      </button>
    )
  }

  function handleMaterialsPurchaseClick() {
    if (!canPurchaseMaterials) {
      setSalesError('직원 계정은 자재를 구매할 수 없습니다.')
      return
    }
    if (insufficientCartItem) {
      const label = insufficientCartItem.short_name || insufficientCartItem.name || '해당'
      setSalesError(`${label} 물품의 재고가 부족하여 구매를 할 수 없습니다.`)
      return
    }
    setSalesError('')
    setSalesStep(2)
  }

  function renderSalesPurchaseButtons(positionClass = '') {
    return (
      <div className={`row gap materials-actions-right materials-sales-submit-row ${positionClass}`.trim()}>
        <button type="button" className="ghost active materials-bottom-button" onClick={handleMaterialsPurchaseClick} disabled={!canPurchaseMaterials}>{canPurchaseMaterials ? '자재구매' : '직원 계정 사용불가'}</button>
      </div>
    )
  }

  function renderMaterialsPanelSettingsButton() {
    return null
  }

  function goToSettlementProgress() {
    if (!(data?.permissions?.can_view_requesters)) {
      setNotice('신청목록 권한이 없어 결산진행 화면으로 이동할 수 없습니다.')
      return
    }
    setSelectedRequestIds([])
    setActiveTab('requesters')
    setNotice('신청목록 화면에서 결산진행을 계속할 수 있습니다.')
  }


  function formatRequestStatusLabel(status, quantity = null) {
    const normalized = String(status || '').trim()
    if (normalized === 'settled') return '결산완료'
    if (normalized === 'rejected') return '반려됨'
    if (Number(quantity || 0) === 0) return '취소접수'
    return '신청접수'
  }

  function renderRequestItemSummary(items) {
    const visibleItems = (items || []).filter(item => Number(item.quantity || 0) > 0)
    if (!visibleItems.length) {
      return <div className="materials-request-items-empty muted">상세 내역이 없습니다.</div>
    }
    return (
      <div className="materials-request-items-grid">
        {visibleItems.map(item => (
          <div key={`summary-${item.id || item.product_id}`} className="materials-request-item-box">
            <div className="materials-request-item-box-top">{item.short_name || item.name || '물품'} / {Number(item.unit_price || 0).toLocaleString('ko-KR')}원</div>
            <div className="materials-request-item-box-bottom">{Number(item.quantity || 0)}개</div>
          </div>
        ))}
      </div>
    )
  }

  function buildHistoryDetailLines(items, maxLength = isMobile ? 34 : 88) {
    const tokens = (items || []).map(item => `${item.short_name || item.name || '물품'}(${Number(item.unit_price || 0).toLocaleString('ko-KR')}원*${Number(item.quantity || 0)}개)`).filter(Boolean)
    const lines = []
    let current = []
    let currentLength = 0
    tokens.forEach(token => {
      const nextLength = current.length === 0 ? token.length : currentLength + 3 + token.length
      if (current.length > 0 && nextLength > maxLength) {
        lines.push(`${current.join(' | ')} |`)
        current = [token]
        currentLength = token.length
      } else {
        current.push(token)
        currentLength = nextLength
      }
    })
    if (current.length) lines.push(current.join(' | '))
    return lines
  }

  function renderHistoryRows(requests) {
    if (!requests.length) {
      return <div className="card muted">표시할 데이터가 없습니다.</div>
    }
    return (
      <div className="materials-request-history-table materials-purchase-history-table" style={getTableScaleStyle('history')}>
        <div className="materials-request-history-row materials-request-history-head materials-confirm-history-row materials-purchase-history-row" style={getTableGridStyle('history')}>
          <div>선택</div>
          <div>호점</div>
          <div>이름</div>
          <div>구매신청일자</div>
          <div>결산처리완료일자</div>
          <div className="materials-request-total-cell">물품총합계</div>
        </div>
        {requests.map(request => {
          const meta = parseRequesterMeta(request)
          const detailLines = buildHistoryDetailLines((request.items || []).filter(item => Number(item.quantity || 0) > 0))
          return (
            <div key={`history-group-${request.id}`} className="materials-purchase-history-block">
              <div className="materials-request-history-row materials-confirm-history-row materials-purchase-history-row" style={getTableGridStyle('history')}>
                <div className="materials-history-static-cell">완료</div>
                <div>{formatRequesterBranchLabel(meta.branch)}</div>
                <div className="materials-request-name-cell"><strong>{meta.name}</strong></div>
                <div>{formatFullDateLabel(request.created_at)}</div>
                <div>{formatFullDateLabel(request.settled_at)}</div>
                <div className="materials-request-total-cell">{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</div>
              </div>
              <div className="materials-purchase-history-detail-wrap">
                {detailLines.length
                  ? detailLines.map((line, index) => <div key={`history-detail-${request.id}-${index}`} className="materials-purchase-history-detail-line">{line}</div>)
                  : <div className="materials-purchase-history-detail-line muted">상세 내역이 없습니다.</div>}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderSalesContent() {
    if (salesStep === 2) {
      return (
        <section className="card materials-panel">
          <div className="materials-summary-head materials-summary-head-inline">
            <div><h3>자재구매(2/2)</h3>
            <div className="muted">신청 내역과 입금 계좌를 확인한 뒤 확인 버튼을 눌러 주세요.</div></div>
          </div>
          <div className="materials-account-box materials-account-box-centered materials-account-box-emphasis">
            <strong>자재 입금 계좌</strong>
            <div className="materials-account-guide-strong">{accountGuide}</div>
          </div>
          <div className="materials-request-history-table materials-confirm-history-table" style={getTableScaleStyle('confirm')}>
            <div className="materials-request-history-row materials-request-history-head materials-confirm-history-row" style={getTableGridStyle('confirm')}>
              {renderResizableRowCells(['구분', '물품가', '구매수량', '합계금액'], 'confirm')}
            </div>
            {cartRows.map(item => (
              <div key={`confirm-${item.id}`} className="materials-request-history-row materials-confirm-history-row" style={getTableGridStyle('confirm')}>
                <div>{displayMaterialName(item, isMobile)}</div>
                <div>{Number(item.unit_price || 0).toLocaleString('ko-KR')}원</div>
                <div>{item.quantity}</div>
                <div>{item.lineTotal.toLocaleString('ko-KR')}원</div>
              </div>
            ))}
            <div className="materials-request-history-row materials-request-history-head materials-row-total materials-confirm-history-row materials-confirm-history-total" style={getTableGridStyle('confirm')}>
              <div>합계</div>
              <div />
              <div>{cartRows.reduce((sum, item) => sum + item.quantity, 0)}</div>
              <div>{cartTotal.toLocaleString('ko-KR')}원</div>
            </div>
          </div>
          <label className="stack-form">
            <span>메모</span>
            <textarea rows={3} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="추가 요청사항을 입력해 주세요." />
          </label>
          <div className="row gap materials-actions-split materials-actions-bottom">
            <button type="button" className="ghost materials-bottom-button materials-bottom-button-left" onClick={() => setSalesStep(1)}>이전</button>
            <button type="button" className="ghost active materials-bottom-button materials-bottom-button-right" disabled={saving} onClick={submitPurchaseRequest}>입금 후 확인</button>
          </div>
        </section>
      )
    }
    return (
      <section className="card materials-panel">
        <div className="materials-summary-head materials-summary-head-sales-top">
          <div>
            <h3>자재구매(1/2)</h3>
            <div className="muted">구매 수량을 입력한 뒤 자재구매 버튼을 눌러 주세요. 현재고보다 많은 수량은 신청할 수 없습니다.</div>
          </div>
        </div>
        <div className="materials-table materials-table-sales" style={getTableScaleStyle('sales')}>
          <div className="materials-row materials-row-head materials-row-head-sales materials-row-sales" style={getTableGridStyle('sales')}>
            {renderResizableRowCells(['구분', '물품가', '현재고', '구매수량', '합계금액'], 'sales')}
          </div>
          {productRows.map(product => {
            const quantity = Number(quantities[product.id] || 0)
            const stock = Number(product.current_stock || 0)
            const hasStockError = quantity > stock
            return (
              <div key={product.id} className={`materials-row materials-row-sales ${hasStockError ? 'materials-row-invalid' : ''}`.trim()} style={getTableGridStyle('sales')}>
                <div>{displayMaterialName(product, isMobile)}</div>
                <div>{Number(product.unit_price || 0).toLocaleString('ko-KR')}원</div>
                <div>{stock}</div>
                <div>
                  <input
                    className={`materials-qty-input ${hasStockError ? 'materials-qty-input-invalid' : ''}`.trim()}
                    inputMode="numeric"
                    value={quantities[product.id] ?? ''}
                    disabled={!canPurchaseMaterials}
                    onFocus={moveCaretToEnd}
                    onClick={moveCaretToEnd}
                    onKeyUp={moveCaretToEnd}
                    onChange={(event) => {
                      updateQuantity(product.id, event.target.value)
                      moveCaretToEnd(event)
                    }}
                    placeholder="0"
                  />
                </div>
                <div>{(quantity * Number(product.unit_price || 0)).toLocaleString('ko-KR')}원</div>
              </div>
            )
          })}
          <div className="materials-row materials-row-total materials-row-sales" style={getTableGridStyle('sales')}>
            <div>합계</div>
            <div />
            <div>{cartRows.reduce((sum, item) => sum + Number(item.current_stock || 0), 0)}</div>
            <div>{cartRows.reduce((sum, item) => sum + item.quantity, 0)}</div>
            <div>{cartTotal.toLocaleString('ko-KR')}원</div>
          </div>
        </div>
        {renderSalesPurchaseButtons('materials-actions-bottom')}
        {salesError ? <div className="notice-text materials-inline-notice">{salesError}</div> : null}
      </section>
    )
  }

  function renderRequestRows(requests, mode) {
    if (!requests.length) {
      return <div className="card muted">표시할 데이터가 없습니다.</div>
    }
    if (mode === 'history') {
      return renderHistoryRows(requests)
    }
    const requestGridKey = mode === 'pending' ? 'requesters' : 'settlements'
    const selectable = mode === 'pending' || mode === 'settled'
    return (
      <div className={`materials-request-sheet materials-request-sheet-${mode}`}>
        {renderRequestListHeader(mode)}
        {requests.map(request => {
          const checked = selectedRequestIds.includes(request.id)
          const meta = parseRequesterMeta(request)
          const visibleItems = (request.items || []).filter(item => Number(item.quantity || 0) > 0)
          const isRejected = String(request.status || '') === 'rejected'
          return (
            <section key={`request-${mode}-${request.id}`} className={`${mode === 'settled' ? '' : 'card '}materials-request-card materials-request-sheet-card materials-request-sheet-card-${mode} ${selectable ? 'with-check' : ''}`.trim()}>
              <div className={`materials-request-sheet-row materials-request-sheet-row-${mode} ${selectable ? 'with-check' : ''}`.trim()} style={getRequestSheetGridStyle(requestGridKey)}>
                {selectable ? (
                  <label className="materials-checkbox materials-request-checkbox-cell">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedRequestIds(prev => event.target.checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))
                      }}
                    />
                    <span>{mode === 'pending' ? '' : '결산취소'}</span>
                  </label>
                ) : null}
                <div>{formatRequesterBranchLabel(meta.branch)}</div>
                <div className="materials-request-name-cell"><strong>{meta.name}</strong></div>
                <div>{formatFullDateLabel(request.created_at)}</div>
                <div>{isRejected ? <button type="button" className="ghost small" onClick={() => window.alert('관리자가 반려시킨 신청건입니다. 재신청 해주세요.')}>반려됨</button> : formatFullDateLabel(request.settled_at)}</div>
                <div className="materials-request-total-cell">{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</div>
              </div>
              <div className="materials-request-items materials-request-items-sheet materials-request-items-sheet-grid">
                {renderRequestItemSummary(visibleItems)}
              </div>
              {request.request_note ? <div className="muted">메모: {request.request_note}</div> : null}
            </section>
          )
        })}
      </div>
    )
  }


  function renderCompactDateFilter(label, value, setValue, inputRef) {
    return (
      <label className="materials-date-inline-label materials-date-inline-label-left materials-date-inline-label-mobile-top">
        <span>{label}</span>
        <button
          type="button"
          className="materials-compact-date-button"
          onClick={() => openCompactDatePicker(inputRef)}
        >
          {formatCompactDateLabel(value)}
        </button>
        <input
          ref={inputRef}
          className="materials-compact-date-native"
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={label}
          tabIndex={-1}
        />
      </label>
    )
  }

  function renderIncomingHeaderCells() {
    if (!isMobile) {
      return renderResizableRowCells(['구분', '물품가', '현재고', '입고량', '출고량', '정산수량', '비고'], 'incoming')
    }
    return [
      ['구분', ''],
      ['물품', '가격'],
      ['현', '재고'],
      ['입고', '수량'],
      ['출고', '수량'],
      ['정산', '수량'],
      ['비고', ''],
    ].map(([line1, line2], index) => (
      <div key={`incoming-head-${index}`} className="materials-resize-cell materials-resize-cell-two-line">
        <span>{line1}</span>
        <span>{line2 || '\u00A0'}</span>
      </div>
    ))
  }

  function renderMyRequests() {
    const grouped = filterMyRequests(groupedMyRequests())
    return (
      <section className="card materials-panel materials-panel-compact-head">
        <div className="materials-summary-head-inline">
          <div><h3>신청현황</h3></div>
          <div className="muted tiny-text">접수 {(myRequests || []).filter(item => String(item.status || '') === 'pending' && (item.items || []).some(row => Number(row.quantity || 0) > 0)).length}건 · 결산완료 {(myRequests || []).filter(item => String(item.status || '') === 'settled').length}건 · 반려 {(myRequests || []).filter(item => String(item.status || '') === 'rejected').length}건</div>
        </div>
        <div className="materials-myrequest-head">
          <div className="notice-text materials-myrequest-guide">자재구매 신청한 내역입니다.<br />신청수량 변경 및 신청취소 희망시 '수정/취소' 버튼을 누르고, 각 품목별 '구매수량'을 수정하여 저장해주세요.<br />- 절차 : '수정/취소' 버튼 클릭 → '신청날짜' 선택 → '구매수량' 수정 → '저장' 버튼 클릭<br />* 구매수량이 0일 경우 취소 접수가 되며, 1개 이상의 수량일 경우 수량 수정 반영됩니다.<br /><span className="materials-myrequest-warning">※ 주의 : 자재비용 입금 후 본사 결산처리까지 완료된 경우는 '수정/취소'가 불가능합니다.</span></div>
        </div>
        <div className="materials-myrequest-filter-bar materials-myrequest-filter-bar-mobile-compact">
          {renderCompactDateFilter('시작기간', myRequestStartDate, setMyRequestStartDate, myRequestStartDateInputRef)}
          <span className="materials-filter-range-separator">~</span>
          {renderCompactDateFilter('종료기간', myRequestEndDate, setMyRequestEndDate, myRequestEndDateInputRef)}
          <label className="materials-date-inline-label materials-date-inline-label-left materials-date-inline-label-compact materials-date-inline-label-mobile-top">
            <span>상태</span>
            <select className="materials-filter-select-compact materials-myrequest-status-select" value={myRequestStatusFilter} onChange={(e) => setMyRequestStatusFilter(e.target.value)}>
              <option value="all">전체</option>
              <option value="pending">신청접수</option>
              <option value="rejected">반려됨</option>
              <option value="settled">결산완료</option>
              <option value="canceled">취소접수</option>
            </select>
          </label>
          <button type="button" className="ghost materials-bottom-button materials-filter-reset-button" onClick={() => { setMyRequestStartDate(''); setMyRequestEndDate(''); setMyRequestStatusFilter('all') }}><span>필터</span><span>초기화</span></button>
          <div className="materials-myrequest-filter-spacer" />
          <div className="materials-myrequest-head-actions materials-myrequest-head-actions-inline">
            {isMaterialsAdminUser(user) ? (
              <div className="materials-request-settings">
                <button type="button" className="ghost materials-bottom-button materials-myrequest-inline-action-button materials-myrequest-inline-settings-button" onClick={() => setRequestDeleteMenuOpen(prev => !prev)}>설정</button>
                {requestDeleteMenuOpen ? (
                  <div className="materials-request-settings-menu">
                    <button type="button" className="ghost materials-request-settings-item" onClick={openRequestDeletePopup}>현황기록삭제</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <button type="button" className={`ghost active materials-bottom-button materials-myrequest-inline-action-button ${myPulseSaveCue ? 'materials-soft-pulse' : ''}`.trim()} disabled={saving} onClick={() => myEditing ? saveMyRequestEdits() : startMyRequestEditing()}>{myEditing ? '저장' : '수정/취소'}</button>
          </div>
        </div>
        <div className="materials-request-history-list">
          {grouped.length === 0 ? <div className="card muted">신청 내역이 없습니다.</div> : grouped.map(request => {
            const isSettled = String(request.status || '') === 'settled'
            const isRejected = String(request.status || '') === 'rejected'
            const isLocked = isSettled || isRejected
            const isSelected = mySelectedRequestIds.includes(request.id)
            const shouldPulseDate = myPulseRequestIds.includes(request.id)
            return (
              <section key={`my-request-${request.id}`} className="card materials-request-history-card">
                <div className="materials-request-history-date-row">
                  <div className={`materials-request-history-date-left ${(shouldPulseDate || (isSelected && myEditing && !isLocked)) ? 'materials-soft-pulse' : ''}`.trim()}>
                    {myEditing && !isLocked ? (
                      <label className="materials-checkbox">
                        <input type="checkbox" checked={isSelected} onChange={(event) => handleMyRequestSelection(request, event.target.checked)} />
                      </label>
                    ) : null}
                    <strong>{String(request.created_at || '').slice(0, 10)}</strong>
                  </div>
                  <span className={`materials-status-pill ${isSettled ? 'settled' : (isRejected ? 'rejected materials-status-pill-clickable' : 'pending')}`.trim()} onClick={() => { if (isRejected) window.alert('관리자가 반려시킨 신청건입니다. 재신청 해주세요.') }}>{formatRequestStatusLabel(request.status, request.visibleItems?.[0]?.quantity)}</span>
                </div>
                <div className="materials-request-history-table">
                  <div className="materials-request-history-row materials-request-history-head" style={getTableGridStyle('myRequests')}>
                    {renderResizableRowCells(['구매물품', '구매가격', '구매수량', '합계가격', '결산처리상태'], 'myRequests')}
                  </div>
                  {(request.visibleItems || []).map(item => {
                    const key = `${request.id}-${item.product_id}`
                    const qty = Math.max(0, Number(myRequestDraft[key] ?? item.quantity ?? 0))
                    const lineTotal = qty * Number(item.unit_price || 0)
                    const shouldPulseQty = myPulseQtyKeys.includes(key) || (isSelected && myEditing && !isSettled)
                    return (
                      <div key={key} className="materials-request-history-row" style={getTableGridStyle('myRequests')}>
                        <div>{displayMyRequestItemName(item)}</div>
                        <div>{Number(item.unit_price || 0).toLocaleString('ko-KR')}원</div>
                        <div>{myEditing && isSelected && !isLocked ? <input className={`materials-qty-input materials-history-qty-input ${shouldPulseQty ? 'materials-soft-pulse' : ''}`.trim()} inputMode="numeric" value={qty} onChange={(e) => handleMyRequestDraftChange(request, item, e.target.value)} /> : qty}</div>
                        <div>{lineTotal.toLocaleString('ko-KR')}원</div>
                        <div className={`${qty === 0 && !isSettled ? 'materials-cancel-text' : ''} ${String(request.status || '') === 'rejected' ? 'materials-rejected-help-trigger' : ''}`.trim()} onClick={() => { if (String(request.status || '') === 'rejected') window.alert('관리자가 반려시킨 신청건입니다. 재신청 해주세요.') }}>{formatRequestStatusLabel(request.status, qty)}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="materials-request-history-total">총계가격 {request.totalAmount.toLocaleString('ko-KR')}원</div>
              </section>
            )
          })}
        </div>
        <div className="materials-myrequest-actions-bottom">
          <button type="button" className={`ghost active materials-bottom-button ${myPulseSaveCue ? 'materials-soft-pulse' : ''}`.trim()} disabled={saving} onClick={() => myEditing ? saveMyRequestEdits() : startMyRequestEditing()}>{myEditing ? '저장' : '수정/취소'}</button>
        </div>
        {requestDeletePopupOpen ? (
          <div className="modal-overlay" onClick={closeRequestDeletePopup}>
            <div className="modal-card materials-request-delete-popup" onClick={(event) => event.stopPropagation()}>
              <div className="materials-request-delete-popup-head">
                <button type="button" className="small ghost materials-request-delete-close-button" onClick={closeRequestDeletePopup} aria-label="닫기">
                  <span className="materials-request-delete-close-icon" aria-hidden="true">←</span>
                </button>
                <h3>자재신청현황기록삭제</h3>
                <div className="materials-request-delete-head-spacer" aria-hidden="true"></div>
              </div>
              <div className="materials-request-delete-popup-actions">
                <input
                  type="date"
                  className="materials-request-delete-date-filter"
                  value={requestDeleteDateFilter}
                  onChange={(event) => setRequestDeleteDateFilter(event.target.value)}
                  disabled={requestDeleteLoading || requestDeleteSubmitting}
                  aria-label="날짜필터"
                />
                <button type="button" className="small ghost materials-request-delete-submit-button" disabled={requestDeleteLoading || requestDeleteSubmitting || !requestDeleteSelection.length} onClick={deleteSelectedRequestRows}>{requestDeleteSubmitting ? '삭제 중...' : '삭제'}</button>
              </div>
              <div className="materials-request-delete-popup-body">
                <div className="materials-request-delete-table" role="table" aria-label="자재신청현황기록삭제 목록">
                  <div className="materials-request-delete-table-row materials-request-delete-table-head" role="row">
                    <div className="materials-request-delete-table-check" role="columnheader"></div>
                    <div role="columnheader">신청접수일</div>
                    <div role="columnheader">이름</div>
                    <div role="columnheader">아이디</div>
                    <div role="columnheader">품목</div>
                    <div role="columnheader">개수</div>
                  </div>
                  {requestDeleteLoading ? (
                    <div className="materials-request-delete-empty muted">불러오는 중...</div>
                  ) : filteredRequestDeleteRows.length ? filteredRequestDeleteRows.map(request => {
                    const meta = parseRequesterMeta(request)
                    const checked = requestDeleteSelection.includes(request.id)
                    const items = (request.items || []).filter(item => Number(item.quantity || 0) > 0)
                    return (
                      <div key={`materials-request-delete-${request.id}`} className="materials-request-delete-group">
                        {items.map((item, index) => (
                          <label key={`materials-request-delete-item-${request.id}-${item.product_id || index}`} className={`materials-request-delete-table-row ${checked ? 'is-selected' : ''}`.trim()} role="row">
                            <div className="materials-request-delete-table-check" role="cell">
                              {index === 0 ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => setRequestDeleteSelection(prev => event.target.checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))}
                                />
                              ) : null}
                            </div>
                            <div role="cell" title={index === 0 ? formatFullDateLabel(request.created_at) : ''}>{index === 0 ? formatFullDateLabel(request.created_at) : ''}</div>
                            <div role="cell" title={index === 0 ? meta.name : ''}>{index === 0 ? meta.name : ''}</div>
                            <div role="cell" title={index === 0 ? (meta.uniqueId || '-') : ''}>{index === 0 ? (meta.uniqueId || '-') : ''}</div>
                            <div role="cell" title={displayMyRequestItemName(item)}>{displayMyRequestItemName(item)}</div>
                            <div role="cell" title={`${Number(item.quantity || 0)}개`}>{Number(item.quantity || 0)}개</div>
                          </label>
                        ))}
                      </div>
                    )
                  }) : (
                    <div className="materials-request-delete-empty muted">삭제 가능한 신청현황이 없습니다.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    )
  }

  function renderIncomingContent() {
    return (
      <section className="card materials-panel materials-panel-compact-head">
        <div className="materials-summary-head-inline materials-summary-head-inventory">
          <div><h3>자재입고</h3></div>
          
        </div>
        <div className="materials-table materials-table-sales materials-table-incoming" style={getTableScaleStyle('incoming')}>
          <div className="materials-row materials-row-head materials-row-confirm-header materials-row-sales" style={getTableGridStyle('incoming')}>
            {renderIncomingHeaderCells()}
          </div>
          {productRows.map(product => {
            const inventoryRow = inventoryRows.find(row => Number(row.product_id) === Number(product.id)) || {}
            const draftRow = incomingDraft[product.id] || {}
            const draftIncoming = Number(draftRow.incoming_qty || 0)
            const draftOutgoing = Number(draftRow.outgoing_qty || 0)
            const note = draftRow.note || ''
            const afterQty = Math.max(0, Number(product.current_stock || 0) + draftIncoming - draftOutgoing)
            return (
              <div key={`incoming-${product.id}`} className="materials-row materials-row-confirm materials-row-sales" style={getTableGridStyle('incoming')}>
                <div>{displayMaterialName(product, isMobile)}</div>
                <div>{Number(product.unit_price || 0).toLocaleString('ko-KR')}원</div>
                <div>{Number(product.current_stock || 0)}</div>
                <div>
                  <input
                    className="materials-qty-input"
                    inputMode="numeric"
                    value={draftIncoming || ''}
                    onChange={(event) => {
                      const raw = String(event.target.value).replace(/[^\d]/g, '')
                      setIncomingDraft(prev => ({ ...prev, [product.id]: { ...prev[product.id], incoming_qty: raw ? Number(raw) : 0, outgoing_qty: Number(prev[product.id]?.outgoing_qty || 0), note: prev[product.id]?.note || '' } }))
                    }}
                  />
                </div>
                <div>
                  <input
                    className="materials-qty-input"
                    inputMode="numeric"
                    value={draftOutgoing || ''}
                    onChange={(event) => {
                      const raw = String(event.target.value).replace(/[^\d]/g, '')
                      setIncomingDraft(prev => ({ ...prev, [product.id]: { ...prev[product.id], incoming_qty: Number(prev[product.id]?.incoming_qty || 0), outgoing_qty: raw ? Number(raw) : 0, note: prev[product.id]?.note || '' } }))
                    }}
                  />
                </div>
                <div>{afterQty}</div>
                <div>
                  <input
                    className="materials-note-input"
                    value={note}
                    onChange={(event) => setIncomingDraft(prev => ({ ...prev, [product.id]: { ...prev[product.id], incoming_qty: Number(prev[product.id]?.incoming_qty || 0), outgoing_qty: Number(prev[product.id]?.outgoing_qty || 0), note: event.target.value } }))}
                    placeholder="비고"
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="row gap wrap materials-actions-right materials-actions-bottom materials-incoming-actions-bottom">
          <label className="materials-date-inline-label">
            <span>입고입력일</span>
            <input type="date" value={incomingEntryDate} onChange={(e) => setIncomingEntryDate(e.target.value)} />
          </label>
          <label className="materials-force-toggle">
            <input type="checkbox" checked={forceIncomingApply} onChange={(e) => setForceIncomingApply(e.target.checked)} />
            <span>강제입력</span>
          </label>
          <button type="button" className="ghost active materials-bottom-button materials-register-button" disabled={saving} onClick={saveIncomingStock}>입고입력</button>
        </div>
        {forceIncomingApply ? <div className="muted tiny-text">강제입력 체크 후 저장하면 입출고 기록은 남기지 않고 현재고와 정산수량만 즉시 조정됩니다.</div> : null}
      </section>
    )
  }

  function renderInventoryContent() {
    return null
  }




  if (loading) return <div className="card">자재 데이터를 불러오는 중입니다...</div>

  return (
    <div className="stack-page materials-page">
      <section className="card materials-hero">
        <div className="materials-tabs" role="tablist" aria-label="자재 카테고리">
          {visibleTabs.map(renderTabButton)}
        </div>
        {notice ? <div className="card notice-text">{notice}</div> : null}
      </section>

      {activeTab === 'sales' && renderSalesContent()}
      {activeTab === 'myRequests' && renderMyRequests()}
      {activeTab === 'incoming' && renderIncomingContent()}
      {activeTab === 'requesters' && (
        <section className="card materials-panel materials-panel-compact-head">
          <div className="materials-summary-head-inline"><div><h3>신청목록</h3></div></div>
          <div style={getTableScaleStyle('requesters')}>{renderRequestRows(pendingRequests, 'pending')}</div>
          <div className="row gap wrap materials-actions-right materials-actions-bottom materials-requesters-actions-bottom">
            <button type="button" className="ghost materials-bottom-button" disabled={saving} onClick={rejectSelectedRequests}>결산반려</button>
            <button type="button" className="ghost active materials-bottom-button materials-register-button" disabled={saving} onClick={settleSelectedRequests}>결산등록</button>
          </div>
        </section>
      )}
      {activeTab === 'settlements' && (
        <section className="card materials-panel materials-panel-compact-head materials-settlement-panel">
          <div className="materials-summary-head-inline"><div><h3>구매결산</h3></div></div>
          <div className="row gap wrap materials-settlement-filter-row">
            <label className="materials-date-inline-label materials-date-inline-label-left materials-date-inline-label-compact">
              <span>구매신청일자</span>
              <select className="materials-filter-select-compact" value={settlementFilterDate} onChange={(e) => setSettlementFilterDate(e.target.value)}>
                <option value="">전체일자</option>
                {settlementDateOptions.map(date => <option key={`settlement-date-${date}`} value={date}>{formatSettlementFilterLabel(date)}</option>)}
              </select>
            </label>
            <button type="button" className="ghost materials-bottom-button" onClick={() => setSettlementFilterDate('')}>필터초기화</button>
          </div>
          {renderRequestRows(filteredSettledRequests, 'settled')}
          <div className="row gap wrap materials-actions-right materials-actions-bottom materials-settlement-actions-bottom">
            <button type="button" className="ghost materials-bottom-button" onClick={shareSettlements}>카톡공유</button>
            <button type="button" className="ghost materials-bottom-button" disabled={saving} onClick={unsettleSelectedRequests}>결산취소</button>
            <button type="button" className="ghost materials-bottom-button materials-register-button" disabled={saving} onClick={goToSettlementProgress}>결산진행</button>
          </div>
        </section>
      )}
      {activeTab === 'history' && (
        <section className="card materials-panel materials-panel-compact-head">
          <div className="materials-summary-head-inline"><div><h3>구매목록</h3></div></div>
          {renderRequestRows(historyRequests, 'history')}
        </section>
      )}
    </div>
  )
}


function SoomgoReviewSettingsModal({ open, onClose, state, setState, onSave, onManualMatch }) {
  if (!open) return null
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card soomgo-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="between">
          <h3>숨은 설정</h3>
          <button type="button" className="ghost small" onClick={onClose}>닫기</button>
        </div>
        <div className="stack compact-gap">
          <label className="stack compact-gap"><span>숨고 로그인 이메일</span><input value={state.settings.soomgo_email || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, soomgo_email: e.target.value } }))} /></label>
          <label className="stack compact-gap"><span>숨고 로그인 비밀번호</span><input type="password" value={state.settings.soomgo_password || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, soomgo_password: e.target.value } }))} /></label>
          <label className="stack compact-gap"><span>outer HTML 코드</span><textarea className="soomgo-hidden-textarea" value={state.settings.outer_html || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, outer_html: e.target.value } }))} /></label>
          <div className="soomgo-hidden-grid">
            <label className="stack compact-gap"><span>익명 이름</span><input value={state.settings.anonymous_name || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, anonymous_name: e.target.value } }))} /></label>
            <label className="stack compact-gap"><span>리뷰 내용 일부</span><textarea className="soomgo-hidden-textarea short" value={state.settings.review_input || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, review_input: e.target.value } }))} /></label>
          </div>
          <div className="row gap wrap">
            <button type="button" onClick={onManualMatch}>수기 작성자 찾기</button>
            <button type="button" className="ghost" onClick={onSave}>설정 저장</button>
          </div>
          <div className="soomgo-result-grid">
            <div className="card"><strong>리뷰작성자 후보</strong><pre>{state.results.candidate_names || '-'}</pre></div>
            <div className="card"><strong>유사도</strong><pre>{state.results.candidate_scores || '-'}</pre></div>
            <div className="card"><strong>고객리뷰</strong><textarea className="soomgo-hidden-textarea short" value={state.results.customer_review || ''} onChange={e => setState(prev => ({ ...prev, results: { ...prev.results, customer_review: e.target.value } }))} /></div>
            <div className="card"><strong>이사현장 / 특이사항</strong><textarea className="soomgo-hidden-textarea short" value={`${state.results.field_status || ''}
${state.results.special_note || ''}`.trim()} readOnly /></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SoomgoReviewSlotCard({ slot, index, onChange, onGenerate }) {
  return (
    <section className="card soomgo-slot-card">
      <div className="soomgo-slot-head">
        <strong>슬롯 {index + 1}</strong>
        <button type="button" className="small" onClick={() => onGenerate(index)}>리뷰초안생성</button>
      </div>
      <div className="soomgo-slot-name-row">
        <label className="stack compact-gap"><span>가명</span><input value={slot.masked_name || ''} onChange={e => onChange(index, 'masked_name', e.target.value)} /></label>
        <label className="stack compact-gap"><span>실명</span><input value={slot.real_name || ''} onChange={e => onChange(index, 'real_name', e.target.value)} /></label>
      </div>
      <div className="soomgo-slot-grid">
        <label className="stack compact-gap"><span>리뷰 내용</span><textarea value={slot.review || ''} onChange={e => onChange(index, 'review', e.target.value)} /></label>
        <label className="stack compact-gap"><span>AI 결과</span><textarea value={slot.reply || ''} onChange={e => onChange(index, 'reply', e.target.value)} /></label>
        <label className="stack compact-gap"><span>이사현장상황</span><textarea value={slot.situation || ''} onChange={e => onChange(index, 'situation', e.target.value)} /></label>
        <label className="stack compact-gap"><span>현장특이사항</span><textarea value={slot.specifics || ''} onChange={e => onChange(index, 'specifics', e.target.value)} /></label>
      </div>
    </section>
  )
}

function SoomgoReviewFinderPage() {
  const [state, setState] = useState({ settings: { prompt: '', outer_html: '', anonymous_name: '', review_input: '', soomgo_email: '', soomgo_password: '', auto_scan_on_open: true }, memos: { soomgo: '', today: '', site: '' }, results: { candidate_names: '', candidate_scores: '', ai_result: '', customer_review: '', field_status: '', special_note: '' }, slots: Array.from({ length: 10 }, (_, index) => ({ index, masked_name: '', real_name: '', review: '', reply: '', situation: '', specifics: '' })), last_scan: { ok: false, message: '', updated_at: '', found_count: 0 } })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)

  async function loadState() {
    const data = await api('/api/soomgo-review/state')
    setState(prev => ({ ...prev, ...data }))
    return data
  }

  useEffect(() => {
    let ignore = false
    loadState().then(data => {
      if (!ignore && data?.settings?.auto_scan_on_open) {
        handleAutoScan()
      }
    }).catch(() => {})
    return () => { ignore = true }
  }, [])

  async function persistState(nextState = state) {
    setSaving(true)
    try {
      const saved = await api('/api/soomgo-review/state', {
        method: 'POST',
        body: JSON.stringify({ settings: nextState.settings, memos: nextState.memos, results: nextState.results, slots: nextState.slots }),
      })
      setState(prev => ({ ...prev, ...saved }))
    } catch (error) {
      window.alert(error.message || '숨고리뷰찾기 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleAutoScan() {
    setLoading(true)
    try {
      const data = await api('/api/soomgo-review/scan-auto', { method: 'POST' })
      setState(prev => ({ ...prev, ...data }))
    } catch (error) {
      window.alert(error.message || '자동 숨고리뷰 찾기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManualScan() {
    setLoading(true)
    try {
      const data = await api('/api/soomgo-review/scan-manual', { method: 'POST' })
      setState(prev => ({ ...prev, ...data }))
    } catch (error) {
      window.alert(error.message || '수동 숨고리뷰 찾기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManualMatch() {
    setLoading(true)
    try {
      const data = await api('/api/soomgo-review/manual-match', {
        method: 'POST',
        body: JSON.stringify({ outer_html: state.settings.outer_html || '', anonymous_name: state.settings.anonymous_name || '', review_input: state.settings.review_input || '' }),
      })
      setState(prev => ({ ...prev, ...(data.state || {}), results: { ...prev.results, candidate_names: data.candidate_names || '', candidate_scores: data.candidate_scores || '' } }))
    } catch (error) {
      window.alert(error.message || '수기 작성자 찾기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateSlot(index) {
    setLoading(true)
    try {
      const slot = state.slots[index] || {}
      const data = await api('/api/soomgo-review/generate-draft', {
        method: 'POST',
        body: JSON.stringify({ slot_index: index, review: slot.review || '', situation: slot.situation || '', specifics: slot.specifics || '' }),
      })
      setState(prev => ({ ...prev, ...(data.state || {}), results: { ...prev.results, ai_result: data.draft || '' } }))
    } catch (error) {
      window.alert(error.message || '리뷰초안 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function updateSlot(index, key, value) {
    setState(prev => ({
      ...prev,
      slots: prev.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [key]: value } : slot),
    }))
  }

  return (
    <div className="stack-page soomgo-review-page">
      <section className="card soomgo-review-hero">
        <div className="between wrap gap">
          <div>
            <h2>숨고리뷰찾기</h2>
            <div className="muted">첨부한 리뷰 찾기 스크립트의 핵심 흐름을 앱 화면에 옮긴 페이지입니다.</div>
            <div className="muted">최근 검사 {state.last_scan?.updated_at ? String(state.last_scan.updated_at).replace('T', ' ').slice(0, 16) : '-'} · {state.last_scan?.message || '대기중'}</div>
          </div>
          <div className="row gap wrap">
            <button type="button" onClick={handleAutoScan} disabled={loading}>{loading ? '진행중...' : '자동 숨고리뷰 찾기'}</button>
            <button type="button" className="ghost" onClick={handleManualScan} disabled={loading}>{loading ? '진행중...' : '수동 리뷰 찾기'}</button>
            <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>숨은 설정</button>
            <button type="button" className="ghost" onClick={() => persistState()} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
          </div>
        </div>
      </section>

      <section className="soomgo-review-layout">
        <div className="soomgo-review-main stack-page">
          <section className="card soomgo-prompt-card">
            <div className="between"><h3>리뷰초안 프롬프트</h3><span className="muted">리뷰초안생성 기준</span></div>
            <textarea value={state.settings.prompt || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, prompt: e.target.value } }))} className="soomgo-prompt-textarea" />
          </section>

          <section className="card soomgo-ai-result-card">
            <div className="between"><h3>AI 리뷰 답변 결과</h3><button type="button" className="ghost small" onClick={() => navigator.clipboard?.writeText(state.results.ai_result || '')}>복사</button></div>
            <textarea value={state.results.ai_result || ''} onChange={e => setState(prev => ({ ...prev, results: { ...prev.results, ai_result: e.target.value } }))} className="soomgo-prompt-textarea short" />
          </section>

          <section className="soomgo-slot-list-grid">
            {state.slots.slice(0, 5).map((slot, index) => <SoomgoReviewSlotCard key={`slot-top-${index}`} slot={slot} index={index} onChange={updateSlot} onGenerate={handleGenerateSlot} />)}
          </section>

          <section className="card soomgo-extra-slots-card">
            <div className="between"><h3>추가 슬롯 5개</h3><button type="button" className="ghost small" onClick={() => setExtraOpen(v => !v)}>{extraOpen ? '접기' : '펼치기'}</button></div>
            {extraOpen && <div className="soomgo-slot-list-grid">{state.slots.slice(5, 10).map((slot, index) => <SoomgoReviewSlotCard key={`slot-extra-${index + 5}`} slot={slot} index={index + 5} onChange={updateSlot} onGenerate={handleGenerateSlot} />)}</div>}
          </section>
        </div>

        <aside className="soomgo-review-side stack-page">
          <section className="card"><h3>상시 메모장 1. 숨고</h3><textarea className="soomgo-side-memo" value={state.memos.soomgo || ''} onChange={e => setState(prev => ({ ...prev, memos: { ...prev.memos, soomgo: e.target.value } }))} /></section>
          <section className="card"><h3>상시 메모장 2. 오늘</h3><textarea className="soomgo-side-memo" value={state.memos.today || ''} onChange={e => setState(prev => ({ ...prev, memos: { ...prev.memos, today: e.target.value } }))} /></section>
          <section className="card"><h3>상시 메모장 3. 공홈</h3><textarea className="soomgo-side-memo" value={state.memos.site || ''} onChange={e => setState(prev => ({ ...prev, memos: { ...prev.memos, site: e.target.value } }))} /></section>
        </aside>
      </section>

      <SoomgoReviewSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        setState={setState}
        onSave={() => persistState()}
        onManualMatch={handleManualMatch}
      />
    </div>
  )
}


function AppAssignmentNotificationWatcher({ user }) {
  const [toastItems, setToastItems] = useState([])

  useEffect(() => {
    if (!user?.id) return undefined
    let stopped = false

    async function tick() {
      try {
        const [prefsRaw, notifications] = await Promise.all([api('/api/preferences'), api('/api/notifications')])
        if (stopped) return
        const settings = normalizeAlertSettings(prefsRaw || {})
        const scheduleItems = (notifications || []).filter(item => !item?.is_read && isScheduleAlertNotification(item))
        const nextAppState = loadAlertShownMap(user.id, 'app')
        const nextMobileState = loadAlertShownMap(user.id, 'mobile')
        const repeatMs = Math.max(1, Number(settings.repeatHours || 1)) * 60 * 60 * 1000
        const quietNow = isNowInQuietHours(settings)
        const newToasts = []

        for (const item of scheduleItems) {
          const category = scheduleNotificationCategory(item.type)
          const now = Date.now()
          if (settings.appEnabled && settings.appTypes?.[category] && !quietNow) {
            const lastShown = Number(nextAppState[item.id] || 0)
            if (!lastShown || now - lastShown >= repeatMs) {
              nextAppState[item.id] = now
            }
          }
          if (settings.mobileEnabled && settings.mobileTypes?.[category] && !quietNow && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const lastShown = Number(nextMobileState[item.id] || 0)
            if (!lastShown || now - lastShown >= repeatMs) {
              try {
                const n = new Notification(item.title, { body: item.body })
                window.setTimeout(() => n.close(), 10000)
              } catch (_) {}
              nextMobileState[item.id] = now
            }
          }
        }

        if (newToasts.length) {
          setToastItems(prev => [...prev, ...newToasts].slice(-6))
        }
        saveAlertShownMap(user.id, 'app', nextAppState)
        saveAlertShownMap(user.id, 'mobile', nextMobileState)
      } catch (_) {}
    }

    tick()
    const timer = window.setInterval(tick, 60000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [user?.id])

  useEffect(() => {
    if (!toastItems.length) return undefined
    const timer = window.setTimeout(() => {
      setToastItems(prev => prev.slice(1))
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [toastItems])

  if (!toastItems.length) return null
  return createPortal(
    <div className="app-alert-toast-stack">
      {toastItems.map(item => (
        <div key={item.id} className="app-alert-toast-card">
          <strong>{getNotificationDisplayParts(item).title || item.title}</strong>
          <div style={{ whiteSpace: 'pre-line' }}>{item.body}</div>
        </div>
      ))}
    </div>,
    document.body,
  )
}

function App() {
  const [user, setUser] = useState(getStoredUser())
  const navigate = useNavigate()
  const location = useLocation()
  const [htmlInspectorActive, setHtmlInspectorActive] = useState(() => typeof document !== 'undefined' ? document.body?.classList.contains(HTML_INSPECTOR_BODY_CLASS) : false)
  const [inspectorPanelOpen, setInspectorPanelOpen] = useState(false)
  const [inspectorSelectionVersion, setInspectorSelectionVersion] = useState(0)
  const [inspectorPayload, setInspectorPayload] = useState(null)
  const [inspectorOptions, setInspectorOptions] = useState({
    parentDepth: 3,
    siblingLimit: 6,
    goal: '',
    similarScreen: '',
    priorityDevice: 'mobile',
    constraints: '',
  })
  const [inspectorSections, setInspectorSections] = useState({
    selector: true,
    style: true,
    html: true,
    attributes: false,
    rect: true,
    pageMeta: true,
    componentPath: true,
    parentChain: false,
    siblings: false,
    request: true,
  })
  const [inspectorAnchorStyle, setInspectorAnchorStyle] = useState(null)
  const inspectorSelectedElementRef = useRef(null)
  const inspectorHighlightElementRef = useRef(null)

  useEffect(() => {
    applyAppTheme(getStoredThemePreference())
  }, [])

  useEffect(() => {
    function handleModeChange(event) {
      setHtmlInspectorActive(!!event?.detail?.enabled)
    }
    window.addEventListener('icj-html-inspector-mode', handleModeChange)
    return () => window.removeEventListener('icj-html-inspector-mode', handleModeChange)
  }, [])

  useEffect(() => {
    if (!user?.id) {
      applyLayoutGuideMode(false)
      applyHtmlInspectorMode(false)
      applyTextEditMode(false)
      return undefined
    }
    let cancelled = false
    api('/api/preferences').then((prefs) => {
      if (cancelled) return
      applyLayoutGuideMode(!!prefs?.layoutGuideEnabled)
      applyHtmlInspectorMode(!!prefs?.htmlInspectorEnabled)
      applyTextEditMode(!!prefs?.textEditEnabled)
      applyTextOverridesForPath(prefs?.textOverrides, window.location?.pathname || '/')
    }).catch(() => {
      if (!cancelled) {
        applyLayoutGuideMode(false)
        applyHtmlInspectorMode(false)
        applyTextEditMode(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    function handleHtmlInspectorClick(event) {
      if (!htmlInspectorActive) return
      if (!event.ctrlKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.ai-ui-inspector-panel')) return
      const ignored = target.closest('input, textarea, select')
      if (ignored) return
      event.preventDefault()
      event.stopPropagation()
      inspectorSelectedElementRef.current = target
      setInspectorPanelOpen(true)
      setInspectorSelectionVersion((prev) => prev + 1)
    }
    document.addEventListener('click', handleHtmlInspectorClick, true)
    return () => document.removeEventListener('click', handleHtmlInspectorClick, true)
  }, [htmlInspectorActive])

  useEffect(() => {
    function updateInspectorAnchor() {
      const element = inspectorSelectedElementRef.current
      if (!(element instanceof Element) || !htmlInspectorActive || !inspectorPanelOpen) {
        setInspectorAnchorStyle(null)
        return
      }
      const rect = element.getBoundingClientRect()
      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
      const panelWidth = Math.min(420, Math.max(280, viewportWidth - 24))
      const preferredLeft = rect.left
      const left = Math.max(8, Math.min(preferredLeft, viewportWidth - panelWidth - 8))
      const estimatedHeight = Math.min(560, Math.max(360, viewportHeight * 0.55))
      const belowTop = rect.bottom + 8
      const top = belowTop + estimatedHeight <= viewportHeight - 8
        ? belowTop
        : Math.max(8, Math.min(rect.top - estimatedHeight - 8, viewportHeight - estimatedHeight - 8))
      setInspectorAnchorStyle({
        position: 'fixed',
        top,
        left,
        width: panelWidth,
        maxHeight: Math.max(260, viewportHeight - top - 8),
      })
    }
    updateInspectorAnchor()
    if (!htmlInspectorActive || !inspectorPanelOpen) return undefined
    window.addEventListener('resize', updateInspectorAnchor)
    window.addEventListener('scroll', updateInspectorAnchor, true)
    return () => {
      window.removeEventListener('resize', updateInspectorAnchor)
      window.removeEventListener('scroll', updateInspectorAnchor, true)
    }
  }, [inspectorSelectionVersion, htmlInspectorActive, inspectorPanelOpen])

  useEffect(() => {
    if (!user || !getStoredUser()) return
    api('/api/me').then((res) => {
      if (res?.user) {
        setUser(res.user)
        sessionStorage.setItem('icj_user', JSON.stringify(res.user))
        if (getRememberedLogin()) {
          localStorage.setItem('icj_user', JSON.stringify(res.user))
        }
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    function handleAuthExpired() {
      clearSession({ preserveRemember: true })
      setUser(null)
      navigate('/login', { replace: true, state: { notice: '로그인 세션이 만료되어 다시 로그인해 주세요.' } })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [navigate])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch (_) {}
    clearSession()
    setUser(null)
    navigate('/login')
  }

  useEffect(() => {
    const element = inspectorSelectedElementRef.current
    if (!element || !document.contains(element) || !htmlInspectorActive) {
      setInspectorPayload(null)
      return
    }
    const nextPayload = buildAiUiContextPayload(element, {
      pathname: location.pathname,
      pageName: pageTitle(location.pathname),
      menuPath: location.pathname,
      user,
      request: inspectorOptions,
      parentDepth: inspectorOptions.parentDepth,
      siblingLimit: inspectorOptions.siblingLimit,
    })
    setInspectorPayload(nextPayload)
  }, [inspectorSelectionVersion, inspectorOptions, location.pathname, user, htmlInspectorActive])

  useEffect(() => {
    const previous = inspectorHighlightElementRef.current
    if (previous instanceof Element) previous.classList.remove('ai-ui-inspector-selected')
    const next = htmlInspectorActive ? inspectorSelectedElementRef.current : null
    if (next instanceof Element) {
      next.classList.add('ai-ui-inspector-selected')
      inspectorHighlightElementRef.current = next
    } else {
      inspectorHighlightElementRef.current = null
    }
    return () => {
      if (inspectorHighlightElementRef.current instanceof Element) {
        inspectorHighlightElementRef.current.classList.remove('ai-ui-inspector-selected')
      }
    }
  }, [inspectorSelectionVersion, inspectorPayload, htmlInspectorActive])

  useEffect(() => {
    if (htmlInspectorActive) return
    inspectorSelectedElementRef.current = null
    setInspectorPayload(null)
    setInspectorPanelOpen(false)
    setInspectorAnchorStyle(null)
  }, [user?.id, location.pathname, htmlInspectorActive])

  async function copyInspectorJson() {
    if (!inspectorPayload) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(JSON.stringify(inspectorPayload, null, 2))
        window.alert('AI 전달용 JSON이 복사되었습니다.')
        return
      }
    } catch (_) {}
    window.alert('JSON 복사에 실패했습니다.')
  }

  async function copyInspectorSelection() {
    if (!inspectorPayload) return
    const text = buildInspectorClipboardText(inspectorPayload, inspectorSections)
    if (!text) {
      window.alert('복사할 항목을 최소 1개 이상 선택해 주세요.')
      return
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        window.alert('선택한 HTML 요소 정보가 복사되었습니다.')
        return
      }
    } catch (_) {}
    window.alert('선택 정보 복사에 실패했습니다.')
  }

  function saveInspectorJsonFile() {
    if (!inspectorPayload) return
    const ok = downloadInspectorFile(`icj_ui_context_${Date.now()}.json`, JSON.stringify(inspectorPayload, null, 2), 'application/json;charset=utf-8')
    if (!ok) window.alert('JSON 저장에 실패했습니다.')
  }

  function saveInspectorTxtFile() {
    if (!inspectorPayload) return
    const ok = downloadInspectorFile(`icj_ui_context_${Date.now()}.txt`, buildAiUiContextText(inspectorPayload), 'text/plain;charset=utf-8')
    if (!ok) window.alert('TXT 저장에 실패했습니다.')
  }

  function clearInspectorSelection() {
    inspectorSelectedElementRef.current = null
    setInspectorPayload(null)
    setInspectorAnchorStyle(null)
    setInspectorSelectionVersion((prev) => prev + 1)
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage onLogin={setUser} />} />
        <Route path="/guest-quote" element={<QuoteFormsPage user={null} guestMode />} />
        <Route path="/signup" element={<SignupPage onLogin={setUser} />} />
        <Route path="/find-account" element={<FindAccountPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ notice: "로그인을 먼저 진행해주세요" }} />} />
      </Routes>
    )
  }

  const staffAllowed = canAccessStaffRoutes(user)

  return (
    <>
      <LocationSharingAgent user={user} />
      <AppAssignmentNotificationWatcher user={user} />
      <Layout user={user} onLogout={logout}>
      <MenuLockGuard user={user}>
      <Routes>
        <Route path="/" element={staffAllowed ? <HomePage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/map" element={staffAllowed ? <MapPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/friends" element={staffAllowed ? <FriendsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/chats" element={staffAllowed ? <ChatsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/chats/direct/:targetUserId" element={staffAllowed ? <ChatRoomPage roomType="direct" /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/chats/group/:roomId" element={staffAllowed ? <ChatRoomPage roomType="group" /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/calendar" element={staffAllowed ? <Navigate to="/schedule" replace /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/schedule" element={staffAllowed ? <CalendarPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/schedule/new" element={staffAllowed ? <ScheduleFormPage mode="create" /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/schedule/handless" element={staffAllowed ? <HandlessDaysPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/work-schedule" element={staffAllowed ? <WorkSchedulePage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/schedule/:eventId" element={staffAllowed ? <ScheduleDetailPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/schedule/:eventId/edit" element={staffAllowed ? (canEditCalendarSchedule(user) ? <ScheduleFormPage mode="edit" /> : <AccessDeniedRedirect message="일정 수정 권한이 없습니다." />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/profile" element={staffAllowed ? <ProfilePage onUserUpdate={(u) => { setUser(u); localStorage.setItem('icj_user', JSON.stringify(u)) }} /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/meetups" element={staffAllowed ? <MeetupsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/boards" element={staffAllowed ? <BoardsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/notifications" element={staffAllowed ? <NotificationsPage user={user} /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/search" element={staffAllowed ? <AppSearchPage user={user} /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/points" element={staffAllowed ? <PointsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/warehouse" element={staffAllowed ? <WarehousePage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/materials" element={staffAllowed ? <MaterialsPage user={user} /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/quotes" element={staffAllowed ? <QuoteFormsPage user={user} /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/operations-dashboard" element={staffAllowed ? <OperationsDashboardPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/quote-forms" element={staffAllowed ? <Navigate to="/quotes" replace /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/storage-status" element={staffAllowed ? <StorageStatusPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal" element={staffAllowed ? <DisposalHubPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal/forms" element={staffAllowed ? <DisposalFormsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal/forms/preview" element={staffAllowed ? <DisposalPreviewPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal/forms/:recordId" element={staffAllowed ? <DisposalFormsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal/list" element={staffAllowed ? <DisposalListPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal/settlements" element={staffAllowed ? <DisposalSettlementsPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/disposal/jurisdictions" element={staffAllowed ? <DisposalJurisdictionRegistryPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/settlements" element={staffAllowed ? (isEmployeeRestrictedUser(user) ? <AccessDeniedRedirect message="직원 계정은 결산자료에 접근할 수 없습니다." /> : <SettlementPage />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/soomgo-review-finder" element={staffAllowed ? <SoomgoReviewFinderPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/settlements/complaints-check" element={staffAllowed ? <PlaceholderFeaturePage title="컴플확인" description="컴플확인 기능은 다음 업데이트에서 연결할 예정입니다." /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/settlements/ladder-dispatch" element={staffAllowed ? (isEmployeeRestrictedUser(user) ? <AccessDeniedRedirect message="직원 계정은 결산자료에 접근할 수 없습니다." /> : <LadderDispatchPage />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/settlements/handover" element={staffAllowed ? <PlaceholderFeaturePage title="인수인계서" description="인수인계서 기능은 다음 업데이트에서 연결할 예정입니다." /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/settlements/materials-summary" element={staffAllowed ? <PlaceholderFeaturePage title="자재결산" description="자재결산 기능은 다음 업데이트에서 연결할 예정입니다." /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/settings" element={staffAllowed ? <SettingsPage onLogout={logout} /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/policies" element={staffAllowed ? <PoliciesPage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/work-shift-schedule" element={staffAllowed ? <WorkShiftSchedulePage /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/workday-history" element={staffAllowed ? (isEmployeeRestrictedUser(user) ? <AccessDeniedRedirect message="직원 계정은 일시작종료 기능을 사용할 수 없습니다." /> : <WorkdayHistoryPage />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/admin-mode" element={staffAllowed ? (canAccessAdminMode(user) ? <AdminModePage /> : <AccessDeniedRedirect />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/menu-permissions" element={staffAllowed ? (isAdministrator(user) ? <MenuPermissionPage /> : <AccessDeniedRedirect message="관리자만 접근할 수 있습니다." />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/reports" element={staffAllowed ? (canAccessAdminMode(user) ? <ReportsPage /> : <AccessDeniedRedirect />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="/memo-pad" element={staffAllowed ? (Number(user?.grade || 6) <= 2 ? <MemoPadPage user={user} /> : <AccessDeniedRedirect message="본사용 계정만 접근할 수 있습니다." />) : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
        <Route path="*" element={staffAllowed ? <Navigate to="/" replace /> : <AccessDeniedRedirect message="직원 이상 등급만 접근할 수 있습니다." />} />
      </Routes>
      </MenuLockGuard>
          </Layout>
      <HtmlInspectorPanel
        open={inspectorPanelOpen && htmlInspectorActive}
        payload={inspectorPayload}
        selectedSelector={inspectorPayload?.targetElement?.selector || ''}
        options={inspectorOptions}
        onChangeOption={(key, value) => setInspectorOptions(prev => ({ ...prev, [key]: value }))}
        selectedSections={inspectorSections}
        onChangeSection={(key, checked) => setInspectorSections(prev => ({ ...prev, [key]: checked }))}
        anchorStyle={inspectorAnchorStyle}
        onClear={clearInspectorSelection}
        onClose={() => setInspectorPanelOpen(false)}
        onCopyConfirm={copyInspectorSelection}
        onCopyJson={copyInspectorJson}
        onSaveJson={saveInspectorJsonFile}
        onSaveTxt={saveInspectorTxtFile}
      />
    </>
  )
}

export default App

