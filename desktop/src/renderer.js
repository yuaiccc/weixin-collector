let output = '';
const $ = (id) => document.getElementById(id);
const status = $('status'); const results = $('results'); const archive = $('archive');
$('choose').addEventListener('click', async () => { output = await window.collector.chooseFolder() || output; $('folder').textContent = output || '尚未选择目录'; });
window.collector.onProgress(({ current, total, url }) => { status.textContent = `正在处理 ${current}/${total}`; results.innerHTML = `<p class="muted">${url}</p>`; });
archive.addEventListener('click', async () => {
  archive.disabled = true; results.innerHTML = ''; const urls = $('urls').value.split(/\n+/);
  try { const data = await window.collector.archive({ urls, output }); status.textContent = `完成：${data.filter(x => x.ok).length}/${data.length}`; results.innerHTML = data.map(item => item.ok ? `<article><b>✓ ${item.title}</b><small>${item.author} · ${item.publishTime} · ${item.images} 张图片</small><code>${item.path}</code></article>` : `<article class="error"><b>× 下载失败</b><small>${item.url}</small><code>${item.error}</code></article>`).join(''); }
  catch (error) { status.textContent = error.message; results.innerHTML = `<article class="error">${error.message}</article>`; }
  finally { archive.disabled = false; }
});
