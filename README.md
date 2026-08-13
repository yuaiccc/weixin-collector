# 微信公众号文章收集器

一个本地 CLI：输入关键词搜索公众号文章，或把 `mp.weixin.qq.com` 文章保存为带本地图片的 Markdown。

它复用已经安装的 [OpenCLI](https://github.com/jackwener/OpenCLI) Browser Bridge，不自己读取 Chrome cookies，也不绕过验证码。

## 使用

```bash
cd weixin-collector
python3 weixin_tool.py search "人工智能" --limit 10
python3 weixin_tool.py search "林国浒" --account "杭州电子科技大学" --save results.json
python3 weixin_tool.py download "https://mp.weixin.qq.com/s/文章ID" -o ./weixin-articles

# 每天批量处理 urls.txt（每行一个链接）
python3 weixin_tool.py batch --file urls.txt -o "$HOME/Documents/Codex/weixin-articles"
# 也可以直接传入多个链接
python3 weixin_tool.py batch "https://mp.weixin.qq.com/s/xxx" "https://mp.weixin.qq.com/s/yyy"
```

下载结果结构：

```text
weixin-articles/
├── index.json                 # 全部文章元数据
├── failed.json                # 本次失败链接，可重试
└── 公众号名/
    └── 2026-08-07/
        └── 文章标题/
            ├── 文章标题.md
            └── images/
```

## 边界

- 搜索受搜狗微信网页的频率限制和验证码影响。
- 需要先让 `opencli doctor` 显示 Browser Bridge connected。
- 不包含登录、验证码代答、草稿创建或发布功能。
- 内容版权归原作者，建议仅用于个人阅读、研究和备份。
- 每次批处理建议控制在约 10 篇并保留间隔；工具不会并发，也不会绕过验证码。
