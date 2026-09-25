// 한국관광공사 TourAPI 4.0 (KorService2) 클라이언트.
// 브라우저(js/data.js)와 Node(scripts/fetch-tourapi.mjs)에서 동일하게 사용한다 (DOM 의존 없음).
//
// 문서: https://api.visitkorea.or.kr  /  https://www.data.go.kr/data/15101578/openapi.do
// 주요 엔드포인트
//   searchFestival2  : 행사·축제 (eventStartDate 이후 진행/예정인 행사)
//   areaBasedList2   : 지역·유형별 관광정보 목록
//   detailCommon2    : 공통 상세 (overview, homepage)
import { spotCategoryFromTourApi, eventTypeFromTourApi } from './taxonomy.js';
import { regionFromAddress } from './regions.js';

export const DEFAULT_BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
export const APP_NAME = 'KoreaTourMap';

export const CONTENT_TYPE = {
  SPOT: 12, CULTURE: 14, FESTIVAL: 15, COURSE: 25, LEISURE: 28, STAY: 32, SHOPPING: 38, FOOD: 39,
};

// data.go.kr 은 "인코딩 키"와 "디코딩 키"를 함께 제공한다. URLSearchParams 가 다시 인코딩하므로
// 디코딩 키(원문)를 써야 하며, 인코딩 키가 들어오면 한 번 디코딩해 정규화한다.
export function normalizeServiceKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (/%[0-9A-Fa-f]{2}/.test(k)) {
    try { return decodeURIComponent(k); } catch { return k; }
  }
  return k;
}

