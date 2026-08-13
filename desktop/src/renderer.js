let output = '';
const $ = (id) => document.getElementById(id);
const status = $('status'); const results = $('results'); const archive = $('archive');
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
$('choose').addEventListener('click', async () => { output = await window.collector.chooseFolder() || output; $('folder').textContent = output || '尚未选择目录'; });
window.collector.onProgress(({ current, total, url }) => { status.textContent = `正在处理 ${current}/${total}`; showProgress(url); });
archive.addEventListener('click', async () => {
  archive.disabled = true; results.replaceChildren(); const urls = $('urls').value.split(/\n+/);
  try { const data = await window.collector.archive({ urls, output }); status.textContent = `完成：${data.filter(x => x.ok).length}/${data.length}`; showResults(data); }
  catch (error) { status.textContent = error.message; results.replaceChildren(element('article', error.message, 'error')); }
  finally { archive.disabled = false; }
});
