let output = '';
const $ = (id) => document.getElementById(id);
const status = $('status'); const results = $('results'); const cached = $('cached'); const archive = $('archive'); const fetchButton = $('fetch');
const searchButton = $('search');
const revealWorkspace = () => ['cached-card', 'status-card', 'search-card'].forEach((id) => $(id).classList.remove('is-hidden'));
let cachedItems = [];
const normalizeInput = (value) => {
  const matches = String(value || '').match(/https?:\/\/mp\.weixin\.qq\.com\/s\/[^\s<>'"）)]+/g) || [];
  return [...new Set(matches.map((url) => url.replace(/[.,;!?。，；！？]+$/, '')))];
};
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};
const showProgress = (url) => results.replaceChildren(element('p', url, 'muted'));
const showResults = (data) => results.replaceChildren(...data.map((item) => {
  const card = document.createElement('article');
  if (item.ok) {
    card.append(element('b', `✓ ${item.title}`));
    card.append(element('small', `${item.author} · ${item.publishTime} · ${item.images} 张图片`));
    card.append(element('code', item.path));
  } else {
    card.className = 'error';
    card.append(element('b', '× 下载失败'));
    card.append(element('small', item.url));
    card.append(element('code', item.error));
  }
  return card;
}));
const updateSelection = () => { const count = cached.querySelectorAll('input:checked').length; $('selection').textContent = `${count}/${cachedItems.length} 篇已选择`; };
const showCached = () => {
  cached.replaceChildren(...cachedItems.map((item) => {
    const card = document.createElement('label'); card.className = 'cached-item';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = item.ok; checkbox.disabled = !item.ok; checkbox.dataset.id = item.id || ''; checkbox.addEventListener('change', updateSelection);
    const body = document.createElement('span');
    if (item.ok) { body.append(element('b', item.title)); body.append(element('small', `${item.author} · ${item.publishTime} · ${item.images} 张图片`)); body.append(element('code', item.url)); }
    else { body.append(element('b', '× 缓存失败', 'error')); body.append(element('small', item.error)); body.append(element('code', item.url)); }
    card.append(checkbox, body); return card;
  })); updateSelection();
};
$('choose').addEventListener('click', async () => { output = await window.collector.chooseFolder() || output; $('folder').textContent = output || '尚未选择目录'; });
$('urls').addEventListener('paste', (event) => {
  event.preventDefault();
  const pasted = event.clipboardData?.getData('text') || '';
  $('urls').value = normalizeInput(pasted).join('\n');
});
window.collector.onProgress(({ current, total, url }) => { status.textContent = `正在处理 ${current}/${total}`; showProgress(url); });
window.collector.onFetchProgress(({ current, total, url }) => { status.textContent = `正在缓存 ${current}/${total}`; showProgress(url); });
fetchButton.addEventListener('click', async () => {
  fetchButton.disabled = true; results.replaceChildren(); const urls = $('urls').value.split(/\n+/);
  try { cachedItems = await window.collector.fetchArticles({ urls }); revealWorkspace(); status.textContent = `缓存完成：${cachedItems.filter((x) => x.ok).length}/${cachedItems.length}`; showCached(); }
  catch (error) { status.textContent = error.message; results.replaceChildren(element('article', error.message, 'error')); }
  finally { fetchButton.disabled = false; }
});
archive.addEventListener('click', async () => {
  archive.disabled = true; results.replaceChildren(); const ids = [...cached.querySelectorAll('input:checked')].map((input) => input.dataset.id);
  try { const data = await window.collector.archiveSelected({ ids, output }); status.textContent = `保存完成：${data.filter(x => x.ok).length}/${data.length}`; showResults(data); }
  catch (error) { status.textContent = error.message; results.replaceChildren(element('article', error.message, 'error')); }
  finally { archive.disabled = false; }
});
searchButton.addEventListener('click', async () => {
  try { const data = await window.collector.searchLibrary({ root: output, query: $('query').value }); $('search-results').replaceChildren(...data.map((item) => { const card = document.createElement('article'); card.append(element('b', item.title)); card.append(element('small', `${item.author} · ${item.publishTime} · ${item.theme}`)); card.append(element('code', item.path)); return card; })); status.textContent = `找到 ${data.length} 篇`; }
  catch (error) { status.textContent = error.message; }
});
