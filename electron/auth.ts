import { safeStorage, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import type { ConnectionStatus, Model } from '../src/types';
interface Account {
  clientId: string;
  subject: string;
  email?: string;
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
}
interface Secrets {
  account?: Account;
  key?: string; // Legacy OpenAI key, never used for DeepSeek.
  deepseekKey?: string;
  clientId?: string;
  mode: 'chatgpt' | 'api';
}
const authBase = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const random = () => randomBytes(32).toString('base64url');
export class Connection {
  private secrets: Secrets = { mode: 'chatgpt' };
  private server?: Server;
  private pendingReject?: (e: Error) => void;
  private file: string;
  private host: string;
  private refreshing?: Promise<string>;
  private loginController?: AbortController;
  private loginMessage = '';
  constructor(
    dir: string,
    public request: typeof fetch = (...args) => fetch(...args),
    private changed: (status: ConnectionStatus) => void = () => {},
  ) {
    this.file = path.join(dir, 'credentials.enc');
    const hostFile = path.join(dir, 'host-id');
    this.host = existsSync(hostFile) ? readFileSync(hostFile, 'utf8') : 'urn:uuid:' + randomUUID();
    if (!existsSync(hostFile)) writeFileSync(hostFile, this.host);
    if (existsSync(this.file)) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('Windows 凭据保护不可用，无法读取已保存的账户');
      this.secrets = JSON.parse(safeStorage.decryptString(readFileSync(this.file)));
    }
  }
  private save(next: Secrets) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据保护不可用，未保存凭据');
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(next)));
    renameSync(tmp, this.file);
    this.secrets = next;
  }
  status(): ConnectionStatus {
    const a = this.secrets.account;
    return {
      mode: this.secrets.mode,
      signedIn: !!a,
      planEnabled: !!a?.scopes.includes('chatgpt.tokens.use.direct'),
      email: a?.email,
      hasKey: !!this.secrets.deepseekKey,
      loginMessage: this.loginMessage,
    };
  }
  configure(mode: 'api' | 'chatgpt', key?: string) {
    if (!['api', 'chatgpt'].includes(mode)) throw new Error('无效连接方式');
    this.save({ ...this.secrets, mode, ...(key?.trim() ? { deepseekKey: key.trim(), key: undefined } : {}) });
    return this.status();
  }
  private progress(message: string) {
    this.loginMessage = message;
    this.changed(this.status());
  }
  cancelLogin() {
    this.loginController?.abort();
    this.pendingReject?.(new Error('已取消登录'));
    this.pendingReject = undefined;
    this.server?.close();
    this.server = undefined;
  }
  async login() {
    this.cancelLogin();
    const controller = new AbortController();
    this.loginController = controller;
    this.progress('正在打开浏览器，等待 ChatGPT 授权…');
    const state = random(),
      nonce = random(),
      verifier = random();
    const previous = this.secrets.account;
    let clientId = previous?.clientId || this.secrets.clientId;
    const server = createServer();
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('无法启动登录回调');
    const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
    const callback = new Promise<URL>((resolve, reject) => {
      this.pendingReject = reject;
      server.on('request', (req, res) => {
        const url = new URL(req.url || '/', redirect);
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400);
          res.end('Invalid state');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'",
        });
        res.end(
          '<h2>授权回调已收到，软件正在交换令牌和验证身份。请返回软件查看最终连接结果；此页面不代表连接成功。</h2>',
        );
        resolve(url);
      });
    });
    const timer = setTimeout(() => this.cancelLogin(), 180_000);
    try {
      const url = new URL(authBase + '/api/accounts/authorize');
      const params: Record<string, string> = {
        client_id: clientId || 'dynamic_agent_client',
        ext_agent_host_id: this.host,
        response_type: 'code',
        redirect_uri: redirect,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        resource,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      };
      if (!clientId) params.agent_name_hint = 'AI 读书助手';
      if (previous) {
        params.id_token_hint = previous.idToken;
        if (previous.email) params.login_hint = previous.email;
      }
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      // Attach rejection handling before opening a browser (which can itself fail).
      const result = await Promise.all([callback, shell.openExternal(url.toString())]).then(
        ([result]) => result,
      );
      if (result.searchParams.has('error'))
        throw new Error('ChatGPT 授权未完成：' + result.searchParams.get('error'));
      controller.signal.throwIfAborted();
      this.progress('浏览器回调已收到，正在交换授权令牌…');
      const issued = result.searchParams.get('client_id');
      if (clientId && issued && issued !== clientId) throw new Error('授权返回的应用身份不一致');
      clientId = clientId || issued || undefined;
      if (!clientId || clientId === 'dynamic_agent_client') throw new Error('注册未返回有效应用 ID');
      this.save({ ...this.secrets, clientId });
      const code = result.searchParams.get('code');
      if (!code) throw new Error('授权未返回 code');
      const data = await this.token(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
          resource,
        },
        controller.signal,
      );
      this.progress('正在验证账户身份与套餐授权…');
      const discovery = await this.request(authBase + '/.well-known/openid-configuration', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      }).then((r) => r.json());
      if (
        discovery.issuer !== authBase ||
        typeof discovery.jwks_uri !== 'string' ||
        new URL(discovery.jwks_uri).origin !== authBase
      )
        throw new Error('登录验证配置无效');
      const { payload } = await jwtVerify(
        data.id_token,
        createRemoteJWKSet(new URL(discovery.jwks_uri), {
          [customFetch]: (url, init) =>
            this.request(url.toString(), {
              ...init,
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
            }),
        }),
        {
          issuer: authBase,
          audience: clientId,
        },
      );
      if (payload.nonce !== nonce || !payload.sub) throw new Error('登录身份校验失败');
      if (previous && payload.sub !== previous.subject) throw new Error('账户不一致，请先退出原账户再连接');
      const account: Account = {
        clientId,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        idToken: data.id_token,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
        scopes: String(data.scope || '').split(' '),
      };
      controller.signal.throwIfAborted();
      this.save({ ...this.secrets, account, mode: 'chatgpt' });
      this.progress(
        account.scopes.includes('chatgpt.tokens.use.direct')
          ? '连接成功，ChatGPT 套餐使用已授权'
          : '账户已登录，但未授予套餐使用权限，请重新授权',
      );
      return this.status();
    } catch (error) {
      const message = controller.signal.aborted
        ? '登录已取消或超时，请重新连接'
        : this.loginMessage + ' 失败：' + (error instanceof Error ? error.message : '未知错误');
      if (this.loginController === controller) this.progress(message);
      throw new Error(message);
    } finally {
      if (this.loginController === controller) this.loginController = undefined;
      clearTimeout(timer);
      server.close();
      if (this.server === server) {
        this.server = undefined;
        this.pendingReject = undefined;
      }
    }
  }
  private async token(params: Record<string, string>, signal?: AbortSignal) {
    const res = await this.request(authBase + '/api/accounts/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`ChatGPT 授权失效或交换失败（${res.status}），请重新登录`);
    return res.json();
  }
  async credential(): Promise<string> {
    if (this.secrets.mode === 'api') {
      if (!this.secrets.deepseekKey) throw new Error('请先配置 DeepSeek API Key（独立计费）');
      return this.secrets.deepseekKey;
    }
    const a = this.secrets.account;
    if (!a) throw new Error('请先使用 ChatGPT 登录');
    if (!a.scopes.includes('chatgpt.tokens.use.direct')) throw new Error('已登录，但未授权使用 ChatGPT 套餐');
    if (a.expiresAt > Date.now() + 60000) return a.accessToken;
    if (!a.refreshToken) throw new Error('登录已过期，请重新登录');
    if (!this.refreshing)
      this.refreshing = (async () => {
        const d = await this.token({
          grant_type: 'refresh_token',
          client_id: a.clientId,
          refresh_token: a.refreshToken!,
          resource,
        });
        const next = {
          ...a,
          accessToken: d.access_token,
          refreshToken: d.refresh_token || a.refreshToken,
          expiresAt: Date.now() + Number(d.expires_in || 3600) * 1000,
          scopes: d.scope ? String(d.scope).split(' ') : a.scopes,
        };
        this.save({ ...this.secrets, account: next });
        return next.accessToken;
      })().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  async models(): Promise<Model[]> {
    const token = await this.credential();
    const res = await this.request(
      (this.secrets.mode === 'api' ? 'https://api.deepseek.com' : resource) + '/models',
      {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) throw new Error(`读取模型失败（${res.status}），请检查连接与授权`);
    const d = await res.json();
    return Array.isArray(d.models)
      ? d.models
          .filter((x: any) => x.visibility === 'list')
          .map((x: any) => ({ id: x.slug, name: x.display_name }))
      : (d.data || [])
          .map((x: any) => ({ id: x.id, name: x.name || x.id }))
          .sort((a: Model, b: Model) => a.id.localeCompare(b.id));
  }
  logout() {
    this.cancelLogin();
    this.save({ ...this.secrets, account: undefined, clientId: undefined, mode: 'chatgpt' });
    return this.status();
  }
}
