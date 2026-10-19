const { createJsonHeaders, fetchJson } = require('../http');
const { cleanNovelText, htmlToText } = require('../html');

function match(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)kadokado\.com\.tw$/i.test(parsed.hostname) && /^\/chapter\/\d+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function getChapterId(url) {
  try {
    const parsed = new URL(url);
    const matchResult = parsed.pathname.match(/^\/chapter\/(\d+)\/?$/);
    return matchResult ? matchResult[1] : '';
  } catch {
    return '';
  }
}

async function load(url) {
  const chapterId = getChapterId(url);

  if (!chapterId) {
    throw new Error('没有识别到 KadoKado 章节 ID。');
  }

  const apiBase = 'https://api.kadokado.com.tw/v3/chapter';
  const headers = createJsonHeaders(url, 'https://www.kadokado.com.tw');
  const [info, contentData] = await Promise.all([
    fetchJson(`${apiBase}/${chapterId}/info`, { headers }),
    fetchJson(`${apiBase}/${chapterId}/content`, { headers })
  ]);

  const content = cleanNovelText(htmlToText(typeof contentData.content === 'string' ? contentData.content : ''));

  if (!content) {
    throw new Error('KadoKado 没有返回可阅读正文。');
  }

  return {
    kind: 'chapter',
    source: 'kadokado',
    url,
    title: info.chapterDisplayName || info.titleDisplayName || '小说阅读',
    content,
    prevUrl: info.prevChapterId ? `https://www.kadokado.com.tw/chapter/${info.prevChapterId}` : '',
    nextUrl: info.nextChapterId ? `https://www.kadokado.com.tw/chapter/${info.nextChapterId}` : ''
  };
}

module.exports = {
  load,
  match
};
