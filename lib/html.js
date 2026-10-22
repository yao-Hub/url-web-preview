const { resolveUrl } = require('./url');

function stripNoisyBlocks(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return String(value).replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] && entity[1].toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase()) ? named[entity.toLowerCase()] : match;
  });
}

function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
  );
}

function normalizeText(value) {
  return String(value)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
}

function cleanNovelText(text) {
  const noisyLine = /(最新网址|最新章节|手机用户|请收藏|加入书签|推荐票|月票|天才一秒|本章未完|点击下一页|返回目录|上一章|下一章|章节目录|readx|www\.|https?:\/\/)/i;

  const lines = String(text)
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter((line) => line && !noisyLine.test(line));

  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function extractTitle(html, fallbackUrl) {
  const h1 = firstText(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    return h1;
  }

  const title = firstText(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    return title.split(/[_\-|—｜]/)[0].trim() || title;
  }

  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return '小小说';
  }
}

function firstText(html, regex) {
  const match = String(html).match(regex);
  return match ? normalizeText(htmlToText(match[1])) : '';
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of String(html).matchAll(anchorRegex)) {
    const href = match[1];
    const url = resolveUrl(href, baseUrl);
    const text = normalizeText(htmlToText(match[2]));
    const key = `${url}::${text}`;

    if (!url || !text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    anchors.push({ text, url });
  }

  return anchors;
}

function extractChapterContent(html) {
  const cleanHtml = stripNoisyBlocks(html);
  const candidates = collectContentCandidates(cleanHtml);

  const best = candidates
    .map((candidate) => ({
      text: cleanNovelText(htmlToText(candidate.html)),
      score: scoreContentCandidate(candidate.html)
    }))
    .filter((candidate) => candidate.text.length >= 80)
    .sort((a, b) => b.score - a.score)[0];

  if (best) {
    return best.text;
  }

  const bodyMatch = cleanHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return cleanNovelText(htmlToText(bodyMatch ? bodyMatch[1] : cleanHtml));
}

function collectContentCandidates(html) {
  const candidates = [];
  const preferredNames = [
    'content',
    'chaptercontent',
    'chapter_content',
    'chapter-content',
    'articlecontent',
    'article_content',
    'readcontent',
    'read-content',
    'booktxt',
    'book_text',
    'novelcontent',
    'novel_content',
    'htmlcontent',
    'article-body',
    'article_body'
  ];

  for (const name of preferredNames) {
    const regex = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*(?:id|class)=["'][^"']*${escapeRegExp(name)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
    for (const match of html.matchAll(regex)) {
      candidates.push({ html: match[2] });
    }
  }

  const blockRegex = /<(article|main|section|div)\b[^>]*>([\s\S]{200,}?)<\/\1>/gi;
  for (const match of html.matchAll(blockRegex)) {
    candidates.push({ html: match[2] });
  }

  return candidates;
}

function scoreContentCandidate(html) {
  const text = cleanNovelText(htmlToText(html));
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const lineCount = text.split(/\n+/).filter(Boolean).length;
  const linkCount = (String(html).match(/<a\b/gi) || []).length;
  const paragraphCount = (String(html).match(/<(p|br|div)\b/gi) || []).length;

  return text.length + chineseChars * 1.5 + lineCount * 80 + paragraphCount * 12 - linkCount * 160;
}

function extractChapterLinks(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl);
  const prev = anchors.find((link) => /(上一章|上一节|上章|上页|previous|prev|<)/i.test(link.text));
  const next = anchors.find((link) => /(下一章|下一节|下章|下页|next|>)/i.test(link.text));

  return {
    prevUrl: prev ? prev.url : '',
    nextUrl: next ? next.url : ''
  };
}

function isUsefulListAnchor(anchor) {
  const text = anchor.text.trim();

  if (!text || text.length > 120) {
    return false;
  }

  if (/^(首页|上一页|下一页|下一章|上一章|目录|登录|注册|收藏|推荐|分享|返回|更多|阅读|下载|搜索|分类|排行|书架|标签|评论)$/i.test(text)) {
    return false;
  }

  if (/^(javascript:|#|mailto:)/i.test(anchor.url)) {
    return false;
  }

  return true;
}

function extractListItems(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl).filter(isUsefulListAnchor);
  const items = [];
  const seen = new Set();

  for (const anchor of anchors) {
    if (seen.has(anchor.url)) {
      continue;
    }

    seen.add(anchor.url);
    items.push(anchor);
  }

  return items;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  cleanNovelText,
  escapeAttribute,
  escapeHtml,
  escapeScriptJson,
  extractAnchors,
  extractChapterContent,
  extractChapterLinks,
  extractListItems,
  extractTitle,
  htmlToText,
  normalizeText,
  stripNoisyBlocks
};
