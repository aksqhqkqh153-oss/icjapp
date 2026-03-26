const ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim()
const isLocalHost = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const API_BASE = isLocalHost ? '' : ENV_API_BASE
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/find-account',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/confirm',
])

export function getApiBase() {
  return API_BASE
}

const REMEMBER_KEY = 'icj_auto_login'
const AUTH_EXPIRED_EVENT = 'icj-auth-expired'

export function getRememberedLogin() {
  return localStorage.getItem(REMEMBER_KEY) === '1'
}

export function getToken() {
  return sessionStorage.getItem('icj_token') || localStorage.getItem('icj_token') || ''
}

export function setSession(token, user, remember = false) {
  const serializedUser = JSON.stringify(user)
  sessionStorage.setItem('icj_token', token)
  sessionStorage.setItem('icj_user', serializedUser)
  if (remember) {
    localStorage.setItem('icj_token', token)
    localStorage.setItem('icj_user', serializedUser)
    localStorage.setItem(REMEMBER_KEY, '1')
  } else {
    localStorage.removeItem('icj_token')
    localStorage.removeItem('icj_user')
    localStorage.removeItem(REMEMBER_KEY)
  }
}

export function clearSession({ preserveRemember = false } = {}) {
  sessionStorage.removeItem('icj_token')
  sessionStorage.removeItem('icj_user')
  localStorage.removeItem('icj_token')
  localStorage.removeItem('icj_user')
  if (!preserveRemember) {
    localStorage.removeItem(REMEMBER_KEY)
  }
}

export function getStoredUser() {
  const raw = sessionStorage.getItem('icj_user') || localStorage.getItem('icj_user')
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function shouldAttachAuthHeader(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  if (PUBLIC_AUTH_PATHS.has(path)) {
    return false
  }
  return method !== 'OPTIONS'
}

function buildHeaders(options = {}) {
  const headers = { ...(options.headers || {}) }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

function notifyAuthExpired(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail }))
}

export async function api(path, options = {}) {
  const token = getToken()
  const headers = buildHeaders(options)
  if (token && shouldAttachAuthHeader(path, options)) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && !PUBLIC_AUTH_PATHS.has(path)) {
    clearSession({ preserveRemember: true })
    notifyAuthExpired({ path, status: res.status, detail: data.detail || '' })
  }
  if (!res.ok) {
    throw new Error(data.detail || `요청 처리 중 오류가 발생했습니다. (${res.status})`)
  }
  return data
}

export async function uploadFile(file, category = 'general') {
  const token = getToken()
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`${API_BASE}/api/uploads/file?category=${encodeURIComponent(category)}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.detail || `파일 업로드 중 오류가 발생했습니다. (${res.status})`)
  }
  return data
}

export { AUTH_EXPIRED_EVENT }
