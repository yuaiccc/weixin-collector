#!/usr/bin/env python3
"""Small local WeChat article collector built on top of OpenCLI.

It intentionally delegates browser access to OpenCLI, so it does not handle
cookies, passwords, or CAPTCHA solving itself.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any


def run_opencli(args: list[str]) -> Any:
    command = ["opencli", *args, "--format", "json"]
    try:
        result = subprocess.run(command, text=True, capture_output=True, check=False)
    except FileNotFoundError:
        raise SystemExit("找不到 opencli。请先安装并确认 `opencli --version` 可用。")
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip()
        raise SystemExit(f"OpenCLI 执行失败：{message}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"OpenCLI 返回的不是 JSON：{result.stdout[:500]}") from exc


def search(args: argparse.Namespace) -> None:
    rows = run_opencli(
        ["weixin", "search", args.query, "--page", str(args.page), "--limit", str(args.limit)]
    )
    if args.account:
        needle = args.account.casefold()
        rows = [r for r in rows if needle in (r.get("title", "") + " " + r.get("summary", "")).casefold()]
    if not rows:
        print("没有匹配结果。公众号名筛选依赖搜狗结果中出现账号名，建议把账号名也放进关键词。")
        return
    for index, row in enumerate(rows, 1):
        print(f"[{index}] {row.get('title', '(无标题)')}  {row.get('publish_time', '')}")
        print(f"    {row.get('url', '')}")
        if row.get("summary"):
            print(f"    {row['summary'][:120]}")
    if args.save:
        Path(args.save).write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n已保存搜索结果：{args.save}")


def safe_name(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", value).strip(" .")
    return value[:100] or "article"


def read_urls(args: argparse.Namespace) -> list[str]:
    urls = list(args.urls or [])
    if args.file:
        urls.extend(line.strip() for line in Path(args.file).expanduser().read_text(encoding="utf-8").splitlines())
    seen: set[str] = set()
    result = []
    for url in urls:
        if url and not url.startswith("#") and url not in seen:
            seen.add(url)
            result.append(url)
    return result


def metadata(markdown: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in markdown.read_text(encoding="utf-8", errors="replace").splitlines()[:12]:
        match = re.match(r">\s*(公众号|作者|发布时间|原文链接)\s*[:：]\s*(.*)", line)
        if match:
            values[match.group(1)] = match.group(2).strip()
    return values


def locate_article(output: Path) -> tuple[Path, Path]:
    candidates = []
    for directory in output.iterdir():
        if directory.is_dir() and not directory.name.startswith("."):
            md = next(directory.glob("*.md"), None)
            if md:
                candidates.append((directory.stat().st_mtime, directory, md))
    if not candidates:
        raise SystemExit("下载命令完成，但没有找到文章 Markdown。")
    _, directory, markdown = max(candidates)
    return directory, markdown


def download(args: argparse.Namespace) -> None:
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    staging = output / ".staging"
    staging.mkdir(parents=True, exist_ok=True)
    run_opencli(["weixin", "download", "--url", args.url, "--output", str(staging), "--download-images", "true"])
    article, markdown = locate_article(staging)
    info = metadata(markdown)
    author = safe_name(info.get("公众号") or info.get("作者") or "未知作者")
    raw_date = info.get("发布时间", "未知日期")
    date_match = re.search(r"(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日", raw_date)
    date = f"{date_match.group(1)}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}" if date_match else safe_name(raw_date)
    target = output / author / date / safe_name(article.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        suffix = datetime.now().strftime("%H%M%S")
        target = target.parent / f"{target.name}-{suffix}"
    article.rename(target)
    markdown = target / markdown.name
    images = list((target / "images").glob("*") if (target / "images").exists() else [])
    index = output / "index.json"
    existing: list[dict[str, Any]] = []
    if index.exists():
        try:
            existing = json.loads(index.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, TypeError):
            existing = []
    existing = [item for item in existing if item.get("url") != args.url]
    existing.append({"url": args.url, "title": target.name, "author": author, "publish_date": date, "markdown": str(markdown), "images": len(images)})
    index.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已保存：{markdown}")
    print(f"图片：{len(images)} 张")
    print(f"索引：{index}")


def batch(args: argparse.Namespace) -> None:
    urls = read_urls(args)
    if not urls:
        raise SystemExit("请提供文章链接，或使用 --file urls.txt。")
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    index_path = output / "index.json"
    old = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    known = {item.get("url") for item in old if isinstance(item, dict)}
    completed, failed, skipped = [], [], []
    for number, url in enumerate(urls, 1):
        if url in known:
            skipped.append(url)
            print(f"[{number}/{len(urls)}] 跳过已存在：{url}")
            continue
        print(f"[{number}/{len(urls)}] 下载：{url}")
        try:
            download(argparse.Namespace(url=url, output=str(output)))
            completed.append(url)
            known.add(url)
        except (SystemExit, OSError, subprocess.SubprocessError) as exc:
            failed.append({"url": url, "error": str(exc)})
            print(f"  失败：{exc}")
    (output / "failed.json").write_text(json.dumps(failed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成：{len(completed)}，跳过：{len(skipped)}，失败：{len(failed)}")
    print(f"目录：{output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="搜索和下载微信公众号文章（基于 OpenCLI）")
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search", help="搜索公众号文章")
    p_search.add_argument("query", help="关键词，例如：人工智能")
    p_search.add_argument("--account", help="在标题和摘要中筛选公众号名")
    p_search.add_argument("--page", type=int, default=1)
    p_search.add_argument("--limit", type=int, default=10)
    p_search.add_argument("--save", help="将结果保存为 JSON")
    p_search.set_defaults(func=search)

    p_download = sub.add_parser("download", help="下载一篇公众号文章为 Markdown")
    p_download.add_argument("url", help="mp.weixin.qq.com/s/... 文章链接")
    p_download.add_argument("-o", "--output", default="./weixin-articles")
    p_download.set_defaults(func=download)

    p_batch = sub.add_parser("batch", help="按作者和发布日期批量归档文章")
    p_batch.add_argument("urls", nargs="*", help="一个或多个 mp.weixin.qq.com 文章链接")
    p_batch.add_argument("--file", help="每行一个链接的 urls.txt")
    p_batch.add_argument("-o", "--output", default="./weixin-articles")
    p_batch.set_defaults(func=batch)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
