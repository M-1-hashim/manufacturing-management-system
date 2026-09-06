'use strict';

/*
 * مدیر تونل SSH — برای هاست‌های اشتراکی (Namecheap / cPanel) که اتصال مستقیم
 * MySQL از بیرون روی آن‌ها کاملاً غیرفعال است و تنها راه رسمی، تونل SSH است:
 *   ssh -p 21098 user@serverXXX.web-hosting.com -L 5522:127.0.0.1:3306 -N
 *
 * این ماژول «خالص Node» است (فقط به ssh2 وابسته است، نه electron) تا:
 *   ۱) هم در main.js الکترون اجرا شود
 *   ۲) هم بدون الکترون قابل تست باشد (سرور SSH ساختگی با خود ssh2 در تست‌ها)
 *
 * رفتار:
 *  - start(): اول پورت محلی آزاد انتخاب می‌کند، بعد وصل می‌شود؛ هرگز more از
 *    timeout لازم نمی‌کند — اگر SSH نیامد، برنامه با همان DATABASE_URL بالا
 *    می‌آید و لایهٔ failover موجود (connection-manager) روی دیتابیس محلی کار
 *    می‌کند؛ تونل در پس‌زمینه با backoff دوباره تلاش می‌کند.
 *  - قطع شدن: رویداد close → حالت reconnecting → تلاش مجدد (۱s → ۲s → ۵s → ۱۰s → ۱۵s…)
 *  - stop(): همهٔ تایمرها/سوکت‌ها بسته می‌شوند.
 */

const net = require('net');
const { Client } = require('ssh2');

const KEEPALIVE_INTERVAL_MS = 15000;
const KEEPALIVE_COUNT_MAX = 3;
const RECONNECT_STEPS_MS = [1000, 2000, 5000, 10000, 15000];
const CONNECT_TIMEOUT_MS = 15000;

/** اولین پورت آزاد از start به بعد (روی 127.0.0.1) — null اگر هیچ‌کدام */
function pickFreePort(start, attempts = 20) {
  return new Promise((resolve) => {
    let port = start;
    let done = false;
    const tryNext = () => {
      if (done) return;
      if (port >= start + attempts) {
        done = true;
        resolve(null);
        return;
      }
      const srv = net.createServer();
      const onErr = () => {
        srv.close();
        cleanup();
        port += 1;
        setImmediate(tryNext);
      };
      const onOk = () => {
        cleanup();
        srv.close(() => {
          if (done) return;
          done = true;
          resolve(port);
        });
      };
      const cleanup = () => {
        srv.removeListener('error', onErr);
        srv.removeListener('listening', onOk);
      };
      srv.once('error', onErr);
      srv.once('listening', onOk);
      srv.listen(port, '127.0.0.1');
    };
    tryNext();
  });
}

/** یک اتصال SSH یک‌باره فقط برای «تست» — ok یا kind مشخص */
function probeSsh(cfg, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch (_e) { /* ignore */ }
      resolve(res);
    };
    const timer = setTimeout(() => finish({ ok: false, kind: 'TIMEOUT', error: `no response within ${timeoutMs}ms` }), timeoutMs);
    conn.on('error', (err) => {
      clearTimeout(timer);
      const msg = String((err && err.message) || err);
      const level = String((err && err.level) || '');
      const authy =
        level === 'client-authentication' ||
        /all configured authentication methods failed|authenticat|password|denied/i.test(msg);
      finish({ ok: false, kind: authy ? 'AUTH' : 'NETWORK', error: msg });
    });
    conn.on('ready', () => {
      clearTimeout(timer);
      finish({ ok: true });
    });
    try {
      conn.connect({
        host: cfg.sshHost,
        port: Number(cfg.sshPort) || 21098,
        username: cfg.sshUser,
        password: cfg.sshPassword,
        readyTimeout: timeoutMs,
        keepaliveInterval: 0,
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, kind: 'NETWORK', error: String((e && e.message) || e) });
    }
  });
}

