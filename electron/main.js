/*
 * Electron main process — ManufacturingERP desktop distribution.
 *
 * Boots an embedded Next.js standalone server as a child process (Electron
 * binary run as plain Node via ELECTRON_RUN_AS_NODE=1) and shows it inside a
 * BrowserWindow. All server data (SQLite via Prisma) lives in a writable
 * per-user data directory: %APPDATA%/ManufacturingERP/data/custom.db
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

// تونل SSH — برای هاست‌های اشتراکی (Namecheap/cPanel) که Remote MySQL بسته است
let sshTunnelLib = null;
try {
  sshTunnelLib = require('./ssh-tunnel.js');
} catch (e) {
  // اگر ssh2 در بسته نیست، برنامه بدون تونل هم کار می‌کند (اتصال مستقیم/محلی)
  console.error('ssh-tunnel module unavailable:', e && e.message);
}

const BASE_PORT = 37815;
const MAX_PORT_ATTEMPTS = 21; // 37815 .. 37835
const READY_TIMEOUT_MS = 90000; // poll up to 90s per port
const POLL_INTERVAL_MS = 500;
const SSH_TUNNEL_PORT = 5522; // پورت محلی تونل (روی دستگاه کاربر)

const isPackaged = app.isPackaged;
const SERVER_DIR = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', '.next-electron', 'standalone');

let serverChild = null;
let serverPort = null;
let mainWindow = null;
let quitting = false;
let sshTunnelInstance = null; // تونل فعال (فقط در حالت ssh)

/* ---------------------------------------------------------------- logging */

function logFilePath() {
  try {
    return path.join(app.getPath('userData'), 'electron.log');
  } catch (_e) {
    return path.join(os.tmpdir(), 'manufacturingerp-electron.log');
  }
}

