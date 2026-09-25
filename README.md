# 한국 관광지·축제 맵

전국 주요 관광지와 축제·행사를 **기간·지역·유형·태그**로 필터링해 보는 인터랙티브 지도 앱입니다.
한국관광공사 TourAPI 와 연동해 **매일 자동으로 데이터를 갱신**하며, 별도 서버 없이 정적 파일만으로 동작합니다 (GitHub Pages 배포).

## 주요 기능

- **인터랙티브 지도** (Leaflet + 마커 클러스터링): 관광지는 카테고리별 색상의 점, 행사는 상태(진행 중 / 예정 / 종료)별 색상의 핀으로 표시. 진행 중인 행사는 애니메이션으로 강조.
- **기간 필터**: 오늘 / 이번 주말 / 이번 달 / 다음 달 / 3개월 / 6개월 / 전체 프리셋, 직접 날짜 입력, 앞으로 12개월 월별 행사 분포 막대(클릭하면 해당 달로 이동).
- **다양한 필터**: 종류(관광지 / 축제·행사), 17개 시·도, 관광지 카테고리(자연·경관, 산·국립공원, 해변·섬, 역사·유적, 문화시설, 테마파크·체험, 도심·시장·거리, 레포츠, 쇼핑, 음식), 행사 유형(축제, 공연, 전시·박람회, 음악, 영화, 스포츠), 행사 상태, 태그(벚꽃, 단풍, 야경, 유네스코 등), 텍스트 검색, 주요 항목만, 즐겨찾기만, 내 주변 반경.
- **필터별 건수 표시**: 각 칩에 현재 조건에서의 건수를 표시해 어떤 조합이 유효한지 바로 알 수 있음.
- **목록 ↔ 지도 연동**: 목록은 현재 지도 영역 기준으로 갱신(옵션), 항목 클릭 시 지도 이동 + 팝업, 정렬(추천순 / 날짜순 / 이름순 / 거리순).
- **팝업**: 이미지, 일정과 D-day, 주소, 연락처, 태그, 즐겨찾기, 카카오맵·네이버지도·길찾기 링크, TourAPI 상세 설명(키 설정 시).
- **URL 공유**: 모든 필터 상태가 URL 해시에 저장되어 링크로 공유 가능. 즐겨찾기와 설정은 브라우저(localStorage)에 저장.
- **지속적 갱신**: GitHub Actions 가 매일 TourAPI 데이터를 받아 커밋 → Pages 재배포. 앱은 주기적으로 `data/meta.json` 을 확인해 새 데이터가 있으면 알림. 브라우저에서 TourAPI 키를 넣으면 직접 최신 행사 정보를 받아올 수도 있음.
- 라이트·다크 테마, 모바일 하단 시트 레이아웃, 외부 CDN 의존 없음(Leaflet 은 `vendor/` 에 포함).

## 빠른 시작

```bash
npm install          # 개발 의존성(Leaflet)만 설치. 앱 실행에는 필요 없음
npm start            # http://localhost:8080
npm test             # 단위 테스트 (필터 로직, TourAPI 클라이언트, 시드 데이터 무결성)
npm run build:single # dist/korea-tourism-map.html 단일 파일 빌드 (더블클릭으로 열기, 사내 공유용)
```

Node 20 이상이 필요합니다. 앱 자체는 정적 파일(`index.html`, `css/`, `js/`, `data/`, `vendor/`)만으로 동작하므로 어떤 정적 호스팅에도 올릴 수 있습니다.

## 데이터

| 구분 | 파일 | 내용 |
| --- | --- | --- |
| 시드 관광지 | `data/seed/spots.seed.json` | 큐레이션된 전국 주요 관광지 176곳 (카테고리, 태그, 설명 포함) |
| 시드 행사 | `data/seed/events.seed.json` | 전국 주요 축제·행사 86건. 예년 개최 시기(`MM-DD`)만 갖고 있으며 앱이 오늘 기준 가장 가까운 회차로 날짜를 만들어 **"예상"** 으로 표시 |
| 라이브 관광지 | `data/spots.json` | TourAPI `areaBasedList2` 로 수집한 시·도별 관광지·문화시설·레포츠 (대표이미지 있는 항목, 수정일순) |
| 라이브 행사 | `data/events.json` | TourAPI `searchFestival2` 로 수집한 최근 종료·진행 중·예정 행사 전체 (공식 일정) |
| 메타 | `data/meta.json` | 갱신 시각, 건수. 앱이 이 파일을 주기적으로 확인해 새 데이터를 감지 |
| 시·도 경계 | `data/geo/korea-provinces.json` | 지도 타일을 불러올 수 없을 때(오프라인, 이미지 차단 환경) 자동으로 표시되는 벡터 폴백 지도. 통계청 SGIS 2018 경계(공공누리 1유형), `scripts/prepare-geo.mjs` 로 생성 |

