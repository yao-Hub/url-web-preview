const JSZip = require('jszip');
const path = require('path').posix;
const { createBrowserHeaders, fetchBinary, fetchHtml } = require('./http');
const { cleanNovelText, extractChapterContent, extractTitle, htmlToText, normalizeText } = require('./html');

function extractBookUrl(html, baseUrl) {
  const match = String(html).match(/bookUrl\s*:\s*["']([^"']+)["']/i);
  if (!match) {
    throw new Error('未找到 EPUB 文件地址。');
  }

  return new URL(match[1], baseUrl).toString();
}

function normalizeZipHref(value) {
  return path.normalize(String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '')).replace(/^\/+/, '');
}

function resolveZipHref(baseDir, value) {
  const normalized = normalizeZipHref(String(value || '').split('#')[0]);
  if (!normalized) {
    return '';
  }

  return normalizeZipHref(path.join(baseDir, normalized));
}

function relativeZipHref(baseDir, value) {
  const resolved = resolveZipHref(baseDir, value);
  return resolved ? normalizeZipHref(path.relative(baseDir, resolved)) : '';
}

async function readZipText(zip, filePath) {
  const normalized = normalizeZipHref(filePath);
  const entry = zip.file(normalized);

  if (!entry) {
    throw new Error(`EPUB 中缺少文件：${normalized}`);
  }

  return entry.async('string');
}

function extractTagText(xml, tagName) {
  const match = String(xml).match(new RegExp(`<(?:[\\w.-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tagName}>`, 'i'));
  return match ? normalizeText(htmlToText(match[1])) : '';
}

function extractAttribute(tag, attributeName) {
  const match = String(tag).match(new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
}

function readBalancedElement(xml, tagName, startIndex) {
  const tokenRegex = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'ig');
  tokenRegex.lastIndex = startIndex;

  let depth = 0;
  let openEnd = -1;
  let match;

  while ((match = tokenRegex.exec(xml))) {
    if (match[0][1] === '/') {
      depth -= 1;
      if (depth === 0) {
        return {
          block: xml.slice(startIndex, tokenRegex.lastIndex),
          inner: xml.slice(openEnd, match.index),
          nextIndex: tokenRegex.lastIndex
        };
      }
      continue;
    }

    depth += 1;
    if (depth === 1) {
      openEnd = tokenRegex.lastIndex;
    }
  }

  return null;
}

function parseNavPointList(xml, baseDir) {
  const items = [];
  let index = 0;

  while (index < xml.length) {
    const openIndex = xml.indexOf('<navPoint', index);
    if (openIndex === -1) {
      break;
    }

    const block = readBalancedElement(xml, 'navPoint', openIndex);
    if (!block) {
      break;
    }

    const title = extractTagText(block.block, 'text') || extractTagText(block.block, 'navLabel') || '';
    const src = extractAttribute(block.block, 'src');
    const href = src ? resolveZipHref(baseDir, src) : '';
    const sourceHref = src ? relativeZipHref(baseDir, src) : '';

    items.push({
      title,
      href,
      sourceHref,
      children: parseNavPointList(block.inner, baseDir)
    });

    index = block.nextIndex;
  }

  return items;
}

function flattenNavItems(items, output = []) {
  for (const item of items) {
    output.push(item);
    if (item.children && item.children.length) {
      flattenNavItems(item.children, output);
    }
  }

  return output;
}

