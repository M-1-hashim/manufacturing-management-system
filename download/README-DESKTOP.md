# ManufacturingERP — Windows Desktop Application

نسخهٔ دسکتاپ (ویندوز) سیستم مدیریت تولید — دفترچهٔ نصب و استفاده

**Version 1.0.4** — 🔧 **CRITICAL PATH FIX**: in versions ≤ 1.0.3 the per-user data folder was actually `%APPDATA%\nextjs_tailwind_shadcn_ts` (a misleading technical name) while all guides pointed to `%APPDATA%\ManufacturingERP` — which is why many users could not find `db-connection.txt`. **v1.0.4 fixes the folder to `%APPDATA%\ManufacturingERP` for good and automatically migrates ALL existing data (database, backups, config) from the old folder on first start — nothing is lost.** Plus v1.0.3's host connection from inside the app: Settings → "اتصال برنامه به هاست" — enter your cPanel MySQL host/database/user/password in a simple form; the app writes its own config file, so your data is stored on your shared hosting (MySQL) instead of the local file.

---

## 1) What was delivered (English)

| File | Size | What it is |
|---|---|---|
| `ManufacturingERP-Setup.exe` | ~143 MB | **Real NSIS installer** (PE32, Nullsoft self-extracting, LZMA-solid). Install via wizard, creates Start-menu + Desktop shortcuts, registers an uninstaller in "Add/Remove Programs". |
| `ManufacturingERP-Windows-Portable.zip` | ~235 MB | Portable build (no installation). Unzip anywhere and run `ManufacturingERP.exe` directly. |
| `README-DESKTOP.md` | — | This file. |

Both artifacts contain the **complete, self-contained application**: an Electron shell (Chromium UI) plus an embedded production Next.js server and a SQLite database engine (Prisma). **No internet connection, no Node.js, and no external database server are required** — everything runs locally on the machine.

Supported OS: **Windows 10 / 11, 64-bit** (x64).

## 2) Installation & first run

### Option A — Installer (recommended)
1. Double-click `ManufacturingERP-Setup.exe`.
2. If Windows SmartScreen shows "Windows protected your PC" (the app is not code-signed), click **More info → Run anyway**.
3. Choose the install folder (default `C:\Program Files\ManufacturingERP`) and finish the wizard.
4. Launch **ManufacturingERP** from the Start menu or Desktop shortcut.

### Option B — Portable (no install)
1. Right-click `ManufacturingERP-Windows-Portable.zip` → **Extract All…** (do not run from inside the zip).
2. Open the extracted `win-unpacked` folder and double-click **`ManufacturingERP.exe`**.
3. Optional: create a Desktop shortcut to `ManufacturingERP.exe` manually.

### First-run login
| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Full admin access |

(Demo also includes department accounts, e.g. `manager`, `prodstaff`, `salesstaff`, `storestaff`, `finstaff`, `hrstaff`, `viewer` — see in-app Users module; change all passwords after first login.)

**Please change the default passwords immediately** (Profile dialog → change password).

## 3) Where your data lives (important)

- The app stores its SQLite database at:

  ```
  %APPDATA%\ManufacturingERP\data\custom.db
  ```

  (i.e. `C:\Users\<YourUser>\AppData\Roaming\ManufacturingERP\data\custom.db`)

- On **first run** the app copies a bundled demo database there, so the system starts pre-loaded with sample data (products, formulas, staff, invoices…).
- **Backups**: the admin Settings module contains a one-click **database backup download**. Keep backup copies anywhere you like; a manual backup is simply a copy of `custom.db` (make one while the app is closed).
- **Reset to factory demo data**: close the app, delete the `data` folder shown above, start the app again — the bundled demo database is re-copied.
- Application diagnostics log: `%APPDATA%\ManufacturingERP\electron.log`.
- The app listens only on `127.0.0.1` (localhost) on an internal port starting at 37815 — it is not reachable from other machines by design.

### Optional: store data on your shared hosting (MySQL) instead

Since v1.0.3 you do NOT need to find any config file by hand (and since v1.0.4 the config folder is guaranteed to be `%APPDATA%\ManufacturingERP`):

1. In cPanel create a MySQL database + user and allow remote access (Remote MySQL → add `%` or your IP).
2. In the app: **Settings** → **"اتصال برنامه به هاست (ذخیره دیتا در MySQL)"** → fill host / port (3306) / database / user / password → **Save & connect**. The app restarts connected to the host.
3. Move existing data: first click **"خروجی JSON (انتقال به هاست)"** (backup section), connect to the host, then restore that JSON file.
4. Import the empty table structure on the host once, using `mysql-schema.sql` (Settings → backup card → "فایل SQL هاست") in phpMyAdmin.

Full step-by-step guide (Dari): `hosting-guide.md` served by the app at `/hosting-guide.md`.

## 4) How it works (for IT staff)

