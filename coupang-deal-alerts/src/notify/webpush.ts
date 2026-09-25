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

const MAX_PAYLOAD_BYTES = 3900;

/**
 * Push endpoints are URLs the server will POST to, so they must be restricted to real push services:
 * otherwise an anonymous client could use the server as an SSRF / reflector against internal hosts.
 */
export const DEFAULT_PUSH_ENDPOINT_HOST_SUFFIXES = [
  'fcm.googleapis.com', 'android.googleapis.com',                 // Chrome, Edge (Android), Brave, Samsung, Opera, Vivaldi
  'updates.push.services.mozilla.com', 'push.services.mozilla.com', // Firefox
  'notify.windows.com',                                            // Edge (Windows, WNS)
  'push.apple.com',                                                // Safari / iOS (web.push.apple.com, *.push.apple.com)
  'push-api.cloud.huawei.com',                                     // Huawei browser
];

export function isAllowedPushEndpoint(endpoint: string, extraSuffixes: string[] = []): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const suffixes = [...DEFAULT_PUSH_ENDPOINT_HOST_SUFFIXES, ...extraSuffixes.map((s) => s.trim().toLowerCase()).filter(Boolean)];
  return suffixes.some((suf) => host === suf || host.endsWith(`.${suf}`));
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
    let json = JSON.stringify(payload);
    if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
      // RFC 8291: at most ~3993 bytes of plaintext fit in a 4096-byte push body; drop the image first, then trim the body
      delete payload.image;
      json = JSON.stringify(payload);
      if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
        payload.body = payload.body.slice(0, 300);
        json = JSON.stringify(payload);
      }
    }
    const results: NotifyResult[] = [];
    for (const s of subs) {
      try {
        await this.sendImpl(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
          { TTL: this.ttl, urgency: 'normal', timeout: 10_000, topic: message.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '') || undefined },
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
