// 순수 로직 모듈 (DOM·네트워크 의존 없음). 브라우저와 Node 테스트에서 공유한다.
import { regionByCode } from './regions.js';

const DAY_MS = 86400000;
const KST_OFFSET_MS = 9 * 3600 * 1000;

// ---------- 날짜 ----------
// 모든 날짜는 'YYYY-MM-DD' 문자열로 다루고, "오늘"은 한국 표준시(KST) 기준으로 계산한다.
export function todayKST(now = Date.now()) {
  return toYmd(new Date(now + KST_OFFSET_MS));
}

export function toYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmd(ymd) {
  if (!ymd) return null;
  const s = String(ymd).replace(/\D/g, '');
  if (s.length < 8) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function isValidYmd(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd || '')) && parseYmd(ymd) !== null;
}

export function addDays(ymd, days) {
  const d = parseYmd(ymd);
  if (!d) return null;
  return toYmd(new Date(d.getTime() + days * DAY_MS));
}

export function daysBetween(fromYmd, toYmd) {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function monthRange(ymd, offsetMonths = 0) {
  const d = parseYmd(ymd);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + offsetMonths;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return { from: toYmd(start), to: toYmd(end) };
}

// 이번 주말 (토·일). 오늘이 주말이면 오늘부터.
export function weekendRange(ymd) {
  const d = parseYmd(ymd);
  const dow = d.getUTCDay(); // 0 일 ... 6 토
  let satOffset;
  if (dow === 6) satOffset = 0;
  else if (dow === 0) satOffset = -1;
  else satOffset = 6 - dow;
  const sat = addDays(ymd, satOffset);
  const sun = addDays(sat, 1);
  return { from: dow === 0 ? ymd : sat, to: sun };
}

export const PERIOD_PRESETS = [
  { key: 'today', name: '오늘' },
  { key: 'weekend', name: '이번 주말' },
  { key: 'month', name: '이번 달' },
  { key: 'nextMonth', name: '다음 달' },
  { key: '3m', name: '3개월' },
  { key: '6m', name: '6개월' },
  { key: 'all', name: '전체' },
];

export function presetRange(key, today) {
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'weekend': return weekendRange(today);
    case 'month': return monthRange(today, 0);
    case 'nextMonth': return monthRange(today, 1);
    case '3m': return { from: today, to: addDays(today, 90) };
    case '6m': return { from: today, to: addDays(today, 180) };
    case 'all': return { from: null, to: null };
    default: return null;
  }
}

export function detectPreset(from, to, today) {
  for (const p of PERIOD_PRESETS) {
    const r = presetRange(p.key, today);
    if (r && r.from === from && r.to === to) return p.key;
  }
  return null;
}

// ---------- 행사 상태 ----------
export function eventStatusOf(ev, today) {
  if (!ev.start) return 'upcoming';
  const end = ev.end || ev.start;
  if (end < today) return 'ended';
  if (ev.start > today) return 'upcoming';
  return 'ongoing';
}

// 'D-12' / '진행 중 (~10/05)' / '종료' 같은 짧은 라벨
export function eventBadge(ev, today) {
  const status = eventStatusOf(ev, today);
  if (status === 'ended') return '종료';
  if (status === 'ongoing') {
    const left = daysBetween(today, ev.end || ev.start);
    return left === 0 ? '오늘 마지막' : `진행 중 · ${left}일 남음`;
  }
  const d = daysBetween(today, ev.start);
  return d === 0 ? 'D-Day' : `D-${d}`;
}

export function overlapsPeriod(ev, from, to) {
  if (!from && !to) return true;
  const start = ev.start;
  const end = ev.end || ev.start;
  if (!start) return false;
  if (from && end < from) return false;
  if (to && start > to) return false;
  return true;
}

