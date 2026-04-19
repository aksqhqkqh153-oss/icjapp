from __future__ import annotations

import difflib
import json
import os
import re
import traceback
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from .db import get_conn, get_user_by_token, utcnow

router = APIRouter(prefix='/api/soomgo-review', tags=['soomgo-review'])

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'data' / 'soomgo_review'
DATA_DIR.mkdir(parents=True, exist_ok=True)
STATE_PATH = DATA_DIR / 'state.json'
SCREENSHOT_DIR = DATA_DIR / 'screenshots'
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_PROMPT = (
    "1. 고객님 리뷰 문맥을 자연스럽게 반영할 것\n"
    "2. 긍정적 표현과 친절한 톤 유지\n"
    "3. 부정적 이슈는 공감 및 해결 의지 표명\n"
    "4. '!' '~' 'ㅎㅎ' '^^' 를 자연스럽게 사용\n"
    "5. 업계 전문가답게 정확한 어휘 사용\n"
)


SLOT_COUNT = 6
ADMIN_GRADES = {1, 2}
SENSITIVE_SETTING_KEYS = {'soomgo_email', 'soomgo_password', 'prompt', 'outer_html', 'anonymous_name', 'review_input', 'target_file_dir', 'auto_scan_on_open'}


def _is_soomgo_admin(user: Optional[dict[str, Any]]) -> bool:
    return int(user.get('grade') or 6) in ADMIN_GRADES if user else False


def _sanitize_state_for_user(state: dict[str, Any], user: Optional[dict[str, Any]]) -> dict[str, Any]:
    if _is_soomgo_admin(user):
        return state
    masked = json.loads(json.dumps(state, ensure_ascii=False))
    settings = masked.get('settings', {})
    for key in SENSITIVE_SETTING_KEYS:
        if key in settings:
            settings[key] = '' if isinstance(settings.get(key), str) else False
    return masked


def _parse_token(authorization: Optional[str]) -> str:
    raw = str(authorization or '').strip()
    if raw.startswith('Bearer '):
        return raw[7:].strip()
    return raw


def _require_user(authorization: Optional[str]) -> dict[str, Any]:
    token = _parse_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail='로그인이 필요합니다.')
    with get_conn() as conn:
        user = get_user_by_token(conn, token)
    if not user:
        raise HTTPException(status_code=401, detail='로그인이 필요합니다.')
    return user


def _default_state() -> dict[str, Any]:
    slots = []
    for index in range(SLOT_COUNT):
        slots.append({
            'index': index,
            'masked_name': '',
            'real_name': '',
            'review': '',
            'reply': '',
            'situation': '',
            'specifics': '',
        })
    return {
        'settings': {
            'soomgo_email': os.getenv('SOOMGO_REVIEW_EMAIL', ''),
            'soomgo_password': os.getenv('SOOMGO_REVIEW_PASSWORD', ''),
            'prompt': DEFAULT_PROMPT,
            'outer_html': '',
            'anonymous_name': '',
            'review_input': '',
            'target_file_dir': str(SCREENSHOT_DIR),
            'auto_scan_on_open': True,
        },
        'memos': {
            'soomgo': '',
            'today': '',
            'site': '',
        },
        'results': {
            'candidate_names': '',
            'candidate_scores': '',
            'customer_review': '',
            'field_status': '',
            'special_note': '',
            'ai_result': '',
        },
        'slots': slots,
        'last_scan': {
            'ok': False,
            'message': '',
            'updated_at': '',
            'found_count': 0,
        },
    }


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        state = _default_state()
        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
        return state
    try:
        state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        default = _default_state()
        for key, value in default.items():
            if key not in state:
                state[key] = value
        if not isinstance(state.get('slots'), list):
            state['slots'] = default['slots']
        while len(state['slots']) < SLOT_COUNT:
            idx = len(state['slots'])
            state['slots'].append({
                'index': idx,
                'masked_name': '',
                'real_name': '',
                'review': '',
                'reply': '',
                'situation': '',
                'specifics': '',
            })
        return state
    except Exception:
        state = _default_state()
        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
        return state


def _save_state(state: dict[str, Any]) -> dict[str, Any]:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    return state


def _parse_reviews_from_outer_html(outer_html: str) -> list[dict[str, Any]]:
    text = str(outer_html or '').strip()
    if not text:
        return []
    try:
        match = re.search(r'<script[^>]*>\s*(\{.*?\})\s*</script>', text, re.DOTALL)
        json_text = match.group(1) if match else text
        parsed = json.loads(json_text)
        return parsed.get('props', {}).get('pageProps', {}).get('session', {}).get('me', {}).get('provider', {}).get('reviews', []) or []
    except Exception:
        return []


