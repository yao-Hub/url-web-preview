const { createBrowserHeaders, fetchHtml } = require('../http');
const tls = require('tls');
const {
  cleanNovelText,
  extractAnchors,
  extractTitle,
  htmlToText,
  stripNoisyBlocks
} = require('../html');

const CHAPTER_PATTERN = /^\/book\/[^/]+\/\d+\.htm$/i;
const INDEX_PATTERN = /^\/book\/[^/]+\/index(?:_\d+)?\.htm$/i;
const BLOG_POST_PATTERN = /^\/\d{4}\/\d{2}\/[^/]+\.html$/i;
const CLOUDFLARE_EDGE_IPS = ['172.67.149.200', '104.21.29.203'];

function match(url) {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)xbookcn\.net$/i.test(parsed.hostname) &&
      (
        CHAPTER_PATTERN.test(parsed.pathname) ||
        INDEX_PATTERN.test(parsed.pathname) ||
        BLOG_POST_PATTERN.test(parsed.pathname)
      )
    );
  } catch {
    return false;
  }
}

function isIndexUrl(url) {
  try {
    return INDEX_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isBlogPostUrl(url) {
  try {
    return BLOG_POST_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function extractContainerInner(html, tagName, className) {
  const source = String(html);
  const escapedTag = escapeRegExp(tagName);
  const escapedClass = escapeRegExp(className);
  const startPattern = new RegExp(
    `<${escapedTag}\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*>`,
    'i'
  );
  const start = startPattern.exec(source);

  if (!start) {
    return '';
  }

  const tagPattern = new RegExp(`<\\/?${escapedTag}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = start.index;

  let depth = 0;
  for (const match of source.matchAll(tagPattern)) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start.index + start[0].length, match.index);
      }
    } else {
      depth += 1;
    }
  }

  return '';
}

function extractNavLinks(html, url) {
  const navHtml = extractContainerInner(html, 'div', 'next');
  const anchors = extractAnchors(navHtml, url);
  const prev = anchors.find((link) => /(上一页|上一章|上一节|上章|上页|上一篇)/i.test(link.text));
  const next = anchors.find((link) => /(下一页|下一章|下一节|下章|下页|下一篇)/i.test(link.text));

  return {
    prevUrl: prev ? prev.url : '',
    nextUrl: next ? next.url : ''
  };
}

function buildChapterPage(url, html) {
  const contentHtml =
    extractContainerInner(html, 'div', 'nr') || extractContainerInner(html, 'div', 'content');
  const content = cleanNovelText(htmlToText(stripNoisyBlocks(contentHtml)));

  if (!content) {
    throw new Error('没有识别到 xbookcn 小说正文。');
  }

  const bookId = new URL(url).pathname.match(/^\/book\/([^/]+)\//i)?.[1] || '';

  return {
    kind: 'chapter',
    source: 'xbookcn',
    url,
    title: extractTitle(html, url),
    content,
    catalogUrl: bookId ? `https://www.xbookcn.net/book/${bookId}/index.htm` : '',
    ...extractNavLinks(html, url)
  };
}

function buildListPage(url, html) {
  const listHtml = extractContainerInner(html, 'div', 'centent');
  const bookPath = new URL(url).pathname.replace(/\/index(?:_\d+)?\.htm$/i, '/');
  const items = extractAnchors(listHtml, url).filter((item) => {
    try {
      const pathname = new URL(item.url).pathname;
      return pathname.startsWith(bookPath) && /\.htm$/i.test(pathname) && !INDEX_PATTERN.test(pathname);
    } catch {
      return false;
    }
  });

  if (!items.length) {
    throw new Error('没有识别到 xbookcn 小说目录。');
  }

  return {
    kind: 'list',
    source: 'xbookcn',
    url,
    title: extractTitle(html, url),
    items
  };
}

function buildPage(url, html) {
  return isIndexUrl(url) ? buildListPage(url, html) : buildChapterPage(url, html);
}

function buildBlogChapterPage(url, html) {
  const contentHtml =
    extractContainerInner(html, 'div', 'post-body') || extractContainerInner(html, 'div', 'content');
  const content = cleanNovelText(htmlToText(stripNoisyBlocks(contentHtml)));

  if (!content) {
    throw new Error('没有识别到 xbookcn 小说正文。');
  }

  const anchors = extractAnchors(html, url);
  const prev = anchors.find((link) => /(较新|較新|上一篇|上一章|上一页)/i.test(link.text));
  const next = anchors.find((link) => /(较旧|較舊|下一篇|下一章|下一页)/i.test(link.text));

  return {
    kind: 'chapter',
    source: 'xbookcn',
    url,
    title: extractTitle(html, url),
    content,
    prevUrl: prev ? prev.url : '',
    nextUrl: next ? next.url : ''
  };
}

async function fetchXbookPage(url, options = {}) {
  const headers = createBrowserHeaders();
  const parsed = new URL(url);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const attempts = [
    ...CLOUDFLARE_EDGE_IPS.map((address) => () =>
      fetchHtml(url, {
        headers,
        http2: true,
        timeoutMs,
        idleTimeoutMs: options.idleTimeoutMs || 700,
        completeOnHtmlEnd: true,
        http2Options: {
          createConnection() {
            return tls.connect({
              host: address,
              port: 443,
              servername: parsed.hostname,
              ALPNProtocols: ['h2']
            });
          }
        }
      })
    )
  ];
  if (!options.edgeOnly) {
    attempts.push(
      () => fetchHtml(url, {
        headers,
        http2: true,
        timeoutMs,
        idleTimeoutMs: options.idleTimeoutMs || 700,
        completeOnHtmlEnd: true
      }),
      () => fetchHtml(url, { headers, timeoutMs })
    );
  }
  let lastError;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`xbookcn 请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function load(url) {
  const response = await fetchXbookPage(url);
  if (isBlogPostUrl(response.url)) {
    return buildBlogChapterPage(response.url, response.html);
  }
  return buildPage(response.url, response.html);
}

async function search(query) {
  const searchUrl = `https://book.xbookcn.net/search?q=${encodeURIComponent(query)}`;
  const response = await fetchXbookPage(searchUrl, { edgeOnly: true, timeoutMs: 8000 });
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(response.html, response.url)) {
    let parsed;
    try {
      parsed = new URL(anchor.url);
    } catch {
      continue;
    }

    if (!/(^|\.)xbookcn\.net$/i.test(parsed.hostname) || !BLOG_POST_PATTERN.test(parsed.pathname)) {
      continue;
    }

    const title = String(anchor.text)
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean);

    if (!title || seen.has(anchor.url)) {
      continue;
    }

    seen.add(anchor.url);
    items.push({ text: title, actionText: '开始阅读', url: anchor.url });
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
  buildPage,
  load,
  match,
  search
};
