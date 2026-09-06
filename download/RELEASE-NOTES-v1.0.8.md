# ManufacturingERP v1.0.8 — پشتیبانی رسمی هاست اشتراکی (تونل SSH)

**English below / پښتو لاندې**

---

## فارسی

### چرا این نسخه مهم است؟

Namecheap و همهٔ هاست‌های اشتراکی cPanel، اتصال مستقیم MySQL از بیرون (پورت 3306) را **کاملاً مسدود** کرده‌اند — حتی با Remote MySQL و `%`. راه رسمی که خود Namecheap پیشنهاد می‌کند فقط **تونل SSH** است. تا حالا این یعنی PuTTY و کار دستی؛ **از این نسخه، برنامه خودش تونل را می‌سازد و نگه می‌دارد.**

### امکانات جدید v1.0.8

- 🔐 **تونل SSH خودکار داخل برنامه** — در تنظیمات، حالت «تونل SSH — هاست اشتراکی» را انتخاب کنید؛ برنامه در هر اجرا تونل امن به سرور می‌سازد (پورت SSH معمولاً 21098) و MySQL را از داخل تونل وصل می‌کند.
- 🧪 **دکمهٔ «تست اتصال SSH»** — قبل از ذخیره، دقیقاً می‌گوید مشکل کجاست (رمز غلط / سرور پیدا نشد / SSH فعال نیست).
- 🔁 **وصل مجدد خودکار** — اگر تونل وسط کار قطع شود، برنامه با فاصلهٔ کوتاه مدام دوباره تلاش می‌کند.
- 🟡 **ادامهٔ کار در قطعی** — تا تونل/اینترنت وصل نشود، برنامه روی دیتابیس محلی (آخرین کپی سرور) کار می‌کند و بعد از وصل شدن، همه‌چیز دوطرفه همگام می‌شود (همان موتور v1.0.7).
- 🛠 رفع اسکرول افقی خیالی در موبایل + بهبود متن‌های خطا برای هاست اشتراکی.

### راه‌اندازی روی هاست اشتراکی (Namecheap/cPanel) — ۵ دقیقه

1. **cPanel → Manage My Databases**: یک دیتابیس و کاربر بسازید (مثل `cpuser_factory`) و کاربر را با ALL PRIVILEGES به دیتابیس اضافه کنید.
2. **cPanel → Manage Shell**: دسترسی SSH را **Enable** کنید.
3. **برنامه → تنظیمات → اتصال به هاست**: حالت «تونل SSH» انتخاب است؛ پر کنید:
   - آدرس سرور SSH: مثل `server370.web-hosting.com` (در ایمیل خوش‌آمد هاست هست)
   - پورت SSH: `21098`
   - نام کاربری/رمز SSH: همان ورود cPanel
   - نام دیتابیس، نام کاربری دیتابیس، رمز دیتابیس: همان‌هایی که در مرحله ۱ ساختید
4. **«تست اتصال SSH»** را بزنید → باید ✅ شود → **«ذخیره و اتصال به هاست»**.
5. برای انتقال دیتای فعلی: اول از بخش پشتیبان‌گیری «خروجی JSON» بگیرید، بعد از وصل شدن، همان فایل را بازیابی کنید.

> نیازی به Remote MySQL نیست. اگر بعداً اینترنت قطع شود، برنامه بی‌صدا روی دیتابیس محلی ادامه می‌دهد (بج زرد در بالای صفحه) و با برگشت اینترنت خودکار همگام می‌کند.

### دانلود

- `ManufacturingERP-Setup-1.0.8.exe` — نصب استاندارد ویندوز
- `ManufacturingERP-Portable-1.0.8.zip` — بدون نصب؛ extract و اجرا

---

## English

### Why this release matters

Namecheap (and all cPanel shared hosts) block inbound MySQL (port 3306) entirely — Remote MySQL whitelisting does not help. The only officially supported method is an **SSH tunnel**. Until now that meant manual PuTTY setups; **starting with v1.0.8 the app builds and maintains the tunnel itself.**

### What's new in v1.0.8

- 🔐 **Built-in automatic SSH tunnel** — pick "SSH tunnel — shared hosting" in Settings; the app establishes the tunnel (SSH port usually 21098) on every launch and routes MySQL through it.
- 🧪 **"Test SSH connection" button** — exact diagnosis before saving: wrong password / host unreachable / SSH disabled.
- 🔁 **Auto-reconnect** — if the tunnel drops, the app keeps retrying with backoff.
- 🟡 **Graceful offline** — while the tunnel/internet is down the app keeps working on the local database (last server copy) and syncs both ways automatically once it returns (v1.0.7 engine).
- 🛠 Fixed phantom horizontal scroll on mobile; improved shared-hosting error hints.

### Setup on shared hosting (5 minutes)

1. cPanel → **Manage My Databases**: create a database + user (e.g. `cpuser_factory`), grant ALL PRIVILEGES.
2. cPanel → **Manage Shell**: enable SSH.
3. App → Settings → Host connection: SSH tunnel mode → fill SSH server (e.g. `server370.web-hosting.com`), port `21098`, cPanel username/password, plus the database name/user/password from step 1.
4. Press **Test SSH connection** → ✅ → **Save & connect**.
5. To migrate existing data: export JSON backup first, connect, then restore it.

---

## پښتو

### دا نسخه ولې مهمه ده؟

Namecheap او ټولو شریکو cPanel هوسټونو مستقیم MySQL (بورډ 3306) بند کړی دی — Remote MySQL هم مرسته نه کوي. رسمي لار یوازې **د SSH تونل** ده. تر دې دمه دا د PuTTY لاسي کار و؛ **له دې نسخې پروګرام پخپله تونل جوړوي او ساتي.**

### نوي څه په v1.0.8 کې

- 🔐 **اتوماتیک د SSH تونل د پروګرام دننه** — امستنې کې «د SSH تونل — شریک هوسټ» غوره کړئ؛ پروګرام په هر پرانیستلو کې خوندي تونل جوړوي (د SSH بورډ معمولاً 21098) او MySQL له هغه لارې نښلوي.
- 🧪 **«د SSH نښلول ازمویل» تڼۍ** — له خوندي کولو دمخه precisely وایي ستونزه چېرته ده (غلط پاسورد / سرور نه موندل کېږي / SSH فعاله نه ده).
- 🔁 **اتوماتیک بیا نښلول** — که تونل پرې شي، پروګرام بیا بیا هڅه کوي.
- 🟡 **په قطع کې دوام** — تر هغه چې تونل/انترنت راځي، پروګرام په ځایی ډاټابیس کار کوي او له نښلېدو وروسته دواړه لورې اتوماتیک همغه کېږي.
- 🛠 په موبایل کې د خیالي افقي سکرول removal + د شریکو هوسټونو لپاره ښه خطا پیغامونه.

### پرانیستل (۵ دقیقې)

۱) cPanel → Manage My Databases: ډاټابیس او کاروونکی جوړ کړئ (ALL PRIVILEGES). ۲) cPanel → Manage Shell: SSH فعاله کړئ. ۳) پروګرام → امستنې: د SSH تونل حالت — د SSH سرور پته (لکه `server370.web-hosting.com`)، بورډ `21098`، cPanel کاروونکی/پاسورد، او د ډاټابیس معلومات. ۴) «تست اتصال SSH» → ✅ → «ذخیره و اتصال». ۵) د ډاټا لېږدولو لپاره: لومړی JSON بیک اپ واخلئ، وصل شئ، بیا یې بیا رغوئ.
