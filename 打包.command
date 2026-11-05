#!/bin/sh
# 打包内部发行版（先编辑 meta.js 填好作者/工号、show=true，再运行本脚本）
cd "$(dirname "$0")"
OUT="光谱颜色模拟器-内网版.zip"
rm -f "$OUT"
zip -r "$OUT" \
  index.html styles.css app.js colorimetry.js csv.js core.js meta.js \
  启动.command 启动.bat README.md data \
  -x "*.DS_Store" >/dev/null
echo "已生成：$(pwd)/$OUT"
echo "说明：内部版记得把 meta.js 的 author/contact/show 填好；公共仓库那份不要改。"
