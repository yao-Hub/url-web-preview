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
  if (page && page.kind === 'search') {
    return page.query ? `搜索: ${page.query}` : '搜索';
  }

  if (page && page.kind === 'history') {
    return '历史';
  }

  if (!page || !page.kind) {
    return '小小说';
  }

  if (page.kind === 'list') {
    return page.title ? `列表: ${page.title}` : '列表';
  }

  if (page.kind === 'chapter') {
    return page.title ? `阅读: ${page.title}` : '阅读';
  }

  return '小小说';
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

function renderSearchLoadingHtml(webview, query, history = []) {
  return renderShell(webview, {
    kind: 'loading',
    url: '',
    value: query,
    mode: 'title',
    history,
    title: '正在搜索',
    body: '<div class="status">正在搜索已支持的小说网站。</div>'
  });
}

function renderSearchErrorHtml(webview, query, message, history = []) {
  return renderShell(webview, {
    kind: 'error',
    url: '',
    value: query,
    mode: 'title',
    history,
    title: '搜索失败',
    body: `<div class="status error">${escapeHtml(message)}</div>`
  });
}

function renderHomeHtml(webview, url, history = [], searchHistory = []) {
  return renderShell(webview, {
    kind: 'home',
    url,
    history,
    searchHistory,
    title: '小小说',
    pageTitle: '小小说',
    body: '<div class="status">在上方输入小说地址，然后点击读取。</div>'
  });
}

function renderPageHtml(webview, page, history = [], searchHistory = []) {
  if (!page) {
    return renderErrorHtml(webview, '', '页面内容为空。');
  }

  if (page.kind === 'search') {
    return renderShell(webview, {
      kind: 'search',
      url: '',
      value: page.query || '',
      mode: 'title',
      title: page.title || '搜索',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      history,
      searchHistory,
      body: renderSearchBody(page)
    });
  }

  if (page.kind === 'history') {
    return renderShell(webview, {
      kind: 'history',
      url: '',
      value: '',
      title: '历史',
      pageTitle: '历史',
      backAvailable: Boolean(page.backAvailable),
      history,
      searchHistory,
      body: renderHistoryPageBody(history, searchHistory)
    });
  }

  if (page.kind === 'list') {
    return renderShell(webview, {
      kind: 'list',
      url: page.url,
      title: page.title || '列表',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      history,
      searchHistory,
      body: renderListBody(page)
    });
  }

  return renderShell(webview, {
    kind: 'chapter',
    url: page.url,
    title: page.title || '阅读',
    pageTitle: getPanelTitle(page),
    backAvailable: Boolean(page.backAvailable),
    prevUrl: page.prevUrl || '',
    nextUrl: page.nextUrl || '',
    content: page.content || '',
    history,
    searchHistory,
    body: renderChapterBodyWithToc(page)
  });
}

function renderHistoryPage(webview, history = [], searchHistory = [], backAvailable = false) {
  return renderPageHtml(webview, {
    kind: 'history',
    url: '',
    title: '历史',
    history,
    searchHistory,
    backAvailable
  }, history, searchHistory);
}

function renderHistoryPageBody(history, searchHistory) {
  const readItems = Array.isArray(history) ? history.slice(0, 20) : [];
  const readButtons = readItems
    .map((item) => {
      const url = typeof item === 'string' ? item : item.url || '';
      const title = typeof item === 'string' ? item : item.title || url;
      if (!url) {
        return '';
      }
      return `
        <div class="history-page-row">
          <input class="history-select-input" type="checkbox" data-history-select value="${escapeAttribute(url)}" aria-label="选择这条阅读历史">
          <button class="history-page-link" type="button" data-open-url="${escapeAttribute(url)}">
            <span class="history-title">${escapeHtml(title)}</span>
            <span class="history-url">${escapeHtml(url)}</span>
          </button>
        </div>`;
    })
    .join('');

  return `
    <section class="history-view">
      <div class="history-page-section">
        <div class="history-section-head">
          <h2>阅读历史</h2>
          ${readItems.length ? '<button class="history-manage-toggle" type="button" data-toggle-history-management>管理</button>' : ''}
        </div>
        ${readItems.length ? `
          <div class="history-manage-actions" hidden>
            <button class="history-manage-button" type="button" data-select-all-history>全选</button>
            <button class="history-manage-button" type="button" data-delete-selected-history>删除选中</button>
            <button class="history-manage-button danger" type="button" data-clear-reading-history>全部删除</button>
          </div>` : ''}
        ${readItems.length ? readButtons : '<div class="history-empty">暂无阅读历史</div>'}
      </div>
    </section>`;
}

