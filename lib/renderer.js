const { escapeAttribute, escapeHtml, escapeScriptJson } = require('./html');

function createNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';

  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}

function getPanelTitle(page) {
  if (!page || !page.kind) {
    return '小说阅读器';
  }

  if (page.kind === 'list') {
    return page.title ? `列表: ${page.title}` : '列表';
  }

  if (page.kind === 'chapter') {
    return page.title ? `阅读: ${page.title}` : '阅读';
  }

  return '小说阅读器';
}

function renderLoadingHtml(webview, url, history = []) {
  return renderShell(webview, {
    kind: 'loading',
    url,
    history,
    title: '正在加载',
    body: '<div class="status">正在读取页面内容。</div>'
  });
}

function renderErrorHtml(webview, url, message, history = []) {
  return renderShell(webview, {
    kind: 'error',
    url,
    history,
    title: '读取失败',
    body: `<div class="status error">${escapeHtml(message)}</div>`
  });
}

function renderHomeHtml(webview, url, history = []) {
  return renderShell(webview, {
    kind: 'home',
    url,
    history,
    title: '小说阅读器',
    pageTitle: '小说阅读器',
    body: '<div class="status">在上方输入小说地址，然后点击读取。</div>'
  });
}

function renderPageHtml(webview, page, history = []) {
  if (!page) {
    return renderErrorHtml(webview, '', '页面内容为空。');
  }

  if (page.kind === 'list') {
    return renderShell(webview, {
      kind: 'list',
      url: page.url,
      title: page.title || '列表',
      pageTitle: getPanelTitle(page),
      history,
      body: renderListBody(page)
    });
  }

  return renderShell(webview, {
    kind: 'chapter',
    url: page.url,
    title: page.title || '阅读',
    pageTitle: getPanelTitle(page),
    prevUrl: page.prevUrl || '',
    nextUrl: page.nextUrl || '',
    content: page.content || '',
    history,
    body: renderChapterBodyWithToc(page)
  });
}

