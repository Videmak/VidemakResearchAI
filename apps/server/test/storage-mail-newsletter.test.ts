import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const filesDir = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-storage-and-mail-0123456789';
  process.env.FILES_DIR = '/tmp/videmak-test-files';
  return process.env.FILES_DIR;
});
vi.mock('../src/db.js', () => ({ sql: () => Promise.resolve([]) }));

const { LocalStore, BucketStore, bucketConfig, checkKey, keyFromRef } = await import('../src/lib/storage.js');
const { mailProvider, resendBody, sendMail, smtpOptions } = await import('../src/lib/mail.js');
const { passwordResetEmail } = await import('../src/lib/emails.js');
const { MailCheap, MailCheapError } = await import('../src/lib/newsletter.js');
const { linkToken, readLinkToken, passwordStamp } = await import('../src/lib/emailLinks.js');
const { env } = await import('../src/env.js');

const base = { ...env };
afterEach(() => vi.unstubAllGlobals());

describe('file keys', () => {
  it('accepts plain relative keys and refuses anything that could leave the folder', () => {
    expect(checkKey('library/u1/doc.pdf')).toBe('library/u1/doc.pdf');
    for (const bad of ['../etc/passwd', '/abs/file', 'a//b', 'a/../b', 'a/./b', '', 'a b.pdf', 'x/.hidden']) expect(() => checkKey(bad)).toThrow();
  });

  it('turns old absolute paths under FILES_DIR into keys', () => {
    expect(keyFromRef(`${filesDir}/library/u1/d1.pdf`)).toBe('library/u1/d1.pdf');
    expect(keyFromRef('library/u1/d1.pdf')).toBe('library/u1/d1.pdf');
    expect(keyFromRef('/etc/passwd')).toBeNull();
    expect(keyFromRef(`${filesDir}/../secrets`)).toBeNull();
    expect(keyFromRef(null)).toBeNull();
  });
});

describe('local store', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'videmak-store-')); return () => rm(dir, { recursive: true, force: true }); });

  it('saves, reads, checks and removes a file', async () => {
    const store = new LocalStore(dir);
    await store.put('library/u1/a.pdf', new TextEncoder().encode('%PDF-1.4 hello'), 'application/pdf');
    expect(await store.exists('library/u1/a.pdf')).toBe(true);
    const file = await store.open('library/u1/a.pdf');
    expect(file?.size).toBe(14);
    expect(await new Response(file!.body).text()).toBe('%PDF-1.4 hello');
    await store.remove('library/u1/a.pdf');
    expect(await store.open('library/u1/a.pdf')).toBeNull();
  });
});

