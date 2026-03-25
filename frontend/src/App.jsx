import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, clearSession, getStoredUser, setSession, uploadFile } from './api'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const PAGE_TITLES = {
  '/': '홈',
  '/map': '지도',
  '/friends': '친구',
  '/chats': '채팅',
  '/schedule': '일정',
  '/schedule/new': '일정등록',
  '/work-schedule': '스케줄',
  '/profile': '프로필',
  '/meetups': '모임',
  '/boards': '게시판',
  '/notifications': '알림',
  '/settings': '설정',
  '/admin-mode': '관리자모드',
  '/reports': '신고관리',
}

function pageTitle(pathname) {
  if (pathname.startsWith('/schedule/new')) return '일정등록'
  if (/^\/schedule\/\d+\/edit$/.test(pathname)) return '일정수정'
  if (/^\/schedule\/\d+$/.test(pathname)) return '일정상세'
  if (pathname.startsWith('/chats/direct/') || pathname.startsWith('/chats/group/')) return '채팅방'
  return PAGE_TITLES[pathname] || '앱'
}

const BRANCH_NUMBER_OPTIONS = Array.from({ length: 50 }, (_, index) => index + 1)

const ROLE_OPTIONS = [
  { value: 1, label: '관리자' },
  { value: 2, label: '부관리자' },
  { value: 3, label: '중간관리자' },
  { value: 4, label: '사업자' },
  { value: 5, label: '직원' },
  { value: 6, label: '일반' },
  { value: 7, label: '기타' },
]

function gradeLabel(grade) {
  return ROLE_OPTIONS.find(item => item.value === Number(grade))?.label || '일반'
}

function canAccessAdminMode(user) {
  return Number(user?.grade || 6) <= Number(user?.permission_config?.admin_mode_access_grade || 1)
}

