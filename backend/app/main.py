from __future__ import annotations
import json
import logging
import random
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .db import (
    DB_ENGINE,
    DB_LABEL,
    get_conn,
    get_user_by_token,
    grade_label,
    hash_password,
    init_db,
    insert_notification,
    json_loads,
    make_token,
    row_to_dict,
    user_public_dict,
    utcnow,
)
from .settings import settings
from .storage import StorageError, save_upload

EMAIL_DEMO_MODE = settings.email_demo_mode
logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO), format='%(asctime)s %(levelname)s %(name)s %(message)s')
logger = logging.getLogger('icj24app')

app = FastAPI(title="이청잘 앱 API", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class SignupIn(BaseModel):
    email: str
    password: str
    nickname: str
    gender: str = ""
    birth_year: int = 1990
    region: str = "서울"
    phone: str = ""
    recovery_email: str = ""
    vehicle_number: str = ""
    branch_no: Optional[int] = None
class LoginIn(BaseModel):
    email: str
    password: str
class PasswordResetRequestIn(BaseModel):
    recovery_email: str
class PasswordResetConfirmIn(BaseModel):
    recovery_email: str
    code: str
    email: str
    new_password: str
class ProfileIn(BaseModel):
    nickname: str
    region: str = "서울"
    bio: str = ""
    one_liner: str = ""
    interests: list[str] = []
    photo_url: str = ""
    phone: str = ""
    recovery_email: str = ""
    gender: str = ""
    birth_year: int = 1990
    vehicle_number: str = ""
    branch_no: Optional[int] = None
class LocationIn(BaseModel):
    latitude: float
    longitude: float
    region: str = "서울"
class FeedPostIn(BaseModel):
    content: str
    image_url: str = ""
class CommentIn(BaseModel):
    content: str
class FriendRespondIn(BaseModel):
    action: str  # accepted / rejected
class GroupRoomIn(BaseModel):
    title: str
    description: str = ""
    region: str = ""
class MessageIn(BaseModel):
    message: str = ""
    attachment_name: str = ""
    attachment_url: str = ""
    attachment_type: str = ""
    reply_to_id: Optional[int] = None
    mention_user_id: Optional[int] = None
class ChatRoomSettingIn(BaseModel):
    custom_name: str = ""
    pinned: Optional[bool] = None
    favorite: Optional[bool] = None
    muted: Optional[bool] = None
    hidden: Optional[bool] = None
class ChatInviteIn(BaseModel):
    user_id: int
class ReactionIn(BaseModel):
    emoji: str
class VoiceSignalIn(BaseModel):
    payload: dict
class MeetupIn(BaseModel):
    title: str
    place: str
    meetup_date: str
    start_time: str
    end_time: str
    content: str = ""
    cautions: str = ""
    notes: str = ""
class MeetupReviewIn(BaseModel):
    schedule_id: int
    content: str
class BoardPostIn(BaseModel):
    title: str
    content: str
    image_url: str = ""
class CalendarEventIn(BaseModel):
    title: str
    content: str = ""
    event_date: str
    start_time: str
    end_time: str
    location: str = ""
    color: str = "#2563eb"
    move_start_date: str = ""
    move_end_date: str = ""
    platform: str = ""
    customer_name: str = ""
    department_info: str = ""
    amount1: str = ""
    amount2: str = ""
    amount_item: str = ""
    deposit_method: str = ""
    deposit_amount: str = ""
    image_data: str = ""
class WorkScheduleEntryIn(BaseModel):
    schedule_date: str
    schedule_time: str = ""
    customer_name: str = ""
    representative_names: str = ""
    staff_names: str = ""
    memo: str = ""
class WorkScheduleDayNoteIn(BaseModel):
    schedule_date: str
    excluded_business: str = ""
    excluded_staff: str = ""
class AdminModeConfigIn(BaseModel):
    total_vehicle_count: str = ""
    branch_count_override: str = ""
    admin_mode_access_grade: int = 1
    role_assign_actor_max_grade: int = 3
    role_assign_target_min_grade: int = 3
    account_suspend_actor_max_grade: int = 3
    account_suspend_target_min_grade: int = 3
    signup_approve_actor_max_grade: int = 3
    signup_approve_target_min_grade: int = 7
class AdminAccountUpdateIn(BaseModel):
    grade: int = 6
    approved: Optional[bool] = None
    id: Optional[int] = None
class AdminAccountsBulkUpdateIn(BaseModel):
    accounts: list[AdminAccountUpdateIn] = []
class AdminUserDetailIn(BaseModel):
    id: int
    nickname: str = ''
    phone: str = ''
    vehicle_number: str = ''
    branch_no: Optional[int] = None
    marital_status: str = ''
    resident_address: str = ''
    business_name: str = ''
    business_number: str = ''
    business_type: str = ''
    business_item: str = ''
    business_address: str = ''
    bank_account: str = ''
    bank_name: str = ''
    mbti: str = ''
    email: str = ''
    google_email: str = ''
    resident_id: str = ''
class AdminUserDetailsBulkIn(BaseModel):
    users: list[AdminUserDetailIn] = []
class AdminCreateAccountIn(BaseModel):
    email: str
    password: str
    nickname: str
    gender: str = ''
    birth_year: int = 1995
    region: str = '서울'
    phone: str = ''
    recovery_email: str = ''
    vehicle_number: str = ''
    branch_no: Optional[int] = None
    grade: int = 6
    approved: bool = True
class InquiryIn(BaseModel):
    category: str
    title: str
    content: str
class ReportIn(BaseModel):
    reason: str
    detail: str = ""
class BlockIn(BaseModel):
    reason: str = ""
class PreferenceIn(BaseModel):
    data: dict
def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if authorization.startswith("Bearer "):
        return authorization[7:]
    return authorization
GRADE_LABELS = {1: '관리자', 2: '부관리자', 3: '중간관리자', 4: '사업자', 5: '직원', 6: '일반', 7: '기타'}
def _get_admin_setting(conn, key: str, default: str = '') -> str:
    row = conn.execute("SELECT value FROM admin_settings WHERE key = ?", (key,)).fetchone()
    if not row or row['value'] in (None, ''):
        return default
    return str(row['value'])
def _get_permission_config(conn) -> dict:
    return {
        'admin_mode_access_grade': int(_get_admin_setting(conn, 'admin_mode_access_grade', '1') or 1),
        'role_assign_actor_max_grade': int(_get_admin_setting(conn, 'role_assign_actor_max_grade', '3') or 3),
        'role_assign_target_min_grade': int(_get_admin_setting(conn, 'role_assign_target_min_grade', '3') or 3),
        'account_suspend_actor_max_grade': int(_get_admin_setting(conn, 'account_suspend_actor_max_grade', '3') or 3),
        'account_suspend_target_min_grade': int(_get_admin_setting(conn, 'account_suspend_target_min_grade', '3') or 3),
        'signup_approve_actor_max_grade': int(_get_admin_setting(conn, 'signup_approve_actor_max_grade', '3') or 3),
        'signup_approve_target_min_grade': int(_get_admin_setting(conn, 'signup_approve_target_min_grade', '7') or 7),
    }
def _get_admin_total_vehicle_count(conn) -> int:
    raw = _get_admin_setting(conn, 'total_vehicle_count', '')
    if raw.isdigit():
        return int(raw)
    row = conn.execute("SELECT COUNT(*) FROM users WHERE branch_no IS NOT NULL").fetchone()
    return int(row[0] or 0)
def _get_branch_count_override(conn) -> int:
    raw = _get_admin_setting(conn, 'branch_count_override', '')
    if raw.isdigit():
        return int(raw)
    row = conn.execute("SELECT COUNT(*) FROM users WHERE branch_no IS NOT NULL").fetchone()
    return int(row[0] or 0)
def _grade_of(user: dict) -> int:
    return int(user.get('grade') or 6)
def _can_access_admin_mode(user: dict, conn) -> bool:
    return _grade_of(user) <= _get_permission_config(conn)['admin_mode_access_grade']
def _can_manage_grade(actor: dict, target_grade: int, conn) -> bool:
    actor_grade = _grade_of(actor)
    cfg = _get_permission_config(conn)
    return actor_grade <= cfg['role_assign_actor_max_grade'] and target_grade >= cfg['role_assign_target_min_grade'] and actor_grade < target_grade
def _can_actor_apply(actor: dict, actor_key: str, target_key: str, target_grade: int, conn) -> bool:
    actor_grade = _grade_of(actor)
    cfg = _get_permission_config(conn)
    return actor_grade <= int(cfg.get(actor_key, 1)) and target_grade >= int(cfg.get(target_key, 7)) and actor_grade < target_grade
def _require_write_access(user: dict, area: str):
    grade = _grade_of(user)
    if grade >= 7:
        raise HTTPException(status_code=403, detail='현재 권한으로는 사용할 수 없습니다.')
    if grade == 6 and area in {'schedule', 'work_schedule'}:
        raise HTTPException(status_code=403, detail='일반 등급은 해당 기능을 관람만 할 수 있습니다.')
def require_user(authorization: Optional[str] = Header(default=None)):
    token = _bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    with get_conn() as conn:
        user = get_user_by_token(conn, token)
        if not user:
            raise HTTPException(status_code=401, detail="유효하지 않은 세션입니다.")
        return row_to_dict(user)
def require_admin(user=Depends(require_user)):
    if _grade_of(user) != 1:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return user
def require_admin_mode_user(user=Depends(require_user)):
    with get_conn() as conn:
        if not _can_access_admin_mode(user, conn):
            raise HTTPException(status_code=403, detail='권한이 없습니다.')
    return user
def require_admin_or_subadmin(user=Depends(require_user)):
    if _grade_of(user) > 2:
        raise HTTPException(status_code=403, detail='관리자 또는 부관리자 권한이 필요합니다.')
    return user
def is_blocked(conn, user_id: int, other_id: int) -> bool:
    row = conn.execute(
        """
        SELECT 1 FROM blocks
        WHERE (blocker_id = ? AND blocked_user_id = ?)
           OR (blocker_id = ? AND blocked_user_id = ?)
        LIMIT 1
        """,
        (user_id, other_id, other_id, user_id),
    ).fetchone()
    return bool(row)
def room_key(a: int, b: int) -> str:
    low, high = sorted([a, b])
    return f"{low}:{high}"
def user_basic(conn, user_id: int) -> dict:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return user_public_dict(row)
def get_room_setting(conn, user_id: int, room_type: str, room_ref: str) -> dict:
    row = conn.execute(
        "SELECT * FROM chat_room_settings WHERE user_id = ? AND room_type = ? AND room_ref = ?",
        (user_id, room_type, room_ref),
    ).fetchone()
    if row:
        data = row_to_dict(row)
        data.update({
            'pinned': bool(data.get('pinned', 0)),
            'favorite': bool(data.get('favorite', 0)),
            'muted': bool(data.get('muted', 0)),
            'hidden': bool(data.get('hidden', 0)),
        })
        return data
    return {'custom_name': '', 'pinned': False, 'favorite': False, 'muted': False, 'hidden': False}
def save_room_setting(conn, user_id: int, room_type: str, room_ref: str, payload: dict) -> dict:
    current = get_room_setting(conn, user_id, room_type, room_ref)
    next_data = {
        'custom_name': payload.get('custom_name', current.get('custom_name', '')),
        'pinned': int(payload.get('pinned', current.get('pinned', False))),
        'favorite': int(payload.get('favorite', current.get('favorite', False))),
        'muted': int(payload.get('muted', current.get('muted', False))),
        'hidden': int(payload.get('hidden', current.get('hidden', False))),
    }
    conn.execute(
        """
        INSERT INTO chat_room_settings(user_id, room_type, room_ref, custom_name, pinned, favorite, muted, hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, room_type, room_ref) DO UPDATE SET
            custom_name = excluded.custom_name,
            pinned = excluded.pinned,
            favorite = excluded.favorite,
            muted = excluded.muted,
            hidden = excluded.hidden,
            updated_at = excluded.updated_at
        """,
        (user_id, room_type, room_ref, next_data['custom_name'], next_data['pinned'], next_data['favorite'], next_data['muted'], next_data['hidden'], utcnow(), utcnow()),
    )
    return get_room_setting(conn, user_id, room_type, room_ref)
def build_reply_meta(conn, table: str, reply_to_id: Optional[int]):
    if not reply_to_id:
        return None
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (reply_to_id,)).fetchone()
    if not row:
        return None
    item = row_to_dict(row)
    return {
        'id': item['id'],
        'message': item.get('message', ''),
        'sender': user_basic(conn, item['sender_id']),
    }
