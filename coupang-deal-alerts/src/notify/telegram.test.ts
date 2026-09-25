import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../core/db.js';
import { Repos } from '../core/repos.js';
import { TelegramNotifier } from './telegram.js';

const quiet = { info() {}, warn() {} };

function fakeFetch(handler: (url: string, body: unknown) => { status?: number; json: unknown }) {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    const r = handler(String(url), body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

test('send formats HTML message to linked chat; unlinked user gets no result; 403 unlinks', async () => {
  const repos = new Repos(openDb(':memory:'));
  repos.setTelegramLink('u1', '555', 1);
  repos.setTelegramLink('u2', '666', 1);
  const { f, calls } = fakeFetch((url, body) => {
    if ((body as { chat_id: string }).chat_id === '666') return { status: 403, json: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } };
    return { json: { ok: true, result: {} } };
  });
  const n = new TelegramNotifier(repos, { botToken: 'TOKEN', fetchImpl: f, logger: quiet });
  const res = await n.send('u1', { title: '[노트북] 평시 대비 30% 할인', body: 'LG <그램> & co\n700,000원', url: 'https://app/go/1', tag: 't' });
  assert.deepEqual(res, [{ ok: true }]);
  assert.match(calls[0]!.url, /^https:\/\/api\.telegram\.org\/botTOKEN\/sendMessage$/);
  const sent = calls[0]!.body as { chat_id: string; text: string; parse_mode: string };
  assert.equal(sent.chat_id, '555');
  assert.equal(sent.parse_mode, 'HTML');
  assert.match(sent.text, /<b>\[노트북\] 평시 대비 30% 할인<\/b>\nLG &lt;그램&gt; &amp; co\n700,000원\n<a href="https:\/\/app\/go\/1">쿠팡에서 보기<\/a>/);
  assert.deepEqual(await n.send('nobody', { title: 't', body: 'b', url: 'u', tag: 't' }), []);
  const r2 = await n.send('u2', { title: 't', body: 'b', url: 'u', tag: 't' });
  assert.equal(r2[0]!.ok, false);
  assert.equal((r2[0] as { gone: boolean }).gone, true);
  assert.equal(repos.getTelegramLink('u2'), null, 'blocked bot -> link removed');
});

test('pollUpdates links chats via /start CODE, rejects bad codes, advances offset', async () => {
  const repos = new Repos(openDb(':memory:'));
  repos.createTelegramLinkCode('ABCD1234', 'u1', 1000);
  let updates: unknown[] = [
    { update_id: 10, message: { chat: { id: 777 }, text: '/start ABCD1234' } },
    { update_id: 11, message: { chat: { id: 778 }, text: '/start NOPE0000' } },
    { update_id: 12, message: { chat: { id: 779 }, text: 'hello' } },
  ];
  const { f, calls } = fakeFetch((url) => {
    if (url.includes('/getUpdates')) return { json: { ok: true, result: updates } };
    return { json: { ok: true, result: {} } };
  });
  const n = new TelegramNotifier(repos, { botToken: 'T', fetchImpl: f, now: () => 2000, logger: quiet });
  assert.equal(await n.pollUpdates(), 1);
  assert.equal(repos.getTelegramLink('u1')!.chatId, '777');
  const replies = calls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => c.body as { chat_id: string; text: string });
  assert.equal(replies.length, 2);
  assert.match(replies.find((r) => r.chat_id === '777')!.text, /연결되었습니다/);
  assert.match(replies.find((r) => r.chat_id === '778')!.text, /올바르지 않거나 만료/);
  updates = [];
  await n.pollUpdates();
  const last = calls.filter((c) => c.url.includes('/getUpdates')).pop()!;
  assert.match(last.url, /offset=13/);
});

test('offset persists across restarts and /stop unlinks by chat id', async () => {
  const repos = new Repos(openDb(':memory:'));
  repos.setTelegramLink('u9', '900', 1);
  let updates: unknown[] = [{ update_id: 41, message: { chat: { id: 900 }, text: '/stop' } }];
  const { f, calls } = fakeFetch((url) => url.includes('/getUpdates') ? { json: { ok: true, result: updates } } : { json: { ok: true, result: {} } });
  const n = new TelegramNotifier(repos, { botToken: 'T', fetchImpl: f, now: () => 5000, logger: quiet });
  await n.pollUpdates();
  assert.equal(repos.getTelegramLink('u9'), null, '/stop removed the link');
  assert.equal(repos.getMeta('telegram_offset'), '42');
  const n2 = new TelegramNotifier(repos, { botToken: 'T', fetchImpl: f, now: () => 6000, logger: quiet });
  updates = [];
  await n2.pollUpdates();
  assert.match(calls.filter((c) => c.url.includes('/getUpdates')).pop()!.url, /offset=42/, 'new instance resumes from the saved offset');
});