export function formatDateRange(start, end) {
  if (!start) return '일정 미정';
  const s = start.slice(5).replace('-', '.');
  if (!end || end === start) return `${start.slice(0, 4)}.${s}`;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const e = sameYear ? end.slice(5).replace('-', '.') : end.replace(/-/g, '.');
  return `${start.slice(0, 4)}.${s} ~ ${e}`;
}

// ---------- 시드 행사 구체화 ----------
// 시드 행사는 매년 반복되므로 'MM-DD' 형식의 예년 일정만 갖는다. 오늘 기준으로
// 가장 가까운(진행 중이거나 다가오는, 혹은 30일 내 종료된) 회차를 실제 날짜로 만든다.
export function materializeSeedEvent(seed, today, graceDays = 30) {
  const year = Number(today.slice(0, 4));
  const candidates = [];
  for (const y of [year - 1, year, year + 1]) {
    const start = `${y}-${seed.typicalStart}`;
    let end = `${y}-${seed.typicalEnd || seed.typicalStart}`;
    if (end < start) end = `${y + 1}-${seed.typicalEnd}`;
    if (!isValidYmd(start) || !isValidYmd(end)) continue;
    candidates.push({ start, end });
  }
  const cutoff = addDays(today, -graceDays);
  const pick = candidates.find((c) => c.end >= cutoff) || candidates[candidates.length - 1];
  if (!pick) return null;
  const { typicalStart, typicalEnd, ...rest } = seed;
  return {
    ...rest,
    kind: 'event',
    start: pick.start,
    end: pick.end,
    dateBasis: seed.dateBasis || 'estimated',
    source: 'seed',
    featured: true,
    tags: seed.tags || [],
    typicalStart,
    typicalEnd,
  };
}

// ---------- 제목 정규화 / 병합 ----------
export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|「[^」]*」|<[^>]*>/g, ' ')
    .replace(/제\s*\d+\s*회|\d{4}\s*년?|\d+\s*회/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function titlesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  return shorter.length >= 3 && longer.includes(shorter);
}

// 시드 관광지(큐레이션)와 TourAPI 관광지를 병합한다.
// 같은 장소로 판단되면 TourAPI 의 좌표·이미지·주소·연락처를 취하고, 시드의 분류·태그·주요 표시는 유지한다.
export function mergeSpots(seedSpots, liveSpots, { matchKm = 3 } = {}) {
  const consumed = new Set();
  const liveIndex = liveSpots.map((s) => ({ s, n: normalizeTitle(s.title) }));
  const merged = seedSpots.map((seed) => {
    const n = normalizeTitle(seed.title);
    const alt = (seed.aliases || []).map(normalizeTitle);
    let best = null;
    for (const { s, n: ln } of liveIndex) {
      if (consumed.has(s.id)) continue;
      if (!(titlesMatch(n, ln) || alt.some((a) => titlesMatch(a, ln)))) continue;
      const km = haversineKm(seed.lat, seed.lng, s.lat, s.lng);
      if (km > matchKm) continue;
      if (!best || km < best.km) best = { s, km };
    }
    if (!best) return { ...seed, kind: 'spot', source: 'seed', featured: true, tags: seed.tags || [] };
    consumed.add(best.s.id);
    return {
      ...best.s,
      title: seed.title,
      category: seed.category || best.s.category,
      tags: Array.from(new Set([...(seed.tags || []), ...(best.s.tags || [])])),
      description: seed.description || null,
      homepage: seed.homepage || best.s.homepage || null,
      featured: true,
      source: 'tourapi+seed',
      seedId: seed.id,
    };
  });
  const rest = liveSpots.filter((s) => !consumed.has(s.id));
  return [...merged, ...rest];
}

