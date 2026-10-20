"""Headless browser smoke tests for the RTL overlay (not live chatgpt.com)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

MOCK_CHROME = r"""
window.__storedButtonOn = true;
window.__storageListeners = [];
window.__storageSetCount = 0;
window.chrome = {
  runtime: {
    lastError: null,
    onMessage: {addListener: fn => window.__messageListener = fn}
  },
  tabs: {
    query: async () => [{id: 1, url: 'https://chatgpt.com/c/test'}],
    sendMessage: async (_id, payload) => ({ok: true, enabled: payload.enabled ?? true, messages: 2, marked: 5})
  },
  scripting: {executeScript: async () => []},
  storage: {
    onChanged: {addListener: fn => window.__storageListeners.push(fn)},
    local: {
      get: (defaults, cb) => {
        const result = {buttonOn: window.__storedButtonOn};
        if (typeof cb === 'function') {cb(result); return;}
        return Promise.resolve(result);
      },
      set: (change) => {
        window.__storageSetCount++;
        const prev = window.__storedButtonOn;
        window.__storedButtonOn = change.buttonOn;
        for (const listener of window.__storageListeners) {
          listener({buttonOn: {oldValue: prev, newValue: change.buttonOn}}, 'local');
        }
        return Promise.resolve();
      }
    }
  }
};
window.__setRtl = value => {
  const prev = window.__storedButtonOn;
  window.__storedButtonOn = value;
  for (const listener of window.__storageListeners) {
    listener({buttonOn: {oldValue: prev, newValue: value}}, 'local');
  }
};
"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR", e))
    page.on("console", lambda m: print("CONSOLE", m.type, m.text))
    page.add_init_script(MOCK_CHROME)
    page.set_content('''<html><head></head><body>
      <header id="global-ui"><h2>English nav title</h2></header><nav><a href="/c/123"><span class="truncate" id="sidebar-title">عنوان گفتگو</span></a></nav>
      <main><article data-message-author-role="assistant" id="msg1">
        <div class="markdown"><h2 id="title">عنوان فارسی</h2>
          <p id="rtl-old">Neuron 18 الان firing می‌کند یا نه؟</p>
          <p id="ltr-old">English-only paragraph</p>
          <pre id="code"><code>console.log('hi');</code></pre>
        </div>
      </article></main></body></html>''')
    # set_content may not execute init script for about:blank; ensure mock is there.
    page.evaluate(MOCK_CHROME)
    page.evaluate("window.__storedButtonOn = true")
    page.add_script_tag(path=str(ROOT/'content.js'))
    page.wait_for_timeout(150)
    def attr(sel): return page.locator(sel).get_attribute('data-chatgpt-rtl-dir')
    assert attr('#rtl-old') == 'rtl', attr('#rtl-old')
    assert attr('#ltr-old') == 'ltr', attr('#ltr-old')
    assert page.locator('#title').evaluate('(e) => getComputedStyle(e).textAlign') == 'right'
    assert page.locator('#code').evaluate('(e) => getComputedStyle(e).direction') == 'ltr'
    assert page.locator('#global-ui').evaluate('(e) => getComputedStyle(e).direction') == 'ltr'
    assert page.locator('#sidebar-title').evaluate('(e) => getComputedStyle(e).textAlign') == 'right'
    # Add a brand-new user message and assistant title without opening popup.
    page.evaluate('''() => document.querySelector('main').insertAdjacentHTML('beforeend',
      `<article data-message-author-role="user"><div class="whitespace-pre-wrap" id="new-user">سلام world</div></article>
       <article data-message-author-role="assistant"><div class="markdown"><h3 id="new-title">New title</h3><p id="stream">Hi</p></div></article>`)''')
    page.wait_for_timeout(150)
    assert attr('#new-user') == 'rtl', attr('#new-user')
    assert page.locator('#new-title').get_attribute('data-chatgpt-rtl-dir') == 'ltr'
    assert attr('#stream') == 'ltr'
    page.evaluate('''() => {document.querySelector('#stream').firstChild.textContent='Hello، اینجا فارسی است';}''')
    page.wait_for_timeout(150)
    assert attr('#stream') == 'rtl', attr('#stream')
    # State changes from popup should be observed immediately.
    page.evaluate('window.__setRtl(false)')
    assert page.locator('#chatgpt-rtl-support-style').count() == 0
    assert attr('#rtl-old') is None
    page.evaluate('window.__setRtl(true)')
    page.wait_for_timeout(150)
    assert attr('#rtl-old') == 'rtl'
    assert attr('#stream') == 'rtl'
    print('CONTENT: PASS (initial content, new messages, streaming, headings, code, UI, persistence)')

    popup = browser.new_page()
    popup.set_content((ROOT/"popup.html").read_text())
    popup.evaluate(MOCK_CHROME)
    popup.evaluate("window.__storedButtonOn = true")
    popup.add_script_tag(path=str(ROOT/"popup.js"))
    popup.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    popup.locator('.button').wait_for()
    popup.wait_for_timeout(70)
    assert popup.locator('.button').get_attribute('aria-checked') == 'true'
    assert popup.locator('.button').get_attribute('data-enabled') == 'true'
    assert popup.evaluate('window.__storageSetCount') == 0
    popup.locator('.button').click()
    popup.wait_for_timeout(70)
    assert popup.locator('.button').get_attribute('aria-checked') == 'false'
    assert popup.locator('.button').get_attribute('data-enabled') == 'false'
    assert popup.evaluate('window.__storedButtonOn') is False
    assert popup.evaluate('window.__storageSetCount') == 1
    print('POPUP: PASS (opening is read-only; toggle updates preference)')
    browser.close()
