// 데이터 로딩·병합·갱신 감시 (브라우저 전용).
// 우선순위: 1) 빌드 시 인라인된 데이터(window.__KTM_INLINE_DATA__, 단일 파일 배포용)
//          2) 저장소의 data/*.json (GitHub Actions 가 매일 갱신)
//          3) 설정에 TourAPI 키가 있으면 브라우저에서 직접 최신 행사 정보 수집
import { materializeSeedEvent, mergeSpots, mergeEvents, addDays } from './model.js';
import { fetchFestivals } from './tourapi.js';

const FILES = {
  seedSpots: 'data/seed/spots.seed.json',
  seedEvents: 'data/seed/events.seed.json',
  spots: 'data/spots.json',
  events: 'data/events.json',
  meta: 'data/meta.json',
};

export async function loadJson(path, { bust = true } = {}) {
  const url = new URL(path, document.baseURI);
  if (bust) url.searchParams.set('_', String(Date.now()));
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function inlineData() {
  return typeof window !== 'undefined' ? window.__KTM_INLINE_DATA__ || null : null;
}

// 시드 + 라이브 데이터를 하나의 항목 배열로 병합한다.
export function assemble({ seedSpots = [], seedEvents = [], spots = [], events = [] }, today) {
  const seedSp = seedSpots.map((s) => ({ ...s, kind: 'spot', source: 'seed', featured: true, tags: s.tags || [] }));
  const seedEv = seedEvents.map((s) => materializeSeedEvent(s, today)).filter(Boolean);
  return [...mergeSpots(seedSp, spots), ...mergeEvents(seedEv, events)];
}

export async function fetchLiveEventsFromBrowser(settings, today) {
  return fetchFestivals({
    fromDate: addDays(today, -45),
    key: settings.apiKey,
    baseUrl: settings.baseUrl || undefined,
    numOfRows: 100,
    mobileOS: 'WEB',
  });
}

// 전체 데이터셋 로드. 실패한 파일은 빈 값으로 대체하고 warnings 에 기록한다.
export async function loadDataset({ settings, today }) {
  const warnings = [];
  const inline = inlineData();
  let raw;
  if (inline) {
    raw = {
      seedSpots: inline.seedSpots?.items || [],
      seedEvents: inline.seedEvents?.items || [],
      spots: inline.spots?.items || [],
      events: inline.events?.items || [],
      meta: inline.meta || {},
    };
  } else {
    const safe = (key, fallback) => loadJson(FILES[key]).catch((e) => { warnings.push(`${key}: ${e.message}`); return fallback; });
    const [seedSpots, seedEvents, spots, events, meta] = await Promise.all([
      safe('seedSpots', { items: [] }),
      safe('seedEvents', { items: [] }),
      safe('spots', { items: [] }),
      safe('events', { items: [] }),
      safe('meta', {}),
    ]);
    raw = { seedSpots: seedSpots.items || [], seedEvents: seedEvents.items || [], spots: spots.items || [], events: events.items || [], meta: meta || {} };
  }

  const sources = {
    repoUpdatedAt: raw.meta.updatedAt || null,
    repoCheckedAt: raw.meta.checkedAt || null,
    repoCounts: raw.meta.counts || { spots: raw.spots.length, events: raw.events.length },
    browserFetchedAt: null,
    browserError: null,
    inline: Boolean(inline),
  };

  if (settings.directFetch && settings.apiKey) {
    try {
      const events = await fetchLiveEventsFromBrowser(settings, today);
      if (events.length) {
        raw.events = events;
        sources.browserFetchedAt = new Date().toISOString();
      }
    } catch (e) {
      sources.browserError = e.message;
      warnings.push(`TourAPI 직접 조회 실패: ${e.message}`);
    }
  }

  const items = assemble(raw, today);
  return { items, raw, sources, warnings };
}

// data/meta.json 을 주기적으로 확인해 updatedAt 이 바뀌면 콜백을 호출한다 (지속적 갱신 감시).
export function watchForUpdates({ intervalMin, getCurrentUpdatedAt, onChange, onError }) {
  if (!intervalMin || intervalMin <= 0 || inlineData()) return () => {};
  let stopped = false;
  const tick = async () => {
    if (stopped || document.hidden) return;
    try {
      const meta = await loadJson(FILES.meta);
      const cur = getCurrentUpdatedAt();
      if (meta.updatedAt && meta.updatedAt !== cur) onChange(meta);
    } catch (e) {
      if (onError) onError(e);
    }
  };
  const id = setInterval(tick, intervalMin * 60 * 1000);
  const onVisible = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { stopped = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
}
