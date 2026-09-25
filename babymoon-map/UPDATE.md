# 정기 업데이트 절차

목표: 리조트·관광지·행사·프로모션 데이터를 최신 상태로 유지하고, 만료된 프로모션·종료된 행사를 정리하며, 새 항목을 추가한다.

## 1. 대상 지역

`data/regions.config.json` 의 21개 지역. 한 번에 전부 갱신하지 않아도 된다. `scripts/assemble.js` 는 파일이 없는 지역의 기존 데이터를 그대로 유지한다.

## 2. 지역별 조사 (에이전트/수동 공통)

각 지역에 대해 아래를 조사해 `{region, places, events, promotions}` JSON을 `<verifiedDir>/<regionId>.json` 으로 저장한다.

1. 기존 `data/babymoon.json` 에서 해당 지역 데이터를 읽는다.
2. 프로모션: 각 URL을 열어 아직 유효한지 확인. 만료(bookEnd 또는 travelEnd < 오늘)·페이지 소실은 삭제. 새 프로모션 검색: `<지역> 태교여행 패키지`, `<리조트명> 태교 패키지`, `<resort> babymoon package`, `<지역> 항공권 특가`, 여행사(하나투어·모두투어·노랑풍선·참좋은여행·인터파크·트립닷컴·클룩·마이리얼트립) 상품.
3. 행사: 종료된 행사 삭제. 앞으로 12개월 내 행사 검색(`<지역> 축제 <연도>`, `<region> festival <year> dates`). 2027년 일정 미확정인 연례행사는 예년 기준으로 넣되 `confidence: low` 와 `(일정 미확정, 예년 기준)` 표기.
4. 장소: 폐업·리브랜딩 반영, Tripadvisor 좌표·평점 갱신. 새 태교여행 추천 리조트가 있으면 추가.
5. 지역 메타: 직항 취항/단항, 비자, 지카바이러스 위험도(질병관리청·CDC) 변경 확인.
6. 규칙: 출처 URL 없는 항목은 넣지 않는다. 좌표는 bbox 안이어야 한다. ID는 기존 번호 다음부터 이어 붙인다. 기존 항목의 ID는 바꾸지 않는다(addedAt 추적용).

## 3. 병합·검증·빌드

```bash
node scripts/assemble.js <verifiedDir> <YYYY-MM-DD>
node validate.js
node build.js
```

`validate.js` 가 ERROR 를 내면 데이터를 고친 뒤 다시 실행한다. WARN(만료 프로모션, 종료 행사)은 삭제 대상이다.

## 4. 커밋·게시

```bash
git add babymoon-map && git commit -m "babymoon-map: 데이터 갱신 <YYYY-MM-DD>" && git push
```

게시된 아티팩트가 있으면 `index.html` 을 같은 URL로 다시 게시한다(Artifact 도구, url 지정).

## 5. 변경 요약

커밋 메시지 또는 보고에 지역별로 추가/삭제/수정 건수와 주요 변경(신규 프로모션, 마감 임박, 직항 변경 등)을 남긴다.
