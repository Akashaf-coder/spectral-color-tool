#!/bin/sh
# 打包内部发行版。
# 步骤：1) 编辑 meta.js 填作者/工号、show=true
#       2) 若想把当前库作为默认库，把 library.json 放到 data/ 下（脚本会自动转成默认库）
#       3) 运行本脚本
cd "$(dirname "$0")"

# 若存在 data/library.json，转成内联的默认库文件 data/library.js
if [ -f data/library.json ]; then
  node -e "const fs=require('fs');const j=fs.readFileSync('data/library.json','utf8');fs.writeFileSync('data/library.js','window.DEFAULT_LIBRARY='+j+';');" 2>/dev/null \
    || python3 -c "open('data/library.js','w',encoding='utf-8').write('window.DEFAULT_LIBRARY='+open('data/library.json',encoding='utf-8').read()+';')"
  echo "已把 data/library.json 打包为默认库（首次打开自动导入）"
else
  echo "提示：data/ 下没有 library.json，将不带默认库（用户首次打开是示例数据）。"
fi

OUT="光谱颜色模拟器-内网版.zip"
rm -f "$OUT"
zip -r "$OUT" \
  index.html styles.css app.js colorimetry.js csv.js core.js meta.js \
  启动.command 启动.bat README.md data \
  -x "*.DS_Store" "data/library.json" >/dev/null
echo "已生成：$(pwd)/$OUT"
