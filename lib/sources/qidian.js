const { createMobileHeaders, fetchHtml } = require('../http');
const { cleanNovelText, extractAnchors, htmlToText, extractTitle, normalizeText } = require('../html');

function match(url) {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)qidian\.com$/i.test(parsed.hostname) &&
      (/^\/chapter\/\d+\/\d+\/?$/.test(parsed.pathname) || /^\/book\/\d+\/(?:catalog\/?)?$/i.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function getIds(url) {
  try {
    const parsed = new URL(url);
    const matchResult = parsed.pathname.match(/^\/chapter\/(\d+)\/(\d+)\/?$/);
    return matchResult ? { bookId: matchResult[1], chapterId: matchResult[2] } : { bookId: '', chapterId: '' };
  } catch {
    return { bookId: '', chapterId: '' };
  }
}

function extractPageContext(html) {
  const match = String(html).match(/<script id="vite-plugin-ssr_pageContext" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function toChapterUrl(bookId, chapterId) {
  if (!chapterId || chapterId === -1 || chapterId === '-1') {
    return '';
  }

  return `https://www.qidian.com/chapter/${bookId}/${chapterId}/`;
}

async function load(url, options = {}) {
  if (/^\/book\/\d+\/(?:catalog\/?)?$/i.test(new URL(url).pathname)) {
    return loadCatalog(url, options);
  }

  const { bookId, chapterId } = getIds(url);
  if (!bookId || !chapterId) {
    throw new Error('没有识别到起点章节 ID。');
  }

  const mobileUrl = `https://m.qidian.com/chapter/${bookId}/${chapterId}/`;
  const { html } = await fetchHtml(mobileUrl, {
    ...options,
    headers: createMobileHeaders()
  });
  const pageContext = extractPageContext(html);
  const pageData = pageContext && pageContext.pageContext && pageContext.pageContext.pageProps && pageContext.pageContext.pageProps.pageData;
  const chapterInfo = pageData && pageData.chapterInfo;
  const bookInfo = pageData && pageData.bookInfo;

  if (!chapterInfo || !bookInfo) {
    throw new Error('没有识别到起点章节正文。可能需要登录后才能查看。');
  }

  const content = cleanNovelText(htmlToText(chapterInfo.content || ''));
  if (!content) {
    throw new Error('起点章节正文为空。');
  }

  const chapterTitle = chapterInfo.chapterName || extractTitle(html, url);
  const bookTitle = bookInfo.bookName || '';
  const authorName = bookInfo.authorName || '';

  return {
    kind: 'chapter',
    source: 'qidian',
    url,
    title: authorName && bookTitle ? `${chapterTitle} | ${authorName}《${bookTitle}》` : chapterTitle,
    content,
    prevUrl: toChapterUrl(bookId, chapterInfo.prev),
    nextUrl: toChapterUrl(bookId, chapterInfo.next),
    catalogUrl: `https://m.qidian.com/book/${bookId}/catalog/`
  };
}

async function loadCatalog(url, options = {}) {
  const bookId = new URL(url).pathname.match(/^\/book\/(\d+)/i)[1];
  const catalogUrl = `https://m.qidian.com/book/${bookId}/catalog/`;
  const { html, url: finalUrl } = await fetchHtml(catalogUrl, {
    ...options,
    headers: createMobileHeaders()
  });
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(html, finalUrl)) {
    if (/作家入驻|即更即看|还有番外/.test(anchor.text)) {
      continue;
    }

    let chapterId = '';
    try {
      const matchResult = new URL(anchor.url).pathname.match(/^\/chapter\/\d+\/(\d+)\/?$/);
      chapterId = matchResult ? matchResult[1] : '';
    } catch {
      continue;
    }

    if (!chapterId || seen.has(chapterId)) {
      continue;
    }

    const title = String(anchor.text)
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .find(Boolean);
    if (!title) {
      continue;
    }

    seen.add(chapterId);
    items.push({
      text: title,
      url: `https://m.qidian.com/chapter/${bookId}/${chapterId}/`
    });
  }

  if (!items.length) {
    throw new Error('起点没有识别到章节目录。');
  }

  return {
    kind: 'list',
    source: 'qidian',
    url: catalogUrl,
    title: extractTitle(html, catalogUrl),
    items
  };
}

async function search(query) {
  const searchUrl = `https://m.qidian.com/search?kw=${encodeURIComponent(query)}`;
  const { html, url } = await fetchHtml(searchUrl, {
    headers: createMobileHeaders(),
    timeoutMs: 15000
  });
  const items = [];
  const seenBooks = new Set();

  for (const anchor of extractAnchors(html, url)) {
    let bookId = '';
    let chapterId = '';

    try {
      const parsed = new URL(anchor.url);
      const matchResult = parsed.pathname.match(/^\/chapter\/(\d+)\/(\d+)\/?$/);
      if (!matchResult) {
        continue;
      }
      bookId = matchResult[1];
      chapterId = matchResult[2];
    } catch {
      continue;
    }

    if (seenBooks.has(bookId)) {
      continue;
    }

    const title = String(anchor.text)
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .find(Boolean);

    if (!title) {
      continue;
    }

    seenBooks.add(bookId);
    items.push({
      text: title,
      chaptersUrl: `https://m.qidian.com/book/${bookId}/catalog/`,
      url: `https://m.qidian.com/chapter/${bookId}/${chapterId || '0'}/`,
      actionText: '开始阅读'
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
