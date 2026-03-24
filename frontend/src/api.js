const ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim()
const isLocalHost = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const API_BASE = isLocalHost ? '' : ENV_API_BASE

export function getApiBase() {
  return API_BASE
}

export function getToken() {
  return localStorage.getItem('icj_token') || ''
}

export function setSession(token, user) {
  localStorage.setItem('icj_token', token)
  localStorage.setItem('icj_user', JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem('icj_token')
  localStorage.removeItem('icj_user')
}

export function getStoredUser() {
  const raw = localStorage.getItem('icj_user')
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function api(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.detail || '요청 처리 중 오류가 발생했습니다.')
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
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.detail || '파일 업로드 중 오류가 발생했습니다.')
  }
  return data
}
