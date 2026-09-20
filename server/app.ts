import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { Store } from './store.ts';
import type { PublicUser } from '../src/shared/api.ts';
import { LEVELS } from '../src/core/content.ts';
import { databasePage, isLoopbackAddress } from './admin.ts';

const adminScript = readFileSync(new URL('./admin-client.js', import.meta.url), 'utf8');

const SESSION_SECONDS = 60 * 60 * 24 * 7;
const digest = (token: string): string => createHash('sha256').update(token).digest('hex');
const passwordHash = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
  );
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
function tokenOf(req: IncomingMessage): string | null {
  const match = req.headers.cookie?.match(/(?:^|;\s*)fg_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] ?? null;
}
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new HttpError(415, '请求必须使用 JSON');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 8192) throw new HttpError(413, '请求内容过长');
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, '请求格式不正确');
  }
}
function credentials(body: Record<string, unknown>): { username: string; password: string } {
  if (typeof body.username !== 'string' || typeof body.password !== 'string')
    throw new HttpError(400, '请填写用户名和密码');
  return { username: validateUsername(body.username), password: validatePassword(body.password) };
}
function validateUsername(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, '请填写用户名');
  const username = value.normalize('NFKC').trim();
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(username))
    throw new HttpError(400, '用户名需为 2–20 个汉字、字母、数字、下划线或短横线');
  return username;
}
function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw new HttpError(400, '密码长度需为 8–128 个字符');
  return password;
}
function progressValues(body: Record<string, unknown>) {
  const { level, stars, seconds } = body;
  if (
    typeof level !== 'number' ||
    !Number.isInteger(level) ||
    !LEVELS.some((entry) => entry.id === level) ||
    typeof stars !== 'number' ||
    !Number.isInteger(stars) ||
    stars < 1 ||
    stars > 3 ||
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > 86400
  )
    throw new HttpError(400, '关卡成绩格式不正确');
  return { level, stars, seconds };
}
export interface AppOptions {
  database: string;
  publicDir: string;
  secureCookies?: boolean;
  allowDevOrigin?: boolean;
}
export function createApp(options: AppOptions) {
  const store = new Store(options.database),
    publicDir = resolve(options.publicDir),
    adminToken = randomBytes(32).toString('hex');
  function requireLocalAdmin(req: IncomingMessage): void {
    const address = server.address(),
      expectedHosts = ['127.0.0.1', 'localhost', '[::1]'].map(
        (host) => `${host}${req.socket.localPort === 80 ? '' : `:${req.socket.localPort}`}`,
      );
    if (
      !address ||
      typeof address === 'string' ||
      !isLoopbackAddress(address.address) ||
      !isLoopbackAddress(req.socket.remoteAddress) ||
      !expectedHosts.includes(req.headers.host ?? '') ||
      req.headers.forwarded ||
      Object.keys(req.headers).some((name) => name.startsWith('x-forwarded-')) ||
      (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new HttpError(403, '管理页面仅允许在本机监听模式下直接从本机访问');
    }
  }
  const limits = new Map<string, { count: number; expires: number }>();
  function limit(req: IncomingMessage, action: string): void {
    const now = Date.now();
    for (const [key, value] of limits) if (value.expires < now) limits.delete(key);
    const key = `${req.socket.remoteAddress}:${action}`,
      value = limits.get(key) ?? { count: 0, expires: now + 60_000 };
    value.count++;
    limits.set(key, value);
    if (value.count > 15) throw new HttpError(429, '尝试次数较多，请一分钟后再试');
  }
  function requireUser(req: IncomingMessage): PublicUser {
    const token = tokenOf(req),
      user = token ? store.session(digest(token)) : undefined;
    if (!user) throw new HttpError(401, '登录已过期，请重新登录');
    return user;
  }
  function setSession(res: ServerResponse, user: PublicUser): void {
    const token = randomBytes(32).toString('hex');
    store.createSession(digest(token), user.id, Date.now() + SESSION_SECONDS * 1000);
    res.setHeader(
      'Set-Cookie',
      `fg_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${options.secureCookies ? '; Secure' : ''}`,
    );
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url ?? '/', 'http://localhost'),
      pathname = url.pathname,
      method = req.method ?? 'GET';
    if (pathname === '/database' || pathname === '/database.js') {
      requireLocalAdmin(req);
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '不支持的请求方式');
      const html =
        pathname === '/database' ? databasePage(store, url.searchParams, adminToken) : adminScript;
      res.writeHead(200, {
        'Content-Type':
          pathname === '/database' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(method === 'HEAD' ? undefined : html);
      return;
    }
    if (pathname.startsWith('/api/admin/')) {
      requireLocalAdmin(req);
      if (method !== 'POST') throw new HttpError(405, '不支持的请求方式');
      if (
        req.headers.origin !== `http://${req.headers.host}` ||
        req.headers['x-admin-token'] !== adminToken
      )
        throw new HttpError(403, '管理请求校验失败，请刷新管理页面重试');
      const match = pathname.match(
        /^\/api\/admin\/users\/([1-9]\d*)\/(rename|password|logout|progress|reset-progress|delete)$/,
      );
      if (!match) throw new HttpError(404, '没有找到这个管理操作');
      const userId = Number(match[1]),
        action = match[2],
        body = await bodyOf(req),
        user = store.userById(userId);
      if (!user) throw new HttpError(404, '用户不存在，请刷新列表');
      if (
        (action === 'delete' || action === 'reset-progress') &&
        body.confirmUsername !== user.username
      )
        throw new HttpError(400, '请输入该用户的完整用户名确认操作');
      if (action === 'rename') {
        const username = validateUsername(body.username),
          existing = store.userByName(username);
        if (existing && existing.id !== userId)
          throw new HttpError(409, '这个用户名已经有人使用了');
        store.renameUser(userId, username);
      } else if (action === 'password') {
        const password = validatePassword(body.password),
          previous = store.userByName(user.username)!,
          salt = randomBytes(16).toString('hex'),
          hash = (await passwordHash(password, salt)).toString('hex'),
          current = store.userByName(user.username);
        if (!current || current.id !== userId || current.password_hash !== previous.password_hash)
          throw new HttpError(409, '用户资料已变化，请刷新后重试');
        store.resetPassword(userId, hash, salt);
      } else if (action === 'logout') store.revokeSessions(userId);
      else if (action === 'progress') {
        const { level, stars, seconds } = progressValues(body);
        store.setProgress(userId, level, stars, seconds);
      } else if (action === 'reset-progress') store.resetProgress(userId);
      else if (action === 'delete') store.deleteUser(userId);
      json(res, 200, { ok: true });
      return;
    }
    if (pathname.startsWith('/api/')) {
      if (method !== 'GET') {
        const origin = req.headers.origin,
          allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`]);
        if (options.allowDevOrigin) {
          allowed.add('http://127.0.0.1:5173');
          allowed.add('http://localhost:5173');
        }
        if (origin && !allowed.has(origin)) throw new HttpError(403, '请求来源不受信任');
      }
      if (pathname === '/api/health' && method === 'GET') {
        json(res, 200, { ok: true, version: '0.1.0' });
        return;
      }
      if (pathname === '/api/session' && method === 'GET') {
        const token = tokenOf(req),
          user = token ? store.session(digest(token)) : undefined;
        json(res, 200, { user: user ?? null, progress: user ? store.progress(user.id) : [] });
        return;
      }
      if (pathname === '/api/register' && method === 'POST') {
        limit(req, 'register');
        const { username, password } = credentials(await bodyOf(req));
        if (store.userByName(username)) throw new HttpError(409, '这个用户名已经有人使用了');
        const salt = randomBytes(16).toString('hex'),
          hash = (await passwordHash(password, salt)).toString('hex');
        let user: PublicUser;
        try {
          user = store.addUser(username, hash, salt);
        } catch (error) {
          if (error instanceof Error && error.message.includes('UNIQUE'))
            throw new HttpError(409, '这个用户名已经有人使用了');
          throw error;
        }
        setSession(res, user);
        json(res, 201, { user, progress: [] });
        return;
      }
      if (pathname === '/api/login' && method === 'POST') {
        limit(req, 'login');
        const { username, password } = credentials(await bodyOf(req)),
          record = store.userByName(username);
        // Perform the same expensive operation even for an unknown username.
        const candidate = await passwordHash(
          password,
          record?.salt ?? '00000000000000000000000000000000',
        );
        const expected = Buffer.from(record?.password_hash ?? '00'.repeat(64), 'hex');
        const current = store.userByName(username);
        if (
          !record ||
          current?.id !== record.id ||
          current.password_hash !== record.password_hash ||
          candidate.length !== expected.length ||
          !timingSafeEqual(candidate, expected)
        )
          throw new HttpError(401, '用户名或密码不正确');
        const user = {
          id: current.id,
          username: current.username,
          progressRevision: current.progressRevision,
        };
        setSession(res, user);
        json(res, 200, { user, progress: store.progress(user.id) });
        return;
      }
      if (pathname === '/api/logout' && method === 'POST') {
        const token = tokenOf(req);
        if (token) store.logout(digest(token));
        res.setHeader('Set-Cookie', 'fg_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        json(res, 200, { ok: true });
        return;
      }
      if (pathname === '/api/progress/complete' && method === 'POST') {
        const body = await bodyOf(req),
          user = requireUser(req),
          { level, stars, seconds } = progressValues(body);
        if (body.userId !== user.id || body.progressRevision !== user.progressRevision)
          throw new HttpError(409, '账号或进度已变化，这份旧成绩已作废，请重新登录后挑战');
        const progress = store.progress(user.id),
          unlocked = Math.min(LEVELS.length, Math.max(0, ...progress.map((p) => p.level)) + 1);
        if (level > unlocked) throw new HttpError(403, '请先完成前面的关卡');
        json(res, 200, { progress: store.complete(user.id, level, stars, seconds) });
        return;
      }
      throw new HttpError(404, '没有找到这个接口');
    }
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '不支持的请求方式');
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, '地址格式不正确');
    }
    const file = resolve(publicDir, `.${decoded === '/' ? '/index.html' : decoded}`);
    if (!file.startsWith(publicDir + sep) || decoded.includes('\0'))
      throw new HttpError(403, '不能访问这个路径');
    let info;
    try {
      info = await stat(file);
    } catch {
      throw new HttpError(404, '页面不存在；请先运行 npm run build');
    }
    if (!info.isFile()) throw new HttpError(404, '文件不存在');
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
      '.woff2': 'font/woff2',
    };
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      // Only Vite's fingerprinted bundles are immutable; public images keep fixed names.
      'Cache-Control': /^\/assets\/[^/]+-[\w-]{8}\.(?:js|css)$/.test(decoded)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else {
        console.error('[server]', error);
        json(res, 500, { error: '服务器暂时无法处理请求，请稍后重试' });
      }
    });
  });
  return { server, store };
}