function logLine(line) {
  try {
    fs.appendFileSync(logFilePath(), `[${new Date().toISOString()}] ${line}\n`);
  } catch (_e) {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => {
  logLine(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  logLine(`unhandledRejection: ${reason && reason.stack ? reason.stack : String(reason)}`);
});

/* ------------------------------------------------------------- data layer */

/*
 * اتصال سفارشی دیتابیس — فایل db-connection.txt
 * اگر اولین خط غیر کامنت با mysql:// شروع شود، دیتا در هاست اشتراکی ذخیره می‌شود
 * وگرنه حالت پیش‌فرض (SQLite محلی) استفاده می‌گردد
 *
 * نسخهٔ ۱.۰.۲۴ — فایل در دو مسیر نگه‌داری می‌شود تا کاربر بدون جست‌وجوی
 * پوشهٔ مخفی AppData بتواند مستقیم در Notepad ویرایشش کند:
 *   ۱) مسیر پیدا‌کردنی روی C:\:  C:\Users\<کاربر>\ManufacturingERP\db-connection.txt
 *      (پوشهٔ home کاربر — در Windows Explorer بدون نمایش فایل‌های مخفی دیده می‌شود)
 *   ۲) مسیر استاندارد برنامه:    %APPDATA%\ManufacturingERP\db-connection.txt
 *
 * قاعدهٔ خواندن: اولین فایلی که «خط اتصال فعال» (mysql:// بدون #) داشته باشد
 * برنده است؛ اگر هیچ‌کدام فعال نباشند، اولین فایل موجود برای پیش‌پرکردن فرم
 * خوانده می‌شود. ذخیرهٔ برنامه همیشه در هر دو مسیر است تا فایل قدیمیِ فعال
 * هیچ‌وقت فایل جدیدتر را باطل نکند.
 */
function connectionConfigPath() {
  return path.join(app.getPath('userData'), 'db-connection.txt');
}

function friendlyConfigPath() {
  let home = '';
  try { home = app.getPath('home') || ''; } catch (_e) { /* ignore */ }
  if (!home) {
    try { home = app.getPath('appData'); } catch (_e2) { home = ''; }
  }
  return path.join(home || '.', 'ManufacturingERP', 'db-connection.txt');
}

function configCandidates() {
  const list = [friendlyConfigPath(), connectionConfigPath()];
  return list.filter((p, i, arr) => p && arr.indexOf(p) === i);
}

function templateLines(activeUrl) {
  const lines = [
    '# ======================================================================',
    '#   ManufacturingERP — فایل تنظیم اتصال به هاست',
    `#   نسخهٔ برنامه: ${app.getVersion()} — این فایل به‌صورت خودکار ساخته شده است`,
    '#   این فایل را با Notepad ویرایش کنید، ذخیره کنید، بعد برنامه را ببندید',
    '#   و دوباره باز کنید.',
    '# ======================================================================',
    '#',
    '# ❶ خط اتصال MySQL — یک خط، مثل نمونه (در ابتدای خط # نگذارید):',
    '#',
    '#    mysql://DBUSER:DBPASSWORD@DBHOST:3306/DBNAME',
    '#',
    '#      DBUSER      = نام کاربری MySQL       (در cPanel: Manage My Databases)',
    '#      DBPASSWORD  = رمز MySQL',
    '#      DBHOST      = آدرس سرور (مثل server370.web-hosting.com یا 1.2.3.4)',
    '#      DBNAME      = نام دیتابیس (در cPanel معمولاً با نام کاربری شروع می‌شود، مثل myuser_mfg)',
    '#      اگر رمز شما کاراکتر خاص دارد اشکالی ندارد — همان را بنویسید.',
    '#',
    '# ❷ نوع اتصال — یکی از دو حالت (در ابتدای خط # نگذارید):',
    '#',
    '#    ssh-mode=direct    ← اتصال مستقیم به پورت 3306 (سرور مجازی/هاست اختصاصی)',
    '#    ssh-mode=ssh       ← تونل SSH برای هاست اشتراکی (Namecheap/cPanel و…)',
    '#                         که پورت MySQL بسته است؛ همراه آن ۴ خط زیر را پر کنید:',
    '#',
    '#      ssh-host=server370.web-hosting.com   ← همان آدرس سرور',
    '#      ssh-port=21098                        ← پورت SSH (Namecheap: 21098، بقیه معمولاً 22)',
    '#      ssh-user=mycpaneluser                 ← نام کاربری cPanel',
    '#      ssh-password=cpanelpassword           ← رمز cPanel',
    '#',
    '# ❸ فایل را ذخیره کنید و برنامه را ببندید و دوباره باز کنید.',
    '#',
    '# نکته‌ها:',
    '#   • خطوطی که با # شروع می‌شوند توضیح هستند و نادیده گرفته می‌شوند.',
    '#   • اگر هیچ خط mysql:// فعالی در فایل نباشد، برنامه با دیتابیس محلی (SQLite) کار می‌کند.',
    '#   • نام دیتابیس/کاربر/رمز MySQL است — نه cPanel (بجز ssh-user و ssh-password که cPanel هستند).',
    '#',
  ];
  lines.push(activeUrl ? activeUrl : '# mysql://DBUSER:DBPASSWORD@DBHOST:3306/DBNAME');
  lines.push('# ssh-mode=direct');
  lines.push('');
  return lines.join('\r\n');
}

/** محتوای داده‌شده را در همهٔ مسیرهای کاندید می‌نویسد — اولین مسیر برمی‌گردد */
function writeConnectionContent(content) {
  const candidates = configCandidates();
  let firstOk = null;
  let lastErr = null;
  for (const p of candidates) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf8');
      if (!firstOk) firstOk = p;
    } catch (e) {
      lastErr = e;
      logLine(`db-connection write failed at ${p}: ${e && e.message ? e.message : e}`);
    }
  }
  if (!firstOk && lastErr) throw lastErr;
  return firstOk || candidates[0];
}

function writeConnectionFile(activeUrl) {
  return writeConnectionContent(templateLines(activeUrl));
}

