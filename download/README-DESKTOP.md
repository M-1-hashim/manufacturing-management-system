# ManufacturingERP — Windows Desktop Application

نسخهٔ دسکتاپ (ویندوز) سیستم مدیریت تولید — دفترچهٔ نصب و استفاده

**Version 1.0.20** — 🔐 **HOST-FIRST SETUP + OFFLINE SIGN-IN**: the first launch asks for the server (host) address and sign-in uses the users stored in that server's database; the account is saved on the device afterwards so offline sign-in works too. Plus 🧪 **DEEP-TESTED v1.0.19**: the whole system (code, logic and UI) was deep-tested and **37+ real bugs fixed** across both backends — safe JSON-backup restore (no more host-wipe), session invalidation on password/role change, currency-aware customer debts, cumulative payment dialog, stock-overwrite fix, offline-engine RBAC and more. Plus 🌐 **AUTO ONLINE/OFFLINE + TWO-WAY SYNC** (since v1.0.7): when the internet (or the hosting MySQL) goes down, the app **automatically keeps working on a local copy of the server data** (amber badge «آفلاین — دیتابیس محلی»), and the moment the connection is back (checked every 15 s) it **reconnects by itself and syncs everything**. (v1.0.6 added the exact error code + fix hints; v1.0.5 fixed the host-saving bug by shipping BOTH database clients; v1.0.4 fixed the config folder to `%APPDATA%\ManufacturingERP`.)

---

## 1) What was delivered (English)

| File | Size | What it is |
|---|---|---|
| `ManufacturingERP-Setup.exe` | ~164 MB | **Real NSIS installer** (PE32, Nullsoft self-extracting, LZMA). Install via wizard, creates Start-menu + Desktop shortcuts, registers an uninstaller in "Add/Remove Programs". |
| `ManufacturingERP-Windows-Portable.zip` | ~258 MB | Portable build (no installation). Unzip anywhere and run `ManufacturingERP.exe` directly. |
| `README-DESKTOP.md` | — | This file. |

Both artifacts contain the **complete, self-contained application**: an Electron shell (Chromium UI) plus an embedded production Next.js server and database clients for BOTH SQLite (offline local mode) and MySQL (shared-hosting mode). **No internet connection and no Node.js are required** — local mode works fully offline; host mode needs your hosting MySQL to be reachable.

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

The bundled first-run database starts clean with the `admin` account only — create your staff accounts in the in-app **Users** module (each with its own role/department). Change the default password immediately.

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
2. Import the empty table structure on the host once, using `mysql-schema.sql` (Settings → backup card → "فایل SQL هاست") in phpMyAdmin — the Settings status box will show **19/19 tables** when complete.
3. In the app: **Settings** → **"اتصال برنامه به هاست (ذخیره دیتا در MySQL)"** → fill host / port (3306) / database / user / password → **Save & connect**. The app restarts connected to the host.
4. Move existing data: first click **"خروجی JSON (انتقال به هاست)"** (backup section), connect to the host, then restore that JSON file. (This one-time migration stays manual; everything afterwards is automatic.)
5. Verify: the **"وضعیت فعلی دیتابیس"** box at the top of that Settings card must turn green (✅ connected, MySQL version, 19/19 tables). If it is red, it shows the exact reason (port blocked / wrong credentials / tables missing).

### Auto online/offline (new in v1.0.7)

- While connected, the app silently keeps a **safety copy of the server data on the device** (refreshed every 15 minutes, or via "کپی دیتای سرور به دستگاه" in Settings).
- When the host becomes unreachable (internet down, hosting down, port blocked): within ~8–30 s the app **switches itself to the local copy** — the header badge turns amber «آفلاین — دیتابیس محلی» and shows the number of pending changes. You keep working; nothing is lost.
- When the host is reachable again: the app **switches back automatically** (≤ 15 s), pushes all offline changes (last-write-wins per record), replays offline deletions, and pulls a fresh snapshot. The badge turns green «متصل به سرور» and shows «همگام‌سازی…» while syncing.
- Notes: settings changes made while offline are not synced back (records without timestamps are only synced as new rows); every other add/edit/delete is covered.

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
NSISDIR=$HOME/nsis-works/nsis-root/usr/share/nsis \
  $HOME/nsis-works/nsis-root/usr/bin/makensis -V2 ../electron/installer.nsi
