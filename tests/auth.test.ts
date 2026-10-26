import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Connection } from '../electron/auth';
const mocks = vi.hoisted(() => ({
  browser: vi.fn(),
  encrypt: vi.fn((s: string) => Buffer.from(s).reverse()),
}));
vi.mock('electron', () => ({
  shell: { openExternal: mocks.browser },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: mocks.encrypt,
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
  },
}));
describe('official OAuth flow', () => {
  it('never reuses a legacy OpenAI key for DeepSeek and discovers DeepSeek models', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reader-provider-'));
    writeFileSync(
      path.join(dir, 'credentials.enc'),
      Buffer.from(JSON.stringify({ mode: 'api', key: 'legacy-openai' })).reverse(),
    );
    const request = vi.fn(async (_url: string, _init: any) => Response.json({ data: [{ id: 'fixture-deepseek', name: 'Fixture' }] }));
    const connection = new Connection(dir, request as any);
    try {
      expect(connection.status().hasKey).toBe(false);
      await expect(connection.credential()).rejects.toThrow('DeepSeek');
      connection.configure('api', 'deepseek-fixture');
      expect(await connection.models()).toEqual([{ id: 'fixture-deepseek', name: 'Fixture' }]);
      expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/models');
      expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer deepseek-fixture');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('surfaces post-callback token exchange failures and allows cancellation', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reader-auth-failure-'));
    const realFetch = globalThis.fetch;
    const phases: string[] = [];
    mocks.browser.mockImplementation(async (value: string) => {
      const auth = new URL(value);
      const callback = new URL(auth.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', auth.searchParams.get('state')!);
      callback.searchParams.set('client_id', 'oaiapp_fixture');
      callback.searchParams.set('code', 'fixture');
      const page = await realFetch(callback).then((r) => r.text());
      expect(page).toContain('不代表连接成功');
    });
    let cancel = false;
    const connection = new Connection(
      dir,
      (async (_url, init) => {
        if (!cancel) return new Response('', { status: 503 });
        return new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(new Error('cancelled'))),
        );
      }) as typeof fetch,
      (status) => phases.push(status.loginMessage || ''),
    );
    try {
      await expect(connection.login()).rejects.toThrow('503');
      expect(connection.status().signedIn).toBe(false);
      expect(phases.at(-1)).toContain('失败');
      cancel = true;
      const attempt = connection.login();
      const result = expect(attempt).rejects.toThrow('取消');
      await vi.waitFor(() => expect(phases.at(-1)).toContain('交换授权令牌'));
      connection.cancelLogin();
      await result;
      expect(connection.status().signedIn).toBe(false);
    } finally {
      connection.cancelLogin();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('uses PKCE and issued client ID, verifies signed identity and stores granted permissions', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reader-auth-'));
    const realFetch = globalThis.fetch;
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test';
    let authorization: URL;
    const fake = vi.fn(async (input: any, options: any) => {
      const url = String(input);
      if (url.includes('/oauth/token')) {
        const body = options.body as URLSearchParams;
        expect(body.get('client_id')).toBe('oaiapp_fixture');
        expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'));
        expect(body.get('code_verifier')).toBeTruthy();
        const token = await new SignJWT({
          nonce: authorization.searchParams.get('nonce'),
          email: 'fixture@example.test',
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test' })
          .setIssuer('https://auth.openai.com')
          .setAudience('oaiapp_fixture')
          .setSubject('fixture-account')
          .setExpirationTime('1h')
          .sign(privateKey);
        return Response.json({
          id_token: token,
          access_token: 'private-fixture-token',
          refresh_token: 'refresh-fixture-token',
          expires_in: 3600,
          scope: 'openid profile email chatgpt.tokens.use.direct',
        });
      }
      if (url.endsWith('/.well-known/openid-configuration'))
        return Response.json({
          issuer: 'https://auth.openai.com',
          jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        });
      if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fake);
    mocks.browser.mockImplementation(async (value: string) => {
      authorization = new URL(value);
      expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorization.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('code', 'fixture-code');
      callback.searchParams.set('client_id', 'oaiapp_fixture');
      await realFetch(callback);
    });
    const connection = new Connection(dir);
    try {
      const status = await connection.login();
      expect(status.signedIn).toBe(true);
      expect(status.planEnabled).toBe(true);
      expect(status.email).toBe('fixture@example.test');
      expect(await connection.credential()).toBe('private-fixture-token');
      expect(mocks.encrypt).toHaveBeenCalled();
      const reopened = new Connection(dir);
      expect(reopened.status().signedIn).toBe(true);
      reopened.logout();
      expect(reopened.status().signedIn).toBe(false);
    } finally {
      connection.cancelLogin();
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

