const { normalizeUrl } = require('./url');
const quanben = require('./sources/quanben');
const kadokado = require('./sources/kadokado');
const qidian = require('./sources/qidian');
const alicesw = require('./sources/alicesw');
const l3zc = require('./sources/l3zc');
const xbookcn = require('./sources/xbookcn');
const generic = require('./sources/generic');

const SEARCH_SOURCES = [
  { source: 'quanben', label: '全本小说网', search: quanben.search },
  { source: 'qidian', label: '起点中文网', search: qidian.search },
  { source: 'kadokado', label: 'KadoKado', search: kadokado.search },
  { source: 'l3zc', label: 'L3ZC', search: l3zc.search },
  { source: 'alicesw', label: 'AliceSW', search: alicesw.search },
  { source: 'xbookcn', label: 'xbookcn', search: xbookcn.search }
];

async function loadPage(inputUrl, options = {}) {
  const normalized = normalizeUrl(inputUrl);

  if (!normalized.ok) {
    throw new Error(normalized.message);
  }

  const url = normalized.url;
  options.onProgress?.({ fraction: 0.03, label: '正在连接网站' });

  if (quanben.match(url)) {
    return quanben.load(url, options);
  }

  if (kadokado.match(url)) {
    return withFinalProgress(await kadokado.load(url), options);
  }

  if (qidian.match(url)) {
    return qidian.load(url, options);
  }

  if (alicesw.match(url)) {
    return alicesw.load(url, options);
  }

  if (l3zc.match(url)) {
    return l3zc.load(url, options);
  }

  if (xbookcn.match(url)) {
    return xbookcn.load(url, options);
  }

  return generic.load(url, options);
}

async function withFinalProgress(page, options) {
  options.onProgress?.({ fraction: 0.97, label: '正在解析页面' });
  return page;
}

async function searchBooks(input, options = {}) {
  const query = String(input || '').trim();
  if (!query) {
    throw new Error('请输入要搜索的书名。');
  }

  let completed = 0;
  options.onProgress?.({ fraction: 0.05, label: '正在搜索网站' });
  const settled = await Promise.allSettled(
    SEARCH_SOURCES.map(async (provider) => {
      let items;
      try {
        items = await provider.search(query);
      } finally {
        completed += 1;
        options.onProgress?.({
          fraction: 0.1 + (completed / SEARCH_SOURCES.length) * 0.85,
          label: `已完成 ${completed}/${SEARCH_SOURCES.length} 个网站`
        });
      }
      return {
        source: provider.source,
        label: `站点${SEARCH_SOURCES.indexOf(provider) + 1}`,
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
      label: `站点${index + 1}`,
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
