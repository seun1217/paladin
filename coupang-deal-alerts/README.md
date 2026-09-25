# 쿠팡 특가 알리미 (coupang-deal-alerts)

쿠팡에서 **꽤나 인기가 있는 상품**(카테고리별 베스트 100)을 주기적으로 관측하고, 어떤 상품이 **평시보다 세게 할인**하면 사용자에게 알림을 보내주는 셀프호스팅 웹앱(PWA)입니다. 사용자는 알림을 받고 싶은 **세부 카테고리를 체크/언체크**할 수 있고, 민감도·하루 최대 알림 수·방해금지 시간을 정할 수 있습니다.

> 이 서비스는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받을 수 있습니다. (파트너스 API 데이터를 표시할 때 필수 고지 문구이며 앱 하단에 항상 표시됩니다.)

## 동작 원리

```
쿠팡 파트너스 Open API ──(카테고리별 베스트 100, 1시간마다)──▶ 가격 이력 DB(SQLite)
                                                                 │
                        세부 카테고리 분류기(키워드 규칙) ◀────────┤
                                                                 ▼
                       "평시보다 세게 할인" 탐지기(상품별 중앙값 기준선 + 평소 할인폭)
                                                                 │
             사용자 구독(세부 카테고리, 민감도, 일일 한도, 방해금지) ◀┘
                                                                 ▼
                                    웹푸시(VAPID) / 텔레그램 봇 알림
```

* **데이터 소스**: 쿠팡 파트너스 Open API의 `bestcategories` 엔드포인트(공식 19개 상위 카테고리 중 여행 2개를 제외한 17개를 수집). 쿠팡 웹사이트 스크래핑은 하지 않습니다(약관·봇 차단). API 키가 없으면 **합성 데모 데이터(fixture)** 로 동작하므로 키 없이도 전체 흐름을 확인할 수 있습니다.
* **세부 카테고리**: 파트너스 API는 상위 카테고리명만 알려주므로, 상품명에 대한 **키워드 규칙 분류기**(`src/core/taxonomy.json`)로 세부 카테고리를 부여합니다. 17개 상위 카테고리에 200여 개의 세부 카테고리(각 카테고리에 `기타` 버킷 포함)가 있으며 JSON만 고쳐서 튠할 수 있습니다(`TAXONOMY_PATH`로 외부 파일 지정 가능).
* **"평시보다 세게 할인" 판정**: 정가/할인율 정보가 API에 없기 때문에 앱이 스스로 가격 이력을 쌓고, 상품별로 다음을 계산합니다(`src/core/detector.ts`, 순수 함수).
  * 불규칙한 관측을 **KST 일 단위 버킷**(일 중앙값)으로 묶고 최근 45일을 봅니다. 베스트 100에서 빠졌다가 몇 주 뒤 돌아온 상품은 최대 120일 전 이력을 "stale" 모드로 재사용합니다.
  * **기준가(평시 가격)** = 최상위 지지 플래토(Highest Supported Plateau): ±2% 밴드에 4일 이상·전체의 15% 이상이 모이는 가장 높은 가격대. 중앙값과 달리 "거의 항상 세일 중"인 상품에서도 정상가를 잡아냅니다.
  * **평소 할인폭** = 기준가 대비 일별 할인폭의 90퍼센타일. 이력이 짧으면 같은 카테고리 상품들의 평소 할인폭(카테고리 프라이어)과 섞어 씁니다.
  * 특가 조건: 현재 할인폭 ≥ `max(15%, 평소 할인폭 + 5%p(기준가 자체가 흔들리면 더 크게))`, 절약액 ≥ 2,000원, 평소 저점(일 중앙값 20퍼센타일)보다 5% 이상 낮아야 함(값이 올랐다가 원래대로 돌아온 경우 제외), 직전 3일 대비 급락이어야 함(점진적 하락 제외).
  * 콜드 스타트: 이력 3일 미만은 알림 없음. 3~6일은 이력이 안정적일 때만, 다음 관측에서 재확인한 뒤, 심각도 0.6 이하로만 알림(보수적 사용자에게는 가지 않음).
  * 50% 이상 급락·콜드·stale 이력은 72시간 내 다음 관측에서 가격이 재확인될 때만 알림(가격 오류 방지). 인기 순위가 급등한 경우는 즉시 알림.
  * 같은 특가는 한 번만 알림. 알림 시 기준가·임계값을 동결하므로 오래 지속되는 세일이 스스로 기준을 깎지 않습니다. 기준가의 8% 이상 추가 인하 시 "추가 인하" 재알림, 가격이 회복되어 2회 연속(또는 12시간 이상 공백 후 1회) 관측되거나 21일이 지나면 재무장.
  * 심각도(0~1) = 임계값 초과 정도 + 해당 가격의 희소성(최저가 여부) + 순위 급등 보너스. 사용자의 민감도(보수적 0.7 / 보통 0.5 / 민감 0.3) 이상일 때만 발송.