// 시드 행사(예년 일정)와 TourAPI 행사(공식 일정)를 병합한다. 같은 행사가 공식 데이터에 있으면 시드를 버린다.
export function mergeEvents(seedEvents, liveEvents, { matchKm = 40 } = {}) {
  const liveIndex = liveEvents.map((e) => ({ e, n: normalizeTitle(e.title) }));
  const featuredLive = new Set();
  const keptSeed = [];
  for (const seed of seedEvents) {
    const n = normalizeTitle(seed.title);
    const alt = (seed.aliases || []).map(normalizeTitle);
    const hit = liveIndex.find(({ e, n: ln }) =>
      (titlesMatch(n, ln) || alt.some((a) => titlesMatch(a, ln))) && haversineKm(seed.lat, seed.lng, e.lat, e.lng) <= matchKm);
    if (hit) {
      featuredLive.add(hit.e.id);
      hit.e.tags = Array.from(new Set([...(hit.e.tags || []), ...(seed.tags || [])]));
      if (seed.description && !hit.e.description) hit.e.description = seed.description;
      continue;
    }
    keptSeed.push(seed);
  }
  const live = liveEvents.map((e) => (featuredLive.has(e.id) ? { ...e, featured: true } : e));
  return [...keptSeed, ...live];
}

// ---------- 필터 ----------
export function defaultFilters(today) {
  const r = presetRange('3m', today);
  return {
    q: '',
    kinds: ['spot', 'event'],
    regions: [],
    spotCats: [],
    eventTypes: [],
    statuses: [],
    tags: [],
    from: r.from,
    to: r.to,
    featuredOnly: false,
    favoritesOnly: false,
    near: null, // { lat, lng, km }
  };
}

function has(list, v) {
  return !list || list.length === 0 || list.includes(v);
}

