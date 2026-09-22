# ManufacturingERP — Windows Desktop Application

نسخهٔ دسکتاپ (ویندوز) سیستم مدیریت تولید — دفترچهٔ نصب و استفاده

**Version 1.0.28** — 🔐 **Host-only sign-in policy**: the app no longer opens (or signs in) without a configured host — local/demo accounts cannot be used anymore; after connecting, sign-in works with the **users stored on your host** and the host data is **mirrored on every device** for offline use. ♻ **Host adoption**: on first connect a fresh install automatically replaces its factory-demo database with the real host data (a pre-adoption JSON backup is written next to the local database), so host users can sign in immediately — the demo data is never pushed to your host. 🔁 **Sign-in host fallback**: if the local mirror is stale (e.g. a password changed on another device), credentials are verified directly against the host and the mirror is refreshed. 🧭 The first-run wizard now restarts the app automatically after saving host settings, and re-opens with a reason banner when a saved host was never reachable. Previous: v1.0.27 live exchange rates from sarafi.af + automatic absence deduction + RTL switch fix + settings-file upload; v1.0.24/25 the config file on `C:\Users\<YourUser>\ManufacturingERP\db-connection.txt` + live file status + one-click "Create config file"; 🔐 host-first setup + offline sign-in (v1.0.20), 🧪 deep-tested v1.0.19. — 💱 **Live exchange rates from sarafi.af** (Kabul market reference): USD & PKR are fetched automatically and applied everywhere prices are used (POS/sales, dashboard, reports, settings) with a 1-hour cache and fallback providers. 👥 **Automatic absence deduction from salary**: absent days are counted per Jalali month and deducted at a configurable daily rate (empty = 1/30 of salary), with a live preview in the payment dialog and deduction lines on the salary slip. 🎚 **RTL switch rendering fixed** across all modules. 🗑 the “Forgot admin password?” button was removed from the sign-in screen. 📤 **Connect to your host by uploading a settings file**: the first-run wizard now accepts a settings file (JSON / db-connection.txt / Windows .bat) — upload it and SSH/database fields (Windows) or the server URL (Android) are auto-filled and auto-tested; the desktop settings page can **download a settings JSON** to hand to new installs. Previous: v1.0.26 auto-repair of the “internal host error” (missing tokenVersion column) + auto table creation on fresh web hosts; v1.0.24/25 the config file on `C:\Users\<YourUser>\ManufacturingERP\db-connection.txt` + live file status + one-click “Create config file”; 🔐 host-first setup + offline sign-in (v1.0.20), 🧪 deep-tested v1.0.19.


### “خطای داخلی هاست” when signing in (fixed in v1.0.26)

Older installs (≤ v1.0.25) whose local database was created by **v1.0.18 or earlier** hit this on every
sign-in: the local SQLite was missing the `tokenVersion` column added in v1.0.19 and **nothing ever
upgraded it**. v1.0.26 fixes the cause and adds a self-heal layer:

1. **Install v1.0.26 (or newer) and just restart the app** — the database is upgraded automatically
   before the first login; no action needed.
2. If you still see an error, the message now includes the **error code** (e.g. `P2022`) and a hint —
   send a screenshot of it to support. Close and reopen the app once; the automatic repair runs again.
3. Fully local mode (no host) always keeps working: after the upgrade the default account
   `admin / admin123` is available when the database was empty.

Also new in v1.0.26: **web deployments on a fresh host create all 19 MySQL tables automatically** at the
first successful ping — previously an empty MySQL database produced the same generic error on login.

---

## 1) What was delivered (English)

| File | Size | What it is |
|---|---|---|
| `ManufacturingERP-Setup.exe` | ~165 MB | **Real NSIS installer** (PE32, Nullsoft self-extracting, LZMA). Install via wizard, creates Start-menu + Desktop shortcuts, registers an uninstaller in "Add/Remove Programs". |
| `ManufacturingERP-Windows-Portable.zip` | ~259 MB | Portable build (no installation). Unzip anywhere and run `ManufacturingERP.exe` directly. |
| `host.bat` | ~9 KB | (Optional, legacy) Standalone host-connect script. **No longer needed** — the app now creates and manages the config file itself (see §3). |
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

### Quick connect: the config file on C:\ (NEW in v1.0.24 — recommended)

You can now enter the host details **directly in a plain text file** — no forms, no scripts:

1. The file lives at an easy path (the app creates it with a full Persian guide inside on first run):

   ```
   C:\Users\<YourUser>\ManufacturingERP\db-connection.txt
   ```

   (The same content is also mirrored to `%APPDATA%\ManufacturingERP\db-connection.txt`.)