function renderSearchSuggestions(searchHistory) {
  const queryItems = Array.isArray(searchHistory) ? searchHistory.slice(0, 20) : [];
  if (!queryItems.length) {
    return '';
  }

  const rows = queryItems
    .map((query) => `
      <div class="suggestion-row">
        <button class="suggestion-query" type="button" data-search-query="${escapeAttribute(query)}">${escapeHtml(query)}</button>
        <button class="suggestion-remove" type="button" data-delete-search-query="${escapeAttribute(query)}" aria-label="删除这条搜索历史">×</button>
      </div>`)
    .join('');

  return `
    <div class="search-suggestions" id="searchSuggestions" hidden>
      <div class="suggestions-head">
        <span>搜索历史</span>
        ${queryItems.length ? '<button class="suggestions-clear" type="button" data-clear-search-history>清除全部</button>' : ''}
      </div>
      ${rows}
    </div>`;
}

function renderSearchBody(page) {
  const groups = Array.isArray(page.groups) ? page.groups : [];
  const sections = groups
    .map((group) => {
      const items = Array.isArray(group.items) ? group.items.slice(0, 12) : [];
      const rows = items
        .map((item) => `
          <div class="search-row">
            <button class="search-link" type="button" data-open-url="${escapeAttribute(item.chaptersUrl || item.url)}">
              <span class="search-title">${escapeHtml(item.text || item.url)}</span>
              ${item.meta ? `<span class="search-meta">${escapeHtml(item.meta)}</span>` : ''}
            </button>
            <button class="button search-action" type="button" data-open-url="${escapeAttribute(item.url)}">${escapeHtml(item.actionText || '打开')}</button>
          </div>`)
        .join('');
      const content = group.error
        ? `<div class="search-empty error">${escapeHtml(group.error)}</div>`
        : items.length
          ? rows
          : '<div class="search-empty">没有找到相关作品</div>';

      return `
        <section class="search-group">
          <div class="search-group-head">
            <h2>${escapeHtml(group.label)}</h2>
            <span class="search-count">${items.length}</span>
          </div>
          ${content}
        </section>`;
    })
    .join('');
  const total = groups.reduce((sum, group) => sum + (Array.isArray(group.items) ? group.items.length : 0), 0);

  return `
    <section class="search-view">
      <h1>“${escapeHtml(page.query || '')}” 的搜索结果</h1>
      <p class="search-summary">已搜索 ${groups.length} 个站点，共找到 ${total} 个可打开结果。</p>
      ${sections}
    </section>`;
}