* **알림 채널**: 브라우저 웹푸시(Android/데스크톱, iOS 16.4+는 홈 화면 추가 후), 선택적으로 텔레그램 봇.

## 빠른 시작 (데모 데이터)

```bash
cd coupang-deal-alerts
npm install
cp .env.example .env
npm run vapid          # 출력된 VAPID 키 3줄을 .env 에 붙여넣기 (웹푸시용, 한 번만 생성)
npm run seed -- 21 6   # 21일치 6시간 간격 합성 가격 이력을 만들어 바로 특가가 보이게 함(선택)
npm run dev            # http://localhost:8787
```

브라우저에서 열고 **알림 켜기** → 세부 카테고리 체크 → **테스트 알림 보내기**로 확인합니다.

## 실데이터 (쿠팡 파트너스 API)

1. [partners.coupang.com](https://partners.coupang.com) 가입 후 **최종 승인**을 받습니다(누적 실적 요건이 있으며 기준은 변동됩니다).
2. 로그인 → 상단 **Tools → 파트너스 API → API 키 생성** 으로 Access Key / Secret Key 발급.
3. `.env` 에 설정:
   ```
   PROVIDER_MODE=coupang
   COUPANG_ACCESS_KEY=...
   COUPANG_SECRET_KEY=...
   COUPANG_SUB_ID=          # 선택
   POLL_INTERVAL_MIN=60     # 카테고리 17개 × 1회/시간 = 시간당 17콜
   MIN_REQUEST_SPACING_MS=3000
   ```
4. 서버 시계가 NTP로 맞춰져 있어야 합니다(HMAC 서명은 5분만 유효).
5. 키는 서버에만 보관하세요. 프론트엔드로는 절대 전달되지 않습니다.

401/403(키 거부·쿼터 초과)이 발생하면 스케줄러가 **24시간 자동 정지**(서킷 브레이커)합니다. 반복 403은 계정 제재로 이어질 수 있어 무작정 재시도하지 않습니다. 상태는 `/api/status` 에서 확인할 수 있습니다.

## 알림 채널 설정

### 웹푸시
* `npm run vapid` 로 키를 한 번 만들고 `.env` 의 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`(실제 mailto: 주소)에 넣습니다. 키를 바꾸면 기존 구독이 모두 무효화됩니다.
* HTTPS가 필요합니다(localhost 제외). 리버스 프록시(Caddy, nginx) 뒤에 두고 `BASE_URL` 을 공개 주소로 설정하세요.
* iPhone/iPad: Safari 공유 → **홈 화면에 추가** 후 홈 화면 앱에서 알림 켜기(iOS 16.4+).

### 텔레그램(선택)
* @BotFather 로 봇을 만들고 `TELEGRAM_BOT_TOKEN` 설정. 앱에서 **텔레그램으로 받기**를 누르면 `t.me/<bot>?start=<코드>` 링크가 생성되고(15분 유효), 봇에서 시작을 누르면 연결됩니다.
* 봇에 `/stop` 을 보내면 해당 채팅의 연결이 해제됩니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT`, `HOST` | `8787`, `0.0.0.0` | 리스닝 주소 |
| `BASE_URL` | `http://localhost:8787` | 알림 링크에 쓰이는 공개 URL |
| `DB_PATH` | `./data/deals.db` | SQLite 파일 |
| `PROVIDER_MODE` | 키 있으면 `coupang`, 없으면 `fixture` | 데이터 소스 |
| `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY` / `COUPANG_SUB_ID` | | 파트너스 API 키 |
| `COUPANG_LIMIT` | `100` | 카테고리당 상품 수(최대 100) |
| `COUPANG_API_PREFIX` | `/v2/providers/affiliate_open_api/apis/openapi/v1` | 게이트웨이가 `/v1` 을 거부하면 `/v1` 없는 경로로 변경 |
| `POLL_INTERVAL_MIN` | `60` | 전체 카테고리 순회 주기(분) |
| `MIN_REQUEST_SPACING_MS` | `1500` | API 호출 간 최소 간격 |
| `SCHEDULER_ENABLED` | `true` | 폴링 스케줄러 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | | 웹푸시 |
| `TELEGRAM_BOT_TOKEN` | | 텔레그램 봇 |
| `ADMIN_TOKEN` | | `POST /api/admin/sweep` (헤더 `x-admin-token`) 즉시 수집 |
| `TZ_NAME` | `Asia/Seoul` | 일일 한도·방해금지 계산 기준 시간대 |
| `TAXONOMY_PATH` | 내장 | 외부 세부 카테고리 JSON |
| `TRUST_PROXY` | `false` | 리버스 프록시 뒤에서 `X-Forwarded-For` 를 신뢰(레이트 제한 IP 판별용) |
| `PUSH_ENDPOINT_HOSTS` | | 허용할 푸시 서비스 호스트 접미사 추가(쉼표 구분). 기본으로 FCM, Mozilla, WNS, Apple, Huawei 허용 |

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/config` | VAPID 공개키, 활성 채널, 데이터 모드, 고지 문구 |
| GET | `/api/taxonomy` | 상위/세부 카테고리 트리 + 상품 수, 최근 7일 특가 수 |
| GET/PUT | `/api/users/:userId/prefs` | 세부 카테고리 구독, 민감도, 일일 한도, 방해금지 |
| POST/DELETE | `/api/users/:userId/push` | 웹푸시 구독 등록/해제 |
| POST | `/api/users/:userId/test-notification` | 테스트 알림 |
| POST | `/api/users/:userId/telegram/link-code` | 텔레그램 연결 코드 |
| GET | `/api/deals?subcategoryIds=a,b&since=&limit=&minSeverity=` | 특가 피드 |
| GET | `/api/users/:userId/deals` | 내 구독 기준 특가 |
| GET | `/api/products/:productId/history` | 가격 이력 |
| GET | `/api/status` | 스케줄러/수집 상태 |
| GET | `/go/:dealId` | 쿠팡 상품 페이지로 리다이렉트 |

사용자 식별은 로그인 없이 브라우저가 생성한 익명 ID(localStorage)로 합니다. 이 ID는 사실상 비밀번호 역할(bearer capability)을 하므로 접근 로그에서는 마스킹되며, 한 사용자에 최대 10개 기기(푸시 구독)를 붙일 수 있습니다.

**보호 장치**: 쓰기 요청은 IP당 분당 120회, 테스트 알림·텔레그램 코드 발급은 사용자당 분당 3회로 제한됩니다. 푸시 엔드포인트는 알려진 푸시 서비스 도메인(HTTPS)만 허용해 서버가 내부망으로 요청을 보내는 일(SSRF)을 막습니다. `/api/status` 의 오류 원문과 사용자 수는 `x-admin-token` 이 있을 때만 노출됩니다.

## 개발

```bash
npm test          # node:test (단위 + 통합 + E2E 시뮬레이션)
npm run typecheck
npm run build && npm start
```

Docker:
```bash
docker compose up -d --build
```

## 구조

```
src/core        types, config, db(node:sqlite), repos, taxonomy(+json), detector, pipeline(카테고리 프라이어 포함), scheduler
src/providers   coupang-partners(HMAC 클라이언트), fixture(합성 데이터)
src/notify      webpush, telegram, dispatcher(구독 매칭·민감도·한도·방해금지·중복 제거)
src/server      app(Fastify 라우트), main(부트스트랩)
src/tools       gen-vapid, seed-fixture, classify-check(분류 결과 점검)
public          PWA 프론트엔드(index.html, app.js, sw.js, manifest, icons)
```

## 한계와 주의

* 파트너스 API의 정확한 엔드포인트별 쿼터는 공개 문서로 확인하지 못했습니다. 기본값(시간당 ~17콜, 3초 간격)은 알려진 사례 기준의 보수적 설정이며, 정식 문서를 확인해 조정하세요.
* 가격은 수집 시점의 판매가이며 옵션(variant)별로 다를 수 있습니다. 같은 `productId` 가 옵션별로 여러 번 등장하는 경우 `vendorItemId` 를 붙여 별도 상품으로 추적합니다.
* 세부 카테고리 분류는 키워드 규칙이라 오분류가 있을 수 있습니다. 오분류 상품은 상위 카테고리의 `기타` 로 떨어지므로 `기타` 도 구독 대상에 포함하는 것을 권장합니다.
