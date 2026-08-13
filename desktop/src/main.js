const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const articlePartition = 'temp:weixin-collector';
const articleWindowOptions = { show: false, webPreferences: { sandbox: true, contextIsolation: true, partition: articlePartition } };
const safeName = (value) => (value || '未知').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '未知';
const unique = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const wechatImageHosts = new Set(['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'wx.qlogo.cn', 'thirdwx.qlogo.cn']);
const articleCache = new Map();

function isWechatImage(url) {
  try { return new URL(url).protocol === 'https:' && wechatImageHosts.has(new URL(url).hostname); }
  catch { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1040, height: 760, minWidth: 760, minHeight: 560,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

async function extractArticle(url) {
  const win = new BrowserWindow(articleWindowOptions);
  try {
    await win.loadURL(url, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36' });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return await win.webContents.executeJavaScript(`(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
      const title = text('#activity-name') || document.title;
      const author = text('#js_name') || text('#profileBt') || '未知作者';
      const publishTime = text('#publish_time') || '未知日期';
      const content = document.querySelector('#js_content');
      if (!content) throw new Error('未找到文章正文；文章可能需要登录、已删除或页面结构发生变化。');
      const images = [...content.querySelectorAll('img')].map((img) => {
        const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
        try { return new URL(src, document.baseURI).href; } catch { return ''; }
      }).filter((src) => /^https:/.test(src));
      return { title, author, publishTime, html: content.innerHTML, images };
    })()`);
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

async function downloadImage(url, output, number) {
  if (!isWechatImage(url)) throw new Error('已跳过非微信图片地址。');
  const response = await netFetch(url);
  if (!response.ok) throw new Error(`图片下载失败 (${response.status})`);
  if (response.url && !isWechatImage(response.url)) throw new Error(`图片重定向到了非微信地址：${response.url}`);
  const mime = response.headers.get('content-type') || '';
  const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'jpg';
  const filename = `img_${String(number).padStart(3, '0')}.${ext}`;
  await fs.writeFile(path.join(output, filename), Buffer.from(await response.arrayBuffer()));
  return `images/${filename}`;
}

async function netFetch(url) {
  return session.fromPartition(articlePartition).fetch(url, {
    credentials: 'omit',
    redirect: 'follow',
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'
    }
  });
}

function toMarkdown(html, imagePaths) {
  let imageIndex = 0;
  const normalized = html
    .replace(/<img[^>]*>/gi, () => {
      const imagePath = imagePaths[imageIndex++];
      return imagePath ? `\n![图片](${imagePath})\n` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|h[1-6])>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');
  return normalized.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function dateFolder(value) {
  const match = value.match(/(20\d{2})[年\-/](\d{1,2})[月\-/](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '未知日期';
}

function yearMonth(value) {
  const match = value.match(/(20\d{2})[年\-/](\d{1,2})/);
  return match ? { year: match[1], month: match[2].padStart(2, '0') } : { year: '未知年份', month: '未知月份' };
}

function themeFor(title, html) {
  const text = `${title} ${html.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
  const themes = [['人工智能', ['人工智能', 'ai', '大模型', 'agent']], ['数字技术', ['数字化', '数字', '互联网', '软件', '数据']], ['教育', ['教育', '高校', '大学', '学生']], ['职场', ['职场', '招聘', '就业', '工作']], ['财经', ['财经', '投资', '股票', '经济']], ['生活', ['生活', '健康', '旅行', '美食']]];
  return themes.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || '其他';
}

function contentHash(item) {
  return crypto.createHash('sha256').update(`${item.title}\n${item.author}\n${item.html.replace(/\s+/g, '')}`).digest('hex');
}

async function readIndex(root) {
  try { return JSON.parse(await fs.readFile(path.join(root, 'library-index.json'), 'utf8')); }
  catch { return []; }
}

async function writeIndex(root, records) {
  await fs.writeFile(path.join(root, 'library-index.json'), JSON.stringify(records, null, 2), 'utf8');
}

async function archive(url, root) {
  if (!/^https:\/\/mp\.weixin\.qq\.com\/s\//.test(url)) throw new Error('只接受 mp.weixin.qq.com/s/... 文章链接。');
  const article = await extractArticle(url);
  const author = safeName(article.author);
  const published = dateFolder(article.publishTime);
  const base = path.join(root, author, published, safeName(article.title));
  const folder = `${base}-${Date.now()}`;
  const imageFolder = path.join(folder, 'images');
  await fs.mkdir(imageFolder, { recursive: true });
  const imagePaths = [];
  for (const [index, image] of article.images.entries()) {
    try { imagePaths.push(await downloadImage(image, imageFolder, index + 1)); } catch { imagePaths.push(''); }
  }
  const markdown = `# ${article.title}\n\n> 公众号: ${article.author}\n> 发布时间: ${article.publishTime}\n> 原文链接: ${url}\n\n---\n\n${toMarkdown(article.html, imagePaths)}\n`;
  const filename = `${safeName(article.title)}.md`;
  await fs.writeFile(path.join(folder, filename), markdown, 'utf8');
  return { url, title: article.title, author: article.author, publishTime: article.publishTime, path: path.join(folder, filename), images: imagePaths.filter(Boolean).length };
}

async function cacheArticle(url) {
  if (!/^https:\/\/mp\.weixin\.qq\.com\/s\//.test(url)) throw new Error('只接受 mp.weixin.qq.com/s/... 文章链接。');
  const article = await extractArticle(url);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item = { id, url, ...article, institution: article.author, theme: themeFor(article.title, article.html), hash: contentHash(article) };
  articleCache.set(id, item);
  return { id, url, title: item.title, author: item.author, institution: item.institution, publishTime: item.publishTime, theme: item.theme, images: item.images.length };
}

async function archiveCached(item, root) {
  const { year, month } = yearMonth(item.publishTime);
  const base = path.join(root, safeName(item.author), safeName(item.institution), year, month, safeName(item.theme), safeName(item.title));
  const index = await readIndex(root);
  const duplicate = index.find((record) => record.hash === item.hash || (record.title === item.title && record.author === item.author && record.publishTime === item.publishTime));
  if (duplicate) return { url: item.url, title: item.title, author: item.author, publishTime: item.publishTime, theme: item.theme, duplicate: true, path: duplicate.path, images: 0 };
  const folder = `${base}-${Date.now()}`;
  const imageFolder = path.join(folder, 'images');
  await fs.mkdir(imageFolder, { recursive: true });
  const imagePaths = [];
  for (const [index, image] of item.images.entries()) {
    try { imagePaths.push(await downloadImage(image, imageFolder, index + 1)); } catch { imagePaths.push(''); }
  }
  const markdown = `# ${item.title}\n\n> 公众号: ${item.author}\n> 发布时间: ${item.publishTime}\n> 原文链接: ${item.url}\n\n---\n\n${toMarkdown(item.html, imagePaths)}\n`;
  const filename = `${safeName(item.title)}.md`;
  await fs.writeFile(path.join(folder, filename), markdown, 'utf8');
  const record = { hash: item.hash, url: item.url, title: item.title, author: item.author, institution: item.institution, publishTime: item.publishTime, theme: item.theme, path: path.join(folder, filename), indexedAt: new Date().toISOString() };
  await writeIndex(root, [...index, record]);
  return { ...record, images: imagePaths.filter(Boolean).length };
}

async function walkMarkdown(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'library-index.json') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fetch-articles', async (event, { urls }) => {
  const items = unique(urls);
  if (!items.length) throw new Error('请至少粘贴一篇文章链接。');
  const results = [];
  for (const [index, url] of items.entries()) {
    event.sender.send('fetch-progress', { current: index + 1, total: items.length, url });
    try { results.push({ ok: true, ...(await cacheArticle(url)) }); }
    catch (error) { results.push({ ok: false, url, error: error.message }); }
  }
  return results;
});

ipcMain.handle('archive-selected', async (event, { ids, output }) => {
  if (!output) throw new Error('请选择保存目录。');
  const selected = ids.map((id) => articleCache.get(id)).filter(Boolean);
  if (!selected.length) throw new Error('请至少选择一篇已缓存文章。');
  await fs.mkdir(output, { recursive: true });
  const results = [];
  for (const [index, item] of selected.entries()) {
    event.sender.send('archive-progress', { current: index + 1, total: selected.length, url: item.url });
    try { results.push({ ok: true, ...(await archiveCached(item, output)) }); }
    catch (error) { results.push({ ok: false, url: item.url, error: error.message }); }
  }
  await fs.writeFile(path.join(output, 'latest-run.json'), JSON.stringify(results, null, 2), 'utf8');
  return results;
});

ipcMain.handle('search-library', async (_event, { root, query }) => {
  if (!root) throw new Error('请选择搜索目录。');
  const needle = (query || '').trim().toLowerCase();
  if (!needle) throw new Error('请输入搜索关键词。');
  const index = await readIndex(root);
  const results = [];
  for (const record of index) {
    let content = '';
    try { content = await fs.readFile(record.path, 'utf8'); } catch { continue; }
    if (`${record.title} ${record.author} ${record.institution} ${record.theme} ${content}`.toLowerCase().includes(needle)) results.push(record);
  }
  return results.slice(0, 100);
});

ipcMain.handle('archive', async (event, { urls, output }) => {
  const items = unique(urls);
  if (!items.length) throw new Error('请至少粘贴一篇文章链接。');
  if (!output) throw new Error('请选择保存目录。');
  await fs.mkdir(output, { recursive: true });
  const results = [];
  for (const [index, url] of items.entries()) {
    event.sender.send('archive-progress', { current: index + 1, total: items.length, url });
    try { results.push({ ok: true, ...(await archive(url, output)) }); }
    catch (error) { results.push({ ok: false, url, error: error.message }); }
  }
  await fs.writeFile(path.join(output, 'latest-run.json'), JSON.stringify(results, null, 2), 'utf8');
  return results;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
