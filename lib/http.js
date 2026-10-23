const http2 = require('http2');
const zlib = require('zlib');
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
  if (options.http2) {
    return fetchHtmlHttp2(url, options);
  }

  const requestOptions = {
    redirect: 'follow',
    headers: options.headers || createBrowserHeaders()
  };
  if (Number.isFinite(options.timeoutMs) && typeof AbortSignal.timeout === 'function') {
    requestOptions.signal = AbortSignal.timeout(options.timeoutMs);
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    throw new Error(`网页请求失败: HTTP ${response.status}`);
  }

  const buffer = await readResponseBuffer(response, options.onProgress);
  return {
    url: response.url || url,
    html: decodeBuffer(buffer, response.headers.get('content-type')),
    headers: response.headers
  };
}

async function fetchHtmlHttp2(url, options = {}) {
  let currentUrl = url;
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : 5;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await requestHtmlHttp2(currentUrl, options);
    const location = response.headers.location;

    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`网页请求失败: HTTP ${response.status}`);
    }

    return {
      url: currentUrl,
      html: decodeBuffer(response.buffer, response.headers['content-type']),
      headers: response.headers
    };
  }

  throw new Error('网页重定向次数过多。');
}

function requestHtmlHttp2(url, options) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return Promise.reject(new Error('只支持 http 和 https 地址。'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const client = http2.connect(parsed.origin, options.http2Options || {});
    const request = client.request({
      ...(options.headers || createBrowserHeaders()),
      ':method': 'GET',
      ':scheme': parsed.protocol.slice(0, -1),
      ':authority': parsed.host,
      ':path': `${parsed.pathname}${parsed.search}`
    });
    const timeout = setTimeout(() => {
      finish(new Error('网页请求超时。'));
    }, options.timeoutMs || 20000);
    const chunks = [];
    let responseHeaders = {};
    let idleTimer;
    let receivedBytes = 0;
    const reportProgress = createProgressReporter(options.onProgress);

    function finish(error, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      clearTimeout(idleTimer);
      client.close();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function completeResponse() {
      try {
        finish(null, {
          status: Number(responseHeaders[':status']) || 0,
          headers: responseHeaders,
          buffer: decodeCompressedBuffer(Buffer.concat(chunks), responseHeaders['content-encoding'])
        });
      } catch (error) {
        finish(error);
      }
    }

    function scheduleIdleCompletion() {
      if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs <= 0) {
        return;
      }

      clearTimeout(idleTimer);
      idleTimer = setTimeout(completeResponse, options.idleTimeoutMs);
    }

    request.on('response', (headers) => {
      responseHeaders = headers;
      reportProgress(receivedBytes, Number(responseHeaders['content-length']) || 0);
      scheduleIdleCompletion();
    });
    request.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
      receivedBytes += chunk.length;
      reportProgress(receivedBytes, Number(responseHeaders['content-length']) || 0);
      if (options.completeOnHtmlEnd && Buffer.concat(chunks).includes(Buffer.from('</html>'))) {
        completeResponse();
        return;
      }
      scheduleIdleCompletion();
    });
    request.on('end', completeResponse);
    request.on('error', (error) => finish(error));
    client.on('error', (error) => finish(error));
    request.end();
  });
}

function decodeCompressedBuffer(buffer, contentEncoding) {
  const encoding = String(contentEncoding || '').trim().toLowerCase();

  if (encoding === 'br') {
    return zlib.brotliDecompressSync(buffer);
  }

  if (encoding === 'gzip' || encoding === 'x-gzip') {
    return zlib.gunzipSync(buffer);
  }

  if (encoding === 'deflate') {
    return zlib.inflateSync(buffer);
  }

  return buffer;
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
    buffer: await readResponseBuffer(response, options.onProgress),
    headers: response.headers
  };
}

async function readResponseBuffer(response, onProgress) {
  if (!response.body || typeof onProgress !== 'function') {
    return Buffer.from(await response.arrayBuffer());
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  const reportProgress = createProgressReporter(onProgress);

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    loaded += chunk.length;
    reportProgress(loaded, total);
  }

  return Buffer.concat(chunks);
}

function createProgressReporter(onProgress) {
  if (typeof onProgress !== 'function') {
    return () => {};
  }

  let lastReportedAt = 0;
  let lastFraction = -1;

  return (loaded, total) => {
    const fraction = total > 0
      ? Math.min(0.99, loaded / total)
      : Math.min(0.9, 1 - Math.exp(-loaded / 160000));
    const now = Date.now();

    if (fraction > lastFraction && (now - lastReportedAt >= 80 || fraction >= 0.99)) {
      lastReportedAt = now;
      lastFraction = fraction;
      onProgress({ loaded, total, fraction });
    }
  };
}

async function fetchJson(url, options = {}) {
  const requestOptions = {
    redirect: 'follow',
    headers: options.headers || createJsonHeaders(options.referer, options.origin)
  };
  if (Number.isFinite(options.timeoutMs) && typeof AbortSignal.timeout === 'function') {
    requestOptions.signal = AbortSignal.timeout(options.timeoutMs);
  }

  const response = await fetch(url, requestOptions);

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