function renderListBody(page) {
  const items = Array.isArray(page.items) ? page.items.slice(0, 400) : [];

  if (!items.length) {
    return '<div class="status">未识别到列表项。</div>';
  }

  const rows = items
    .map((item) => `
      <tr>
        <td class="title-cell">
          <button class="item-link" type="button" data-open-url="${escapeAttribute(item.url)}">${escapeHtml(item.text)}</button>
        </td>
        <td class="url-cell">${escapeHtml(item.url)}</td>
        <td class="action-cell">
          <button class="icon-button" type="button" data-open-url="${escapeAttribute(item.url)}" aria-label="打开">↗</button>
        </td>
      </tr>`)
    .join('');

  return `
    <section class="list-view">
      <table class="list-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>链接</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderTocBody(page) {
  const items = Array.isArray(page.toc) ? page.toc : [];

  if (!items.length) {
    return '';
  }

  return `
    <section class="toc-section">
      <h2>目录</h2>
      ${renderTocList(items, page.url || '')}
    </section>`;
}

function renderTocList(items, currentUrl) {
  const rows = items
    .map((item) => {
      const isActive = item.url && item.url === currentUrl;
      const title = escapeHtml(item.title || '未命名章节');
      const link = item.url
        ? `<button class="toc-link${isActive ? ' is-active' : ''}" type="button" data-open-url="${escapeAttribute(item.url)}" ${isActive ? 'aria-current="page"' : ''}>${title}</button>`
        : `<span class="toc-link toc-text">${title}</span>`;
      const children = item.children && item.children.length ? `<div class="toc-children">${renderTocList(item.children, currentUrl)}</div>` : '';

      return `<li class="toc-item">${link}${children}</li>`;
    })
    .join('');

  return `<ul class="toc-list">${rows}</ul>`;
}

function renderChapterBodyWithToc(page) {
  const paragraphs = String(page.content || '')
    .split(/\n{2,}/)
    .map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `
    <article class="chapter-view">
      <h1>${escapeHtml(page.title || '阅读')}</h1>
      <p class="source">${escapeHtml(page.url || '')}</p>
      <div class="content">${paragraphs}</div>
      <nav class="chapter-nav" aria-label="章节导航">
        <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.prevUrl || '')}" ${page.prevUrl ? '' : 'disabled'}>上一章</button>
        <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.nextUrl || '')}" ${page.nextUrl ? '' : 'disabled'}>下一章</button>
      </nav>
      ${renderTocBody(page)}
    </article>`;
}

function renderChapterBody(page) {
  const paragraphs = String(page.content || '')
    .split(/\n{2,}/)
    .map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `
    <article class="chapter-view">
      <h1>${escapeHtml(page.title || '阅读')}</h1>
      <p class="source">${escapeHtml(page.url || '')}</p>
      <div class="content">${paragraphs}</div>
      <nav class="chapter-nav" aria-label="章节导航">
        <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.prevUrl || '')}" ${page.prevUrl ? '' : 'disabled'}>上一章</button>
        <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.nextUrl || '')}" ${page.nextUrl ? '' : 'disabled'}>下一章</button>
      </nav>
    </article>`;
}

function renderHistoryPanel(history) {
  const items = Array.isArray(history) ? history.slice(0, 20) : [];

  if (!items.length) {
    return `
      <section class="history-panel" id="historyPanel" hidden>
        <div class="history-empty">暂无历史记录</div>
      </section>`;
  }

  const rows = items
    .map((item) => {
      const url = typeof item === 'string' ? item : item.url || '';
      const title = typeof item === 'string' ? item : item.title || item.url || '';
      if (!url) {
        return '';
      }

      return `
        <button class="history-link" type="button" data-open-url="${escapeAttribute(url)}">
          <span class="history-title">${escapeHtml(title)}</span>
          <span class="history-url">${escapeHtml(url)}</span>
        </button>`;
    })
    .join('');

  return `
    <section class="history-panel" id="historyPanel" hidden>
      ${rows}
    </section>`;
}

function renderShell(webview, page) {
  const nonce = createNonce();
  const history = Array.isArray(page.history) ? page.history : [];
  const safeState = escapeScriptJson({
    kind: page.kind,
    url: page.url,
    title: page.title,
    prevUrl: page.prevUrl || '',
    nextUrl: page.nextUrl || ''
  });
  const pageTitle = escapeHtml(page.pageTitle || getPanelTitle(page));
  const bodyClass = page.kind ? `page-${page.kind}` : 'page';
  const chapterDisabled = page.kind !== 'chapter' ? 'hidden' : '';
  const chapterToolbarDisabled = page.kind !== 'chapter' ? 'disabled' : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${pageTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: color-mix(in srgb, var(--vscode-foreground) 16%, transparent);
      --reader-bg: var(--vscode-editor-background);
      --reader-fg: var(--vscode-editor-foreground);
      --muted: color-mix(in srgb, var(--vscode-foreground) 66%, transparent);
      --surface: var(--vscode-sideBar-background);
      --button-bg: var(--vscode-button-secondaryBackground);
      --button-fg: var(--vscode-button-secondaryForeground);
      --link: var(--vscode-textLink-foreground);
    }

    * { box-sizing: border-box; }

    body {
      min-width: 320px;
      height: 100vh;
      margin: 0;
      overflow: hidden;
      color: var(--reader-fg);
      background: var(--reader-bg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .app {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) auto auto auto auto auto auto auto;
      gap: 8px;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .address {
      width: 100%;
      min-width: 0;
      height: 30px;
      padding: 0 10px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px;
      outline: none;
      font-family: var(--vscode-font-family);
    }

    .address:focus {
      border-color: var(--vscode-focusBorder);
    }

    .button {
      min-width: 34px;
      height: 30px;
      padding: 0 10px;
      color: var(--button-fg);
      background: var(--button-bg);
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
    }

    .button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .reader-shell {
      overflow: auto;
      scrollbar-gutter: stable;
    }

    .chapter-view,
    .list-view {
      width: min(960px, calc(100vw - 36px));
      margin: 0 auto;
      padding: 28px 0 56px;
    }

    h1 {
      margin: 0 0 8px;
      color: var(--reader-fg);
      font-size: 1.55rem;
      font-weight: 650;
      line-height: 1.35;
      letter-spacing: 0;
    }

    .source {
      margin: 0 0 28px;
      color: var(--muted);
      font-size: 0.86rem;
      overflow-wrap: anywhere;
    }

    .content {
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", var(--vscode-font-family);
      font-size: var(--novel-font-size, 18px);
      line-height: 1.9;
      letter-spacing: 0;
    }

    .content p {
      margin: 0 0 1.05em;
      text-indent: 2em;
    }

    .chapter-nav {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 34px;
    }

    .history-panel {
      max-height: min(360px, 52vh);
      overflow: auto;
      padding: 8px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .history-panel[hidden] {
      display: none;
    }

    .history-link {
      display: block;
      width: 100%;
      padding: 8px;
      color: var(--reader-fg);
      background: transparent;
      border: 0;
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .history-link:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .history-title,
    .history-url {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .history-url,
    .history-empty {
      color: var(--muted);
      font-size: 0.84rem;
    }

    .history-empty {
      padding: 8px;
    }

    .toc-section {
      margin-top: 34px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }

    .toc-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .toc-item {
      margin: 0;
    }

    .toc-link {
      display: block;
      width: 100%;
      padding: 6px 0;
      color: var(--link);
      background: transparent;
      border: 0;
      text-align: left;
      cursor: pointer;
      font: inherit;
      line-height: 1.45;
      word-break: break-word;
    }

    .toc-link.is-active {
      color: var(--reader-fg);
      font-weight: 650;
    }

    .toc-text {
      cursor: default;
      color: var(--muted);
    }

    .toc-children {
      padding-left: 18px;
      margin-left: 2px;
      border-left: 1px solid var(--border);
    }

    .list-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .list-table th,
    .list-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      text-align: left;
    }

    .list-table th {
      color: var(--muted);
      font-size: 0.84rem;
      font-weight: 600;
    }

    .title-cell {
      width: 34%;
    }

    .url-cell {
      width: auto;
      color: var(--muted);
      word-break: break-all;
      font-size: 0.88rem;
    }

    .action-cell {
      width: 68px;
      text-align: right;
    }

    .item-link {
      padding: 0;
      color: var(--link);
      background: transparent;
      border: 0;
      text-align: left;
      cursor: pointer;
      font: inherit;
      line-height: 1.5;
      word-break: break-word;
    }

    .icon-button {
      width: 34px;
      height: 30px;
      padding: 0;
      color: var(--button-fg);
      background: var(--button-bg);
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }

    .status {
      padding: 18px 0;
      color: var(--muted);
    }

    .status.error {
      color: var(--vscode-inputValidation-errorForeground);
    }

    .toast {
      position: fixed;
      right: 12px;
      bottom: 12px;
      display: none;
      max-width: min(520px, calc(100vw - 24px));
      padding: 8px 10px;
      color: var(--vscode-inputValidation-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      overflow-wrap: anywhere;
    }

    .page-list .chapter-only {
      display: none;
    }

    @media (max-width: 720px) {
      .toolbar {
        grid-template-columns: minmax(120px, 1fr) auto auto auto;
      }

      .toolbar .chapter-only {
        display: none;
      }

      .chapter-view,
      .list-view {
        width: min(100vw - 24px, 960px);
        padding-top: 22px;
      }

      .content {
        font-size: var(--novel-font-size, 17px);
      }

      .title-cell {
        width: auto;
      }

      .url-cell {
        display: none;
      }

      .toc-children {
        padding-left: 12px;
      }
    }
  </style>
</head>
<body class="${bodyClass}">
  <div class="app">
    <form class="toolbar" id="toolbar">
      <input class="address" id="address" type="url" aria-label="地址" spellcheck="false">
      <button class="button" id="load" type="submit" title="读取">读取</button>
      <button class="button chapter-only" id="prev" type="button" title="上一章" ${chapterToolbarDisabled}>上一章</button>
      <button class="button chapter-only" id="next" type="button" title="下一章" ${chapterToolbarDisabled}>下一章</button>
      <button class="button chapter-only" id="fontDown" type="button" title="减小字号" ${chapterToolbarDisabled}>A-</button>
      <button class="button chapter-only" id="fontUp" type="button" title="增大字号" ${chapterToolbarDisabled}>A+</button>
      <button class="button" id="external" type="button" title="在浏览器打开">打开</button>
      <button class="button" id="historyToggle" type="button" title="历史记录" aria-expanded="false">历史</button>
    </form>
    ${renderHistoryPanel(history)}
    <main class="reader-shell">
      ${page.body}
    </main>
  </div>
  <div class="toast" id="toast" role="status"></div>
  <script nonce="${nonce}">
    const state = ${safeState};
    const vscode = acquireVsCodeApi();
    const address = document.getElementById('address');
    const toolbar = document.getElementById('toolbar');
    const external = document.getElementById('external');
    const prev = document.getElementById('prev');
    const next = document.getElementById('next');
    const fontDown = document.getElementById('fontDown');
    const fontUp = document.getElementById('fontUp');
    const historyToggle = document.getElementById('historyToggle');
    const historyPanel = document.getElementById('historyPanel');
    const toast = document.getElementById('toast');

    address.value = state.url || '';
    restoreFontSize();
    syncChapterControls();

    toolbar.addEventListener('submit', (event) => {
      event.preventDefault();
      hideToast();
      vscode.postMessage({ command: 'load', url: address.value });
    });

    external.addEventListener('click', () => {
      vscode.postMessage({ command: 'openExternal', url: address.value });
    });

    historyToggle.addEventListener('click', () => {
      const willOpen = historyPanel.hasAttribute('hidden');
      historyPanel.toggleAttribute('hidden', !willOpen);
      historyToggle.setAttribute('aria-expanded', String(willOpen));
    });

    prev.addEventListener('click', () => loadChapter(state.prevUrl));
    next.addEventListener('click', () => loadChapter(state.nextUrl));
    fontDown.addEventListener('click', () => changeFontSize(-1));
    fontUp.addEventListener('click', () => changeFontSize(1));

    document.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('[data-open-url]') : null;
      if (!target) {
        return;
      }

      const url = target.getAttribute('data-open-url');
      if (!url) {
        return;
      }

      if (target.classList.contains('item-link') || target.classList.contains('icon-button') || target.classList.contains('nav-button') || target.classList.contains('toc-link') || target.classList.contains('history-link')) {
        event.preventDefault();
        hideToast();
        historyPanel.setAttribute('hidden', '');
        historyToggle.setAttribute('aria-expanded', 'false');
        vscode.postMessage({ command: 'openItem', url });
      }
    });

    window.addEventListener('message', (event) => {
      if (event.data && event.data.command === 'toast') {
        showToast(event.data.message);
      }
    });

    function loadChapter(url) {
      if (!url) {
        showToast('当前没有可跳转的章节。');
        return;
      }

      vscode.postMessage({ command: 'openItem', url });
    }

    function syncChapterControls() {
      prev.disabled = !state.prevUrl;
      next.disabled = !state.nextUrl;
      fontDown.disabled = state.kind !== 'chapter';
      fontUp.disabled = state.kind !== 'chapter';
    }

    function restoreFontSize() {
      const saved = Number(localStorage.getItem('novelFontSize') || 18);
      document.documentElement.style.setProperty('--novel-font-size', clampFontSize(saved) + 'px');
    }

    function changeFontSize(delta) {
      if (state.kind !== 'chapter') {
        return;
      }

      const current = Number(getComputedStyle(document.documentElement).getPropertyValue('--novel-font-size').replace('px', '')) || 18;
      const nextSize = clampFontSize(current + delta);
      localStorage.setItem('novelFontSize', String(nextSize));
      document.documentElement.style.setProperty('--novel-font-size', nextSize + 'px');
    }

    function clampFontSize(value) {
      return Math.max(14, Math.min(28, value));
    }

    function showToast(text) {
      toast.textContent = text;
      toast.style.display = 'block';
      window.setTimeout(hideToast, 3600);
    }

    function hideToast() {
      toast.textContent = '';
      toast.style.display = 'none';
    }
  </script>
</body>
</html>`;
}

module.exports = {
  getPanelTitle,
  renderErrorHtml,
  renderHomeHtml,
  renderLoadingHtml,
  renderPageHtml
};