export function yyyymmdd(date) {
  if (typeof date === 'string') return date.replace(/-/g, '').slice(0, 8);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function buildUrl(endpoint, params, { key, baseUrl = DEFAULT_BASE_URL, mobileOS = 'ETC', appName = APP_NAME } = {}) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${endpoint}`);
  const sp = url.searchParams;
  sp.set('serviceKey', normalizeServiceKey(key));
  sp.set('MobileOS', mobileOS);
  sp.set('MobileApp', appName);
  sp.set('_type', 'json');
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  return url.toString();
}

export class TourApiError extends Error {
  constructor(message, { code, endpoint, status } = {}) {
    super(message);
    this.name = 'TourApiError';
    this.code = code;
    this.endpoint = endpoint;
    this.status = status;
  }
}

// data.go.kr 게이트웨이 오류는 _type=json 을 지정해도 XML 로 내려온다.
function parseGatewayError(text) {
  const auth = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text);
  const reason = /<returnReasonCode>([^<]*)<\/returnReasonCode>/.exec(text);
  const err = /<errMsg>([^<]*)<\/errMsg>/.exec(text);
  return {
    code: reason ? reason[1].trim() : 'GATEWAY',
    message: (auth && auth[1].trim()) || (err && err[1].trim()) || 'TourAPI gateway error',
  };
}

const FRIENDLY = {
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR: '서비스 키가 등록되지 않았습니다. data.go.kr 에서 TourAPI 활용신청 후 승인된 키인지 확인하세요.',
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: '일일 트래픽 한도를 초과했습니다 (개발계정 1,000건). 운영계정 전환을 검토하세요.',
  DEADLINE_HAS_EXPIRED_ERROR: '서비스 키 유효기간이 만료되었습니다. data.go.kr 에서 연장 신청이 필요합니다.',
  UNREGISTERED_IP_ERROR: '등록되지 않은 IP 입니다.',
  NO_OPENAPI_SERVICE_ERROR: 'API 서비스가 없거나 엔드포인트가 변경되었습니다 (KorService2 여부 확인).',
};

export async function request(endpoint, params, options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = options;
  if (!fetchImpl) throw new TourApiError('fetch 구현이 없습니다', { endpoint });
  const url = buildUrl(endpoint, params, options);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(url, { signal: controller ? controller.signal : undefined });
  } catch (e) {
    throw new TourApiError(`네트워크 오류: ${e.message}`, { code: 'NETWORK', endpoint });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    const { code, message } = parseGatewayError(text);
    throw new TourApiError(FRIENDLY[message] || `${message} (${code})`, { code: message, endpoint, status: res.status });
  }
  let json;
  try { json = JSON.parse(text); } catch {
    throw new TourApiError(`응답을 해석할 수 없습니다 (HTTP ${res.status})`, { code: 'PARSE', endpoint, status: res.status });
  }
  const header = json?.response?.header;
  if (!header) throw new TourApiError('예상치 못한 응답 형식입니다', { code: 'FORMAT', endpoint, status: res.status });
  if (header.resultCode !== '0000' && header.resultCode !== '00') {
    throw new TourApiError(`${header.resultMsg} (${header.resultCode})`, { code: header.resultCode, endpoint, status: res.status });
  }
  const body = json.response.body || {};
  const raw = body.items;
  let items = [];
  if (raw && typeof raw === 'object' && raw.item) items = Array.isArray(raw.item) ? raw.item : [raw.item];
  return { items, totalCount: Number(body.totalCount || 0), pageNo: Number(body.pageNo || 1), numOfRows: Number(body.numOfRows || items.length) };
}

// totalCount 까지 페이지를 순회한다. maxItems 로 상한을 둘 수 있다.
export async function fetchAll(endpoint, params, options = {}) {
  const { numOfRows = 100, maxItems = Infinity, onPage } = options;
  const out = [];
  let pageNo = 1;
  for (;;) {
    const page = await request(endpoint, { ...params, numOfRows, pageNo }, options);
    out.push(...page.items);
    if (onPage) onPage({ pageNo, fetched: out.length, totalCount: page.totalCount });
    if (page.items.length === 0 || out.length >= page.totalCount || out.length >= maxItems || page.items.length < numOfRows) break;
    pageNo += 1;
  }
  return out.slice(0, maxItems === Infinity ? undefined : maxItems);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ymdDash(v) {
  const s = String(v || '').replace(/\D/g, '');
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function cleanText(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function regionCode(item) {
  const code = num(item.areacode);
  if (code) return code;
  const r = regionFromAddress(item.addr1);
  return r ? r.code : null;
}

// TourAPI 축제 항목 -> 내부 이벤트 모델
export function normalizeFestival(item) {
  const lat = num(item.mapy);
  const lng = num(item.mapx);
  const start = ymdDash(item.eventstartdate);
  const end = ymdDash(item.eventenddate) || start;
  if (lat === null || lng === null || !start) return null;
  return {
    id: `ta-${item.contentid}`,
    kind: 'event',
    contentId: String(item.contentid),
    contentTypeId: num(item.contenttypeid) || 15,
    title: cleanText(item.title),
    type: eventTypeFromTourApi(item),
    start,
    end,
    dateBasis: 'official',
    region: regionCode(item),
    sigungu: num(item.sigungucode),
    addr: cleanText([item.addr1, item.addr2].filter(Boolean).join(' ')),
    lat,
    lng,
    img: item.firstimage || null,
    thumb: item.firstimage2 || item.firstimage || null,
    tel: cleanText(item.tel) || null,
    cat3: item.cat3 || null,
    modified: ymdDash(item.modifiedtime),
    source: 'tourapi',
    featured: false,
    tags: [],
  };
}

// TourAPI 관광지/문화시설/레포츠 항목 -> 내부 관광지 모델
export function normalizeSpot(item) {
  const lat = num(item.mapy);
  const lng = num(item.mapx);
  if (lat === null || lng === null) return null;
  return {
    id: `ta-${item.contentid}`,
    kind: 'spot',
    contentId: String(item.contentid),
    contentTypeId: num(item.contenttypeid) || 12,
    title: cleanText(item.title),
    category: spotCategoryFromTourApi(item),
    region: regionCode(item),
    sigungu: num(item.sigungucode),
    addr: cleanText([item.addr1, item.addr2].filter(Boolean).join(' ')),
    lat,
    lng,
    img: item.firstimage || null,
    thumb: item.firstimage2 || item.firstimage || null,
    tel: cleanText(item.tel) || null,
    cat1: item.cat1 || null,
    cat2: item.cat2 || null,
    cat3: item.cat3 || null,
    modified: ymdDash(item.modifiedtime),
    source: 'tourapi',
    featured: false,
    tags: [],
  };
}

// 행사 전체 수집: fromDate(YYYYMMDD) 이후에 종료되는 모든 행사 (진행 중 + 예정 + 최근 종료)
export async function fetchFestivals({ fromDate, toDate, areaCode, ...options }) {
  const items = await fetchAll('searchFestival2', {
    eventStartDate: yyyymmdd(fromDate),
    eventEndDate: toDate ? yyyymmdd(toDate) : undefined,
    areaCode,
    arrange: 'C',
  }, options);
  return items.map(normalizeFestival).filter(Boolean);
}

// 지역·유형별 관광지 수집. arrange=Q : 수정일순 + 대표이미지 있는 항목만
export async function fetchSpots({ areaCode, contentTypeId = CONTENT_TYPE.SPOT, maxItems = 100, ...options }) {
  const items = await fetchAll('areaBasedList2', {
    areaCode,
    contentTypeId,
    arrange: 'Q',
  }, { ...options, maxItems });
  return items.map(normalizeSpot).filter(Boolean);
}

// 공통 상세 (개요, 홈페이지). 팝업에서 필요할 때만 호출한다.
export async function fetchDetail(contentId, options = {}) {
  const page = await request('detailCommon2', { contentId }, options);
  const item = page.items[0];
  if (!item) return null;
  const homepageMatch = /href="([^"]+)"/i.exec(item.homepage || '');
  return {
    overview: cleanText(item.overview),
    homepage: homepageMatch ? homepageMatch[1] : cleanText(item.homepage) || null,
  };
}