def _find_real_name_by_content(reviews_data: list[dict[str, Any]], target_content: str) -> str:
    target = str(target_content or '').strip()
    if not reviews_data or not target:
        return ''
    best_name = ''
    best_score = 0.0
    for review in reviews_data:
        content = str(review.get('contents', '')).strip()
        author = str(review.get('author', '')).strip()
        if not content or not author:
            continue
        score = difflib.SequenceMatcher(None, target, content).ratio()
        if score > best_score:
            best_score = score
            best_name = author
    return best_name if best_score > 0.6 else ''


def _manual_match(outer_html: str, anonymous_name: str, review_input: str) -> dict[str, str]:
    reviews = _parse_reviews_from_outer_html(outer_html)
    anonymous_name = str(anonymous_name or '').strip()
    review_input = str(review_input or '').strip()
    best_score = 0.0
    candidates: list[tuple[str, float]] = []
    for review in reviews:
        author = str(review.get('author', '')).strip()
        contents = str(review.get('contents', '')).strip()
        if not author or not contents:
            continue
        if anonymous_name and not author.startswith(anonymous_name[0]):
            continue
        score = difflib.SequenceMatcher(None, review_input, contents).ratio() if review_input else 0.0
        best_score = max(best_score, score)
        if score > 0.3:
            candidates.append((author, score))
    candidates.sort(key=lambda item: item[1], reverse=True)
    if candidates:
        names = '\n'.join(author for author, _ in candidates)
        scores = '\n'.join(f'{author}: {score * 100:.2f}%' for author, score in candidates)
    else:
        names = '일치하는 후보를 찾지 못했습니다.'
        scores = f'최대 유사도: {best_score * 100:.2f}%'
    return {'candidate_names': names, 'candidate_scores': scores}


def _get_playwright_sync_api():
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            '자동 숨고리뷰 찾기에 필요한 Playwright 가 설치되지 않았습니다. backend requirements 설치 후 playwright chromium 을 함께 설치해 주세요.'
        ) from exc
    return sync_playwright


def _playwright_launch_options(headless: bool) -> dict[str, Any]:
    return {
        'headless': headless,
        'args': ['--no-sandbox', '--disable-dev-shm-usage'],
    }


def _diagnose_playwright_runtime() -> None:
    try:
        sync_playwright = _get_playwright_sync_api()
    except Exception as exc:
        raise RuntimeError('Playwright 패키지 로드에 실패했습니다. backend requirements 설치 상태를 확인해 주세요.') from exc

    playwright = sync_playwright().start()
    browser = None
    try:
        browser = playwright.chromium.launch(**_playwright_launch_options(headless=True))
    except Exception as exc:
        raise RuntimeError(
            'Playwright Chromium 실행에 실패했습니다. Railway 배포가 Dockerfile이 아닌 Nixpacks로 배포 중이면 chromium 설치 명령이 누락된 상태일 수 있습니다. Railway 재배포 후 다시 시도해 주세요.'
        ) from exc
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        try:
            playwright.stop()
        except Exception:
            pass


def _playwright_login_page(email: str, password: str, headless: bool = True):
    if not email or not password:
        raise RuntimeError('숨고 로그인 이메일/비밀번호가 설정되어 있지 않습니다.')

    sync_playwright = _get_playwright_sync_api()
    playwright = sync_playwright().start()
    browser = None
    context = None
    page = None
    try:
        browser = playwright.chromium.launch(**_playwright_launch_options(headless=headless))
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()
        page.goto('https://soomgo.com/login', wait_until='domcontentloaded', timeout=30000)
        page.locator('input[name="email"]').wait_for(timeout=30000)
        page.fill('input[name="email"]', email)
        page.fill('input[name="password"]', password)
        page.locator('button[type="submit"]').click(force=True)
        page.wait_for_selector('#app-body', timeout=30000)
        return playwright, browser, context, page
    except Exception as exc:
        if page is not None:
            try:
                page.screenshot(path=str(SCREENSHOT_DIR / 'soomgo_login_error.png'), full_page=True)
            except Exception:
                pass
        if context is not None:
            try:
                context.close()
            except Exception:
                pass
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        try:
            playwright.stop()
        except Exception:
            pass
        raise RuntimeError(
            '자동 숨고리뷰 찾기 로그인 단계에서 실패했습니다. Railway 배포환경에 playwright chromium 설치가 되어 있는지 확인해 주세요.'
        ) from exc