/**
 * اگر هیچ فایل تنظیمی وجود نداشته باشد، همان اولِ اجرا قالب راهنما ساخته می‌شود
 * تا کاربر همیشه یک فایل روی C:\ داشته باشد که بتواند در Notepad پرش کند.
 *
 * نتیجهٔ آخرین تلاش در lastEnsureResult نگه‌داری می‌شود تا IPC info بتواند
 * وضعیت واقعی فایل (موجود/نه + خطا) را به رندرر بدهد — «فایل db-connection.txt نیست»
 * دیگر یک معمای خاموش نیست؛ کاربر در خود برنامه دلیل و راه‌حل را می‌بیند.
 */
let lastEnsureResult = null; // { attempted, created, path, error }

function ensureTemplateFile() {
  try {
    const existing = configCandidates().find((p) => fs.existsSync(p));
    if (existing) {
      lastEnsureResult = { attempted: false, created: false, path: existing, error: null };
      return;
    }
    const p = writeConnectionFile(null);
    lastEnsureResult = { attempted: true, created: true, path: p, error: null };
    logLine(`db-connection template created at ${p}`);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    lastEnsureResult = { attempted: true, created: false, path: null, error: msg };
    logLine(`db-connection template create failed: ${msg}`);
  }
}

function maskUrl(url) {
  return String(url).replace(/:(?:[^:@/]*)@/, ':***@');
}

function parseFile(p) {
  const out = {
    path: p, exists: false,
    active: false, url: null, host: null, port: '3306', database: null, user: null,
    password: null,
    sshMode: false, sshHost: null, sshPort: '21098', sshUser: null, sshPassword: null,
  };
  let lines;
  try {
    lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    out.exists = true;
  } catch (_e) {
    return out; /* فایل نیست — خالی */
  }
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('mysql://')) {
      if (!out.active) {
        out.active = true;
        out.url = l;
        try {
          const u = new URL(l);
          out.host = u.hostname;
          out.port = u.port || '3306';
          out.database = u.pathname.replace(/^\//, '');
          out.user = decodeURIComponent(u.username || '');
          out.password = decodeURIComponent(u.password || '');
        } catch (_e) { /* URL ناقص — فقط حالت فعال گزارش می‌شود */ }
      }
      continue;
    }
    const eq = l.indexOf('=');
    if (eq > 0) {
      const key = l.slice(0, eq).trim();
      const val = l.slice(eq + 1).trim();
      if (key === 'ssh-mode') out.sshMode = val === 'ssh';
      else if (key === 'ssh-host') out.sshHost = val;
      else if (key === 'ssh-port') out.sshPort = val || '21098';
      else if (key === 'ssh-user') out.sshUser = val;
      else if (key === 'ssh-password') out.sshPassword = val;
    }
  }
  return out;
}

/*
 * برنده: اولین فایلِ «فعال» (friendly اول، بعد AppData)؛ اگر هیچ‌کدام فعال نبود،
 * اولین فایل موجود (برای پیش‌پرکردن فرم ویزارد)؛ اگر هیچ فایلی نبود، خالی با مسیر friendly.
 */
function parseActiveOverride() {
  const parsed = configCandidates().map(parseFile);
  return parsed.find((c) => c.active) || parsed.find((c) => c.exists) || parsed[0];
}

/*
 * یک‌بار برای همیشه: نسخه‌های ≤۱.۰.۳ به‌دلیل نبود productName در package.json،
 * داده‌ها را در %APPDATA%\nextjs_tailwind_shadcn_ts ذخیره می‌کردند در حالی که
 * راهنماها %APPDATA%\ManufacturingERP را نشان می‌دادند — همین باعث می‌شد کاربر
 * فایل db-connection.txt را پیدا نکند. اگر پوشه قدیمی دیتا دارد و پوشه جدید
 * خالی است، همه‌چیز یک‌جا منتقل می‌شود (بدون از دست رفتن هیچ داده‌ای).
 */
