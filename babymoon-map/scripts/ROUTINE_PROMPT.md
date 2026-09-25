# 정기 업데이트 루틴 프롬프트 (Claude Code Routine 용)

아래 텍스트를 Routine 프롬프트로 사용한다. 매 실행은 새 세션에서 시작하므로 자체 완결적으로 작성되어 있다.

---

저장소 seun1217/paladin 의 `babymoon-map/` 폴더는 태교여행 인터랙티브 지도 앱이다. 오늘 날짜 기준으로 데이터를 갱신하라.

1. `babymoon-map/UPDATE.md` 와 `babymoon-map/README.md` 를 읽는다. 데이터는 `babymoon-map/data/babymoon.json`, 지역 목록·bbox 는 `babymoon-map/data/regions.config.json`.
2. 이번 실행에서 갱신할 지역을 고른다: `meta.regionUpdated` 가 가장 오래된 지역부터 7곳(전부 같은 날짜면 config 순서대로 순환).
3. 각 지역에 대해 병렬 서브에이전트(Agent 도구)로 다음을 수행한다. 도구: WebSearch(한국어·영어), WebFetch, Tripadvisor `search_hotels`(호텔 좌표·평점).
   - 프로모션: 기존 항목의 URL을 열어 유효 여부 확인, 만료(bookEnd 또는 travelEnd < 오늘)·소실 항목 삭제. 새 프로모션 검색: `<지역> 태교여행 패키지`, `<리조트명> 태교 패키지`, `<resort> babymoon package`, `<지역> 항공권 특가`, 여행사 태교여행 상품(하나투어·모두투어·노랑풍선·참좋은여행·인터파크·트립닷컴·클룩·마이리얼트립). 출처 URL 없는 항목은 넣지 않는다.
   - 행사: 종료된 행사 삭제. 앞으로 12개월 내 행사(축제·불꽃·일루미네이션·마켓·전시)를 검색해 추가. 일정 미확정 연례행사는 예년 기준으로 넣고 `confidence: low` + 설명 끝에 `(일정 미확정, 예년 기준)`.
   - 장소: 폐업·리브랜딩 반영, 좌표는 bbox 안, 새 태교여행 추천 리조트가 있으면 추가.
   - 지역 메타: 직항, 비자, 지카바이러스 위험도(질병관리청·CDC) 변경 확인.
   - 결과를 `{region, places, events, promotions}` JSON으로 `/tmp/verified/<regionId>.json` 에 저장. ID는 기존 번호 다음부터 이어 붙이고 기존 ID는 바꾸지 않는다.
4. 병합·검증·빌드:
   ```
   cd babymoon-map && node scripts/assemble.js /tmp/verified <오늘 YYYY-MM-DD> && node validate.js && node build.js
   ```
   validate.js 의 ERROR 는 반드시 고친다. WARN 의 만료 프로모션·종료 행사는 삭제한다.
5. 브랜치 `claude/prenatal-travel-resort-map-td93el` 에 커밋(`babymoon-map: 데이터 갱신 <날짜>`) 후 `git push -u origin claude/prenatal-travel-resort-map-td93el`. PR 은 만들지 않는다.
6. 게시된 아티팩트 URL 이 `babymoon-map/ARTIFACT.md` 에 있으면 Artifact 도구로 해당 URL을 `read` 한 뒤 `babymoon-map/index.html` 을 같은 URL 로 다시 `publish` 한다(제목·아이콘 유지).
7. 마지막에 지역별 추가/삭제/수정 건수, 마감 임박 프로모션, 직항·비자·지카 변경을 5~10줄로 요약한다. 확인하지 못한 항목은 그대로 '미확인'이라고 적는다.