On startup the Electron main process:
1. Ensures `%APPDATA%\ManufacturingERP\data\custom.db` exists (copies the bundled demo DB on first run).
2. Starts the embedded Next.js standalone server as a child process (`Electron.exe` run in plain-Node mode) with `NODE_ENV=production`, `HOSTNAME=127.0.0.1`, and `DATABASE_URL=file:...` pointing at the data folder.
3. Waits until the server answers, then opens it in a native window (menu: View → Reload / DevTools / Zoom).

Closing the window stops the embedded server cleanly. Only one instance can run at a time.

## 5) Rebuilding the artifacts (developers)

On this Linux build machine:

```bash
bun run desktop:build                       # builds .next-electron + desktop-dist/win-unpacked
# NSIS installer (native, no wine):
NSISDIR=/tmp/nsis-root/usr/share/nsis /tmp/nsis-root/usr/bin/makensis -V2 ../electron/installer.nsi
#   ^ run from the desktop-dist/ directory; makensis comes from Debian's nsis debs extracted to /tmp/nsis-root
cd desktop-dist && zip -qr ../download/ManufacturingERP-Windows-Portable.zip win-unpacked
```

On any Windows machine with Node.js, an equivalent signed/icon-edited installer can also be produced with:

```bash
npx electron-builder --win nsis
```

---

## نسخهٔ دری — خلاصهٔ راهنما

### فایل‌های تحویل‌شده
- **`ManufacturingERP-Setup.exe`** (~۱۴۳ مېگابایت): نصاب اصلی ویندوز. یک بار اجرا کنید، پوشه را انتخاب کنید و تمام. شورتکات در منوی استارت و دسکتاپ ساخته می‌شود و از بخش Add/Remove Programs هم قابل حذف است.
- **`ManufacturingERP-Windows-Portable.zip`** (~۲۳۵ مېگابایت): نسخهٔ قابل‌حمل بدون نصب. زیپ را استخراج کرده و فایل `ManufacturingERP.exe` را داخل پوشهٔ `win-unpacked` اجرا کنید.

### نصب و اجرا
۱. اگر ویندوز پیام SmartScreen نشان داد (برنامه امضای دیجیتال ندارد)، روی **More info → Run anyway** کلیک کنید.
۲. برنامه تمام سرور (Next.js) و بانک داده (SQLite) را در خود دارد؛ به انترنت، Node.js یا سرور جداگانه نیاز نیست و کاملاً آفلاین کار می‌کند.
۳. در اجرای نخست، یک بانک اطلاعاتی نمونه به‌صورت خودکار ساخته می‌شود.

### ورود به سیستم
- نام کاربری: **admin** — رمز عبور: **admin123**
- لطفاً پس از نخستین ورود، رمزها را تغییر دهید (از طریق پروفایل).

### محل ذخیرهٔ معلومات
- بانک اطلاعاتی شما در این مسیر ذخیره می‌شود:
  `%APPDATA%\ManufacturingERP\data\custom.db`
- نسخهٔ پشتیبان: از ماژول **تنظیمات (Settings)** بخش ادمین می‌توانید فایل پشتیبان را دانلود کنید. برای کپی دستی، برنامه را ببندید و از همین مسیر کپی بگیرید.
- بازگشت به معلومات نمونه: برنامه را ببندید، پوشهٔ `data` را حذف کنید و برنامه را دوباره باز کنید.
- لاگ برنامه: `%APPDATA%\ManufacturingERP\electron.log`

### نیازمندی‌ها
- ویندوز ۱۰ یا ۱۱ — ۶۴ بیت (x64)

### ✨ تازه در نسخه ۱.۰.۳ — اتصال به هاست از داخل برنامه
دیگر لازم نیست فایل `db-connection.txt` را دستی پیدا کنید:
1. در cPanel هاست، دیتابیس MySQL و کاربر بسازید و در **Remote MySQL** علامت `%` (یا IP خود) را اضافه کنید.
2. در برنامه: **تنظیمات** → کارت **«اتصال برنامه به هاست (ذخیره دیتا در MySQL)»** → آدرس هاست، پورت (۳۳۰۶)، نام دیتابیس، نام کاربری و رمز را وارد کنید → **«ذخیره و اتصال به هاست»**. برنامه خودش فایل تنظیمات را می‌نویسد و دوباره باز می‌شود.
3. انتقال دیتای فعلی: اول **«خروجی JSON (انتقال به هاست)»** را بگیرید، بعد وصل شوید و همان فایل را در بخش پشتیبان‌گیری بازیابی کنید.
4. ساختار جداول را یک بار در phpMyAdmin هاست با فایل **`mysql-schema.sql`** ایمپورت کنید.

راهنمای کامل گام‌به‌گام (دری): فایل `hosting-guide.md` — از داخل برنامه قابل دانلود است.

