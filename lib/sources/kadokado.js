const { createJsonHeaders, fetchJson } = require('../http');
const { cleanNovelText, htmlToText } = require('../html');

function match(url) {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)kadokado\.com\.tw$/i.test(parsed.hostname) &&
      (/^\/chapter\/\d+\/?$/.test(parsed.pathname) || /^\/book\/\d+\/?$/.test(parsed.pathname))
    );
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
  if (/^\/book\/\d+\/?$/.test(new URL(url).pathname)) {
    return loadBook(url);
  }

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
    title: info.chapterDisplayName || info.titleDisplayName || '小小说',
    content,
    prevUrl: info.prevChapterId ? `https://www.kadokado.com.tw/chapter/${info.prevChapterId}` : '',
    nextUrl: info.nextChapterId ? `https://www.kadokado.com.tw/chapter/${info.nextChapterId}` : '',
    catalogUrl: info.titleId ? `https://www.kadokado.com.tw/book/${info.titleId}` : ''
  };
}

async function loadBook(url) {
  const titleId = new URL(url).pathname.match(/^\/book\/(\d+)\/?$/)[1];
  const headers = createJsonHeaders(url, 'https://www.kadokado.com.tw');
  const [titleInfo, collections] = await Promise.all([
    fetchJson(`https://api.kadokado.com.tw/v2/titles/${titleId}`, { headers }),
    fetchJson(`https://api.kadokado.com.tw/v3/title/${titleId}/collection`, { headers })
  ]);
  const items = [];

  for (const collection of Array.isArray(collections) ? collections : []) {
    for (const chapter of collection.chapters || []) {
      if (!chapter.chapterId || !chapter.chapterDisplayName) {
        continue;
      }

      items.push({
        text: collection.collectionDisplayName
          ? `${collection.collectionDisplayName} / ${chapter.chapterDisplayName}`
          : chapter.chapterDisplayName,
        url: `https://www.kadokado.com.tw/chapter/${chapter.chapterId}`
      });
    }
  }

  if (!items.length) {
    throw new Error('KadoKado 没有可阅读的章节。');
  }

  return {
    kind: 'list',
    source: 'kadokado',
    url,
    title: titleInfo.displayName || 'KadoKado 作品',
    items
  };
}

async function search(query) {
  const headers = createJsonHeaders('https://www.kadokado.com.tw/', 'https://www.kadokado.com.tw');
  const data = await fetchJson(
    `https://api.kadokado.com.tw/v3/search?keyword=${encodeURIComponent(query)}&current=1&limit=12`,
    { headers }
  );

  return (Array.isArray(data.data) ? data.data : []).map((item) => ({
    text: item.displayName || item.oneLineIntro || 'KadoKado 作品',
    meta: [item.ownerDisplayName, item.oneLineIntro].filter(Boolean).join(' · '),
    actionText: '章节选择',
    chaptersUrl: `https://www.kadokado.com.tw/book/${item.id}`,
    url: `https://www.kadokado.com.tw/book/${item.id}`
  }));
}

module.exports = {
  load,
  match,
  search
};
