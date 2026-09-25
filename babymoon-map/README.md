# 태교여행 지도 (Babymoon Map)

임신 중기 태교여행지(해외 16곳, 국내 5곳)의 리조트·관광지·행사·프로모션을 기간과 조건으로 걸러 보는 단일 파일 인터랙티브 지도 앱입니다.

- `index.html` : 빌드된 결과물. 브라우저에서 바로 열면 됩니다(지도 라이브러리 Leaflet은 cdnjs에서 로드).
- `src/index.html` : 앱 템플릿(HTML/CSS/JS). 데이터와 Leaflet CSS가 빌드 시 인라인됩니다.
- `data/babymoon.json` : 데이터 본체(지역, 장소, 행사, 프로모션). 스키마는 아래 참고.
- `data/geo.json` : 세계 육지(Natural Earth 50m) + 지역별 상세 해안선(10m, bbox 클리핑). 타일 서버 없이 벡터로 그립니다.
- `data/regions.config.json` : 지역 ID와 bbox(좌표 검증·해안선 추출에 사용).
- `build.js` : `src/index.html` + 데이터 + `vendor/leaflet.css` → `index.html`
- `validate.js` : 데이터 검증(필수값, ID 중복, bbox 밖 좌표, 날짜 형식, 만료 프로모션 경고)
- `scripts/assemble.js` : 지역별 검증 JSON을 `data/babymoon.json`으로 병합(신규 항목 `addedAt` 표시)
- `scripts/make-geo.js` : `geo.json` 재생성(패키지: world-atlas, topojson-client, @geo-maps/earth-coastlines-10m, @turf/bbox-clip)
- `UPDATE.md` : 정기 업데이트 절차

## 사용법

```bash
node validate.js          # 데이터 검증
node build.js             # index.html 빌드
# 개발 중에는 로컬 서버에서 src/index.html 을 열면 data/ 를 직접 읽습니다
python3 -m http.server 8000   # http://localhost:8000/src/index.html
```

## 필터

- 여행 기간(출발·귀국): 행사는 기간과 겹치는 것만, 프로모션은 예약 마감이 지나지 않고 투숙 기간이 겹치는 것만 표시. 지역 카드에는 선택 기간의 기후 적합도(최적/보통/우기 주의)를 표시.
- 표시 항목: 리조트·호텔 / 관광지·스파 / 행사·시즌 / 프로모션
- 국가, 인천 출발 비행시간 상한, 직항 여부
- 지카바이러스 위험도(기본값: '위험' 제외), 2인 4박 총경비 수준
- 프로모션: 예약 마감 14일 이내만, 프로모션 있는 리조트만
- 검색: 지역·리조트·행사·프로모션 이름, 태그, 설명

URL 해시로 지역을 바로 열 수 있습니다: `index.html#guam`

## 데이터 스키마(요약)

```
meta:        { updatedAt, version, regionUpdated: {regionId: date} }
regions[]:   { id, name, nameEn, country, countryCode, lat, lng, zoom, flightHours, directFlight, flightNote,
               timeDiffHours, visa, zika(none|low|moderate|high|unknown), zikaNote, bestMonths[], rainyMonths[],
               currency, budgetLevel(1-4), medicalNote, summary, tips[], sources[] }
places[]:    { id, regionId, type(resort|hotel|attraction|spa|dining|medical), name, nameEn, area, lat, lng,
               priceLevel(1-4), priceFromKRW, rating, tags[], babymoon[], description, url, source,
               confidence(high|medium|low), addedAt, updatedAt }
events[]:    { id, regionId, name, nameEn, type, start, end, lat, lng, venue, description, url, source, confidence, addedAt }
promotions[]:{ id, regionId, placeId?, title, provider(hotel|airline|agency|attraction|other), providerName,
               bookStart?, bookEnd?, travelStart?, travelEnd?, summary, conditions?, priceKRW?, url, source, confidence, addedAt }
```

ID 규칙: `<regionId>-p-01`(장소), `<regionId>-e-01`(행사), `<regionId>-m-01`(프로모션).

## 주의

프로모션 조건과 행사 일정은 수집 시점 기준이며 변경될 수 있습니다. 예약 전 출처 링크에서 다시 확인하세요. `confidence: low` 항목은 앱에서 '확인 필요' 표시가 붙습니다. 지카바이러스 위험도는 질병관리청·CDC 공개 정보를 기준으로 하되 여행 전 최신 공지를 확인해야 합니다.