function migrateLegacyUserData() {
  try {
    const legacy = path.join(app.getPath('appData'), 'nextjs_tailwind_shadcn_ts');
    const target = app.getPath('userData');
    if (legacy === target) return; // حالت dev یا مسیر یکسان
    const legacyData = path.join(legacy, 'data');
    const legacyCfg = path.join(legacy, 'db-connection.txt');
    if (!fs.existsSync(legacyData) && !fs.existsSync(legacyCfg)) return; // چیزی برای انتقال نیست
    if (fs.existsSync(path.join(target, 'data', 'custom.db'))) return; // قبلاً منتقل شده یا دیتای جدید موجود است
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
      const src = path.join(legacy, entry.name);
      const dst = path.join(target, entry.name);
      try {
        if (entry.isDirectory()) {
          fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
        } else if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
        }
      } catch (_e) { /* فایل تکی مهم نیست — ادامه بده */ }
    }
    logLine(`legacy user data migrated: ${legacy} -> ${target}`);
  } catch (e) {
    logLine(`legacy user data migration failed: ${e && e.message ? e.message : e}`);
  }
}

/*
 * دیتابیس محلی — همیشه ساخته می‌شود، حتی وقتی هاست تنظیم شده است:
 * - حالت عادی محلی: دیتای اصلی همین‌جاست
 * - حالت هاست MySQL: این فایل «کپی آفلاین» است؛ وقتی اینترنت قطع شود
 *   برنامه خودکار روی همین فایل کار می‌کند و بعد از وصل شدن همگام می‌شود
 */
function ensureDatabase() {
  // Writable data dir next to user profile: userData/data/custom.db
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'custom.db');

  if (!fs.existsSync(dbPath)) {
    const src = isPackaged
      ? path.join(process.resourcesPath, 'demo-db', 'custom.db')
      : path.join(__dirname, '..', 'db', 'custom.db');
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dbPath);
      // روی ویندوز اگر فایل منبع فقط‌خواندنی باشد (یا آنتی‌ویروس attribute بگذارد)
      // کوئری‌های نوشتن «readonly database» می‌دهند — صریحاً قابل‌نوشتن می‌کنیم
      try { fs.chmodSync(dbPath, 0o644); } catch (_e) { /* ignore */ }
      logLine(`demo database copied to ${dbPath}`);
    } else {
      logLine(`WARN: demo database not found at ${src} — starting with empty db file`);
    }
  } else {
    // دیتابیس موجود که شاید از نسخه‌های قدیمی فقط‌خواندنی مانده باشد
    try {
      fs.accessSync(dbPath, fs.constants.W_OK);
    } catch (_e) {
      try { fs.chmodSync(dbPath, 0o644); logLine(`fixed read-only database file: ${dbPath}`); } catch (_e2) { /* ignore */ }
    }
  }
  return dbPath;
}

/* ------------------------------------------------------- embedded server */

function isServerReady(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', timeout: 2500 },
      (res) => {
        const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
        res.resume();
        resolve(ok);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function startServerOnPort(port, dbPath, dbUrlOverride) {
  return new Promise((resolve, reject) => {
    const dbPathPosix = dbPath ? dbPath.replace(/\\/g, '/') : ''; // Prisma needs forward slashes on Windows
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: dbUrlOverride || 'file:' + dbPathPosix,
      // دیتابیس محلی همیشه مشخص است — در حالت قطعی اینترنت، سرور روی آن سوییچ می‌کند
      LOCAL_DATABASE_URL: 'file:' + dbPathPosix,
      HOSTNAME: '127.0.0.1',
    };

    let child = null;
    let settled = false;
    let pollTimer = null;
    let readyTimer = null;

    const cleanup = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { if (child) child.kill(); } catch (_e) { /* ignore */ }
      reject(err);
    };
    const ok = (c) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(c);
    };

    try {
      child = spawn(process.execPath, [path.join(SERVER_DIR, 'server.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: SERVER_DIR,
        windowsHide: true,
      });
    } catch (e) {
      fail(e);
      return;
    }

    logLine(`spawned server pid=${child.pid} port=${port} server=${SERVER_DIR}`);

    readyTimer = setTimeout(
      () => fail(new Error(`timeout waiting for server on port ${port}`)),
      READY_TIMEOUT_MS
    );

    child.on('error', (e) => fail(e));
    child.on('exit', (code, signal) => {
      logLine(`server (port ${port}) exited code=${code} signal=${signal}`);
      fail(new Error(`server exited early (code=${code} signal=${signal})`));
    });

    child.stdout.on('data', (d) => logLine(`[server] ${String(d).trim()}`));
    child.stderr.on('data', (d) => logLine(`[server:err] ${String(d).trim()}`));

    pollTimer = setInterval(async () => {
      let ready = false;
      try { ready = await isServerReady(port); } catch (_e) { ready = false; }
      if (ready) ok(child);
    }, POLL_INTERVAL_MS);
  });
}

