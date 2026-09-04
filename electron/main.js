/*
 * Electron main process — ManufacturingERP desktop distribution.
 *
 * Boots an embedded Next.js standalone server as a child process (Electron
 * binary run as plain Node via ELECTRON_RUN_AS_NODE=1) and shows it inside a
 * BrowserWindow. All server data (SQLite via Prisma) lives in a writable
 * per-user data directory: %APPDATA%/ManufacturingERP/data/custom.db
 */
const { app, BrowserWindow, Menu, dialog } = require('electron');
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

function startServerOnPort(port, dbPath) {
  return new Promise((resolve, reject) => {
    const dbPathPosix = dbPath.replace(/\\/g, '/'); // Prisma needs forward slashes on Windows
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: 'file:' + dbPathPosix,
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

async function startEmbeddedServer(dbPath) {
  let lastErr = null;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = BASE_PORT + i;
    try {
      const child = await startServerOnPort(port, dbPath);
      return { child, port };
    } catch (e) {
      lastErr = e;
      logLine(`port ${port} attempt failed: ${e.message}`);
    }
  }
  throw lastErr || new Error('could not start embedded server');
}

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

  const dbPath = ensureDatabase();
  logLine(`starting ManufacturingERP (packaged=${isPackaged}) db=${dbPath}`);

  const started = await startEmbeddedServer(dbPath);
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
