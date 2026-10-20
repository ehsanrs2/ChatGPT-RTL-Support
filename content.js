/* ChatGPT RTL Support — dynamic page script, independent of the popup. */
(() => {
  "use strict";
  const INSTANCE_KEY = "__chatgptRtlSupportV162";
  if (globalThis[INSTANCE_KEY]) return;
  globalThis[INSTANCE_KEY] = true;

  const STYLE_ID = "chatgpt-rtl-support-style";
  const DIR_ATTR = "data-chatgpt-rtl-dir";
  const ROOT_ATTR = "data-chatgpt-rtl-active";
  const MESSAGE = [
    '[data-message-author-role]',
    '[data-testid^="conversation-turn"]',
    'article[data-turn-id]',
    '[data-testid="user-message"]'
  ].join(',');
  const BLOCKS = [
    '.markdown', '.prose', '.whitespace-pre-wrap',
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'blockquote', 'th', 'td', 'dt', 'dd',
    '[data-testid="user-message"]'
  ].join(',');
  // Actual Chrome DOM probe (2026-10-20): no semantic message wrappers,
  // but 104 paragraphs and 19 headings under main. Use block-level fallback.
  const FALLBACK_BLOCKS = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote',
    'dd', 'dt', 'figcaption', 'th', 'td', '.whitespace-pre-wrap'
  ].join(',');
  const EXCLUDED_CONTENT = [
    'nav', 'aside', 'header', 'footer', 'form', 'button',
    '[role="button"]', '[role="dialog"]', '[role="menu"]', '[role="tablist"]',
    '[contenteditable]', 'textarea', 'input', 'pre', 'code',
    'math', '.katex', '.katex-display', '.MathJax'
  ].join(',');
  const COMPOSERS = '[contenteditable="true"][data-placeholder], .ProseMirror[contenteditable="true"], #prompt-textarea, textarea';
  const RTL = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
  const LTR = /[A-Za-z]/;
  let enabled = false;
  let observer = null;
  let flushTimer = null;
  const pending = new Set();

  function directionFor(text) {
    return RTL.test(text) ? 'rtl' : (LTR.test(text) ? 'ltr' : null);
  }

  function mark(el) {
    if (!(el instanceof Element) || !el.isConnected || el.closest('pre, code, .katex, .katex-display')) return;
    const dir = directionFor(el.textContent || '');
    if (dir) {
      if (el.getAttribute(DIR_ATTR) !== dir) el.setAttribute(DIR_ATTR, dir);
    } else {
      el.removeAttribute(DIR_ATTR);
    }
  }

  function isContentBlock(el) {
    return el instanceof Element && el.isConnected &&
      Boolean(el.closest('main')) && !el.closest(EXCLUDED_CONTENT);
  }

  function markMainBlock(el) {
    if (isContentBlock(el) && el.matches(FALLBACK_BLOCKS)) mark(el);
  }

  function scanMain(node) {
    if (!(node instanceof Element) || !node.isConnected) return;
    // When a text node changes during streaming, scan its nearest block.
    // In modern ChatGPT there may be NO message wrapper or .markdown at all.
    if (node.closest('main')) {
      markMainBlock(node.closest(FALLBACK_BLOCKS));
      markMainBlock(node);
      node.querySelectorAll(FALLBACK_BLOCKS).forEach(markMainBlock);
    } else if (node.matches('main')) {
      node.querySelectorAll(FALLBACK_BLOCKS).forEach(markMainBlock);
    } else {
      node.querySelectorAll('main').forEach(main =>
        main.querySelectorAll(FALLBACK_BLOCKS).forEach(markMainBlock));
    }
  }

  function processMessage(message) {
    if (!message.isConnected) return;
    // Mark the message itself as a fallback when ChatGPT changes its inner markup.
    mark(message);
    message.querySelectorAll(BLOCKS).forEach(mark);
  }

  function processNode(node) {
    if (!(node instanceof Element) || !node.isConnected) return;
    const message = node.closest(MESSAGE);
    if (message) {
      // Handle a streaming text change as well as newly appended markup.
      processMessage(message);
    } else {
      if (node.matches(MESSAGE)) processMessage(node);
      node.querySelectorAll(MESSAGE).forEach(processMessage);
    }
    scanMain(node);
    if (node.matches(COMPOSERS)) mark(node);
    node.querySelectorAll(COMPOSERS).forEach(mark);
    // Also process sidebar titles if they are added after a chat navigation.
    const titles = node.matches('nav a[href*="/c/"], aside a[href*="/c/"]') ? [node] :
      node.querySelectorAll('nav a[href*="/c/"], aside a[href*="/c/"]');
    titles.forEach(mark);
  }

  function flush() {
    flushTimer = null;
    if (!enabled) return;
    const elements = Array.from(pending);
    pending.clear();
    // Avoid repeatedly processing a whole message for every changed child.
    const messages = new Set();
    for (const el of elements) {
      if (!el.isConnected) continue;
      const message = el.closest(MESSAGE);
      if (message) messages.add(message);
      else processNode(el);
    }
    messages.forEach(processMessage);
  }

  function enqueue(node) {
    if (!enabled || !(node instanceof Element)) return;
    pending.add(node);
    if (flushTimer === null) flushTimer = setTimeout(flush, 70);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const sheet = document.createElement('style');
    sheet.id = STYLE_ID;
    sheet.textContent = `
      html[${ROOT_ATTR}="true"] [${DIR_ATTR}="rtl"] { direction: rtl !important; text-align: right !important; }
      html[${ROOT_ATTR}="true"] [${DIR_ATTR}="ltr"] { direction: ltr !important; text-align: left !important; }
      html[${ROOT_ATTR}="true"] :is([data-message-author-role], [data-testid^="conversation-turn"], article[data-turn-id]) :is(h1,h2,h3,h4,h5,h6)[${DIR_ATTR}="rtl"] { text-align: right !important; }
      html[${ROOT_ATTR}="true"] :is(nav,aside) a[href*="/c/"] { text-align: right !important; }
      html[${ROOT_ATTR}="true"] :is(nav,aside) a[href*="/c/"] :is(span,[class*="truncate"]) { text-align: right !important; direction: rtl !important; }
      html[${ROOT_ATTR}="true"] main pre,
      html[${ROOT_ATTR}="true"] main pre * { direction: ltr !important; text-align: left !important; }
      html[${ROOT_ATTR}="true"] main :is(code,.katex,.katex-display,.MathJax,math) { direction: ltr !important; unicode-bidi: isolate; }
    `;
    (document.head || document.documentElement).appendChild(sheet);
  }

  function refreshAll() {
    document.querySelectorAll(MESSAGE).forEach(processMessage);
    document.querySelectorAll('main').forEach(scanMain);
    document.querySelectorAll(COMPOSERS).forEach(mark);
    document.querySelectorAll('nav a[href*="/c/"],aside a[href*="/c/"]').forEach(mark);
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          enqueue(record.target.parentElement);
        } else {
          if (record.target instanceof Element && record.target.closest('main')) enqueue(record.target);
          for (const node of record.addedNodes) {
            if (node instanceof Element) enqueue(node);
            else if (node.nodeType === Node.TEXT_NODE) enqueue(node.parentElement);
          }
        }
      }
    });
    observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true});
    document.addEventListener('input', onInput, true);
  }

  function onInput(event) {
    const el = event.target instanceof Element ? event.target.closest(COMPOSERS) : null;
    if (el) enqueue(el);
  }

  function setEnabled(next) {
    if (next === enabled) {
      if (enabled) refreshAll();
      return;
    }
    enabled = next;
    if (enabled) {
      document.documentElement.setAttribute(ROOT_ATTR, 'true');
      addStyles();
      refreshAll();
      startObserving();
    } else {
      observer?.disconnect(); observer = null;
      document.removeEventListener('input', onInput, true);
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = null;
      pending.clear();
      document.getElementById(STYLE_ID)?.remove();
      document.documentElement.removeAttribute(ROOT_ATTR);
      document.querySelectorAll(`[${DIR_ATTR}]`).forEach(el => el.removeAttribute(DIR_ATTR));
    }
  }

  function status() {
    return {ok: true, enabled, messages: document.querySelectorAll(MESSAGE).length,
      mainBlocks: document.querySelectorAll('main p,main h1,main h2,main h3,main h4,main h5,main h6').length,
      mainMarked: document.querySelectorAll(`main [${DIR_ATTR}]`).length,
      marked: document.querySelectorAll(`[${DIR_ATTR}]`).length, version: '1.6.2'};
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'chatgpt-rtl-ping') {
      sendResponse(status());
    } else if (message?.type === 'chatgpt-rtl-sync') {
      setEnabled(message.enabled === true);
      sendResponse(status());
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.buttonOn) setEnabled(changes.buttonOn.newValue === true);
  });
  chrome.storage.local.get({buttonOn: false}, data => {
    if (!chrome.runtime.lastError) setEnabled(data.buttonOn === true);
    else console.warn('[ChatGPT RTL] Storage error:', chrome.runtime.lastError.message);
  });
})();