function isReadOnlyMember(user) {
  return Number(user?.grade || 6) === 6
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


function Layout({ children, user, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isScheduleView = location.pathname === '/schedule'
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
  const topMenuLinks = [
    ['/meetups', '모임'],
    ['/boards', '게시판'],
    ...(canAccessAdminMode(user) ? [['/reports', '신고관리']] : []),
  ]

  useEffect(() => {
    setMenuOpen(false)
    setSettingsOpen(false)
  }, [location.pathname])

  return (
    <div className={`app-shell${isScheduleView ? ' schedule-wide' : ''}`}>
      <header className="topbar topbar-fixed">
        <div className="topbar-left">
          <div className="dropdown-wrap">
            <button type="button" className="ghost icon-button" onClick={() => setMenuOpen(v => !v)}>
              메뉴
            </button>
            {menuOpen && (
              <div className="dropdown-menu left">
                {topMenuLinks.map(([to, label]) => (
                  <button key={to} type="button" className="dropdown-item" onClick={() => navigate(to)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="page-heading">{pageTitle(location.pathname)}</div>
        <div className="topbar-right">
          <button type="button" className={location.pathname === '/notifications' ? 'ghost icon-button active-icon' : 'ghost icon-button'} onClick={() => navigate('/notifications')}>
            알림
          </button>
          <div className="dropdown-wrap">
            <button type="button" className={location.pathname === '/settings' ? 'ghost icon-button active-icon' : 'ghost icon-button'} onClick={() => setSettingsOpen(v => !v)}>
              설정
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
      <main className={`page-container${isScheduleView ? ' schedule-wide' : ''}`}>{children}</main>
      <nav className="bottom-nav">
        {bottomLinks.map(([to, label]) => (
          <Link key={to} className={isBottomActive(to) ? 'bottom-nav-item active' : 'bottom-nav-item'} to={to}>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function AuthPage({ onLogin }) {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState({ email: 'admin@example.com', password: 'admin1234' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
      setSession(data.access_token, data.user)
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
        <form onSubmit={submit} className="stack">
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="아이디" autoComplete="username" />
          <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="비밀번호" autoComplete="current-password" />
          <button disabled={loading}>{loading ? '로그인 중...' : '로그인'}</button>
          {error && <div className="error">{error}</div>}
        </form>
        <div className="inline-actions auth-link-row auth-link-row-three">
          <Link to="/signup" className="ghost-link">회원가입</Link>
          <Link to="/find-account" className="ghost-link">계정찾기</Link>
          <Link to="/reset-password" className="ghost-link">비밀번호 재설정</Link>
        </div>
        <div className="demo-box">
          <strong>등록 계정</strong>
          <div className="demo-list">
            {accounts.map(acc => (
              <button
                key={acc.email}
                className="demo-item"
                onClick={() => setForm({ email: acc.email, password: Number(acc.grade || 6) === 1 ? 'admin1234' : 'demo1234' })}
              >
                {acc.nickname} ({acc.email})
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
        branch_no: form.branch_no ? Number(form.branch_no) : null,
      }
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSession(data.access_token, data.user)
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
          <input placeholder="성별 *" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} required />
          <input type="number" placeholder="생년 *" value={form.birth_year} onChange={e => setForm({ ...form, birth_year: e.target.value })} required />
          <input placeholder="지역 *" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} required />
          <input placeholder="연락처 *" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required />
          <input type="email" placeholder="복구 이메일 *" value={form.recovery_email} onChange={e => setForm({ ...form, recovery_email: e.target.value })} required />
          <input placeholder="차량번호 (선택)" value={form.vehicle_number} onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />
          <select value={form.branch_no} onChange={e => setForm({ ...form, branch_no: e.target.value })}>
            <option value="">호점 선택 (선택)</option>
            {branchOptions.map(num => <option key={num} value={num}>{num}호점</option>)}
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

function HomePage() {
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    async function load() {
      const [friends, notifications, upcoming] = await Promise.all([
        api('/api/friends'),
        api('/api/notifications'),
        api('/api/home/upcoming-schedules'),
      ])
      setSummary({
        friendCount: friends.friends.length,
        requestCount: friends.received_requests.length,
        notificationCount: notifications.length,
        upcomingDays: upcoming.days || [],
      })
    }
    load().catch(() => {})
  }, [])

  return (
    <div className="stack-page">
      <section className="card">
        <h2>빠른 확인</h2>
        <div className="stats stats-3">
          <div className="stat"><strong>{summary?.friendCount ?? '-'}</strong><span>친구 수</span></div>
          <div className="stat"><strong>{summary?.requestCount ?? '-'}</strong><span>받은 친구 요청</span></div>
          <div className="stat"><strong>{summary?.notificationCount ?? '-'}</strong><span>알림 수</span></div>
        </div>
      </section>
      <section className="card">
        <div className="between"><h2>다가오는 일정</h2><Link to="/work-schedule" className="ghost-link">스케줄로 이동</Link></div>
        <div className="list upcoming-schedule-list">
          {(summary?.upcomingDays || []).map(day => (
            <div className="list-item block upcoming-day-group" key={day.date}>
              <strong>{day.label}</strong>
              <div className="stack compact">
                {day.items.map((item, index) => (
                  <div key={`${day.date}-${index}`} className="upcoming-line">
                    <div> - [{item.time_text}] [{item.customer_name}] [{item.representative_text}] [{item.staff_text}] [{item.start_address}]</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {summary && summary.upcomingDays.length === 0 && <div className="muted">내 계정에 배정된 다가오는 스케줄이 없습니다.</div>}
          {!summary && <div className="muted">불러오는 중...</div>}
        </div>
      </section>
    </div>
  )
}


function ProfilePage({ onUserUpdate }) {
  const [form, setForm] = useState(null)
  const [message, setMessage] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const branchOptions = BRANCH_NUMBER_OPTIONS

  useEffect(() => {
    api('/api/profile').then(data => setForm({ ...data.user, new_password: '' }))
  }, [])

  if (!form) return <div className="card">불러오는 중...</div>

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      email: form.email || '',
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
      branch_no: form.branch_no ? Number(form.branch_no) : null,
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
    const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    setForm({ ...data.user, new_password: '' })
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
          <span className="profile-badge ghost">{form.branch_no ? `${form.branch_no}호점` : '본점/미지정'}</span>
        </div>
      </div>

      <form onSubmit={save} className="profile-form-layout">
        <section className="profile-section">
          <h3>기본 계정 정보</h3>
          <div className="profile-grid two">
            <label className="field-block">
              <span>아이디</span>
              <input value={form.email || ''} onChange={e => updateField('email', e.target.value)} placeholder="아이디" />
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
              <span>권한</span>
              <input value={form.grade_label || ''} readOnly className="readonly-input" />
            </label>
            <label className="field-block">
              <span>호점</span>
              <select value={form.branch_no || ''} onChange={e => updateField('branch_no', e.target.value)}>
                <option value="">본점 또는 미지정</option>
                {branchOptions.map(num => <option key={num} value={num}>{num}호점</option>)}
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
              <input value={form.gender || ''} onChange={e => updateField('gender', e.target.value)} placeholder="성별" />
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
  const [profile, setProfile] = useState(null)
  const [users, setUsers] = useState([])
  const [data, setData] = useState({ friends: [], received_requests: [], sent_requests: [] })
  const [follows, setFollows] = useState([])
  const [message, setMessage] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState('')

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

  async function doAction(fn, successText = '처리되었습니다.') {
    setMessage('')
    await fn()
    setMessage(successText)
    await load()
  }

  const followedIds = useMemo(() => new Set((follows || []).map(item => item.id)), [follows])
  const favorites = useMemo(() => data.friends.filter(friend => followedIds.has(friend.id)), [data.friends, followedIds])
  const normalizedQuery = searchText.trim().toLowerCase()
  const filteredFriends = useMemo(() => {
    if (!normalizedQuery) return data.friends
    return data.friends.filter(friend => [friend.nickname, friend.one_liner, friend.region].join(' ').toLowerCase().includes(normalizedQuery))
  }, [data.friends, normalizedQuery])
  const candidateUsers = useMemo(() => {
    const friendIds = new Set(data.friends.map(item => item.id))
    return users.filter(item => !friendIds.has(item.id) && (!normalizedQuery || [item.nickname, item.one_liner, item.region].join(' ').toLowerCase().includes(normalizedQuery)))
  }, [users, data.friends, normalizedQuery])
  const receivedProfiles = useMemo(() => data.received_requests.map(req => ({ ...req, profile: users.find(item => item.id === req.requester_id) || {} })), [data.received_requests, users])

  function FriendRow({ item, actions = null }) {
    return (
      <div className="friend-row-card">
        <AvatarCircle src={item.photo_url} label={item.nickname} className="friend-avatar" />
        <div className="friend-row-body">
          <div className="friend-row-title">{item.nickname || '회원'}</div>
          <div className="friend-row-subtitle">{item.one_liner || item.bio || item.region || '한줄소개가 없습니다.'}</div>
        </div>
        {actions && <div className="friend-row-actions">{actions}</div>}
      </div>
    )
  }

  return (
    <div className="stack-page friends-page">
      <section className="card friends-shell">
        <div className="friends-topbar">
          <div></div>
          <div className="friends-top-actions">
            <button type="button" className="ghost icon-button" onClick={() => setSearchOpen(v => !v)}>검색</button>
            <div className="dropdown-wrap">
              <button type="button" className="ghost icon-button" onClick={() => setMenuOpen(v => !v)}>메뉴</button>
              {menuOpen && (
                <div className="dropdown-menu right">
                  <button type="button" className="dropdown-item" onClick={() => { setPanel('add'); setMenuOpen(false) }}>친구추가</button>
                  <button type="button" className="dropdown-item" onClick={() => { setPanel('requests'); setMenuOpen(false) }}>친구요청목록</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {searchOpen && <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="친구 검색" className="friends-search-input" />}

        <div className="friends-section-label">내 정보</div>
        {profile && (
          <div className="my-profile-card">
            <AvatarCircle src={profile.photo_url} label={profile.nickname} className="friend-avatar large" size={56} />
            <div className="friend-row-body">
              <div className="friend-row-title">{profile.nickname}</div>
              <div className="friend-row-subtitle">{profile.one_liner || profile.bio || '한줄소개를 입력해 주세요.'}</div>
            </div>
          </div>
        )}

        <div className="friends-section-label">즐겨찾기</div>
        <div className="friends-group-list">
          {favorites.length > 0 ? favorites.map(item => <FriendRow key={`fav-${item.id}`} item={item} />) : <div className="muted">즐겨찾기 친구가 없습니다.</div>}
        </div>

        <div className="friends-section-label">전체친구</div>
        <div className="friends-group-list">
          {filteredFriends.length > 0 ? filteredFriends.map(item => <FriendRow key={`friend-${item.id}`} item={item} />) : <div className="muted">표시할 친구가 없습니다.</div>}
        </div>

        {panel === 'add' && (
          <section className="friends-subpanel">
            <div className="between"><strong>친구추가</strong><button type="button" className="ghost small" onClick={() => setPanel('')}>닫기</button></div>
            <div className="friends-group-list">
              {candidateUsers.map(item => (
                <FriendRow
                  key={`candidate-${item.id}`}
                  item={item}
                  actions={<button className="small" onClick={() => doAction(() => api(`/api/friends/request/${item.id}`, { method: 'POST' }), '친구 요청을 보냈습니다.')}>요청</button>}
                />
              ))}
              {candidateUsers.length === 0 && <div className="muted">추가 가능한 친구가 없습니다.</div>}
            </div>
          </section>
        )}

        {panel === 'requests' && (
          <section className="friends-subpanel">
            <div className="between"><strong>친구요청목록</strong><button type="button" className="ghost small" onClick={() => setPanel('')}>닫기</button></div>
            <div className="friends-group-list">
              {receivedProfiles.map(req => (
                <FriendRow
                  key={`req-${req.id}`}
                  item={{ ...req.profile, nickname: req.profile.nickname || req.requester_nickname, one_liner: req.profile.one_liner || req.profile.region || '친구 요청을 보냈습니다.' }}
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
      </section>
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

function ChatActionSheet({ title, actions, onClose }) {
  if (!actions) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        {title && <div className="sheet-title">{title}</div>}
        <div className="sheet-actions">
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              className={action.danger ? 'sheet-action danger-text' : 'sheet-action'}
              onClick={() => {
                action.onClick?.()
                onClose?.()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ChatsPage() {
  const navigate = useNavigate()
  const [category, setCategory] = useState('all')
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [actionRoom, setActionRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [items, userList] = await Promise.all([
        api(`/api/chat-list?category=${category}`),
        api('/api/users'),
      ])
      setRooms(items)
      setUsers(userList)
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
    await load()
  }

  async function handleInvite(room) {
    const selectable = users.filter(item => String(item.id) !== String(room.room_ref))
    const guide = selectable.map(item => `${item.id}: ${item.nickname}`).join('\n')
    const picked = window.prompt(`초대할 회원 번호를 입력하세요.\n${guide}`)
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

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rooms
    return rooms.filter(room => [room.title, room.subtitle, room.target_user?.nickname].join(' ').toLowerCase().includes(q))
  }, [rooms, query])

  const roomActions = actionRoom ? [
    { label: '채팅방 이름변경', onClick: async () => {
      const nextName = window.prompt('새 채팅방 이름을 입력하세요.', actionRoom.title || '')
      if (nextName === null) return
      await updateRoomSetting(actionRoom, { custom_name: nextName })
    } },
    { label: '채팅방 초대', onClick: async () => { await handleInvite(actionRoom) } },
    { label: '채팅방 나가기', danger: true, onClick: async () => { await handleLeave(actionRoom) } },
    { label: actionRoom.pinned ? '채팅방 상단고정 해제' : '채팅방 상단고정', onClick: async () => { await updateRoomSetting(actionRoom, { pinned: !actionRoom.pinned }) } },
    { label: actionRoom.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가', onClick: async () => { await updateRoomSetting(actionRoom, { favorite: !actionRoom.favorite }) } },
    { label: actionRoom.muted ? '채팅방 알람켜기' : '채팅방 알람끄기', onClick: async () => { await updateRoomSetting(actionRoom, { muted: !actionRoom.muted }) } },
  ] : null

  return (
    <div className="stack-page">
      <section className="card chat-list-card">
        <div className="inline-actions wrap chat-category-row">
          {CHAT_CATEGORIES.map(([value, label]) => (
            <button key={value} type="button" className={category === value ? 'small' : 'small ghost'} onClick={() => setCategory(value)}>{label}</button>
          ))}
        </div>
        <div className="chat-list-searchbar">
          <button type="button" className="small ghost">검색</button>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="선택한 카테고리에서 채팅 검색" />
        </div>
        <div className="chat-room-list">
          {filteredRooms.map(room => {
            const bind = useLongPress(() => setActionRoom(room))
            return (
              <button
                key={room.id}
                type="button"
                className={`chat-room-row structured ${room.unread_tag ? 'tagged' : ''}`}
                onClick={() => navigate(buildRoomPath(room))}
                {...bind}
              >
                <RoomAvatar room={room} />
                <div className="chat-room-main">
                  <div className="chat-room-title-line">
                    <strong className="chat-room-title-text">{room.title}</strong>
                    <span className="chat-room-time">{formatChatUpdatedAt(room.updated_at)}</span>
                  </div>
                  <div className={room.unread_tag ? 'chat-room-subtitle alert' : 'chat-room-subtitle'}>{room.subtitle || '최근 채팅이 없습니다.'}</div>
                </div>
              </button>
            )
          })}
          {!loading && filteredRooms.length === 0 && <div className="muted">표시할 채팅방이 없습니다.</div>}
          {loading && <div className="muted">채팅 목록을 불러오는 중...</div>}
        </div>
      </section>
      <ChatActionSheet title={actionRoom ? actionRoom.title : ''} actions={roomActions} onClose={() => setActionRoom(null)} />
    </div>
  )
}


function ChatRoomPage({ roomType }) {
  const params = useParams()
  const navigate = useNavigate()
  const targetRef = roomType === 'group' ? params.roomId : params.targetUserId
  const [data, setData] = useState(null)
  const [message, setMessage] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [messageAction, setMessageAction] = useState(null)
  const [mentionQueue, setMentionQueue] = useState([])
  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const messageRefs = useRef({})

  async function load() {
    const endpoint = roomType === 'group' ? `/api/group-rooms/${targetRef}/messages` : `/api/chat/${targetRef}`
    const result = await api(endpoint)
    setData(result)
    setMentionQueue(result.pending_mentions || [])
  }

  useEffect(() => {
    load().catch(() => {})
  }, [roomType, targetRef])

  useEffect(() => {
    if (!data?.messages?.length) return
    const node = messageRefs.current[data.messages[data.messages.length - 1].id]
    node?.scrollIntoView({ block: 'end' })
  }, [data?.messages?.length])

  const title = useMemo(() => {
    if (!data) return ''
    if (roomType === 'group') return data.room_setting?.custom_name || data.room?.title || '단체 채팅방'
    return data.room_setting?.custom_name || data.target_user?.nickname || '채팅방'
  }, [data, roomType])

  async function send(payload = {}) {
    const endpoint = roomType === 'group' ? `/api/group-rooms/${targetRef}/messages` : `/api/chat/${targetRef}`
    const body = {
      message,
      reply_to_id: replyTo?.id || null,
      mention_user_id: replyTo?.sender?.id && replyTo.sender.id !== getStoredUser()?.id ? replyTo.sender.id : null,
      ...payload,
    }
    await api(endpoint, { method: 'POST', body: JSON.stringify(body) })
    setMessage('')
    setReplyTo(null)
    setPlusOpen(false)
    await load()
  }

  async function sendAttachment(file, attachmentType) {
    if (!file) return
    const uploaded = await uploadFile(file, attachmentType === 'image' ? 'chat-image' : 'chat-file')
    await send({
      message: attachmentType === 'image' ? '사진을 보냈습니다.' : '파일을 보냈습니다.',
      attachment_name: uploaded.name || file.name,
      attachment_url: uploaded.url,
      attachment_type: attachmentType,
    })
  }

  async function shareLocation() {
    if (!navigator.geolocation) {
      alert('브라우저 위치 기능을 사용할 수 없습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude, longitude } = pos.coords
      await send({
        message: '내 위치를 공유했습니다.',
        attachment_name: '위치',
        attachment_url: `https://maps.google.com/?q=${latitude},${longitude}`,
        attachment_type: 'location',
      })
    })
  }

  async function startCall() {
    const endpoint = roomType === 'group' ? `/api/voice/group/${targetRef}` : `/api/voice/direct/${targetRef}`
    const result = await api(endpoint, { method: 'POST' })
    alert(`통화방이 생성되었습니다. room_id: ${result.room_id}`)
  }

  async function toggleRoomMute() {
    const endpoint = roomType === 'group' ? `/api/chat-rooms/group/${targetRef}/settings` : `/api/chat-rooms/direct/${targetRef}/settings`
    await api(endpoint, { method: 'PUT', body: JSON.stringify({ muted: !data?.room_setting?.muted }) })
    await load()
  }

  async function leaveRoom() {
    if (roomType === 'group') {
      await api(`/api/group-rooms/${targetRef}/leave`, { method: 'POST' })
    } else {
      await api(`/api/chat-rooms/direct/${targetRef}/settings`, { method: 'PUT', body: JSON.stringify({ hidden: true }) })
    }
    navigate('/chats')
  }

  async function jumpToDate(dateText) {
    if (!dateText) return
    const found = data?.messages?.find(item => String(item.created_at || '').slice(0, 10) === dateText)
    if (found) {
      messageRefs.current[found.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      alert('해당 날짜의 대화기록이 없습니다.')
    }
    setMenuOpen(false)
  }

  async function handleReaction(messageItem, emoji) {
    const endpoint = roomType === 'group' ? `/api/group-messages/${messageItem.id}/reactions` : `/api/dm-messages/${messageItem.id}/reactions`
    const updated = await api(endpoint, { method: 'POST', body: JSON.stringify({ emoji }) })
    setData(prev => ({
      ...prev,
      messages: prev.messages.map(item => item.id === updated.id ? updated : item),
    }))
  }

  async function openMentionTarget(mention) {
    messageRefs.current[mention.message_id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await api(`/api/chat-mentions/${mention.id}/seen`, { method: 'POST' })
    setMentionQueue(prev => prev.filter(item => item.id !== mention.id))
  }

  const filteredMessages = useMemo(() => {
    if (!query.trim()) return data?.messages || []
    const q = query.trim()
    return (data?.messages || []).filter(item => item.message?.includes(q) || item.sender?.nickname?.includes(q) || item.attachment_name?.includes(q))
  }, [data?.messages, query])

  const roomMenuActions = [
    { label: '대화기록', onClick: () => {
      const dateText = window.prompt('이동할 날짜를 입력하세요. 예: 2026-03-23')
      if (dateText) jumpToDate(dateText)
    } },
    { label: data?.room_setting?.muted ? '알림켜기' : '알림끄기', onClick: toggleRoomMute },
    { label: '채팅방 나가기', danger: true, onClick: leaveRoom },
  ]

  const messageActions = messageAction ? [
    { label: '답글', onClick: () => setReplyTo(messageAction) },
    ...QUICK_REACTIONS.map(emoji => ({ label: `감정표현 ${emoji}`, onClick: () => handleReaction(messageAction, emoji) })),
  ] : null

  return (
    <div className="stack-page chat-room-page">
      <section className="card chat-room-card">
        <div className="chat-room-header-actions">
          <button type="button" className="small ghost" onClick={() => navigate('/chats')}>목록</button>
          <strong className="chat-room-heading">{title}</strong>
          <div className="inline-actions">
            <button type="button" className="small ghost" onClick={() => setSearchOpen(v => !v)}>검색</button>
            <button type="button" className="small ghost" onClick={() => setMenuOpen(v => !v)}>메뉴</button>
          </div>
        </div>
        {menuOpen && <div className="inline-actions wrap room-menu-bar">{roomMenuActions.map(action => <button key={action.label} type="button" className={action.danger ? 'small ghost danger-text' : 'small ghost'} onClick={() => { action.onClick(); setMenuOpen(false) }}>{action.label}</button>)}</div>}
        {searchOpen && (
          <div className="chat-search-panel">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="대화 내용 검색" />
            <div className="chat-search-results">
              {filteredMessages.slice(-20).map(item => (
                <button key={item.id} type="button" className="search-result-row" onClick={() => messageRefs.current[item.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                  <strong>{item.sender?.nickname}</strong>
                  <span>{item.message || item.attachment_name || '첨부'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="chat-log room-log">
          {(data?.messages || []).map(item => {
            const bind = useLongPress(() => setMessageAction(item))
            const isMine = item.sender?.id === getStoredUser()?.id
            return (
              <div key={item.id} ref={el => { messageRefs.current[item.id] = el }} className={isMine ? 'chat-msg bubble mine' : 'chat-msg bubble other'} {...bind}>
                <div className="chat-msg-meta"><strong>{item.sender?.nickname}</strong><span>{String(item.created_at || '').slice(0, 16).replace('T', ' ')}</span></div>
                {item.reply_to && <div className="reply-preview">↳ {item.reply_to.sender?.nickname}: {item.reply_to.message}</div>}
                {item.message && <div>{item.message}</div>}
                <AttachmentPreview message={item} />
                {item.reaction_summary?.length > 0 && <div className="reaction-row">{item.reaction_summary.map(entry => <span key={entry.emoji} className="reaction-chip">{entry.emoji} {entry.count}</span>)}</div>}
              </div>
            )
          })}
        </div>
        {replyTo && (
          <div className="replying-banner">
            <div>답글 대상: {replyTo.sender?.nickname} / {replyTo.message}</div>
            <button type="button" className="small ghost" onClick={() => setReplyTo(null)}>취소</button>
          </div>
        )}
        <div className="comment-box chat-input-bar">
          <button type="button" className="small ghost plus-button" onClick={() => setPlusOpen(v => !v)}>+</button>
          <input value={message} onChange={e => setMessage(e.target.value)} placeholder="메시지 입력" />
          <button type="button" className="small" onClick={() => send().catch(err => alert(err.message))}>전송</button>
        </div>
        {plusOpen && (
          <div className="plus-actions">
            <button type="button" className="small ghost" onClick={() => imageInputRef.current?.click()}>사진첨부</button>
            <button type="button" className="small ghost" onClick={startCall}>통화하기</button>
            <button type="button" className="small ghost" onClick={shareLocation}>내위치공유</button>
            <button type="button" className="small ghost" onClick={() => fileInputRef.current?.click()}>파일첨부</button>
          </div>
        )}
        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={e => sendAttachment(e.target.files?.[0], 'image').catch(err => alert(err.message))} />
        <input ref={fileInputRef} type="file" hidden onChange={e => sendAttachment(e.target.files?.[0], 'file').catch(err => alert(err.message))} />
      </section>
      {mentionQueue.length > 0 && (
        <button type="button" className="mention-toast" onClick={() => openMentionTarget(mentionQueue[0])}>
          {mentionQueue[0].sender?.nickname}님이 나를 태그한 글을 보시겠습니까?
        </button>
      )}
      <ChatActionSheet title={messageAction ? '메시지 메뉴' : ''} actions={messageActions} onClose={() => setMessageAction(null)} />
    </div>
  )
}

function MapPage() {
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const markerLayerRef = useRef(null)
  const watchIdRef = useRef(null)
  const isMobile = useIsMobile()
  const [users, setUsers] = useState([])
  const [shareNotice, setShareNotice] = useState('')

  async function loadMapUsers() {
    const data = await api('/api/map-users')
    setUsers(data)
  }

  useEffect(() => {
    loadMapUsers().catch(() => setUsers([]))
  }, [])

  useEffect(() => {
    if (!isMobile) return undefined
    let cancelled = false
    async function prepareMobileLocationShare() {
      try {
        const currentUser = getStoredUser()
        const status = await api('/api/location-sharing/status')
        if (!status.eligible) return
        const assignmentLine = status.active_assignment
          ? `현재 배정 일정: ${status.active_assignment.time_text} ${status.active_assignment.customer_name} / ${status.active_assignment.start_address || '-'}\n\n`
          : ''
        if (!status.consent_granted) {
          const approved = window.confirm(`${assignmentLine}오늘 배정된 일정 시간대에만 내 위치를 공개하시겠습니까?\n허용하면 지도 화면에서 위치정보 동의 후 자동으로 진행됩니다.`)
          if (!approved) return
          const consentData = await api('/api/location-sharing/consent', {
            method: 'POST',
            body: JSON.stringify({ enabled: true }),
          })
          if (consentData?.user) {
            localStorage.setItem('icj_user', JSON.stringify(consentData.user))
          }
        }
        const refreshed = await api('/api/location-sharing/status')
        if (!refreshed.active_now) {
          setShareNotice('오늘 담당 일정 시간대가 되면 위치 공개가 자동 적용됩니다.')
          return
        }
        if (!navigator.geolocation) {
          setShareNotice('이 기기에서는 위치 기능을 사용할 수 없습니다.')
          return
        }
        setShareNotice('현재 담당 일정 시간대라 내 위치가 지도에 공개됩니다.')
        watchIdRef.current = navigator.geolocation.watchPosition(async pos => {
          try {
            await api('/api/profile/location', {
              method: 'POST',
              body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, region: currentUser?.region || '서울' }),
            })
            if (!cancelled) {
              loadMapUsers().catch(() => {})
            }
          } catch (_) {}
        }, () => {
          setShareNotice('위치 권한이 거부되어 지도 공개를 진행할 수 없습니다.')
        }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })
      } catch (_) {}
    }
    prepareMobileLocationShare()
    return () => {
      cancelled = true
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [isMobile])

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

  useEffect(() => {
    if (!leafletRef.current || !markerLayerRef.current) return
    markerLayerRef.current.clearLayers()
    if (users.length === 0) return
    const bounds = []
    users.forEach(item => {
      const label = ENCLOSED_NUMBERS[item.branch_no] || String(item.branch_no || '?')
      const icon = L.divIcon({ className: 'branch-marker-wrap', html: `<div class="branch-marker">${label}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] })
      L.marker([item.latitude, item.longitude], { icon })
        .bindPopup(`<strong>${item.branch_no || '-'}호점</strong><br/>${item.nickname}<br/>${item.vehicle_number || '-'}<br/>${item.region}`)
        .addTo(markerLayerRef.current)
      bounds.push([item.latitude, item.longitude])
    })
    if (bounds.length === 1) leafletRef.current.setView(bounds[0], 12)
    else leafletRef.current.fitBounds(bounds, { padding: [30, 30] })
  }, [users])

  return (
    <div className="stack-page">
      <section className="card map-card">
        <div className="map-legend muted">차량번호와 호점이 등록된 기사 위치가 지도 위에 표시됩니다. 표시는 각 호점 숫자 아이콘으로 보입니다.</div>
        {shareNotice && <div className="info">{shareNotice}</div>}
        <div ref={mapRef} className="real-map-canvas" />
        <div className="map-driver-list">
          {users.map(item => (
            <div key={item.id} className="map-driver-item">
              <strong>{ENCLOSED_NUMBERS[item.branch_no] || item.branch_no} {item.branch_no}호점</strong>
              <span>{item.nickname} / {item.vehicle_number}</span>
              <span>{item.region}</span>
            </div>
          ))}
          {users.length === 0 && <div className="muted">지도에 표시할 차량 위치가 없습니다.</div>}
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
              <div><strong>{item.title}</strong></div>
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
          {categories.map(([value, label]) => <button key={value} className={category === value ? 'small' : 'small ghost'} onClick={() => setCategory(value)}>{label}</button>)}
        </div>
        <div className="list">
          {posts.map(item => (
            <div className="list-item block" key={item.id}>
              <strong>{item.title}</strong>
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
  const end = endOfMonth(date)
  const firstWeekday = start.getDay()
  const days = []
  for (let i = 0; i < firstWeekday; i += 1) {
    days.push(null)
  }
  for (let d = 1; d <= end.getDate(); d += 1) {
    days.push(new Date(date.getFullYear(), date.getMonth(), d))
  }
  while (days.length % 7 !== 0) {
    days.push(null)
  }
  return days
}

const DEFAULT_DEPARTMENT_OPTIONS = [
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

function buildScheduleTitle(form) {
  const startDisplay = resolveScheduleStartTime(form.visit_time || form.start_time)
  const platformDisplay = form.platform || '플랫폼미정'
  const customerDisplay = resolveScheduleCustomerName(form.customer_name)
  const costDisplay = buildCostTitlePart(form)
  return [startDisplay, platformDisplay, customerDisplay, costDisplay].join(' ').trim()
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


function CalendarPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const initialDate = searchParams.get('date') || fmtDate(new Date())
  const initialMonth = (() => {
    const parsed = new Date(`${initialDate}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? startOfMonth(new Date()) : startOfMonth(parsed)
  })()
  const [items, setItems] = useState([])
  const [monthCursor, setMonthCursor] = useState(initialMonth)
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [overflowPopup, setOverflowPopup] = useState({ dateKey: '', items: [] })

  async function load() {
    const data = await api('/api/calendar/events')
    setItems(data)
  }
  useEffect(() => { load().catch(() => {}) }, [])
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

  const days = useMemo(() => buildMonthDays(monthCursor), [monthCursor])
  const monthLabel = useMemo(() => `${monthCursor.getFullYear()}년 ${monthCursor.getMonth() + 1}월`, [monthCursor])
  const grouped = useMemo(() => {
    const map = new Map()
    items.forEach(item => {
      const key = item.event_date
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
  const detailItems = grouped.get(selectedDate) || []
  const visibleLaneCount = isMobile ? 2 : 5

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

  function openOverflowPopup(date, dayItems, event) {
    if (event) event.stopPropagation()
    setOverflowPopup({ dateKey: fmtDate(date), items: dayItems })
  }

  function closeOverflowPopup() {
    setOverflowPopup({ dateKey: '', items: [] })
  }

  return (
    <div className={`stack-page schedule-page${isMobile ? ' mobile' : ''}`}>
      <section className="card schedule-card">
        <div className="calendar-toolbar">
          <div className="inline-actions">
            <button type="button" className="ghost small" onClick={() => moveMonth(-1)}>이전달</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="ghost small" onClick={() => moveMonth(1)}>다음달</button>
          </div>
          {!readOnly && <button type="button" className="small" onClick={() => navigate(`/schedule/new?date=${selectedDate || fmtDate(new Date())}`)}>일정등록</button>}
        </div>
        <div className="calendar-weekdays">
          {['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day} className="weekday">{day}</div>)}
        </div>
        <div className="calendar-grid schedule-grid detail-mode">
          {days.map((date, idx) => {
            const key = date ? fmtDate(date) : `blank-${idx}`
            const today = date && fmtDate(date) === fmtDate(new Date())
            const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6)
            const isSelected = date && fmtDate(date) === selectedDate
            const dayItems = date ? (grouped.get(fmtDate(date)) || []) : []
            const visibleItems = dayItems.slice(0, visibleLaneCount)
            const extraCount = Math.max(dayItems.length - visibleLaneCount, 0)
            return (
              <div key={key} className={date ? `calendar-cell schedule-cell detail-cell${today ? ' today' : ''}${isWeekend ? ' weekend' : ''}${isSelected ? ' selected' : ''}` : 'calendar-cell empty'}>
                {date && (
                  <div className="calendar-cell-topline">
                    <button type="button" className={isMobile ? 'calendar-date-select mobile-only-select' : 'calendar-date-select'} onClick={() => selectDate(date)}>
                      <span className="calendar-date">{date.getDate()}</span>
                    </button>
                    {!isMobile && (
                      <div className="calendar-top-actions">
                        <button type="button" className="calendar-entry-band secondary" onClick={() => navigate(`/work-schedule?date=${fmtDate(date)}`)}>
                          <span className="calendar-entry-label">스케줄목록</span>
                        </button>
                        <button type="button" className="calendar-entry-band" onClick={() => openDateForm(date)}>
                          <span className="calendar-entry-label">일정등록</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {date && (
                  <div
                    className="calendar-lanes-stack"
                    role="button"
                    tabIndex={0}
                    onClick={() => selectDate(date)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectDate(date)
                      }
                    }}
                  >
                    <div className="calendar-lanes">
                      {visibleItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className="calendar-lane filled clickable"
                          style={{ background: item.color || '#2563eb', boxShadow: `inset 0 0 0 1px ${applyAlphaToHex(item.color, '55')}` }}
                          title={item.title}
                          onClick={(event) => {
                            event.stopPropagation()
                            navigate(`/schedule/${item.id}`)
                          }}
                        >
                          <span>{item.title}</span>
                        </button>
                      ))}
                      {Array.from({ length: Math.max(visibleLaneCount - visibleItems.length, 0) }).map((_, laneIndex) => (
                        <span key={`empty-${key}-${laneIndex}`} className="calendar-lane" />
                      ))}
                    </div>
                    {extraCount > 0 && (
                      <button
                        type="button"
                        className="calendar-more-indicator"
                        onClick={(event) => openOverflowPopup(date, dayItems, event)}
                      >
                        +{extraCount}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
      {overflowPopup.items.length > 0 && (
        <div className="schedule-popup-backdrop" onClick={closeOverflowPopup}>
          <section className="schedule-popup-card" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>{formatSelectedDateLabel(overflowPopup.dateKey)}</strong>
                <div className="muted">해당 날짜의 전체 일정 목록입니다.</div>
              </div>
              <button type="button" className="ghost small" onClick={closeOverflowPopup}>닫기</button>
            </div>
            <div className="schedule-popup-list">
              {overflowPopup.items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="detail-schedule-item popup-item colorized"
                  style={{ background: applyAlphaToHex(item.color, '24'), borderColor: applyAlphaToHex(item.color, '88') }}
                  onClick={() => {
                    closeOverflowPopup()
                    navigate(`/schedule/${item.id}`)
                  }}
                >
                                    <ScheduleCardLine item={item} colorized={false} />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      <section className="card schedule-detail-card">
        <div className="detail-header-wrap no-title">
          <div className="muted">{formatSelectedDateLabel(selectedDate)}</div>
        </div>
        <div className="schedule-detail-list">
          {detailItems.map(item => (
            <button
              key={item.id}
              type="button"
              className="detail-schedule-item"
              style={isMobile ? { background: applyAlphaToHex(item.color, '24'), borderColor: applyAlphaToHex(item.color, '88') } : undefined}
              onClick={() => navigate(`/schedule/${item.id}`)}
            >
              <ScheduleCardLine item={item} mobileCompact={isMobile} colorized={false} />
            </button>
          ))}
          {detailItems.length === 0 && <div className="muted">선택한 날짜에 등록된 일정이 없습니다.</div>}
        </div>
      </section>
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
  return {
    id: item?.id ?? '',
    entry_type: item?.entry_type || 'manual',
    event_id: item?.event_id ?? null,
    schedule_date: item?.schedule_date || scheduleDate || '',
    schedule_time: item?.schedule_time || '',
    customer_name: item?.customer_name || '',
    representative_names: item?.representative_names || '',
    staff_names: item?.staff_names || '',
    memo: item?.memo || '',
  }
}

function splitScheduleNames(value) {
  return String(value || '')
    .split(/[\n,/]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function workScheduleHeading(index) {
  if (index === 0) return '당일일정'
  if (index === 1) return '내일일정'
  if (index === 2) return '모레일정'
  return `${index + 1}일차 일정`
}

function workScheduleDateLine(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`
}

function WorkSchedulePage() {
  const isMobile = useIsMobile()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const [daysData, setDaysData] = useState([])
  const [loading, setLoading] = useState(true)
  const [entryForm, setEntryForm] = useState(emptyWorkScheduleForm(fmtDate(new Date())))
  const [activeFormDate, setActiveFormDate] = useState('')
  const [noteForm, setNoteForm] = useState({ schedule_date: '', excluded_business_slots: Array(6).fill(''), excluded_staff: '' })
  const [activeNoteDate, setActiveNoteDate] = useState('')
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState('')
  const [editingForm, setEditingForm] = useState(emptyWorkScheduleForm(fmtDate(new Date())))
  const [bulkEditDate, setBulkEditDate] = useState('')
  const [bulkForms, setBulkForms] = useState({})

  async function load() {
    setLoading(true)
    try {
      const data = await api('/api/work-schedule')
      setDaysData(data.days || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [])

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
    setNoteForm({
      schedule_date: day.date,
      excluded_business_slots: parseExcludedBusinessSlots(day.excluded_business),
      excluded_staff: day.excluded_staff || '',
    })
    setMessage('')
  }

  function closeNotes() {
    setActiveNoteDate('')
  }

  async function submitEntry(e) {
    e.preventDefault()
    await api('/api/work-schedule/entries', { method: 'POST', body: JSON.stringify({ ...entryForm, schedule_time: entryForm.schedule_time || '' }) })
    setMessage('스케줄이 등록되었습니다.')
    closeEntryForm()
    await load()
  }

  async function submitNotes(e) {
    e.preventDefault()
    const payload = {
      schedule_date: noteForm.schedule_date,
      excluded_business: serializeExcludedBusinessSlots(noteForm.excluded_business_slots),
      excluded_staff: noteForm.excluded_staff,
    }
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify(payload) })
    setMessage('열외자 목록이 저장되었습니다.')
    closeNotes()
    await load()
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
      return
    }
    setBulkEditDate(day.date)
    setBulkForms(prev => ({
      ...prev,
      [day.date]: day.entries.map(item => buildWorkScheduleForm(item, day.date)),
    }))
    setMessage('')
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
        representative_names: form.representative_names || '',
        staff_names: form.staff_names || '',
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

  async function submitBulkEdit(dayDate) {
    const forms = bulkForms[dayDate] || []
    for (const form of forms) {
      await saveScheduleForm(form)
    }
    setMessage('일자별 스케줄이 전체 수정되었습니다.')
    setBulkEditDate('')
    await load()
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
          <section key={day.date} className="card work-schedule-day">
            <div className="between work-schedule-head">
              <div className="work-schedule-headline">
                <strong>{workScheduleHeading(index)}</strong>
                <span className="muted">{workScheduleDateLine(day.date)}</span>
              </div>
              <div className="inline-actions wrap">
                {!readOnly && <button type="button" className="small ghost" onClick={() => openCreate(day.date)}>스케줄추가</button>}
                {!readOnly && <button type="button" className="small ghost" onClick={() => openBulkEdit(day)}>{isBulkEdit ? '전체편집닫기' : '일자별전체편집'}</button>}
                {!readOnly && <button type="button" className="small ghost" onClick={() => openNotes(day)}>열외자편집</button>}
              </div>
            </div>

            <div className="work-schedule-vehicle-status">
              <span>[가용차량 : <strong>{day.available_vehicle_count ?? 0}</strong>]</span>
              <span>|</span>
              <span>[열외차량 : <strong>{day.excluded_vehicle_count ?? 0}</strong>]</span>
            </div>

            {activeFormDate === day.date && !readOnly && (
              <form onSubmit={submitEntry} className="work-schedule-entry-form">
                <div className="work-schedule-table header">
                  <div>시간</div><div>고객명</div><div>담당대표명1/2/3</div><div>직원명1/2/3</div><div>기타메모</div>
                </div>
                <div className="work-schedule-table">
                  <input value={entryForm.schedule_time} placeholder="09:00" onChange={e => setEntryForm({ ...entryForm, schedule_time: normalizeScheduleTimeInput(e.target.value, e.target.value) })} />
                  <input value={entryForm.customer_name} placeholder="고객명" onChange={e => setEntryForm({ ...entryForm, customer_name: e.target.value })} />
                  <input value={entryForm.representative_names} placeholder="대표A / 대표B" onChange={e => setEntryForm({ ...entryForm, representative_names: e.target.value })} />
                  <input value={entryForm.staff_names} placeholder="직원1 / 직원2" onChange={e => setEntryForm({ ...entryForm, staff_names: e.target.value })} />
                  <input value={entryForm.memo} placeholder="기타 메모" onChange={e => setEntryForm({ ...entryForm, memo: e.target.value })} />
                </div>
                <div className="inline-actions wrap">
                  <button>스케줄 저장</button>
                  <button type="button" className="ghost" onClick={closeEntryForm}>닫기</button>
                </div>
              </form>
            )}

            <div className="work-schedule-list unified-list">
              {day.entries.length > 0 && !isBulkEdit && day.entries.map(item => {
                const key = rowKey(day.date, item)
                const isEditing = editingKey === key
                return (
                  <div key={key} className="work-schedule-line-item">
                    <div className="work-schedule-line-head">
                      <div className="work-schedule-line-text" title={formatSummary(item)}>{formatSummary(item)}</div>
                      {!readOnly && <button type="button" className="small ghost" onClick={() => openRowEdit(day.date, item)}>편집</button>}
                    </div>
                    {isEditing && !readOnly && (
                      <form onSubmit={submitRowEdit} className="work-schedule-inline-editor">
                        <div className="work-schedule-inline-grid">
                          <input value={editingForm.schedule_time} placeholder="09:00" onChange={e => setEditingForm({ ...editingForm, schedule_time: normalizeScheduleTimeInput(e.target.value, e.target.value) })} />
                          <input value={editingForm.customer_name} placeholder="고객명" onChange={e => setEditingForm({ ...editingForm, customer_name: e.target.value })} />
                          <input value={editingForm.representative_names} placeholder="대표자" onChange={e => setEditingForm({ ...editingForm, representative_names: e.target.value })} />
                          <input value={editingForm.staff_names} placeholder="직원" onChange={e => setEditingForm({ ...editingForm, staff_names: e.target.value })} />
                          <input value={editingForm.memo} placeholder="메모" onChange={e => setEditingForm({ ...editingForm, memo: e.target.value })} className="schedule-inline-memo" />
                        </div>
                        <div className="inline-actions wrap end">
                          <button type="submit">저장</button>
                          <button type="button" className="ghost" onClick={closeRowEdit}>취소</button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}

              {day.entries.length > 0 && isBulkEdit && (
                <form onSubmit={e => { e.preventDefault(); submitBulkEdit(day.date) }} className="work-schedule-bulk-editor">
                  {dayBulkForms.map((form, index) => (
                    <div key={`${day.date}-bulk-${form.id}-${index}`} className="work-schedule-inline-editor bulk-row">
                      <div className="work-schedule-inline-grid">
                        <input value={form.schedule_time} placeholder="09:00" onChange={e => updateBulkForm(day.date, index, 'schedule_time', normalizeScheduleTimeInput(e.target.value, e.target.value))} />
                        <input value={form.customer_name} placeholder="고객명" onChange={e => updateBulkForm(day.date, index, 'customer_name', e.target.value)} />
                        <input value={form.representative_names} placeholder="대표자" onChange={e => updateBulkForm(day.date, index, 'representative_names', e.target.value)} />
                        <input value={form.staff_names} placeholder="직원" onChange={e => updateBulkForm(day.date, index, 'staff_names', e.target.value)} />
                        <input value={form.memo} placeholder="메모" onChange={e => updateBulkForm(day.date, index, 'memo', e.target.value)} className="schedule-inline-memo" />
                      </div>
                    </div>
                  ))}
                  <div className="inline-actions wrap end">
                    <button type="submit">전체 저장</button>
                    <button type="button" className="ghost" onClick={() => setBulkEditDate('')}>닫기</button>
                  </div>
                </form>
              )}

              {day.entries.length === 0 && <div className="muted">등록된 스케줄이 없습니다.</div>}
            </div>

            {activeNoteDate === day.date && !readOnly && (
              <form onSubmit={submitNotes} className="work-notes-form">
                <div className="stack compact-gap">
                  <label>열외자 목록 - 사업자</label>
                  <div className="work-excluded-business-grid">
                    {noteForm.excluded_business_slots.map((slot, index) => (
                      <select key={`${day.date}-business-${index}`} value={slot} onChange={e => {
                        const next = [...noteForm.excluded_business_slots]
                        next[index] = e.target.value
                        setNoteForm({ ...noteForm, excluded_business_slots: next })
                      }}>
                        <option value="">선택 안 함</option>
                        {BRANCH_NUMBER_OPTIONS.map(num => (
                          <option key={num} value={String(num)} disabled={noteForm.excluded_business_slots.some((selected, slotIndex) => slotIndex !== index && selected === String(num))}>{num}호점</option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>
                <div className="stack compact-gap">
                  <label>열외자 목록 - 직원</label>
                  <textarea value={noteForm.excluded_staff} placeholder="직원명-사유 / 직원명-사유" onChange={e => setNoteForm({ ...noteForm, excluded_staff: e.target.value })} />
                </div>
                <div className="inline-actions wrap">
                  <button>열외자 저장</button>
                  <button type="button" className="ghost" onClick={closeNotes}>닫기</button>
                </div>
              </form>
            )}

            <div className="work-schedule-exclusion">
              <div className="work-schedule-exclusion-title">- 열외자 목록</div>
              <div className="muted">* 사업자({businessCount}) : {businessCount ? day.excluded_business_names.join(' / ') : '-'}</div>
              <div className="muted">* 직원({staffCount}) : {staffCount ? day.excluded_staff_names.join(' / ') : '-'}</div>
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
  const [visitTimeText, setVisitTimeText] = useState('')
  const [startTimeText, setStartTimeText] = useState('')
  const [endTimeText, setEndTimeText] = useState('')
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
    start_address: '',
    end_address: '',
    platform: PLATFORM_OPTIONS[0],
    customer_name: '',
    department_info: DEFAULT_DEPARTMENT_OPTIONS[0],
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
  })

  useEffect(() => {
    if (mode !== 'edit') {
      setForm(prev => ({
        ...prev,
        event_date: presetDate,
        move_start_date: prev.move_start_date || presetDate,
        move_end_date: prev.move_end_date || presetDate,
      }))
      setVisitTimeText(prev => prev || '')
      return
    }
    async function loadDetail() {
      setLoading(true)
      setError('')
      try {
        const data = await api(`/api/calendar/events/${eventId}`)
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
          start_address: data.start_address || data.location || '',
          end_address: data.end_address || '',
          platform: data.platform || PLATFORM_OPTIONS[0],
          customer_name: data.customer_name || '',
          department_info: data.department_info || DEFAULT_DEPARTMENT_OPTIONS[0],
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
        })
        setPreview(data.image_data || '')
        setVisitTimeText(data.visit_time && data.visit_time !== '미정' ? data.visit_time : '')
        setStartTimeText(data.start_time && data.start_time !== '미정' ? data.start_time : '')
        setEndTimeText(data.end_time && data.end_time !== '미정' ? data.end_time : '')
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [mode, eventId, presetDate])

  useEffect(() => {
    setForm(prev => ({ ...prev, title: buildScheduleTitle(prev) }))
  }, [form.visit_time, form.platform, form.customer_name, form.amount1])

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
    if (form.end_time === '미정') {
      setEndTimeText('')
      return
    }
    setEndTimeText(form.end_time || '')
  }, [form.end_time])

  function commitVisitTimeInput(rawValue) {
    const normalized = normalizeScheduleTimeInput(rawValue, form.visit_time === '미정' ? '' : form.visit_time)
    if (normalized === '미정') {
      setForm(prev => ({ ...prev, visit_time: '미정' }))
      setVisitTimeText('')
      return normalized
    }
    if (!normalized) {
      setForm(prev => ({ ...prev, visit_time: '미정' }))
      setVisitTimeText('')
      return ''
    }
    setForm(prev => ({ ...prev, visit_time: normalized }))
    setVisitTimeText(normalized)
    return normalized
  }


  function commitGenericTimeInput(field, rawValue, currentValue, setText) {
    const normalized = normalizeScheduleTimeInput(rawValue, currentValue === '미정' ? '' : currentValue)
    if (normalized === '미정') {
      setForm(prev => ({ ...prev, [field]: '미정' }))
      setText('')
      return normalized
    }
    if (!normalized) {
      setForm(prev => ({ ...prev, [field]: '미정' }))
      setText('')
      return ''
    }
    setForm(prev => ({ ...prev, [field]: normalized }))
    setText(normalized)
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

  async function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) {
      setPreview('')
      setForm(prev => ({ ...prev, image_data: '' }))
      return
    }
    setUploadingImage(true)
    setError('')
    try {
      const uploaded = await uploadFile(file, 'schedule')
      setPreview(uploaded.url)
      setForm(prev => ({ ...prev, image_data: uploaded.url }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingImage(false)
      e.target.value = ''
    }
  }

  function changeTimeField(field, value) {
    const normalized = normalizeScheduleTimeInput(value, value)
    setForm(prev => ({ ...prev, [field]: normalized }))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    const payload = {
      ...form,
      title: buildScheduleTitle(form),
      event_date: form.move_start_date || presetDate,
      move_start_date: form.move_start_date || presetDate,
      move_end_date: form.move_end_date || form.move_start_date || presetDate,
      location: form.start_address || '',
      amount2: '',
      amount_item: '',
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

  const titlePreview = buildScheduleTitle(form)

  if (loading) return <div className="card">불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card schedule-editor-card">
        <form onSubmit={submit} className="stack schedule-editor-form">
          <div className="schedule-form-topbar">
            <button
              type="button"
              className="ghost small icon-only"
              aria-label={mode === 'edit' ? '상세로 돌아가기' : '달력으로 돌아가기'}
              onClick={() => navigate(mode === 'edit' ? `/schedule/${eventId}` : '/schedule')}
            >
              ←
            </button>
            <button type="submit" className="small schedule-save-button top-save-button">일정 저장</button>
          </div>
          <div className="stack compact-gap">
            <label>일정 제목</label>
            <input value={titlePreview} placeholder="자동 생성 제목" readOnly className="readonly-input" />
          </div>
          <div className="schedule-form-grid-2 visit-platform-row">
            <div className="stack compact-gap">
              <label>출발지 이사방문시각</label>
              <div className="inline-actions visit-time-actions">
                <input
                  ref={visitTimeInputRef}
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={visitTimeText}
                  onChange={e => setVisitTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleVisitTimeBlur}
                  onKeyDown={handleVisitTimeKeyDown}
                />
                <button type="button" tabIndex={-1} className={form.visit_time === '미정' ? 'ghost small active-icon mobile-visit-undecided' : 'ghost small mobile-visit-undecided'} onClick={() => changeTimeField('visit_time', form.visit_time === '미정' ? '09:00' : '미정')}>미정</button>
              </div>
            </div>
            <div className="stack compact-gap platform-select-field">
              <label>플랫폼</label>
              <select
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
          </div>
          <div className="schedule-form-grid-2">
            <div className="stack compact-gap">
              <label>고객성함</label>
              <input ref={customerNameInputRef} value={form.customer_name} placeholder="고객 성함" onChange={e => setForm({ ...form, customer_name: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(amountInputRef) } }} />
            </div>
            <div className="stack compact-gap">
              <label>이사금액</label>
              <input ref={amountInputRef} inputMode="numeric" value={form.amount1} placeholder="예: 150000" onChange={e => setForm({ ...form, amount1: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(depositMethodSelectRef) } }} />
            </div>
          </div>
          <div className="schedule-form-grid-2">
            <div className="stack compact-gap">
              <label>계약입금방법</label>
              <select ref={depositMethodSelectRef} value={form.deposit_method} onChange={e => setForm({ ...form, deposit_method: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(depositAmountSelectRef) } }}>
                {DEPOSIT_METHOD_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="stack compact-gap">
              <label>계약입금금액</label>
              <select ref={depositAmountSelectRef} value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: e.target.value })}>
                {DEPOSIT_AMOUNT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>
          <div className="memo-side-layout">
            <div className="stack compact-gap memo-main-field">
              <label>일정 메모</label>
              <textarea value={form.content} placeholder="일정 메모" onChange={e => setForm({ ...form, content: e.target.value })} className="schedule-memo-box" />
            </div>
            <div className="memo-side-controls">
              <div className="stack compact-gap memo-side-control upload-control-field">
                <label>사진파일첨부</label>
                <div className="schedule-upload-row compact-upload-row">
                  <label className={`icon-upload-trigger${uploadingImage ? ' disabled' : ''}`}>
                    <input type="file" accept="image/*" onChange={handleImageChange} disabled={uploadingImage} className="visually-hidden" />
                    <span className="icon-upload-symbol" aria-hidden="true">📎</span>
                    <span className="sr-only">사진파일첨부</span>
                  </label>
                  {uploadingImage && <div className="muted upload-status-text">업로드 중...</div>}
                  {preview && (
                    <div className="image-preview-wrap compact-image-preview">
                      <img src={preview} alt="일정 첨부 미리보기" className="image-preview" />
                    </div>
                  )}
                </div>
              </div>
              <div className="stack compact-gap memo-side-control">
                <label>담당부서/인원</label>
                <select value={form.department_info} onChange={e => setForm({ ...form, department_info: e.target.value })}>
                  {DEFAULT_DEPARTMENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="stack compact-gap memo-side-control form-field-inline color-control-field">
                <label>표시색상</label>
                <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="schedule-date-time-row">
            <div className="stack compact-gap schedule-date-field">
              <label>이사시작일</label>
              <input type="date" value={form.move_start_date} onChange={e => setForm({ ...form, move_start_date: e.target.value, event_date: e.target.value })} />
            </div>
            <div className="schedule-date-time-fields">
              <div className="stack compact-gap schedule-time-field">
                <label>이사시작시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={startTimeText}
                    onChange={e => setStartTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleStartTimeBlur}
                  />
                  <button type="button" className={form.start_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('start_time', form.start_time === '미정' ? '09:00' : '미정')}>미정</button>
                </div>
              </div>
              <div className="stack compact-gap schedule-time-field">
                <label>이사종료예상시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={endTimeText}
                    onChange={e => setEndTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleEndTimeBlur}
                  />
                  <button type="button" className={form.end_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('end_time', form.end_time === '미정' ? '10:00' : '미정')}>미정</button>
                </div>
              </div>
            </div>
          </div>
          <div className="schedule-date-time-row">
            <div className="stack compact-gap schedule-date-field">
              <label>이사종료일</label>
              <input type="date" value={form.move_end_date} onChange={e => setForm({ ...form, move_end_date: e.target.value })} />
            </div>
            <div className="schedule-date-time-fields">
              <div className="stack compact-gap schedule-time-field">
                <label>이사시작시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={startTimeText}
                    onChange={e => setStartTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleStartTimeBlur}
                  />
                  <button type="button" className={form.start_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('start_time', form.start_time === '미정' ? '09:00' : '미정')}>미정</button>
                </div>
              </div>
              <div className="stack compact-gap schedule-time-field">
                <label>이사종료예상시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={endTimeText}
                    onChange={e => setEndTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleEndTimeBlur}
                  />
                  <button type="button" className={form.end_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('end_time', form.end_time === '미정' ? '10:00' : '미정')}>미정</button>
                </div>
              </div>
            </div>
          </div>
          <div className="stack compact-gap">
            <input value={form.start_address} placeholder="출발지 상세주소" onChange={e => setForm({ ...form, start_address: e.target.value, location: e.target.value })} />
          </div>
          <div className="stack compact-gap">
            <input value={form.end_address} placeholder="도착지 상세주소" onChange={e => setForm({ ...form, end_address: e.target.value })} />
          </div>
          <div className="schedule-form-grid-3">
            <div className="stack compact-gap">
              <label>담당대표1</label>
              <input value={form.representative1} onChange={e => setForm({ ...form, representative1: e.target.value })} />
            </div>
            <div className="stack compact-gap">
              <label>담당대표2</label>
              <input value={form.representative2} onChange={e => setForm({ ...form, representative2: e.target.value })} />
            </div>
            <div className="stack compact-gap">
              <label>담당대표3</label>
              <input value={form.representative3} onChange={e => setForm({ ...form, representative3: e.target.value })} />
            </div>
          </div>
          <div className="schedule-form-grid-3">
            <div className="stack compact-gap">
              <label>담당직원1</label>
              <input value={form.staff1} onChange={e => setForm({ ...form, staff1: e.target.value })} />
            </div>
            <div className="stack compact-gap">
              <label>담당직원2</label>
              <input value={form.staff2} onChange={e => setForm({ ...form, staff2: e.target.value })} />
            </div>
            <div className="stack compact-gap">
              <label>담당직원3</label>
              <input value={form.staff3} onChange={e => setForm({ ...form, staff3: e.target.value })} />
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="schedule-form-footer">
            <button type="submit" className="small schedule-save-button">일정 저장</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ScheduleDetailPage() {
  const navigate = useNavigate()
  const { eventId } = useParams()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await api(`/api/calendar/events/${eventId}`)
        setItem(data)
      } catch (err) {
        setError(err.message)
      }
    }
    load()
  }, [eventId])

  if (error) return <div className="card error">{error}</div>
  if (!item) return <div className="card">불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card">
        <div className="between schedule-detail-topbar">
          <button type="button" className="ghost small" onClick={() => navigate(`/schedule?date=${item.event_date}`)}>일정으로 돌아가기</button>
          <div className="dropdown-wrap">
            <button type="button" className="ghost small" onClick={() => setMenuOpen(v => !v)}>설정</button>
            {menuOpen && (
              <div className="dropdown-menu right">
                <button type="button" className="dropdown-item" onClick={() => navigate(`/schedule/${item.id}/edit`)}>일정수정</button>
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="stack compact-gap">
            <h2>{item.title}</h2>
            <div className="muted">[{item.department_info || '미지정'}] / [{item.created_by_nickname || '작성자'}]</div>
          </div>
          <div className="detail-meta-grid">
            <div className="stat"><span>플랫폼</span><strong>{item.platform || '-'}</strong></div>
            <div className="stat"><span>고객성함</span><strong>{item.customer_name || '-'}</strong></div>
            <div className="stat"><span>출발지 이사방문시각</span><strong>{item.visit_time || '-'}</strong></div>
            <div className="stat"><span>이사시간</span><strong>{eventTimeLine(item)}</strong></div>
          </div>
          <div className="list-item block">
            <div><strong>이사시작일 상세주소</strong></div>
            <div>{item.start_address || item.location || '-'}</div>
          </div>
          <div className="list-item block">
            <div><strong>이사종료일 상세주소</strong></div>
            <div>{item.end_address || '-'}</div>
          </div>
          <div className="detail-meta-grid">
            <div className="stat"><span>이사 시작일</span><strong>{item.move_start_date || '-'}</strong></div>
            <div className="stat"><span>이사 종료일</span><strong>{item.move_end_date || '-'}</strong></div>
            <div className="stat"><span>이사금액</span><strong>{formatMoneyDisplay(item.amount1) || '-'}</strong></div>
            <div className="stat"><span>계약입금</span><strong>{[item.deposit_method, item.deposit_amount].filter(Boolean).join(' / ') || '-'}</strong></div>
          </div>
          <div className="list-item block">
            <div><strong>메모</strong></div>
            <div>{item.content || '등록된 메모가 없습니다.'}</div>
          </div>
          <div className="detail-meta-grid">
            <div className="stat"><span>담당대표1</span><strong>{item.representative1 || '-'}</strong></div>
            <div className="stat"><span>담당대표2</span><strong>{item.representative2 || '-'}</strong></div>
            <div className="stat"><span>담당대표3</span><strong>{item.representative3 || '-'}</strong></div>
            <div className="stat"><span>담당직원1</span><strong>{item.staff1 || '-'}</strong></div>
            <div className="stat"><span>담당직원2</span><strong>{item.staff2 || '-'}</strong></div>
            <div className="stat"><span>담당직원3</span><strong>{item.staff3 || '-'}</strong></div>
          </div>
          {item.image_data && (
            <div className="image-preview-wrap">
              <img src={item.image_data} alt="일정 첨부" className="image-preview" />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function NotificationsPage() {
  const [items, setItems] = useState([])
  const [likes, setLikes] = useState([])
  useEffect(() => {
    Promise.all([api('/api/notifications'), api('/api/feed-like-notifications')]).then(([n, l]) => {
      setItems(n)
      setLikes(l)
    })
  }, [])
  return (
    <div className="grid2">
      <section className="card">
        <h2>일반 알림</h2>
        <div className="list">
          {items.map(item => (
            <div key={item.id} className="list-item block">
              <strong>{item.title}</strong>
              <div>{item.body}</div>
            </div>
          ))}
          {items.length === 0 && <div className="muted">알림이 없습니다.</div>}
        </div>
      </section>
      <section className="card">
        <h2>추가 알림</h2>
        <div className="list">
          {likes.map(item => (
            <div key={item.id} className="list-item block">
              <strong>{item.title}</strong>
              <div>{item.body}</div>
            </div>
          ))}
          {likes.length === 0 && <div className="muted">좋아요 알림이 없습니다.</div>}
        </div>
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
  async function load() {
    const [p, b] = await Promise.all([api('/api/preferences'), api('/api/blocked-users')])
    setPrefs(p)
    setBlocks(b)
  }
  useEffect(() => { load() }, [])
  async function savePrefs() {
    await api('/api/preferences', { method: 'POST', body: JSON.stringify({ data: prefs }) })
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
    <div className="grid2">
      <section className="card">
        <h2>환경설정</h2>
        <label className="check"><input type="checkbox" checked={!!prefs.groupChatNotifications} onChange={e => setPrefs({ ...prefs, groupChatNotifications: e.target.checked })} /> 그룹채팅 알림</label>
        <label className="check"><input type="checkbox" checked={!!prefs.directChatNotifications} onChange={e => setPrefs({ ...prefs, directChatNotifications: e.target.checked })} /> 1:1 채팅 알림</label>
        <label className="check"><input type="checkbox" checked={!!prefs.likeNotifications} onChange={e => setPrefs({ ...prefs, likeNotifications: e.target.checked })} /> 좋아요 알림</label>
        <div className="inline-actions wrap">
          <button onClick={savePrefs}>설정 저장</button>
          <button type="button" className="danger" onClick={deleteAccount} disabled={deleting}>{deleting ? '삭제 중...' : '계정삭제'}</button>
        </div>
        <div className="muted small-text">계정삭제시 관련 정보가 삭제됩니다. 삭제 후에는 복구할 수 없습니다.</div>
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
      <section className="card">
        <h2>문의 접수</h2>
        <form onSubmit={submitInquiry} className="stack">
          <input value={inquiry.category} placeholder="문의 분류" onChange={e => setInquiry({ ...inquiry, category: e.target.value })} />
          <input value={inquiry.title} placeholder="문의 제목" onChange={e => setInquiry({ ...inquiry, title: e.target.value })} />
          <textarea value={inquiry.content} placeholder="문의 내용" onChange={e => setInquiry({ ...inquiry, content: e.target.value })} />
          <button>문의 등록</button>
        </form>
        {message && <div className="success">{message}</div>}
      </section>
    </div>
  )
}

function AdminModePage() {
  const currentUser = getStoredUser()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [accountCreateOpen, setAccountCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    email: '', password: '', nickname: '', gender: '', birth_year: 1995, region: '서울', phone: '', recovery_email: '', vehicle_number: '', branch_no: '', grade: 6, approved: true,
  })
  const [configForm, setConfigForm] = useState({
    total_vehicle_count: '',
    branch_count_override: '',
    admin_mode_access_grade: 1,
    role_assign_actor_max_grade: 3,
    role_assign_target_min_grade: 3,
    account_suspend_actor_max_grade: 3,
    account_suspend_target_min_grade: 3,
    signup_approve_actor_max_grade: 3,
    signup_approve_target_min_grade: 7,
  })
  const [accountRows, setAccountRows] = useState([])
  const [branchRows, setBranchRows] = useState([])
  const [employeeRows, setEmployeeRows] = useState([])
  const [branchOpen, setBranchOpen] = useState({})
  const [employeeOpen, setEmployeeOpen] = useState({})
  const [branchEditMode, setBranchEditMode] = useState(false)
  const [employeeEditMode, setEmployeeEditMode] = useState(false)
  const [accountPage, setAccountPage] = useState(1)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const ACCOUNTS_PER_PAGE = 8

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api('/api/admin-mode')
      setData(response)
      setConfigForm({
        total_vehicle_count: String(response.config?.total_vehicle_count || ''),
        branch_count_override: String(response.config?.branch_count_override || response.branch_count || ''),
        ...response.permission_config,
      })
      setAccountRows((response.accounts || []).map(item => ({ ...item })))
      setBranchRows((response.branches || []).map(item => ({ ...item })))
      setEmployeeRows((response.employees || []).map(item => ({ ...item })))
      setAccountPage(1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function saveConfig() {
    await api('/api/admin-mode/config', {
      method: 'POST',
      body: JSON.stringify(configForm),
    })
    const storedUser = getStoredUser()
    if (storedUser) {
      const nextUser = { ...storedUser, permission_config: { ...(storedUser.permission_config || {}), ...configForm } }
      localStorage.setItem('icj_user', JSON.stringify(nextUser))
    }
    setMessage('관리자모드 설정이 저장되었습니다.')
    await load()
  }

  async function saveAccounts() {
    await api('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({ accounts: accountRows.map(({ id, grade, approved }) => ({ id, grade: Number(grade), approved })) }),
    })
    setMessage('계정 권한 정보가 저장되었습니다.')
    await load()
  }

  async function saveBranchDetails() {
    await api('/api/admin-mode/config', {
      method: 'POST',
      body: JSON.stringify(configForm),
    })
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: branchRows.map(row => ({
        id: row.id,
        nickname: row.nickname || '',
        phone: row.phone || '',
        vehicle_number: row.vehicle_number || '',
        branch_no: row.branch_no || null,
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
        email: row.email || '',
        google_email: row.google_email || '',
        resident_id: row.resident_id || '',
      })) }),
    })
    setMessage('가맹현황 정보가 저장되었습니다.')
    setBranchEditMode(false)
    await load()
  }

  async function saveEmployeeDetails() {
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: employeeRows.map(row => ({
        id: row.id,
        nickname: row.nickname || '',
        phone: row.phone || '',
        vehicle_number: row.vehicle_number || '',
        branch_no: row.branch_no || null,
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
        email: row.email || '',
        google_email: row.google_email || '',
        resident_id: row.resident_id || '',
      })) }),
    })
    setMessage('직원현황 정보가 저장되었습니다.')
    setEmployeeEditMode(false)
    await load()
  }
  async function submitCreateAccount(e) {
    e.preventDefault()
    await api('/api/admin/accounts/create', {
      method: 'POST',
      body: JSON.stringify({
        ...createForm,
        birth_year: Number(createForm.birth_year || 1995),
        branch_no: createForm.branch_no ? Number(createForm.branch_no) : null,
        grade: Number(createForm.grade || 6),
        approved: !!createForm.approved,
      }),
    })
    setMessage('계정이 생성되었습니다.')
    setAccountCreateOpen(false)
    setCreateForm({ email: '', password: '', nickname: '', gender: '', birth_year: 1995, region: '서울', phone: '', recovery_email: '', vehicle_number: '', branch_no: '', grade: 6, approved: true })
    await load()
  }


  function updateAccountRow(userId, patch) {
    setAccountRows(prev => prev.map(item => item.id === userId ? { ...item, ...patch } : item))
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

  function toggleEmployee(id) {
    setEmployeeOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const pagedAccounts = useMemo(() => {
    const start = (accountPage - 1) * ACCOUNTS_PER_PAGE
    return accountRows.slice(start, start + ACCOUNTS_PER_PAGE)
  }, [accountRows, accountPage])

  const pageCount = Math.max(1, Math.ceil(accountRows.length / ACCOUNTS_PER_PAGE))

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return accountRows.filter(item => `${item.nickname} ${item.email}`.toLowerCase().includes(q))
  }, [accountRows, searchQuery])

  const actorGrade = Number(currentUser?.grade || 6)
  const actorRoleLimit = Number(configForm.role_assign_actor_max_grade || 1)
  const targetRoleFloor = Number(configForm.role_assign_target_min_grade || 7)

  function canEditAccountGrade(targetUserId, targetCurrentGrade, nextGrade) {
    if (actorGrade === 1) return true
    if (actorGrade > actorRoleLimit) return false
    const safeCurrentGrade = Number(targetCurrentGrade || 6)
    const safeNextGrade = Number(nextGrade || 6)
    if (actorGrade >= safeCurrentGrade) return false
    if (safeCurrentGrade < targetRoleFloor) return false
    if (safeNextGrade < targetRoleFloor) return false
    if (safeNextGrade <= actorGrade) return false
    return true
  }

  function roleOptionsForTarget(target) {
    return ROLE_OPTIONS.map(option => ({
      ...option,
      disabled: !canEditAccountGrade(target.id, target.grade, option.value),
    }))
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

  if (loading) return <div className="card">관리자 정보를 불러오는 중...</div>
  if (error) return <div className="card error">{error}</div>
  if (!data) return null

  return (
    <div className="admin-mode-page stack-page">
      {message && <div className="success">{message}</div>}

      {Number(currentUser?.grade || 6) === 1 && (
        <section className="card admin-mode-card">
          <div className="between admin-mode-section-head">
            <h2>계정추가</h2>
            <div className="inline-actions wrap">
              <button type="button" className={accountCreateOpen ? 'small ghost' : 'small ghost'} onClick={() => setAccountCreateOpen(v => !v)}>{accountCreateOpen ? '접기' : '펼치기'}</button>
              <button type="submit" form="admin-create-account-form" className="small">계정생성</button>
            </div>
          </div>
          {accountCreateOpen && (
            <form id="admin-create-account-form" onSubmit={submitCreateAccount} className="stack">
              <div className="admin-inline-grid compact-inline-grid">
                <label>이메일 <input value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} /></label>
                <label>비밀번호 <input type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} /></label>
                <label>닉네임 <input value={createForm.nickname} onChange={e => setCreateForm({ ...createForm, nickname: e.target.value })} /></label>
                <label>성별 <input value={createForm.gender} onChange={e => setCreateForm({ ...createForm, gender: e.target.value })} /></label>
                <label>출생연도 <input value={createForm.birth_year} onChange={e => setCreateForm({ ...createForm, birth_year: e.target.value })} /></label>
                <label>지역 <input value={createForm.region} onChange={e => setCreateForm({ ...createForm, region: e.target.value })} /></label>
                <label>연락처 <input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} /></label>
                <label>복구이메일 <input value={createForm.recovery_email} onChange={e => setCreateForm({ ...createForm, recovery_email: e.target.value })} /></label>
                <label>차량번호 <input value={createForm.vehicle_number} onChange={e => setCreateForm({ ...createForm, vehicle_number: e.target.value })} /></label>
                <label>호점
                  <select value={createForm.branch_no} onChange={e => setCreateForm({ ...createForm, branch_no: e.target.value })}>
                    <option value="">선택 안 함</option>
                    {BRANCH_NUMBER_OPTIONS.map(num => <option key={num} value={num}>{num}호점</option>)}
                  </select>
                </label>
                <label>권한등급
                  <select value={Number(createForm.grade)} onChange={e => setCreateForm({ ...createForm, grade: Number(e.target.value) })}>
                    {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                  </select>
                </label>
                <label className="check"><input type="checkbox" checked={!!createForm.approved} onChange={e => setCreateForm({ ...createForm, approved: e.target.checked })} /> 승인됨</label>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head">
          <h2>가맹현황</h2>
          <div className="inline-actions wrap">
            <button type="button" className={branchEditMode ? 'small' : 'small ghost'} onClick={() => setBranchEditMode(v => !v)}>편집</button>
            {renderActionButton('가맹현황', '정보저장', saveBranchDetails)}
          </div>
        </div>
        <div className="admin-inline-grid compact-inline-grid">
          <label>총차량 대수 <input value={configForm.total_vehicle_count} onChange={e => setConfigForm({ ...configForm, total_vehicle_count: e.target.value })} /></label>
          <label>호점현황수 <input value={configForm.branch_count_override} onChange={e => setConfigForm({ ...configForm, branch_count_override: e.target.value })} /></label>
        </div>
        <div className="admin-subtitle">호점현황/상세정보</div>
        <div className="admin-detail-list">
          {branchRows.map(item => (
            <div key={item.id} className="admin-nested-item">
              <button type="button" className="admin-primary-row" onClick={() => toggleBranch(item.id)}>
                {String(item.branch_no || '').padStart(2, '0')}호점 / {item.nickname || '-'} / {item.phone || '-'} / {item.vehicle_number || '-'}
              </button>
              {branchOpen[item.id] && (
                <div className="admin-secondary-panel">
                  {branchEditMode ? (
                    <>
                      <label>대표자이름 <input value={item.nickname || ''} onChange={e => updateBranchRow(item.id, { nickname: e.target.value })} /></label>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>연락처 <input value={item.phone || ''} onChange={e => updateBranchRow(item.id, { phone: e.target.value })} /></label>
                        <label>차량번호 <input value={item.vehicle_number || ''} onChange={e => updateBranchRow(item.id, { vehicle_number: e.target.value })} /></label>
                      </div>
                      <label>거주지주소 <input value={item.resident_address || ''} onChange={e => updateBranchRow(item.id, { resident_address: e.target.value })} /></label>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>사업자명 <input value={item.business_name || ''} onChange={e => updateBranchRow(item.id, { business_name: e.target.value })} /></label>
                        <label>사업자번호 <input value={item.business_number || ''} onChange={e => updateBranchRow(item.id, { business_number: e.target.value })} /></label>
                      </div>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>업태 <input value={item.business_type || ''} onChange={e => updateBranchRow(item.id, { business_type: e.target.value })} /></label>
                        <label>종목 <input value={item.business_item || ''} onChange={e => updateBranchRow(item.id, { business_item: e.target.value })} /></label>
                      </div>
                      <label>사업장주소 <input value={item.business_address || ''} onChange={e => updateBranchRow(item.id, { business_address: e.target.value })} /></label>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>계좌번호 <input value={item.bank_account || ''} onChange={e => updateBranchRow(item.id, { bank_account: e.target.value })} /></label>
                        <label>은행 <input value={item.bank_name || ''} onChange={e => updateBranchRow(item.id, { bank_name: e.target.value })} /></label>
                      </div>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>주이메일 <input value={item.email || ''} onChange={e => updateBranchRow(item.id, { email: e.target.value })} /></label>
                        <label>구글이메일 <input value={item.google_email || ''} onChange={e => updateBranchRow(item.id, { google_email: e.target.value })} /></label>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>{item.resident_address || '거주지주소 미입력'}</div>
                      <div>{item.business_name || '-'} / {item.business_number || '-'} / {item.business_type || '-'} / {item.business_item || '-'}</div>
                      <div>{item.business_address || '사업장주소 미입력'}</div>
                      <div>{item.bank_account || '-'} / {item.bank_name || '-'} / {item.email || '-'}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head">
          <h2>직원현황</h2>
          <div className="inline-actions wrap">
            <button type="button" className={employeeEditMode ? 'small' : 'small ghost'} onClick={() => setEmployeeEditMode(v => !v)}>편집</button>
            {renderActionButton('직원현황', '정보저장', saveEmployeeDetails)}
          </div>
        </div>
        <div className="admin-inline-grid compact-inline-grid">
          <label>직원현황수 <input value={String(employeeRows.length || 0)} readOnly /></label>
        </div>
        <div className="admin-subtitle">직원현황/상세정보</div>
        <div className="admin-detail-list">
          {employeeRows.map(item => (
            <div key={item.id} className="admin-nested-item">
              <button type="button" className="admin-primary-row" onClick={() => toggleEmployee(item.id)}>
                {item.nickname || '-'} / {item.phone || '-'} / {item.resident_id || '-'} / {item.marital_status || '-'}
              </button>
              {employeeOpen[item.id] && (
                <div className="admin-secondary-panel">
                  {employeeEditMode ? (
                    <>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>직원이름 <input value={item.nickname || ''} onChange={e => updateEmployeeRow(item.id, { nickname: e.target.value })} /></label>
                        <label>연락처 <input value={item.phone || ''} onChange={e => updateEmployeeRow(item.id, { phone: e.target.value })} /></label>
                      </div>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>주민번호 <input value={item.resident_id || ''} onChange={e => updateEmployeeRow(item.id, { resident_id: e.target.value })} /></label>
                        <label>결혼여부 <input value={item.marital_status || ''} onChange={e => updateEmployeeRow(item.id, { marital_status: e.target.value })} /></label>
                      </div>
                      <label>거주지주소 <input value={item.resident_address || ''} onChange={e => updateEmployeeRow(item.id, { resident_address: e.target.value })} /></label>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>계좌번호 <input value={item.bank_account || ''} onChange={e => updateEmployeeRow(item.id, { bank_account: e.target.value })} /></label>
                        <label>은행명 <input value={item.bank_name || ''} onChange={e => updateEmployeeRow(item.id, { bank_name: e.target.value })} /></label>
                      </div>
                      <div className="admin-inline-grid compact-inline-grid">
                        <label>MBTI <input value={item.mbti || ''} onChange={e => updateEmployeeRow(item.id, { mbti: e.target.value })} /></label>
                        <label>주이메일 <input value={item.email || ''} onChange={e => updateEmployeeRow(item.id, { email: e.target.value })} /></label>
                      </div>
                      <label>구글이메일 <input value={item.google_email || ''} onChange={e => updateEmployeeRow(item.id, { google_email: e.target.value })} /></label>
                    </>
                  ) : (
                    <>
                      <div>{item.resident_address || '거주지주소 미입력'}</div>
                      <div>{item.bank_account || '-'} / {item.bank_name || '-'} / {item.mbti || '-'}</div>
                      <div>{item.email || '-'} / {item.google_email || '-'}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head">
          <h2>계정권한</h2>
          <div className="inline-actions wrap">
            {renderActionButton('계정권한', '정보저장', saveAccounts)}
            <button type="button" className="small ghost admin-search-icon" onClick={() => setSearchOpen(true)}>🔍</button>
          </div>
        </div>
        <div className="admin-account-table">
          {pagedAccounts.map(item => (
            <div key={item.id} className="admin-account-grid">
              <div>{item.nickname}</div>
              <div>{item.email}</div>
              <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })}>
                {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="admin-pagination">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(pageNo => (
            <button key={pageNo} type="button" className={accountPage === pageNo ? 'small' : 'small ghost'} onClick={() => setAccountPage(pageNo)}>{pageNo}</button>
          ))}
        </div>
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head">
          <h2>권한별 기능부여</h2>
          <div className="inline-actions wrap">{renderActionButton('기능부여', '정보저장', saveConfig)}</div>
        </div>
        <div className="stack compact-gap">
          <label>관리자모드접근권한
            <select value={Number(configForm.admin_mode_access_grade)} onChange={e => setConfigForm({ ...configForm, admin_mode_access_grade: Number(e.target.value) })}>
              {ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>타계정 권한부여 권한
            <div className="permission-config-row">
              <div className="permission-actor-wrap">
                <select value={Number(configForm.role_assign_actor_max_grade)} onChange={e => setConfigForm({ ...configForm, role_assign_actor_max_grade: Number(e.target.value) })}>
                  {gradeOptionsWithSuffix('').map(item => item)}
                </select>
                <span>가</span>
              </div>
              <select value={Number(configForm.role_assign_target_min_grade)} onChange={e => setConfigForm({ ...configForm, role_assign_target_min_grade: Number(e.target.value) })}>
                {gradeOptionsWithSuffix(' 기능부여').map(item => item)}
              </select>
            </div>
          </label>
          <label>계정정지권한
            <div className="permission-config-row">
              <div className="permission-actor-wrap">
                <select value={Number(configForm.account_suspend_actor_max_grade)} onChange={e => setConfigForm({ ...configForm, account_suspend_actor_max_grade: Number(e.target.value) })}>
                  {gradeOptionsWithSuffix('').map(item => item)}
                </select>
                <span>가</span>
              </div>
              <select value={Number(configForm.account_suspend_target_min_grade)} onChange={e => setConfigForm({ ...configForm, account_suspend_target_min_grade: Number(e.target.value) })}>
                {gradeOptionsWithSuffix(' 정지').map(item => item)}
              </select>
            </div>
          </label>
          <label>회원가입승인권한
            <div className="permission-config-row">
              <div className="permission-actor-wrap">
                <select value={Number(configForm.signup_approve_actor_max_grade)} onChange={e => setConfigForm({ ...configForm, signup_approve_actor_max_grade: Number(e.target.value) })}>
                  {gradeOptionsWithSuffix('').map(item => item)}
                </select>
                <span>가</span>
              </div>
              <select value={Number(configForm.signup_approve_target_min_grade)} onChange={e => setConfigForm({ ...configForm, signup_approve_target_min_grade: Number(e.target.value) })}>
                {gradeOptionsWithSuffix(' 승인').map(item => item)}
              </select>
            </div>
          </label>
        </div>
      </section>

      {searchOpen && (
        <div className="schedule-popup-backdrop" onClick={() => setSearchOpen(false)}>
          <section className="schedule-popup-card admin-search-popup" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>계정권한 검색</strong>
                <div className="muted">닉네임 또는 아이디(이메일)로 검색할 수 있습니다.</div>
              </div>
              <button type="button" className="ghost small" onClick={() => setSearchOpen(false)}>닫기</button>
            </div>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="닉네임 또는 아이디 검색" />
            <div className="admin-account-table admin-search-results">
              {searchResults.map(item => (
                <div key={item.id} className="admin-account-grid">
                  <div>{item.nickname}</div>
                  <div>{item.email}</div>
                  <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })}>
                    {ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              ))}
              {searchQuery.trim() && searchResults.length === 0 && <div className="muted">검색 결과가 없습니다.</div>}
            </div>
          </section>
        </div>
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

export default function App() {
  const [user, setUser] = useState(getStoredUser())
  const navigate = useNavigate()

  useEffect(() => {
    if (!user || !getStoredUser()) return
    api('/api/me').then((res) => {
      if (res?.user) {
        setUser(res.user)
        localStorage.setItem('icj_user', JSON.stringify(res.user))
      }
    }).catch(() => {})
  }, [])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch (_) {}
    clearSession()
    setUser(null)
    navigate('/login')
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage onLogin={setUser} />} />
        <Route path="/signup" element={<SignupPage onLogin={setUser} />} />
        <Route path="/find-account" element={<FindAccountPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Layout user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/chats/direct/:targetUserId" element={<ChatRoomPage roomType="direct" />} />
        <Route path="/chats/group/:roomId" element={<ChatRoomPage roomType="group" />} />
        <Route path="/calendar" element={<Navigate to="/schedule" replace />} />
        <Route path="/schedule" element={<CalendarPage />} />
        <Route path="/schedule/new" element={<ScheduleFormPage mode="create" />} />
        <Route path="/work-schedule" element={<WorkSchedulePage />} />
        <Route path="/schedule/:eventId" element={<ScheduleDetailPage />} />
        <Route path="/schedule/:eventId/edit" element={<ScheduleFormPage mode="edit" />} />
        <Route path="/profile" element={<ProfilePage onUserUpdate={(u) => { setUser(u); localStorage.setItem('icj_user', JSON.stringify(u)) }} />} />
        <Route path="/meetups" element={<MeetupsPage />} />
        <Route path="/boards" element={<BoardsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage onLogout={logout} />} />
        <Route path="/admin-mode" element={canAccessAdminMode(user) ? <AdminModePage /> : <AccessDeniedRedirect />} />
        <Route path="/reports" element={canAccessAdminMode(user) ? <ReportsPage /> : <AccessDeniedRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