병합 규칙: 시드 관광지가 TourAPI 항목과 같은 장소로 판단되면(제목 유사 + 3km 이내) TourAPI 의 좌표·이미지·주소·연락처를 쓰고 시드의 분류·태그·"주요" 표시는 유지합니다. 시드 행사는 TourAPI 에 같은 행사의 공식 일정이 있으면 숨겨지고 공식 항목이 "주요" 로 표시됩니다.
따라서 TourAPI 연동 전에도 앱은 동작하지만, 시드 행사의 날짜는 추정치이므로 **방문 전 공식 일정 확인이 필요**합니다.

## 자동 갱신 설정 (TourAPI)

1. [공공데이터포털](https://www.data.go.kr) 회원가입 후 **"한국관광공사_국문 관광정보 서비스_GW"** 활용신청 (즉시 승인, 무료). 마이페이지에서 서비스 키 확인. 개발계정은 하루 1,000건 호출 제한이며, 이 워크플로는 하루 약 60~80건을 사용합니다.
2. GitHub 저장소 **Settings → Secrets and variables → Actions → New repository secret** 에 `TOURAPI_KEY` 로 등록 (일반(디코딩) 키 권장. 인코딩 키를 넣어도 자동 처리).
3. **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정.
4. **Actions** 탭에서 `Refresh tourism data` 워크플로를 **Run workflow** 로 한 번 수동 실행. 이후 매일 KST 04:10 에 자동 실행되며, 데이터가 바뀌면 `data/` 에 커밋되고 Pages 가 재배포됩니다.

선택 설정 (Settings → Variables): `SPOTS_PER_AREA`(기본 150), `CULTURE_PER_AREA`(60), `LEISURE_PER_AREA`(40) 로 시·도별 수집 개수를 조정할 수 있고, TourAPI 엔드포인트가 바뀌면 `TOURAPI_BASE_URL` 로 교체할 수 있습니다.

로컬에서 직접 갱신하려면:

```bash
TOURAPI_KEY='발급받은키' npm run fetch-data
```

### 브라우저에서 직접 조회

우측 상단 ⚙ 설정에서 TourAPI 키를 입력하면 저장소 데이터와 별개로 브라우저가 직접 최신 행사 정보를 받아옵니다(키는 해당 브라우저의 localStorage 에만 저장). 팝업의 "상세 정보" 버튼으로 TourAPI 개요·홈페이지도 불러올 수 있습니다.

## 필터 URL 파라미터

`https://…/#q=벚꽃&r=1,39&p=month` 처럼 해시에 저장됩니다.

| 키 | 의미 | 예 |
| --- | --- | --- |
| `q` | 검색어 | `q=불꽃` |
| `k` | 종류 (`spot`, `event`) | `k=event` |
| `r` | 지역코드 (TourAPI areaCode, 콤마 구분) | `r=6,36` (부산, 경남) |
| `c` | 관광지 카테고리 | `c=beach,nature` |
| `e` | 행사 유형 | `e=festival,music` |
| `s` | 행사 상태 (`ongoing`, `upcoming`, `ended`) | `s=ongoing` |
| `t` | 태그 | `t=단풍` |
| `p` | 기간 프리셋 (`today`, `weekend`, `month`, `nextMonth`, `3m`, `6m`, `all`) | `p=weekend` |
| `from`, `to` | 직접 지정 기간 | `from=2027-04-01&to=2027-04-30` |
| `f`, `fav` | 주요만 / 즐겨찾기만 | `f=1` |
| `near` | 위도,경도,반경km | `near=37.5665,126.978,30` |

지역코드: 1 서울, 2 인천, 3 대전, 4 대구, 5 광주, 6 부산, 7 울산, 8 세종, 31 경기, 32 강원, 33 충북, 34 충남, 35 경북, 36 경남, 37 전북, 38 전남, 39 제주.

## 시드 데이터 편집

`data/seed/*.json` 을 직접 수정하면 됩니다. 항목 예시:

```jsonc
// 관광지
{ "id": "seed-sp-bulguksa", "title": "불국사", "region": 35, "category": "history",
  "lat": 35.79, "lng": 129.332, "addr": "경북 경주시 불국로 385",
  "tags": ["유네스코", "사찰", "단풍"], "description": "…", "aliases": ["불국사(경주)"] }

// 행사 (typicalStart/typicalEnd 는 예년 개최 시기 MM-DD, 연도를 넘기면 end < start 로 적는다)
{ "id": "seed-ev-boryeong-mud", "title": "보령머드축제", "region": 34, "type": "festival",
  "typicalStart": "07-24", "typicalEnd": "08-02", "lat": 36.3117, "lng": 126.5141,
  "addr": "충남 보령시 대천해수욕장", "tags": ["여름", "해변"], "description": "…" }
```

`category` 는 `js/taxonomy.js` 의 `SPOT_CATEGORIES`, `type` 은 `EVENT_TYPES` 의 키를 사용합니다. `npm test` 가 id 중복, 지역코드, 좌표 범위, 날짜 형식을 검사합니다.

## 구조

```
index.html            앱 페이지
css/style.css         스타일 (라이트/다크, 모바일)
js/app.js             상태 관리·화면 연결 (진입점)
js/model.js           순수 로직: 날짜, 상태, 필터, 정렬, 병합, URL 직렬화 (Node 테스트 대상)
js/tourapi.js         TourAPI 클라이언트 (브라우저·Node 공용)
js/data.js            데이터 로딩·병합·갱신 감시
js/map.js             Leaflet 지도, 마커, 클러스터, 범례
js/ui.js              칩·목록·팝업·토스트 렌더링
js/regions.js         시·도 정의 (areaCode, 중심 좌표)
js/taxonomy.js        카테고리·행사 유형·상태 정의와 TourAPI 코드 매핑
data/                 시드·라이브 데이터
scripts/fetch-tourapi.mjs   TourAPI 수집 스크립트 (GitHub Actions 가 실행)
scripts/serve.mjs           로컬 정적 서버
scripts/build-single.mjs    단일 HTML 빌드
scripts/vendor.mjs          node_modules -> vendor/ 복사
.github/workflows/refresh-data.yml   매일 데이터 갱신
.github/workflows/deploy-pages.yml   GitHub Pages 배포
test/                 node --test 단위 테스트
```

## 주의 사항

- 시드 데이터의 좌표는 근사값이고 축제 일정은 예년 기준 추정치입니다. TourAPI 연동 후에는 공식 데이터가 우선합니다.
- 지도 타일은 CARTO / OpenStreetMap 공개 타일을 사용합니다. 대량 트래픽이 예상되면 자체 타일 서버나 유료 타일(예: 카카오·네이버 지도 SDK)로 교체하세요 (`js/map.js` 의 `BASEMAPS`).
- TourAPI 엔드포인트(KorService2)는 한국관광공사 정책에 따라 바뀔 수 있습니다. 오류 메시지에 `NO_OPENAPI_SERVICE_ERROR` 가 나오면 `TOURAPI_BASE_URL` 을 새 버전으로 바꾸세요.
- 브라우저 직접 조회는 TourAPI 의 CORS 허용에 의존합니다. 차단될 경우 GitHub Actions 경로만 사용하세요.

## 라이선스

MIT. Leaflet(BSD-2), Leaflet.markercluster(MIT) 라이선스 파일은 `vendor/` 에 포함되어 있습니다. 관광 데이터의 저작권은 한국관광공사 및 각 제공 기관에 있습니다.
시·도 경계 데이터는 통계청 통계지리정보서비스(SGIS)가 공공누리 제1유형으로 제공한 자료를 [southkorea/southkorea-maps](https://github.com/southkorea/southkorea-maps) 배포본에서 가져와 변환한 것입니다.
