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
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_PORT = 37815;
const MAX_PORT_ATTEMPTS = 21; // 37815 .. 37835
const READY_TIMEOUT_MS = 90000; // poll up to 90s per port
const POLL_INTERVAL_MS = 500;

const isPackaged = app.isPackaged;
const SERVER_DIR = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', '.next-electron', 'standalone');

let serverChild = null;
let serverPort = null;
let mainWindow = null;
let quitting = false;

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
 * اتصال سفارشی دیتابیس — فایل db-connection.txt در پوشه data کاربر
 * اگر اولین خط غیر کامنت با mysql:// شروع شود، دیتا در هاست اشتراکی ذخیره می‌شود
 * وگرنه حالت پیش‌فرض (SQLite محلی) استفاده می‌گردد
 * از نسخه ۱.۰.۳ به بعد، تنظیمات ماژول می‌تواند همین فایل را از داخل برنامه بنویسد (IPC)
 */
function connectionConfigPath() {
  return path.join(app.getPath('userData'), 'db-connection.txt');
}

function templateLines(activeUrl) {
  const lines = [
    '# فایل تنظیم اتصال دیتابیس — ManufacturingERP',
    '#',
    '# حالت پیش‌فرض: دیتابیس محلی (SQLite) — همین فایل را دست‌نخورده رها کنید',
    '#',
    '# برای ذخیره دیتا در هاست اشتراکی (MySQL):',
    '#   ۱) در cPanel هاست: MySQL Databases → ساخت دیتابیس و کاربر',
    '#   ۲) در cPanel: Remote MySQL → افزودن IP دستگاه یا علامت %',
    '#   ۳) خط mysql:// زیر را ویرایش کنید (اگر # ابتدای آن هست حذف کنید)',
    '#   ۴) برنامه را ببندید و دوباره باز کنید',
    '#',
  ];
  lines.push(activeUrl ? activeUrl : '# mysql://DBUSER:PASSWORD@HOST_ADDRESS:3306/DBNAME');
  lines.push('');
  return lines.join('\r\n');
}

function writeConnectionFile(activeUrl) {
  const cfgPath = connectionConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, templateLines(activeUrl), 'utf8');
  return cfgPath;
}

function maskUrl(url) {
  return String(url).replace(/:(?:[^:@/]*)@/, ':***@');
}

function parseActiveOverride() {
  const out = { active: false, url: null, host: null, port: '3306', database: null, user: null };
  try {
    const lines = fs.readFileSync(connectionConfigPath(), 'utf8').split(/\r?\n/);
    const value = lines.map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (value && value.startsWith('mysql://')) {
      out.active = true;
      out.url = value;
      try {
        const u = new URL(value);
        out.host = u.hostname;
        out.port = u.port || '3306';
        out.database = u.pathname.replace(/^\//, '');
        out.user = decodeURIComponent(u.username || '');
      } catch (_e) {
        /* URL ناقص — فقط حالت فعال گزارش می‌شود */
      }
    }
  } catch (_e) {
    /* فایل خوانده نشد — حالت محلی */
  }
  return out;
}

function databaseUrlOverride() {
  try {
    if (!fs.existsSync(connectionConfigPath())) {
      // ساخت فایل راهنما در اولین اجرا — کاربر فقط یک خط را ویرایش می‌کند
      writeConnectionFile(null);
      return null;
    }
  } catch (_e) {
    /* نوشتن ناموفق — حالت محلی */
  }
  const parsed = parseActiveOverride();
  return parsed.active ? parsed.url : null;
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

function ensureDatabase() {
  // حالت هاست MySQL: فایل محلی لازم نیست
  if (databaseUrlOverride()) return null;

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
      logLine(`demo database copied to ${dbPath}`);
    } else {
      logLine(`WARN: demo database not found at ${src} — starting with empty db file`);
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
ipcMain.handle('db-connection:info', () => {
  try {
    if (!fs.existsSync(connectionConfigPath())) writeConnectionFile(null);
  } catch (_e) {
    /* ignore */
  }
  const parsed = parseActiveOverride();
  return {
    ok: true,
    path: connectionConfigPath(),
    active: parsed.active,
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    user: parsed.user,
  };
});

ipcMain.handle('db-connection:save', (_event, payload) => {
  const host = String(payload && payload.host ? payload.host : '').trim();
  const port = String(payload && payload.port ? payload.port : '').trim() || '3306';
  const database = String(payload && payload.database ? payload.database : '').trim();
  const user = String(payload && payload.user ? payload.user : '').trim();
  const password = String(payload && payload.password != null ? payload.password : '');
  if (!host || !database || !user) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }
  const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  try {
    const cfgPath = writeConnectionFile(url);
    logLine(`db-connection.txt updated -> host mode (${host}:${port}/${database})`);
    return { ok: true, path: cfgPath, maskedUrl: maskUrl(url) };
  } catch (err) {
    logLine(`db-connection.txt write failed: ${err && err.message ? err.message : err}`);
    return { ok: false, error: String(err && err.message ? err.message : err) };
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

  const dbPath = ensureDatabase();
  const dbOverride = databaseUrlOverride();
  logLine(
    `starting ManufacturingERP (packaged=${isPackaged}) db=${
      dbOverride ? 'host-mysql' : dbPath
    }`
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
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (serverChild) {
    try { serverChild.kill(); } catch (_e) { /* ignore */ }
  }
});

app.on('quit', () => {
  quitting = true;
  if (serverChild) {
    try { serverChild.kill(); } catch (_e) { /* ignore */ }
  }
});
