import path from 'node:path';
import fs from 'node:fs';

export type ProviderMode = 'coupang' | 'fixture';

export interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  publicDir: string;
  /** which product provider to use */
  providerMode: ProviderMode;
  coupang: {
    accessKey: string;
    secretKey: string;
    /** optional subId for affiliate tracking */
    subId: string;
    /** products per category per poll (API max 100) */
    limit: number;
  };
  /** interval between full sweeps of all categories, in minutes */
  pollIntervalMin: number;
  /** minimum spacing between two API calls, in ms (rate limiting) */
  minRequestSpacingMs: number;
  /** run the scheduler in-process */
  schedulerEnabled: boolean;
  vapid: { publicKey: string; privateKey: string; subject: string };
  telegramBotToken: string;
  adminToken: string;
  /** public base URL used in notification links to open the app */
  baseUrl: string;
  /** timezone used for daily caps and quiet hours */
  timeZone: string;
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${v}`);
  return n;
}

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/** Minimal .env loader (no dependency). Does not override already-set variables. */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadConfig(root = process.cwd()): AppConfig {
  const accessKey = process.env.COUPANG_ACCESS_KEY ?? '';
  const secretKey = process.env.COUPANG_SECRET_KEY ?? '';
  const explicitMode = process.env.PROVIDER_MODE as ProviderMode | undefined;
  const providerMode: ProviderMode =
    explicitMode === 'coupang' || explicitMode === 'fixture'
      ? explicitMode
      : accessKey && secretKey
        ? 'coupang'
        : 'fixture';
  if (providerMode === 'coupang' && (!accessKey || !secretKey)) {
    throw new Error('PROVIDER_MODE=coupang requires COUPANG_ACCESS_KEY and COUPANG_SECRET_KEY');
  }
  const port = envInt('PORT', 8787);
  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'deals.db'),
    publicDir: process.env.PUBLIC_DIR ?? path.join(root, 'public'),
    providerMode,
    coupang: {
      accessKey,
      secretKey,
      subId: process.env.COUPANG_SUB_ID ?? '',
      limit: Math.min(100, Math.max(1, envInt('COUPANG_LIMIT', 100))),
    },
    pollIntervalMin: envInt('POLL_INTERVAL_MIN', 60),
    minRequestSpacingMs: envInt('MIN_REQUEST_SPACING_MS', 1500),
    schedulerEnabled: envBool('SCHEDULER_ENABLED', true),
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
      privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
      subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    },
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    adminToken: process.env.ADMIN_TOKEN ?? '',
    baseUrl: (process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    timeZone: process.env.TZ_NAME ?? 'Asia/Seoul',
  };
}
