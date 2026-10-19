const { createMobileHeaders, fetchHtml } = require('../http');
const { cleanNovelText, htmlToText, extractTitle } = require('../html');

function match(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)qidian\.com$/i.test(parsed.hostname) && /^\/chapter\/\d+\/\d+\/?$/.test(parsed.pathname);
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

async function load(url) {
  const { bookId, chapterId } = getIds(url);
  if (!bookId || !chapterId) {
    throw new Error('没有识别到起点章节 ID。');
  }

  const mobileUrl = `https://m.qidian.com/chapter/${bookId}/${chapterId}/`;
  const { html } = await fetchHtml(mobileUrl, { headers: createMobileHeaders() });
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
    nextUrl: toChapterUrl(bookId, chapterInfo.next)
  };
}

module.exports = {
  load,
  match
};
