#!/bin/zsh
cd "$(dirname "$0")"
python3 weixin_tool.py batch --file urls.txt -o "$HOME/Documents/Codex/weixin-articles"
read -k 1 "?按任意键关闭..."
