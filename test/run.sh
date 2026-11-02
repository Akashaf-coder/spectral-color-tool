#!/bin/sh
# 跑全部测试：色度学一致性 + CSV 解析
set -e
cd "$(dirname "$0")/.."
echo "== 色度学一致性（对比 colour-science） =="
node test/parity.mjs
echo
echo "== CSV 解析 =="
node test/csv.test.mjs
