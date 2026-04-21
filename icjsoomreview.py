import tkinter as tk
from tkinter import scrolledtext, messagebox, simpledialog
import json
import difflib
import re
import os
import threading
import time
import traceback
import subprocess 
import ctypes # 🔥 [추가] 윈도우 클립보드 제어용
from ctypes import wintypes # 🔥 [추가] 윈도우 타입 정의
from openai import OpenAI

# Selenium 관련 임포트 (네이버 밴드 기능을 위해 필수)
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class DROPFILES(ctypes.Structure):
    _fields_ = [
        ("pFiles", wintypes.DWORD),
        ("pt", wintypes.POINT),
        ("fNC", wintypes.BOOL),
        ("fWide", wintypes.BOOL),
    ]

def copy_file_to_clipboard(file_path):
    """파일 경로를 윈도우 클립보드에 복사 (탐색기 Ctrl+C와 동일)"""
    if not os.path.exists(file_path):
        return False
    
    abs_path = os.path.abspath(file_path)
    abs_path = os.path.normpath(abs_path) # / -> \ 변환

    files_list = abs_path + "\0\0"
    files_data = files_list.encode("utf-16le")

    offset = ctypes.sizeof(DROPFILES)
    length = len(files_data)
    size = offset + length

    GMEM_MOVEABLE = 0x0002
    GMEM_ZEROINIT = 0x0040
    GHND = GMEM_MOVEABLE | GMEM_ZEROINIT

    hGlobal = ctypes.windll.kernel32.GlobalAlloc(GHND, size)
    if not hGlobal:
        return False

    ptr = ctypes.windll.kernel32.GlobalLock(hGlobal)
    
    try:
        df = DROPFILES()
        df.pFiles = offset
        df.fWide = True
        
        ctypes.memmove(ptr, ctypes.byref(df), ctypes.sizeof(df))
        ctypes.memmove(ptr + offset, files_data, length)
    finally:
        ctypes.windll.kernel32.GlobalUnlock(hGlobal)

    opened = False
    for _ in range(5):
        if ctypes.windll.user32.OpenClipboard(None):
            opened = True
            break
        time.sleep(0.1)
    
    if not opened:
        ctypes.windll.kernel32.GlobalFree(hGlobal)
        return False

    CF_HDROP = 15
    ctypes.windll.user32.EmptyClipboard()
    ctypes.windll.user32.SetClipboardData(CF_HDROP, hGlobal)
    ctypes.windll.user32.CloseClipboard()
    
    return True

last_copy_time = 0

def on_file_click(event, full_path):
    """파일명을 클릭했을 때 복사 실행"""
    global last_copy_time
    current_time = time.time()

    if current_time - last_copy_time < 0.5:
        return

    if copy_file_to_clipboard(full_path):
        last_copy_time = current_time
        
        try:
            x = root.winfo_pointerx() + 15
            y = root.winfo_pointery() + 15
            
            toast = tk.Toplevel(root)
            toast.overrideredirect(True)
            toast.attributes("-topmost", True)
            toast.geometry(f"+{x}+{y}")
            
            frame = tk.Frame(toast, bg="#FFEB3B", bd=1, relief="solid")
            frame.pack()

            lbl = tk.Label(
                frame, 
                text="✅ 파일 복사 완료!\n카톡에 붙여넣기(Ctrl+V) 하세요", 
                bg="#FFEB3B", 
                fg="black", 
                padx=10, 
                pady=5, 
                font=("Arial", 10, "bold")
            )
            lbl.pack()
            
            root.after(1200, lambda: toast.destroy() if toast.winfo_exists() else None)
            
            if 'text_debug' in globals() and text_debug:
                text_debug.insert(tk.END, f"📋 [복사성공] {os.path.basename(full_path)}\n")
                text_debug.see(tk.END)
                
        except Exception as e:
            print(f"토스트 에러: {e}")
    else:
        messagebox.showerror("실패", "클립보드 액세스 실패.\n다시 시도해주세요.")

class CollapsibleFrame(tk.Frame):
    def __init__(self, parent, text="", expanded=True, *args, **kwargs):
        super().__init__(parent, *args, **kwargs)
        self.expanded = expanded
        self.text = text

        self.header_frame = tk.Frame(self, bg="#E0E0E0", bd=1, relief="raised")
        self.header_frame.pack(fill="x")

        self.toggle_btn = tk.Label(
            self.header_frame, 
            text="▼" if expanded else "▶", 
            bg="#E0E0E0", 
            fg="black",
            width=3, 
            cursor="hand2", 
            font=("Arial", 10, "bold")
        )
        self.toggle_btn.pack(side="left")
        self.toggle_btn.bind("<Button-1>", self.toggle)

        self.title_lbl = tk.Label(
            self.header_frame, 
            text=f" {text}", 
            bg="#E0E0E0", 
            fg="black",
            cursor="hand2", 
            font=("Arial", 11, "bold")
        )
        self.title_lbl.pack(side="left", fill="x", expand=True, anchor="w")
        self.title_lbl.bind("<Button-1>", self.toggle)

        self.sub_frame = tk.Frame(self)

        if self.expanded:
            self.sub_frame.pack(fill="both", expand=True, padx=2, pady=2)
        else:
            self.sub_frame.pack_forget()

    def toggle(self, event=None):
        if self.expanded:
            self.sub_frame.pack_forget()
            self.toggle_btn.configure(text="▶")
            self.expanded = False
        else:
            self.sub_frame.pack(fill="both", expand=True, padx=2, pady=2)
            self.toggle_btn.configure(text="▼")
            self.expanded = True
            
    def get_header_frame(self):
        return self.header_frame

api_key = os.environ.get("OPENAI_API_KEY")

if not api_key:
    key_path = os.path.join(os.path.dirname(__file__), "openai_key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            api_key = f.read().strip()

if not api_key:
    raise RuntimeError(
        "OpenAI API 키가 설정되어 있지 않습니다.\n"
        "1) 환경변수 OPENAI_API_KEY 를 설정하거나,\n"
        "2) 이 스크립트와 같은 폴더에 openai_key.txt 파일을 만들고 API 키를 넣어주세요."
    )

client = OpenAI(api_key=api_key)

TOKEN_BUDGET_TOTAL = 100000 
token_usage = {"prompt": 0, "completion": 0, "total": 0, "calls": 0}

if not os.path.exists("reviews.json"):
    dummy = {"props": {"pageProps": {"session": {"me": {"provider": {"reviews": []}}}}}}
    with open("reviews.json", "w", encoding="utf-8") as f:
        json.dump(dummy, f, ensure_ascii=False, indent=2)

PROMPT_FILE = "prompt_config.json"
MEMO_FILE_SOOMGO = "memo_soomgo.txt"
MEMO_FILE_TODAY  = "memo_today.txt"
MEMO_FILE_SITE   = "memo_site.txt"
MEMO_FILE_AUTO_REPLY = "memo_auto_reply.txt"

root = tk.Tk()
root.update_idletasks()
screen_width = root.winfo_screenwidth()
screen_height = root.winfo_screenheight()
window_width = screen_width // 2
window_height = screen_height
x_pos = screen_width - window_width
y_pos = 0
root.geometry(f"{window_width}x{window_height}+{x_pos}+{y_pos}")
root.title("익명 리뷰 → 실명 매칭")

text_debug = None

def log_debug(message):
    print(message)
    if text_debug is not None:
        text_debug.insert(tk.END, f"{message}\n")
        text_debug.see(tk.END)

def create_selectable_label(parent, text, font=None):
    var = tk.StringVar(value=text)
    entry = tk.Entry(
        parent,
        textvariable=var,
        font=font,
        relief="flat",
        borderwidth=0,
        highlightthickness=0,
        state="readonly",
        readonlybackground=parent.cget("bg"),
        takefocus=0,
        cursor="arrow",
    )
    return entry

IS_WINDOWS = (os.name == "nt")
if IS_WINDOWS:
    import ctypes
    user32 = ctypes.windll.user32
    VK_SPACE = 0x20
    VK_BACK = 0x08
    KEYEVENTF_KEYUP = 0x0002

    def _send_vk(vk):
        user32.keybd_event(vk, 0, 0, 0)
        user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)

    def force_commit_ime(event=None):
        widget = root.focus_get()
        if isinstance(widget, (tk.Entry, tk.Text)):
            try:
                _send_vk(VK_SPACE)
                _send_vk(VK_BACK)
            except Exception:
                pass
    root.bind_all("<Button-1>", force_commit_ime, add="+")

