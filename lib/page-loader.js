const { normalizeUrl } = require('./url');
const kadokado = require('./sources/kadokado');
const qidian = require('./sources/qidian');
const alicesw = require('./sources/alicesw');
const l3zc = require('./sources/l3zc');
const xbookcn = require('./sources/xbookcn');
const generic = require('./sources/generic');

const SEARCH_SOURCES = [
  { source: 'qidian', label: '起点中文网', search: qidian.search },
  { source: 'kadokado', label: 'KadoKado', search: kadokado.search },
  { source: 'alicesw', label: 'AliceSW', search: alicesw.search },
  { source: 'l3zc', label: 'L3ZC', search: l3zc.search },
  { source: 'xbookcn', label: 'xbookcn', search: xbookcn.search }
];

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

async function searchBooks(input) {
  const query = String(input || '').trim();
  if (!query) {
    throw new Error('请输入要搜索的书名。');
  }

  const settled = await Promise.allSettled(
    SEARCH_SOURCES.map(async (provider) => {
      const items = await provider.search(query);
      return {
        source: provider.source,
        label: provider.label,
        items: Array.isArray(items) ? items : [],
        error: ''
      };
    })
  );

  const groups = settled.map((result, index) => {
    const provider = SEARCH_SOURCES[index];
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return {
      source: provider.source,
      label: provider.label,
      items: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
  });

  return {
    kind: 'search',
    source: 'search',
    url: '',
    query,
    title: `搜索：${query}`,
    groups
  };
}

module.exports = {
  loadPage,
  searchBooks
};