def reaction_summary(value: str):
    items = json_loads(value, [])
    summary = {}
    normalized = []
    for entry in items:
        if not isinstance(entry, dict):
            continue
        uid = entry.get('user_id')
        emoji = entry.get('emoji')
        if not uid or not emoji:
            continue
        normalized.append({'user_id': uid, 'emoji': emoji})
        if emoji not in summary:
            summary[emoji] = {'emoji': emoji, 'count': 0, 'user_ids': []}
        summary[emoji]['count'] += 1
        summary[emoji]['user_ids'].append(uid)
    return normalized, list(summary.values())
def enrich_chat_message(conn, row, table: str):
    item = row_to_dict(row)
    raw_reactions, grouped = reaction_summary(item.get('reactions', '[]'))
    return {
        **item,
        'sender': user_basic(conn, item['sender_id']),
        'reply_to': build_reply_meta(conn, table, item.get('reply_to_id')),
        'reactions': raw_reactions,
        'reaction_summary': grouped,
    }
def insert_chat_mention(conn, user_id: int, room_type: str, room_ref: str, message_id: int, sender_id: int) -> None:
    if not user_id or user_id == sender_id:
        return
    conn.execute(
        "INSERT INTO chat_mentions(user_id, room_type, room_ref, message_id, sender_id, seen, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
        (user_id, room_type, room_ref, message_id, sender_id, utcnow()),
    )