def open_soomgo_review_check(headless=True):
    import threading
    import traceback
    import time
    import re
    import os
    import json
    import difflib

    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from webdriver_manager.chrome import ChromeDriverManager
    from selenium.common.exceptions import (
        ElementClickInterceptedException,
        NoSuchElementException,
        TimeoutException,
    )

    # ------------------------------------------------------------
    # 1) outer_html_data에서 reviews_data 확보 (실명 매칭용)
    # ------------------------------------------------------------
    outer_html_data = text_element.get("1.0", tk.END).strip()
    reviews_data = []

    if outer_html_data:
        try:
            match = re.search(r'<script[^>]*>\s*(\{.*?\})\s*</script>', outer_html_data, re.DOTALL)
            if match:
                json_text = match.group(1)
                parsed = json.loads(json_text)
                reviews_data = parsed["props"]["pageProps"]["session"]["me"]["provider"]["reviews"]
                log_debug(f"✅ 비교용 리뷰 데이터 {len(reviews_data)}개 확보 완료")
        except Exception as e:
            log_debug(f"❌ JSON 파싱 실패 (실명 찾기 불가): {e}")

    # ------------------------------------------------------------
    # 2) 리뷰 내용 유사도 기반으로 실명 찾기 (기존 로직 유지)
    # ------------------------------------------------------------
    def find_real_name_by_content(target_content: str) -> str:
        if not reviews_data or not target_content:
            return ""

        best_match_name = ""
        best_score = 0.0

        for review in reviews_data:
            r_content = review.get("contents", "")
            r_author = review.get("author", "")

            score = difflib.SequenceMatcher(None, target_content.strip(), r_content.strip()).ratio()
            if score > best_score:
                best_score = score
                best_match_name = r_author

        if best_score > 0.6:
            return best_match_name
        return ""

    # ------------------------------------------------------------
    # 3) 디버그 하이라이트 함수 (기존 유지)
    #    ※ headless에서도 실행은 되지만 눈으로는 안 보입니다.
    # ------------------------------------------------------------
    def highlight_and_label(driver, element, color, label_prefix=""):
        try:
            js_code = """
            var el = arguments[0];
            var color = arguments[1];
            var prefix = arguments[2];

            el.style.border = '5px solid ' + color;

            var label = document.createElement('div');
            label.className = '__debug_label__';
            label.innerText = '[' + prefix + '] Class: ' + el.className;
            label.style.backgroundColor = color;
            label.style.color = 'white';
            label.style.fontSize = '14px';
            label.style.fontWeight = 'bold';
            label.style.padding = '5px';
            label.style.marginBottom = '5px';
            label.style.zIndex = '99999';
            label.style.width = 'fit-content';
            label.style.userSelect = 'text';

            el.parentNode.insertBefore(label, el);
            """
            driver.execute_script(js_code, element, color, label_prefix)
        except Exception:
            pass

    # ------------------------------------------------------------
    # 4) GUI 슬롯 업데이트/초기화/메모 업데이트 (기존 유지)
    # ------------------------------------------------------------
    def update_gui_slot(index, masked_name, real_name, content):
        if index < 5:
            ar_entry_masked[index].delete(0, tk.END)
            ar_entry_masked[index].insert(0, masked_name)

            ar_entry_real[index].delete(0, tk.END)
            if real_name:
                ar_entry_real[index].insert(0, real_name)
                ar_entry_real[index].config(bg="#FFD700")
            else:
                ar_entry_real[index].insert(0, "(못찾음)")
                ar_entry_real[index].config(bg="#FFF2CC")

            ar_text_reviews[index].delete("1.0", tk.END)
            ar_text_reviews[index].insert("1.0", content)
            ar_text_reviews[index].edit_modified(True)

    def clear_gui_slots():
        for i in range(5):
            ar_entry_masked[i].delete(0, tk.END)
            ar_entry_real[i].delete(0, tk.END)
            ar_text_reviews[i].delete("1.0", tk.END)
            ar_text_replies[i].delete("1.0", tk.END)
            ar_text_situations[i].delete("1.0", tk.END)
            ar_text_specifics[i].delete("1.0", tk.END)

    def update_soomgo_memo_batch(new_names_list):
        if not new_names_list:
            return

        current_content = text_memo_soomgo.get("1.0", tk.END).strip()
        existing_lines = [line.strip() for line in current_content.split('\n') if line.strip()] if current_content else []

        added_count = 0
        for name in new_names_list:
            if name not in existing_lines:
                existing_lines.append(name)
                added_count += 1

        if added_count > 0:
            new_full_text = "\n\n".join(existing_lines)
            text_memo_soomgo.delete("1.0", tk.END)
            text_memo_soomgo.insert("1.0", new_full_text)
            text_memo_soomgo.edit_modified(True)
            log_debug(f"📝 [메모장 업데이트] 신규 고객 {added_count}명 추가됨.")
        else:
            log_debug("📝 [메모장] 추가할 신규 고객이 없거나 이미 존재합니다.")

    # ------------------------------------------------------------
    # 5) 팝업 닫기 (기존 유지/강화)
    # ------------------------------------------------------------
    def close_popups(driver):
        try:
            close_selectors = [
                '//button[contains(@class,"close")]',
                '//button[contains(text(),"닫기")]',
                '//button[contains(text(),"확인")]',
                '//div[@role="dialog"]//button[contains(@class,"close")]',
                '//button[contains(@aria-label,"닫기")]'
            ]
            for selector in close_selectors:
                try:
                    elements = driver.find_elements(By.XPATH, selector)
                    for el in elements:
                        driver.execute_script("arguments[0].click();", el)
                except Exception:
                    continue
        except Exception:
            pass

    # ------------------------------------------------------------
    # 6) 메인 작업 스레드
    # ------------------------------------------------------------
    def task():
        driver = None
        collected_names_for_memo = []

        try:
            log_debug("🚀 [숨고 리뷰 검사] 브라우저 실행 중...")
            root.after(0, clear_gui_slots)

            chrome_options = Options()
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")

            # ✅ Headless(백그라운드) 모드
            if headless:
                chrome_options.add_argument("--headless=new")
                chrome_options.add_argument("--window-size=1920,1080")
                chrome_options.add_argument("--disable-gpu")
            else:
                chrome_options.add_argument("--start-maximized")
                chrome_options.add_experimental_option("detach", True)

            driver = webdriver.Chrome(
                service=Service(ChromeDriverManager().install()),
                options=chrome_options
            )

            log_debug("🔗 숨고 로그인 페이지 접속 중...")
            driver.get("https://soomgo.com/login")

            close_popups(driver)

            log_debug("⏳ 로그인 폼 요소 찾는 중...")
            email_box = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.NAME, "email")))
            pw_box = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.NAME, "password")))

            log_debug("✏️ 계정 정보 입력 중...")
            email_box.clear()
            email_box.send_keys("someaddon@naver.com")
            pw_box.clear()
            pw_box.send_keys("Cji2424!@!@")

            log_debug("🚀 로그인 버튼 클릭...")
            login_btn = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, '//button[@type="submit"]'))
            )
            try:
                login_btn.click()
            except ElementClickInterceptedException:
                close_popups(driver)
                driver.execute_script("arguments[0].click();", login_btn)

            log_debug("⏳ 로그인 완료 대기 중...")
            WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.ID, "app-body")))
            log_debug("✅ 로그인 성공!")

            target_url = "https://soomgo.com/profile#id_profile_review"
            log_debug(f"🔗 프로필 리뷰 탭으로 이동: {target_url}")
            driver.get(target_url)
            time.sleep(1.0)

            log_debug("🔍 'profile-section' 영역 탐색 중...")
            profile_section = WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, ".grid-item.span-8.profile-section"))
            )

            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", profile_section)
            highlight_and_label(driver, profile_section, "red", "전체 섹션")
            time.sleep(0.8)

            review_list = profile_section.find_element(By.CLASS_NAME, "review-list")
            highlight_and_label(driver, review_list, "blue", "리뷰 리스트")

            log_debug("⚡ 리뷰 리스트 확장 시작 (최대 5회 '더보기' 클릭)...")
            for i in range(5):
                try:
                    more_btn = None
                    try:
                        xpath_target = "//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'secondary') and contains(text(), '더보기')]"
                        target_el = driver.find_element(By.XPATH, xpath_target)
                        more_btn = target_el.find_element(By.XPATH, "./ancestor::button")
                    except Exception:
                        more_btn = driver.find_element(By.XPATH, "//button[contains(., '더보기')]")

                    if more_btn:
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", more_btn)
                        time.sleep(0.4)
                        log_debug(f"👇 '리뷰 더보기' 클릭 ({i+1}/5)...")
                        more_btn.click()
                        time.sleep(1.2)
                    else:
                        raise NoSuchElementException

                except NoSuchElementException:
                    log_debug("✅ 더 이상 '더보기' 버튼이 없습니다.")
                    break
                except Exception as e:
                    log_debug(f"⚠️ 더보기 버튼 클릭 중 예외 발생 (중단): {e}")
                    break

            log_debug("⚡ 최종 미답변 리뷰 분석 및 GUI 입력 시작...")

            review_items = review_list.find_elements(By.CSS_SELECTOR, ".profile-review-item")
            found_count = 0

            for index, item in enumerate(review_items):
                try:
                    if found_count >= 5:
                        log_debug("🛑 슬롯 5개가 모두 채워졌습니다.")
                        break

                    review_blocks = item.find_elements(
                        By.XPATH,
                        ".//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'primary') and contains(@class, 'review-content')]"
                    )
                    reply_blocks = item.find_elements(
                        By.XPATH,
                        ".//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'primary') and not(contains(@class, 'review-content'))]"
                    )

                    has_reply = False
                    for block in reply_blocks:
                        text_value = (block.text or '').strip()
                        if text_value and text_value != '더보기':
                            has_reply = True
                            break

                    if has_reply:
                        continue

                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", item)
                    time.sleep(0.1)
                    highlight_and_label(driver, item, "#00aa00", f"{found_count+1}번 미답변")

                    content_text = ""
                    try:
                        if review_blocks:
                            content_text = (review_blocks[0].text or '').strip()
                        if not content_text:
                            content_el = item.find_element(
                                By.XPATH,
                                ".//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'primary') and contains(@class, 'review-content')]"
                            )
                            content_text = (content_el.text or '').strip()
                    except Exception:
                        try:
                            content_el = item.find_element(By.CSS_SELECTOR, ".review-content")
                            content_text = (content_el.text or '').strip()
                        except Exception:
                            content_text = "(내용 없음)"

                    author_name = ""
                    try:
                        author_el = item.find_element(
                            By.XPATH,
                            ".//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:semibold') and contains(@class, 'primary')]"
                        )
                        author_name = author_el.text
                    except Exception:
                        author_name = "익명"

                    found_real_name = find_real_name_by_content(content_text)

                    if found_real_name:
                        log_debug(f"🔎 실명 발견! [{author_name}] -> [{found_real_name}]")
                    else:
                        log_debug("⚠️ 실명 찾기 실패 (유사한 내용 없음)")

                    target_name_for_file = found_real_name if found_real_name else author_name
                    collected_names_for_memo.append(target_name_for_file)

                    # 리뷰 내 '더보기'(내용 확장) 클릭 시도
                    try:
                        expand_btn = item.find_element(
                            By.XPATH,
                            ".//*[contains(@class, 'prisma-typography') and contains(@class, 'body14:regular') and contains(@class, 'tertiary') and contains(text(), '더보기')]"
                        )
                        if expand_btn.is_displayed():
                            driver.execute_script("arguments[0].click();", expand_btn)
                            time.sleep(0.4)
                    except Exception:
                        pass

                    # 스크린샷 저장
                    try:
                        if not os.path.exists(TARGET_FILE_DIR):
                            os.makedirs(TARGET_FILE_DIR)

                        safe_name = re.sub(r'[\\/*?:"<>|]', "", target_name_for_file).strip()
                        filename = f"숨고 ({safe_name}).png"
                        full_save_path = os.path.join(TARGET_FILE_DIR, filename)

                        clean_js = """
                        var root = arguments[0];
                        root.style.border = 'none';
                        var all_elements = root.querySelectorAll('*');
                        for (var i = 0; i < all_elements.length; i++) {
                            all_elements[i].style.border = 'none';
                        }
                        var labels = root.querySelectorAll('.__debug_label__');
                        for (var j = 0; j < labels.length; j++) {
                            labels[j].remove();
                        }
                        """
                        driver.execute_script(clean_js, item)
                        time.sleep(0.1)

                        item.screenshot(full_save_path)
                        log_debug(f"📸 [캡처저장] {filename}")
                        root.after(0, refresh_file_list)

                    except Exception as shot_err:
                        log_debug(f"⚠️ 스크린샷 저장 실패: {shot_err}")

                    root.after(0, update_gui_slot, found_count, author_name, found_real_name, content_text)
                    log_debug(f"📝 [Slot {found_count+1}] 입력 완료")
                    found_count += 1

                except Exception as inner_e:
                    log_debug(f"⚠️ {index+1}번 아이템 분석 중 오류 (건너뜀): {inner_e}")
                    continue

            if collected_names_for_memo:
                root.after(0, lambda: update_soomgo_memo_batch(collected_names_for_memo))

            if found_count > 0:
                msg = f"검사 완료!\n총 {found_count}개의 미답변 리뷰를 찾아서\nGUI 메모장에 입력했습니다."
                log_debug(msg.replace("\n", " "))
                messagebox.showinfo("검사 완료", msg)
            else:
                msg = "검사 완료!\n미답변 리뷰를 찾지 못했습니다 (모두 답변 완료)."
                log_debug(msg.replace("\n", " "))
                messagebox.showinfo("검사 완료", msg)

        except Exception as e:
            log_debug(f"💥 검사 중 오류 발생: {e}")
            log_debug(traceback.format_exc())
            messagebox.showerror("오류", f"진행 중 문제가 발생했습니다:\n{e}")

        finally:
            if driver:
                try:
                    driver.quit()
                except Exception:
                    pass

    threading.Thread(target=task).start()


