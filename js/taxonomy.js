// 앱 내부 분류 체계와 TourAPI 코드 매핑.
// TourAPI contentTypeId: 12 관광지, 14 문화시설, 15 축제공연행사, 25 여행코스, 28 레포츠, 32 숙박, 38 쇼핑, 39 음식점
// TourAPI 대분류 cat1: A01 자연, A02 인문(문화/예술/역사), A03 레포츠, A04 쇼핑, A05 음식, B02 숙박, C01 추천코스

export const KIND = { SPOT: 'spot', EVENT: 'event' };

// 관광지 카테고리 (마커 색상과 필터 칩에 사용)
export const SPOT_CATEGORIES = [
  { key: 'nature',   name: '자연·경관',     color: '#2e9e5b' },
  { key: 'mountain', name: '산·국립공원',   color: '#4f7d3a' },
  { key: 'beach',    name: '해변·섬',       color: '#1f8fc9' },
  { key: 'history',  name: '역사·유적',     color: '#b5651d' },
  { key: 'culture',  name: '문화시설',      color: '#7b5ea7' },
  { key: 'theme',    name: '테마파크·체험', color: '#e0559a' },
  { key: 'urban',    name: '도심·시장·거리', color: '#5d6d7e' },
  { key: 'leisure',  name: '레포츠',        color: '#0aa39b' },
  { key: 'shopping', name: '쇼핑',          color: '#c48b0a' },
  { key: 'food',     name: '음식',          color: '#d64541' },
];

// 행사 유형 (TourAPI cat3 소분류 기준)
export const EVENT_TYPES = [
  { key: 'festival',    name: '축제',        color: '#f05a28' },
  { key: 'performance', name: '공연',        color: '#c2185b' },
  { key: 'exhibition',  name: '전시·박람회', color: '#6a4fb3' },
  { key: 'music',       name: '음악·콘서트', color: '#8e24aa' },
  { key: 'film',        name: '영화',        color: '#3949ab' },
  { key: 'sports',      name: '스포츠',      color: '#00897b' },
  { key: 'other',       name: '기타 행사',   color: '#757575' },
];

export const EVENT_STATUS = [
  { key: 'ongoing',  name: '진행 중', color: '#e53935' },
  { key: 'upcoming', name: '예정',    color: '#fb8c00' },
  { key: 'ended',    name: '종료',    color: '#9e9e9e' },
];

const spotCatMap = new Map(SPOT_CATEGORIES.map((c) => [c.key, c]));
const eventTypeMap = new Map(EVENT_TYPES.map((c) => [c.key, c]));
const statusMap = new Map(EVENT_STATUS.map((c) => [c.key, c]));

export function spotCategory(key) { return spotCatMap.get(key) || spotCatMap.get('nature'); }
export function eventType(key) { return eventTypeMap.get(key) || eventTypeMap.get('other'); }
export function eventStatus(key) { return statusMap.get(key) || statusMap.get('upcoming'); }

// TourAPI 항목 -> 관광지 카테고리 추정
export function spotCategoryFromTourApi({ contenttypeid, cat1, cat2, cat3, title = '' }) {
  const type = Number(contenttypeid);
  if (type === 14) return 'culture';
  if (type === 28) return 'leisure';
  if (type === 38) return 'shopping';
  if (type === 39) return 'food';
  if (cat1 === 'A03') return 'leisure';
  if (cat1 === 'A04') return 'shopping';
  if (cat1 === 'A05') return 'food';
  if (cat2 === 'A0201') return 'history';
  if (cat2 === 'A0206') return 'culture';
  if (cat2 === 'A0203' || cat2 === 'A0202') return 'theme';
  if (cat2 === 'A0204' || cat2 === 'A0205') return 'urban';
  const t = String(title);
  if (/해수욕장|해변|해안|섬$|도$|항$|포구|등대|곶/.test(t)) return 'beach';
  if (/산$|국립공원|계곡|봉$|고개|령$|산림/.test(t)) return 'mountain';
  if (/궁|성$|읍성|서원|향교|사$|암$|릉|고분|유적|생가|고택|마을/.test(t)) return 'history';
  if (/시장|거리|광장|타워|공원|역$/.test(t)) return 'urban';
  return cat1 === 'A01' ? 'nature' : 'nature';
}

// TourAPI cat3 -> 행사 유형
const EVENT_CAT3 = {
  A02070100: 'festival',    // 문화관광축제
  A02070200: 'festival',    // 일반축제
  A02080100: 'performance', // 전통공연
  A02080200: 'performance', // 연극
  A02080300: 'performance', // 뮤지컬
  A02080400: 'performance', // 오페라
  A02080500: 'exhibition',  // 전시회
  A02080600: 'exhibition',  // 박람회
  A02080800: 'performance', // 무용
  A02080900: 'music',       // 클래식음악회
  A02081000: 'music',       // 대중콘서트
  A02081100: 'film',        // 영화
  A02081200: 'sports',      // 스포츠경기
  A02081300: 'other',       // 기타행사
};

export function eventTypeFromTourApi({ cat3, title = '' }) {
  if (cat3 && EVENT_CAT3[cat3]) return EVENT_CAT3[cat3];
  const t = String(title);
  if (/축제|페스티벌|festival/i.test(t)) return 'festival';
  if (/불꽃/.test(t)) return 'festival';
  if (/콘서트|음악회|뮤직|재즈|락 |록 /.test(t)) return 'music';
  if (/전시|박람회|비엔날레|엑스포/.test(t)) return 'exhibition';
  if (/영화제/.test(t)) return 'film';
  if (/마라톤|대회|경기|리그/.test(t)) return 'sports';
  if (/공연|연극|뮤지컬|오페라|무용|발레/.test(t)) return 'performance';
  return 'other';
}
