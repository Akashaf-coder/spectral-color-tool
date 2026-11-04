#!/bin/sh
# 跑全部测试：色度学一致性（JS + Python SDK）+ CSV 解析
set -e
cd "$(dirname "$0")/.."
echo "== 色度学一致性：网页 colorimetry.js 对比 colour-science =="
node test/parity.mjs
echo
echo "== 色度学一致性：Python SDK 对比 colour-science =="
python3 test/sdk_parity.py
echo
echo "== CSV 解析 =="
node test/csv.test.mjs