default_prompt_text = (
    "1. 고객님 리뷰 문맥을 자연스럽게 반영할 것\n"
    "2. 긍정적 표현과 친절한 톤 유지\n"
    "3. 부정적 이슈는 공감 및 해결 의지 표명\n"
    "4. '!' '~' 'ㅎㅎ' '^^' 를 자연스럽게 사용\n"
    "5. 업계 전문가답게 정확한 어휘 사용\n"
)

if not os.path.exists(PROMPT_FILE):
    with open(PROMPT_FILE, "w", encoding="utf-8") as f:
        json.dump({"prompt": default_prompt_text}, f, ensure_ascii=False, indent=2)

def load_prompt():
    try:
        with open(PROMPT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("prompt", "")
    except:
        return default_prompt_text

def save_prompt(new_text):
    with open(PROMPT_FILE, "w", encoding="utf-8") as f:
        json.dump({"prompt": new_text}, f, ensure_ascii=False, indent=2)

def similarity(a, b):
    return difflib.SequenceMatcher(None, a.strip(), b.strip()).ratio()

def extract_element_name(input_text):
    try:
        parsed = json.loads(input_text)
        reviews = parsed["props"]["pageProps"]["session"]["me"]["provider"]["reviews"]
        return [r["author"] for r in reviews if "author" in r]
    except Exception:
        pass

    match = re.search(r'<span[^>]*>(.*?)</span>', input_text)
    if match:
        return [match.group(1).strip()]
    return []

frame_input = tk.Frame(root)
frame_input.pack(pady=2, padx=2, fill=tk.X)

_c_frame_left = CollapsibleFrame(frame_input, text="① outer HTML 코드")
_c_frame_left.pack(side=tk.LEFT, padx=2, fill=tk.BOTH, expand=True)

frame_left = _c_frame_left.sub_frame

label_element = create_selectable_label(
    frame_left,
    "리뷰 요소 전체 HTML (예: <span ...>내용</span>):"
)
label_element.pack(anchor='w', fill="x")

text_element = scrolledtext.ScrolledText(frame_left, width=50, height=3, font=("Arial", 10), undo=True, maxundo=-1)
text_element.pack(fill=tk.X, expand=False)

_c_frame_right = CollapsibleFrame(frame_input, text="② 익명 이름 + 리뷰 내용")
_c_frame_right.pack(side=tk.LEFT, padx=2, fill=tk.BOTH, expand=True)

frame_right = _c_frame_right.sub_frame

label_name = create_selectable_label(
    frame_right,
    "익명 이름 (예: 김**):"
)
label_name.pack(anchor='w', fill="x")

entry_name = tk.Entry(frame_right, width=30, font=("Arial", 10))
entry_name.pack(fill=tk.X)

label_review = create_selectable_label(
    frame_right,
    "리뷰 내용 일부:"
)
label_review.pack(anchor='w', fill="x")

text_review = scrolledtext.ScrolledText(frame_right, width=50, height=3, font=("Arial", 10), undo=True, maxundo=-1)
text_review.pack(fill=tk.X, expand=False)

frame_buttons = tk.Frame(root)
frame_buttons.pack(pady=2)

def open_soomgo_review():
    import webbrowser
    webbrowser.open("https://soomgo.com/profile#id_profile_review")

def open_soomgo_cash():
    import webbrowser
    webbrowser.open("https://soomgo.com/mypage/cash-dashboard")

def auto_fill_outer_html(autorun_review_check=False):
    import threading
    import traceback
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import (
        TimeoutException,
        NoSuchElementException,
        WebDriverException,
        ElementClickInterceptedException,
    )
    from webdriver_manager.chrome import ChromeDriverManager

    chrome_options = Options()
    chrome_options.add_argument("--start-maximized")
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")

    def close_popups(driver):
        log_debug("🧩 팝업 탐색 및 닫기 시도 중...")
        close_selectors = [
            '//button[contains(@class,"close")]',
            '//button[contains(text(),"닫기")]',
            '//button[contains(text(),"확인")]',
            '//div[@role="dialog"]//button[contains(@class,"close")]',
            '//button[contains(@aria-label,"닫기")]'
        ]
        for selector in close_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for el in elements:
                    driver.execute_script("arguments[0].click();", el)
                    log_debug(f"✅ 팝업 닫기 성공 (셀렉터: {selector})")
            except Exception:
                continue
        try:
            cookie_btn = driver.find_element(By.XPATH, '//button[contains(text(),"동의")]')
            driver.execute_script("arguments[0].click();", cookie_btn)
            log_debug("✅ 쿠키 동의 배너 닫기 완료")
        except Exception:
            pass

    def task():
        driver = None
        try:
            log_debug("🌐 ChromeDriver 초기화 중...")
            driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
            log_debug("✅ ChromeDriver 실행 성공!")

            log_debug("🔗 숨고 로그인 페이지 접속 중...")
            driver.get("https://soomgo.com/login")

            close_popups(driver)

            log_debug("⏳ 로그인 폼 요소 로드 대기 중...")
            email_box = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.NAME, "email")))
            pw_box = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.NAME, "password")))

            log_debug("✏️ 이메일 / 비밀번호 입력 중...")
            email_box.clear()
            email_box.send_keys("someaddon@naver.com")
            pw_box.clear()
            pw_box.send_keys("Cji2424!@!@")

            log_debug("🚀 로그인 버튼 클릭 시도 중...")
            try:
                login_button = WebDriverWait(driver, 10).until(
                    EC.element_to_be_clickable((By.XPATH, '//button[@type="submit"]'))
                )
                login_button.click()
                log_debug("✅ 로그인 버튼 클릭 성공!")
            except ElementClickInterceptedException:
                log_debug("⚠️ 팝업에 의해 로그인 버튼 클릭 차단됨 → 팝업 닫고 재시도...")
                close_popups(driver)
                login_button = WebDriverWait(driver, 10).until(
                    EC.element_to_be_clickable((By.XPATH, '//button[@type="submit"]'))
                )
                driver.execute_script("arguments[0].click();", login_button)
                log_debug("✅ 팝업 닫은 후 로그인 버튼 클릭 성공!")

            log_debug("⏳ 로그인 성공 대기 중 (app-body 탐색)...")
            WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.ID, "app-body")))
            log_debug("✅ 로그인 완료!")

            log_debug("📄 cash-dashboard 페이지로 이동 중...")
            driver.get("https://soomgo.com/mypage/cash-dashboard")

            log_debug("⏳ 스크립트 요소 로드 대기 (/html/body/script[1])...")
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.XPATH, "/html/body/script[1]"))
            )

            log_debug("🧩 스크립트 요소 추출 중...")
            script_element = driver.find_element(By.XPATH, "/html/body/script[1]")
            outer_html = driver.execute_script("return arguments[0].outerHTML;", script_element)

            # ✅ UI 업데이트는 메인스레드에서 실행
            def _apply_outer_html_and_run_next():
                text_element.delete("1.0", tk.END)
                text_element.insert(tk.END, outer_html)
                log_debug("✅ outer HTML 코드가 text_element에 입력되었습니다.")

                # (선택) 기존 알림 유지
                # ※ 이 messagebox는 블로킹이라, 자동 연속 실행이 더 중요하면 주석 처리 권장
                # messagebox.showinfo("완료", "outer HTML 코드가 자동으로 입력되었습니다.")

                # ✅ 여기서 바로 '숨고 리뷰 검사' 로직 자동 실행
                if autorun_review_check:
                    log_debug("➡️ outer HTML 입력 완료 → '숨고 리뷰 검사' 자동 실행")
                    root.after(200, lambda: open_soomgo_review_check(headless=True))

            root.after(0, _apply_outer_html_and_run_next)

        except Exception as e:
            log_debug(f"⚠️ 오류 발생: {e}")
            messagebox.showerror("실패", f"outer HTML 추출 실패:\n{e}")
        finally:
            if driver:
                try:
                    driver.quit()
                except Exception:
                    pass

    threading.Thread(target=task).start()


# ✅ 프로그램 시작 시: outer HTML 자동 채우기 → 완료되면 즉시 숨고 리뷰 검사까지 자동 실행
root.after(100, lambda: auto_fill_outer_html(autorun_review_check=True))


def _find_best_match_impl():
    anonymous_name = entry_name.get().strip()
    review_input = text_review.get("1.0", tk.END).strip()
    element_input = text_element.get("1.0", tk.END).strip()

    if not anonymous_name or not review_input or not element_input:
        messagebox.showerror("입력 오류", "모든 필드를 입력해주세요.")
        return

    json_match = re.search(r'<script[^>]*>\s*(\{.*?\})\s*</script>', element_input, re.DOTALL)
    if not json_match:
        messagebox.showerror("오류", "outer HTML에서 JSON 데이터를 찾을 수 없습니다.")
        return

    json_text = json_match.group(1)
    try:
        parsed_json = json.loads(json_text)
        reviews = parsed_json["props"]["pageProps"]["session"]["me"]["provider"]["reviews"]
    except Exception as e:
        messagebox.showerror("파싱 오류", f"리뷰 데이터를 파싱하는 중 오류 발생: {e}")
        return

    best_score = 0.0
    candidates = []

    for review in reviews:
        author = review.get("author", "")
        contents = review.get("contents", "")

        if not author or not contents:
            continue

        if not author.startswith(anonymous_name[0]):
            continue

        score = similarity(review_input, contents)

        if score > best_score:
            best_score = score

        if score > 0.3:
            candidates.append((author, score))

    text_result_name.configure(state='normal')
    text_result_name.delete("1.0", tk.END)
    text_result_name.config(fg="black")

    text_result_score.configure(state='normal')
    text_result_score.delete("1.0", tk.END)
    text_result_score.config(fg="black")

    if candidates:
        candidates.sort(key=lambda x: x[1], reverse=True)
        for author, score in candidates:
            text_result_name.insert(tk.END, f"{author}\n")
            text_result_score.insert(tk.END, f"{author}: {score * 100:.2f}%\n")
    else:
        text_result_name.insert(tk.END, "일치하는 후보를 찾지 못했습니다.\n")
        text_result_score.insert(tk.END, f"최대 유사도: {best_score * 100:.2f}%\n")

    text_result_name.configure(state='disabled')
    text_result_score.configure(state='disabled')

def find_best_match():
    root.after(1, _find_best_match_impl)

btn_open_review = tk.Button(frame_buttons, text="1. 숨고 리뷰 접속",
                            command=open_soomgo_review, font=("Arial", 12))
btn_open_review.pack(side=tk.LEFT, padx=2)

btn_outer_html = tk.Button(frame_buttons, text="2. outer HTML 코드 자동 채우기",
                           command=auto_fill_outer_html, font=("Arial", 12))
