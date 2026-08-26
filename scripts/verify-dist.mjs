import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist');
const BASE_PATH = '/wanawana/';

async function mustRead(relativePath) {
  try {
    return await readFile(path.join(DIST, relativePath), 'utf8');
  } catch (error) {
    throw new Error(`dist/${relativePath} を読めません: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function mustExist(relativePath) {
  try {
    await stat(path.join(DIST, relativePath));
  } catch {
    throw new Error(`dist/${relativePath} がありません`);
  }
}

function localPathFromUrl(value) {
  if (value.startsWith('data:') || value.startsWith('#') || value.startsWith('mailto:')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('https://wanawana.invalid/')) return null;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  if (withoutQuery.startsWith(BASE_PATH)) return withoutQuery.slice(BASE_PATH.length);
  if (withoutQuery.startsWith('/')) return withoutQuery.slice(1);
  return withoutQuery;
}

function collectManifestAssets(value, assets) {
  if (typeof value === 'string') {
    if (value.startsWith('assets/')) assets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectManifestAssets(item, assets);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectManifestAssets(item, assets);
  }
}

const html = await mustRead('index.html');
const manifestText = await mustRead('manifest.json');

if (!html.includes('Content-Security-Policy')) throw new Error('本番HTMLにCSP metaがありません');
if (!html.includes(BASE_PATH)) throw new Error('本番HTMLに/wanawana/の公開先がありません');

let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch {
  throw new Error('manifest.jsonがJSONとして読めません');
}

const referencedFiles = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const localPath = localPathFromUrl(match[1]);
  if (localPath) referencedFiles.add(localPath);
}
collectManifestAssets(manifest, referencedFiles);
for (const relativePath of referencedFiles) await mustExist(relativePath);

async function countFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    count += entry.isDirectory() ? await countFiles(entryPath) : 1;
  }
  return count;
}

const fileCount = await countFiles(DIST);
if (fileCount < 4) throw new Error('本番成果物のファイル数が少なすぎます');

console.log(`production artifact verified: ${fileCount} files, ${referencedFiles.size} referenced resources`);