def _run_auto_fill_outer_html(email: str, password: str, headless: bool = True) -> str:
    playwright = browser = context = page = None
    try:
        playwright, browser, context, page = _playwright_login_page(email, password, headless=headless)
        page.goto('https://soomgo.com/mypage/cash-dashboard', wait_until='domcontentloaded', timeout=30000)
        page.wait_for_load_state('domcontentloaded')
        script_locator = page.locator('xpath=/html/body/script[1]').first
        script_locator.wait_for(timeout=20000)
        return script_locator.evaluate('el => el.outerHTML || ""') or ''
    finally:
        if context is not None:
            try:
                context.close()
            except Exception:
                pass
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass


def _scan_unanswered_reviews(state: dict[str, Any], headless: bool = True) -> dict[str, Any]:
    settings = state.get('settings', {})
    email = str(settings.get('soomgo_email', '')).strip()
    password = str(settings.get('soomgo_password', '')).strip()
    if not email or not password:
        raise RuntimeError('숨고 로그인 이메일/비밀번호를 먼저 설정해 주세요.')

    outer_html = _run_auto_fill_outer_html(email, password, headless=headless)
    settings['outer_html'] = outer_html
    reviews_data = _parse_reviews_from_outer_html(outer_html)

    playwright = browser = context = page = None
    found: list[dict[str, str]] = []
    try:
        playwright, browser, context, page = _playwright_login_page(email, password, headless=headless)
        page.goto('https://soomgo.com/profile#id_profile_review', wait_until='domcontentloaded', timeout=30000)
        page.wait_for_selector('.grid-item.span-8.profile-section', timeout=20000)

        for _ in range(10):
            more_button = page.locator("xpath=//button[.//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'secondary') and contains(normalize-space(text()), '더보기')]]").last
            if more_button.count() == 0:
                break
            try:
                more_button.scroll_into_view_if_needed(timeout=5000)
                more_button.click(force=True, timeout=5000)
                page.wait_for_timeout(700)
            except Exception:
                break

        review_items = page.locator('.review-list .profile-review-item')
        item_count = review_items.count()
        for index in range(item_count):
            if len(found) >= SLOT_COUNT:
                break
            item = review_items.nth(index)
            try:
                has_reply = item.locator("xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'primary') and not(contains(@class, 'review-content'))]").count() > 0
                if has_reply:
                    continue

                content_text = ''
                content_locator = item.locator("xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'primary') and contains(@class, 'review-content')]").first
                if content_locator.count() > 0:
                    content_text = content_locator.inner_text(timeout=3000).strip()
                elif item.locator('.review-content').count() > 0:
                    content_text = item.locator('.review-content').first.inner_text(timeout=3000).strip()
                else:
                    content_text = '(내용 없음)'

                author_locator = item.locator("xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:semibold') and contains(@class, 'primary')]").first
                author_name = author_locator.inner_text(timeout=3000).strip() if author_locator.count() > 0 else '익명'
                real_name = _find_real_name_by_content(reviews_data, content_text)
                found.append({'masked_name': author_name, 'real_name': real_name, 'review': content_text})
            except Exception:
                continue
    finally:
        if page is not None:
            try:
                page.screenshot(path=str(SCREENSHOT_DIR / 'soomgo_review_scan_last.png'), full_page=True)
            except Exception:
                pass
        if context is not None:
            try:
                context.close()
            except Exception:
                pass
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass

    slots = state.get('slots', [])
    for idx in range(SLOT_COUNT):
        if idx >= len(slots):
            slots.append({'index': idx, 'masked_name': '', 'real_name': '', 'review': '', 'reply': '', 'situation': '', 'specifics': ''})
        slot = slots[idx]
        if idx < len(found):
            slot['masked_name'] = found[idx].get('masked_name', '')
            slot['real_name'] = found[idx].get('real_name', '')
            slot['review'] = found[idx].get('review', '')
        else:
            slot['masked_name'] = slot.get('masked_name', '')
            slot['real_name'] = slot.get('real_name', '')
            slot['review'] = slot.get('review', '')
        slot['reply'] = slot.get('reply', '')
        slot['situation'] = slot.get('situation', '')
        slot['specifics'] = slot.get('specifics', '')

    state['last_scan'] = {
        'ok': True,
        'message': f'총 {len(found)}개의 미답변 리뷰를 찾았습니다.',
        'updated_at': utcnow(),
        'found_count': len(found),
    }
    return state


