const { createBrowserHeaders, fetchHtml } = require('../http');
const { buildChapterPage, buildListPage, classifyPage } = require('./generic');

function match(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)alicesw\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isListUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/lists?\//.test(path) || /\/lists?\.html$/.test(path);
  } catch {
    return false;
  }
}

function isNovelUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/novel\/\d+\.html$/.test(path);
  } catch {
    return false;
  }
}

function isBookUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/book\/\d+\/[^/]+\.html$/.test(path);
  } catch {
    return false;
  }
}

async function load(url) {
  const { html, url: finalUrl } = await fetchHtml(url, { headers: createBrowserHeaders() });
  const kind = isBookUrl(finalUrl) ? 'chapter' : isListUrl(finalUrl) || isNovelUrl(finalUrl) ? 'list' : classifyPage(finalUrl, html);
  return kind === 'list' ? buildListPage(finalUrl, html, 'alicesw') : buildChapterPage(finalUrl, html, 'alicesw');
}

module.exports = {
  load,
  match
};
