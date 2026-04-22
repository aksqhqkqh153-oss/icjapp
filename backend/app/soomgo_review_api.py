from __future__ import annotations

import difflib
import html
import json
import os
import re
import traceback
from datetime import datetime, timedelta, timezone
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
SOOMGO_REVIEW_SETTING_KEY = 'soomgo_review_state_json'
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




def _current_kst_timestamp() -> str:
    return datetime.now(timezone(timedelta(hours=9))).replace(microsecond=0, tzinfo=None).isoformat(timespec='seconds')


def _normalize_unique_text_list(values: Any) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = _normalize_review_text(value)
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def _extract_section_rows(preloaded: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    rows = []
    if isinstance(preloaded, dict):
        rows = preloaded.get('sectionRows') or preloaded.get('sections') or []
    normalized: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized.append({
            'index': int(row.get('index', len(normalized)) or 0),
            'text': _normalize_review_text(row.get('text', '')),
            'raw_text': str(row.get('rawText', '') or ''),
            'lines': _normalize_unique_text_list(row.get('lines') or []),
            'author_rows': _normalize_unique_text_list(row.get('authorRows') or []),
            'review_rows': _normalize_unique_text_list(row.get('reviewRows') or []),
            'rating_rows': _normalize_unique_text_list(row.get('ratingRows') or []),
            'reply_rows': _normalize_unique_text_list(row.get('replyRows') or []),
            'has_nested_article': bool(row.get('hasNestedArticle')),
        })
    return normalized


def _extract_review_content_rows(preloaded: Optional[dict[str, Any]] = None) -> list[str]:
    rows = []
    if isinstance(preloaded, dict):
        rows = preloaded.get('reviewContentRows') or preloaded.get('contentCandidates') or []
    normalized = _normalize_unique_text_list(rows)
    if normalized:
        return normalized
    merged: list[str] = []
    seen: set[str] = set()
    for row in _extract_section_rows(preloaded):
        for value in row.get('review_rows') or []:
            if value in seen:
                continue
            seen.add(value)
            merged.append(value)
    return merged


def _extract_rating_rows(preloaded: Optional[dict[str, Any]] = None) -> list[str]:
    rows = []
    if isinstance(preloaded, dict):
        rows = preloaded.get('ratingRows') or preloaded.get('ratingCandidates') or []
    normalized = _normalize_unique_text_list(rows)
    if normalized:
        return normalized
    merged: list[str] = []
    seen: set[str] = set()
    for row in _extract_section_rows(preloaded):
        for value in row.get('rating_rows') or []:
            if value in seen:
                continue
            seen.add(value)
            merged.append(value)
    return merged


def _extract_rating_value(text: Any) -> str:
    value = _normalize_review_text(text)
    if not value:
        return ''
    match = re.search(r'(?<!\d)([0-5](?:\.\d)?)(?!\d)', value)
    if not match:
        return ''
    if '별점' in value:
        return match.group(1)
    if value == match.group(1):
        return match.group(1)
    compact = re.sub(r'\s+', '', value)
    if compact.endswith(match.group(1)) and len(compact) <= 20:
        return match.group(1)
    return ''


def _strip_rating_prefix(text: Any) -> str:
    value = _normalize_review_text(text)
    if not value:
        return ''
    patterns = [
        r'^[가-힣A-Za-z\s]+별점\s*[0-5](?:\.\d)?\s*',
        r'^[가-힣A-Za-z\s]+\s[0-5](?:\.\d)?\s*',
        r'^별점\s*[0-5](?:\.\d)?\s*',
    ]
    for pattern in patterns:
        stripped = re.sub(pattern, '', value).strip()
        if stripped != value:
            return stripped
    return value


def _extract_rating_from_candidates(values: list[str]) -> str:
    for value in values:
        rating = _extract_rating_value(value)
        if rating:
            return rating
    return ''


def _extract_reply_rows(preloaded: Optional[dict[str, Any]] = None) -> list[str]:
    rows = []
    if isinstance(preloaded, dict):
        rows = preloaded.get('replyRows') or []
    normalized = _normalize_unique_text_list(rows)
    if normalized:
        return normalized
    merged: list[str] = []
    seen: set[str] = set()
    for row in _extract_section_rows(preloaded):
        for value in row.get('reply_rows') or []:
            if value in seen:
                continue
            seen.add(value)
            merged.append(value)
    return merged


def _has_meaningful_reply(preloaded: Optional[dict[str, Any]] = None, item: Any = None) -> bool:
    reply_rows = _extract_reply_rows(preloaded)
    if reply_rows:
        return True
    section_rows = _extract_section_rows(preloaded)
    if any((row.get('has_nested_article') and row.get('reply_rows')) for row in section_rows):
        return True
    if item is None:
        return False
    review_rows = set(_extract_review_content_rows(preloaded))
    selectors = [
        "xpath=.//article//*[contains(@class, 'body14:regular') and contains(@class, 'primary') and not(contains(@class, 'review-content'))]",
        "xpath=.//*[contains(@class, 'body14:regular') and contains(@class, 'primary') and not(contains(@class, 'review-content'))]",
    ]
    blocked = {'더보기', '리뷰', '답글', '답변'}
    for selector in selectors:
        try:
            locator = item.locator(selector)
            count = locator.count()
            for idx in range(count):
                value = _normalize_review_text(locator.nth(idx).inner_text(timeout=1200))
                if not value or value in blocked or value in review_rows:
                    continue
                return True
        except Exception:
            continue
    return False

def _default_state() -> dict[str, Any]:
    slots = []
    for index in range(SLOT_COUNT):
        slots.append({
            'index': index,
            'masked_name': '',
            'real_name': '',
            'rating': '',
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


def _normalize_state(state: Any) -> dict[str, Any]:
    default = _default_state()
    if not isinstance(state, dict):
        state = {}
    normalized = json.loads(json.dumps(default, ensure_ascii=False))
    for section in ('settings', 'memos', 'results', 'last_scan'):
        incoming = state.get(section)
        if isinstance(incoming, dict):
            normalized[section].update(incoming)
    incoming_slots = state.get('slots')
    if isinstance(incoming_slots, list):
        normalized_slots: list[dict[str, Any]] = []
        for index in range(SLOT_COUNT):
            src = incoming_slots[index] if index < len(incoming_slots) and isinstance(incoming_slots[index], dict) else {}
            normalized_slots.append({
                'index': index,
                'masked_name': str(src.get('masked_name', '')),
                'real_name': str(src.get('real_name', '')),
                'rating': str(src.get('rating', '')),
                'review': str(src.get('review', '')),
                'reply': str(src.get('reply', '')),
                'situation': str(src.get('situation', '')),
                'specifics': str(src.get('specifics', '')),
            })
        normalized['slots'] = normalized_slots
    return normalized


def _load_state_from_file() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return _default_state()
    try:
        return _normalize_state(json.loads(STATE_PATH.read_text(encoding='utf-8')))
    except Exception:
        return _default_state()


def _load_state() -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute('SELECT value FROM admin_settings WHERE key = ?', (SOOMGO_REVIEW_SETTING_KEY,)).fetchone()
        if row and row['value']:
            try:
                state = _normalize_state(json.loads(row['value']))
                conn.execute(
                    "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    (SOOMGO_REVIEW_SETTING_KEY, json.dumps(state, ensure_ascii=False), utcnow()),
                )
                return state
            except Exception:
                pass

        state = _load_state_from_file()
        conn.execute(
            "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (SOOMGO_REVIEW_SETTING_KEY, json.dumps(state, ensure_ascii=False), utcnow()),
        )
        if not STATE_PATH.exists():
            try:
                STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
            except Exception:
                pass
        return state


def _save_state(state: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_state(state)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (SOOMGO_REVIEW_SETTING_KEY, json.dumps(normalized, ensure_ascii=False), utcnow()),
        )
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        pass
    return normalized


def _normalize_review_text(value: Any) -> str:
    text = html.unescape(str(value or ''))
    text = text.replace(' ', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _compact_review_text(value: Any) -> str:
    text = _normalize_review_text(value).lower()
    return re.sub(r'[^0-9a-z가-힣]+', '', text)


def _mask_name(name: str) -> str:
    raw = str(name or '').strip()
    if not raw:
        return ''
    if '*' in raw:
        return raw
    if len(raw) <= 1:
        return raw
    if len(raw) == 2:
        return raw[0] + '*'
    return raw[0] + ('*' * (len(raw) - 2)) + raw[-1]


def _normalize_masked_name(value: Any) -> str:
    masked = _normalize_review_text(value).replace('•', '*')
    masked = re.sub(r'\s+', '', masked)
    return masked


def _mask_matches(masked_name: str, real_name: str) -> bool:
    masked = _normalize_masked_name(masked_name)
    real = _normalize_review_text(real_name)
    if not masked or not real:
        return False
    if masked == _normalize_masked_name(_mask_name(real)):
        return True
    if len(masked) != len(real):
        return False
    for masked_char, real_char in zip(masked, real):
        if masked_char in {'*', '•'}:
            continue
        if masked_char != real_char:
            return False
    return True


def _is_likely_name_line(text: str) -> bool:
    value = _normalize_review_text(text)
    if not value:
        return False
    if len(value) > 12:
        return False
    blocked_tokens = ['더보기', '답글', '리뷰', '서비스', '고수', '작성', '수정', '삭제', '별점']
    if any(token in value for token in blocked_tokens):
        return False
    if re.search(r'\d{2,4}[./-]\d{1,2}[./-]\d{1,2}', value):
        return False
    if re.search(r'\d+분|\d+시간|\d+일', value):
        return False
    return bool(re.search(r'[가-힣A-Za-z*]', value))


def _extract_reviews_from_json_node(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            author = _normalize_review_text(value.get('author', '')) if 'author' in value else ''
            contents = _normalize_review_text(value.get('contents', '')) if 'contents' in value else ''
            if author and contents:
                key = (author, contents)
                if key not in seen:
                    seen.add(key)
                    found.append({'author': author, 'contents': contents, **value})
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return found


def _parse_reviews_from_outer_html(outer_html: str) -> list[dict[str, Any]]:
    text = str(outer_html or '').strip()
    if not text:
        return []
    candidates: list[str] = []
    match = re.search(r'<script[^>]*>\s*(\{.*\})\s*</script>', text, re.DOTALL)
    if match:
        candidates.append(match.group(1))
    candidates.append(text)

    for json_text in candidates:
        try:
            parsed = json.loads(json_text)
        except Exception:
            continue
        fixed_path = parsed.get('props', {}).get('pageProps', {}).get('session', {}).get('me', {}).get('provider', {}).get('reviews', []) or []
        normalized_fixed = []
        for row in fixed_path:
            if isinstance(row, dict):
                author = _normalize_review_text(row.get('author', ''))
                contents = _normalize_review_text(row.get('contents', ''))
                if author and contents:
                    normalized_fixed.append({'author': author, 'contents': contents, **row})
        if normalized_fixed:
            return normalized_fixed
        discovered = _extract_reviews_from_json_node(parsed)
        if discovered:
            return discovered
    return []


def _merge_review_sources(*sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source in sources:
        for row in source or []:
            if not isinstance(row, dict):
                continue
            author = _normalize_review_text(row.get('author', ''))
            contents = _normalize_review_text(row.get('contents', ''))
            if not author or not contents:
                continue
            key = (author, contents)
            if key in seen:
                continue
            seen.add(key)
            merged.append({'author': author, 'contents': contents, **row})
    return merged


def _build_review_line_candidates(item_text: str) -> list[str]:
    raw_lines = re.split(r'[\r\n]+', str(item_text or ''))
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in raw_lines:
        value = _normalize_review_text(raw)
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _pick_review_content_from_lines(lines: list[str], author_name: str = '', real_name: str = '') -> str:
    blocked_tokens = [
        '더보기', '답글', '답변', '고마워요', '도움이 돼요', '신고', '수정', '삭제', '확인',
        '프로필', '리뷰', '고수', '숨고', '작성', '서비스', '추천', '공유', '채팅', '문의',
    ]
    blocked_exact = {v for v in [_normalize_review_text(author_name), _normalize_review_text(real_name), _mask_name(real_name)] if v}
    candidates: list[str] = []
    for line in lines:
        value = _normalize_review_text(line)
        if not value or value in blocked_exact:
            continue
        if any(token in value for token in blocked_tokens):
            continue
        if _is_likely_name_line(value) and len(value) <= 10:
            continue
        if _extract_rating_value(value):
            stripped = _strip_rating_prefix(value)
            if stripped != value:
                value = stripped
            else:
                continue
        if re.fullmatch(r'[★☆\d\s.,!~^]+', value):
            continue
        if len(value) < 8:
            continue
        candidates.append(value)
    return max(candidates, key=len) if candidates else ''


def _collect_unanswered_review_items(page: Any) -> list[dict[str, Any]]:
    js = r"""
() => {
  const norm = (value) => String(value || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const uniq = (rows) => {
    const seen = new Set();
    return (rows || []).map((value) => norm(value)).filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  };
  const splitLines = (value) => uniq(String(value || '').split(/[\n]+/g));
  const queryTexts = (root, selector) => {
    try {
      return uniq(Array.from(root.querySelectorAll(selector)).map((el) => el.innerText || el.textContent || ''));
    } catch (_error) {
      return [];
    }
  };
  const hasArticleSections = (node) => {
    if (!node || !(node instanceof Element)) return false;
    return !!node.querySelector(':scope > article > section, article > section');
  };
  const reviewList = document.querySelector('.review-list');
  if (!reviewList) return [];

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (node) => {
    if (!node || !(node instanceof Element)) return;
    const key = node.id || node.getAttribute('data-review-id') || node.outerHTML.slice(0, 120);
    if (!key || seen.has(key) || !hasArticleSections(node)) return;
    seen.add(key);
    candidates.push(node);
  };

  Array.from(reviewList.children).forEach(pushCandidate);
  Array.from(reviewList.querySelectorAll('.profile-review-item')).forEach(pushCandidate);
  Array.from(reviewList.querySelectorAll(':scope > [id]')).forEach(pushCandidate);
  Array.from(reviewList.querySelectorAll('[id]')).forEach((node) => {
    if (node.closest('.review-list') === reviewList) pushCandidate(node);
  });

  return candidates.map((item, index) => {
    const sections = Array.from(item.querySelectorAll(':scope > article > section, article > section'));
    const sectionRows = sections.map((section, sectionIndex) => {
      const sectionTextRaw = section.innerText || section.textContent || '';
      const nestedArticle = section.querySelector('article');
      const sectionReviewRows = uniq([
        ...queryTexts(section, '.prisma-typography.body14\\:regular.primary.review-content'),
        ...queryTexts(section, '.review-content'),
        ...queryTexts(section, '[class*="review-content"]'),
        ...queryTexts(section, 'div > div > span'),
        ...queryTexts(section, 'span'),
      ]).filter((value) => value.length >= 2);
      const sectionAuthorRows = uniq([
        ...queryTexts(section, '.prisma-typography.body14\\:semibold.primary'),
        ...queryTexts(section, '.prisma-typography.body13\\:semibold.primary'),
        ...queryTexts(section, '[class*="author"]'),
        ...queryTexts(section, '[class*="reviewer"]'),
        ...queryTexts(section, 'div > span'),
        ...queryTexts(section, 'span'),
      ]).filter((value) => value.length <= 20);
      const sectionRatingRows = uniq([
        ...queryTexts(section, '.prisma-typography.body16\\:semibold.primary'),
        ...queryTexts(section, '[class*="body16:semibold"]'),
        ...queryTexts(section, 'div > div > div > div > span'),
      ]).filter((value) => /(^|\\s)[0-5](?:\\.\\d)?($|\\s)/.test(value) || value.includes('별점'));
      const nestedTexts = nestedArticle ? uniq([
        ...queryTexts(nestedArticle, '.prisma-typography.body14\\:regular.primary'),
        ...queryTexts(nestedArticle, 'span'),
        ...queryTexts(nestedArticle, 'p'),
        ...queryTexts(nestedArticle, 'div'),
      ]) : [];
      const replyRows = nestedTexts.filter((value) => value.length >= 2);
      return {
        index: sectionIndex,
        text: norm(sectionTextRaw),
        rawText: String(sectionTextRaw || ''),
        lines: splitLines(sectionTextRaw),
        authorRows: sectionAuthorRows,
        reviewRows: sectionReviewRows,
        ratingRows: sectionRatingRows,
        replyRows,
        hasNestedArticle: !!nestedArticle,
      };
    });

    const authorCandidates = uniq([
      ...sectionRows.flatMap((section) => section.authorRows || []),
      ...queryTexts(item, '.prisma-typography.body14\\:semibold.primary'),
      ...queryTexts(item, '.prisma-typography.body13\\:semibold.primary'),
      ...queryTexts(item, '[class*="author"]'),
      ...queryTexts(item, '[class*="reviewer"]'),
    ]);

    const likelyReviewSections = sectionRows.filter((section, idx) => {
      if (section.hasNestedArticle) return false;
      if (idx === 0 && section.authorRows.length) return false;
      if ((section.reviewRows || []).length > 0) return true;
      return (section.lines || []).some((line) => line.length >= 8);
    });

    const reviewContentRows = uniq([
      ...likelyReviewSections.flatMap((section) => section.reviewRows || []),
      ...sectionRows.flatMap((section, idx) => {
        if (section.hasNestedArticle) return [];
        if (idx === 0 && section.authorRows.length) return [];
        return (section.lines || []).filter((line) => line.length >= 8);
      }),
      ...queryTexts(item, '.prisma-typography.body14\\:regular.primary.review-content'),
      ...queryTexts(item, '.review-content'),
      ...queryTexts(item, '[class*="review-content"]'),
    ]);

    const ratingCandidates = uniq([
      ...sectionRows.flatMap((section) => section.ratingRows || []),
      ...queryTexts(item, '.prisma-typography.body16\\:semibold.primary'),
      ...queryTexts(item, '[class*="body16:semibold"]'),
    ]);
    const replyRows = uniq(sectionRows.flatMap((section) => section.replyRows || []));
    const regularPrimaryRows = uniq(queryTexts(item, '.prisma-typography.body14\\:regular.primary'));
    const textRows = uniq(sectionRows.flatMap((section) => section.lines || []));
    return {
      index,
      rootId: item.id || '',
      itemText: norm(item.innerText || item.textContent || ''),
      authorCandidates,
      reviewContentRows,
      contentCandidates: reviewContentRows.slice(),
      ratingCandidates,
      replyRows,
      regularPrimaryRows,
      textRows,
      sectionRows,
      hasReply: replyRows.length > 0,
    };
  });
}
"""
    try:
        rows = page.evaluate(js) or []
        return rows if isinstance(rows, list) else []
    except Exception:
        return []


def _find_real_name_by_content(reviews_data: list[dict[str, Any]], target_content: str) -> str:
    target = _normalize_review_text(target_content)
    target_compact = _compact_review_text(target_content)
    if not reviews_data or not target:
        return ''
    best_name = ''
    best_score = 0.0
    for review in reviews_data:
        content = _normalize_review_text(review.get('contents', ''))
        content_compact = _compact_review_text(review.get('contents', ''))
        author = _normalize_review_text(review.get('author', ''))
        if not content or not author:
            continue
        score_candidates = [
            difflib.SequenceMatcher(None, target, content).ratio(),
            difflib.SequenceMatcher(None, target_compact, content_compact).ratio() if target_compact and content_compact else 0.0,
        ]
        if target_compact and content_compact:
            if target_compact == content_compact:
                score_candidates.append(1.0)
            elif target_compact in content_compact or content_compact in target_compact:
                score_candidates.append(0.93)
        score = max(score_candidates)
        if score > best_score:
            best_score = score
            best_name = author
    return best_name if best_score >= 0.45 else ''


def _score_review_record(review: dict[str, Any], masked_name: str, candidate_lines: list[str], item_text: str) -> float:
    author = _normalize_review_text(review.get('author', ''))
    contents = _normalize_review_text(review.get('contents', ''))
    if not author or not contents:
        return 0.0

    compact_item = _compact_review_text(item_text)
    compact_contents = _compact_review_text(contents)
    best_score = 0.0

    if masked_name and _mask_matches(masked_name, author):
        best_score += 0.32

    if compact_item and compact_contents:
        if compact_contents in compact_item or compact_item in compact_contents:
            best_score += 0.42

    for line in candidate_lines:
        norm_line = _normalize_review_text(line)
        compact_line = _compact_review_text(line)
        score = difflib.SequenceMatcher(None, norm_line, contents).ratio()
        if compact_line and compact_contents:
            score = max(score, difflib.SequenceMatcher(None, compact_line, compact_contents).ratio())
            if compact_line == compact_contents:
                score = max(score, 1.0)
            elif compact_line in compact_contents or compact_contents in compact_line:
                score = max(score, 0.93)
        best_score = max(best_score, score)

    return best_score


def _resolve_review_record_from_outer_html(reviews_data: list[dict[str, Any]], masked_name: str, item_text: str, candidate_lines: list[str]) -> tuple[str, str, str]:
    if not reviews_data:
        return '', '', ''
    normalized_mask = _normalize_masked_name(masked_name)
    scored: list[tuple[float, dict[str, Any]]] = []
    for review in reviews_data:
        score = _score_review_record(review, normalized_mask, candidate_lines, item_text)
        if score > 0:
            scored.append((score, review))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return '', '', ''
    best_score, best_review = scored[0]
    if best_score < 0.58:
        return '', '', ''
    real_name = _normalize_review_text(best_review.get('author', ''))
    review_text = _normalize_review_text(best_review.get('contents', ''))
    masked = normalized_mask or _mask_name(real_name)
    return masked, real_name, review_text


def _guess_masked_name_from_item_text(item_text: str, review_text: str, real_name: str = '') -> str:
    review_norm = _normalize_review_text(review_text)
    lines = [_normalize_review_text(line) for line in str(item_text or '').splitlines()]
    filtered = []
    for line in lines:
        if not line:
            continue
        if review_norm and line == review_norm:
            continue
        if review_norm and review_norm in line and len(line) > len(review_norm) + 8:
            continue
        filtered.append(line)

    masked_candidates = [line for line in filtered if _is_likely_name_line(line) and ('*' in line or '•' in line)]
    if masked_candidates:
        return masked_candidates[0]

    short_candidates = [line for line in filtered if _is_likely_name_line(line)]
    if short_candidates:
        return short_candidates[0]

    if real_name:
        return _mask_name(real_name)
    return '익명'


def _extract_review_item_fields_from_preloaded(preloaded: Optional[dict[str, Any]], reviews_data: list[dict[str, Any]]) -> tuple[str, str, str, str]:
    preloaded = preloaded or {}
    section_rows = _extract_section_rows(preloaded)
    author_candidates = [
        _normalize_review_text(value)
        for value in (preloaded.get('authorCandidates') or [])
        if _normalize_review_text(value)
    ]
    review_content_rows = _extract_review_content_rows(preloaded)
    rating_candidates = _extract_rating_rows(preloaded) + [
        _normalize_review_text(value)
        for value in (preloaded.get('ratingCandidates') or [])
        if _normalize_review_text(value)
    ]
    content_candidates = [
        _normalize_review_text(value)
        for value in (preloaded.get('contentCandidates') or [])
        if _normalize_review_text(value)
    ]
    item_text = _normalize_review_text(preloaded.get('itemText', ''))

    author_name = ''
    if section_rows:
        for candidate in section_rows[0].get('author_rows') or []:
            if candidate and _is_likely_name_line(candidate):
                author_name = candidate
                break
    if not author_name:
        for candidate in author_candidates:
            if candidate and _is_likely_name_line(candidate):
                author_name = candidate
                break

    rating_text = _extract_rating_from_candidates(rating_candidates)
    content_text = review_content_rows[0] if review_content_rows else ''
    candidate_lines: list[str] = []
    for row in section_rows:
        if row.get('reply_rows'):
            continue
        if row.get('index', 0) == 0 and row.get('author_rows'):
            continue
        for value in (row.get('review_rows') or []) + (row.get('lines') or []):
            normalized = _normalize_review_text(value)
            if normalized and normalized not in candidate_lines:
                candidate_lines.append(normalized)
    for value in _build_review_line_candidates(item_text):
        if value and value not in candidate_lines:
            candidate_lines.append(value)

    if not content_text and section_rows:
        preferred_sections = [row for row in section_rows if not row.get('reply_rows') and not (row.get('index', 0) == 0 and row.get('author_rows'))]
        preferred_sections.sort(key=lambda row: (0 if row.get('review_rows') else 1, row.get('index', 99)))
        for row in preferred_sections:
            candidate = _pick_review_content_from_lines((row.get('review_rows') or []) + (row.get('lines') or []), author_name=author_name)
            if candidate:
                content_text = candidate
                break

    if not content_text and content_candidates:
        for candidate in content_candidates:
            if candidate and len(candidate) >= 8:
                content_text = candidate
                break

    if not content_text and candidate_lines:
        content_text = _pick_review_content_from_lines(candidate_lines, author_name=author_name)

    content_text = _strip_rating_prefix(content_text)
    real_name = _find_real_name_by_content(reviews_data, content_text)
    if not author_name:
        author_name = _guess_masked_name_from_item_text(item_text, content_text, real_name)
    if (not author_name or author_name == '익명') and real_name:
        author_name = _mask_name(real_name)

    resolved_masked, resolved_real, resolved_review = _resolve_review_record_from_outer_html(
        reviews_data,
        author_name,
        item_text,
        review_content_rows + content_candidates + candidate_lines,
    )
    if resolved_review:
        content_text = resolved_review or content_text
    if resolved_real and not real_name:
        real_name = resolved_real
    if resolved_masked and (not author_name or author_name == '익명'):
        author_name = resolved_masked
    elif real_name and (not author_name or author_name == '익명'):
        author_name = _mask_name(real_name)

    return author_name or '익명', real_name, rating_text, (content_text or '(내용 없음)')


def _extract_review_item_fields(item: Any, reviews_data: list[dict[str, Any]], preloaded: Optional[dict[str, Any]] = None) -> tuple[str, str, str, str]:
    try:
        expand_locator = item.locator("xpath=.//*[contains(normalize-space(text()), '더보기')]").first
        if expand_locator.count() > 0:
            try:
                expand_locator.click(force=True, timeout=1500)
            except Exception:
                pass
    except Exception:
        pass

    preloaded = preloaded or {}
    section_rows = _extract_section_rows(preloaded)
    author_candidates = [
        _normalize_review_text(value)
        for value in (preloaded.get('authorCandidates') or [])
        if _normalize_review_text(value)
    ]
    review_content_rows = _extract_review_content_rows(preloaded)
    rating_candidates = _extract_rating_rows(preloaded) + [
        _normalize_review_text(value)
        for value in (preloaded.get('ratingCandidates') or [])
        if _normalize_review_text(value)
    ]
    content_candidates = [
        _normalize_review_text(value)
        for value in (preloaded.get('contentCandidates') or [])
        if _normalize_review_text(value)
    ]

    rating_text = _extract_rating_from_candidates(rating_candidates)
    content_text = review_content_rows[0] if review_content_rows else ''
    content_selectors = [
        ".review-content",
        "[class*='review-content']",
        "xpath=.//*[contains(@class, 'review-content')]",
        "xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'primary') and contains(@class, 'review-content')]",
    ]
    for selector in content_selectors:
        try:
            locator = item.locator(selector).first
            if locator.count() == 0:
                continue
            value = _normalize_review_text(locator.inner_text(timeout=3000))
            if value:
                content_text = value
                break
        except Exception:
            continue

    rating_selectors = [
        "xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body16:semibold') and contains(@class, 'primary')]",
        "[class*='body16:semibold']",
    ]
    for selector in rating_selectors:
        try:
            locator = item.locator(selector).first
            if locator.count() == 0:
                continue
            rating_candidate = _extract_rating_value(locator.inner_text(timeout=2000))
            if rating_candidate:
                rating_text = rating_candidate
                break
        except Exception:
            continue

    item_text = _normalize_review_text(preloaded.get('itemText', ''))
    if not item_text:
        try:
            item_text = _normalize_review_text(item.inner_text(timeout=3000))
        except Exception:
            item_text = ''

    author_name = ''
    author_selectors = [
        "xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:semibold') and contains(@class, 'primary')]",
        "xpath=.//*[contains(@class, 'prisma-typography') and contains(@class, 'body13:semibold') and contains(@class, 'primary')]",
        "[data-testid*='author']",
        "[class*='author']",
        "[class*='reviewer']",
        ".reviewer-name",
    ]
    for selector in author_selectors:
        try:
            locator = item.locator(selector).first
            if locator.count() == 0:
                continue
            value = _normalize_review_text(locator.inner_text(timeout=2000))
            if value and _is_likely_name_line(value):
                author_name = value
                break
        except Exception:
            continue

    if not author_name and section_rows:
        for candidate in section_rows[0].get('author_rows') or []:
            if candidate and _is_likely_name_line(candidate):
                author_name = candidate
                break

    if not author_name:
        for candidate in author_candidates:
            if candidate and _is_likely_name_line(candidate):
                author_name = candidate
                break

    line_candidates: list[str] = []
    if section_rows:
        for row in section_rows:
            if row.get('reply_rows'):
                continue
            for value in (row.get('review_rows') or []) + (row.get('lines') or []):
                normalized = _normalize_review_text(value)
                if normalized and normalized not in line_candidates:
                    line_candidates.append(normalized)
    for value in _build_review_line_candidates(item_text):
        if value and value not in line_candidates:
            line_candidates.append(value)

    if not content_text:
        for candidate in content_candidates:
            if candidate and len(candidate) >= 8:
                content_text = candidate
                break

    if not content_text and section_rows:
        for row in section_rows:
            if row.get('reply_rows'):
                continue
            candidate = _pick_review_content_from_lines(row.get('lines') or [row.get('text', '')], author_name=author_name)
            if candidate:
                content_text = candidate
                break

    if not content_text and line_candidates:
        content_text = _pick_review_content_from_lines(line_candidates, author_name=author_name)

    content_text = _strip_rating_prefix(content_text)
    real_name = _find_real_name_by_content(reviews_data, content_text)

    if not author_name:
        author_name = _guess_masked_name_from_item_text(item_text, content_text, real_name)
    if (not author_name or author_name == '익명') and real_name:
        author_name = _mask_name(real_name)

    if (not content_text or content_text == '(내용 없음)') and line_candidates:
        ref_author = (author_name or _mask_name(real_name)) if real_name else author_name
        content_text = _pick_review_content_from_lines(line_candidates, author_name=ref_author, real_name=real_name)

    if (not real_name) and content_text:
        real_name = _find_real_name_by_content(reviews_data, content_text)
        if (not author_name or author_name == '익명') and real_name:
            author_name = _mask_name(real_name)

    resolved_masked, resolved_real, resolved_review = _resolve_review_record_from_outer_html(
        reviews_data,
        author_name,
        item_text,
        review_content_rows + content_candidates + line_candidates,
    )
    if resolved_review and (not content_text or content_text == '(내용 없음)'):
        content_text = resolved_review
    if resolved_real and not real_name:
        real_name = resolved_real
    if resolved_masked and (not author_name or author_name == '익명'):
        author_name = resolved_masked
    elif real_name and (not author_name or author_name == '익명'):
        author_name = _mask_name(real_name)

    return author_name or '익명', real_name, rating_text, (content_text or '(내용 없음)')


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


def _extract_next_data_outer_html(page: Any) -> str:
    candidates = [
        'script#__NEXT_DATA__',
        'script[type="application/json"]#__NEXT_DATA__',
        'body > script[type="application/json"]',
        'body script[type="application/json"]',
    ]

    for selector in candidates:
        try:
            locator = page.locator(selector).first
            if locator.count() == 0:
                continue
            locator.wait_for(state='attached', timeout=10000)
            outer_html = locator.evaluate('el => el.outerHTML || ""') or ''
            if outer_html:
                return outer_html
        except Exception:
            continue

    try:
        scripts = page.locator('script').evaluate_all(
            """els => els.map(el => ({
                id: el.id || '',
                type: el.type || '',
                outerHTML: el.outerHTML || '',
                text: el.textContent || '',
            }))"""
        )
        for script in scripts or []:
            outer_html = str(script.get('outerHTML', '') or '')
            text = str(script.get('text', '') or '')
            script_id = str(script.get('id', '') or '')
            script_type = str(script.get('type', '') or '')
            if '__NEXT_DATA__' in outer_html or script_id == '__NEXT_DATA__':
                return outer_html
            if script_type == 'application/json' and '"pageProps"' in text and '"session"' in text:
                return f'<script type="application/json">{text}</script>'
    except Exception:
        pass

    try:
        html = page.content()
        match = re.search(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>.*?</script>', html, re.DOTALL)
        if match:
            return match.group(0)
        match = re.search(r'<script[^>]*type=["\']application/json["\'][^>]*>\s*(\{.*?"pageProps".*?\})\s*</script>', html, re.DOTALL)
        if match:
            return f'<script type="application/json">{match.group(1)}</script>'
    except Exception:
        pass

    return ''


def _run_auto_fill_outer_html(email: str, password: str, headless: bool = True) -> str:
    playwright = browser = context = page = None
    try:
        playwright, browser, context, page = _playwright_login_page(email, password, headless=headless)
        page.goto('https://soomgo.com/mypage/cash-dashboard', wait_until='domcontentloaded', timeout=30000)
        page.wait_for_load_state('domcontentloaded')
        try:
            page.wait_for_load_state('networkidle', timeout=10000)
        except Exception:
            pass

        outer_html = _extract_next_data_outer_html(page)
        if outer_html:
            return outer_html

        try:
            page.screenshot(path=str(SCREENSHOT_DIR / 'soomgo_cash_dashboard_missing_next_data.png'), full_page=True)
        except Exception:
            pass
        raise RuntimeError('숨고 대시보드에서 리뷰 데이터를 담은 __NEXT_DATA__ 스크립트를 찾지 못했습니다. 숨고 페이지 구조 변경 또는 로그인 세션 상태를 확인해 주세요.')
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
        try:
            profile_outer_html = _extract_next_data_outer_html(page)
            if profile_outer_html:
                reviews_data = _merge_review_sources(reviews_data, _parse_reviews_from_outer_html(profile_outer_html))
        except Exception:
            pass

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

        preloaded_items = _collect_unanswered_review_items(page)
        review_items = page.locator('.review-list .profile-review-item, .review-list > [id], .review-list [id]')
        try:
            item_count = review_items.count()
        except Exception:
            item_count = 0
        total_items = max(item_count, len(preloaded_items))
        for index in range(total_items):
            if len(found) >= SLOT_COUNT:
                break
            item = review_items.nth(index) if index < item_count else None
            preloaded = preloaded_items[index] if index < len(preloaded_items) and isinstance(preloaded_items[index], dict) else {}
            try:
                if _has_meaningful_reply(preloaded=preloaded, item=item):
                    continue

                if item is not None:
                    masked_name, real_name, rating_text, content_text = _extract_review_item_fields(item, reviews_data, preloaded=preloaded)
                else:
                    masked_name, real_name, rating_text, content_text = _extract_review_item_fields_from_preloaded(preloaded, reviews_data)
                content_text = _normalize_review_text(content_text)
                if not rating_text:
                    rating_text = _extract_rating_value(content_text)
                content_text = _strip_rating_prefix(content_text)
                candidate_lines = []
                if isinstance(preloaded, dict):
                    candidate_lines = (
                        _extract_review_content_rows(preloaded)
                        + [
                            _normalize_review_text(value)
                            for value in (preloaded.get('authorCandidates') or [])
                            if _normalize_review_text(value)
                        ]
                        + _build_review_line_candidates(str(preloaded.get('itemText', '')))
                    )
                if (not content_text or content_text == '(내용 없음)') and candidate_lines:
                    content_text = _pick_review_content_from_lines(candidate_lines, author_name=masked_name, real_name=real_name)
                if (not content_text or content_text == '(내용 없음)') and isinstance(preloaded, dict):
                    fallback_masked, fallback_real, fallback_review = _resolve_review_record_from_outer_html(
                        reviews_data,
                        masked_name or _guess_masked_name_from_item_text(str(preloaded.get('itemText', '')), '', real_name),
                        str(preloaded.get('itemText', '')),
                        candidate_lines,
                    )
                    masked_name = masked_name or fallback_masked
                    real_name = real_name or fallback_real
                    content_text = _strip_rating_prefix(_normalize_review_text(fallback_review or content_text))
                if not content_text or content_text == '(내용 없음)':
                    continue
                if not real_name:
                    real_name = _find_real_name_by_content(reviews_data, content_text)
                if (not masked_name or masked_name == '익명') and real_name:
                    masked_name = _mask_name(real_name)
                if not masked_name:
                    masked_name = _guess_masked_name_from_item_text(str(preloaded.get('itemText', '')) if isinstance(preloaded, dict) else '', content_text, real_name)
                found.append({'masked_name': masked_name, 'real_name': real_name, 'rating': rating_text, 'review': content_text})
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
            slots.append({'index': idx, 'masked_name': '', 'real_name': '', 'rating': '', 'review': '', 'reply': '', 'situation': '', 'specifics': ''})
        slot = slots[idx]
        if idx < len(found):
            slot['masked_name'] = found[idx].get('masked_name', '')
            slot['real_name'] = found[idx].get('real_name', '')
            slot['rating'] = found[idx].get('rating', '')
            slot['review'] = found[idx].get('review', '')
        else:
            slot['masked_name'] = ''
            slot['real_name'] = ''
            slot['rating'] = ''
            slot['review'] = ''
            slot['reply'] = ''
            slot['situation'] = ''
            slot['specifics'] = ''
            continue
        slot['rating'] = slot.get('rating', '')
        slot['reply'] = slot.get('reply', '')
        slot['situation'] = slot.get('situation', '')
        slot['specifics'] = slot.get('specifics', '')

    message = f'총 {len(found)}개의 미답변 리뷰를 찾았습니다.'
    if not found:
        try:
            (SCREENSHOT_DIR / 'soomgo_unanswered_items_debug.json').write_text(
                json.dumps(preloaded_items, ensure_ascii=False, indent=2),
                encoding='utf-8',
            )
        except Exception:
            pass
        if preloaded_items:
            message = '미답변 리뷰 카드까지는 감지되었지만 슬롯 입력용 작성자/리뷰내용 확정에 실패했습니다. review-list 하위 카드 class/id, article>section 순서, review-content 존재 여부를 확인해 주세요. debug json 저장됨'
        else:
            message = '미답변 리뷰 목록은 감지되었지만 작성자/리뷰내용 추출에 실패했습니다. review-list 하위 카드 class/id, article>section 구조, review-content 요소 존재 여부를 확인해 주세요.'
    state['last_scan'] = {
        'ok': True,
        'message': message,
        'updated_at': _current_kst_timestamp(),
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
                'rating': str(src.get('rating', '')),
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
        state['last_scan'] = {'ok': False, 'message': detail, 'updated_at': _current_kst_timestamp(), 'found_count': 0}
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
        state['last_scan'] = {'ok': False, 'message': detail, 'updated_at': _current_kst_timestamp(), 'found_count': 0}
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
