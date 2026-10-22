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
const CLOUDFLARE_EDGE_IPS = ['172.67.149.200', '104.21.29.203'];

function match(url) {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)xbookcn\.net$/i.test(parsed.hostname) &&
      (CHAPTER_PATTERN.test(parsed.pathname) || INDEX_PATTERN.test(parsed.pathname))
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

  return {
    kind: 'chapter',
    source: 'xbookcn',
    url,
    title: extractTitle(html, url),
    content,
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

async function load(url) {
  const headers = createBrowserHeaders();
  const parsed = new URL(url);
  const attempts = [
    ...CLOUDFLARE_EDGE_IPS.map((address) => () =>
      fetchHtml(url, {
        headers,
        http2: true,
        timeoutMs: 15000,
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
    ),
    () => fetchHtml(url, { headers, http2: true, timeoutMs: 15000 }),
    () => fetchHtml(url, { headers, timeoutMs: 15000 })
  ];
  let lastError;

  for (const attempt of attempts) {
    try {
      const response = await attempt();
      return buildPage(response.url, response.html);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`xbookcn 请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  buildChapterPage,
  buildListPage,
  buildPage,
  load,
  match
};
