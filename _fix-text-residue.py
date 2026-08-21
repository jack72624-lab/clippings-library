#!/usr/bin/env python3
"""一次性：清掉全庫文字殘留（em-dash / 中文後接半形標點）。

用法：
    python3 _fix-text-residue.py --dry      只看會改什麼
    python3 _fix-text-residue.py --apply    真的改 entries/*.html 並 bump data-hlver

設計上的三個約束（別改掉）：
1. **只改標籤之外的文字**（外加 data-label 屬性值，那也是給人看的文案）。
   用 re.split 切標籤、逐段處理，結構一個字都不重建 —— 用 HTMLParser 重建 HTML 會動到
   self-closing、entity、屬性順序，代價遠大於收益。
2. **引用區（blockquote / .pull）內的 em-dash 豁免**（CLAUDE.md 雷區：受訪者原話不在此限）。
   半形標點不豁免 —— 那是排版錯誤，不是引用忠實度問題。
3. **只動 <article class="readable"> 內**。導覽、hero、footer 不碰。

改完的檔要跟 Firestore 快照同步（見 _patch-highlights.py），否則劃線會因版本不符而不顯示。
"""
import re, sys, glob, os, json

HALF = {',': '，', ';': '；', ':': '：', '!': '！', '?': '？'}
VOID = {'br', 'img', 'hr', 'meta', 'link', 'input', 'source'}


def transform(html, stats=None):
    """回傳 (新 html, 改了幾處)。html 可以是 entry 的 article 內容，也可以是劃線快照。"""
    n = 0
    out = []
    stack = []          # [(tag, 是否引用區)]
    quote_depth = 0

    for part in re.split(r'(<[^>]+>)', html):
        if part.startswith('<'):
            m = re.match(r'</?([\w-]+)', part)
            tag = m.group(1).lower() if m else ''
            if part.startswith('</'):
                for i in range(len(stack) - 1, -1, -1):
                    if stack[i][0] == tag:
                        if stack[i][1]:
                            quote_depth -= 1
                        del stack[i:]
                        break
            elif tag and tag not in VOID and not part.endswith('/>'):
                is_quote = tag == 'blockquote' or bool(re.search(r'class="[^"]*\bpull\b', part))
                stack.append((tag, is_quote))
                if is_quote:
                    quote_depth += 1
            # data-label 是跟讀 UI 顯示的文案，一起修（只動它的值）
            def fix_label(mm):
                nonlocal n
                v = mm.group(2)
                nv = v.replace('——', '，')
                nv = re.sub(r'(?<=[一-鿿])([,;:!?])', lambda x: HALF[x.group(1)], nv)
                if nv != v:
                    n += len(re.findall(r'——', v)) + len(re.findall(r'[一-鿿][,;:!?]', v))
                return f'{mm.group(1)}{nv}"'
            part = re.sub(r'(data-label=")([^"]*)"', fix_label, part)
            out.append(part)
        else:
            before = part
            if quote_depth == 0:
                part = part.replace('——', '，')
            part = re.sub(r'(?<=[一-鿿])([,;:!?])', lambda x: HALF[x.group(1)], part)
            if part != before:
                n += len(re.findall(r'——', before)) if quote_depth == 0 else 0
                n += len(re.findall(r'[一-鿿][,;:!?]', before))
            out.append(part)
    return ''.join(out), n


def bump(html):
    """data-hlver 加一（沒有就設 2）。"""
    m = re.search(r'(<body[^>]*\bdata-hlver=")(\d+)(")', html)
    if m:
        new = str(int(m.group(2)) + 1)
        return re.sub(r'(<body[^>]*\bdata-hlver=")\d+(")', lambda x: x.group(1) + new + x.group(2), html, count=1), new
    m2 = re.search(r'(<body[^>]*?)(>)', html)
    return html[:m2.end(1)] + ' data-hlver="2"' + html[m2.end(1):], '2'


def main():
    apply = '--apply' in sys.argv
    report = {}
    for f in sorted(glob.glob('entries/*.html')):
        if os.path.basename(f).startswith('_'):
            continue
        html = open(f, encoding='utf-8').read()
        m = re.search(r'(<article class="readable"[^>]*>)(.*?)(</article>)', html, flags=re.S)
        if not m:
            continue
        new_inner, n = transform(m.group(2))
        if not n:
            continue
        new_html = html[:m.start(2)] + new_inner + html[m.end(2):]
        new_html, hv = bump(new_html)
        entry = re.search(r'data-entry="([^"]+)"', html)
        report[os.path.basename(f)] = {'改了': n, '新 hlver': hv,
                                       'entry': entry.group(1) if entry else None}
        if apply:
            open(f, 'w', encoding='utf-8').write(new_html)

    total = sum(v['改了'] for v in report.values())
    print(('已改 ' if apply else '（乾跑）會改 ') + f'{len(report)} 篇、共 {total} 處')
    for k, v in sorted(report.items(), key=lambda x: -x[1]['改了'])[:10]:
        print(f"  {k:45} {v['改了']:>3} 處  hlver→{v['新 hlver']}")
    if apply:
        json.dump(report, open('_fix-report.json', 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        print('\n對照表寫到 _fix-report.json（下一步給 _patch-highlights.py 用）')


if __name__ == '__main__':
    main()