#   ^ run from the desktop-dist/ directory; makensis comes from Debian's nsis debs
#     (nsis_3.08-3+deb12u1_amd64.deb + nsis-common_…_all.deb) extracted to ~/nsis-works/nsis-root
cd desktop-dist && zip -qr ../download/ManufacturingERP-Windows-Portable.zip win-unpacked
```

On any Windows machine with Node.js, an equivalent signed/icon-edited installer can also be produced with:

```bash
npx electron-builder --win nsis
```

---

## نسخهٔ دری — خلاصهٔ راهنما

### فایل‌های تحویل‌شده
- **`ManufacturingERP-Setup.exe`** (~۱۶۱ مېگابایت): نصاب اصلی ویندوز. یک بار اجرا کنید، پوشه را انتخاب کنید و تمام. شورتکات در منوی استارت و دسکتاپ ساخته می‌شود و از بخش Add/Remove Programs هم قابل حذف است.
- **`ManufacturingERP-Windows-Portable.zip`** (~۲۵۴ مېگابایت): نسخهٔ قابل‌حمل بدون نصب. زیپ را استخراج کرده و فایل `ManufacturingERP.exe` را داخل پوشهٔ `win-unpacked` اجرا کنید.

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

### ✨ تازه در نسخهٔ ۱.۰.۱۹ — نسخهٔ تستِ عمیق
- کل سیستم (کد، منطق و ظاهر) عمیق تست شد و **بیش از ۳۷ باگ واقعی** رفع گردید — جزئیات کامل در فایل `RELEASE-NOTES-v1.0.19.md` همین ریلیز.
- بانک اطلاعاتی نمونهٔ همراه، پاک و آمادهٔ کار واقعی است (فقط کاربر admin) — کارمندان و کاربران دیگر را از ماژول «کاربران» خودتان بسازید.

### ✨ تازه در نسخه ۱.۰.۷ — قطع/وصل خودکار اینترنت + همگام‌سازی دوسویه
- وقتی اینترنت یا هاست قطع شود، برنامه **خودکار روی آخرین کپی دیتای سرور (روی همین دستگاه) کار می‌کند** — بج هدر زرد می‌شود: «آفلاین — دیتابیس محلی». هیچ خطایی نمی‌بینید و کار متوقف نمی‌شود.
- هر وقت اتصال برگردد (بررسی هر ۱۵ ثانیه)، برنامه **خودکار به هاست وصل می‌شود و همه‌چیز را همگام می‌کند**: تغییرات آفلاین به سرور منتقل می‌شود، حذف‌های آفلاین تکرار می‌شود و جدیدترین دیتای سرور دریافت می‌شود.
- در حالت اتصال، هر ۱۵ دقیقه یک کپی امن از دیتای سرور روی دستگاه گرفته می‌شود تا همیشه برای حالت آفلاین آماده باشد (دکمهٔ «کپی دیتای سرور به دستگاه» برای کپی فوری).
- برای اولین انتقال دیتا به هاست همچنان مسیر «خروجی JSON → اتصال → بازیابی» یک‌بار انجام می‌شود؛ بعد از آن همه‌چیز خودکار است.

### ✨ تازه در نسخه ۱.۰.۵ — رفع کامل مشکل ذخیرهٔ داده در هاست
در نسخه‌های قبلی، پس از وصل شدن به هاست، ذخیرهٔ داده‌ها کار نمی‌کرد (بستهٔ برنامه فقط کلاینت SQLite را داشت). اکنون:
- **ذخیره در هاست واقعاً کار می‌کند** — برنامه هر دو کلاینت دیتابیس (SQLite محلی + MySQL هاست) را دارد و خودکار بین آن‌ها سوییچ می‌کند.
- **کارت وضعیت زندهٔ دیتابیس** در تنظیمات: سبز = وصل است و ۱۹/۱۹ جدول کامل است؛ زرد = جدول‌ها ناقص است (کدام‌ها؟)؛ سرخ = علت دقیق قطعی (پورت بسته/رمز غلط/…).

### ✨ تازه در نسخه ۱.۰.۳ — اتصال به هاست از داخل برنامه
دیگر لازم نیست فایل `db-connection.txt` را دستی پیدا کنید:
1. در cPanel هاست، دیتابیس MySQL و کاربر بسازید و در **Remote MySQL** علامت `%` (یا IP خود) را اضافه کنید.
2. ساختار جداول را یک بار در phpMyAdmin هاست با فایل **`mysql-schema.sql`** ایمپورت کنید (وقتی کامل شد، کارت وضعیت ۱۹/۱۹ جدول نشان می‌دهد).
3. در برنامه: **تنظیمات** → کارت **«اتصال برنامه به هاست (ذخیره دیتا در MySQL)»** → آدرس هاست، پورت (۳۳۰۶)، نام دیتابیس، نام کاربری و رمز را وارد کنید → **«ذخیره و اتصال به هاست»**. برنامه خودش فایل تنظیمات را می‌نویسد و دوباره باز می‌شود.
4. انتقال دیتای فعلی: اول **«خروجی JSON (انتقال به هاست)»** را بگیرید، بعد وصل شوید و همان فایل را در بخش پشتیبان‌گیری بازیابی کنید.
5. تأیید نهایی: باکس **«وضعیت فعلی دیتابیس»** بالای همان کارت باید سبز شود (✅ وصل — نسخهٔ MySQL — ۱۹/۱۹ جدول).

راهنمای کامل گام‌به‌گام (دری): فایل `hosting-guide.md` — از داخل برنامه قابل دانلود است.