btn_outer_html.pack(side=tk.LEFT, padx=2)

btn_match = tk.Button(frame_buttons, text="3. 작성자 찾기",
                      command=find_best_match, font=("Arial", 12))
btn_match.pack(side=tk.LEFT, padx=2)

btn_open_cash = tk.Button(frame_buttons, text="💰 숨고 캐쉬 접속",
                          command=open_soomgo_cash, font=("Arial", 12))
btn_open_cash.pack(side=tk.LEFT, padx=2)

_c_frame_result = CollapsibleFrame(root, text="③ 결과 확인 및 입력 (4분할)")
_c_frame_result.pack(padx=2, pady=(2, 0), fill=tk.BOTH, expand=False)

frame_result = _c_frame_result.sub_frame

frame_result.grid_columnconfigure(0, weight=1, uniform="group1")
frame_result.grid_columnconfigure(1, weight=1, uniform="group1")
frame_result.grid_columnconfigure(2, weight=1, uniform="group1")
frame_result.grid_columnconfigure(3, weight=1, uniform="group1")

frame_result_left = tk.Frame(frame_result)
frame_result_left.grid(row=0, column=0, padx=(0, 2), sticky="nsew")

label_result_title = create_selectable_label(
    frame_result_left,
    "리뷰작성자", 
    font=("Arial", 11, "bold")
)
label_result_title.pack(anchor='w', fill="x")

text_result_name = scrolledtext.ScrolledText(
    frame_result_left,
    font=("Consolas", 10),
    height=1, 
    undo=True,
    maxundo=-1
)
text_result_name.pack(fill=tk.X, expand=False, pady=(2, 2))

text_result_score = scrolledtext.ScrolledText(
    frame_result_left,
    font=("Consolas", 10),
    height=1, 
    undo=True,
    maxundo=-1
)
text_result_score.pack(fill=tk.X, expand=False, pady=(2, 0))

frame_memo = tk.Frame(frame_result)
frame_memo.grid(row=0, column=1, padx=(0, 2), sticky="nsew")

label_memo_title = create_selectable_label(
    frame_memo,
    "고객리뷰", 
    font=("Arial", 11, "bold")
)
label_memo_title.pack(anchor='w', fill="x")

text_memo = scrolledtext.ScrolledText(frame_memo, font=("Arial", 10), height=1, undo=True, maxundo=-1)
text_memo.pack(fill=tk.X, expand=False)

frame_auto_fill = tk.Frame(frame_result)
frame_auto_fill.grid(row=0, column=2, padx=(0, 2), sticky="nsew")

label_auto_fill_title = create_selectable_label(
    frame_auto_fill,
    "이사현장", 
    font=("Arial", 11, "bold")
)
label_auto_fill_title.pack(anchor='w', fill="x")

text_auto_fill = scrolledtext.ScrolledText(frame_auto_fill, font=("Arial", 10), height=1, undo=True, maxundo=-1)
text_auto_fill.pack(fill=tk.X, expand=False)

frame_right_extra = tk.Frame(frame_result)
frame_right_extra.grid(row=0, column=3, sticky="nsew")

label_fixed_title = create_selectable_label(
    frame_right_extra,
    "특이사항", 
    font=("Arial", 11, "bold")
)
label_fixed_title.pack(anchor='w', fill="x")

text_fixed = scrolledtext.ScrolledText(frame_right_extra, font=("Arial", 10), height=1)
text_fixed.pack(fill=tk.X, expand=False)

def setup_placeholder(widget, placeholder_text):
    widget._placeholder_active = True
    widget.insert("1.0", placeholder_text)
    widget.config(fg="gray")

    def clear_placeholder_if_needed():
        if getattr(widget, "_placeholder_active", False):
            widget.delete("1.0", tk.END)
            widget.config(fg="black")
            widget._placeholder_active = False

    def on_focus_in(event):
        clear_placeholder_if_needed()

    def on_key(event):
        if getattr(widget, "_placeholder_active", False):
            clear_placeholder_if_needed()

    widget.bind("<FocusIn>", on_focus_in, add="+")
    widget.bind("<Key>", on_key, add="+")

memo_placeholder = "1. (고객이 작성한 리뷰 전체를 붙여넣기)"
setup_placeholder(text_memo, memo_placeholder)

auto_placeholder = "1. (현장 대표님이 느낀 현장상황에 대해 길게 작성)"
setup_placeholder(text_auto_fill, auto_placeholder)

special_placeholder = (
    "1. 고객님은 칠절하게 우리를 맞이 해주셨어\n"
    "2. 당일 아메리카노 2잔과 빵을 주셨어\n"
    "3. 팁 10만원을 챙겨주셨어"
)
setup_placeholder(text_fixed, special_placeholder)

name_placeholder = "(이름)"
score_placeholder = "(유사도퍼센트)"
setup_placeholder(text_result_name, name_placeholder)
setup_placeholder(text_result_score, score_placeholder)

TARGET_FILE_DIR = r"G:\내 드라이브\1. 이청잘\이청잘 견적서\임시저장사진\1. 리뷰"

_c_frame_prompt_ai = CollapsibleFrame(root, text="④ 프롬프트 / AI / 파일 관리")
_c_frame_prompt_ai.pack(fill=tk.BOTH, padx=2, pady=(0, 2), expand=False)

frame_prompt_ai = _c_frame_prompt_ai.sub_frame

frame_prompt_ai.grid_columnconfigure(0, weight=1, uniform="mid_group")
frame_prompt_ai.grid_columnconfigure(1, weight=1, uniform="mid_group")
frame_prompt_ai.grid_columnconfigure(2, weight=1, uniform="mid_group")

lbl_prompt_title = create_selectable_label(
    frame_prompt_ai, 
    "챗 GPT가 '리뷰초안' 생성간 기준으로 해야할 프롬프트", 
    font=("Arial", 11, "bold")
)
frame_prompt = tk.LabelFrame(frame_prompt_ai, labelwidget=lbl_prompt_title)
frame_prompt.grid(row=0, column=0, sticky="nsew", padx=(0, 2))

text_prompt = scrolledtext.ScrolledText(frame_prompt, font=("Arial", 10), height=1)
text_prompt.pack(fill=tk.X, expand=False)

text_prompt.insert("1.0", load_prompt())
text_prompt.config(state="disabled")

edit_mode = {"active": False}

def enable_prompt_edit():
    if not messagebox.askyesno("확인", "정말로 수정하시겠습니까?"):
        return
    if not messagebox.askyesno("최종 확인", "해당 내용은 프로그램 종료 후에도 유지됩니다.\n정말 수정모드를 활성화할까요?"):
        return

    edit_mode["active"] = True
    text_prompt.config(state="normal")
    messagebox.showinfo("수정 가능", "이제 텍스트를 수정할 수 있습니다.")

def save_prompt_edit():
    if not edit_mode["active"]:
        messagebox.showerror("오류", "수정 모드가 아닙니다.\n'수정하기' 버튼을 먼저 눌러주세요.")
        return

    new_text = text_prompt.get("1.0", tk.END).strip()
    save_prompt(new_text)

    text_prompt.config(state="disabled")
    edit_mode["active"] = False
    messagebox.showinfo("저장 완료", "프롬프트 내용이 저장되었습니다.")

btn_prompt_frame = tk.Frame(frame_prompt)
btn_prompt_frame.pack(fill=tk.X, pady=1)

btn_edit_prompt = tk.Button(btn_prompt_frame, text="✏ 수정하기", font=("Arial", 12),
                            command=enable_prompt_edit)
btn_edit_prompt.pack(side=tk.LEFT, padx=2)

btn_save_prompt = tk.Button(btn_prompt_frame, text="💾 저장하기", font=("Arial", 12),
                            command=save_prompt_edit)
btn_save_prompt.pack(side=tk.LEFT, padx=2)

lbl_ai_title = create_selectable_label(frame_prompt_ai, "AI 리뷰 답변 도구", font=("Arial", 11, "bold"))
frame_ai_tools = tk.LabelFrame(frame_prompt_ai, labelwidget=lbl_ai_title)
frame_ai_tools.grid(row=0, column=1, sticky="nsew", padx=(2, 2))

label_ai_result = create_selectable_label(
    frame_ai_tools,
    "리뷰답변 초안내용(결과)",
    font=("Arial", 11, "bold")
)
label_ai_result.pack(anchor='w', fill="x")

text_ai_result = scrolledtext.ScrolledText(frame_ai_tools, font=("Arial", 10), height=1, undo=True)
text_ai_result.pack(fill=tk.X, expand=False)

frame_auto_reply_container = CollapsibleFrame(root, text="⑤ 자동 리뷰 답변 메모장 (5개 슬롯)")
frame_auto_reply_container.pack(fill=tk.BOTH, padx=2, pady=(0, 2), expand=False)

header_area = frame_auto_reply_container.get_header_frame()

def generate_all_slots_drafts():
    import threading
    
    def run_batch():
        processed_count = 0
        log_debug("🚀 [일괄 생성] 작업을 시작합니다...")
        
        for i in range(5):
            review_text = ar_text_reviews[i].get("1.0", tk.END).strip()
            if not review_text:
                continue
                
            try:
                _generate_slot_draft_impl(i)
                processed_count += 1
                time.sleep(0.5) 
            except Exception as e:
                log_debug(f"⚠️ [Slot {i+1}] 생성 중 오류: {e}")

        if processed_count > 0:
            log_debug(f"✅ [일괄 생성] 총 {processed_count}건 완료.")
            messagebox.showinfo("완료", f"총 {processed_count}건의 리뷰 답글 생성이 완료되었습니다.")
        else:
            messagebox.showinfo("알림", "입력된 리뷰 내용이 없어 생성할 답글이 없습니다.")

    threading.Thread(target=run_batch).start()

def transfer_names_to_memo():
    names_to_add = []
    for i, entry in enumerate(ar_entry_real):
        name = entry.get().strip()
        if name and name != "(못찾음)":
            names_to_add.append(name)
    
    if not names_to_add:
        messagebox.showinfo("알림", "복사할 실명 정보가 없습니다.\n(실명 칸이 비어있거나 '(못찾음)' 상태입니다)")
        return

    formatted_text = "\n\n".join(names_to_add)
    
    try:
        current_content = text_memo_soomgo.get("1.0", tk.END).strip()
        prefix = "\n\n" if current_content else ""
        text_to_insert = prefix + formatted_text + "\n"
        
        text_memo_soomgo.insert(tk.END, text_to_insert)
        text_memo_soomgo.see(tk.END)
        text_memo_soomgo.edit_modified(True)
        
        messagebox.showinfo("완료", f"총 {len(names_to_add)}명의 실명이 '1. 숨고' 메모장에 추가되었습니다.")
    except NameError:
        messagebox.showerror("오류", "메모장 위젯을 찾을 수 없습니다.")

btn_review_check = tk.Button(
    header_area,
    text="🔍 숨고 리뷰 검사",
    font=("Arial", 9, "bold"),
    bg="#FF9800",
    fg="white",
    padx=5,
    command=lambda: open_soomgo_review_check(headless=True)
)
btn_review_check.pack(side=tk.LEFT, padx=(15, 5)) 

