# سیستم مدیریت تولید و مالتي‌مادیولی صنعتی | Manufacturing Management System

> سیستم جامع مدیریت چرخه تولید کامل برای کارخانه‌های افغانستان
> Full production-cycle ERP for Afghan manufacturers

[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org) [![Prisma](https://img.shields.io/badge/Prisma-SQLite-green)](https://www.prisma.io) [![Electron](https://img.shields.io/badge/Electron-Desktop-purple)](https://www.electronjs.org)

---

## 🇦🇫 درباره (دری)

این سیستم چرخه کامل تولید را پوشش می‌دهد — از مواد خام تا فروش محصول نهایی:

| ماډیول | قابلیت‌ها |
|---|---|
| 📦 محصولات | قیمت‌گذاری چندسطحیه، بارکد و QR، هشدار حداقل موجودی |
| 🧪 مواد خام | واحدهای متعدد (کیلوگرام/لیتر/متر/عدد)، تامین‌کنندگان، تاریخ انقضا |
| ⚗️ فرمولاسیون (BOM) | نسخه‌های متعدد، محاسبه خودکار قیمت تمام‌شده |
| 🏭 تولید | پلان تولید، کنترل کیفیت (QC)، ضایعات، کسر خودکار مواد |
| 🧾 فروش | فاکتور با فورمت افغانی، نقد/قرض/بانک، تخفیف، مالیات ۲٪ و ۱۰٪ |
| 🏬 انبار | انبارهای متعدد، انتقال، شمارش |
| 💰 مالی | سود و زیان، چند ارز (افغانی/دالر/کلدار) |
| 👷 کارکنان | حاضری، شیفت‌ها، معاش |
| 📊 گزارشات | خروجی PDF و Excel |
| 🔐 کاربران و فعالیت‌ها | ۴ نقش (Super Admin / Admin / Manager / Employee)، لاگ کامل فعالیت‌ها |

### ویژگی‌های خاص

- 🌐 **سه زبانه**: دری 🇦🇫 / پشتو / English — با پشتیبانی کامل RTL
- 🌙 **تم روشن و تاریک**
- 📅 **تقویم شمسی + میلادی**
- 💾 **بکاپ خودکار** — بکاپ زمان‌بندی‌شده دیتابیس با مدیریت کامل در تنظیمات (فاصله زمانی، تعداد نگهداری، دانلود، پاک)
- 📴 **کار آفلاین** — بدون انترنت هم کار می‌کند؛ عملیات‌ها ذخیره و بعداً ارسال می‌شوند
- 🔄 **سینک خودکار دوطرفه** — وقتی انترنت وصل شود، دیتای آفلاین خودکار به سرور ارسال و دیتای جدید سرور لود می‌شود
- 🖥️ **برنامه ویندوز (Electron)** — فایل نصب واقعی `setup.exe` + نسخه Portable، کاملاً آفلاین با دیتابیس محلی

## 🌍 About (English)

A complete manufacturing ERP covering the full production cycle: raw materials → formulation (BOM) → production (QC, waste, auto-deduction) → finished goods → sales (AFN-format invoices, cash/credit/bank, 2%/10% tax) → multi-warehouse inventory → finance (P&L, AFN/USD/PKR) → HR → reports.

**Highlights:** 3 languages (Dari/Pashto/English) with RTL · dark mode · Persian + Gregorian calendars · 4 roles with audit log · **automatic scheduled backups** · **offline-first with automatic two-way sync** · **Electron desktop packaging (real Windows `setup.exe` + portable)**.

## 🚀 شروع سریع | Getting Started

```bash
# 1. install dependencies
bun install        # or: npm install

# 2. configure environment
cp .env.example .env

# 3. push database schema
bun run db:push

# 4. run dev server
bun run dev        # http://localhost:3000
```

**Default login** | **حساب پیش‌فرض:** `admin` / `admin123`

## 🖥️ برنامه ویندوز | Windows Desktop App

### 📥 دانلود مستقیم | Direct Download (Releases)

| فایل | حجم | توضیح |
|---|---|---|
| [**ManufacturingERP-Setup.exe**](https://github.com/M-1-hashim/manufacturing-management-system/releases/latest/download/ManufacturingERP-Setup.exe) | ~143MB | نصب‌کننده واقعی ویندوز (NSIS) — پیشنهادی ✅ |
| [**ManufacturingERP-Windows-Portable.zip**](https://github.com/M-1-hashim/manufacturing-management-system/releases/latest/download/ManufacturingERP-Windows-Portable.zip) | ~236MB | نسخه پرتابل — بدون نصب، اکسترکت و اجرا |

> 🔄 **آپدیت نسخه نصب‌شده:** فایل `Setup.exe` جدید را دانلود و اجرا کنید — روی نسخه قبلی نصب می‌شود و دیتای شما در `%APPDATA%\ManufacturingERP` حفظ می‌شود.
>
> To update an installed copy: just run the latest Setup.exe — it upgrades in place and keeps your data.

📄 [راهنمای کامل نصب (دری)](download/README-DESKTOP.md) · [همه نسخه‌ها / All Releases](https://github.com/M-1-hashim/manufacturing-management-system/releases) · [یادداشت v1.0.1](https://github.com/M-1-hashim/manufacturing-management-system/releases/tag/v1.0.1)

> ⚠️ نصب‌کننده امضای دیجیتال ندارد → ویندوز SmartScreen: **More info → Run anyway**
> حساب پیش‌فرض: `admin` / `admin123` — دیتا: `%APPDATA%\ManufacturingERP\data\custom.db`

### 🔨 ساخت مجدد | Rebuild

```bash
cd electron && bash build-desktop.sh
# artifacts → download/ManufacturingERP-Setup.exe + download/ManufacturingERP-Windows-Portable.zip
```

- Packaged app = Electron shell + embedded Next.js standalone server + local SQLite
- First run seeds the database at `%APPDATA%\ManufacturingERP\data\custom.db`
- 100% offline — no internet or external server required
- Note: installer is unsigned → Windows SmartScreen shows "More info → Run anyway"

## 🏗️ Tech Stack | تکنالوژی

- **Next.js 16** (App Router) + **TypeScript 5**
- **Prisma ORM** + **SQLite** (zero-config, perfect for offline desktop)
- **Tailwind CSS 4** + **shadcn/ui** + **Lucide icons**
- **Zustand** (client state) · **TanStack Query** (server state)
- **Electron 44** + NSIS (electron-builder)
- Local memory caching — no external middleware required

## 📁 ساختار | Structure

```
src/app/          # Next.js App Router (single-page shell + API routes)
src/components/   # UI components (shadcn/ui based)
src/lib/          # auth, offline sync, backup, i18n, audit
electron/         # Electron main process + build scripts
prisma/           # database schema
db/               # SQLite database + auto backups
```

---

© M-1-hashim — ساخته شده برای صنعتکاران افغانستان 🇦🇫