function extractContainerRootfile(containerXml) {
  const match = String(containerXml).match(/<rootfile\b[^>]*full-path\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (!match) {
    throw new Error('无法找到 EPUB 入口文件。');
  }

  return normalizeZipHref(match[1]);
}

function parsePackage(opfPath, opfXml) {
  const opfDir = path.dirname(opfPath);
  const title = extractTagText(opfXml, 'title') || '';
  const author = extractTagText(opfXml, 'creator') || '';

  const manifest = [];
  const manifestById = new Map();

  for (const match of String(opfXml).matchAll(/<item\b[^>]*\/?>/gi)) {
    const tag = match[0];
    const id = extractAttribute(tag, 'id');
    const href = extractAttribute(tag, 'href');
    const mediaType = extractAttribute(tag, 'media-type');

    if (!id || !href) {
      continue;
    }

    const resolvedHref = resolveZipHref(opfDir, href);
    const item = {
      id,
      href: resolvedHref,
      sourceHref: relativeZipHref(opfDir, href),
      mediaType
    };

    manifest.push(item);
    manifestById.set(id, item);
  }

  const spine = [];
  let spineTocId = '';
  const spineMatch = String(opfXml).match(/<spine\b([^>]*)>([\s\S]*?)<\/spine>/i);

  if (spineMatch) {
    spineTocId = extractAttribute(spineMatch[1], 'toc');

    for (const match of spineMatch[2].matchAll(/<itemref\b[^>]*\/?>/gi)) {
      const tag = match[0];
      const idref = extractAttribute(tag, 'idref');
      const linear = extractAttribute(tag, 'linear');
      const manifestItem = manifestById.get(idref);

      if (!idref || !manifestItem) {
        continue;
      }

      spine.push({
        idref,
        linear: linear || 'yes',
        href: manifestItem.href,
        sourceHref: manifestItem.sourceHref,
        mediaType: manifestItem.mediaType
      });
    }
  }

  const tocItem = spineTocId ? manifestById.get(spineTocId) : manifest.find((item) => /application\/x-dtbncx\+xml/i.test(item.mediaType));
  const tocPath = tocItem ? tocItem.href : '';

  return {
    title,
    author,
    opfDir,
    manifest,
    spine,
    tocPath
  };
}

function parseToc(ncxXml, baseDir) {
  const navMapMatch = String(ncxXml).match(/<navMap\b[^>]*>([\s\S]*?)<\/navMap>/i);
  if (!navMapMatch) {
    return [];
  }

  return parseNavPointList(navMapMatch[1], baseDir);
}

function findTocItemByHref(items, href) {
  const flattened = flattenNavItems(items);
  return flattened.find((item) => item.href === href || item.sourceHref === href || path.basename(item.href) === path.basename(href) || path.basename(item.sourceHref) === path.basename(href)) || null;
}

function resolveChapterHint(url) {
  const parsed = new URL(url);
  const queryHint = parsed.searchParams.get('chapter') || parsed.searchParams.get('href') || '';
  if (queryHint) {
    return queryHint;
  }

  if (!parsed.hash) {
    return '';
  }

  const hash = decodeURIComponent(parsed.hash.replace(/^#/, ''));
  if (!hash || /^epubcfi\(/i.test(hash)) {
    return '';
  }

  if (/^[^?#]+\.(xhtml?|html?)$/i.test(hash)) {
    return hash;
  }

  if (hash.startsWith('chapter=')) {
    return hash.slice('chapter='.length);
  }

  return '';
}

function pickPrimaryChapter(items) {
  return (
    items.find((item) => /^chapter-\d+\.xhtml$/i.test(path.basename(item.href))) ||
    items.find((item) => /\.xhtml?$/i.test(item.href)) ||
    null
  );
}

function isContentNavigationItem(item) {
  const name = path.basename(item.sourceHref || item.href || '').toLowerCase();
  return /^chapter-\d+\.xhtml?$/.test(name) || /^app\d+\.xhtml?$/.test(name) || name === 'appendix.xhtml';
}

function buildReaderUrl(baseUrl, chapterHref) {
  const parsed = new URL(baseUrl);
  if (chapterHref) {
    parsed.searchParams.set('chapter', chapterHref);
  } else {
    parsed.searchParams.delete('chapter');
  }
  parsed.hash = '';
  return parsed.toString();
}

function decorateTocItems(items, baseUrl) {
  return items.map((item) => ({
    ...item,
    url: item.sourceHref ? buildReaderUrl(baseUrl, item.sourceHref) : '',
    children: decorateTocItems(item.children || [], baseUrl)
  }));
}

async function loadReaderChapterPage(inputUrl, options = {}) {
  const { html, url: finalReaderUrl } = await fetchHtml(inputUrl, {
    ...options,
    headers: createBrowserHeaders()
  });
  const epubUrl = extractBookUrl(html, finalReaderUrl || inputUrl);
  const { buffer } = await fetchBinary(epubUrl, {
    ...options,
    headers: createBrowserHeaders()
  });
  const zip = await JSZip.loadAsync(buffer);

  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const rootfile = extractContainerRootfile(containerXml);
  const opfXml = await readZipText(zip, rootfile);
  const packageInfo = parsePackage(rootfile, opfXml);

  if (!packageInfo.tocPath) {
    throw new Error('EPUB 缺少目录文件。');
  }

  const tocXml = await readZipText(zip, packageInfo.tocPath);
  const tocItems = parseToc(tocXml, packageInfo.opfDir);
  const tocFlat = flattenNavItems(tocItems).filter((item) => item.href);
  if (options.tocOnly) {
    const readerBaseUrl = new URL(inputUrl);
    readerBaseUrl.searchParams.delete('toc');
    const tocBookTitle = normalizeText(packageInfo.title) || '小小说';
    return {
      kind: 'list',
      source: 'l3zc',
      url: readerBaseUrl.toString(),
      title: tocBookTitle,
      items: tocFlat.map((item) => ({
        text: item.title || path.basename(item.href),
        url: buildReaderUrl(readerBaseUrl.toString(), item.sourceHref || relativeZipHref(packageInfo.opfDir, item.href))
      }))
    };
  }

  const navigationItems = tocFlat.filter(isContentNavigationItem);
  const chapterHint = resolveChapterHint(inputUrl);
  const selectedChapter = chapterHint ? findTocItemByHref(tocItems, resolveZipHref(packageInfo.opfDir, chapterHint)) || findTocItemByHref(tocItems, normalizeZipHref(chapterHint)) : null;
  const chapterItem = selectedChapter || pickPrimaryChapter(navigationItems.length ? navigationItems : tocFlat);

  if (!chapterItem) {
    throw new Error('EPUB 没有可预览的正文章节。');
  }

  const chapterHtml = await readZipText(zip, chapterItem.href);
  const chapterContent = extractChapterContent(chapterHtml) || cleanNovelText(htmlToText(chapterHtml));
  if (!chapterContent) {
    throw new Error('EPUB 正文为空。');
  }

  const chapterNavigation = isContentNavigationItem(chapterItem) && navigationItems.length ? navigationItems : tocFlat;
  const chapterIndex = chapterNavigation.findIndex((item) => item.href === chapterItem.href);
  const prevItem = chapterIndex > 0 ? chapterNavigation[chapterIndex - 1] : null;
  const nextItem = chapterIndex >= 0 && chapterIndex < chapterNavigation.length - 1 ? chapterNavigation[chapterIndex + 1] : null;
  const chapterTitle = normalizeText(chapterItem.title || extractTitle(chapterHtml, inputUrl) || path.basename(chapterItem.href));
  const bookTitle = normalizeText(packageInfo.title) || '小小说';

  const pageUrl = buildReaderUrl(inputUrl, chapterItem.sourceHref || relativeZipHref(packageInfo.opfDir, chapterItem.href));

  return {
    kind: 'chapter',
    source: 'l3zc',
    url: pageUrl,
    title: chapterTitle && bookTitle && chapterTitle !== bookTitle ? `${chapterTitle} | ${bookTitle}` : chapterTitle || bookTitle,
    content: chapterContent,
    prevUrl: prevItem ? buildReaderUrl(pageUrl, prevItem.sourceHref || relativeZipHref(packageInfo.opfDir, prevItem.href)) : '',
    nextUrl: nextItem ? buildReaderUrl(pageUrl, nextItem.sourceHref || relativeZipHref(packageInfo.opfDir, nextItem.href)) : '',
    bookTitle,
    author: packageInfo.author,
    toc: decorateTocItems(tocItems, pageUrl)
  };
}

async function loadReaderTocPage(inputUrl, options = {}) {
  return loadReaderChapterPage(inputUrl, { ...options, tocOnly: true });
}

module.exports = {
  buildReaderUrl,
  loadReaderChapterPage,
  loadReaderTocPage
};
