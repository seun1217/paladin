// 17개 시·도 정의. code 는 한국관광공사 TourAPI 지역코드(areaCode)와 동일하다.
// center/zoom 은 지도에서 해당 지역으로 이동할 때 사용한다.
export const REGIONS = [
  { code: 1,  key: 'seoul',     name: '서울',  full: '서울특별시',     center: [37.5665, 126.9780], zoom: 11 },
  { code: 2,  key: 'incheon',   name: '인천',  full: '인천광역시',     center: [37.4563, 126.7052], zoom: 10 },
  { code: 3,  key: 'daejeon',   name: '대전',  full: '대전광역시',     center: [36.3504, 127.3845], zoom: 11 },
  { code: 4,  key: 'daegu',     name: '대구',  full: '대구광역시',     center: [35.8714, 128.6014], zoom: 11 },
  { code: 5,  key: 'gwangju',   name: '광주',  full: '광주광역시',     center: [35.1595, 126.8526], zoom: 11 },
  { code: 6,  key: 'busan',     name: '부산',  full: '부산광역시',     center: [35.1796, 129.0756], zoom: 11 },
  { code: 7,  key: 'ulsan',     name: '울산',  full: '울산광역시',     center: [35.5384, 129.3114], zoom: 11 },
  { code: 8,  key: 'sejong',    name: '세종',  full: '세종특별자치시', center: [36.4800, 127.2890], zoom: 11 },
  { code: 31, key: 'gyeonggi',  name: '경기',  full: '경기도',         center: [37.4138, 127.5183], zoom: 9 },
  { code: 32, key: 'gangwon',   name: '강원',  full: '강원특별자치도', center: [37.8228, 128.1555], zoom: 8 },
  { code: 33, key: 'chungbuk',  name: '충북',  full: '충청북도',       center: [36.8000, 127.7000], zoom: 9 },
  { code: 34, key: 'chungnam',  name: '충남',  full: '충청남도',       center: [36.5184, 126.8000], zoom: 9 },
  { code: 35, key: 'gyeongbuk', name: '경북',  full: '경상북도',       center: [36.4919, 128.8889], zoom: 8 },
  { code: 36, key: 'gyeongnam', name: '경남',  full: '경상남도',       center: [35.4606, 128.2132], zoom: 9 },
  { code: 37, key: 'jeonbuk',   name: '전북',  full: '전북특별자치도', center: [35.7175, 127.1530], zoom: 9 },
  { code: 38, key: 'jeonnam',   name: '전남',  full: '전라남도',       center: [34.8161, 126.9970], zoom: 9 },
  { code: 39, key: 'jeju',      name: '제주',  full: '제주특별자치도', center: [33.4890, 126.4983], zoom: 10 },
];

const byCode = new Map(REGIONS.map((r) => [r.code, r]));
const byKey = new Map(REGIONS.map((r) => [r.key, r]));

export function regionByCode(code) {
  return byCode.get(Number(code)) || null;
}

export function regionByKey(key) {
  return byKey.get(key) || null;
}

// 주소 문자열에서 시·도를 추정한다 (TourAPI areacode 가 비어 있을 때의 폴백).
const ADDR_PREFIX = [
  ['서울', 1], ['인천', 2], ['대전', 3], ['대구', 4], ['광주', 5], ['부산', 6], ['울산', 7], ['세종', 8],
  ['경기', 31], ['강원', 32], ['충청북도', 33], ['충북', 33], ['충청남도', 34], ['충남', 34],
  ['경상북도', 35], ['경북', 35], ['경상남도', 36], ['경남', 36],
  ['전북', 37], ['전라북도', 37], ['전라남도', 38], ['전남', 38], ['제주', 39],
];

export function regionFromAddress(addr) {
  if (!addr) return null;
  const s = String(addr).trim();
  for (const [prefix, code] of ADDR_PREFIX) {
    if (s.startsWith(prefix)) return byCode.get(code);
  }
  return null;
}

// 대한민국 전체 영역 (독도·마라도 포함). 지도 초기 뷰와 데이터 검증에 사용한다.
export const KOREA_BOUNDS = { south: 33.0, north: 38.7, west: 124.5, east: 132.0 };
export const KOREA_CENTER = [36.2, 127.9];

export function isInKorea(lat, lng) {
  return lat >= KOREA_BOUNDS.south && lat <= KOREA_BOUNDS.north &&
    lng >= KOREA_BOUNDS.west && lng <= KOREA_BOUNDS.east;
}
