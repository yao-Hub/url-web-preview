const { createBrowserHeaders, fetchHtml } = require('../http');
const {
  extractAnchors,
  extractChapterContent,
  extractTitle,
  normalizeText
} = require('../html');

const HOST_PATTERN = /(^|\.)quanben\.io$/i;
const BOOK_PATTERN = /^\/n\/([^/]+)\/?$/i;
const LIST_PATTERN = /^\/n\/([^/]+)\/list\.html$/i;
const CHAPTER_PATTERN = /^\/n\/([^/]+)\/(\d+)\.html$/i;

function match(url) {
  try {
    const parsed = new URL(url);
    return (
      HOST_PATTERN.test(parsed.hostname) &&
      (
        BOOK_PATTERN.test(parsed.pathname) ||
        LIST_PATTERN.test(parsed.pathname) ||
        CHAPTER_PATTERN.test(parsed.pathname)
      )
    );
  } catch {
    return false;
  }
}

function getBookSlug(url) {
  const pathname = new URL(url).pathname;
  return (
    pathname.match(BOOK_PATTERN)?.[1] ||
    pathname.match(LIST_PATTERN)?.[1] ||
    pathname.match(CHAPTER_PATTERN)?.[1] ||
    ''
  );
}

function buildCatalogUrl(url) {
  const slug = getBookSlug(url);
  return slug ? `https://www.quanben.io/n/${slug}/list.html` : '';
}

function buildChapterPage(url, html) {
  const content = extractChapterContent(html);
  if (!content) {
    throw new Error('全本小说网没有识别到章节正文。');
  }

  const anchors = extractAnchors(html, url);
  const prev = anchors.find((item) => /^(上一页|上一章|上一节|上一篇)$/i.test(item.text));
  const next = anchors.find((item) => /^(下一页|下一章|下一节|下一篇)$/i.test(item.text));

  return {
    kind: 'chapter',
    source: 'quanben',
    url,
    title: extractTitle(html, url),
    content,
    prevUrl: prev ? prev.url : '',
    nextUrl: next ? next.url : '',
    catalogUrl: buildCatalogUrl(url)
  };
}

function extractChapterItems(html, url) {
  const slug = getBookSlug(url);
  const chapterPath = new RegExp(`^/n/${escapeRegExp(slug)}/\\d+\\.html$`, 'i');
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(html, url)) {
    let pathname = '';
    try {
      pathname = new URL(anchor.url).pathname;
    } catch {
      continue;
    }

    if (!slug || !chapterPath.test(pathname) || seen.has(anchor.url)) {
      continue;
    }

    const title = String(anchor.text)
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .find(Boolean);
    if (!title) {
      continue;
    }

    seen.add(anchor.url);
    items.push({ text: title, url: anchor.url });
  }

  return items;
}

async function buildListPage(url, html) {
  const items = extractChapterItems(html, url);
  if (!items.length) {
    throw new Error('全本小说网没有识别到章节目录。');
  }

  const fullItems = await loadCompleteChapterList(url, html);
  const merged = new Map(items.map((item) => [item.url, item]));
  for (const item of fullItems) {
    merged.set(item.url, item);
  }

  return {
    kind: 'list',
    source: 'quanben',
    url,
    title: extractTitle(html, url),
    items: [...merged.values()].sort((left, right) => getChapterNumber(left.url) - getChapterNumber(right.url))
  };
}

async function loadCompleteChapterList(url, html) {
  const callback = String(html).match(/var callback=['"]([^'"]+)['"]/i)?.[1] || '';
  const bookId = String(html).match(/load_more\(['"]?(\d+)['"]?\)/i)?.[1] || '';
  const staticChars = String(html).match(/var staticchars=['"]([^'"]+)['"]/i)?.[1] || '';

  if (!callback || !bookId || !staticChars) {
    return [];
  }

  const apiUrl = new URL('https://www.quanben.io/index.php');
  apiUrl.search = new URLSearchParams({
    c: 'book',
    a: 'list.jsonp',
    callback,
    book_id: bookId,
    b: encodeJsonpCallback(callback, staticChars)
  }).toString();

  try {
    const response = await fetchHtml(apiUrl.toString(), {
      headers: {
        ...createBrowserHeaders(),
        accept: '*/*',
        referer: url,
        'x-requested-with': 'XMLHttpRequest'
      },
      timeoutMs: 15000
    });
    const jsonMatch = response.html.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
    if (!jsonMatch) {
      return [];
    }

    const data = JSON.parse(jsonMatch[1]);
    return extractChapterItems(typeof data.content === 'string' ? data.content : '', url);
  } catch {
    return [];
  }
}

function encodeJsonpCallback(callback, staticChars) {
  let encoded = '';
  for (const character of callback) {
    const index = staticChars.indexOf(character);
    const code = index < 0 ? character : staticChars[(index + 3) % staticChars.length];
    const prefix = staticChars[Math.floor(Math.random() * staticChars.length)];
    const suffix = staticChars[Math.floor(Math.random() * staticChars.length)];
    encoded += prefix + code + suffix;
  }
  return encoded;
}

function getChapterNumber(url) {
  return Number(new URL(url).pathname.match(/\/(\d+)\.html$/)?.[1]) || 0;
}

async function load(url, options = {}) {
  const parsed = new URL(url);
  const targetUrl = BOOK_PATTERN.test(parsed.pathname) ? buildCatalogUrl(url) : url;
  const { html, url: finalUrl } = await fetchHtml(targetUrl, {
    ...options,
    headers: createBrowserHeaders(),
    timeoutMs: options.timeoutMs || 15000
  });

  if (LIST_PATTERN.test(new URL(finalUrl).pathname)) {
    return buildListPage(finalUrl, html);
  }

  return buildChapterPage(finalUrl, html);
}

async function search(query) {
  const searchUrl = `https://www.quanben.io/index.php?c=book&a=search&keywords=${encodeURIComponent(query)}`;
  const { html, url } = await fetchHtml(searchUrl, {
    headers: createBrowserHeaders(),
    timeoutMs: 15000
  });
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(html, url)) {
    let parsed;
    try {
      parsed = new URL(anchor.url);
    } catch {
      continue;
    }

    if (!HOST_PATTERN.test(parsed.hostname) || !BOOK_PATTERN.test(parsed.pathname) || seen.has(anchor.url)) {
      continue;
    }

    const title = String(anchor.text)
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .find(Boolean);
    if (!title) {
      continue;
    }

    seen.add(anchor.url);
    items.push({
      text: title,
      actionText: '章节选择',
      chaptersUrl: buildCatalogUrl(anchor.url),
      url: buildCatalogUrl(anchor.url)
    });

    if (items.length >= 12) {
      break;
    }
  }

  return items;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  buildChapterPage,
  buildListPage,
  load,
  match,
  search
};
