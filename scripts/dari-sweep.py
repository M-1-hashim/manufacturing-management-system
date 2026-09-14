#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中央达里语词汇大扫除：伊朗波斯语 → 纯阿富汗达里语
规则按顺序应用；带右边界的规则防止匹配复合词内部（ZWNJ \u200c 不算阿拉伯字母，
所以 «فرم‌ها» 可被 «فرم» 规则命中，而 «فرمول» 不会）。
"""
import os, re, sys

AR = '[\u0600-\u06FF]'  # Arabic block incl. Persian letters & digits; ZWNJ is \u200c NOT included

def R(frm, to, boundary=False):
    """build (compiled_regex, replacement, name)"""
    pat = re.escape(frm)
    if boundary:
        pat += f'(?!{AR})'
    return (re.compile(pat), to, frm)

rules = [
    # ---- 多词组合优先 ----
    R('نام کاربری', 'نام استفاده‌کننده'),
    R('حساب کاربری', 'حساب استفاده‌کننده'),
    R('کاربری یافت نشد', 'استفاده‌کننده پیدا نشد'),
    R('کاربران', 'استفاده‌کنندگان'),
    R('حقوق‌ها', 'معاشات'),
    R('هزینه‌ها', 'مصارف'),
    R('فرمول‌های', 'فورمولاهای'),
    R('فرمول‌ها', 'فورمولاها'),
    R('تاریخ انقضای', 'تاریخ ختم'),
    R('تاریخ انقضا', 'تاریخ ختم'),
    R('نزدیک انقضا', 'نزدیک ختم'),
    R('و انقضا', 'و تاریخ ختم'),
    R('منقضی شده', 'ختم شده'),
    R('منقضی', 'ختم شده'),
    R('انقضای', 'ختم'),
    R('انقضا', 'ختم'),
    R('حضور و غیاب', 'حاضری'),
    R('به‌روزرسانی', 'تجدید'),
    R('به‌روز می‌شوند', 'تجدید می‌شوند'),
    R('به‌روز', 'تازه'),
    R('پشتیبان‌گیری', 'کاپی احتیاطی'),
    R('بکاپ‌گیری', 'کاپی احتیاطی'),
    R('بکاپ', 'کاپی احتیاطی'),
    R('پشتیبان', 'کاپی احتیاطی'),
    R('سرورها', 'هاست‌ها'),
    R('با موفقیت', 'با کامیابی'),
    R('متصل به سرور', 'به هاست وصل است'),
    R('متصل به هاست', 'به هاست وصل است'),
    R('سرور', 'هاست'),
    R('ویرایش', 'تصحیح'),
    R('تأیید', 'تصدیق'),
    R('تایید', 'تصدیق'),
    R('جزئیات', 'تفصیلات'),
    R('نرخ ارز', 'اسعار'),
    R('اینترنت', 'انترنت'),
    R('بارگذاری', 'بارگیری'),
    R('نمودار', 'چارت'),
    R('شماره', 'نمبر'),
    R('تلفن', 'تیلیفون'),
    R('نام خانوادگی', 'تخلص'),
    R('منابع انسانی', 'منابع بشری'),
    R('اطلاعات', 'معلومات'),
    R('اضافه کردن', 'علاوه کردن'),
    R('اضافه شدن', 'علاوه شدن'),
    R('افزودن', 'علاوه کردن'),
    R('تلاش', 'کوشش'),
    R('رمز عبور', 'پاسورد'),
    R('اعتباری', 'نسیه'),
    R('مانده بدهی‌ها', 'باقیات بدهی‌ها'),
    R('مانده بدهی', 'باقیات بدهی'),
    R('جمع باقی‌مانده', 'جمع باقیات'),
    R('باقی‌مانده', 'باقیات'),
    # ---- 带边界的单词规则（放在所有复合规则之后） ----
    R('کاربر', 'استفاده‌کننده', boundary=True),
    R('حقوق', 'معاش', boundary=True),
    R('هزینه', 'مصرف', boundary=True),
    R('فرمول', 'فورمولا', boundary=True),
    R('فرم', 'فورم', boundary=True),
    R('عملیات', 'اجراؤات', boundary=True),
]

root = os.path.join(os.path.dirname(__file__), '..', 'src')
changed_files = {}
stats = {r[2]: 0 for r in rules}

for dirpath, _, files in os.walk(root):
    for fn in files:
        if not (fn.endswith('.ts') or fn.endswith('.tsx')):
            continue
        p = os.path.join(dirpath, fn)
        with open(p, 'r', encoding='utf-8') as f:
            src = f.read()
        orig = src
        for rx, to, name in rules:
            src, n = rx.subn(to, src)
            stats[name] += n
        if src != orig:
            with open(p, 'w', encoding='utf-8') as f:
                f.write(src)
            changed_files[p] = sum(1 for _ in ())

print('=== replacement counts ===')
for name, n in sorted(stats.items(), key=lambda x: -x[1]):
    if n:
        print(f'{n:5d}  {name}')
print(f'\n{len(changed_files)} files changed')
