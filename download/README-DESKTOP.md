# ManufacturingERP — Windows Desktop Application

نسخهٔ دسکتاپ (ویندوز) سیستم مدیریت تولید — دفترچهٔ نصب و استفاده

**Version 1.0.22** — 🔍 **CLEAR CONNECTION-FAILURE MESSAGES + HTTP FALLBACK**: every failed connection test now explains the real reason in plain language (address not found / timeout / refused / *web version not installed at this address*), with a troubleshooting checklist on desktop and a help section on mobile; if you type an address without a protocol, `https` **and** `http` are both tried and the one that actually works is saved (hosts without SSL certificates used to always fail). Plus 🚪 **HOST PAGE ALWAYS SHOWN UNTIL CONNECTED (v1.0.21)**, 🔐 **HOST-FIRST SETUP + OFFLINE SIGN-IN (v1.0.20)** and 🧪 **DEEP-TESTED v1.0.19**.

---

## 1) What was delivered (English)

| File | Size | What it is |
|---|---|---|
| `ManufacturingERP-Setup.exe` | ~164 MB | **Real NSIS installer** (PE32, Nullsoft self-extracting, LZMA). Install via wizard, creates Start-menu + Desktop shortcuts, registers an uninstaller in "Add/Remove Programs". |
| `ManufacturingERP-Windows-Portable.zip` | ~259 MB | Portable build (no installation). Unzip anywhere and run `ManufacturingERP.exe` directly. |
| `host.bat` | ~9 KB | **Standalone interactive host-connect script** (v1.0.20+). Double-click, enter the host address & passwords when asked — it writes the connection config and restarts the app connected to the host. Works on any PC, even without the app installed yet. |
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

### Quick connect with `host.bat` (new in v1.0.20)

A one-file helper so any user can connect the app to the host **without opening the app first**. Two ways — both work:

**Way 1 — fill the file first (recommended, no questions asked at run time):**
1. Right-click `host.bat` → **Edit** (or open in Notepad).
2. Find the block **`*** ENTER YOUR HOST INFO HERE ***`** (right after the `#PSBEGIN#` line, near the top-third of the file).
3. Fill your values between the `' '` quotes — e.g. `$CFG_MODE = 'ssh'`, `$CFG_SSH_HOST = 'server300.web-hosting.com'`, `$CFG_DB_NAME = 'setab_erp'`, … — and save.
4. Double-click `host.bat`: it uses exactly those values, checks the host is reachable, writes the config and restarts the app connected. **Any field left empty is asked at run time**, so you can pre-fill only part of it.
5. Password rule: type it between `' '`; if the password itself contains a `'`, write it twice (`'ab''123'` means `ab'123`). All other special characters (`@ : # % & !` …) need no escaping.

**Way 2 — no editing at all:** just double-click and answer the questions (connection type, host, port, database, users, masked passwords).

Then (both ways):
- The script checks that host:port is reachable, writes `%APPDATA%\ManufacturingERP\db-connection.txt` (same format the app uses in Settings), and offers to restart ManufacturingERP — the app then connects to the host automatically.
- Re-run it any time to change the host; to go back to the local database, comment out the `mysql://` line in that file (or use Settings → host card).
- Defaults if you press Enter: SSH port `21098`, MySQL port `3306`.

Notes: it is a plain text file — open it in Notepad to review the code; every special character in passwords is safely URL-encoded; nothing is sent anywhere except to your own host.

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


### ✨ وصل کردن سریع برنامه به هاست با فایل `host.bat` (جدید در نسخهٔ ۱.۰.۲۰)

یک فایل مستقل و کوچک است؛ روی هر کمپیوتر که نسخهٔ دسکتاپ نصب باشد (یا حتی قبل از نصب) کار می‌کند. **دو راه** دارد — هر دو یک نتیجه می‌دهند:

#### راه ۱ — اول فایل را پر کنید (پیشنهاد می‌شود؛ هنگام اجرا هیچ سوالی نمی‌پرسد)
1. روی `host.bat` **راست‌کلیک → Edit** (یا باز کردن در Notepad).
2. بلاک **`*** مشخصات هاست را اینجا وارد کنید / ENTER YOUR HOST INFO HERE ***`** را پیدا کنید (کمی پایین‌تر، بعد از خط `#PSBEGIN#`).
3. مقدار هر خط را بین دو علامت `' '` بنویسید و فایل را ذخیره کنید. مثال واقعی:

```bat
$CFG_MODE = 'ssh'
$CFG_SSH_HOST = 'server300.web-hosting.com'
$CFG_SSH_PORT = ''
$CFG_SSH_USER = 'myname'
$CFG_SSH_PASS = 'MySshPass123'
$CFG_DB_NAME = 'setab_erp'
$CFG_DB_USER = 'setab_user'
$CFG_DB_PASS = 'MyDbPass123'
```

   (برای سرور مجازی به‌جای آن: `$CFG_MODE = 'direct'` و `$CFG_DB_HOST = '192.0.2.10'`)
4. فایل را ذخیره و دابل‌کلیک کنید — برنامه وصل می‌شود. **هر خطی را که خالی بگذارید هنگام اجرا از شما پرسیده می‌شود**، پس می‌توانید فقط بعضی خط‌ها را پر کنید.
5. قانون رمز: اگر خود رمز علامت `'` داشت، آن را دو بار پشت‌سرهم بنویسید (`'ab''123'` یعنی `ab'123`). بقیهٔ کاراکترها (`@ : # % & !` و…) نیازی به تغییر ندارند.

#### راه ۲ — بدون ویرایش
همان دابل‌کلیک کنید؛ خودش نوع اتصال، آدرس، پورت، دیتابیس، کاربر و رمزها را یکی‌یکی می‌پرسد (رمزها هنگام تایپ پنهان *** نمایش داده می‌شوند).

#### بعد از هر دو راه
- اسکریپت اول دسترسی هاست را چک می‌کند، بعد فایل تنظیم را در `%APPDATA%\ManufacturingERP\db-connection.txt` می‌نویسد (دقیقاً همان فرمتی که برنامه از کارت «اتصال به هاست» می‌نویسد) و در آخر پیشنهاد می‌دهد برنامه را دوباره باز کند — برنامه خودکار به هاست وصل می‌شود.
- هر وقت خواستید هاست را عوض کنید دوباره همین فایل را (راه ۱ یا ۲) اجرا کنید؛ برای برگشت به دیتابیس محلی، خط `mysql://` را در همان فایل با `#` کامنت کنید (یا از تنظیمات → کارت اتصال به هاست).
- اگر جایی فقط Enter بزنید، پیش‌فرض‌ها اعمال می‌شوند: پورت SSH `21098` و پورت MySQL `3306`.

نکته‌ها:
- `host.bat` یک فایل متنی ساده است — کد آن کاملاً خواناست و می‌توانید آن را ببینید.
- اگر متن فارسیِ توضیحات داخل فایل به‌هم‌ریخته دیده شد، اشکالی ندارد؛ فقط مقادیر بین دو علامت `'` را عوض کنید و ذخیره کنید.
- معلومات فقط در دستگاه خودتان ذخیره می‌شود و به هیچ‌جای دیگر فرستاده نمی‌شود.
- اگر پیام «Windows protected your PC» دیدید، More info → Run anyway را بزنید (فایل امضای دیجیتال ندارد).
