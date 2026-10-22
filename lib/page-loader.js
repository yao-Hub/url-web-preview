const { normalizeUrl } = require('./url');
const kadokado = require('./sources/kadokado');
const qidian = require('./sources/qidian');
const alicesw = require('./sources/alicesw');
const l3zc = require('./sources/l3zc');
const xbookcn = require('./sources/xbookcn');
const generic = require('./sources/generic');

async function loadPage(inputUrl) {
  const normalized = normalizeUrl(inputUrl);

  if (!normalized.ok) {
    throw new Error(normalized.message);
  }

  const url = normalized.url;

  if (kadokado.match(url)) {
    return kadokado.load(url);
  }

  if (qidian.match(url)) {
    return qidian.load(url);
  }

  if (alicesw.match(url)) {
    return alicesw.load(url);
  }

  if (l3zc.match(url)) {
    return l3zc.load(url);
  }

  if (xbookcn.match(url)) {
    return xbookcn.load(url);
  }

  return generic.load(url);
}

module.exports = {
  loadPage
};
