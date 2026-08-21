#!/usr/bin/env python3
# 文字殘留掃描 — 收尾時對「這批新增/改動的檔」跑，不是掃全庫（全庫既有殘留見 CLAUDE.md 待辦）
# 用法：python3 scan-text-residue.py entries/foo.html digests/2026-08-21.html
import re, sys, os

# 三種要抓的殘留；em-dash 只抓 Jack 的文案，受訪者原話引用不在此限（靠印出的上下文自己判斷）
PATTERNS = [
    (r'\*\*[^*\n]{1,60}\*\*', '字面 markdown 粗體（該是 <b>）'),
    (r'[一-鿿][,;:!?]', '中文後接半形標點'),
    (r'——|—', 'em-dash（本專案文案不用）'),
]

def clean(html):
    # 先拿掉會製造假警報的東西
    html = re.sub(r'<!--.*?-->', '', html, flags=re.S)              # HTML 註解
    html = re.sub(r'<span class="hn">.*?</span>', '', html, flags=re.S)  # 章節編號位的裝飾字元
    m = re.search(r'<article class="readable"[^>]*>(.*?)</article>', html, flags=re.S)
    return m.group(1) if m else html   # digest 沒有 .readable，就整份掃

total = 0
for f in sys.argv[1:]:
    body = clean(open(f, encoding='utf-8').read())
    for pat, name in PATTERNS:
        for m in re.finditer(pat, body):
            s, e = max(0, m.start() - 20), min(len(body), m.end() + 20)
            ctx = re.sub(r'\s+', ' ', body[s:e])
            print(f'{os.path.basename(f)} · {name} · …{ctx}…')
            total += 1
print('殘留:', total or '零')