export function matchesFilters(item, f, ctx = {}) {
  const today = ctx.today || todayKST();
  const favorites = ctx.favorites || new Set();
  if (!has(f.kinds, item.kind)) return false;
  if (!has(f.regions, item.region)) return false;
  if (f.featuredOnly && !item.featured) return false;
  if (f.favoritesOnly && !favorites.has(item.id)) return false;
  if (f.tags && f.tags.length && !f.tags.some((t) => (item.tags || []).includes(t))) return false;
  if (f.near && Number.isFinite(f.near.km)) {
    if (haversineKm(f.near.lat, f.near.lng, item.lat, item.lng) > f.near.km) return false;
  }
  if (item.kind === 'spot') {
    if (!has(f.spotCats, item.category)) return false;
  } else {
    if (!has(f.eventTypes, item.type)) return false;
    if (!has(f.statuses, eventStatusOf(item, today))) return false;
    if (!overlapsPeriod(item, f.from, f.to)) return false;
  }
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (q) {
      const hay = `${item.title} ${item.addr || ''} ${(item.tags || []).join(' ')} ${regionByCode(item.region)?.name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

export function applyFilters(items, f, ctx) {
  return items.filter((it) => matchesFilters(it, f, ctx));
}

export const SORTS = [
  { key: 'relevance', name: '추천순' },
  { key: 'date', name: '날짜순' },
  { key: 'title', name: '이름순' },
  { key: 'distance', name: '거리순' },
];

export function sortItems(items, sortKey, ctx = {}) {
  const today = ctx.today || todayKST();
  const arr = items.slice();
  const statusRank = { ongoing: 0, upcoming: 1, ended: 2 };
  const collator = new Intl.Collator('ko');
  switch (sortKey) {
    case 'title':
      arr.sort((a, b) => collator.compare(a.title, b.title));
      break;
    case 'date':
      arr.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
        if (a.kind === 'spot') return collator.compare(a.title, b.title);
        const sa = statusRank[eventStatusOf(a, today)];
        const sb = statusRank[eventStatusOf(b, today)];
        if (sa !== sb) return sa - sb;
        return sa === 2 ? b.end.localeCompare(a.end) : a.start.localeCompare(b.start);
      });
      break;
    case 'distance': {
      const c = ctx.center;
      if (!c) break;
      arr.sort((a, b) => haversineKm(c.lat, c.lng, a.lat, a.lng) - haversineKm(c.lat, c.lng, b.lat, b.lng));
      break;
    }
    default: // relevance: 진행 중 행사 > 주요 > 예정 행사 > 나머지
      arr.sort((a, b) => score(b, today) - score(a, today) || collator.compare(a.title, b.title));
  }
  return arr;
}

function score(item, today) {
  let s = 0;
  if (item.featured) s += 10;
  if (item.kind === 'event') {
    const st = eventStatusOf(item, today);
    if (st === 'ongoing') s += 30;
    else if (st === 'upcoming') s += 15 - Math.min(10, Math.floor((daysBetween(today, item.start) || 0) / 30));
    else s -= 20;
  }
  if (item.img) s += 2;
  return s;
}

// 오늘이 속한 달부터 n개월의 월 구간 목록. [{ year, month(1-12), from, to }]
export function nextMonths(today, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = monthRange(today, i);
    out.push({ year: Number(r.from.slice(0, 4)), month: Number(r.from.slice(5, 7)), from: r.from, to: r.to });
  }
  return out;
}

// 월 구간별 행사 수. months 는 nextMonths() 결과와 같은 형식.
export function monthlyEventCounts(events, months) {
  return months.map((m) => events.reduce((n, ev) => (ev.kind === 'event' && ev.start && overlapsPeriod(ev, m.from, m.to) ? n + 1 : n), 0));
}

// ---------- URL 상태 직렬화 ----------
export function filtersToQuery(f, today) {
  const d = defaultFilters(today);
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  if (f.kinds.length && f.kinds.length !== 2) sp.set('k', f.kinds.join(','));
  if (f.regions.length) sp.set('r', f.regions.join(','));
  if (f.spotCats.length) sp.set('c', f.spotCats.join(','));
  if (f.eventTypes.length) sp.set('e', f.eventTypes.join(','));
  if (f.statuses.length) sp.set('s', f.statuses.join(','));
  if (f.tags.length) sp.set('t', f.tags.join(','));
  const preset = detectPreset(f.from, f.to, today);
  if (preset && preset !== '3m') sp.set('p', preset);
  else if (!preset) {
    if (f.from !== d.from) sp.set('from', f.from || '');
    if (f.to !== d.to) sp.set('to', f.to || '');
  }
  if (f.featuredOnly) sp.set('f', '1');
  if (f.favoritesOnly) sp.set('fav', '1');
  if (f.near) sp.set('near', `${f.near.lat.toFixed(4)},${f.near.lng.toFixed(4)},${f.near.km}`);
  return sp.toString();
}

export function filtersFromQuery(query, today) {
  const f = defaultFilters(today);
  const sp = new URLSearchParams(query || '');
  const list = (k) => (sp.get(k) ? sp.get(k).split(',').filter(Boolean) : []);
  if (sp.get('q')) f.q = sp.get('q');
  if (sp.get('k')) f.kinds = list('k').filter((k) => k === 'spot' || k === 'event');
  f.regions = list('r').map(Number).filter((n) => Number.isFinite(n));
  f.spotCats = list('c');
  f.eventTypes = list('e');
  f.statuses = list('s');
  f.tags = list('t');
  if (sp.get('p')) {
    const r = presetRange(sp.get('p'), today);
    if (r) { f.from = r.from; f.to = r.to; }
  } else {
    if (sp.has('from')) f.from = isValidYmd(sp.get('from')) ? sp.get('from') : null;
    if (sp.has('to')) f.to = isValidYmd(sp.get('to')) ? sp.get('to') : null;
  }
  f.featuredOnly = sp.get('f') === '1';
  f.favoritesOnly = sp.get('fav') === '1';
  if (sp.get('near')) {
    const [lat, lng, km] = sp.get('near').split(',').map(Number);
    if ([lat, lng, km].every(Number.isFinite)) f.near = { lat, lng, km };
  }
  return f;
}
