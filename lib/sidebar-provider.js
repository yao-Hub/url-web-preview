const vscode = require('vscode');
const { isLikelyUrl, normalizeUrl } = require('./url');
const { loadPage, searchBooks } = require('./page-loader');
const {
  renderErrorHtml,
  renderHistoryPage,
  renderHomeHtml,
  renderLoadingHtml,
  renderPageHtml,
  renderSearchErrorHtml,
  renderSearchLoadingHtml
} = require('./renderer');

const VIEW_CONTAINER_ID = 'urlWebPreviewSidebar';
const VIEW_ID = 'urlWebPreview.readerView';
const HISTORY_KEY = 'urlWebPreview.history';
const SEARCH_HISTORY_KEY = 'urlWebPreview.searchHistory';
const MAX_HISTORY_ITEMS = 20;
const MAX_PAGE_CACHE_ITEMS = 12;
const MAX_NAVIGATION_ITEMS = 30;

class NovelReaderSidebarProvider {
  constructor(extensionUri, storage) {
    this.extensionUri = extensionUri;
    this.storage = storage;
    this.history = this.readHistory();
    this.searchHistory = this.readSearchHistory();
    this.pageCache = new Map();
    this.navigationStack = [];
    this.currentPage = undefined;
    this.loadSequence = 0;
    this.currentUrl = '';
    this.currentMode = 'url';
    this.currentQuery = '';
    this.view = undefined;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = renderHomeHtml(webviewView.webview, this.currentUrl, this.history, this.searchHistory);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.command !== 'string') {
        return;
      }

      if (message.command === 'load') {
        const value = String(message.value || message.url || '').trim();
        if (!value) {
          this.showToast('请输入小说书名或网址。');
          return;
        }

        if (isLikelyUrl(value)) {
          const normalized = normalizeUrl(value);
          if (!normalized.ok) {
            this.showToast(normalized.message);
            return;
          }
          await this.openUrl(normalized.url);
        } else {
          await this.search(value);
        }
        return;
      }

      if (message.command === 'search') {
        await this.search(message.query);
        return;
      }

      if (message.command === 'back') {
        await this.goBack();
        return;
      }

      if (message.command === 'history') {
        await this.showHistory();
        return;
      }

      if (message.command === 'refresh') {
        await this.refresh();
        return;
      }

      if (message.command === 'deleteSearchHistory') {
        await this.deleteSearchHistory(message.query);
        return;
      }

      if (message.command === 'clearSearchHistory') {
        await this.clearSearchHistory();
        return;
      }

      if (message.command === 'deleteReadingHistory') {
        await this.deleteReadingHistory(message.url);
        return;
      }

      if (message.command === 'deleteReadingHistoryItems') {
        await this.deleteReadingHistoryItems(message.urls);
        return;
      }

      if (message.command === 'clearReadingHistory') {
        await this.clearReadingHistory();
        return;
      }

      if (message.command === 'openItem') {
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

    if (this.currentMode === 'history') {
      this.showHistory();
    } else if (this.currentMode === 'title' && this.currentQuery) {
      this.search(this.currentQuery);
    } else if (this.currentUrl) {
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
      title: '打开小小说',
      prompt: '输入小说地址，插件会自动识别正文页或列表页。',
      placeHolder: 'https://example.com/book/1.html',
      value: this.currentMode === 'title' ? this.currentQuery : this.currentUrl,
      validateInput(value) {
        return String(value || '').trim() ? undefined : '请输入网址或书名。';
      }
    });

    if (!input) {
      return;
    }

    if (isLikelyUrl(input)) {
      const normalized = normalizeUrl(input);
      if (!normalized.ok) {
        vscode.window.showErrorMessage(normalized.message);
        return;
      }
      await this.openUrl(normalized.url);
      return;
    }