btn_batch_all = tk.Button(
    header_area,
    text="⚡ 일괄 생성",
    font=("Arial", 9, "bold"),
    bg="#673AB7",
    fg="white",
    padx=5,
    command=generate_all_slots_drafts
)
btn_batch_all.pack(side=tk.LEFT, padx=(0, 5))

btn_transfer_names = tk.Button(
    header_area,
    text="📋 실명 메모",
    font=("Arial", 9, "bold"),
    bg="#009688",
    fg="white",
    padx=5,
    command=transfer_names_to_memo
)
btn_transfer_names.pack(side=tk.LEFT, padx=5)

frame_auto_reply = frame_auto_reply_container.sub_frame

for i in range(5):
    frame_auto_reply.grid_columnconfigure(i, weight=1, uniform="group_ar")

ar_entry_masked = []    
ar_entry_real = []      
ar_text_reviews = []    
ar_text_replies = []    
ar_text_situations = [] 
ar_text_specifics = []  

def save_auto_reply_slots(event=None):
    data_list = []
    for i in range(5):
        data_list.append({
            "masked": ar_entry_masked[i].get().strip(), 
            "real": ar_entry_real[i].get().strip(), 
            "review": ar_text_reviews[i].get("1.0", tk.END).strip(),
            "reply": ar_text_replies[i].get("1.0", tk.END).strip(),
            "situation": ar_text_situations[i].get("1.0", tk.END).strip(),
            "specifics": ar_text_specifics[i].get("1.0", tk.END).strip()
        })
    try:
        with open(MEMO_FILE_AUTO_REPLY, "w", encoding="utf-8") as f:
            json.dump(data_list, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"메모 저장 오류: {e}")
    if event and isinstance(event.widget, (tk.Text, scrolledtext.ScrolledText)):
        event.widget.edit_modified(False)

def load_auto_reply_slots():
    if not os.path.exists(MEMO_FILE_AUTO_REPLY): return
    try:
        with open(MEMO_FILE_AUTO_REPLY, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content: return
            data_list = json.loads(content)

        for i, data in enumerate(data_list):
            if i >= 5: break
            ar_entry_masked[i].delete(0, tk.END)
            ar_entry_masked[i].insert(0, data.get("masked", "")) 
            ar_entry_real[i].delete(0, tk.END)
            ar_entry_real[i].insert(0, data.get("real", ""))

            old_content = data.get("content", "") 
            ar_text_reviews[i].delete("1.0", tk.END)
            ar_text_reviews[i].insert("1.0", data.get("review", old_content))
            ar_text_reviews[i].edit_modified(False)

            ar_text_replies[i].delete("1.0", tk.END)
            ar_text_replies[i].insert("1.0", data.get("reply", ""))
            ar_text_replies[i].edit_modified(False)

            ar_text_situations[i].delete("1.0", tk.END)
            ar_text_situations[i].insert("1.0", data.get("situation", ""))
            ar_text_situations[i].edit_modified(False)

            ar_text_specifics[i].delete("1.0", tk.END)
            ar_text_specifics[i].insert("1.0", data.get("specifics", ""))
            ar_text_specifics[i].edit_modified(False)
    except Exception as e:
        print(f"메모 로드 오류: {e}")

def _generate_slot_draft_impl(index):
    if token_usage["total"] >= TOKEN_BUDGET_TOTAL:
        msg = "챗 GPT 토큰 사용량 초과"
        ar_text_replies[index].delete("1.0", tk.END)
        ar_text_replies[index].insert(tk.END, msg)
        log_debug(f"⛔ [Slot {index+1}] 토큰 초과")
        return

    customer_review = ar_text_reviews[index].get("1.0", tk.END).strip()
    field_status = ar_text_situations[index].get("1.0", tk.END).strip()
    special_note = ar_text_specifics[index].get("1.0", tk.END).strip()

    if not customer_review: return

    gave_food = False
    if special_note:
        food_keywords = ["커피", "아메리카노", "라떼", "음료", "빵", "간식", "과자", "과일", "떡", "점심", "식사", "밥", "치킨", "피자", "다과"]
        for kw in food_keywords:
            if kw in special_note:
                gave_food = True
                break

    if gave_food:
        special_food_instruction = """
[특별 감사 표현 지시사항]
현장 특이사항에 따르면 고객님께서 작업 중에 음식/음료를 챙겨주셨습니다.
리뷰 답변에서 이 부분에 대한 감사 인사를 꼭 1~2문장 이상, 구체적으로 표현해 주세요.
"""
    else:
        special_food_instruction = """
[음식 관련 금지 지시사항]
현장 특이사항에 음식/음료 제공에 대한 내용이 전혀 없습니다.
이번 리뷰 답변에서는 고객님이 커피, 간식, 식사, 음료 등을 챙겨주셨다는 내용을 절대 만들지 마세요.
"""

    prompt_text = text_prompt.get("1.0", tk.END).strip()
    combined_prompt = f"""
너는 이사 전문 업체 '이청잘'의 리뷰 답글을 대신 작성해 주는 전문가야.
입력된 [고객리뷰]에만 답변하고, 없는 사실(음식 등)을 지어내지 마라.

[리뷰 답변 작성 기준]
{prompt_text}

[고객리뷰]
{customer_review}

[리뷰 내용 일부]
{customer_review}

[이사현장상황]
{field_status if field_status else "(입력 없음)"}

[현장 특이사항]
{special_note if special_note else "(입력 없음)"}
{special_food_instruction}

작성 규칙:
1. 한국어 작성, 5~10문장 내외.
2. [고객리뷰] 내용 중심.
3. 현장 상황/특이사항은 고객이 알면 좋은 내용만 자연스럽게 반영.
4. '!', '~', 'ㅎㅎ', '^^' 적절히 사용.
5. '이청잘' 상호명 자연스럽게 언급.
"""

    try:
        log_debug(f"🤖 [Slot {index+1}] ChatGPT 요청 중...")
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "너는 이사 전문 업체 '이청잘'의 리뷰 답글 작성 AI다."},
                {"role": "user", "content": combined_prompt},
            ],
            temperature=0.7,
        )
        reply = completion.choices[0].message.content.strip()
        
        usage = getattr(completion, "usage", None)
        if usage:
            token_usage["total"] += getattr(usage, "total_tokens", 0)

        ar_text_replies[index].delete("1.0", tk.END)
        ar_text_replies[index].insert(tk.END, reply)
        ar_text_replies[index].edit_modified(True)
        save_auto_reply_slots()
        log_debug(f"✅ [Slot {index+1}] 생성 완료.")

    except Exception as e:
        error_msg = f"오류: {e}"
        ar_text_replies[index].delete("1.0", tk.END)
        ar_text_replies[index].insert(tk.END, error_msg)
        log_debug(f"💥 [Slot {index+1}] {error_msg}")

def generate_slot_draft(index):
    customer_review = ar_text_reviews[index].get("1.0", tk.END).strip()
    if not customer_review:
        messagebox.showerror("입력 오류", "리뷰 내용이 비어있습니다.")
        return
    root.after(1, lambda: _generate_slot_draft_impl(index))

for i in range(5):
    slot_frame = tk.Frame(frame_auto_reply, bd=1, relief="solid")
    slot_frame.grid(row=0, column=i, padx=2, pady=2, sticky="nsew")
    
    name_frame = tk.Frame(slot_frame, bg="#E0E0E0")
    name_frame.pack(fill="x")
    
    tk.Label(name_frame, text=f"가명", font=("Arial", 8), bg="#E0E0E0").pack(side=tk.LEFT, padx=(2,0))
    entry_m = tk.Entry(name_frame, font=("Arial", 9), justify="center", bg="#F0F0F0", width=6)
    entry_m.pack(side=tk.LEFT, fill="x", expand=True, padx=(1, 1), pady=1)
    entry_m.bind("<KeyRelease>", save_auto_reply_slots)
    ar_entry_masked.append(entry_m)

    tk.Label(name_frame, text=f"실명", font=("Arial", 8), bg="#E0E0E0").pack(side=tk.LEFT, padx=(2,0))
    entry_r = tk.Entry(name_frame, font=("Arial", 9, "bold"), justify="center", bg="#FFF2CC", width=6)
    entry_r.pack(side=tk.LEFT, fill="x", expand=True, padx=(0, 1), pady=1)
    entry_r.bind("<KeyRelease>", save_auto_reply_slots)
    
    def copy_real_name(event):
        widget = event.widget
        text = widget.get().strip()
        if text:
            root.clipboard_clear()
            root.clipboard_append(text)
            show_copy_toast(event, message="글자복사완료")
    
    entry_r.bind("<Button-1>", copy_real_name)
    ar_entry_real.append(entry_r)

    btn_draft = tk.Button(
        slot_frame, 
        text="📝 리뷰초안생성", 
        font=("Arial", 8, "bold"), 
        bg="#E8F0FE",
        command=lambda index=i: generate_slot_draft(index)
    )
    btn_draft.pack(fill="x", padx=1, pady=(0, 2))

    quad_frame = tk.Frame(slot_frame)
    quad_frame.pack(fill="both", expand=True)
    quad_frame.grid_columnconfigure(0, weight=1)
    quad_frame.grid_columnconfigure(1, weight=1)
    quad_frame.grid_rowconfigure(0, weight=1)
    quad_frame.grid_rowconfigure(1, weight=1)

    box_font = ("Arial", 8)

    cell_tl = tk.Frame(quad_frame)
    cell_tl.grid(row=0, column=0, sticky="nsew", padx=1, pady=1)
    tk.Label(cell_tl, text="리뷰 내용", font=("Arial", 8, "bold"), anchor="w", bg="#f5f5f5").pack(fill="x")
    txt_review = scrolledtext.ScrolledText(cell_tl, font=box_font, height=3)
    txt_review.pack(fill="x", expand=False)
    txt_review.bind("<<Modified>>", lambda e: save_auto_reply_slots(e))
    ar_text_reviews.append(txt_review)

    cell_tr = tk.Frame(quad_frame)
    cell_tr.grid(row=0, column=1, sticky="nsew", padx=1, pady=1)
    tk.Label(cell_tr, text="AI 결과", font=("Arial", 8, "bold"), anchor="w", bg="#e3f2fd").pack(fill="x")
    txt_reply = scrolledtext.ScrolledText(cell_tr, font=box_font, height=3)
    txt_reply.pack(fill="x", expand=False)
    txt_reply.bind("<<Modified>>", lambda e: save_auto_reply_slots(e))
    ar_text_replies.append(txt_reply)

    cell_bl = tk.Frame(quad_frame)
    cell_bl.grid(row=1, column=0, sticky="nsew", padx=1, pady=1)
    tk.Label(cell_bl, text="이사현장상황", font=("Arial", 8, "bold"), anchor="w", bg="#fff3e0").pack(fill="x")
    txt_sit = scrolledtext.ScrolledText(cell_bl, font=box_font, height=3)
    txt_sit.pack(fill="x", expand=False)
    txt_sit.bind("<<Modified>>", lambda e: save_auto_reply_slots(e))
    ar_text_situations.append(txt_sit)

    cell_br = tk.Frame(quad_frame)
    cell_br.grid(row=1, column=1, sticky="nsew", padx=1, pady=1)
    tk.Label(cell_br, text="현장특이사항", font=("Arial", 8, "bold"), anchor="w", bg="#e8f5e9").pack(fill="x")
    txt_spec = scrolledtext.ScrolledText(cell_br, font=box_font, height=3)
    txt_spec.pack(fill="x", expand=False)
    txt_spec.bind("<<Modified>>", lambda e: save_auto_reply_slots(e))
    ar_text_specifics.append(txt_spec)