def toggle_reaction(conn, table: str, message_id: int, user_id: int, emoji: str):
    row = conn.execute(f"SELECT reactions FROM {table} WHERE id = ?", (message_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='메시지를 찾을 수 없습니다.')
    items = json_loads(row['reactions'], [])
    next_items = []
    replaced = False
    for entry in items:
        if not isinstance(entry, dict):
            continue
        if entry.get('user_id') == user_id:
            if entry.get('emoji') == emoji:
                replaced = True
                continue
            next_items.append({'user_id': user_id, 'emoji': emoji})
            replaced = True
        else:
            next_items.append({'user_id': entry.get('user_id'), 'emoji': entry.get('emoji')})
    if not replaced:
        next_items.append({'user_id': user_id, 'emoji': emoji})
    conn.execute(f"UPDATE {table} SET reactions = ? WHERE id = ?", (json.dumps(next_items, ensure_ascii=False), message_id))
def room_preview_text(message: dict) -> str:
    if message.get('attachment_type') == 'image':
        return '[사진]'
    if message.get('attachment_type') == 'file':
        return '[파일]'
    if message.get('attachment_type') == 'location':
        return '[위치]'
    return message.get('message', '')
def enrich_post(conn, post_row):
    post = row_to_dict(post_row)
    user = user_basic(conn, post["user_id"])
    likes = conn.execute("SELECT COUNT(*) FROM feed_likes WHERE post_id = ?", (post["id"],)).fetchone()[0]
    bookmarks = conn.execute("SELECT COUNT(*) FROM feed_bookmarks WHERE post_id = ?", (post["id"],)).fetchone()[0]
    comments = [
        {
            **row_to_dict(r),
            "user": user_basic(conn, r["user_id"]),
        }
        for r in conn.execute("SELECT * FROM feed_comments WHERE post_id = ? ORDER BY id DESC", (post["id"],)).fetchall()
    ]
    return {
        **post,
        "user": user,
        "likes_count": likes,
        "bookmarks_count": bookmarks,
        "comments": comments,
    }
@app.middleware("http")
async def request_logger(request: Request, call_next):
    started = datetime.utcnow()
    response = await call_next(request)
    elapsed_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
    logger.info("%s %s -> %s (%sms)", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


@app.on_event("startup")
def startup():
    settings.upload_root.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info("startup complete env=%s db_engine=%s policy=%s", settings.app_env, DB_ENGINE, settings.policy_url)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "app_env": settings.app_env,
        "db_engine": DB_ENGINE,
        "db_label": DB_LABEL,
        "site_url": settings.app_public_url,
        "api_url": settings.api_public_url,
        "policy_url": settings.policy_url,
        "r2_enabled": settings.r2_enabled,
        "r2_public_base_url": settings.r2_public_base_url,
    }


@app.get("/api/deployment/meta")
def deployment_meta():
    return {
        "frontend_public_url": settings.app_public_url,
        "backend_public_url": settings.api_public_url,
        "policy_url": settings.policy_url,
        "account_deletion_url": settings.account_deletion_url,
        "recommended_frontend_hosting": "Cloudflare Pages",
        "recommended_backend_hosting": "Railway Hobby",
        "recommended_database": "Railway PostgreSQL",
        "recommended_storage": "Cloudflare R2",
        "recommended_dns": "Cloudflare",
    }


@app.post("/api/uploads/file")
async def upload_file(request: Request, file: UploadFile = File(...), category: str = Query("general"), user=Depends(require_user)):
    try:
        saved = save_upload(file, category=category)
    except StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    url = saved["url"]
    if url.startswith("/"):
        base = str(request.base_url).rstrip("/")
        url = f"{base}{url}"
    return {**saved, "url": url, "uploaded_by": user["id"]}
@app.get("/api/demo-accounts")
def demo_accounts():
    with get_conn() as conn:
        rows = conn.execute("SELECT email, nickname, role, grade FROM users ORDER BY id").fetchall()
        return [{"email": r["email"], "nickname": r["nickname"], "role": r["role"], "grade": r["grade"], "grade_label": grade_label(r["grade"])} for r in rows]
@app.post("/api/auth/signup")
def signup(payload: SignupIn):
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM users WHERE email = ?", (payload.email,)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다.")
        conn.execute(
            """
            INSERT INTO users(email, password_hash, nickname, role, grade, approved, gender, birth_year, region, phone, recovery_email, vehicle_number, branch_no, created_at)
            VALUES (?, ?, ?, 'user', 6, 1, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.email,
                hash_password(payload.password),
                payload.nickname,
                payload.gender,
                payload.birth_year,
                payload.region,
                payload.phone,
                payload.recovery_email,
                payload.vehicle_number,
                payload.branch_no,
                utcnow(),
            ),
        )
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO preferences(user_id, data) VALUES (?, ?)",
            (user_id, json.dumps({"groupChatNotifications": True, "directChatNotifications": True, "likeNotifications": True, "theme": "dark"}, ensure_ascii=False)),
        )
        token = make_token()
        conn.execute("INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)", (token, user_id, utcnow()))
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        user_payload = user_public_dict(user)
        user_payload['permission_config'] = _get_permission_config(conn)
        return {'access_token': token, 'user': user_payload}
@app.post("/api/auth/login")
def login(payload: LoginIn):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ? AND password_hash = ?",
            (payload.email, hash_password(payload.password)),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
        grade = int(row['grade'] or 6)
        approved = int(row['approved'] if row['approved'] is not None else 1)
        if grade == 7 and not approved:
            raise HTTPException(status_code=403, detail="관리자 승인 후 로그인할 수 있습니다.")
        token = make_token()
        conn.execute("INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)", (token, row["id"], utcnow()))
        user_payload = user_public_dict(row)
        user_payload['permission_config'] = _get_permission_config(conn)
        return {'access_token': token, 'user': user_payload}
@app.post("/api/auth/logout")
def logout(user=Depends(require_user), authorization: Optional[str] = Header(default=None)):
    token = _bearer_token(authorization)
    with get_conn() as conn:
        conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    return {"ok": True}

@app.delete('/api/account')
def delete_account(user=Depends(require_user)):
    with get_conn() as conn:
        exists = conn.execute('SELECT id FROM users WHERE id = ?', (user['id'],)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail='사용자를 찾을 수 없습니다.')
        conn.execute('DELETE FROM users WHERE id = ?', (user['id'],))
    return {'ok': True, 'message': '계정이 삭제되었습니다.'}
@app.post("/api/auth/password-reset/request")
def password_reset_request(payload: PasswordResetRequestIn):
    today = datetime.utcnow().date().isoformat()
    with get_conn() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM verification_codes WHERE recovery_email = ? AND substr(created_at,1,10) = ?",
            (payload.recovery_email, today),
        ).fetchone()[0]
        if count >= 2:
            raise HTTPException(status_code=429, detail="복구 이메일당 하루 최대 2회까지만 요청할 수 있습니다.")
        code = f"{random.randint(0, 999999):06d}"
        expires_at = (datetime.utcnow() + timedelta(minutes=10)).replace(microsecond=0).isoformat()
        conn.execute(
            "INSERT INTO verification_codes(recovery_email, code, purpose, expires_at, consumed, created_at) VALUES (?, ?, 'password_reset', ?, 0, ?)",
            (payload.recovery_email, code, expires_at, utcnow()),
        )
        response = {"ok": True, "message": "복구 코드가 발급되었습니다."}
        if EMAIL_DEMO_MODE:
            response["demo_code"] = code
        return response
@app.post("/api/auth/password-reset/confirm")
def password_reset_confirm(payload: PasswordResetConfirmIn):
    with get_conn() as conn:
        code_row = conn.execute(
            """
            SELECT * FROM verification_codes
            WHERE recovery_email = ? AND code = ? AND purpose = 'password_reset' AND consumed = 0
            ORDER BY id DESC LIMIT 1
            """,
            (payload.recovery_email, payload.code),
        ).fetchone()
        if not code_row:
            raise HTTPException(status_code=400, detail="복구 코드가 올바르지 않습니다.")
        if datetime.fromisoformat(code_row["expires_at"]) < datetime.utcnow():
            raise HTTPException(status_code=400, detail="복구 코드가 만료되었습니다.")
        user_row = conn.execute(
            "SELECT * FROM users WHERE email = ? AND recovery_email = ?",
            (payload.email, payload.recovery_email),
        ).fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail="이메일 또는 복구 이메일이 일치하지 않습니다.")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(payload.new_password), user_row["id"]))
        conn.execute("UPDATE verification_codes SET consumed = 1 WHERE id = ?", (code_row["id"],))
        return {"ok": True, "message": "비밀번호가 변경되었습니다."}
@app.get('/api/me')
def me(user=Depends(require_user)):
    with get_conn() as conn:
        cfg = _get_permission_config(conn)
    enriched = dict(user)
    enriched['permission_config'] = cfg
    return {'user': enriched}
@app.get("/api/home")
def home(user=Depends(require_user)):
    with get_conn() as conn:
        posts = conn.execute("SELECT * FROM feed_posts ORDER BY id DESC LIMIT 5").fetchall()
        return {
            "profile_completion": 80 if user["bio"] else 55,
            "recent_posts": [enrich_post(conn, p) for p in posts],
            "stats": {
                "friends": conn.execute("SELECT COUNT(*) FROM friends WHERE user_id = ?", (user["id"],)).fetchone()[0],
                "follows": conn.execute("SELECT COUNT(*) FROM follows WHERE from_user_id = ?", (user["id"],)).fetchone()[0],
                "notifications": conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0", (user["id"],)).fetchone()[0],
            }
        }
@app.get("/api/home-feed")
def home_feed(user=Depends(require_user)):
    with get_conn() as conn:
        posts = conn.execute("SELECT * FROM feed_posts ORDER BY id DESC").fetchall()
        return [enrich_post(conn, p) for p in posts]
@app.post("/api/feed")
def create_feed_post(payload: FeedPostIn, user=Depends(require_user)):
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail="내용을 입력해 주세요.")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO feed_posts(user_id, content, image_url, created_at) VALUES (?, ?, ?, ?)",
            (user["id"], payload.content.strip(), payload.image_url.strip(), utcnow()),
        )
        post_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        post = conn.execute("SELECT * FROM feed_posts WHERE id = ?", (post_id,)).fetchone()
        return enrich_post(conn, post)
@app.post("/api/feed/{post_id}/like")
def toggle_like(post_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        post = conn.execute("SELECT * FROM feed_posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="피드를 찾을 수 없습니다.")
        exists = conn.execute("SELECT 1 FROM feed_likes WHERE post_id = ? AND user_id = ?", (post_id, user["id"])).fetchone()
        if exists:
            conn.execute("DELETE FROM feed_likes WHERE post_id = ? AND user_id = ?", (post_id, user["id"]))
            liked = False
        else:
            conn.execute("INSERT INTO feed_likes(post_id, user_id, created_at) VALUES (?, ?, ?)", (post_id, user["id"], utcnow()))
            liked = True
            if post["user_id"] != user["id"]:
                insert_notification(conn, post["user_id"], "feed_like", "피드 좋아요", f"{user['nickname']}님이 회원님의 피드에 좋아요를 눌렀습니다.")
        return {"liked": liked}
@app.post("/api/feed/{post_id}/bookmark")
def toggle_bookmark(post_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM feed_bookmarks WHERE post_id = ? AND user_id = ?", (post_id, user["id"])).fetchone()
        if exists:
            conn.execute("DELETE FROM feed_bookmarks WHERE post_id = ? AND user_id = ?", (post_id, user["id"]))
            bookmarked = False
        else:
            conn.execute("INSERT INTO feed_bookmarks(post_id, user_id, created_at) VALUES (?, ?, ?)", (post_id, user["id"], utcnow()))
            bookmarked = True
        return {"bookmarked": bookmarked}
@app.post("/api/feed/{post_id}/comment")
def add_comment(post_id: int, payload: CommentIn, user=Depends(require_user)):
    with get_conn() as conn:
        post = conn.execute("SELECT * FROM feed_posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="피드를 찾을 수 없습니다.")
        conn.execute(
            "INSERT INTO feed_comments(post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)",
            (post_id, user["id"], payload.content.strip(), utcnow()),
        )
        if post["user_id"] != user["id"]:
            insert_notification(conn, post["user_id"], "feed_comment", "피드 댓글", f"{user['nickname']}님이 댓글을 남겼습니다.")
        return {"ok": True}
@app.get("/api/profile")
def get_profile(user=Depends(require_user)):
    return {"user": user}
@app.put("/api/profile")
def update_profile(payload: ProfileIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE users SET
                nickname = ?, region = ?, bio = ?, one_liner = ?, interests = ?,
                photo_url = ?, phone = ?, recovery_email = ?, gender = ?, birth_year = ?, vehicle_number = ?, branch_no = ?
            WHERE id = ?
            """,
            (
                payload.nickname,
                payload.region,
                payload.bio,
                payload.one_liner,
                json.dumps(payload.interests, ensure_ascii=False),
                payload.photo_url,
                payload.phone,
                payload.recovery_email,
                payload.gender,
                payload.birth_year,
                payload.vehicle_number,
                payload.branch_no,
                user["id"],
            ),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return {"user": user_public_dict(updated)}
@app.post("/api/profile/location")
def update_location(payload: LocationIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET latitude = ?, longitude = ?, region = ? WHERE id = ?",
            (payload.latitude, payload.longitude, payload.region, user["id"]),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return {"user": user_public_dict(updated)}
@app.get("/api/users")
def list_users(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM users WHERE id != ? ORDER BY id", (user["id"],)).fetchall()
        return [user_public_dict(r) for r in rows]
@app.get("/api/users/{user_id}/profile")
def user_profile(user_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        data = user_public_dict(row)
        data["is_following"] = bool(conn.execute("SELECT 1 FROM follows WHERE from_user_id = ? AND to_user_id = ?", (user["id"], user_id)).fetchone())
        data["is_friend"] = bool(conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (user["id"], user_id)).fetchone())
        return data
@app.post("/api/follows/{target_user_id}")
def toggle_follow(target_user_id: int, user=Depends(require_user)):
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="본인을 팔로우할 수 없습니다.")
    with get_conn() as conn:
        if is_blocked(conn, user["id"], target_user_id):
            raise HTTPException(status_code=400, detail="차단 관계에서는 팔로우할 수 없습니다.")
        exists = conn.execute("SELECT 1 FROM follows WHERE from_user_id = ? AND to_user_id = ?", (user["id"], target_user_id)).fetchone()
        if exists:
            conn.execute("DELETE FROM follows WHERE from_user_id = ? AND to_user_id = ?", (user["id"], target_user_id))
            following = False
        else:
            conn.execute("INSERT INTO follows(from_user_id, to_user_id, created_at) VALUES (?, ?, ?)", (user["id"], target_user_id, utcnow()))
            following = True
            insert_notification(conn, target_user_id, "follow", "새 팔로우", f"{user['nickname']}님이 회원님을 팔로우했습니다.")
        return {"following": following}
@app.get("/api/follows")
def get_follows(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.* FROM follows f
            JOIN users u ON u.id = f.to_user_id
            WHERE f.from_user_id = ?
            ORDER BY u.nickname
            """,
            (user["id"],),
        ).fetchall()
        return [user_public_dict(r) for r in rows]
@app.get("/api/friends")
def get_friends(user=Depends(require_user)):
    with get_conn() as conn:
        friends = conn.execute(
            """
            SELECT u.* FROM friends f
            JOIN users u ON u.id = f.friend_id
            WHERE f.user_id = ?
            ORDER BY u.nickname
            """,
            (user["id"],),
        ).fetchall()
        inbound = conn.execute(
            """
            SELECT fr.*, u.nickname AS requester_nickname FROM friend_requests fr
            JOIN users u ON u.id = fr.requester_id
            WHERE fr.target_user_id = ? AND fr.status = 'pending'
            ORDER BY fr.id DESC
            """,
            (user["id"],),
        ).fetchall()
        outbound = conn.execute(
            """
            SELECT fr.*, u.nickname AS target_nickname FROM friend_requests fr
            JOIN users u ON u.id = fr.target_user_id
            WHERE fr.requester_id = ? AND fr.status = 'pending'
            ORDER BY fr.id DESC
            """,
            (user["id"],),
        ).fetchall()
        return {
            "friends": [user_public_dict(r) for r in friends],
            "received_requests": [row_to_dict(r) for r in inbound],
            "sent_requests": [row_to_dict(r) for r in outbound],
        }
@app.post("/api/friends/request/{target_user_id}")
def request_friend(target_user_id: int, user=Depends(require_user)):
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="본인에게 요청할 수 없습니다.")
    with get_conn() as conn:
        if is_blocked(conn, user["id"], target_user_id):
            raise HTTPException(status_code=400, detail="차단 관계에서는 친구 요청이 불가합니다.")
        exists = conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (user["id"], target_user_id)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="이미 친구입니다.")
        req = conn.execute("SELECT * FROM friend_requests WHERE requester_id = ? AND target_user_id = ?", (user["id"], target_user_id)).fetchone()
        if req:
            raise HTTPException(status_code=400, detail="이미 요청했습니다.")
        conn.execute(
            "INSERT INTO friend_requests(requester_id, target_user_id, status, created_at) VALUES (?, ?, 'pending', ?)",
            (user["id"], target_user_id, utcnow()),
        )
        insert_notification(conn, target_user_id, "friend_request", "친구 요청", f"{user['nickname']}님이 친구 요청을 보냈습니다.")
        return {"ok": True}
@app.post("/api/friends/respond/{request_id}")
def respond_friend(request_id: int, payload: FriendRespondIn, user=Depends(require_user)):
    with get_conn() as conn:
        req = conn.execute("SELECT * FROM friend_requests WHERE id = ? AND target_user_id = ?", (request_id, user["id"])).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="친구 요청을 찾을 수 없습니다.")
        action = payload.action.lower()
        if action not in {"accepted", "rejected"}:
            raise HTTPException(status_code=400, detail="action 값은 accepted 또는 rejected 이어야 합니다.")
        conn.execute("UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?", (action, utcnow(), request_id))
        if action == "accepted":
            conn.execute("INSERT OR IGNORE INTO friends(user_id, friend_id, created_at) VALUES (?, ?, ?)", (req["requester_id"], req["target_user_id"], utcnow()))
            conn.execute("INSERT OR IGNORE INTO friends(user_id, friend_id, created_at) VALUES (?, ?, ?)", (req["target_user_id"], req["requester_id"], utcnow()))
            insert_notification(conn, req["requester_id"], "friend_accept", "친구 요청 수락", f"{user['nickname']}님이 친구 요청을 수락했습니다.")
        return {"ok": True, "status": action}
@app.post("/api/direct-chat-requests/{target_user_id}")
def direct_chat_request(target_user_id: int, user=Depends(require_user)):
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="본인에게 요청할 수 없습니다.")
    with get_conn() as conn:
        if is_blocked(conn, user["id"], target_user_id):
            raise HTTPException(status_code=400, detail="차단 관계에서는 채팅 요청이 불가합니다.")
        req = conn.execute("SELECT * FROM direct_chat_requests WHERE requester_id = ? AND target_user_id = ?", (user["id"], target_user_id)).fetchone()
        if req:
            conn.execute("UPDATE direct_chat_requests SET status = 'pending', responded_at = '' WHERE id = ?", (req["id"],))
        else:
            conn.execute(
                "INSERT INTO direct_chat_requests(requester_id, target_user_id, status, created_at) VALUES (?, ?, 'pending', ?)",
                (user["id"], target_user_id, utcnow()),
            )
        insert_notification(conn, target_user_id, "direct_chat_request", "채팅 요청", f"{user['nickname']}님이 1:1 채팅을 요청했습니다.")
        return {"ok": True}
@app.get("/api/chat/{target_user_id}")
def get_direct_chat(target_user_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        if is_blocked(conn, user["id"], target_user_id):
            raise HTTPException(status_code=400, detail="차단 관계에서는 채팅을 볼 수 없습니다.")
        key = room_key(user["id"], target_user_id)
        rows = conn.execute("SELECT * FROM dm_messages WHERE room_key = ? ORDER BY id", (key,)).fetchall()
        room_ref = str(target_user_id)
        pending_mentions = conn.execute(
            "SELECT * FROM chat_mentions WHERE user_id = ? AND room_type = 'direct' AND room_ref = ? AND seen = 0 ORDER BY id",
            (user["id"], room_ref),
        ).fetchall()
        return {
            "room_key": key,
            "messages": [enrich_chat_message(conn, r, 'dm_messages') for r in rows],
            "target_user": user_basic(conn, target_user_id),
            "room_setting": get_room_setting(conn, user["id"], 'direct', room_ref),
            "pending_mentions": [{**row_to_dict(r), "sender": user_basic(conn, r["sender_id"])} for r in pending_mentions],
        }
@app.post("/api/chat/{target_user_id}")
def send_direct_chat(target_user_id: int, payload: MessageIn, user=Depends(require_user)):
    has_text = bool(payload.message.strip())
    has_attachment = bool(payload.attachment_url or payload.attachment_name)
    if not has_text and not has_attachment:
        raise HTTPException(status_code=400, detail="메시지를 입력해 주세요.")
    with get_conn() as conn:
        if is_blocked(conn, user["id"], target_user_id):
            raise HTTPException(status_code=400, detail="차단 관계에서는 채팅할 수 없습니다.")
        key = room_key(user["id"], target_user_id)
        message_text = payload.message.strip()
        if not message_text and payload.attachment_type == 'image':
            message_text = '사진을 보냈습니다.'
        elif not message_text and payload.attachment_type == 'file':
            message_text = '파일을 보냈습니다.'
        elif not message_text and payload.attachment_type == 'location':
            message_text = '위치를 공유했습니다.'
        conn.execute(
            """
            INSERT INTO dm_messages(room_key, sender_id, message, attachment_name, attachment_url, attachment_type, reply_to_id, mention_user_id, reactions, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (key, user["id"], message_text, payload.attachment_name, payload.attachment_url, payload.attachment_type, payload.reply_to_id, payload.mention_user_id, '[]', utcnow()),
        )
        message_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        insert_notification(conn, target_user_id, "direct_chat", "새 채팅", f"{user['nickname']}님이 새 메시지를 보냈습니다.")
        if payload.mention_user_id and payload.mention_user_id != user['id']:
            insert_notification(conn, payload.mention_user_id, "chat_mention", "채팅 태그", f"{user['nickname']}님이 나를 태그했습니다.")
            insert_chat_mention(conn, payload.mention_user_id, 'direct', str(user['id']), message_id, user['id'])
        return {"ok": True, "message_id": message_id}
@app.get("/api/chat/{target_user_id}/voice-room")
def get_direct_voice_room(target_user_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT * FROM voice_rooms
            WHERE room_type = 'direct' AND status = 'active'
              AND ((creator_id = ? AND target_user_id = ?) OR (creator_id = ? AND target_user_id = ?))
            ORDER BY id DESC LIMIT 1
            """,
            (user["id"], target_user_id, target_user_id, user["id"]),
        ).fetchone()
        return row_to_dict(row) if row else {"room": None}
@app.post("/api/chat/{target_user_id}/voice-room")
def create_direct_voice_room(target_user_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        if is_blocked(conn, user["id"], target_user_id):
            raise HTTPException(status_code=400, detail="차단 관계에서는 음성방을 만들 수 없습니다.")
        conn.execute(
            "INSERT INTO voice_rooms(room_type, creator_id, target_user_id, status, created_at) VALUES ('direct', ?, ?, 'active', ?)",
            (user["id"], target_user_id, utcnow()),
        )
        room_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        insert_notification(conn, target_user_id, "voice_invite", "음성통화 초대", f"{user['nickname']}님이 음성 통화를 시작했습니다.")
        return {"room_id": room_id}
@app.get("/api/group-rooms")
def list_group_rooms(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT gr.*,
                   (SELECT COUNT(*) FROM group_room_members m WHERE m.room_id = gr.id) AS member_count
            FROM group_rooms gr
            ORDER BY gr.id DESC
            """
        ).fetchall()
        return [{**row_to_dict(r), "creator": user_basic(conn, r["creator_id"])} for r in rows]
@app.post("/api/group-rooms")
def create_group_room(payload: GroupRoomIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO group_rooms(title, description, region, creator_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (payload.title, payload.description, payload.region, user["id"], utcnow()),
        )
        room_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute("INSERT INTO group_room_members(room_id, user_id, created_at) VALUES (?, ?, ?)", (room_id, user["id"], utcnow()))
        return {"room_id": room_id}
@app.post("/api/group-rooms/{room_id}/join")
def join_group_room(room_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        room = conn.execute("SELECT * FROM group_rooms WHERE id = ?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="그룹방을 찾을 수 없습니다.")
        conn.execute("INSERT OR IGNORE INTO group_room_members(room_id, user_id, created_at) VALUES (?, ?, ?)", (room_id, user["id"], utcnow()))
        return {"ok": True}
@app.get("/api/group-rooms/{room_id}/messages")
def get_group_messages(room_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        member = conn.execute("SELECT 1 FROM group_room_members WHERE room_id = ? AND user_id = ?", (room_id, user["id"])).fetchone()
        if not member:
            raise HTTPException(status_code=403, detail="그룹방 참가자만 조회할 수 있습니다.")
        rows = conn.execute("SELECT * FROM group_room_messages WHERE room_id = ? ORDER BY id", (room_id,)).fetchall()
        room = conn.execute("SELECT * FROM group_rooms WHERE id = ?", (room_id,)).fetchone()
        pending_mentions = conn.execute(
            "SELECT * FROM chat_mentions WHERE user_id = ? AND room_type = 'group' AND room_ref = ? AND seen = 0 ORDER BY id",
            (user["id"], str(room_id)),
        ).fetchall()
        return {
            "room": {**row_to_dict(room), "creator": user_basic(conn, room["creator_id"])},
            "messages": [enrich_chat_message(conn, r, 'group_room_messages') for r in rows],
            "room_setting": get_room_setting(conn, user["id"], 'group', str(room_id)),
            "pending_mentions": [{**row_to_dict(r), "sender": user_basic(conn, r["sender_id"])} for r in pending_mentions],
        }
@app.post("/api/group-rooms/{room_id}/messages")
def send_group_message(room_id: int, payload: MessageIn, user=Depends(require_user)):
    has_text = bool(payload.message.strip())
    has_attachment = bool(payload.attachment_url or payload.attachment_name)
    if not has_text and not has_attachment:
        raise HTTPException(status_code=400, detail="메시지를 입력해 주세요.")
    with get_conn() as conn:
        member = conn.execute("SELECT 1 FROM group_room_members WHERE room_id = ? AND user_id = ?", (room_id, user["id"])).fetchone()
        if not member:
            raise HTTPException(status_code=403, detail="그룹방 참가자만 작성할 수 있습니다.")
        message_text = payload.message.strip()
        if not message_text and payload.attachment_type == 'image':
            message_text = '사진을 보냈습니다.'
        elif not message_text and payload.attachment_type == 'file':
            message_text = '파일을 보냈습니다.'
        elif not message_text and payload.attachment_type == 'location':
            message_text = '위치를 공유했습니다.'
        conn.execute(
            "INSERT INTO group_room_messages(room_id, sender_id, message, attachment_name, attachment_url, attachment_type, reply_to_id, mention_user_id, reactions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (room_id, user["id"], message_text, payload.attachment_name, payload.attachment_url, payload.attachment_type, payload.reply_to_id, payload.mention_user_id, '[]', utcnow()),
        )
        message_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        if payload.mention_user_id and payload.mention_user_id != user['id']:
            insert_notification(conn, payload.mention_user_id, "chat_mention", "채팅 태그", f"{user['nickname']}님이 나를 태그했습니다.")
            insert_chat_mention(conn, payload.mention_user_id, 'group', str(room_id), message_id, user['id'])
        return {"ok": True, "message_id": message_id}
@app.post("/api/voice/direct/{target_user_id}")
def start_voice_direct(target_user_id: int, user=Depends(require_user)):
    return create_direct_voice_room(target_user_id, user)
@app.post("/api/voice/group/{room_id}")
def start_voice_group(room_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        member = conn.execute("SELECT 1 FROM group_room_members WHERE room_id = ? AND user_id = ?", (room_id, user["id"])).fetchone()
        if not member:
            raise HTTPException(status_code=403, detail="그룹방 참가자만 음성방을 생성할 수 있습니다.")
        conn.execute(
            "INSERT INTO voice_rooms(room_type, creator_id, group_room_id, status, created_at) VALUES ('group', ?, ?, 'active', ?)",
            (user["id"], room_id, utcnow()),
        )
        room_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"room_id": room_id}
@app.get("/api/voice/rooms/{room_id}/signals")
def get_signals(room_id: int, user=Depends(require_user), since_id: int = Query(default=0)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM voice_signals WHERE room_id = ? AND id > ? ORDER BY id",
            (room_id, since_id),
        ).fetchall()
        return [{**row_to_dict(r), "payload": json.loads(r["payload"])} for r in rows]
@app.post("/api/voice/rooms/{room_id}/signals")
def post_signal(room_id: int, payload: VoiceSignalIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO voice_signals(room_id, sender_id, payload, created_at) VALUES (?, ?, ?, ?)",
            (room_id, user["id"], json.dumps(payload.payload, ensure_ascii=False), utcnow()),
        )
        return {"ok": True}
@app.get("/api/chat-list")
def chat_list(category: str = Query(default="general"), user=Depends(require_user)):
    with get_conn() as conn:
        setting_rows = conn.execute("SELECT * FROM chat_room_settings WHERE user_id = ?", (user["id"],)).fetchall()
        settings = {(r["room_type"], r["room_ref"]): row_to_dict(r) for r in setting_rows}
        mention_rows = conn.execute("SELECT * FROM chat_mentions WHERE user_id = ? AND seen = 0 ORDER BY id DESC", (user["id"],)).fetchall()
        mentions = {}
        for row in mention_rows:
            key = (row["room_type"], row["room_ref"])
            if key not in mentions:
                mentions[key] = row_to_dict(row)
        items = []
        direct_rows = conn.execute("SELECT * FROM dm_messages ORDER BY id DESC").fetchall()
        seen_direct = set()
        for row in direct_rows:
            a, b = [int(v) for v in row["room_key"].split(":")]
            if user["id"] not in (a, b):
                continue
            other_id = b if a == user["id"] else a
            if other_id in seen_direct:
                continue
            seen_direct.add(other_id)
            setting = settings.get(("direct", str(other_id)), {})
            if setting.get("hidden"):
                continue
            other = user_basic(conn, other_id)
            mention = mentions.get(("direct", str(other_id)))
            subtitle = f"{user_basic(conn, mention['sender_id'])['nickname']}님이 나를 태그했습니다." if mention else room_preview_text(row_to_dict(row))
            items.append({
                "id": f"direct-{other_id}",
                "room_type": "direct",
                "room_ref": str(other_id),
                "title": setting.get("custom_name") or other["nickname"],
                "subtitle": subtitle,
                "updated_at": row["created_at"],
                "pinned": bool(setting.get("pinned", 0)),
                "favorite": bool(setting.get("favorite", 0)),
                "muted": bool(setting.get("muted", 0)),
                "target_user": other,
                "unread_tag": bool(mention),
            })
        group_rows = conn.execute(
            """
            SELECT gr.* FROM group_rooms gr
            JOIN group_room_members gm ON gm.room_id = gr.id
            WHERE gm.user_id = ?
            ORDER BY gr.id DESC
            """,
            (user["id"],),
        ).fetchall()
        for room in group_rows:
            setting = settings.get(("group", str(room["id"])), {})
            if setting.get("hidden"):
                continue
            last_row = conn.execute("SELECT * FROM group_room_messages WHERE room_id = ? ORDER BY id DESC LIMIT 1", (room["id"],)).fetchone()
            mention = mentions.get(("group", str(room["id"])))
            subtitle = f"{user_basic(conn, mention['sender_id'])['nickname']}님이 나를 태그했습니다." if mention else (room_preview_text(row_to_dict(last_row)) if last_row else room["description"])
            items.append({
                "id": f"group-{room['id']}",
                "room_type": "group",
                "room_ref": str(room["id"]),
                "title": setting.get("custom_name") or room["title"],
                "subtitle": subtitle,
                "updated_at": last_row["created_at"] if last_row else room["created_at"],
                "pinned": bool(setting.get("pinned", 0)),
                "favorite": bool(setting.get("favorite", 0)),
                "muted": bool(setting.get("muted", 0)),
                "room": {**row_to_dict(room), "creator": user_basic(conn, room["creator_id"])},
                "unread_tag": bool(mention),
            })
        if category == 'general':
            items = [item for item in items if item['room_type'] == 'direct']
        elif category == 'group':
            items = [item for item in items if item['room_type'] == 'group']
        elif category == 'favorite':
            items = [item for item in items if item.get('favorite')]
        items.sort(key=lambda item: (not item.get('pinned', False), item.get('updated_at', ''), item.get('id')), reverse=False)
        items.sort(key=lambda item: (0 if item.get('pinned') else 1, item.get('updated_at', '')), reverse=False)
        items = sorted(items, key=lambda item: (0 if item.get('pinned') else 1, item.get('updated_at', '')), reverse=False)
        items.reverse()
        return items
@app.put("/api/chat-rooms/direct/{target_user_id}/settings")
def update_direct_chat_room_settings(target_user_id: int, payload: ChatRoomSettingIn, user=Depends(require_user)):
    with get_conn() as conn:
        setting = save_room_setting(conn, user['id'], 'direct', str(target_user_id), payload.model_dump(exclude_none=True))
        return {"ok": True, "setting": setting}
@app.put("/api/chat-rooms/group/{room_id}/settings")
def update_group_chat_room_settings(room_id: int, payload: ChatRoomSettingIn, user=Depends(require_user)):
    with get_conn() as conn:
        setting = save_room_setting(conn, user['id'], 'group', str(room_id), payload.model_dump(exclude_none=True))
        return {"ok": True, "setting": setting}
@app.post("/api/direct-chat/{target_user_id}/invite")
def invite_from_direct_room(target_user_id: int, payload: ChatInviteIn, user=Depends(require_user)):
    with get_conn() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (target_user_id,)).fetchone()
        invited = conn.execute("SELECT * FROM users WHERE id = ?", (payload.user_id,)).fetchone()
        if not target or not invited:
            raise HTTPException(status_code=404, detail="초대할 사용자를 찾을 수 없습니다.")
        title = f"{user['nickname']}·{target['nickname']} 대화방"
        conn.execute("INSERT INTO group_rooms(title, description, region, creator_id, created_at) VALUES (?, ?, ?, ?, ?)", (title, '직접 채팅방에서 초대한 단체방', user.get('region', '서울'), user['id'], utcnow()))
        room_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for uid in {user['id'], target_user_id, payload.user_id}:
            conn.execute("INSERT OR IGNORE INTO group_room_members(room_id, user_id, created_at) VALUES (?, ?, ?)", (room_id, uid, utcnow()))
        insert_notification(conn, payload.user_id, 'group_invite', '단체방 초대', f"{user['nickname']}님이 단체방에 초대했습니다.")
        return {"ok": True, "room_id": room_id}
@app.post("/api/group-rooms/{room_id}/invite")
def invite_to_group_room(room_id: int, payload: ChatInviteIn, user=Depends(require_user)):
    with get_conn() as conn:
        member = conn.execute("SELECT 1 FROM group_room_members WHERE room_id = ? AND user_id = ?", (room_id, user['id'])).fetchone()
        if not member:
            raise HTTPException(status_code=403, detail='그룹방 참가자만 초대할 수 있습니다.')
        invited = conn.execute("SELECT * FROM users WHERE id = ?", (payload.user_id,)).fetchone()
        if not invited:
            raise HTTPException(status_code=404, detail='초대할 사용자를 찾을 수 없습니다.')
        conn.execute("INSERT OR IGNORE INTO group_room_members(room_id, user_id, created_at) VALUES (?, ?, ?)", (room_id, payload.user_id, utcnow()))
        insert_notification(conn, payload.user_id, 'group_invite', '단체방 초대', f"{user['nickname']}님이 단체방에 초대했습니다.")
        return {"ok": True}
@app.post("/api/group-rooms/{room_id}/leave")
def leave_group_room(room_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute("DELETE FROM group_room_members WHERE room_id = ? AND user_id = ?", (room_id, user['id']))
        save_room_setting(conn, user['id'], 'group', str(room_id), {'hidden': True})
        return {"ok": True}
@app.get("/api/chat-mentions")
def list_chat_mentions(room_type: Optional[str] = None, room_ref: Optional[str] = None, user=Depends(require_user)):
    with get_conn() as conn:
        query = "SELECT * FROM chat_mentions WHERE user_id = ? AND seen = 0"
        params = [user['id']]
        if room_type:
            query += " AND room_type = ?"
            params.append(room_type)
        if room_ref:
            query += " AND room_ref = ?"
            params.append(room_ref)
        query += " ORDER BY id"
        rows = conn.execute(query, tuple(params)).fetchall()
        return [{**row_to_dict(r), 'sender': user_basic(conn, r['sender_id'])} for r in rows]
@app.post("/api/chat-mentions/{mention_id}/seen")
def mark_chat_mention_seen(mention_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute("UPDATE chat_mentions SET seen = 1 WHERE id = ? AND user_id = ?", (mention_id, user['id']))
        return {"ok": True}
@app.post("/api/dm-messages/{message_id}/reactions")
def react_direct_message(message_id: int, payload: ReactionIn, user=Depends(require_user)):
    with get_conn() as conn:
        toggle_reaction(conn, 'dm_messages', message_id, user['id'], payload.emoji)
        row = conn.execute("SELECT * FROM dm_messages WHERE id = ?", (message_id,)).fetchone()
        return enrich_chat_message(conn, row, 'dm_messages')
@app.post("/api/group-messages/{message_id}/reactions")
def react_group_message(message_id: int, payload: ReactionIn, user=Depends(require_user)):
    with get_conn() as conn:
        toggle_reaction(conn, 'group_room_messages', message_id, user['id'], payload.emoji)
        row = conn.execute("SELECT * FROM group_room_messages WHERE id = ?", (message_id,)).fetchone()
        return enrich_chat_message(conn, row, 'group_room_messages')
@app.get("/api/map-users")
def map_users(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM users WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND COALESCE(vehicle_number, '') != '' AND branch_no IS NOT NULL ORDER BY branch_no, id").fetchall()
        return [user_public_dict(r) for r in rows]
@app.get("/api/map-region-boundaries")
def map_region_boundaries(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM region_boundaries").fetchall()
        return [{**row_to_dict(r), "geojson": json.loads(r["geojson"])} for r in rows]
@app.get("/api/meetup-schedules")
def list_meetups(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM meetup_schedules ORDER BY meetup_date, start_time").fetchall()
        return [{**row_to_dict(r), "creator": user_basic(conn, r["creator_id"])} for r in rows]
@app.post("/api/meetup-schedules")
def create_meetup(payload: MeetupIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO meetup_schedules(creator_id, title, place, meetup_date, start_time, end_time, content, cautions, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user["id"], payload.title, payload.place, payload.meetup_date, payload.start_time, payload.end_time, payload.content, payload.cautions, payload.notes, utcnow()),
        )
        return {"ok": True}
@app.put("/api/meetup-schedules/{schedule_id}")
def update_meetup(schedule_id: int, payload: MeetupIn, user=Depends(require_user)):
    with get_conn() as conn:
        schedule = conn.execute("SELECT * FROM meetup_schedules WHERE id = ?", (schedule_id,)).fetchone()
        if not schedule:
            raise HTTPException(status_code=404, detail="모임 일정을 찾을 수 없습니다.")
        if schedule["creator_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="작성자만 수정할 수 있습니다.")
        conn.execute(
            """
            UPDATE meetup_schedules SET title = ?, place = ?, meetup_date = ?, start_time = ?, end_time = ?, content = ?, cautions = ?, notes = ?
            WHERE id = ?
            """,
            (payload.title, payload.place, payload.meetup_date, payload.start_time, payload.end_time, payload.content, payload.cautions, payload.notes, schedule_id),
        )
        return {"ok": True}
@app.delete("/api/meetup-schedules/{schedule_id}")
def delete_meetup(schedule_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        schedule = conn.execute("SELECT * FROM meetup_schedules WHERE id = ?", (schedule_id,)).fetchone()
        if not schedule:
            raise HTTPException(status_code=404, detail="모임 일정을 찾을 수 없습니다.")
        if schedule["creator_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="작성자만 삭제할 수 있습니다.")
        conn.execute("DELETE FROM meetup_schedules WHERE id = ?", (schedule_id,))
        return {"ok": True}
@app.get("/api/meetup-reviews")
def list_meetup_reviews(user=Depends(require_user), schedule_id: Optional[int] = None):
    with get_conn() as conn:
        if schedule_id:
            rows = conn.execute("SELECT * FROM meetup_reviews WHERE schedule_id = ? ORDER BY id DESC", (schedule_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM meetup_reviews ORDER BY id DESC").fetchall()
        return [{**row_to_dict(r), "user": user_basic(conn, r["user_id"])} for r in rows]
@app.post("/api/meetup-reviews")
def create_meetup_review(payload: MeetupReviewIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute("INSERT INTO meetup_reviews(schedule_id, user_id, content, created_at) VALUES (?, ?, ?, ?)", (payload.schedule_id, user["id"], payload.content, utcnow()))
        return {"ok": True}
@app.get("/api/boards/{category}")
def list_board_posts(category: str, user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM board_posts WHERE category = ? ORDER BY id DESC", (category,)).fetchall()
        return [{**row_to_dict(r), "user": user_basic(conn, r["user_id"])} for r in rows]
@app.post("/api/boards/{category}")
def create_board_post(category: str, payload: BoardPostIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO board_posts(category, user_id, title, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (category, user["id"], payload.title, payload.content, payload.image_url, utcnow()),
        )
        return {"ok": True}
@app.get("/api/boards/{category}/{post_id}")
def get_board_post(category: str, post_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM board_posts WHERE category = ? AND id = ?", (category, post_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
        comments = conn.execute("SELECT * FROM board_comments WHERE post_id = ? ORDER BY id", (post_id,)).fetchall()
        return {
            **row_to_dict(row),
            "user": user_basic(conn, row["user_id"]),
            "comments": [{**row_to_dict(c), "user": user_basic(conn, c["user_id"])} for c in comments],
        }
@app.post("/api/boards/{category}/{post_id}/comments")
def add_board_comment(category: str, post_id: int, payload: CommentIn, user=Depends(require_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM board_posts WHERE category = ? AND id = ?", (category, post_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
        conn.execute("INSERT INTO board_comments(post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)", (post_id, user["id"], payload.content.strip(), utcnow()))
        return {"ok": True}
@app.get("/api/notifications")
def list_notifications(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50", (user["id"],)).fetchall()
        return [row_to_dict(r) for r in rows]
@app.get("/api/feed-like-notifications")
def feed_like_notifications(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM notifications WHERE user_id = ? AND type = 'feed_like' ORDER BY id DESC", (user["id"],)).fetchall()
        return [row_to_dict(r) for r in rows]
def _calendar_event_out(conn, row):
    item = row_to_dict(row)
    item["created_by_nickname"] = user_basic(conn, row["user_id"])["nickname"]
    return item
@app.get("/api/calendar/events")
def get_calendar_events(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM calendar_events WHERE user_id = ? ORDER BY event_date, CASE WHEN start_time = '미정' THEN '99:99' ELSE start_time END", (user["id"],)).fetchall()
        return [_calendar_event_out(conn, r) for r in rows]
@app.get("/api/calendar/events/{event_id}")
def get_calendar_event(event_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM calendar_events WHERE id = ? AND user_id = ?", (event_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
        return _calendar_event_out(conn, row)
@app.post("/api/calendar/events")
def create_calendar_event(payload: CalendarEventIn, user=Depends(require_user)):
    _require_write_access(user, 'schedule')
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO calendar_events(
                user_id, title, content, event_date, start_time, end_time, location, color, move_start_date, move_end_date,
                platform, customer_name, department_info, amount1, amount2, amount_item, deposit_method, deposit_amount, image_data, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"], payload.title, payload.content, payload.event_date, payload.start_time, payload.end_time,
                payload.location, payload.color, payload.move_start_date, payload.move_end_date, payload.platform, payload.customer_name,
                payload.department_info, payload.amount1, payload.amount2, payload.amount_item, payload.deposit_method, payload.deposit_amount, payload.image_data, utcnow()
            ),
        )
        return {"ok": True}
@app.put("/api/calendar/events/{event_id}")
def update_calendar_event(event_id: int, payload: CalendarEventIn, user=Depends(require_user)):
    _require_write_access(user, 'schedule')
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM calendar_events WHERE id = ? AND user_id = ?", (event_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
        conn.execute(
            """
            UPDATE calendar_events
            SET title = ?, content = ?, event_date = ?, start_time = ?, end_time = ?, location = ?, color = ?, move_start_date = ?, move_end_date = ?,
                platform = ?, customer_name = ?, department_info = ?, amount1 = ?, amount2 = ?, amount_item = ?, deposit_method = ?, deposit_amount = ?, image_data = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                payload.title, payload.content, payload.event_date, payload.start_time, payload.end_time, payload.location,
                payload.color, payload.move_start_date, payload.move_end_date, payload.platform, payload.customer_name, payload.department_info, payload.amount1,
                payload.amount2, payload.amount_item, payload.deposit_method, payload.deposit_amount, payload.image_data, event_id, user["id"]
            ),
        )
        return {"ok": True}
@app.delete("/api/calendar/events/{event_id}")
def delete_calendar_event(event_id: int, user=Depends(require_user)):
    _require_write_access(user, 'schedule')
    with get_conn() as conn:
        conn.execute("DELETE FROM calendar_events WHERE id = ? AND user_id = ?", (event_id, user["id"]))
        return {"ok": True}
def _schedule_day_title(base_date: date, target_date: date) -> str:
    delta = (target_date - base_date).days
    if delta == 0:
        return '당일일정'
    if delta == 1:
        return '내일일정'
    if delta == 2:
        return '모레일정'
    return f'{delta}일후일정'
def _parse_branch_exclusions(value: str) -> list[int]:
    if not value:
        return []
    tokens = []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            tokens = parsed
    except Exception:
        tokens = []
    if not tokens:
        tokens = re.split(r'[\n,]', value)
    output = []
    for token in tokens:
        match = re.search(r'(\d{1,2})', str(token))
        if not match:
            continue
        branch_no = int(match.group(1))
        if 1 <= branch_no <= 50 and branch_no not in output:
            output.append(branch_no)
    return output
def _get_admin_total_vehicle_count(conn):
    row = conn.execute("SELECT value FROM admin_settings WHERE key = 'total_vehicle_count'").fetchone()
    if row and str(row['value']).strip():
        try:
            return max(int(str(row['value']).strip()), 0)
        except ValueError:
            pass
    row = conn.execute("SELECT COUNT(*) AS cnt FROM users WHERE branch_no IS NOT NULL").fetchone()
    return int(row['cnt']) if row else 0
@app.get('/api/work-schedule')
def get_work_schedule(start_date: Optional[str] = Query(default=None), days: int = Query(default=7, ge=1, le=14), user=Depends(require_user)):
    base_date = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else datetime.now().date()
    date_keys = [(base_date + timedelta(days=index)).isoformat() for index in range(days)]
    with get_conn() as conn:
        placeholders = ','.join('?' for _ in date_keys)
        work_rows = conn.execute(
            f"""
            SELECT * FROM work_schedule_entries
            WHERE user_id = ? AND schedule_date IN ({placeholders})
            ORDER BY schedule_date, CASE WHEN COALESCE(schedule_time, '') = '' THEN '99:99' ELSE schedule_time END, id
            """,
            (user['id'], *date_keys),
        ).fetchall()
        event_rows = conn.execute(
            f"""
            SELECT * FROM calendar_events
            WHERE user_id = ? AND event_date IN ({placeholders})
            ORDER BY event_date, CASE WHEN COALESCE(start_time, '') IN ('', '미정') THEN '99:99' ELSE start_time END, id
            """,
            (user['id'], *date_keys),
        ).fetchall()
        notes_rows = conn.execute(
            f"""
            SELECT * FROM work_schedule_day_notes
            WHERE user_id = ? AND schedule_date IN ({placeholders})
            """,
            (user['id'], *date_keys),
        ).fetchall()
        branch_rows = conn.execute("SELECT branch_no, nickname FROM users WHERE branch_no IS NOT NULL").fetchall()
        total_vehicle_count = _get_admin_total_vehicle_count(conn)
    branch_name_map = {int(r['branch_no']): r['nickname'] for r in branch_rows if r['branch_no'] is not None}
    entries_by_date = {key: [] for key in date_keys}
    for row in event_rows:
        item = row_to_dict(row)
        entries_by_date[row['event_date']].append({
            'id': f"calendar-{row['id']}",
            'entry_type': 'calendar',
            'event_id': row['id'],
            'schedule_date': row['event_date'],
            'schedule_time': '' if row['start_time'] in ('', '미정') else row['start_time'],
            'customer_name': row['customer_name'] or '고객명',
            'representative_names': '',
            'staff_names': '',
            'memo': row['location'] or row['content'] or '',
            'title': row['title'],
            'color': row['color'] or '#2563eb',
            'platform': row['platform'] or '',
            'department_info': row['department_info'] or '',
            'amount1': row['amount1'] or '',
            'amount2': row['amount2'] or '',
            'deposit_method': row['deposit_method'] or '',
            'deposit_amount': row['deposit_amount'] or '',
            'source_summary': row['title'],
            'created_by': user.get('nickname') or '',
        })
    for row in work_rows:
        item = row_to_dict(row)
        item['entry_type'] = 'manual'
        item['event_id'] = None
        item['color'] = '#334155'
        item['title'] = ''
        item['platform'] = ''
        item['department_info'] = ''
        item['amount1'] = ''
        item['amount2'] = ''
        item['deposit_method'] = ''
        item['deposit_amount'] = ''
        item['source_summary'] = ''
        item['created_by'] = user.get('nickname') or ''
        entries_by_date[row['schedule_date']].append(item)
    notes_by_date = {row['schedule_date']: row_to_dict(row) for row in notes_rows}
    output = []
    for key in date_keys:
        target = datetime.strptime(key, '%Y-%m-%d').date()
        note = notes_by_date.get(key, {})
        excluded_business = note.get('excluded_business', '')
        excluded_staff = note.get('excluded_staff', '')
        branch_ids = _parse_branch_exclusions(excluded_business)
        excluded_vehicle_count = len(branch_ids)
        excluded_business_names = []
        for branch_no in branch_ids:
            display_name = branch_name_map.get(branch_no, f'{branch_no}호점')
            excluded_business_names.append(f'{display_name}-열외')
        staff_tokens = [token.strip() for token in re.split(r'[\n,/]+', excluded_staff or '') if token.strip()]
        staff_display = [token if '-' in token else f'{token}-열외' for token in staff_tokens]
        day_entries = sorted(entries_by_date[key], key=lambda item: ((item.get('schedule_time') or '99:99') if (item.get('schedule_time') or '') not in ('', '미정') else '99:99', str(item.get('customer_name') or item.get('title') or ''), str(item.get('id'))))
        output.append({
            'date': key,
            'title': _schedule_day_title(base_date, target),
            'entries': day_entries,
            'excluded_business': excluded_business,
            'excluded_business_names': excluded_business_names,
            'excluded_staff': excluded_staff,
            'excluded_staff_names': staff_display,
            'excluded_vehicle_count': excluded_vehicle_count,
            'available_vehicle_count': max(total_vehicle_count - excluded_vehicle_count, 0),
        })
    return {'days': output}
@app.post("/api/work-schedule/entries")
def create_work_schedule_entry(payload: WorkScheduleEntryIn, user=Depends(require_user)):
    _require_write_access(user, 'work_schedule')
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO work_schedule_entries(user_id, schedule_date, schedule_time, customer_name, representative_names, staff_names, memo, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user['id'], payload.schedule_date, payload.schedule_time, payload.customer_name, payload.representative_names, payload.staff_names, payload.memo, now, now),
        )
        row = conn.execute(
            "SELECT * FROM work_schedule_entries WHERE user_id = ? AND created_at = ? ORDER BY id DESC LIMIT 1",
            (user['id'], now),
        ).fetchone()
        return row_to_dict(row)
@app.put("/api/work-schedule/entries/{entry_id}")
def update_work_schedule_entry(entry_id: int, payload: WorkScheduleEntryIn, user=Depends(require_user)):
    _require_write_access(user, 'work_schedule')
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM work_schedule_entries WHERE id = ? AND user_id = ?", (entry_id, user['id'])).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail='스케줄 항목을 찾을 수 없습니다.')
        conn.execute(
            """
            UPDATE work_schedule_entries
            SET schedule_date = ?, schedule_time = ?, customer_name = ?, representative_names = ?, staff_names = ?, memo = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (payload.schedule_date, payload.schedule_time, payload.customer_name, payload.representative_names, payload.staff_names, payload.memo, utcnow(), entry_id, user['id']),
        )
        row = conn.execute("SELECT * FROM work_schedule_entries WHERE id = ?", (entry_id,)).fetchone()
        return row_to_dict(row)
@app.delete("/api/work-schedule/entries/{entry_id}")
def delete_work_schedule_entry(entry_id: int, user=Depends(require_user)):
    _require_write_access(user, 'work_schedule')
    with get_conn() as conn:
        conn.execute("DELETE FROM work_schedule_entries WHERE id = ? AND user_id = ?", (entry_id, user['id']))
        return {'ok': True}
@app.put("/api/work-schedule/day-note")
def upsert_work_schedule_day_note(payload: WorkScheduleDayNoteIn, user=Depends(require_user)):
    _require_write_access(user, 'work_schedule')
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM work_schedule_day_notes WHERE user_id = ? AND schedule_date = ?", (user['id'], payload.schedule_date)).fetchone()
        now = utcnow()
        if existing:
            conn.execute(
                "UPDATE work_schedule_day_notes SET excluded_business = ?, excluded_staff = ?, updated_at = ? WHERE user_id = ? AND schedule_date = ?",
                (payload.excluded_business, payload.excluded_staff, now, user['id'], payload.schedule_date),
            )
        else:
            conn.execute(
                "INSERT INTO work_schedule_day_notes(user_id, schedule_date, excluded_business, excluded_staff, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user['id'], payload.schedule_date, payload.excluded_business, payload.excluded_staff, now, now),
            )
        row = conn.execute("SELECT * FROM work_schedule_day_notes WHERE user_id = ? AND schedule_date = ?", (user['id'], payload.schedule_date)).fetchone()
        return row_to_dict(row)
@app.post("/api/inquiries")
def create_inquiry(payload: InquiryIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO inquiries(user_id, category, title, content, status, created_at) VALUES (?, ?, ?, ?, 'received', ?)",
            (user["id"], payload.category, payload.title, payload.content, utcnow()),
        )
        return {"ok": True}
@app.post("/api/report/{target_user_id}")
def create_report(target_user_id: int, payload: ReportIn, user=Depends(require_user)):
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="본인을 신고할 수 없습니다.")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO reports(reporter_id, target_user_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
            (user["id"], target_user_id, payload.reason, payload.detail, utcnow()),
        )
        return {"ok": True}
@app.get('/api/admin-mode')
def get_admin_mode(admin=Depends(require_admin_mode_user)):
    with get_conn() as conn:
        total_vehicle_count = _get_admin_total_vehicle_count(conn)
        branch_count_override = _get_branch_count_override(conn)
        permission_config = _get_permission_config(conn)
        users = conn.execute(
            """
            SELECT id, email, nickname, role, grade, approved, region, phone, vehicle_number, branch_no, created_at,
                   marital_status, resident_address, business_name, business_number, business_type, business_item, business_address,
                   bank_account, bank_name, mbti, google_email, resident_id
            FROM users
            ORDER BY COALESCE(branch_no, 9999), nickname
            """
        ).fetchall()
    user_dicts = [row_to_dict(row) for row in users]
    for item in user_dicts:
        item['grade_label'] = grade_label(item.get('grade'))
        item['approved'] = bool(item.get('approved', 1))
    branches = [item for item in user_dicts if item.get('branch_no') is not None]
    employees = [item for item in user_dicts if item.get('branch_no') is None]
    return {
        'config': {'total_vehicle_count': total_vehicle_count, 'branch_count_override': branch_count_override},
        'permission_config': permission_config,
        'branch_count': branch_count_override,
        'branches': branches,
        'employee_count': len(employees),
        'employees': employees,
        'accounts': user_dicts,
    }
@app.post('/api/admin-mode/config')
def save_admin_mode_config(payload: AdminModeConfigIn, admin=Depends(require_admin_mode_user)):
    settings_to_save = {
        'total_vehicle_count': str(payload.total_vehicle_count or '').strip(),
        'branch_count_override': str(payload.branch_count_override or '').strip(),
        'admin_mode_access_grade': str(payload.admin_mode_access_grade),
        'role_assign_actor_max_grade': str(payload.role_assign_actor_max_grade),
        'role_assign_target_min_grade': str(payload.role_assign_target_min_grade),
        'account_suspend_actor_max_grade': str(payload.account_suspend_actor_max_grade),
        'account_suspend_target_min_grade': str(payload.account_suspend_target_min_grade),
        'signup_approve_actor_max_grade': str(payload.signup_approve_actor_max_grade),
        'signup_approve_target_min_grade': str(payload.signup_approve_target_min_grade),
    }
    with get_conn() as conn:
        now = utcnow()
        for key, value in settings_to_save.items():
            conn.execute(
                "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (key, value, now),
            )
    return {'ok': True}
@app.put("/api/admin/accounts/{user_id}")
def update_admin_account(user_id: int, payload: AdminAccountUpdateIn, admin=Depends(require_admin_mode_user)):
    if payload.grade not in {1, 2, 3, 4, 5, 6, 7}:
        raise HTTPException(status_code=400, detail='허용되지 않는 권한입니다.')
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail='계정을 찾을 수 없습니다.')
        target_grade = int(payload.grade or 6)
        if int(admin.get('grade') or 6) != 1 and not _can_manage_grade(admin, target_grade, conn):
            raise HTTPException(status_code=403, detail='해당 권한을 수정할 수 없습니다.')
        approved = int(payload.approved) if payload.approved is not None else int(existing['approved'] if existing['approved'] is not None else 1)
        conn.execute("UPDATE users SET grade = ?, approved = ? WHERE id = ?", (target_grade, approved, user_id))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return user_public_dict(row)
@app.post("/api/admin/accounts/bulk")
def update_admin_accounts_bulk(payload: AdminAccountsBulkUpdateIn, admin=Depends(require_admin_mode_user)):
    updated = []
    with get_conn() as conn:
        for item in payload.accounts:
            user_id = int(item.id or 0)
            target_grade = int(item.grade or 6)
            existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not existing:
                continue
            if int(admin.get('grade') or 6) != 1 and not _can_manage_grade(admin, target_grade, conn):
                continue
            approved = int(item.approved) if item.approved is not None else int(existing['approved'] if existing['approved'] is not None else 1)
            conn.execute("UPDATE users SET grade = ?, approved = ? WHERE id = ?", (target_grade, approved, user_id))
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            updated.append(user_public_dict(row))
    return {'ok': True, 'accounts': updated}
@app.post("/api/admin/users/details-bulk")
def update_admin_user_details_bulk(payload: AdminUserDetailsBulkIn, admin=Depends(require_admin_or_subadmin)):
    editable_fields = [
        'nickname', 'phone', 'vehicle_number', 'branch_no', 'marital_status', 'resident_address',
        'business_name', 'business_number', 'business_type', 'business_item', 'business_address',
        'bank_account', 'bank_name', 'mbti', 'email', 'google_email', 'resident_id',
    ]
    with get_conn() as conn:
        for item in payload.users:
            existing = conn.execute("SELECT * FROM users WHERE id = ?", (item.id,)).fetchone()
            if not existing:
                continue
            data = item.model_dump()
            branch_value = data.get('branch_no')
            if branch_value in ('', None):
                data['branch_no'] = None
            else:
                try:
                    data['branch_no'] = int(branch_value)
                except Exception:
                    data['branch_no'] = None
            assignments = ', '.join(f"{field} = ?" for field in editable_fields)
            values = [data.get(field) for field in editable_fields] + [item.id]
            conn.execute(f"UPDATE users SET {assignments} WHERE id = ?", values)
    return {'ok': True}
@app.post('/api/admin/accounts/create')
def create_admin_account(payload: AdminCreateAccountIn, admin=Depends(require_admin)):
    if payload.grade not in {1,2,3,4,5,6,7}:
        raise HTTPException(status_code=400, detail='허용되지 않는 권한입니다.')
    with get_conn() as conn:
        exists = conn.execute('SELECT id FROM users WHERE email = ?', (payload.email,)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail='이미 존재하는 이메일입니다.')
        conn.execute(
            """
            INSERT INTO users(email, password_hash, nickname, role, grade, approved, gender, birth_year, region, phone, recovery_email, vehicle_number, branch_no, created_at)
            VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (payload.email, hash_password(payload.password), payload.nickname, int(payload.grade), int(bool(payload.approved)), payload.gender, payload.birth_year, payload.region, payload.phone, payload.recovery_email, payload.vehicle_number, payload.branch_no, utcnow()),
        )
        user_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.execute('INSERT INTO preferences(user_id, data) VALUES (?, ?)', (user_id, json.dumps({"groupChatNotifications": True, "directChatNotifications": True, "likeNotifications": True, "theme": "dark"}, ensure_ascii=False)))
        row = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    return {'ok': True, 'user': user_public_dict(row)}
@app.get("/api/admin/reports")
def admin_reports(admin=Depends(require_admin)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM reports ORDER BY id DESC").fetchall()
        enriched = []
        for r in rows:
            item = row_to_dict(r)
            item["reporter"] = user_basic(conn, r["reporter_id"])
            item["target"] = user_basic(conn, r["target_user_id"])
            enriched.append(item)
        return enriched
@app.post("/api/admin/reports/{report_id}/close")
def close_report(report_id: int, admin=Depends(require_admin)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="신고를 찾을 수 없습니다.")
        conn.execute("UPDATE reports SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?", (utcnow(), admin["id"], report_id))
        return {"ok": True}
@app.get("/api/blocked-users")
def blocked_users(user=Depends(require_user)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT b.*, u.* FROM blocks b
            JOIN users u ON u.id = b.blocked_user_id
            WHERE b.blocker_id = ?
            ORDER BY b.id DESC
            """,
            (user["id"],),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "reason": r["reason"],
                "blocked_user": {
                    "id": r["blocked_user_id"],
                    "nickname": r["nickname"],
                    "email": r["email"],
                    "region": r["region"],
                }
            }
            for r in rows
        ]
@app.post("/api/block/{target_user_id}")
def block_user(target_user_id: int, payload: BlockIn, user=Depends(require_user)):
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="본인을 차단할 수 없습니다.")
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO blocks(blocker_id, blocked_user_id, reason, created_at) VALUES (?, ?, ?, ?)",
            (user["id"], target_user_id, payload.reason, utcnow()),
        )
        return {"ok": True}
@app.put("/api/blocked-users/{block_id}/reason")
def update_block_reason(block_id: int, payload: BlockIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute("UPDATE blocks SET reason = ? WHERE id = ? AND blocker_id = ?", (payload.reason, block_id, user["id"]))
        return {"ok": True}
@app.post("/api/unblock/{target_user_id}")
def unblock_user(target_user_id: int, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute("DELETE FROM blocks WHERE blocker_id = ? AND blocked_user_id = ?", (user["id"], target_user_id))
        return {"ok": True}
@app.get("/api/preferences")
def get_preferences(user=Depends(require_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT data FROM preferences WHERE user_id = ?", (user["id"],)).fetchone()
        return json.loads(row["data"]) if row else {}
@app.post("/api/preferences")
def save_preferences(payload: PreferenceIn, user=Depends(require_user)):
    with get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO preferences(user_id, data) VALUES (?, ?)", (user["id"], json.dumps(payload.data, ensure_ascii=False)))
        return {"ok": True}
FRONTEND_DIST_DIR = (Path(__file__).resolve().parents[1] / "static").resolve()
FALLBACK_FRONTEND_DIST_DIR = (Path(__file__).resolve().parents[2] / "frontend" / "dist").resolve()
if not FRONTEND_DIST_DIR.exists() and FALLBACK_FRONTEND_DIST_DIR.exists():
    FRONTEND_DIST_DIR = FALLBACK_FRONTEND_DIST_DIR
def _frontend_file(path: str) -> Optional[Path]:
    candidate = (FRONTEND_DIST_DIR / path).resolve()
    if candidate.is_file() and str(candidate).startswith(str(FRONTEND_DIST_DIR)):
        return candidate
    if Path(path).suffix:
        return None
    return FRONTEND_DIST_DIR / "index.html"
@app.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
def serve_chrome_devtools_probe():
    return {}


@app.get("/privacy-policy", include_in_schema=False)
def serve_privacy_policy():
    file_path = (Path(__file__).resolve().parents[1] / "static" / "legal" / "privacy-policy.html").resolve()
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="privacy-policy.html 파일이 없습니다.")
    return FileResponse(file_path)


@app.get("/account-deletion", include_in_schema=False)
def serve_account_deletion():
    file_path = (Path(__file__).resolve().parents[1] / "static" / "legal" / "account-deletion.html").resolve()
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="account-deletion.html 파일이 없습니다.")
    return FileResponse(file_path)


@app.get("/uploads/{file_path:path}", include_in_schema=False)
def serve_local_upload(file_path: str):
    requested = (settings.upload_root / file_path).resolve()
    if not requested.exists() or not str(requested).startswith(str(settings.upload_root.resolve())):
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(requested)


@app.get("/", include_in_schema=False)
def serve_root():
    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "message": "이청잘 API 서버 실행중",
        "docs": "/docs",
        "health": "/api/health",
        "frontend_built": False,
    }


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    if full_path.startswith("api/") or full_path in {"docs", "openapi.json", "redoc"}:
        raise HTTPException(status_code=404, detail="Not Found")
    index_file = FRONTEND_DIST_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="프런트엔드 빌드본이 없습니다. frontend에서 npm run build를 먼저 실행하세요.")
    requested = _frontend_file(full_path) if full_path else index_file
    if requested is None or not requested.exists():
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(requested)
