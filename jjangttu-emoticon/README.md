# 짱뚜 (JJANGTTU) 카카오 이모티콘 세트

갯벌 짱뚱어(Boleophthalmus pectinirostris)를 캐릭터화한 카카오톡 이모티콘 프로젝트.
영상 속 짱뚱어의 특징(머리 위로 툭 튀어나온 눈, 하늘색 물방울 무늬, 얼굴만 한 입, 돛처럼 세우는 등지느러미, 꼬리 점프)을 그대로 살렸다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `png/` | 제출용 본 파일 10종. 360 x 360 px, PNG, 투명 배경, 개당 150KB 이하 |
| `png@3x/` | 1080 x 1080 px 고해상도 버전 (미리보기, 큰 이모티콘 규격 대응용) |
| `svg/` | 벡터 원본 (무손실 수정, 리사이즈 가능) |
| `preview/` | 밝은 배경·다크모드 미리보기 시트, 캐릭터 컨셉 시트 |
| `src/build.py` | 캐릭터 파라메트릭 SVG 생성기 (표정, 입, 지느러미, 소품, 텍스트를 조합) |
| `src/render.mjs` | Playwright(Chromium) SVG -> PNG 렌더러 |
| `src/sheet.py`, `src/concept.py` | 미리보기 시트 및 컨셉 시트 생성 |
| `jjangttu_kakao_10.zip` | `png/` 10종 묶음 |

## 이모티콘 10종

| # | 파일 | 텍스트 | 포즈 / 표정 |
|---|---|---|---|
| 1 | 01_hello | 안녕! | 오른쪽 지느러미 흔들며 인사 |
| 2 | 02_lol | ㅋㅋㅋㅋ | 뒤로 넘어가며 폭소, 눈물 |
| 3 | 03_love | 사랑해 | 하트 눈, 큰 하트 안기 |
| 4 | 04_thanks | 고마워! | 꾸벅 인사, 반짝이 |
| 5 | 05_gasp | 헐 | 짱뚱어 시그니처 대왕 입, 동공 지진 |
| 6 | 06_fighting | 화이팅! | 꼬리 차며 점프, 등지느러미 깃발처럼 세움 |
| 7 | 07_cry | ㅠㅠ | 눈물 폭포, 등지느러미 축 처짐 |
| 8 | 08_goodnight | 굿밤 | 코 풍선, ZZZ, 초승달 |
| 9 | 09_awkward | 뻘쭘... | 뻘(갯벌) 말장난, 눈 옆으로, 지느러미 콕콕 |
| 10 | 10_ok | 오케이! | 머리 위 동그라미, 윙크 |

## 카카오 이모티콘 스튜디오 제출 규격 (2026년 9월 기준 확인)

| 유형 | 시안 수 | 사이즈 | 용량 | 형식 |
|---|---|---|---|---|
| 멈춰있는 이모티콘 | 32종 | 360 x 360 px | 개당 150KB 이하 | PNG (투명 배경) |
| 움직이는 이모티콘 | 24종 (PNG 21 + GIF 3) | 360 x 360 px | 개당 2MB 이하 | PNG + GIF |

현재 10종은 규격을 모두 충족하지만 **제안 최소 수량(32종)에는 22종이 부족**하다.
같은 생성기로 추가 제작하면 캐릭터 일관성이 유지된다.

## 제안서 문구 초안

- 이모티콘 제목: 뻘에서 온 짱뚜
- 시리즈명: 짱뚜
- 설명: 순천만 갯벌에서 튀어나온 짱뚱어 짱뚜. 머리 위 왕눈이와 얼굴만 한 입으로 리액션은 확실하게, 뻘쭘할 땐 뻘 속으로. 일상 대화용 리액션 위주 구성.
- 참고사항: 실제 짱뚱어의 하늘색 반점, 등지느러미, 점프 동작을 반영한 오리지널 캐릭터. 폰트는 Jua (SIL Open Font License, 상업 사용 가능).

## 32종 확장 아이디어 (22종 추가분)

뻘짓중..., 배고파, 뭐해?, 미안, 축하해!, 굿모닝, 월요일 싫어, 퇴근!, 힘들다, 응?, 최고!(엄지 대신 지느러미), 알겠어요, 네!, 넵!, 감사합니다, 수고했어, 심심해, 두근두근, 화났어(입 크게 벌리고 등지느러미 세움), 놀람(점프), 흥!, 뻘 속에 숨기(부끄러움)

## 재생성 방법

```bash
pip install pillow           # 시트 생성용
# Google Fonts에서 Jua-Regular.ttf 를 받아 ~/.fonts 에 넣고 fc-cache -f
python3 src/build.py         # svg/ 생성
node src/render.mjs 1        # png/ (360px)
node src/render.mjs 3        # png@3x/ (1080px)
python3 src/sheet.py         # preview/sheet_light.png, sheet_dark.png
python3 src/concept.py && node src/render_one.mjs preview/concept_sheet.svg preview/concept_sheet.png 1200 720 1.5
```

`render.mjs`는 전역 설치된 playwright(`/opt/node22/lib/node_modules/playwright`)를 찾지 못하면 `npm i playwright` 후 실행한다.