load_auto_reply_slots()

def load_general_memo(widget, file_path):
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                widget.insert("1.0", f.read())
        except Exception as e:
            messagebox.showerror("메모 로드 오류", f"메모 파일을 여는 중 오류가 발생했습니다:\n{e}")
    widget.edit_modified(False)

def save_general_memo(widget, file_path):
    try:
        content = widget.get("1.0", tk.END)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content.rstrip())
    except Exception as e:
        messagebox.showerror("메모 저장 오류", f"메모 파일을 저장하는 중 오류가 발생했습니다:\n{e}")

def make_memo_modified_handler(widget, file_path):
    def on_modified(event):
        if widget.edit_modified():
            save_general_memo(widget, file_path)
            widget.edit_modified(False)
    return on_modified

def clear_all_general_memos():
    if not messagebox.askyesno(
        "확인",
        "정말로 '상시 메모장'의 모든 내용을 삭제하시겠습니까?\n"
        "(1. 숨고 / 2. 오늘 / 3. 공홈 메모가 모두 비워집니다.)"
    ):
        return

    for widget in (text_memo_soomgo, text_memo_today, text_memo_site):
        widget.delete("1.0", tk.END)

_c_frame_general_memo = CollapsibleFrame(root, text="⑥ 상시 메모장")
_c_frame_general_memo.pack(fill=tk.BOTH, padx=2, pady=(2, 0), expand=False)

header_area_memo = _c_frame_general_memo.get_header_frame()
btn_clear_memos = tk.Button(
    header_area_memo,
    text="🧹 메모 전체 초기화",
    font=("Arial", 9),
    command=clear_all_general_memos
)
btn_clear_memos.pack(side=tk.LEFT, padx=(10, 0))

frame_general_memo = _c_frame_general_memo.sub_frame

frame_general_memo.grid_columnconfigure(0, weight=1, uniform="memo")
frame_general_memo.grid_columnconfigure(1, weight=1, uniform="memo")
frame_general_memo.grid_columnconfigure(2, weight=1, uniform="memo")

frame_memo_soomgo = tk.Frame(frame_general_memo)
frame_memo_soomgo.grid(row=0, column=0, padx=5, pady=5, sticky="nsew")

label_memo_soomgo = create_selectable_label(
    frame_memo_soomgo,
    "1. 숨고",
    font=("Arial", 11, "bold")
)
label_memo_soomgo.pack(anchor="w", fill="x")

# 🔥 [수정] 밴드 날짜 검색 함수 (자동 로그인 기능 추가)
def run_band_date_search():
    import threading
    
    # 1. 텍스트 창에서 실명 리스트 가져오기
    raw_text = text_memo_soomgo.get("1.0", tk.END).strip()
    if not raw_text:
        messagebox.showinfo("알림", "검색할 실명 데이터가 '1. 숨고' 메모장에 없습니다.")
        return
        
    names = [line.strip() for line in raw_text.split('\n') if line.strip()]
    if not names:
        messagebox.showinfo("알림", "유효한 이름이 없습니다.")
        return

    def task():
        driver = None
        try:
            log_debug("🚀 [밴드 날짜 찾기] 시작...")
            
            # 크롬 설정
            chrome_options = Options()
            chrome_options.add_argument("--start-maximized")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")
            # 네이버 로그인을 위해 detach 옵션 사용
            chrome_options.add_experimental_option("detach", True) 

            driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
            
            # 1. 로그인 페이지 접속
            login_url = "https://nid.naver.com/oauth2.0/authorize?svctype=0&response_type=code&client_id=C9hwybENgOtF&state=BOTHK2G6HNZDXZKI7736FEEZUZPJYNRDI57AL66UGHJES7Q2SIT67NFBEZL4VYPEI7S6OUGRFUFYE===&redirect_url=https%3A%2F%2Fauth.band.us%2Fexternal_account_login%3Ftype%3Dnaver"
            
            # 실제 검색을 수행할 밴드 게시글 목록 URL
            band_url = "https://www.band.us/band/85723996/post"

            log_debug(f"🔗 네이버 로그인 페이지 접속 중...")
            driver.get(login_url)
            time.sleep(1.5) # 페이지 로딩 대기

            # ▼▼▼ [자동 로그인 로직 시작] ▼▼▼
            try:
                log_debug("🤖 자동 로그인 시도 중...")
                
                # 사용할 계정 정보
                user_id = "aksqhqkqh3"
                user_pw = "tjdrb329@2a"

                # 1) 아이디 입력 (클립보드 복사 -> 붙여넣기)
                id_input = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "id")))
                id_input.click()
                
                root.clipboard_clear()
                root.clipboard_append(user_id)
                root.update() # 클립보드 반영
                id_input.send_keys(Keys.CONTROL, 'v')
                time.sleep(0.8)

                # 2) 비밀번호 입력 (클립보드 복사 -> 붙여넣기)
                pw_input = driver.find_element(By.ID, "pw")
                pw_input.click()
                
                root.clipboard_clear()
                root.clipboard_append(user_pw)
                root.update() # 클립보드 반영
                pw_input.send_keys(Keys.CONTROL, 'v')
                time.sleep(0.8)

                # 3) 로그인 버튼 클릭
                # 보통 id="log.login" 또는 class="btn_login"
                login_btn = driver.find_element(By.ID, "log.login")
                login_btn.click()
                
                log_debug("✅ 로그인 버튼 클릭 완료")
                
            except Exception as login_err:
                log_debug(f"⚠️ 자동 로그인 중 오류 발생 (수동 로그인 필요): {login_err}")
            # ▲▲▲ [자동 로그인 로직 끝] ▲▲▲

            # 2. 로그인 완료 대기 및 안내
            messagebox.showinfo(
                "로그인 확인", 
                "자동 로그인이 시도되었습니다.\n\n"
                "1. 로그인이 잘 되었는지 확인해주세요.\n"
                "(만약 캡차/보안문자가 떴다면 직접 입력해주세요)\n\n"
                "2. 밴드 메인 화면이 보이면 [확인]을 눌러주세요.\n"
                "(확인을 누르면 검색이 시작됩니다)"
            )
            
            # 다시 URL 확실히 이동 (로그인 후 리디렉션 꼬임 방지 및 검색 페이지로 이동)
            log_debug(f"🔗 검색 페이지로 이동: {band_url}")
            driver.get(band_url)
            time.sleep(2)
            
            new_lines = []
            
            for name in names:
                # 이미 포맷팅된 줄(날짜가 있거나 '고객 리뷰'가 포함됨)은 건너뛰거나 그대로 유지
                if "고객 리뷰" in name:
                    new_lines.append(name)
                    continue
                    
                log_debug(f"🔍 '{name}' 검색 중...")
                found_date_str = ""
                
                try:
                    # 2. 검색창 찾기 & 검색
                    search_input = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, ".inputBandSearch._gnbInputSearch"))
                    )
                    search_input.clear()
                    search_input.send_keys(name)
                    search_input.send_keys(Keys.ENTER)
                    time.sleep(1.5)
                    
                    # 3. 검색 결과 메뉴(필터) 클릭
                    try:
                        menu_link = WebDriverWait(driver, 3).until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, ".findTopMenuItemLink._searchLnbMenu"))
                        )
                        driver.execute_script("arguments[0].click();", menu_link)
                        time.sleep(1.0)
                    except TimeoutException:
                        log_debug(f"⚠️ '{name}' 검색 메뉴 탭 클릭 실패 (건너뜀)")
                    
                    # 4. 검색 결과 항목 클릭
                    result_item = WebDriverWait(driver, 3).until(
                        EC.element_to_be_clickable((By.CLASS_NAME, "cSearchStyleItem"))
                    )
                    driver.execute_script("arguments[0].click();", result_item)
                    time.sleep(1.5)
                    
                    # 5. 팝업에서 일정 상세 클릭
                    schedule_link = WebDriverWait(driver, 3).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, ".scehduleDetailLink._attachmentSchedule"))
                    )
                    driver.execute_script("arguments[0].click();", schedule_link)
                    time.sleep(1.5)
                    
                    # 6. 날짜 추출
                    date_element = WebDriverWait(driver, 3).until(
                        EC.presence_of_element_located((By.CLASS_NAME, "date"))
                    )
                    raw_date = date_element.text.strip() 
                    
                    # 7. 날짜 포맷팅
                    date_match = re.search(r'(\d+월\s*\d+일)', raw_date)
                    if date_match:
                        found_date_str = date_match.group(1) 
                        log_debug(f"✅ 날짜 찾음: {found_date_str}")
                    else:
                        found_date_str = raw_date 
                        
                    driver.get(band_url)
                    
                except Exception as search_err:
                    log_debug(f"❌ '{name}' 검색 실패: {search_err}")
                    driver.get(band_url) 
                
                # 결과 줄 생성
                if found_date_str:
                    new_line = f"{found_date_str} {name} 고객 리뷰"
                else:
                    new_line = f"{name} (날짜못찾음)"
                
                new_lines.append(new_line)
                time.sleep(1) 
                
            # 8. GUI 업데이트
            final_text = "\n\n".join(new_lines)
            
            def update_ui():
                text_memo_soomgo.delete("1.0", tk.END)
                text_memo_soomgo.insert("1.0", final_text)
                text_memo_soomgo.edit_modified(True) 
                messagebox.showinfo("완료", "밴드 날짜 검색 및 업데이트가 완료되었습니다.")
                
            root.after(0, update_ui)
            log_debug("🎉 모든 작업 완료.")
            
        except Exception as e:
            log_debug(f"💥 밴드 검색 전체 오류: {e}")
            messagebox.showerror("오류", f"작업 중 오류 발생: {e}")
            if driver:
                driver.quit()

    threading.Thread(target=task).start()

# 🔥 [추가] 밴드 검색 버튼 생성 (상단)
btn_band_search = tk.Button(
    frame_memo_soomgo,
    text="🔍 밴드 날짜 찾기",
    font=("Arial", 9, "bold"),
    bg="#4CAF50",
    fg="white",
    command=run_band_date_search
)
btn_band_search.pack(side=tk.TOP, fill=tk.X, pady=(0, 2))

text_memo_soomgo = scrolledtext.ScrolledText(
    frame_memo_soomgo,
    font=("Arial", 10),
    height=12,
    undo=True,
    maxundo=-1
)
text_memo_soomgo.pack(fill=tk.X, expand=False)