    await this.search(input);
  }

  async openUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized.ok) {
      throw new Error(normalized.message);
    }

    this.pushCurrentPage();
    this.currentUrl = normalized.url;
    this.currentMode = 'url';
    this.currentQuery = '';

    if (this.view) {
      await this.loadPage(normalized.url);
    }
  }

  async search(query, pushCurrent = true) {
    const value = String(query || '').trim();
    if (!value) {
      return;
    }

    if (pushCurrent) {
      this.pushCurrentPage();
    }
    this.currentMode = 'title';
    this.currentQuery = value;
    await this.rememberSearch(value);
    if (!this.view) {
      return;
    }

    const sequence = ++this.loadSequence;
    this.view.webview.html = renderSearchLoadingHtml(this.view.webview, value, this.history);
    const reportProgress = this.createProgressReporter(sequence);

    try {
      const page = await searchBooks(value, { onProgress: reportProgress });
      reportProgress({ fraction: 0.99, label: '正在生成搜索结果' });
      if (sequence !== this.loadSequence || !this.view) {
        return;
      }
      this.currentPage = page;
      this.view.webview.html = renderPageHtml(this.view.webview, this.withNavigation(page), this.history, this.searchHistory);
    } catch (error) {
      if (sequence !== this.loadSequence || !this.view) {
        return;
      }
      this.view.webview.html = renderSearchErrorHtml(
        this.view.webview,
        value,
        error instanceof Error ? error.message : String(error),
        this.history
      );
    }
  }

  async goBack() {
    const page = this.navigationStack.pop();
    if (!page || !this.view) {
      this.showToast('没有可返回的上一页。');
      return;
    }

    const sequence = ++this.loadSequence;
    if (page.kind === 'home') {
      this.currentPage = undefined;
      this.currentMode = 'url';
      this.currentQuery = '';
      this.currentUrl = '';
      if (sequence !== this.loadSequence || !this.view) {
        return;
      }
      this.view.webview.html = renderHomeHtml(
        this.view.webview,
        '',
        this.history,
        this.searchHistory
      );
      return;
    }

    this.currentPage = page;
    if (page.kind === 'search') {
      this.currentMode = 'title';
      this.currentQuery = page.query || '';
    } else if (page.kind === 'history') {
      this.currentMode = 'history';
      this.currentQuery = '';
    } else {
      this.currentMode = 'url';
      this.currentQuery = '';
      this.currentUrl = page.url || this.currentUrl;
    }

    if (sequence !== this.loadSequence || !this.view) {
      return;
    }
    this.view.webview.html = renderPageHtml(this.view.webview, this.withNavigation(page), this.history, this.searchHistory);
  }

  async showHistory(pushCurrent = true) {
    if (!this.view) {
      return;
    }

    if (pushCurrent) {
      this.pushCurrentPage();
    }
    const page = {
      kind: 'history',
      source: 'app',
      url: '',
      title: '历史'
    };
    this.currentPage = page;
    this.currentMode = 'history';
    this.currentQuery = '';
    ++this.loadSequence;
    this.view.webview.html = renderHistoryPage(
      this.view.webview,
      this.history,
      this.searchHistory,
      this.navigationStack.length > 0
    );
  }

  async refresh() {
    if (!this.view) {
      return;
    }

    if (this.currentMode === 'history') {
      await this.showHistory(false);
      return;
    }

    if (this.currentMode === 'title' && this.currentQuery) {
      await this.search(this.currentQuery, false);
      return;
    }

    if (this.currentUrl) {
      this.pageCache.delete(this.currentUrl);
      await this.loadPage(this.currentUrl, true);
      return;
    }

    this.currentPage = undefined;
    this.view.webview.html = renderHomeHtml(this.view.webview, '', this.history, this.searchHistory);
  }

  async loadPage(url, force = false) {
    if (!this.view) {
      return;
    }

    const sequence = ++this.loadSequence;

    try {
      if (!force) {
        const cachedPage = this.getCachedPage(url);
        if (cachedPage) {
          await this.renderLoadedPage(cachedPage, url, sequence);
          return;
        }
      }

      this.view.webview.html = renderLoadingHtml(this.view.webview, url, this.history);
      const reportProgress = this.createProgressReporter(sequence);
      const page = await this.fetchPage(url, reportProgress);
      reportProgress({ fraction: 0.99, label: '正在渲染页面' });
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
    this.currentPage = page;
    if (page.url && page.url !== fallbackUrl) {
      this.storePage(page.url, page);
    }
    await this.rememberPage(page, fallbackUrl);
    if (sequence !== this.loadSequence || !this.view) {
      return;
    }

    this.view.webview.html = renderPageHtml(this.view.webview, this.withNavigation(page), this.history, this.searchHistory);
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

  async fetchPage(url, onProgress) {
    const existing = this.pageCache.get(url);
    if (existing && existing.page) {
      return existing.page;
    }

    if (existing && existing.promise) {
      return existing.promise;
    }

    const promise = loadPage(url, { onProgress })
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

  readSearchHistory() {
    const stored = this.storage && this.storage.get ? this.storage.get(SEARCH_HISTORY_KEY, []) : [];
    if (!Array.isArray(stored)) {
      return [];
    }

    return stored
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, MAX_HISTORY_ITEMS);
  }

  async rememberSearch(query) {
    const value = String(query || '').trim();
    if (!value) {
      return;
    }

    this.searchHistory = [
      value,
      ...this.searchHistory.filter((item) => item !== value)
    ].slice(0, MAX_HISTORY_ITEMS);

    await this.persistSearchHistory();
  }

  async deleteSearchHistory(query) {
    const value = String(query || '').trim();
    if (!value) {
      return;
    }

    this.searchHistory = this.searchHistory.filter((item) => item !== value);
    await this.persistSearchHistory();
    this.refreshHistoryPage();
  }

  async clearSearchHistory() {
    this.searchHistory = [];
    await this.persistSearchHistory();
    this.refreshHistoryPage();
  }

  async persistSearchHistory() {
    if (this.storage && this.storage.update) {
      await this.storage.update(SEARCH_HISTORY_KEY, this.searchHistory);
    }
  }

  refreshHistoryPage() {
    if (!this.view || !this.currentPage || this.currentPage.kind !== 'history') {
      return;
    }

    ++this.loadSequence;
    this.view.webview.html = renderHistoryPage(
      this.view.webview,
      this.history,
      this.searchHistory,
      this.navigationStack.length > 0
    );
  }

  async deleteReadingHistory(url) {
    const value = String(url || '').trim();
    if (!value) {
      return;
    }

    this.history = this.history.filter((item) => item.url !== value);
    await this.persistReadingHistory();
    this.refreshHistoryPage();
  }

  async deleteReadingHistoryItems(urls) {
    const selected = new Set(
      (Array.isArray(urls) ? urls : [])
        .map((url) => String(url || '').trim())
        .filter(Boolean)
    );
    if (!selected.size) {
      return;
    }

    this.history = this.history.filter((item) => !selected.has(item.url));
    await this.persistReadingHistory();
    this.refreshHistoryPage();
  }

  async clearReadingHistory() {
    this.history = [];
    await this.persistReadingHistory();
    this.refreshHistoryPage();
  }

  async persistReadingHistory() {
    if (this.storage && this.storage.update) {
      await this.storage.update(HISTORY_KEY, this.history);
    }
  }

  pushCurrentPage() {
    if (!this.currentPage) {
      this.navigationStack.push({ kind: 'home' });
      if (this.navigationStack.length > MAX_NAVIGATION_ITEMS) {
        this.navigationStack.shift();
      }
      return;
    }

    this.navigationStack.push(this.currentPage);
    if (this.navigationStack.length > MAX_NAVIGATION_ITEMS) {
      this.navigationStack.shift();
    }
  }

  withNavigation(page) {
    return {
      ...page,
      backAvailable: this.navigationStack.length > 0
    };
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

  createProgressReporter(sequence) {
    let lastPercent = 0;

    return ({ fraction, label } = {}) => {
      if (sequence !== this.loadSequence || !this.view) {
        return;
      }

      const percent = Math.max(
        lastPercent,
        Math.min(98, Math.max(3, Math.round(Number(fraction || 0) * 100)))
      );
      lastPercent = percent;
      this.view.webview.postMessage({
        command: 'progress',
        percent,
        label: label || '正在加载'
      });
    };
  }
}

module.exports = {
  NovelReaderSidebarProvider,
  VIEW_ID
};