function renderListBody(page) {
  const items = Array.isArray(page.items) ? page.items.slice(0, 5000) : [];

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
      ${renderChapterNavigation(page, 'top')}
      <div class="content">${paragraphs}</div>
      ${renderChapterNavigation(page, 'bottom')}
      ${renderTocBody(page)}
    </article>`;
}

function renderChapterNavigation(page, position) {
  const hasToc = Array.isArray(page.toc) && page.toc.length > 0;
  let directoryAttributes = 'disabled';

  if (hasToc) {
    directoryAttributes = 'data-scroll-toc';
  } else if (page.catalogUrl) {
    directoryAttributes = `data-open-url="${escapeAttribute(page.catalogUrl)}"`;
  } else if (page.backAvailable) {
    directoryAttributes = 'data-go-back';
  }

  return `
    <nav class="chapter-nav${position === 'top' ? ' chapter-nav-top' : ''}" aria-label="章节导航">
      <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.prevUrl || '')}" ${page.prevUrl ? '' : 'disabled'}>上一章</button>
      <button class="nav-button nav-directory" type="button" ${directoryAttributes}>目录</button>
      <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.nextUrl || '')}" ${page.nextUrl ? '' : 'disabled'}>下一章</button>
    </nav>`;
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

function renderHistoryPanel(history, searchHistory = []) {
  const items = Array.isArray(history) ? history.slice(0, 20) : [];
  const queryItems = Array.isArray(searchHistory) ? searchHistory.slice(0, 20) : [];

  if (!items.length && !queryItems.length) {
    return `
      <section class="history-panel" id="historyPanel" hidden>
        <div class="history-empty">暂无历史记录</div>
      </section>`;
  }

  const searchRows = queryItems
    .map((query) => `<button class="search-history-link" type="button" data-search-query="${escapeAttribute(query)}">${escapeHtml(query)}</button>`)
    .join('');
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
      ${queryItems.length ? `<div class="history-heading">搜索历史</div><div class="search-history-list">${searchRows}</div>` : ''}
      ${items.length ? `<div class="history-heading">阅读历史</div>${rows}` : ''}
    </section>`;
}