load_general_memo(text_memo_soomgo, MEMO_FILE_SOOMGO)
text_memo_soomgo.bind("<<Modified>>", make_memo_modified_handler(text_memo_soomgo, MEMO_FILE_SOOMGO))

frame_memo_today = tk.Frame(frame_general_memo)
frame_memo_today.grid(row=0, column=1, padx=5, pady=5, sticky="nsew")

label_memo_today = create_selectable_label(
    frame_memo_today,
    "2. 오늘",
    font=("Arial", 11, "bold")
)
label_memo_today.pack(anchor="w", fill="x")

text_memo_today = scrolledtext.ScrolledText(
    frame_memo_today,
    font=("Arial", 10),
    height=12,
    undo=True,
    maxundo=-1
)
text_memo_today.pack(fill=tk.X, expand=False)

load_general_memo(text_memo_today, MEMO_FILE_TODAY)
text_memo_today.bind("<<Modified>>", make_memo_modified_handler(text_memo_today, MEMO_FILE_TODAY))

frame_memo_site = tk.Frame(frame_general_memo)
frame_memo_site.grid(row=0, column=2, padx=5, pady=5, sticky="nsew")

label_memo_site = create_selectable_label(
    frame_memo_site,
    "3. 공홈",
    font=("Arial", 11, "bold")
)
label_memo_site.pack(anchor="w", fill="x")

text_memo_site = scrolledtext.ScrolledText(
    frame_memo_site,
    font=("Arial", 10),
    height=12,
    undo=True,
    maxundo=-1
)
text_memo_site.pack(fill=tk.X, expand=False)

load_general_memo(text_memo_site, MEMO_FILE_SITE)
text_memo_site.bind("<<Modified>>", make_memo_modified_handler(text_memo_site, MEMO_FILE_SITE))

def copy_ai_result(event=None):
    content = text_ai_result.get("1.0", tk.END).strip()
    if content:
        root.clipboard_clear()
        root.clipboard_append(content)
        messagebox.showinfo("복사 완료", "리뷰 초안이 클립보드에 복사되었습니다!")

text_ai_result.bind("<Button-1>", copy_ai_result)

def copy_result_text(event=None):
    if event is None:
        return "break"

    widget = event.widget
    content = widget.get("1.0", tk.END).strip()
    if content:
        root.clipboard_clear()
        root.clipboard_append(content)
        show_copy_toast(event)

    return "break"

def show_copy_toast(event, message="글자복사완료", duration=700):
    x = event.x_root + 10
    y = event.y_root + 10

    toast = tk.Toplevel(root)
    toast.overrideredirect(True)
    toast.attributes("-topmost", True)
    toast.geometry(f"+{x}+{y}")

    label = tk.Label(
        toast,
        text=message,
        bg="#333333",
        fg="white",
        padx=6,
        pady=3,
        font=("Arial", 9)
    )
    label.pack()

    def _destroy_toast():
        if toast.winfo_exists():
            toast.destroy()

    root.after(duration, _destroy_toast)

text_result_name.bind("<Button-1>", copy_result_text)
text_result_score.bind("<Button-1>", copy_result_text)

def _generate_review_draft_impl():
    if token_usage["total"] >= TOKEN_BUDGET_TOTAL:
        msg = "챗 GPT 토큰 사용량 초과로, 답변 불가"
        text_ai_result.delete("1.0", tk.END)
        text_ai_result.insert(tk.END, msg)
        log_debug("⛔ " + msg)
        messagebox.showerror("토큰 사용량 초과", msg)
        return

    review_short = text_review.get("1.0", tk.END).strip()
    review_memo = text_memo.get("1.0", tk.END).strip()

    has_memo = bool(review_memo) and review_memo != memo_placeholder
    has_short = bool(review_short) and review_short != memo_placeholder

    if not has_memo and not has_short:
        messagebox.showerror(
            "입력 오류",
            "고객 리뷰 텍스트가 비어있습니다.\n"
            "① '고객리뷰(플랫폼 리뷰확인)' 영역에 전체 리뷰를 붙여넣거나,\n"
            "② 우측 상단의 '리뷰 내용 일부'라도 입력해주세요."
        )
        return

    if has_memo:
        customer_review_main = review_memo
    else:
        customer_review_main = review_short

    customer_review_partial = review_short if has_short else ""

    field_status = text_auto_fill.get("1.0", tk.END).strip()
    special_note = text_fixed.get("1.0", tk.END).strip()

    if field_status == auto_placeholder:
        field_status = ""

    if special_note == special_placeholder:
        special_note = ""

    gave_food = False
    if special_note:
        food_keywords = [
            "커피", "아메리카노", "라떼", "음료", "음료수", "주스", "차",
            "빵", "간식", "과자", "과일", "떡", "케이크",
            "점심", "식사", "밥", "도시락", "라면",
            "치킨", "피자", "음식", "다과"
        ]
        for kw in food_keywords:
            if kw in special_note:
                gave_food = True
                break

    if gave_food:
        special_food_instruction = """
[특별 감사 표현 지시사항]
현장 특이사항에 따르면 고객님께서 작업 중에 음식/음료를 챙겨주셨습니다.
리뷰 답변에서 이 부분에 대한 감사 인사를 꼭 1~2문장 이상, 구체적으로 표현해 주세요.
예를 들어, "당일에 아메리카노와 빵까지 챙겨 주셔서 정말 큰 힘이 되었습니다~" 처럼
어떤 것을 챙겨주셨는지 자연스럽게 언급해 주세요.
"""
    else:
        special_food_instruction = """
[음식 관련 금지 지시사항]
현장 특이사항에 음식/음료 제공에 대한 내용이 전혀 없습니다.
이번 리뷰 답변에서는 고객님이 커피, 간식, 식사, 음료 등을 챙겨주셨다는 내용이나
기타 음식 관련 에피소드를 새로 만들어 쓰지 마세요.
"""

    prompt_text = text_prompt.get("1.0", tk.END).strip()

    combined_prompt = f"""
너는 이사 전문 업체 '이청잘'의 리뷰 답글을 대신 작성해 주는 전문가야.

이번에 작성할 내용은 '한 명의 현재 고객님이 남겨주신 리뷰'에만 답변하는 것이다.
프롬프트나 다른 입력값 안에 과거 다른 고객님들의 리뷰나 사례가 포함되어 있더라도,
그 내용은 스타일/톤/표현을 참고하기 위한 예시일 뿐이며,
절대로 이번 답변에서 과거 다른 고객님의 리뷰 내용을 그대로 재사용하거나
다른 고객을 직접적으로 언급해서는 안 된다.

또한, 입력으로 주어지지 않은 구체적인 사실(예: 음식이나 커피를 주셨다는 내용,
정확한 금액, 팁, 평수, 층수, 동·호수 등)을 상상해서 새로 만들어 쓰지 마라.

[리뷰 답변 작성 기준(프롬프트)] 블록에는 규칙/주의사항과 과거 예시가 함께 들어 있을 수 있다.
이 중에서 규칙·주의 문장은 반드시 지키고,
과거 리뷰/답글 예시는 말투와 구조만 참고하되, 문장 내용을 그대로 복사하거나
특정 고객 이름, 날짜, 금액, 음식 내용 등을 그대로 사용하는 일은 절대 하지 마라.

[리뷰 답변 작성 기준(프롬프트)]의 지시사항을 항상 1순위로 충실히 따르고,
그 다음으로 아래 네 가지 입력을 반드시 모두 읽고 이해한 뒤,
특히 [고객리뷰(플랫폼 리뷰확인)]과 [리뷰 내용 일부]를
이번 리뷰 답변의 중심 내용으로 삼아 글을 작성해 줘.

1) [고객리뷰(플랫폼 리뷰확인)]  → 고객이 플랫폼(숨고/오늘/공홈 등)에 남긴 실제 리뷰 전체
2) [리뷰 내용 일부]             → 위 리뷰의 핵심 일부 요약 또는 발췌
3) [이사현장상황(밴드내용확인)]  → 현장 팀장이 남긴 현장 상황 기록(내부 메모)
4) [현장 특이사항(밴드내용확인)] → 음식/팁/특이 구조 등 고객이 알아도 좋은 현장 특징

[리뷰 답변 작성 기준(프롬프트) - 항상 1순위로 준수]
{prompt_text}

[고객리뷰(플랫폼 리뷰확인) 전체 내용 - 답글 내용 매칭의 핵심 기준]
{customer_review_main}

[리뷰 내용 일부 - 위 전체 리뷰와 함께 동일하게 최우선으로 반영]
{customer_review_partial if customer_review_partial else "(입력 없음)"}

[이사현장상황(밴드내용확인) - 내부 참고용이지만, 고객이 알면 좋은 정보는 자연스럽게 반영]
{field_status if field_status else "(입력 없음)"}

[현장 특이사항(밴드내용확인) - 내부 참고용이지만, 고객이 알면 좋은 정보는 자연스럽게 반영]
{special_note if special_note else "(입력 없음)"}
{special_food_instruction}

작성 규칙:
1. 한국어로 작성한다.
2. 문장은 5~10문장 정도로 자연스럽게 작성한다.
3. 반드시 [고객리뷰(플랫폼 리뷰확인)]과 [리뷰 내용 일부]를 충분히 이해한 뒤, 그 내용을 중심으로 답변한다.
4. 이사현장상황 / 현장 특이사항 내용 중, 고객이 알아도 좋은 부분만 선별해 1~3문장 정도 자연스럽게 녹여서 언급한다.
5. '!', '~', 'ㅎㅎ', '^^' 를 적절히 사용해서 친근하게 작성하되, 과하지 않게 한다.
6. 업체 이름은 '이청잘' 또는 '이청잘 이사' 정도로 자연스럽게 한두 번만 언급한다.
7. 광고 문구처럼 과장하지 말고, 진심 어린 감사와 다짐을 담아서 마무리한다.
8. 프롬프트나 다른 입력에 포함된 과거 다른 고객의 리뷰 내용을 이번 답변에 그대로 베끼거나, 특정 다른 고객을 직접 언급하지 않는다.
9. HTML 태그나 마크다운 없이, 순수 텍스트로만 반환한다.
10. 음식/음료/간식/식사 관련 감사 인사는 오직 [현장 특이사항]이나 [이사현장상황]에 그런 내용이 실제로 있을 때만 작성하고, 없으면 절대로 새로 만들지 않는다.
11. 과거 예시로 제공된 리뷰/답글의 문장, 고객명, 날짜, 금액, 디테일을 그대로 복사하지 말고, 이번 고객 리뷰 내용에 맞게 새로 작성한다.
"""

    try:
        log_debug("🤖 ChatGPT에 리뷰 초안 생성 요청 중...")

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "너는 한국의 이사 전문 업체 '이청잘'의 리뷰 답글을 대신 작성해 주는 AI 비서다."
                },
                {
                    "role": "user",
                    "content": combined_prompt
                },
            ],
            temperature=0.7,
        )

        reply = completion.choices[0].message.content.strip()

        usage = getattr(completion, "usage", None)

        if usage is not None:
            prompt_tokens = getattr(usage, "prompt_tokens", getattr(usage, "input_tokens", 0))
            completion_tokens = getattr(usage, "completion_tokens", getattr(usage, "output_tokens", 0))
            total_tokens = getattr(usage, "total_tokens", prompt_tokens + completion_tokens)

            token_usage["prompt"] += prompt_tokens
            token_usage["completion"] += completion_tokens
            token_usage["total"] += total_tokens
            token_usage["calls"] += 1

            remaining_tokens = TOKEN_BUDGET_TOTAL - token_usage["total"]
            if remaining_tokens < 0:
                remaining_tokens = 0

            approx_runs_left = remaining_tokens // max(total_tokens, 1)

            log_debug("----- 토큰 사용량 정보 -----")
            log_debug(f"이번 호출 토큰: prompt={prompt_tokens}, completion={completion_tokens}, total={total_tokens}")
            log_debug(f"누적 토큰 사용량: total={token_usage['total']} / 예산={TOKEN_BUDGET_TOTAL}")
            log_debug(f"누적 호출 횟수: {token_usage['calls']} 회")
            log_debug(f"예상 추가 실행 가능 횟수(이번 호출 기준 추정): 약 {approx_runs_left} 회")
            log_debug("---------------------------")
        else:
            log_debug("⚠️ 응답에서 usage 정보를 찾을 수 없습니다.")

        text_ai_result.delete("1.0", tk.END)
        text_ai_result.insert(tk.END, reply)

        log_debug("✅ 리뷰 답변 초안 생성 완료 — ChatGPT 결과가 결과창에 반영되었습니다.")

    except Exception as e:
        error_msg = f"리뷰 초안 생성 중 오류가 발생했습니다:\n{e}"
        text_ai_result.delete("1.0", tk.END)
        text_ai_result.insert(tk.END, error_msg)
        log_debug(f"💥 {error_msg}")
        messagebox.showerror("오류", error_msg)

