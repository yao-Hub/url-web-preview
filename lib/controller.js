const vscode = require('vscode');
const { normalizeUrl } = require('./url');
const { loadPage } = require('./page-loader');
const { getPanelTitle, renderErrorHtml, renderLoadingHtml, renderPageHtml } = require('./renderer');

class NovelReaderController {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.panel = undefined;
    this.currentUrl = 'https://';
  }

  async openPrompt() {
    const input = await vscode.window.showInputBox({
      title: '打开小说阅读器',
      prompt: '输入小说地址，插件会自动识别是正文还是列表。',
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
    this.ensurePanel();
    await this.loadPage(normalized.url);
  }

  ensurePanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'urlWebPreview',
      '小说阅读器',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.iconPath = new vscode.ThemeIcon('book');
    this.panel.webview.html = renderLoadingHtml(this.panel.webview, this.currentUrl);

    this.panel.webview.onDidReceiveMessage(async (message) => {
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

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  async loadPage(url) {
    if (!this.panel) {
      return;
    }

    this.panel.title = '小说阅读器';
    this.panel.webview.html = renderLoadingHtml(this.panel.webview, url);

    try {
      const page = await loadPage(url);
      this.currentUrl = page.url || url;
      this.panel.title = getPanelTitle(page);
      this.panel.webview.html = renderPageHtml(this.panel.webview, page);
    } catch (error) {
      this.panel.webview.html = renderErrorHtml(
        this.panel.webview,
        url,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  showToast(message) {
    if (this.panel) {
      this.panel.webview.postMessage({ command: 'toast', message });
    }
  }

  dispose() {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }
}

module.exports = {
  NovelReaderController
};
