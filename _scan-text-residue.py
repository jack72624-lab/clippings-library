#!/usr/bin/env python3
"""文字殘留掃描 — 收尾時對「這批新增/改動的檔」跑，不是掃全庫（全庫既有殘留見 CLAUDE.md 待辦）。

用法：python3 _scan-text-residue.py entries/foo.html digests/2026-08-21.html

只看**文字節點**，不看標籤與屬性——2026-08-21 第一版用 regex 直接掃原始 HTML，
把 `data-label="02 · 核心原理:諧波"` 這種屬性裡的半形冒號也算成違規（86 處裡多數是這種）。
屬性是給程式看的、不是文案，不該進來。
"""
import sys, os, re
from html.parser import HTMLParser

# 這些容器裡的內容視為「受訪者原話／引用」，em-dash 合法（見 CLAUDE.md 雷區）
QUOTE_TAGS = {'blockquote'}
QUOTE_CLASSES = {'pull'}

PATTERNS = [
    (r'\*\*[^*\n]{1,60}\*\*', '字面 markdown 粗體（該是 <b>）', False),
    (r'[一-鿿][,;:!?]',        '中文後接半形標點',              False),
    (r'——|—',                  'em-dash（本專案文案不用）',      True),   # True = 引用區內豁免
]


class TextNodes(HTMLParser):
    """把文字節點抽出來，順便記它在不在引用區、在哪個標籤裡。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []          # [(文字, 是否在引用區)]
        self.stack = []        # 目前開著的標籤
        self.quote_depth = 0
        self.skip_depth = 0    # script/style 內容不算文案

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip_depth += 1
            return
        d = dict(attrs)
        cls = set((d.get('class') or '').split())
        is_quote = tag in QUOTE_TAGS or bool(cls & QUOTE_CLASSES)
        # 章節編號位的裝飾字元：<span class="hn">—</span> 不是文案
        is_hn = tag == 'span' and 'hn' in cls
        self.stack.append((tag, is_quote, is_hn))
        if is_quote:
            self.quote_depth += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if self.stack[i][1]:
                    self.quote_depth = max(0, self.quote_depth - 1)
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.skip_depth or not data.strip():
            return
        if self.stack and self.stack[-1][2]:      # 在 .hn 裡
            return
        self.out.append((data, self.quote_depth > 0))


def article_of(html):
    m = re.search(r'<article class="readable"[^>]*>(.*?)</article>', html, flags=re.S)
    return m.group(1) if m else html      # digest 沒有 .readable，就整份掃


def scan(path):
    p = TextNodes()
    p.feed(article_of(open(path, encoding='utf-8').read()))
    hits = []
    for text, in_quote in p.out:
        for pat, name, quote_ok in PATTERNS:
            if in_quote and quote_ok:
                continue
            for m in re.finditer(pat, text):
                s, e = max(0, m.start() - 20), min(len(text), m.end() + 20)
                hits.append((name, re.sub(r'\s+', ' ', text[s:e])))
    return hits


if __name__ == '__main__':
    total = 0
    for f in sys.argv[1:]:
        for name, ctx in scan(f):
            print(f'{os.path.basename(f)} · {name} · …{ctx}…')
            total += 1
    print('殘留:', total or '零')