describe('S3-compatible store', () => {
  const settings = (overrides: Partial<typeof env>) => ({ ...base, s3Bucket: 'videmak-files', s3AccessKeyId: 'AKIDEXAMPLE', s3SecretAccessKey: 'secret', ...overrides });

  it('builds Wasabi, AWS and custom endpoints', () => {
    expect(bucketConfig(settings({ storageProvider: 'wasabi', s3Region: 'eu-central-1' })).endpoint).toBe('https://s3.eu-central-1.wasabisys.com');
    expect(bucketConfig(settings({ storageProvider: 'wasabi', s3Region: '' })).endpoint).toBe('https://s3.us-east-1.wasabisys.com');
    expect(bucketConfig(settings({ storageProvider: 's3', s3Region: 'eu-west-2', s3Endpoint: '' })).endpoint).toBe('https://s3.eu-west-2.amazonaws.com');
    const minio = bucketConfig(settings({ storageProvider: 's3', s3Endpoint: 'http://minio:9000/', s3UrlStyle: 'path', s3Prefix: '/videmak/' }));
    expect(minio).toMatchObject({ endpoint: 'http://minio:9000', pathStyle: true, prefix: 'videmak/' });
    // Wasabi always uses the bucket in the host name, whatever the URL style says.
    expect(bucketConfig(settings({ storageProvider: 'wasabi', s3UrlStyle: 'path' })).pathStyle).toBe(false);
  });

  it('addresses objects in the host name or in the path, under the folder prefix', () => {
    const wasabi = new BucketStore(bucketConfig(settings({ storageProvider: 'wasabi', s3Region: 'eu-central-1', s3Prefix: 'app' })));
    expect(wasabi.url('assets/a.png')).toBe('https://videmak-files.s3.eu-central-1.wasabisys.com/app/assets/a.png');
    const minio = new BucketStore(bucketConfig(settings({ storageProvider: 's3', s3Endpoint: 'http://minio:9000', s3UrlStyle: 'path' })));
    expect(minio.url('library/u/d.pdf')).toBe('http://minio:9000/videmak-files/library/u/d.pdf');
  });

  it('needs a bucket and both keys', () => {
    expect(() => new BucketStore(bucketConfig(settings({ storageProvider: 'wasabi', s3SecretAccessKey: '' })))).toThrow(/bucket, an access key and a secret key/);
  });

  it('signs requests, treats 404 as missing and reports S3 errors in words', async () => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request) => {
      calls.push(input);
      if (input.method === 'GET') return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      if (input.method === 'PUT') return new Response('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', { status: 403 });
      return new Response(null, { status: 200 });
    });
    const store = new BucketStore(bucketConfig(settings({ storageProvider: 'wasabi', s3Region: 'eu-central-1' })));
    expect(await store.open('assets/x.png')).toBeNull();
    await expect(store.put('assets/x.png', new Uint8Array([1]), 'image/png')).rejects.toThrow('Saving the file failed (403 AccessDenied): Access Denied');
    expect(await store.exists('assets/x.png')).toBe(true);
    const signed = calls[0];
    expect(signed.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-central-1\/s3\/aws4_request/);
    expect(signed.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
  });
});

describe('email', () => {
  const s = (overrides: Partial<typeof env>) => ({ ...base, mailFrom: 'Videmak <hello@videmak.test>', ...overrides });

  it('needs a provider, its settings and a From address', () => {
    expect(mailProvider(s({ mailProvider: '' }))).toBeNull();
    expect(mailProvider(s({ mailProvider: 'smtp', smtpHost: '' }))).toBeNull();
    expect(mailProvider(s({ mailProvider: 'smtp', smtpHost: 'smtp.test', mailFrom: '' }))).toBeNull();
    expect(mailProvider(s({ mailProvider: 'smtp', smtpHost: 'smtp.test' }))).toBe('smtp');
    expect(mailProvider(s({ mailProvider: 'resend', resendApiKey: 're_123' }))).toBe('resend');
  });

  it('maps the SMTP security choice', () => {
    expect(smtpOptions(s({ smtpHost: 'h', smtpPort: '', smtpSecurity: 'tls' }))).toMatchObject({ port: 465, secure: true, requireTLS: false });
    expect(smtpOptions(s({ smtpHost: 'h', smtpPort: '587', smtpSecurity: 'starttls', smtpUser: 'u', smtpPassword: 'p' }))).toMatchObject({ port: 587, secure: false, requireTLS: true, auth: { user: 'u', pass: 'p' } });
    expect(smtpOptions(s({ smtpHost: 'h', smtpPort: '25', smtpSecurity: 'none', smtpUser: '' }))).toMatchObject({ port: 25, ignoreTLS: true, auth: undefined });
  });

  it('sends through Resend with the key and reply-to', () => {
    const mail = passwordResetEmail('a@b.test', 'https://videmak.test/reset-password#token=x');
    expect(resendBody(mail, s({ mailReplyTo: 'support@videmak.test' }))).toEqual({
      from: 'Videmak <hello@videmak.test>', to: ['a@b.test'], subject: 'Reset your Videmak password', html: mail.html, text: mail.text, reply_to: 'support@videmak.test',
    });
  });

  it('refuses to send when email is off', async () => {
    await expect(sendMail(passwordResetEmail('a@b.test', 'https://x.test'))).rejects.toThrow(/Email is not set up/);
  });

  it('escapes what goes into the HTML and keeps a plain-text copy', () => {
    const mail = passwordResetEmail('<b>@x.test', 'https://videmak.test/reset-password#token=a&b');
    expect(mail.html).toContain('&lt;b&gt;@x.test');
    expect(mail.html).toContain('token=a&amp;b');
    expect(mail.text).toContain('Choose a new password: https://videmak.test/reset-password#token=a&b');
  });
});

