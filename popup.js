/* Popup is a preference switch and also reports whether the page script responds. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    const button = document.querySelector('.button');
    const eye = document.querySelector('.eye');
    const notice = document.querySelector('.messageAlert');
    let activeTabId = null;

    function render(value) {
      button.dataset.enabled = value ? 'true' : 'false';
      button.setAttribute('aria-checked', String(value));
      button.setAttribute('aria-label', value ? 'Disable RTL' : 'Enable RTL');
      eye.textContent = value ? '📡' : '🤖';
    }

    function supported(url) {
      return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(url || '');
    }

    async function ensureConnected() {
      if (!activeTabId) return null;
      try {
        return await chrome.tabs.sendMessage(activeTabId, {type: 'chatgpt-rtl-ping'});
      } catch (_) {
        // The tab may predate extension installation or reload. Inject immediately.
        await chrome.scripting.executeScript({target: {tabId: activeTabId}, files: ['content.js']});
        return chrome.tabs.sendMessage(activeTabId, {type: 'chatgpt-rtl-ping'});
      }
    }

    async function syncPage(value) {
      if (!activeTabId) return;
      try {
        await ensureConnected();
        const result = await chrome.tabs.sendMessage(activeTabId,
          {type: 'chatgpt-rtl-sync', enabled: value});
        if (value && result?.messages === 0 && result?.mainBlocks === 0) {
          notice.textContent = 'Connected. No ChatGPT messages found on this page yet.';
        } else {
          notice.textContent = '';
        }
      } catch (error) {
        notice.textContent = 'Page script unavailable. Reload this ChatGPT tab, then try again.';
        console.warn('[ChatGPT RTL] Cannot connect to page:', error);
      }
    }

    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!supported(tab?.url) || !Number.isInteger(tab?.id)) {
        button.disabled = true;
        notice.textContent = 'Open chatgpt.com to use RTL support.';
      } else {
        activeTabId = tab.id;
      }
      const stored = await chrome.storage.local.get({buttonOn: false});
      render(stored.buttonOn === true);
      if (activeTabId) await syncPage(stored.buttonOn === true);
    } catch (error) {
      notice.textContent = 'Cannot initialize the extension. Check its errors in chrome://extensions.';
      console.error('[ChatGPT RTL] Popup init failed:', error);
    }

    button.classList.add('initialized');
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.buttonOn) render(changes.buttonOn.newValue === true);
    });

    button.addEventListener('click', async () => {
      if (button.disabled || !activeTabId) return;
      button.disabled = true;
      try {
        const stored = await chrome.storage.local.get({buttonOn: false});
        const next = stored.buttonOn !== true;
        await chrome.storage.local.set({buttonOn: next});
        render(next);
        await syncPage(next);
      } catch (error) {
        notice.textContent = 'Could not save setting. See extension errors.';
        console.error('[ChatGPT RTL] Toggle failed:', error);
      } finally {
        button.disabled = false;
      }
    });
  });
})();
