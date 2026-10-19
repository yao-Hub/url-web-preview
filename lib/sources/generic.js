const { createBrowserHeaders, fetchHtml } = require('../http');
const {
  cleanNovelText,
  extractAnchors,
  extractChapterContent,
  extractChapterLinks,
  extractListItems,
  extractTitle,
  htmlToText,
  stripNoisyBlocks
} = require('../html');

function isListLikePath(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/lists?\//.test(path) || /\/(list|catalog|directory|index|shelf)\b/.test(path);
  } catch {
    return false;
  }
}

function classifyPage(url, html) {
  const listItems = extractListItems(html, url);
  const chapterText = extractChapterContent(html);
  const plainText = cleanNovelText(htmlToText(stripNoisyBlocks(html)));
  const listScore = scoreListPage(url, plainText, listItems);
  const chapterScore = scoreChapterPage(url, chapterText, html);

  if (isListLikePath(url)) {
    return 'list';
  }

  if (listScore >= chapterScore + 2 && listItems.length >= 4) {
    return 'list';
  }

  if (chapterScore >= listScore) {
    return 'chapter';
  }

  return listItems.length > 8 ? 'list' : 'chapter';
}

function scoreListPage(url, text, listItems) {
  let score = 0;

  if (isListLikePath(url)) {
    score += 4;
  }

  if (/(小说列表|列表|目录|最新章节|作者|字数|更新时间|书名)/.test(text)) {
    score += 3;
  }

  if (listItems.length >= 20) {
    score += 4;
  } else if (listItems.length >= 10) {
    score += 3;
  } else if (listItems.length >= 4) {
    score += 1;
  }

  return score;
}

function scoreChapterPage(url, chapterText, html) {
  let score = 0;

  if (chapterText.length >= 400) {
    score += 4;
  } else if (chapterText.length >= 120) {
    score += 2;
  }

  if (/<h1\b/i.test(html)) {
    score += 1;
  }

  if ((String(html).match(/<p\b/gi) || []).length >= 5) {
    score += 2;
  }

  return score;
}

function buildChapterPage(url, html, source = 'generic') {
  const title = extractTitle(html, url);
  const content = extractChapterContent(html);
  const { prevUrl, nextUrl } = extractChapterLinks(html, url);

  if (!content) {
    throw new Error('没有识别到小说正文。');
  }

  return {
    kind: 'chapter',
    source,
    url,
    title,
    content,
    prevUrl,
    nextUrl
  };
}

function buildListPage(url, html, source = 'generic') {
  const title = extractTitle(html, url);
  const items = extractListItems(html, url);

  if (!items.length) {
    throw new Error('没有识别到列表项。');
  }

  return {
    kind: 'list',
    source,
    url,
    title,
    items
  };
}

async function load(url) {
  const { html, url: finalUrl } = await fetchHtml(url, { headers: createBrowserHeaders() });
  const kind = classifyPage(finalUrl, html);
  return kind === 'list' ? buildListPage(finalUrl, html) : buildChapterPage(finalUrl, html);
}

module.exports = {
  buildChapterPage,
  buildListPage,
  classifyPage,
  load
};
