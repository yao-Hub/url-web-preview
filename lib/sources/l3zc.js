const { loadReaderChapterPage } = require('../epub');

function match(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)l3zc\.com$/i.test(parsed.hostname) && /^\/read\/\d+\/epub\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function load(url) {
  return loadReaderChapterPage(url);
}

module.exports = {
  load,
  match
};
