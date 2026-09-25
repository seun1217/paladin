import type { Repos } from '../core/repos.js';
import type { NotificationMessage, Notifier, NotifyResult } from '../core/types.js';

export interface TelegramOptions {
  botToken: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: { warn: (msg: string, ...a: unknown[]) => void; info: (msg: string, ...a: unknown[]) => void };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Telegram bot channel.
 *  - send(): sendMessage to the linked chat of the user
 *  - pollUpdates(): long-poll getUpdates and consume "/start <CODE>" messages to link a chat to a user
 */
export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: NonNullable<TelegramOptions['logger']>;
  private offset = 0;
  private botUsername: string | null = null;
  private botUsernameCheckedAt = 0;

  constructor(private readonly repos: Repos, private readonly opts: TelegramOptions) {
    if (!opts.botToken) throw new Error('TELEGRAM_BOT_TOKEN required');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.logger ?? console;
    const saved = Number(repos.getMeta('telegram_offset') ?? '0');
    this.offset = Number.isFinite(saved) && saved > 0 ? saved : 0;
  }

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.opts.botToken}/${method}`;
  }

  /** Resolve the bot username once; failures are cached for 5 minutes so page loads never hang on Telegram. */
  async getBotUsername(): Promise<string | null> {
    if (this.botUsername) return this.botUsername;
    const now = this.now();
    if (now - this.botUsernameCheckedAt < 5 * 60_000) return null;
    this.botUsernameCheckedAt = now;
    try {
      const res = await this.fetchImpl(this.api('getMe'), { signal: AbortSignal.timeout(3000) });
      const j = (await res.json()) as { ok: boolean; result?: { username?: string } };
      this.botUsername = j.ok && j.result?.username ? j.result.username : null;
    } catch {
      this.botUsername = null;
    }
    return this.botUsername;
  }

  async send(userId: string, message: NotificationMessage): Promise<NotifyResult[]> {
    const link = this.repos.getTelegramLink(userId);
    if (!link) return [];
    const text = `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}\n<a href="${escapeHtml(message.url)}">쿠팡에서 보기</a>`;
    try {
      const res = await this.fetchImpl(this.api('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: link.chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; error_code?: number };
      if (res.ok && j.ok) return [{ ok: true }];
      const gone = res.status === 403 || j.error_code === 403; // bot blocked by user
      if (gone) this.repos.deleteTelegramLink(userId);
      return [{ ok: false, gone, error: `${res.status} ${j.description ?? ''}`.trim() }];
    } catch (e) {
      return [{ ok: false, gone: false, error: (e as Error).message }];
    }
  }

  /**
   * Poll Telegram for new messages and link chats via "/start <CODE>".
   * Returns number of links created. Safe to call periodically from the scheduler.
   */
  async pollUpdates(): Promise<number> {
    let linked = 0;
    try {
      const url = `${this.api('getUpdates')}?timeout=0&offset=${this.offset}&allowed_updates=${encodeURIComponent('["message"]')}`;
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      const j = (await res.json()) as { ok: boolean; result?: { update_id: number; message?: { chat: { id: number | string }; text?: string } }[] };
      if (!j.ok || !j.result) return 0;
      for (const u of j.result) {
        this.offset = Math.max(this.offset, u.update_id + 1);
        try { this.repos.setMeta('telegram_offset', String(this.offset)); } catch { /* best effort */ }
        const text = u.message?.text ?? '';
        if (!u.message) continue;
        const chatIdRaw = String(u.message.chat.id);
        if (/^\/(stop|unlink)(?:@\w+)?\s*$/.test(text)) {
          // anyone can detach their own chat, even if it was linked to an account they do not control
          const removed = this.repos.deleteTelegramLinksByChatId(chatIdRaw);
          await this.reply(chatIdRaw, removed > 0 ? '알림 연결을 해제했습니다. 다시 받으려면 앱에서 새 연결 코드를 발급받아 주세요.' : '연결된 알림이 없습니다.');
          continue;
        }
        const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{4,12})\s*$/.exec(text);
        if (!m) {
          if (/^\/start/.test(text)) await this.reply(chatIdRaw, '앱의 "텔레그램으로 받기" 버튼으로 발급된 링크를 통해 시작해 주세요. 연결 해제는 /stop 입니다.');
          continue;
        }
        const code = m[1]!.toUpperCase();
        const userId = this.repos.consumeTelegramLinkCode(code, this.now());
        const chatId = String(u.message.chat.id);
        if (!userId) {
          // idempotent: a re-delivered /start after a restart must not scare an already-linked user
          const already = this.repos.getTelegramLinkByChatId(chatId);
          await this.reply(chatId, already
            ? '이미 연결되어 있습니다. 연결 해제는 /stop 을 보내 주세요.'
            : '연결 코드가 올바르지 않거나 만료되었습니다. 앱에서 새 코드를 발급받아 다시 시도해 주세요.');
          continue;
        }
        this.repos.setTelegramLink(userId, chatId, this.now());
        linked++;
        await this.reply(chatId, `연결되었습니다 (계정 ${userId.slice(0, 8)}…). 선택하신 세부 카테고리의 특가 알림을 이 채팅으로 보내드립니다. 원치 않으면 /stop 을 보내 주세요.`);
      }
    } catch (e) {
      this.log.warn(`[telegram] pollUpdates failed: ${(e as Error).message}`);
    }
    return linked;
  }

  private async reply(chatId: string, text: string): Promise<void> {
    try {
      await this.fetchImpl(this.api('sendMessage'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* ignore */ }
  }
}