def _generate_reply(prompt_text: str, customer_review_main: str, customer_review_partial: str, field_status: str, special_note: str) -> str:
    try:
        from openai import OpenAI
    except Exception as exc:
        raise RuntimeError('openai 패키지가 설치되어 있지 않습니다.') from exc
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        raise RuntimeError('OPENAI_API_KEY 가 설정되어 있지 않습니다.')
    client = OpenAI(api_key=api_key)
    gave_food = any(keyword in special_note for keyword in ['커피', '아메리카노', '라떼', '음료', '빵', '간식', '과자', '과일', '떡', '점심', '식사', '밥', '치킨', '피자', '다과'])
    special_food_instruction = (
        '[특별 감사 표현 지시사항]\n현장 특이사항에 따르면 고객님께서 작업 중에 음식/음료를 챙겨주셨습니다.\n리뷰 답변에서 이 부분에 대한 감사 인사를 꼭 1~2문장 이상, 구체적으로 표현해 주세요.'
        if gave_food else
        '[음식 관련 금지 지시사항]\n현장 특이사항에 음식/음료 제공에 대한 내용이 전혀 없습니다.\n이번 리뷰 답변에서는 고객님이 커피, 간식, 식사, 음료 등을 챙겨주셨다는 내용을 절대 만들지 마세요.'
    )
    combined_prompt = f"""
너는 이사 전문 업체 '이청잘'의 리뷰 답글을 대신 작성해 주는 전문가야.
입력된 [고객리뷰]에만 답변하고, 없는 사실(음식 등)을 지어내지 마라.

[리뷰 답변 작성 기준]
{prompt_text or DEFAULT_PROMPT}

[고객리뷰]
{customer_review_main}

[리뷰 내용 일부]
{customer_review_partial or customer_review_main}

[이사현장상황]
{field_status or '(입력 없음)'}

[현장 특이사항]
{special_note or '(입력 없음)'}
{special_food_instruction}

작성 규칙:
1. 한국어 작성, 5~10문장 내외.
2. [고객리뷰] 내용 중심.
3. 현장 상황/특이사항은 고객이 알면 좋은 내용만 자연스럽게 반영.
4. '!', '~', 'ㅎㅎ', '^^' 적절히 사용.
5. '이청잘' 상호명 자연스럽게 언급.
"""
    completion = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[
            {'role': 'system', 'content': "너는 이사 전문 업체 '이청잘'의 리뷰 답글 작성 AI다."},
            {'role': 'user', 'content': combined_prompt},
        ],
        temperature=0.7,
    )
    return completion.choices[0].message.content.strip()


class SoomgoReviewStateIn(BaseModel):
    settings: Optional[dict[str, Any]] = None
    memos: Optional[dict[str, str]] = None
    results: Optional[dict[str, str]] = None
    slots: Optional[list[dict[str, Any]]] = None


class SoomgoManualMatchIn(BaseModel):
    outer_html: str = ''
    anonymous_name: str = ''
    review_input: str = ''


class SoomgoDraftIn(BaseModel):
    slot_index: Optional[int] = None
    review: str = ''
    situation: str = ''
    specifics: str = ''


@router.get('/state')
def get_state(authorization: Optional[str] = Header(default=None)):
    user = _require_user(authorization)
    return _sanitize_state_for_user(_load_state(), user)


@router.post('/state')
def save_state(payload: SoomgoReviewStateIn, authorization: Optional[str] = Header(default=None)):
    user = _require_user(authorization)
    state = _load_state()
    if payload.settings:
        if not _is_soomgo_admin(user):
            raise HTTPException(status_code=403, detail='관리자 / 부관리자만 설정을 확인하거나 수정할 수 있습니다.')
        allowed_settings = {key: value for key, value in payload.settings.items() if key in SENSITIVE_SETTING_KEYS}
        state['settings'].update(allowed_settings)
    if payload.memos:
        state['memos'].update(payload.memos)
    if payload.results:
        state['results'].update(payload.results)
    if payload.slots is not None:
        normalized = []
        for index in range(SLOT_COUNT):
            src = payload.slots[index] if index < len(payload.slots) else {}
            normalized.append({
                'index': index,
                'masked_name': str(src.get('masked_name', '')),
                'real_name': str(src.get('real_name', '')),
                'review': str(src.get('review', '')),
                'reply': str(src.get('reply', '')),
                'situation': str(src.get('situation', '')),
                'specifics': str(src.get('specifics', '')),
            })
        state['slots'] = normalized
    _save_state(state)
    return _sanitize_state_for_user(state, user)