async function startEmbeddedServer(dbPath, dbUrlOverride) {
  let lastErr = null;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = BASE_PORT + i;
    try {
      const child = await startServerOnPort(port, dbPath, dbUrlOverride);
      return { child, port };
    } catch (e) {
      lastErr = e;
      logLine(`port ${port} attempt failed: ${e.message}`);
    }
  }
  throw lastErr || new Error('could not start embedded server');
}

/* ------------------------------------------------- IPC: db-connection.txt */

// مدیریت اتصال به هاست از داخل برنامه — کاربر نیازی به جستجوی فایل ندارد
/*
 * پروب TCP سریع (بدون احراز هویت) — «این اتصال اصلاً می‌شود وصل شد؟»
 *   - حالت ssh  → دسترسی به sshHost:sshPort سنجیده می‌شود (تونل از همان‌جا می‌گذرد)
 *   - حالت direct → دسترسی به host:port (خود MySQL)
 * پاسخ سه‌حالته: true وصل شد / false قطعاً وصل نمی‌شود / null نامعلوم
 * فقط false باعث بازشدن دوبارهٔ صفحهٔ اطلاعات هاست می‌شود — تا پروبِ مشکوک
 * باعث حلقهٔ ویزارد نشود.
 */
const REACHABLE_PROBE_TIMEOUT_MS = 3000;

function probeReachable(cfg) {
  return new Promise((resolve) => {
    if (!cfg || !cfg.active) return resolve(null);
    const host = cfg.sshMode ? cfg.sshHost : cfg.host;
    const port = parseInt(String(cfg.sshMode ? cfg.sshPort : cfg.port) || '', 10);
    if (!host || !port || port < 1 || port > 65535) return resolve(null);
    // در حالت ssh، host همیشه 127.0.0.1 (تونل محلی) است — نباید پروب شود؛
    // اما اگر خودِ sshHost لوکال باشد هم پروب معنادار نیست → null
    if (cfg.sshMode && /^(127\.0\.0\.1|localhost|::1)$/i.test(String(host))) return resolve(null);
    const socket = new net.Socket();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_e) { /* ignore */ }
      resolve(v);
    };
    const timer = setTimeout(() => done(false), REACHABLE_PROBE_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    try {
      socket.connect(port, host);
    } catch (_e) {
      done(false);
    }
  });
}