class SshTunnel {
  /**
   * cfg: { sshHost, sshPort, sshUser, sshPassword,
   *        remoteHost='127.0.0.1', remotePort=3306,
   *        preferredLocalPort=5522, log=console }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.log = cfg.log || (() => {});
    this.remoteHost = cfg.remoteHost || '127.0.0.1';
    this.remotePort = cfg.remotePort || 3306;
    this.status = 'stopped'; // stopped | connecting | online | reconnecting | error
    this.lastError = null;
    this.localPort = null;
    this.conn = null;
    this.server = null;
    this.stopping = false;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this._onStatusChange = null;
  }

  onStatusChange(fn) {
    this._onStatusChange = fn;
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.log(`[ssh-tunnel] status -> ${s}${this.lastError ? ' (' + this.lastError + ')' : ''}`);
    try { this._onStatusChange && this._onStatusChange(s); } catch (_e) { /* ignore */ }
  }

  /** سرور TCP محلی — همهٔ اتصال‌ها به داخل تونل فوروارد می‌شوند */
  async _startLocalServer() {
    if (this.server) return;
    const preferred = Number(this.cfg.preferredLocalPort) || 5522;
    const port = await pickFreePort(preferred, 20);
    if (!port) throw new Error(`no free local port in ${preferred}..${preferred + 19}`);
    this.localPort = port;

    this.server = net.createServer((sock) => {
      if (!this.conn || !this._ready) {
        sock.destroy();
        return;
      }
      const remote = sock.remoteAddress || '127.0.0.1';
      const remoteP = sock.remotePort || 0;
      this.conn.forwardOut(remote, remoteP, this.remoteHost, this.remotePort, (err, stream) => {
        if (err || !stream) {
          this.log(`[ssh-tunnel] forwardOut failed: ${err && err.message ? err.message : err}`);
          sock.destroy();
          return;
        }
        stream.on('error', () => sock.destroy());
        sock.on('error', () => stream.destroy());
        sock.pipe(stream);
        stream.pipe(sock);
      });
      sock.on('error', () => { /* کلاینت خودش قطع شده — بی‌اهمیت */ });
    });
    await new Promise((resolve, reject) => {
      const onErr = (e) => { this.server = null; reject(e); };
      this.server.once('error', onErr);
      this.server.listen(this.localPort, '127.0.0.1', () => {
        this.server.removeListener('error', onErr);
        resolve();
      });
    });
    this.log(`[ssh-tunnel] local listener on 127.0.0.1:${this.localPort} -> ${this.remoteHost}:${this.remotePort}`);
  }

  _connect() {
    if (this.stopping) return;
    this._ready = false;
    this._setStatus(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    const conn = new Client();
    this.conn = conn;

    conn.on('error', (err) => {
      this.lastError = String((err && err.message) || err);
    });

    conn.on('ready', () => {
      this._ready = true;
      this.reconnectAttempt = 0;
      this.lastError = null;
      this._setStatus('online');
      this.log(`[ssh-tunnel] ready: ${this.cfg.sshUser}@${this.cfg.sshHost}:${this.cfg.sshPort}`);
    });

    conn.on('close', () => {
      this._ready = false;
      if (this.stopping) {
        this._setStatus('stopped');
        return;
      }
      // قطع شده — با backoff وصل شو
      const delay = RECONNECT_STEPS_MS[Math.min(this.reconnectAttempt, RECONNECT_STEPS_MS.length - 1)];
      this.reconnectAttempt += 1;
      this._setStatus('reconnecting');
      this.log(`[ssh-tunnel] connection closed — retry in ${delay}ms`);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this._connect(), delay);
    });

    try {
      conn.connect({
        host: this.cfg.sshHost,
        port: Number(this.cfg.sshPort) || 21098,
        username: this.cfg.sshUser,
        password: this.cfg.sshPassword,
        readyTimeout: CONNECT_TIMEOUT_MS,
        keepaliveInterval: KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: KEEPALIVE_COUNT_MAX,
      });
    } catch (e) {
      this.lastError = String((e && e.message) || e);
      conn.emit('close');
    }
  }

  /**
   * شروع تونل. هرگز بیش از timeoutMs طول نمی‌کشد — حتی اگر SSH نیامد
   * ({ok:false}) برمی‌گردد تا برنامه بالا بیاید (failover محلی خودش کار می‌کند).
   */
  async start(timeoutMs = 25000) {
    if (this.status !== 'stopped' && this.status !== 'error') {
      return { ok: this.status === 'online', localPort: this.localPort, error: this.lastError };
    }
    this.stopping = false;
    this.reconnectAttempt = 0;
    try {
      await this._startLocalServer();
    } catch (e) {
      this.lastError = String((e && e.message) || e);
      this._setStatus('error');
      return { ok: false, localPort: null, error: this.lastError };
    }
    this._connect();

    // منتظر اولین اتصال موفق — با سقف زمانی
    const started = Date.now();
    while ((this.status !== 'online') && Date.now() - started < timeoutMs && !this.stopping) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (this.status === 'online') return { ok: true, localPort: this.localPort, error: null };
    return { ok: false, localPort: this.localPort, error: this.lastError || `not online within ${timeoutMs}ms (still retrying)` };
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.conn) {
      try { this.conn.end(); } catch (_e) { /* ignore */ }
      this.conn = null;
    }
    if (this.server) {
      await new Promise((r) => {
        const guard = setTimeout(r, 800);
        try {
          this.server.close(() => { clearTimeout(guard); r(); });
        } catch (_e) {
          clearTimeout(guard);
          r();
        }
      });
      this.server = null;
    }
    this._setStatus('stopped');
  }

  /** آدرس mysql:// روی دستگاه — null اگر پورت محلی هنوز مشخص نیست */
  localUrl(user, password, database) {
    if (!this.localPort) return null;
    return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${this.localPort}/${database}`;
  }
}

module.exports = { SshTunnel, probeSsh, pickFreePort };