function renderShell(webview, page) {
  const nonce = createNonce();
  const history = Array.isArray(page.history) ? page.history : [];
  const searchHistory = Array.isArray(page.searchHistory) ? page.searchHistory : [];
  const safeState = escapeScriptJson({
    kind: page.kind,
    url: page.url,
    value: page.value || (page.kind === 'search' ? page.query : page.url) || '',
    mode: page.mode || (page.kind === 'search' ? 'title' : 'url'),
    canRefresh: Boolean(page.url || page.mode === 'title' || page.kind === 'search' || page.kind === 'history'),
    title: page.title,
    prevUrl: page.prevUrl || '',
    nextUrl: page.nextUrl || '',
    canGoBack: Boolean(page.backAvailable)
  });
  const pageTitle = escapeHtml(page.pageTitle || getPanelTitle(page));
  const bodyClass = page.kind ? `page-${page.kind}` : 'page';
  const chapterDisabled = page.kind !== 'chapter' ? 'hidden' : '';
  const chapterToolbarDisabled = page.kind !== 'chapter' ? 'disabled' : '';
  const backDisabled = page.backAvailable ? '' : 'disabled';
  const refreshDisabled = page.url || page.mode === 'title' || page.kind === 'search' || page.kind === 'history' ? '' : 'disabled';
  const loadingProgress = page.kind === 'loading'
    ? '<div class="loading-progress" role="progressbar" aria-label="加载中" aria-valuemin="0" aria-valuemax="100" aria-valuenow="3"><div class="loading-progress-bar"></div></div>'
    : '';

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
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
    }

    .toolbar {
      display: grid;
      grid-template-columns: auto minmax(120px, 1fr) auto auto auto auto auto auto auto auto;
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

    .search-suggestions {
      position: absolute;
      top: 47px;
      right: 8px;
      left: 8px;
      z-index: 20;
      max-height: min(360px, 60vh);
      overflow: auto;
      padding: 6px;
      color: var(--reader-fg);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border, var(--border));
      border-radius: 5px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }

    .loading-progress {
      position: absolute;
      top: 47px;
      right: 0;
      left: 0;
      z-index: 30;
      height: 3px;
      overflow: hidden;
      background: color-mix(in srgb, var(--vscode-progressBar-background) 18%, transparent);
    }

    .loading-progress-bar {
      width: 3%;
      height: 100%;
      background: var(--vscode-progressBar-background);
      transition: width 160ms ease-out;
    }

    .search-suggestions[hidden] {
      display: none;
    }

    .suggestions-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 6px 7px;
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 650;
    }

    .suggestions-clear,
    .suggestion-query,
    .suggestion-remove {
      color: var(--reader-fg);
      background: transparent;
      border: 0;
      cursor: pointer;
      font: inherit;
    }

    .suggestions-clear {
      padding: 2px 4px;
      color: var(--link);
      font-size: 0.78rem;
      font-weight: 400;
    }

    .suggestion-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 28px;
      align-items: center;
      border-radius: 4px;
    }

    .suggestion-row:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .suggestion-query {
      min-width: 0;
      padding: 7px 8px;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .suggestion-remove {
      width: 28px;
      height: 28px;
      color: var(--muted);
      font-size: 16px;
    }

    .suggestion-remove:hover {
      color: var(--reader-fg);
    }

    .suggestions-empty {
      padding: 10px 8px;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .reader-shell {
      min-height: 0;
      overflow: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
    }

    .chapter-view,
    .list-view,
    .search-view,
    .history-view {
      width: min(960px, calc(100% - 24px));
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

    .chapter-nav-top {
      margin-top: 0;
      margin-bottom: 26px;
    }

    .search-summary {
      margin: 8px 0 24px;
      color: var(--muted);
    }

    .search-group {
      margin-top: 22px;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    .search-group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .search-group-head h2 {
      margin: 0;
      font-size: 1rem;
    }

    .search-count {
      min-width: 24px;
      padding: 1px 7px;
      color: var(--muted);
      text-align: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: 0.8rem;
    }

    .search-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
    }

    .search-row:last-child {
      border-bottom: 0;
    }

    .search-link {
      min-width: 0;
      padding: 4px 2px;
      color: var(--link);
      background: transparent;
      border: 0;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .search-title,
    .search-meta {
      display: block;
      overflow-wrap: anywhere;
    }

    .search-meta,
    .search-empty {
      margin-top: 2px;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .search-empty {
      padding: 12px;
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

    .history-heading {
      padding: 8px;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 650;
      letter-spacing: 0.04em;
    }

    .search-history-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 8px 10px;
    }

    .search-history-link {
      padding: 4px 9px;
      color: var(--link);
      background: var(--button-bg);
      border: 1px solid var(--border);
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
    }

    .search-history-link:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .history-page-section {
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }

    .history-page-section h2 {
      margin: 0;
      font-size: 1.05rem;
    }

    .history-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .history-manage-toggle,
    .history-manage-button {
      color: var(--link);
      background: transparent;
      border: 0;
      cursor: pointer;
      font: inherit;
    }

    .history-manage-toggle {
      padding: 3px 5px;
      font-size: 0.82rem;
    }

    .history-manage-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .history-manage-actions[hidden] {
      display: none;
    }

    .history-manage-button {
      padding: 5px 9px;
      color: var(--reader-fg);
      background: var(--button-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
    }

    .history-manage-button.danger {
      color: var(--vscode-inputValidation-errorForeground);
    }

    .history-page-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      border-radius: 4px;
    }

    .history-page-row:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .history-select-input {
      display: none;
      margin: 0 4px 0 10px;
      accent-color: var(--vscode-focusBorder);
    }

    .history-view.is-managing .history-select-input {
      display: block;
    }

    .history-view.is-managing .history-page-link {
      cursor: default;
    }

    .history-page-link {
      display: block;
      width: 100%;
      padding: 10px;
      color: var(--reader-fg);
      background: transparent;
      border: 0;
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .history-page-link:hover {
      background: var(--vscode-toolbar-hoverBackground);
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

    .page-list .chapter-only,
    .page-search .chapter-only {
      display: none;
    }

    @media (max-width: 720px) {
      .toolbar {
        grid-template-columns: auto minmax(100px, 1fr) auto auto auto auto;
      }

      .toolbar .chapter-only {
        display: none;
      }

      .chapter-view,
      .list-view,
      .search-view,
      .history-view {
        width: calc(100% - 20px);
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
      <button class="button" id="back" type="button" ${backDisabled}>返回</button>
      <input class="address" id="address" type="url" aria-label="地址" spellcheck="false">
      <button class="button" id="load" type="submit" title="读取">读取</button>
      <button class="button" id="refresh" type="button" title="刷新当前页面" ${refreshDisabled}>刷新</button>
      <button class="button chapter-only" id="prev" type="button" title="上一章" ${chapterToolbarDisabled}>上一章</button>
      <button class="button chapter-only" id="next" type="button" title="下一章" ${chapterToolbarDisabled}>下一章</button>
      <button class="button chapter-only" id="fontDown" type="button" title="减小字号" ${chapterToolbarDisabled}>A-</button>
      <button class="button chapter-only" id="fontUp" type="button" title="增大字号" ${chapterToolbarDisabled}>A+</button>
      <button class="button" id="external" type="button" title="在浏览器打开">打开</button>
      <button class="button" id="historyToggle" type="button" title="历史记录" aria-expanded="false">历史</button>
    </form>
    ${renderSearchSuggestions(searchHistory)}
    ${loadingProgress}
    <main class="reader-shell">
      ${page.body}
    </main>
  </div>
  <div class="toast" id="toast" role="status"></div>
  <script nonce="${nonce}">
    const state = ${safeState};
    const vscode = acquireVsCodeApi();
    const address = document.getElementById('address');
    const suggestions = document.getElementById('searchSuggestions');
    const toolbar = document.getElementById('toolbar');
    const back = document.getElementById('back');
    const refresh = document.getElementById('refresh');
    const external = document.getElementById('external');
    const prev = document.getElementById('prev');
    const next = document.getElementById('next');
    const fontDown = document.getElementById('fontDown');
    const fontUp = document.getElementById('fontUp');
    const historyToggle = document.getElementById('historyToggle');
    const toast = document.getElementById('toast');
    const progressElement = document.querySelector('.loading-progress');
    const progressBar = document.querySelector('.loading-progress-bar');

    address.type = 'text';
    address.placeholder = '输入书名或网址';
    address.value = state.value || '';
    restoreFontSize();
    syncChapterControls();
    syncBackButton();
    syncExternalButton();

    address.addEventListener('focus', () => showSearchSuggestions(true));
    address.addEventListener('click', () => showSearchSuggestions(true));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        showSearchSuggestions(false);
      }
    });
    document.addEventListener('click', (event) => {
      if (suggestions && !suggestions.contains(event.target) && event.target !== address) {
        showSearchSuggestions(false);
      }
    });

    toolbar.addEventListener('submit', (event) => {
      event.preventDefault();
      hideToast();
      vscode.postMessage({ command: 'load', value: address.value });
    });

    back.addEventListener('click', () => {
      vscode.postMessage({ command: 'back' });
    });

    refresh.addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    external.addEventListener('click', () => {
      vscode.postMessage({ command: 'openExternal', url: state.url });
    });

    historyToggle.addEventListener('click', () => {
      vscode.postMessage({ command: 'history' });
    });

    prev.addEventListener('click', () => loadChapter(state.prevUrl));
    next.addEventListener('click', () => loadChapter(state.nextUrl));
    fontDown.addEventListener('click', () => changeFontSize(-1));
    fontUp.addEventListener('click', () => changeFontSize(1));

    document.addEventListener('click', (event) => {
      const manageToggle = event.target && event.target.closest ? event.target.closest('[data-toggle-history-management]') : null;
      if (manageToggle) {
        event.preventDefault();
        const view = manageToggle.closest('.history-view');
        const actions = view.querySelector('.history-manage-actions');
        const managing = !view.classList.contains('is-managing');
        view.classList.toggle('is-managing', managing);
        actions.hidden = !managing;
        manageToggle.textContent = managing ? '完成' : '管理';
        view.querySelectorAll('[data-history-select]').forEach((checkbox) => {
          checkbox.checked = false;
        });
        return;
      }

      const selectAllTarget = event.target && event.target.closest ? event.target.closest('[data-select-all-history]') : null;
      if (selectAllTarget) {
        event.preventDefault();
        const checkboxes = [...document.querySelectorAll('[data-history-select]')];
        const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
        checkboxes.forEach((checkbox) => {
          checkbox.checked = shouldSelect;
        });
        selectAllTarget.textContent = shouldSelect ? '取消全选' : '全选';
        return;
      }

      const deleteSelectedTarget = event.target && event.target.closest ? event.target.closest('[data-delete-selected-history]') : null;
      if (deleteSelectedTarget) {
        event.preventDefault();
        const selected = [...document.querySelectorAll('[data-history-select]:checked')].map((checkbox) => checkbox.value);
        if (!selected.length) {
          showToast('请先选择要删除的历史。');
          return;
        }
        vscode.postMessage({ command: 'deleteReadingHistoryItems', urls: selected });
        return;
      }

      const clearReadingTarget = event.target && event.target.closest ? event.target.closest('[data-clear-reading-history]') : null;
      if (clearReadingTarget) {
        event.preventDefault();
        vscode.postMessage({ command: 'clearReadingHistory' });
        return;
      }

      const deleteTarget = event.target && event.target.closest ? event.target.closest('[data-delete-search-query]') : null;
      if (deleteTarget) {
        event.preventDefault();
        const query = deleteTarget.getAttribute('data-delete-search-query') || '';
        const row = deleteTarget.closest('.suggestion-row');
        if (row) {
          row.remove();
        }
        const remaining = suggestions.querySelectorAll('.suggestion-row').length;
        if (!remaining) {
          showSearchSuggestions(false);
        }
        vscode.postMessage({ command: 'deleteSearchHistory', query });
        return;
      }

      const clearTarget = event.target && event.target.closest ? event.target.closest('[data-clear-search-history]') : null;
      if (clearTarget) {
        event.preventDefault();
        suggestions.querySelectorAll('.suggestion-row').forEach((row) => row.remove());
        clearTarget.remove();
        showSearchSuggestions(false);
        vscode.postMessage({ command: 'clearSearchHistory' });
        return;
      }

      const tocTarget = event.target && event.target.closest ? event.target.closest('[data-scroll-toc]') : null;
      if (tocTarget) {
        event.preventDefault();
        const tocSection = document.querySelector('.toc-section');
        if (tocSection) {
          tocSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      const backTarget = event.target && event.target.closest ? event.target.closest('[data-go-back]') : null;
      if (backTarget) {
        event.preventDefault();
        vscode.postMessage({ command: 'back' });
        return;
      }

      const searchTarget = event.target && event.target.closest ? event.target.closest('[data-search-query]') : null;
      if (searchTarget) {
        event.preventDefault();
        hideToast();
        vscode.postMessage({ command: 'search', query: searchTarget.getAttribute('data-search-query') || '' });
        return;
      }

      const target = event.target && event.target.closest ? event.target.closest('[data-open-url]') : null;
      if (!target) {
        return;
      }

      const url = target.getAttribute('data-open-url');
      if (!url) {
        return;
      }

      if (target.classList.contains('history-page-link') && document.querySelector('.history-view.is-managing')) {
        event.preventDefault();
        const checkbox = target.closest('.history-page-row')?.querySelector('[data-history-select]');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
        }
        return;
      }

      if (target.classList.contains('item-link') || target.classList.contains('icon-button') || target.classList.contains('search-link') || target.classList.contains('search-action') || target.classList.contains('nav-button') || target.classList.contains('toc-link') || target.classList.contains('history-link') || target.classList.contains('history-page-link')) {
        event.preventDefault();
        hideToast();
        vscode.postMessage({ command: 'openItem', url });
      }
    });

    window.addEventListener('message', (event) => {
      if (event.data && event.data.command === 'toast') {
        showToast(event.data.message);
        return;
      }

      if (event.data && event.data.command === 'progress' && progressElement && progressBar) {
        const percent = Math.max(0, Math.min(100, Number(event.data.percent) || 0));
        progressBar.style.width = percent + '%';
        progressElement.setAttribute('aria-valuenow', String(percent));
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

    function syncBackButton() {
      back.disabled = !state.canGoBack;
    }

    function showSearchSuggestions(open) {
      if (!suggestions) {
        return;
      }
      suggestions.toggleAttribute('hidden', !open);
      suggestions.style.display = open ? 'block' : 'none';
    }

    function syncExternalButton() {
      external.disabled = !state.url;
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
  renderHistoryPage,
  renderHomeHtml,
  renderLoadingHtml,
  renderPageHtml,
  renderSearchErrorHtml,
  renderSearchLoadingHtml
};
