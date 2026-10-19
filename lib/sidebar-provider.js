const vscode = require('vscode');
const { normalizeUrl } = require('./url');
const { loadPage } = require('./page-loader');
const { renderErrorHtml, renderHomeHtml, renderLoadingHtml, renderPageHtml } = require('./renderer');

const VIEW_CONTAINER_ID = 'urlWebPreviewSidebar';
const VIEW_ID = 'urlWebPreview.readerView';
const HISTORY_KEY = 'urlWebPreview.history';
const MAX_HISTORY_ITEMS = 20;
const MAX_PAGE_CACHE_ITEMS = 12;

class NovelReaderSidebarProvider {
  constructor(extensionUri, storage) {
    this.extensionUri = extensionUri;
    this.storage = storage;
    this.history = this.readHistory();
    this.pageCache = new Map();
    this.loadSequence = 0;
    this.currentUrl = 'https://';
    this.view = undefined;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = renderHomeHtml(webviewView.webview, this.currentUrl, this.history);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.command !== 'string') {
        return;
      }

      if (message.command === 'load' || message.command === 'openItem') {
        const normalized = normalizeUrl(message.url);
        if (!normalized.ok) {
          this.showToast(normalized.message);
          return;
        }

        await this.openUrl(normalized.url);
        return;
      }

      if (message.command === 'openExternal') {
        const normalized = normalizeUrl(message.url || this.currentUrl);
        if (normalized.ok) {
          await vscode.env.openExternal(vscode.Uri.parse(normalized.url));
        }
      }
    });

    if (this.currentUrl !== 'https://') {
      this.loadPage(this.currentUrl);
    }
  }

  async focus() {
    try {
      await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    } catch {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
  }

  async openPrompt() {
    await this.focus();

    const input = await vscode.window.showInputBox({
      title: '打开小说阅读器',
      prompt: '输入小说地址，插件会自动识别正文页或列表页。',
      placeHolder: 'https://example.com/book/1.html',
      value: this.currentUrl === 'https://' ? '' : this.currentUrl,
      validateInput(value) {
        const result = normalizeUrl(value);
        return result.ok ? undefined : result.message;
      }
    });

    if (!input) {
      return;
    }

    const normalized = normalizeUrl(input);
    if (!normalized.ok) {
      vscode.window.showErrorMessage(normalized.message);
      return;
    }

    await this.openUrl(normalized.url);
  }

  async openUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized.ok) {
      throw new Error(normalized.message);
    }

    this.currentUrl = normalized.url;
    await this.focus();

    if (this.view) {
      await this.loadPage(normalized.url);
    }
  }

  async loadPage(url) {
    if (!this.view) {
      return;
    }

    const sequence = ++this.loadSequence;

    try {
      const cachedPage = this.getCachedPage(url);
      if (cachedPage) {
        await this.renderLoadedPage(cachedPage, url, sequence);
        return;
      }

      this.view.webview.html = renderLoadingHtml(this.view.webview, url, this.history);
      const page = await this.fetchPage(url);
      await this.renderLoadedPage(page, url, sequence);
    } catch (error) {
      if (sequence !== this.loadSequence || !this.view) {
        return;
      }

      this.view.webview.html = renderErrorHtml(
        this.view.webview,
        url,
        error instanceof Error ? error.message : String(error),
        this.history
      );
    }
  }

  async renderLoadedPage(page, fallbackUrl, sequence) {
    if (sequence !== this.loadSequence || !this.view) {
      return;
    }

    this.currentUrl = page.url || fallbackUrl;
    if (page.url && page.url !== fallbackUrl) {
      this.storePage(page.url, page);
    }
    await this.rememberPage(page, fallbackUrl);
    if (sequence !== this.loadSequence || !this.view) {
      return;
    }

    this.view.webview.html = renderPageHtml(this.view.webview, page, this.history);
    this.prefetchNextPage(page.nextUrl);
  }

  getCachedPage(url) {
    const entry = this.pageCache.get(url);
    if (!entry || !entry.page) {
      return null;
    }

    this.storePage(url, entry.page);
    return entry.page;
  }

  async fetchPage(url) {
    const existing = this.pageCache.get(url);
    if (existing && existing.page) {
      return existing.page;
    }

    if (existing && existing.promise) {
      return existing.promise;
    }

    const promise = loadPage(url)
      .then((page) => {
        this.storePage(url, page);
        return page;
      })
      .catch((error) => {
        this.pageCache.delete(url);
        throw error;
      });

    this.pageCache.set(url, { promise });
    return promise;
  }

  prefetchNextPage(url) {
    if (!url || this.pageCache.has(url)) {
      return;
    }

    const promise = loadPage(url)
      .then((page) => {
        this.storePage(url, page);
        return page;
      })
      .catch(() => {
        this.pageCache.delete(url);
      });

    this.pageCache.set(url, { promise });
  }

  storePage(url, page) {
    this.pageCache.delete(url);
    this.pageCache.set(url, { page });

    while (this.pageCache.size > MAX_PAGE_CACHE_ITEMS) {
      const oldestKey = this.pageCache.keys().next().value;
      if (!oldestKey) {
        break;
      }

      this.pageCache.delete(oldestKey);
    }
  }

  readHistory() {
    const stored = this.storage && this.storage.get ? this.storage.get(HISTORY_KEY, []) : [];
    if (!Array.isArray(stored)) {
      return [];
    }

    return stored
      .map((item) => (typeof item === 'string' ? { url: item, title: item } : item))
      .filter((item) => item && typeof item.url === 'string' && item.url)
      .slice(0, MAX_HISTORY_ITEMS);
  }

  async rememberPage(page, fallbackUrl) {
    const url = page && page.url ? page.url : fallbackUrl;
    if (!url) {
      return;
    }

    const title = page && page.title ? page.title : url;
    this.history = [
      {
        url,
        title,
        lastOpenedAt: Date.now()
      },
      ...this.history.filter((item) => item.url !== url)
    ].slice(0, MAX_HISTORY_ITEMS);

    if (this.storage && this.storage.update) {
      await this.storage.update(HISTORY_KEY, this.history);
    }
  }

  showToast(message) {
    if (this.view) {
      this.view.webview.postMessage({ command: 'toast', message });
    }
  }
}

module.exports = {
  NovelReaderSidebarProvider,
  VIEW_ID
};
