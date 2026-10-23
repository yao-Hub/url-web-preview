const { createBrowserHeaders, fetchHtml } = require('../http');
const { extractAnchors, normalizeText } = require('../html');
const { loadReaderChapterPage, loadReaderTocPage } = require('../epub');

function match(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)l3zc\.com$/i.test(parsed.hostname) && /^\/read\/\d+\/epub\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function load(url, options = {}) {
  if (new URL(url).searchParams.get('toc') === '1') {
    return loadReaderTocPage(url, options);
  }
  return loadReaderChapterPage(url, options);
}

async function search(query) {
  const searchUrl = `https://books.l3zc.com/search?query=${encodeURIComponent(query)}`;
  const { html, url } = await fetchHtml(searchUrl, {
    headers: createBrowserHeaders(),
    timeoutMs: 15000
  });
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(html, url)) {
    let bookId = '';
    try {
      const matchResult = new URL(anchor.url).pathname.match(/^\/book\/(\d+)\/?$/);
      bookId = matchResult ? matchResult[1] : '';
    } catch {
      continue;
    }

    if (!bookId || seen.has(bookId)) {
      continue;
    }

    const title = String(anchor.text).split(/\n+/).map((line) => normalizeText(line)).find(Boolean);
    if (!title) {
      continue;
    }

    seen.add(bookId);
    const readUrl = `https://books.l3zc.com/read/${bookId}/epub`;
    items.push({
      text: title,
      actionText: '开始阅读',
      chaptersUrl: `${readUrl}?toc=1`,
      url: readUrl
    });
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
