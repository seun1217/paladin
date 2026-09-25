import webpush from 'web-push';
import type { Repos } from '../core/repos.js';
import type { NotificationMessage, Notifier, NotifyResult } from '../core/types.js';

export interface WebPushOptions {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  subject: string;
  /** drop a subscription after this many consecutive failures (non-410). Default 5 */
  maxFailures?: number;
  /** TTL seconds for the push message. Default 6h */
  ttlSeconds?: number;
  now?: () => number;
  /** injectable for tests */
  sendImpl?: (sub: webpush.PushSubscription, payload: string, opts: webpush.RequestOptions) => Promise<unknown>;
  logger?: { warn: (msg: string, ...a: unknown[]) => void; info: (msg: string, ...a: unknown[]) => void };
}

/** Payload shape consumed by public/sw.js */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  icon?: string;
  image?: string;
  tag: string;
}

export class WebPushNotifier implements Notifier {
  readonly channel = 'webpush' as const;
  private readonly maxFailures: number;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly sendImpl: NonNullable<WebPushOptions['sendImpl']>;
  private readonly log: NonNullable<WebPushOptions['logger']>;

  constructor(private readonly repos: Repos, opts: WebPushOptions) {
    if (!opts.vapidPublicKey || !opts.vapidPrivateKey) throw new Error('VAPID keys required for web push');
    webpush.setVapidDetails(opts.subject, opts.vapidPublicKey, opts.vapidPrivateKey);
    this.maxFailures = opts.maxFailures ?? 5;
    this.ttl = opts.ttlSeconds ?? 6 * 3600;
    this.now = opts.now ?? (() => Date.now());
    this.sendImpl = opts.sendImpl ?? ((sub, payload, o) => webpush.sendNotification(sub, payload, o));
    this.log = opts.logger ?? console;
  }

  async send(userId: string, message: NotificationMessage): Promise<NotifyResult[]> {
    const subs = this.repos.listPushSubscriptions(userId);
    if (subs.length === 0) return [];
    const payload: PushPayload = {
      title: message.title,
      body: message.body,
      url: message.url,
      icon: '/icons/icon-192.png',
      image: message.imageUrl,
      tag: message.tag,
    };
    const json = JSON.stringify(payload);
    const results: NotifyResult[] = [];
    for (const s of subs) {
      try {
        await this.sendImpl(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
          { TTL: this.ttl, urgency: 'normal', topic: message.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '') || undefined },
        );
        this.repos.markPushOk(s.endpoint, this.now());
        results.push({ ok: true });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        const gone = status === 404 || status === 410;
        if (gone) {
          this.repos.deletePushSubscription(s.endpoint);
          this.log.info(`[webpush] removed expired subscription for user ${userId} (${status})`);
        } else {
          const fails = this.repos.markPushFail(s.endpoint);
          if (fails >= this.maxFailures) {
            this.repos.deletePushSubscription(s.endpoint);
            this.log.warn(`[webpush] dropped subscription after ${fails} failures: ${(e as Error).message}`);
          }
        }
        results.push({ ok: false, gone, error: `${status || 'ERR'} ${(e as Error).message ?? String(e)}`.trim() });
      }
    }
    return results;
  }
}
