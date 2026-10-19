const { TextDecoder } = require('util');

function createBrowserHeaders() {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
}

function createMobileHeaders() {
  return {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
}

function createJsonHeaders(referer, origin) {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(origin ? { origin } : {}),
    ...(referer ? { referer } : {})
  };
}

async function fetchHtml(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: options.headers || createBrowserHeaders()
  });

  if (!response.ok) {
    throw new Error(`网页请求失败: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    url: response.url || url,
    html: decodeBuffer(buffer, response.headers.get('content-type')),
    headers: response.headers
  };
}

async function fetchBinary(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: options.headers || createBrowserHeaders()
  });

  if (!response.ok) {
    throw new Error(`文件请求失败: HTTP ${response.status}`);
  }

  return {
    url: response.url || url,
    buffer: Buffer.from(await response.arrayBuffer()),
    headers: response.headers
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: options.headers || createJsonHeaders(options.referer, options.origin)
  });

  if (!response.ok) {
    throw new Error(`接口请求失败: HTTP ${response.status}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('接口没有返回 JSON 数据。');
  }
}

function decodeBuffer(buffer, contentType) {
  const head = buffer.subarray(0, 4096).toString('latin1');
  const headerCharset = findCharset(contentType || '');
  const htmlCharset = findCharset(head);
  const charset = normalizeCharset(headerCharset || htmlCharset || 'utf-8');

  try {
    let decoded = new TextDecoder(charset).decode(buffer);

    if (charset === 'utf-8' && decoded.includes('\uFFFD')) {
      const gbkDecoded = new TextDecoder('gb18030').decode(buffer);
      if (countReplacementChars(gbkDecoded) < countReplacementChars(decoded)) {
        decoded = gbkDecoded;
      }
    }

    return decoded;
  } catch {
    return buffer.toString('utf8');
  }
}

function findCharset(value) {
  const match = String(value).match(/charset\s*=\s*["']?\s*([\w-]+)/i);
  return match ? match[1] : '';
}

function normalizeCharset(value) {
  const charset = String(value).trim().toLowerCase();

  if (['gbk', 'gb2312', 'gb18030', 'x-gbk'].includes(charset)) {
    return 'gb18030';
  }

  if (['utf8', 'utf-8'].includes(charset)) {
    return 'utf-8';
  }

  return charset || 'utf-8';
}

function countReplacementChars(value) {
  return (String(value).match(/\uFFFD/g) || []).length;
}

module.exports = {
  createBrowserHeaders,
  createJsonHeaders,
  createMobileHeaders,
  decodeBuffer,
  fetchBinary,
  fetchHtml,
  fetchJson
};