@router.post('/scan-auto')
def scan_auto(authorization: Optional[str] = Header(default=None)):
    user = _require_user(authorization)
    if not _is_soomgo_admin(user):
        raise HTTPException(status_code=403, detail='관리자 / 부관리자만 자동 숨고리뷰 찾기를 실행할 수 있습니다.')
    state = _load_state()
    try:
        _diagnose_playwright_runtime()
        state = _scan_unanswered_reviews(state, headless=True)
        _save_state(state)
        return state
    except Exception as exc:
        detail = str(exc).strip() or '자동 숨고 리뷰 찾기 실행 중 알 수 없는 오류가 발생했습니다.'
        trace = traceback.format_exc(limit=5)
        state['last_scan'] = {'ok': False, 'message': detail, 'updated_at': utcnow(), 'found_count': 0}
        state.setdefault('results', {})['ai_result'] = ''
        _save_state(state)
        raise HTTPException(status_code=500, detail=f'{detail}\n\n[debug] {trace}')


@router.post('/scan-manual')
def scan_manual(authorization: Optional[str] = Header(default=None)):
    user = _require_user(authorization)
    if not _is_soomgo_admin(user):
        raise HTTPException(status_code=403, detail='관리자 / 부관리자만 수동 리뷰 찾기를 실행할 수 있습니다.')
    state = _load_state()
    try:
        _diagnose_playwright_runtime()
        state = _scan_unanswered_reviews(state, headless=False)
        _save_state(state)
        return state
    except Exception as exc:
        detail = str(exc).strip() or '수동 숨고 리뷰 찾기 실행 중 알 수 없는 오류가 발생했습니다.'
        trace = traceback.format_exc(limit=5)
        state['last_scan'] = {'ok': False, 'message': detail, 'updated_at': utcnow(), 'found_count': 0}
        _save_state(state)
        raise HTTPException(status_code=500, detail=f'{detail}\n\n[debug] {trace}')


@router.post('/manual-match')
def manual_match(payload: SoomgoManualMatchIn, authorization: Optional[str] = Header(default=None)):
    user = _require_user(authorization)
    if not _is_soomgo_admin(user):
        raise HTTPException(status_code=403, detail='관리자 / 부관리자만 숨은 설정을 사용할 수 있습니다.')
    state = _load_state()
    result = _manual_match(payload.outer_html, payload.anonymous_name, payload.review_input)
    state['results']['candidate_names'] = result['candidate_names']
    state['results']['candidate_scores'] = result['candidate_scores']
    state['settings']['outer_html'] = payload.outer_html
    state['settings']['anonymous_name'] = payload.anonymous_name
    state['settings']['review_input'] = payload.review_input
    _save_state(state)
    return {'ok': True, **result, 'state': state}


@router.post('/generate-draft')
def generate_draft(payload: SoomgoDraftIn, authorization: Optional[str] = Header(default=None)):
    _require_user(authorization)
    state = _load_state()
    prompt_text = str(state.get('settings', {}).get('prompt', DEFAULT_PROMPT))
    review = str(payload.review or '').strip()
    situation = str(payload.situation or '').strip()
    specifics = str(payload.specifics or '').strip()
    slot_index = payload.slot_index
    if slot_index is not None and 0 <= slot_index < len(state.get('slots', [])):
        slot = state['slots'][slot_index]
        review = review or str(slot.get('review', '')).strip()
        situation = situation or str(slot.get('situation', '')).strip()
        specifics = specifics or str(slot.get('specifics', '')).strip()
    if not review:
        raise HTTPException(status_code=400, detail='리뷰 내용이 비어 있습니다.')
    try:
        draft = _generate_reply(prompt_text, review, review, situation, specifics)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    state['results']['ai_result'] = draft
    if slot_index is not None and 0 <= slot_index < len(state.get('slots', [])):
        state['slots'][slot_index]['reply'] = draft
        if payload.situation:
            state['slots'][slot_index]['situation'] = payload.situation
        if payload.specifics:
            state['slots'][slot_index]['specifics'] = payload.specifics
    _save_state(state)
    return {'ok': True, 'draft': draft, 'state': state}