ipcMain.handle('db-connection:info', async () => {
  try {
    const candidates = configCandidates();
    if (!candidates.some((p) => fs.existsSync(p))) {
      writeConnectionFile(null);
      lastEnsureResult = { attempted: true, created: true, path: candidates[0], error: null };
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    lastEnsureResult = { attempted: true, created: false, path: null, error: msg };
  }
  const parsed = parseActiveOverride();
  const reachable = await probeReachable(parsed);
  return {
    ok: true,
    // مسیری که واقعاً از آن خوانده شد + مسیر دوست‌داشتنی برای نمایش به کاربر
    path: parsed.path || friendlyConfigPath(),
    friendlyPath: friendlyConfigPath(),
    // وضعیت واقعی فایل روی دیسک — «فایل db-connection.txt نیست» را در خود برنامه جواب می‌دهد
    friendlyFileExists: fs.existsSync(friendlyConfigPath()),
    fileExists: configCandidates().some((p) => fs.existsSync(p)),
    ensureError: lastEnsureResult && lastEnsureResult.error ? lastEnsureResult.error : null,
    appVersion: app.getVersion(),
    logPath: logFilePath(),
    active: parsed.active,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    user: parsed.user,
    // پسوردها برای پیش‌پرکردن فرم ویزارد — روی دیسک هم plaintext هستند و
    // همین فقط به رندرر خود برنامه برمی‌گردد (همان مرز اعتماد فایل)
    password: parsed.password,
    sshMode: parsed.sshMode,
    sshHost: parsed.sshHost,
    sshPort: parsed.sshPort,
    sshUser: parsed.sshUser,
    sshPassword: parsed.sshPassword,
    reachable,
    tunnelStatus: sshTunnelInstance ? sshTunnelInstance.status : null,
    tunnelLocalPort: sshTunnelInstance ? sshTunnelInstance.localPort : null,
  };
});

/* پاک‌سازی و نرمال‌سازی ورودی اتصال — مقاوم به خطاهای رایج تایپ */
function sanitizeHost(input) {
  return String(input || '')
    .trim()
    .replace(/^mysql:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .split(/[/:?]/)[0] // مسیر، پورت چسبیده (host:3306) و کوئری جدا می‌شود — پورت فیلد خودش را دارد
    .trim();
}

ipcMain.handle('db-connection:save', (_event, payload) => {
  const mode = String(payload && payload.mode ? payload.mode : 'direct').trim() === 'ssh' ? 'ssh' : 'direct';
  let host = sanitizeHost(payload && payload.host);
  const port = String(payload && payload.port ? payload.port : '').trim() || '3306';
  let database = String(payload && payload.database ? payload.database : '').split(/[/?]/)[0].trim();
  const user = String(payload && payload.user ? payload.user : '').trim();
  const password = String(payload && payload.password != null ? payload.password : '').trim();

  let sshHost = sanitizeHost(payload && payload.sshHost);
  const sshPort = String(payload && payload.sshPort ? payload.sshPort : '').trim() || '21098';
  const sshUser = String(payload && payload.sshUser ? payload.sshUser : '').trim();
  const sshPassword = String(payload && payload.sshPassword != null ? payload.sshPassword : '');

  if (mode === 'ssh') {
    // در حالت تونل: اتصال MySQL همیشه از داخل سرور (127.0.0.1) انجام می‌شود
    if (!sshHost || !sshUser || !database || !user) {
      return { ok: false, error: 'MISSING_FIELDS' };
    }
    if (sshPassword.length === 0) {
      return { ok: false, error: 'MISSING_SSH_PASSWORD' };
    }
    host = '127.0.0.1';
  } else if (!host || !database || !user) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${mode === 'ssh' ? SSH_TUNNEL_PORT : port}/${database}`;
  try {
    const lines = [url, `ssh-mode=${mode}`];
    if (mode === 'ssh') {
      lines.push(
        `ssh-host=${sshHost}`,
        `ssh-port=${sshPort}`,
        `ssh-user=${sshUser}`,
        `ssh-password=${sshPassword}`
      );
    }
    // در هر دو مسیر (C:\Users\<کاربر>\ManufacturingERP و %APPDATA%) نوشته می‌شود
    const cfgPath = writeConnectionContent(
      templateLines(url) + lines.join('\r\n') + '\r\n'
    );
    logLine(`db-connection.txt updated -> mode=${mode} ${mode === 'ssh' ? `ssh(${sshUser}@${sshHost}:${sshPort})` : `${host}:${port}`}/${database}`);
    return { ok: true, path: cfgPath, maskedUrl: maskUrl(url) };
  } catch (err) {
    logLine(`db-connection.txt write failed: ${err && err.message ? err.message : err}`);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/* تست سریع اتصال SSH — قبل از ذخیره، تا کاربر فوراً بداند مقادیر درست است */
ipcMain.handle('db-connection:test', async (_event, payload) => {
  if (!sshTunnelLib) return { ok: false, kind: 'NETWORK', error: 'ssh module not available in this build' };
  const sshHost = sanitizeHost(payload && payload.sshHost);
  const sshPort = String(payload && payload.sshPort ? payload.sshPort : '').trim() || '21098';
  const sshUser = String(payload && payload.sshUser ? payload.sshUser : '').trim();
  const sshPassword = String(payload && payload.sshPassword != null ? payload.sshPassword : '');
  if (!sshHost || !sshUser) return { ok: false, kind: 'FIELDS', error: 'MISSING_FIELDS' };
  try {
    const r = await sshTunnelLib.probeSsh(
      { sshHost, sshPort, sshUser, sshPassword },
      10000
    );
    logLine(`db-connection:test -> ${r.ok ? 'OK' : r.kind + ' ' + (r.error || '')}`);
    return r;
  } catch (err) {
    return { ok: false, kind: 'NETWORK', error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('db-connection:reset', () => {
  try {
    const cfgPath = writeConnectionFile(null);
    logLine('db-connection.txt reset -> local SQLite mode');
    return { ok: true, path: cfgPath };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('db-connection:openFolder', async () => {
  try {
    const result = await shell.openPath(app.getPath('userData'));
    return result ? { ok: false, error: result } : { ok: true, path: app.getPath('userData') };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// ساخت دستی فایل تنظیمات — اگر به هر دلیلی فایل روی C:\ نیست، با یک کلیک ساخته می‌شود
// (اگر فایل از قبل هست، هیچ‌وقت بازنویسی نمی‌شود تا تنظیمات کاربر پاک نشود)
ipcMain.handle('db-connection:createFile', async () => {
  try {
    const existing = configCandidates().find((p) => fs.existsSync(p));
    if (existing) return { ok: true, path: existing, existed: true };
    const p = writeConnectionFile(null);
    lastEnsureResult = { attempted: true, created: true, path: p, error: null };
    logLine(`db-connection template created on demand at ${p}`);
    return { ok: true, path: p, existed: false };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    lastEnsureResult = { attempted: true, created: false, path: null, error: msg };
    logLine(`db-connection create on demand failed: ${msg}`);
    return { ok: false, error: msg };
  }
});

/*
 * «باز کردن فایل تنظیمات» — فایل db-connection.txt در Explorer نشان داده می‌شود
 * (کاربر بدون جست‌وجوی پوشهٔ مخفی AppData مستقیم به فایل روی C:\ می‌رسد)
 */
ipcMain.handle('db-connection:showFile', async () => {
  try {
    const p = friendlyConfigPath();
    try {
      if (!fs.existsSync(p)) writeConnectionFile(null);
    } catch (_e) { /* اگر ساخته نشد هم مسیر پوشه باز می‌شود */ }
    shell.showItemInFolder(p);
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('app:relaunch', () => {
  logLine('relaunch requested from settings');
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

/* ----------------------------------------------------------------- window */

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'ManufacturingERP',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Quit' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ main */

async function main() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.setAppUserModelId('af.mfg.erp');
  setupMenu();

  migrateLegacyUserData();
  ensureTemplateFile();

  const dbPath = ensureDatabase();
  const cfg = parseActiveOverride();
  let dbOverride = cfg.active ? cfg.url : null;

  /*
   * حالت تونل SSH (هاست اشتراکی): اول تونل، بعد سرور.
   * DATABASE_URL از روی پورت واقعی تونل ساخته می‌شود (نه مقدار داخل فایل).
   * اگر SSH نیامد، برنامه با همان URL بالا می‌آید — لایهٔ failover موجود
   * (connection-manager) خودکار روی دیتابیس محلی می‌رود تا تونل وصل شود.
   */
  if (cfg.active && cfg.sshMode) {
    if (!sshTunnelLib) {
      logLine('ERROR: ssh-mode configured but ssh-tunnel module is missing — staying local until fixed');
    } else {
      try {
        sshTunnelInstance = new sshTunnelLib.SshTunnel({
          sshHost: cfg.sshHost,
          sshPort: cfg.sshPort || '21098',
          sshUser: cfg.sshUser,
          sshPassword: cfg.sshPassword || '',
          remoteHost: '127.0.0.1',
          remotePort: 3306, // MySQL روی سرور همیشه از داخل (127.0.0.1:3306) در دسترس است
          preferredLocalPort: SSH_TUNNEL_PORT,
          log: logLine,
        });
        const t = await sshTunnelInstance.start(25000);
        logLine(
          `ssh tunnel ${t.ok ? 'ready' : 'NOT ready (will keep retrying)'}: ` +
          `${cfg.sshUser}@${cfg.sshHost}:${cfg.sshPort} local=127.0.0.1:${t.localPort} ${t.error || ''}`
        );
        if (t.localPort) {
          dbOverride = sshTunnelInstance.localUrl(cfg.user, cfg.password || '', cfg.database);
        }
      } catch (e) {
        logLine(`ssh tunnel start failed: ${e && e.message ? e.message : e}`);
      }
    }
  }

  logLine(
    `starting ManufacturingERP v${app.getVersion()} (packaged=${isPackaged}) ` +
    `db=${dbOverride ? (cfg.sshMode ? 'host-mysql-via-ssh-tunnel (offline fallback: ' + dbPath + ')' : 'host-mysql (offline fallback: ' + dbPath + ')') : dbPath}`
  );

  const started = await startEmbeddedServer(dbPath, dbOverride);
  serverChild = started.child;
  serverPort = started.port;
  logLine(`embedded server ready on port ${serverPort}`);

  serverChild.on('exit', (code, signal) => {
    logLine(`ACTIVE server exited code=${code} signal=${signal}`);
    serverChild = null;
    if (!quitting) {
      dialog.showErrorBox(
        'ManufacturingERP — server stopped',
        'The embedded application server exited unexpectedly and the app will now close.\n\n' +
          `Details: ${logFilePath()}`
      );
      app.quit();
    }
  });

  createWindow(serverPort);
}

app.whenReady().then(main).catch((err) => {
  logLine(`fatal startup error: ${err && err.stack ? err.stack : err}`);
  try {
    dialog.showErrorBox(
      'ManufacturingERP — failed to start',
      `The application could not start.\n\n${err ? err.message : String(err)}\n\nLog: ${logFilePath()}`
    );
  } catch (_e) { /* ignore */ }
  app.exit(1);
});

/* ------------------------------------------------------------- lifecycle */

app.on('window-all-closed', () => {
  if (serverChild) {
    try { serverChild.kill(); } catch (_e) { /* ignore */ }
    serverChild = null;
  }
  if (sshTunnelInstance) {
    void sshTunnelInstance.stop();
    sshTunnelInstance = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (serverChild) {
    try { serverChild.kill(); } catch (_e) { /* ignore */ }
  }
  if (sshTunnelInstance) {
    void sshTunnelInstance.stop();
    sshTunnelInstance = null;
  }
});

app.on('quit', () => {
  quitting = true;
  if (serverChild) {
    try { serverChild.kill(); } catch (_e) { /* ignore */ }
  }
});

/*
 * export برای تست‌پذیری (الکترون main بودن این فایل را تحت تأثیر نمی‌گذارد):
 * فرمت db-connection.txt باید بین save() و parseActiveOverride() round-trip شود
 */
module.exports = { parseActiveOverride, templateLines, sanitizeHost };