def generate_review_draft():
    root.after(1, _generate_review_draft_impl)

lbl_file_title = create_selectable_label(frame_prompt_ai, "리뷰 사진 파일 관리", font=("Arial", 11, "bold"))
frame_file_manager = tk.LabelFrame(frame_prompt_ai, labelwidget=lbl_file_title)
frame_file_manager.grid(row=0, column=2, sticky="nsew", padx=(2, 0))

frame_file_list_container = tk.Frame(frame_file_manager)
frame_file_list_container.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)

canvas_files = tk.Canvas(frame_file_list_container, bg="white", highlightthickness=0)
scrollbar_files = tk.Scrollbar(frame_file_list_container, orient="vertical", command=canvas_files.yview)
scrollable_file_frame = tk.Frame(canvas_files, bg="white")

scrollable_file_frame.bind(
    "<Configure>",
    lambda e: canvas_files.configure(scrollregion=canvas_files.bbox("all"))
)

canvas_files.create_window((0, 0), window=scrollable_file_frame, anchor="nw")
canvas_files.configure(yscrollcommand=scrollbar_files.set)

canvas_files.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
scrollbar_files.pack(side=tk.RIGHT, fill=tk.Y)

file_check_vars = {}

def refresh_file_list():
    for widget in scrollable_file_frame.winfo_children():
        widget.destroy()
    file_check_vars.clear()

    if not os.path.exists(TARGET_FILE_DIR):
        tk.Label(scrollable_file_frame, text="경로가 존재하지 않습니다.", bg="white", fg="red").pack(anchor="w")
        tk.Label(scrollable_file_frame, text=TARGET_FILE_DIR, bg="white", font=("Arial", 8)).pack(anchor="w")
        return

    try:
        files = [f for f in os.listdir(TARGET_FILE_DIR) if os.path.isfile(os.path.join(TARGET_FILE_DIR, f))]
        
        if not files:
            tk.Label(scrollable_file_frame, text="(파일 없음)", bg="white").pack(anchor="w", padx=5, pady=5)
            return

        select_all_var = tk.IntVar()

        def toggle_select_all():
            target_val = select_all_var.get()
            for var in file_check_vars.values():
                var.set(target_val)

        chk_all = tk.Checkbutton(
            scrollable_file_frame, 
            text="[전체 선택]", 
            variable=select_all_var, 
            bg="white", 
            anchor="w", 
            bd=0, 
            highlightthickness=0,
            font=("Arial", 9, "bold"),
            fg="blue",
            command=toggle_select_all
        )
        chk_all.pack(fill="x", padx=2, pady=(2, 0))
        
        tk.Frame(scrollable_file_frame, height=1, bg="lightgray").pack(fill="x", padx=2, pady=2)

        for f_name in files:
            full_path = os.path.join(TARGET_FILE_DIR, f_name)
            
            row_frame = tk.Frame(scrollable_file_frame, bg="white")
            row_frame.pack(fill="x", padx=2, pady=1)
            
            var = tk.IntVar()
            chk = tk.Checkbutton(row_frame, variable=var, bg="white", anchor="w", bd=0, highlightthickness=0)
            chk.pack(side="left")
            file_check_vars[f_name] = var
            
            lbl = tk.Label(
                row_frame, 
                text=f"📄 {f_name}",
                bg="white", 
                anchor="w", 
                cursor="hand2", 
                fg="#333333",
                font=("Arial", 9)
            )
            lbl.pack(side="left", fill="x", expand=True)
            
            lbl.bind("<Button-1>", lambda e, p=full_path: on_file_click(e, p))
            
    except Exception as e:
        tk.Label(scrollable_file_frame, text=f"오류: {e}", bg="white", fg="red").pack(anchor="w")

def delete_selected_files():
    selected = [f for f, var in file_check_vars.items() if var.get() == 1]
    
    if not selected:
        messagebox.showinfo("알림", "삭제할 파일을 선택해주세요.")
        return

    if not messagebox.askyesno("삭제 확인", f"선택한 파일 {len(selected)}개를 정말 삭제하시겠습니까?\n(복구할 수 없습니다)"):
        return

    deleted_count = 0
    for f_name in selected:
        full_path = os.path.join(TARGET_FILE_DIR, f_name)
        try:
            os.remove(full_path)
            deleted_count += 1
        except Exception as e:
            print(f"삭제 실패: {f_name} - {e}")
    
    messagebox.showinfo("완료", f"{deleted_count}개의 파일이 삭제되었습니다.")
    refresh_file_list()

def delete_all_files():
    if not file_check_vars:
        messagebox.showinfo("알림", "삭제할 파일이 없습니다.")
        return

    if not messagebox.askyesno("전체 삭제 경고", "⚠️ 해당 폴더의 모든 파일을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다!"):
        return

    deleted_count = 0
    for f_name in list(file_check_vars.keys()):
        full_path = os.path.join(TARGET_FILE_DIR, f_name)
        try:
            os.remove(full_path)
            deleted_count += 1
        except Exception as e:
            print(f"삭제 실패: {f_name} - {e}")

    messagebox.showinfo("완료", f"총 {deleted_count}개의 파일이 삭제되었습니다.")
    refresh_file_list()

def open_target_folder():
    if not os.path.exists(TARGET_FILE_DIR):
        messagebox.showerror("오류", f"폴더가 존재하지 않습니다:\n{TARGET_FILE_DIR}")
        return
    try:
        os.startfile(TARGET_FILE_DIR) 
    except Exception as e:
        messagebox.showerror("오류", f"폴더 열기 실패:\n{e}")

frame_file_btns = tk.Frame(frame_file_manager)
frame_file_btns.pack(fill=tk.X, pady=2, padx=2)

btn_refresh = tk.Button(frame_file_btns, text="🔄새로고침", font=("Arial", 9), command=refresh_file_list)
btn_refresh.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=1)

btn_del_sel = tk.Button(frame_file_btns, text="선택삭제", font=("Arial", 9), bg="#FFCDD2", command=delete_selected_files)
btn_del_sel.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=1)

btn_del_all = tk.Button(frame_file_btns, text="전체삭제", font=("Arial", 9), bg="#D32F2F", fg="white", command=delete_all_files)
btn_del_all.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=1)

btn_open_folder = tk.Button(frame_file_btns, text="📂폴더켜기", font=("Arial", 9), bg="#FFF9C4", command=open_target_folder)
btn_open_folder.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=1)

refresh_file_list()

_c_frame_debug = CollapsibleFrame(root, text="⑦ 디버깅 로그", expanded=True)
_c_frame_debug.pack(fill=tk.BOTH, padx=2, pady=2, expand=True)

frame_debug = _c_frame_debug.sub_frame

text_debug = scrolledtext.ScrolledText(frame_debug, height=5, font=("Courier New", 10), undo=True, maxundo=-1)
text_debug.pack(fill=tk.X, expand=False)

def enable_search(text_widget):
    search_state = {'query': '', 'last_index': '1.0'}

    def open_find_dialog(event=None):
        query = simpledialog.askstring("찾기", "찾을 내용을 입력하세요:")
        if query:
            search_state['query'] = query
            search_state['last_index'] = '1.0'
            find_next()
        return "break"

    def find_next(event=None):
        q = search_state['query']
        if not q:
            return "break"

        text_widget.tag_remove("search_highlight", "1.0", tk.END)
        idx = text_widget.search(q, search_state['last_index'],
                                 nocase=True, stopindex=tk.END)
        if idx:
            lastidx = f"{idx}+{len(q)}c"
            text_widget.tag_add("search_highlight", idx, lastidx)
            text_widget.tag_config("search_highlight", background="yellow")
            text_widget.mark_set("insert", lastidx)
            text_widget.see(idx)
            search_state['last_index'] = lastidx
        else:
            search_state['last_index'] = '1.0'
        return "break"

    text_widget.bind("<Control-f>", open_find_dialog)
    text_widget.bind("<Control-F>", open_find_dialog)
    text_widget.bind("<F3>", find_next)

def enable_undo_redo(text_widget):
    def undo(event=None):
        try:
            text_widget.edit_undo()
        except tk.TclError:
            pass
        return "break"

    def redo(event=None):
        try:
            text_widget.edit_redo()
        except tk.TclError:
            pass
        return "break"

    text_widget.bind("<Control-z>", undo)
    text_widget.bind("<Control-Z>", undo)
    text_widget.bind("<Control-y>", redo)
    text_widget.bind("<Control-Y>", redo)
    text_widget.bind("<Control-Shift-Z>", redo)
    text_widget.bind("<Control-Shift-z>", redo)

enable_search(text_review)
enable_search(text_element)
enable_search(text_result_name)
enable_search(text_result_score)
enable_search(text_memo)
enable_search(text_auto_fill)
enable_search(text_debug)

enable_undo_redo(text_review)
enable_undo_redo(text_element)
enable_undo_redo(text_result_name)
enable_undo_redo(text_result_score)
enable_undo_redo(text_memo)
enable_undo_redo(text_auto_fill)
enable_undo_redo(text_debug)

for widgets_list in (ar_text_reviews, ar_text_replies, ar_text_situations, ar_text_specifics):
    for w in widgets_list:
        enable_search(w)
        enable_undo_redo(w)

root.after(100, auto_fill_outer_html)

root.mainloop()