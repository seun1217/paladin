#!/usr/bin/env node
// 한국관광공사 TourAPI 에서 행사·관광지 데이터를 받아 data/*.json 으로 저장한다.
// GitHub Actions(.github/workflows/refresh-data.yml)가 매일 실행하며, 로컬에서도 실행할 수 있다.
//
//   TOURAPI_KEY=... npm run fetch-data
//
// 환경변수
//   TOURAPI_KEY        (필수) data.go.kr 에서 발급받은 TourAPI 서비스 키 (인코딩/디코딩 키 모두 허용)
//   TOURAPI_BASE_URL   (선택) 기본 https://apis.data.go.kr/B551011/KorService2
//   SPOTS_PER_AREA     (선택) 시·도별 관광지(12) 최대 수집 개수. 기본 150
//   CULTURE_PER_AREA   (선택) 시·도별 문화시설(14) 최대 수집 개수. 기본 60
//   LEISURE_PER_AREA   (선택) 시·도별 레포츠(28) 최대 수집 개수. 기본 40
//   EVENT_LOOKBACK_DAYS(선택) 이 일수 이내에 종료된 행사까지 포함. 기본 45
//   SKIP_SPOTS=1       (선택) 관광지 수집 생략 (행사만 갱신)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFestivals, fetchSpots, CONTENT_TYPE, TourApiError, DEFAULT_BASE_URL } from '../js/tourapi.js';
import { REGIONS } from '../js/regions.js';
import { todayKST, addDays } from '../js/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');

const key = process.env.TOURAPI_KEY;
if (!key) {
  console.error('TOURAPI_KEY 환경변수가 필요합니다. data.go.kr 에서 "한국관광공사_국문 관광정보 서비스_GW" 활용신청 후 발급받은 키를 넣으세요.');
  process.exit(2);
}

const opts = {
  key,
  baseUrl: process.env.TOURAPI_BASE_URL || DEFAULT_BASE_URL,
  numOfRows: 100,
  timeoutMs: 30000,
};
const spotsPerArea = Number(process.env.SPOTS_PER_AREA || 150);
const culturePerArea = Number(process.env.CULTURE_PER_AREA || 60);
const leisurePerArea = Number(process.env.LEISURE_PER_AREA || 40);
const lookback = Number(process.env.EVENT_LOOKBACK_DAYS || 45);
const skipSpots = process.env.SKIP_SPOTS === '1';

const today = todayKST();
const now = new Date().toISOString();
let requestCount = 0;

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(resolve(dataDir, file), 'utf8')); } catch { return fallback; }
}

function writeJson(file, obj) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(resolve(dataDir, file), JSON.stringify(obj, null, 0) + '\n');
}

function countingFetch(url, init) {
  requestCount += 1;
  return fetch(url, init);
}

async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      // 키·한도 오류는 재시도해도 소용없다.
      if (e instanceof TourApiError && /SERVICE_KEY|LIMITED_NUMBER|DEADLINE|UNREGISTERED/.test(e.code || '')) throw e;
      const wait = 1500 * i;
      console.warn(`  [${label}] 실패 (${e.message}), ${wait}ms 후 재시도 ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function dedupe(items) {
  const map = new Map();
  for (const it of items) if (!map.has(it.id)) map.set(it.id, it);
  return Array.from(map.values());
}

async function main() {
  console.log(`TourAPI 동기화 시작 (KST ${today}, base=${opts.baseUrl})`);
  const prevEvents = readJson('events.json', { items: [] });
  const prevSpots = readJson('spots.json', { items: [] });

  // 1) 행사·축제: 최근 종료분(lookback) + 진행 중 + 예정 전체
  const fromDate = addDays(today, -lookback);
  console.log(`- 행사 수집: eventStartDate=${fromDate} 이후`);
  const events = await withRetry(() => fetchFestivals({
    fromDate,
    ...opts,
    fetchImpl: countingFetch,
    onPage: ({ pageNo, fetched, totalCount }) => console.log(`  page ${pageNo}: ${fetched}/${totalCount}`),
  }), 'festival');
  const eventItems = dedupe(events).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'ko'));
  console.log(`  행사 ${eventItems.length}건`);
  writeJson('events.json', { generatedAt: now, source: 'tourapi', from: fromDate, items: eventItems });

  // 2) 관광지: 시·도별 관광지/문화시설/레포츠 (대표이미지가 있는 항목, 수정일순)
  let spotItems = prevSpots.items || [];
  if (!skipSpots) {
    const plan = [
      [CONTENT_TYPE.SPOT, spotsPerArea],
      [CONTENT_TYPE.CULTURE, culturePerArea],
      [CONTENT_TYPE.LEISURE, leisurePerArea],
    ].filter(([, n]) => n > 0);
    const collected = [];
    for (const region of REGIONS) {
      for (const [contentTypeId, maxItems] of plan) {
        const label = `${region.name}/${contentTypeId}`;
        const items = await withRetry(() => fetchSpots({
          areaCode: region.code, contentTypeId, maxItems, ...opts, fetchImpl: countingFetch,
        }), label);
        for (const it of items) if (!it.region) it.region = region.code;
        collected.push(...items);
        console.log(`  ${label}: ${items.length}건`);
      }
    }
    spotItems = dedupe(collected).sort((a, b) => (a.region - b.region) || a.title.localeCompare(b.title, 'ko'));
    console.log(`  관광지 ${spotItems.length}건`);
    writeJson('spots.json', { generatedAt: now, source: 'tourapi', items: spotItems });
  } else {
    console.log('- 관광지 수집 생략 (SKIP_SPOTS=1)');
  }

  const changed = JSON.stringify(prevEvents.items) !== JSON.stringify(eventItems) ||
    JSON.stringify(prevSpots.items) !== JSON.stringify(spotItems);
  const prevMeta = readJson('meta.json', {});
  writeJson('meta.json', {
    updatedAt: changed || !prevMeta.updatedAt ? now : prevMeta.updatedAt,
    checkedAt: now,
    source: 'tourapi',
    baseUrl: opts.baseUrl,
    counts: { spots: spotItems.length, events: eventItems.length },
    requests: requestCount,
    note: 'GitHub Actions 가 매일 TourAPI 에서 갱신합니다.',
  });
  console.log(`완료: 요청 ${requestCount}회, 데이터 변경 ${changed ? '있음' : '없음'}`);
}

main().catch((e) => {
  console.error(`실패: ${e.message}`);
  if (e instanceof TourApiError) console.error(`  endpoint=${e.endpoint} code=${e.code}`);
  process.exit(1);
});
