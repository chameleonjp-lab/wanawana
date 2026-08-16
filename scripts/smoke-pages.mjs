const BASE_URL = 'https://chameleonjp-lab.github.io/wanawana/';

async function fetchText(relativePath) {
  const url = new URL(relativePath, BASE_URL);
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { url, text: await response.text(), contentType: response.headers.get('content-type') ?? '' };
}

const index = await fetchText('');
if (!index.contentType.includes('text/html')) throw new Error(`index content type is ${index.contentType}`);
if (!index.text.includes('Content-Security-Policy')) throw new Error('published HTML has no CSP meta');
if (!index.text.includes('/wanawana/')) throw new Error('published HTML has no /wanawana/ base path');

const manifest = await fetchText('manifest.json');
try {
  JSON.parse(manifest.text);
} catch {
  throw new Error('published manifest.json is not valid JSON');
}

const serviceWorker = await fetchText('sw.js');
if (!serviceWorker.text.includes('wanawana-') || !serviceWorker.text.includes('SKIP_WAITING')) {
  throw new Error('published Service Worker is missing version isolation or update control');
}

const references = new Set();
for (const match of index.text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const value = match[1];
  if (value.startsWith('data:') || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
  references.add(value.replace(/^\/wanawana\//, ''));
}

for (const relativePath of references) {
  const resource = await fetchText(relativePath);
  if (!resource.contentType) throw new Error(`${relativePath} has no content type`);
}

console.log(`published artifact smoke verified: ${references.size + 3} resources at ${index.url}`);