describe('email links', () => {
  it('only work for their own purpose and die when the password changes', async () => {
    const token = await linkToken('reset', 'user-1', { stamp: passwordStamp('hash-1') }, '1h');
    expect((await readLinkToken(token, 'reset'))?.stamp).toBe(passwordStamp('hash-1'));
    expect(await readLinkToken(token, 'verify')).toBeNull();
    expect(passwordStamp('hash-2')).not.toBe(passwordStamp('hash-1'));
    expect(await readLinkToken(`${token}x`, 'reset')).toBeNull();
  });

  it('are not sign-in tokens', async () => {
    const { userFromToken } = await import('../src/auth.js');
    const token = await linkToken('verify', 'user-1', { email: 'a@b.test' }, '1h');
    expect(await userFromToken(token)).toBeNull();
  });
});

describe('MailCheap client', () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  it('sends the key, the newsletter and consent with imports', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: URL, init: RequestInit) => { seen.push({ url: String(url), init }); return reply(200, { importId: 'imp_1' }); }) as unknown as typeof fetch;
    const client = new MailCheap('mc_key', 'videmak-news', fetcher, 'https://mc.test/api/v1', 1);
    expect(await client.importContacts([{ email: 'a@b.test', status: 'active', tags: ['videmak'] }])).toEqual({ importId: 'imp_1' });
    expect(seen[0].url).toBe('https://mc.test/api/v1/contacts/import');
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer mc_key');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ consent: true, contacts: [{ email: 'a@b.test', status: 'active', tags: ['videmak'] }], newsletter: 'videmak-news' });
  });

  it('keeps + and @ in a contact address and only gives consent when subscribing', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: URL, init: RequestInit) => { seen.push({ url: String(url), body: JSON.parse(String(init.body)) }); return reply(200, {}); }) as unknown as typeof fetch;
    const client = new MailCheap('k', null, fetcher, 'https://mc.test/api/v1', 1);
    await client.setStatus('a+news@b.test', 'unsubscribed');
    await client.setStatus('a+news@b.test', 'active');
    expect(seen[0]).toEqual({ url: 'https://mc.test/api/v1/contacts/a%2Bnews@b.test', body: { status: 'unsubscribed' } });
    expect(seen[1].body).toEqual({ status: 'active', consent: true });
  });

  it('retries rate limits, then reports the API error code', async () => {
    let calls = 0;
    const fetcher = (async () => { calls += 1; return calls < 3 ? reply(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'retry-after': '0' }) : reply(401, { error: { code: 'unauthorized', message: 'Send a valid API key' } }); }) as unknown as typeof fetch;
    const client = new MailCheap('bad', null, fetcher, 'https://mc.test/api/v1', 1);
    const error = await client.billing().catch((caught) => caught);
    expect(error).toBeInstanceOf(MailCheapError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(calls).toBe(3);
  });

  it('pages through contacts with the cursor', async () => {
    const pages: Record<string, unknown> = { '': { contacts: [{ email: 'a@b.test' }], nextCursor: 'c2' }, c2: { contacts: [{ email: 'c@d.test' }] } };
    const fetcher = (async (url: URL) => reply(200, pages[url.searchParams.get('cursor') ?? ''])) as unknown as typeof fetch;
    const client = new MailCheap('k', 'news', fetcher, 'https://mc.test/api/v1', 1);
    const emails: string[] = [];
    for await (const contact of client.contacts('unsubscribed')) emails.push(contact.email!);
    expect(emails).toEqual(['a@b.test', 'c@d.test']);
  });
});
