function normalizeUrl(input) {
  const raw = String(input || '').trim();

  if (!raw) {
    return { ok: false, message: '请输入地址。' };
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, message: '请输入有效的网址。' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, message: '只支持 http 和 https 地址。' };
  }

  return { ok: true, url: parsed.toString() };
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

module.exports = {
  normalizeUrl,
  resolveUrl
};
