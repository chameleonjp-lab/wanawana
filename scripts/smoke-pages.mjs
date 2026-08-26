const BASE_URL = 'https://chameleonjp-lab.github.io/wanawana/';

async function fetchText(relativePath) {
  const url = new URL(relativePath, BASE_URL);
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { url, text: await response.text(), contentType: response.headers.get('content-type') ?? '' };
}

function requireContentType(resource, expected, label = resource.url.pathname) {
  const contentType = resource.contentType.toLowerCase();
  if (!expected.some((pattern) => pattern.test(contentType))) {
    throw new Error(`${label} has unexpected content type: ${resource.contentType || '(missing)'}`);
  }
}

function expectedContentTypes(relativePath) {
  const pathname = new URL(relativePath, BASE_URL).pathname.toLowerCase();
  if (pathname.endsWith('.css')) return [/text\/css/];
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return [/javascript/, /ecmascript/];
  if (pathname.endsWith('.json')) return [/json/];
  return null;
}

function addManifestAssets(value, references) {
  if (typeof value === 'string') {
    if (value.startsWith('assets/')) references.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addManifestAssets(item, references);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) addManifestAssets(item, references);
  }
}

const index = await fetchText('');
requireContentType(index, [/text\/html/], 'published index.html');
if (!index.text.includes('Content-Security-Policy')) throw new Error('published HTML has no CSP meta');
if (!index.text.includes('/wanawana/')) throw new Error('published HTML has no /wanawana/ base path');

const manifest = await fetchText('manifest.json');
requireContentType(manifest, [/json/], 'published manifest.json');
let manifestData;
try {
  manifestData = JSON.parse(manifest.text);
} catch {
  throw new Error('published manifest.json is not valid JSON');
}

const references = new Set();
for (const match of index.text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const value = match[1];
  if (value.startsWith('data:') || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
  references.add(value.replace(/^\/wanawana\//, ''));
}
addManifestAssets(manifestData, references);

for (const relativePath of references) {
  const resource = await fetchText(relativePath);
  const expected = expectedContentTypes(relativePath);
  if (expected) requireContentType(resource, expected, relativePath);
  else if (!resource.contentType) throw new Error(`${relativePath} has no content type`);
}

console.log(`published artifact smoke verified: ${references.size + 2} resources at ${index.url}`);