2. Open it in **Notepad**, fill the connection line and save:

   ```
   mysql://DBUSER:DBPASSWORD@DBHOST:3306/DBNAME
   ssh-mode=direct
   ```

   For shared hosting (Namecheap/cPanel, where port 3306 is closed) use the SSH tunnel instead:

   ```
   mysql://DBUSER:DBPASSWORD@127.0.0.1:5522/DBNAME
   ssh-mode=ssh
   ssh-host=server370.web-hosting.com
   ssh-port=21098
   ssh-user=mycpaneluser
   ssh-password=cpanelpassword
   ```

   (The app rewrites the `127.0.0.1:5522` part itself when you save from its UI; when editing the file by hand just keep the mysql:// host as the real DB host and set `ssh-mode=ssh` — the tunnel overrides it at startup.)
3. Close the app and open it again — it connects to the host automatically and creates any missing tables by itself (no phpMyAdmin needed).

You can also reach the file from inside the app: the host page (shown at startup until a working connection exists) has **“Show file in Explorer”** and **“Re-read from file”** buttons; after editing the file click “Re-read from file” (or just restart the app). From v1.0.25 the page also shows whether the file actually exists — and a **“Create config file”** button that writes the template immediately if it does not.

If the saved connection is broken (wrong MySQL user/password, unknown database, tunnel down), the host page opens again at startup **showing the exact reason** — fix the values (in the form or in the file) and save.

### Troubleshooting: «فایل db-connection.txt نیست» — the config file is not there?

1. **Check the installed version first.** Old builds (v1.0.23 and earlier) do **not** create any file. On the host page the footer shows `ManufacturingERP v…`; Settings → about/version shows the same. If it is older than **1.0.24**, download the latest Setup from <https://github.com/M-1-hashim/manufacturing-management-system/releases/latest> and install it — the file is created automatically at first launch.
2. **Let the app create it for you.** On the host page, the file card shows the full path and (v1.0.25+) an amber warning with a **«ساخت فایل تنظیمات»** button if the file is missing — one click writes the template to both `C:\Users\<YourUser>\ManufacturingERP\` and `%APPDATA%\ManufacturingERP\`, then **“Show file in Explorer”** opens it.
3. **Check the exact folder.** The file is inside *your own user profile* — `<YourUser>` is your Windows account name (e.g. `C:\Users\ahmad\ManufacturingERP\db-connection.txt`). Copy-paste `%APPDATA%\ManufacturingERP` into the **Win + R** box to open the mirror copy.
4. **If creation still fails** (very rare — antivirus/“Controlled folder access” can block writes): open the log at `%APPDATA%\ManufacturingERP\electron.log` and look for lines starting with `db-connection` — the exact Windows error is written there. Add an antivirus exclusion for the app, or create the folder+file manually per the template above.

<details>
<summary><b>Legacy: <code>host.bat</code> (optional, no longer needed)</b></summary>

The old helper script is still in the repository for reference — double-click and answer its questions and it writes the same config file. With v1.0.24 the app manages the file itself, so you normally never need it.

</details>

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


### ✨ فایل تنظیمات روی C:\ — راه تازهٔ وصل کردن به هاست (جدید در نسخهٔ ۱.۰.۲۴)

از این به بعد برای وصل کردن برنامه به هاست **فایل متنی ساده** کافی است — نه فرم، نه اسکریپت:

۱. فایل تنظیم در این مسیر آسان قرار دارد (برنامه در اولین اجرا خودش با راهنمای کامل فارسی داخلش می‌سازد):

```
C:\Users\<نام‌کاربری شما>\ManufacturingERP\db-connection.txt
```

۲. فایل را با **Notepad** باز کنید، خط اتصال را با مشخصات خودتان پر کنید و ذخیره کنید:

```
mysql://DBUSER:DBPASSWORD@DBHOST:3306/DBNAME
ssh-mode=direct
```

برای هاست اشتراکی (Namecheap/cPanel که پورت MySQL بسته است) حالت تونل:

```
mysql://DBUSER:DBPASSWORD@DBHOST:3306/DBNAME
ssh-mode=ssh
ssh-host=server370.web-hosting.com
ssh-port=21098
ssh-user=mycpaneluser
ssh-password=cpanelpassword
```

۳. برنامه را ببندید و دوباره باز کنید — خودش به هاست وصل می‌شود و جدول‌های گمشده را خودکار می‌سازد (phpMyAdmin لازم نیست).

نکته‌ها:
- در صفحهٔ اطلاعات هاستِ برنامه (که تا وقتی اتصال سالم نشده در شروع نشان داده می‌شود) دو دکمهٔ جدید هست: **«باز کردن فایل در ویندوز»** (فایل در Explorer نشان داده می‌شود) و **«بازخوانی از فایل»** (بعد از ویرایش فایل، مقادیر داخل فرم به‌روز می‌شود).
- اگر اتصال ذخیره‌شده خراب باشد (رمز/نام کاربری MySQL غلط، نام دیتابیس اشتباه، تونل قطع)، برنامه در شروع **دلیل دقیق خرابی** را روی صفحهٔ هاست نشان می‌دهد و فرم با مقادیر فعلی پرشده باز می‌شود — فقط ایراد را اصلاح و ذخیره کنید.
- پایین صفحهٔ راه‌اندازی، شمارهٔ نسخه (`ManufacturingERP v1.0.27`) نوشته شده تا مطمئن شوید نسخهٔ جدید نصب است. اگر فایل `db-connection.txt` وجود ندارد یعنی نسخهٔ نصب‌شده قدیمی است (قبل از ۱.۰.۲۴ هیچ فایلی ساخته نمی‌شد) — Setup جدید را نصب کنید؛ از نسخهٔ ۱.۰.۲۵ اگر فایل نباشد دکمهٔ «ساخت فایل تنظیمات» در همان صفحه آن را یک‌جا می‌سازد؛ از نسخهٔ ۱.۰.۲۷ می‌توانید به‌جای تایپ، «فایل تنظیمات» را در همان صفحه آپلود کنید تا همهٔ فیلدها خودکار پر شوند.
- `host.bat` دیگر لازم نیست — به‌عنوان ابزار اختیاری در مخزن مانده است.
- اگر هیچ خط `mysql://` فعالی در فایل نباشد، برنامه با دیتابیس محلی (SQLite) کار می‌کند.

### ✨ وصل کردن سریع برنامه به هاست با فایل `host.bat` (ابزار اختیاری قدیمی)

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
