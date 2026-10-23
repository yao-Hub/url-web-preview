const { createBrowserHeaders, fetchHtml } = require('../http');
const { extractAnchors, extractTitle, normalizeText } = require('../html');
const { buildChapterPage, buildListPage, classifyPage } = require('./generic');

function match(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)alicesw\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isListUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/lists?\//.test(path) || /\/lists?\.html$/.test(path);
  } catch {
    return false;
  }
}

function isNovelUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/novel\/\d+\.html$/.test(path);
  } catch {
    return false;
  }
}

function isBookUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/book\/\d+\/[^/]+\.html$/.test(path);
  } catch {
    return false;
  }
}

async function load(url, options = {}) {
  const { html, url: finalUrl } = await fetchHtml(url, {
    ...options,
    headers: createBrowserHeaders()
  });
  if (isNovelUrl(finalUrl)) {
    return buildNovelListPage(finalUrl, html, options);
  }
  const kind = isBookUrl(finalUrl) ? 'chapter' : isListUrl(finalUrl) || isNovelUrl(finalUrl) ? 'list' : classifyPage(finalUrl, html);
  if (kind === 'list') {
    return buildListPage(finalUrl, html, 'alicesw');
  }

  const page = buildChapterPage(finalUrl, html, 'alicesw');
  const novelId = new URL(finalUrl).pathname.match(/^\/book\/(\d+)\//i)?.[1];
  if (novelId) {
    page.catalogUrl = `https://www.alicesw.com/novel/${novelId}.html`;
  }
  return page;
}

async function buildNovelListPage(url, html, options = {}) {
  let items = extractChapterItems(html, url);

  if (!items.length) {
    const novelId = new URL(url).pathname.match(/^\/novel\/(\d+)\.html$/i)?.[1];
    if (novelId) {
      const catalogUrl = `https://www.alicesw.com/other/chapters/id/${novelId}.html`;
      const catalog = await fetchHtml(catalogUrl, {
        ...options,
        headers: createBrowserHeaders(),
        timeoutMs: options.timeoutMs || 15000
      });
      items = extractChapterItems(catalog.html, catalog.url);
    }
  }

  if (!items.length) {
    throw new Error('AliceSW 没有识别到章节目录。');
  }

  return {
    kind: 'list',
    source: 'alicesw',
    url,
    title: extractTitle(html, url),
    items
  };
}

function extractChapterItems(html, url) {
  const match = String(html).match(/<ul\b[^>]*class=["'][^"']*\bmulu_list\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
  return match
    ? extractAnchors(match[1], url).filter((item) => /\/book\/\d+\/[^/]+\.html$/i.test(new URL(item.url).pathname))
    : [];
}

async function search(query) {
  const searchUrl = `https://www.alicesw.com/search.html?q=${encodeURIComponent(query)}&f=_all`;
  const { html, url } = await fetchHtml(searchUrl, {
    headers: createBrowserHeaders(),
    timeoutMs: 15000
  });
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(html, url)) {
    let pathname = '';
    try {
      pathname = new URL(anchor.url).pathname;
    } catch {
      continue;
    }

    if (!/^\/novel\/\d+\.html$/i.test(pathname) || seen.has(anchor.url)) {
      continue;
    }

    const title = String(anchor.text).split(/\n+/).map((line) => normalizeText(line)).find(Boolean);
    if (!title) {
      continue;
    }

    seen.add(anchor.url);
    items.push({ text: title, url: anchor.url, chaptersUrl: anchor.url, actionText: '章节选择' });
    if (items.length >= 12) {
      break;
    }
  }

  return items;
}

module.exports = {
  load,
  match,
  search
};
