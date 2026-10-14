# 도구 일감 (kind=tool) — AI 없이 카드로 바로 생성

결과물 카드(2-2)의 도구·방법·옵션을 AI 에이전트 없이 감독 프로그램이 도구 중계(`toolbroker.mjs`)로 그대로 실행하는 일감 종류예요.
앱 수정 일감처럼 AI 가 앱 폴더를 열고 도구를 부르고 결과를 옮기는 단계가 없어서 권한·키·경로 문제가 적어요.

## 등록
- 채팅 커넥터: `generate_with_card(appSlug, card, subject|subjects, count?, extra?, refArtIds?)` → 도구 일감 id. 결과는 `get_factory_job(id)` 의 `도구_결과`(상태·비용·만든 그림 주소).
- 통제실 스튜디오 → 카드 패널 아래 「카드로 바로 만들기」.
- Studio 요청(`POST /api/studio-requests`): `regen`(재생성)과 다시 그리는 `split`(method=redraw)은 그 앱에 켜진 pixel-art 카드 중 요청한 방식(engine)과 같은 방법의 카드가 있으면 도구 일감으로, 없으면 예전처럼 앱 수정 일감. `layout`·`free`·`split`(method=cut)는 앱 데이터를 바꾸는 일이라 늘 앱 일감.
- 입력: 카드, 장 수(대상마다 1~8, 전체 16장까지), 대상(1~8개), 추가 지시(500자), 고른 참고 그림(승인 그림 id, 4장까지). 키 값은 없다.

## 승인
기존과 같다(승인 대기 → 통제실·텔레그램 승인). 통제실 → 카드 → 「도구 일감 설정」에서 「비용 한도 안이면 자동 승인」을 켜면(기본 꺼짐), 예상 비용이 자동 승인 상한 이하이고 일·월 한도 안일 때만 바로 승인 상태로 등록한다.

## 실행 (감독 프로그램, `tooljob.mjs`)
1. `/next?toolSlots=N`(앱 슬롯 `slots` 와 따로)로 서버가 도구 일감을 내준다. 동시 실행 수는 설정(기본 2, 1~4)이고 같은 카드는 동시에 하나만 돈다.
2. `factory/tooljobs/<id>` 임시 폴더를 만들고(앱 폴더·정비 폴더는 열지 않는다) 카드 설정(`project-settings.json`)과 참고 그림 목록을 쓴다.
3. 대상 × 장 수만큼 `toolkit.run` 어댑터로 카드의 도구를 부른다(셸 없이 고정 배열). 키는 일감의 `requiredSecrets` 이면서 설명서가 정한 이 방법의 키만, 도구를 부르는 그 순간의 환경변수로만 붙는다. 감독 프로그램의 환경은 물려주지 않는다.
4. 만든 그림은 `/api/factory/art` 에 후보로 올린다(카드 id·판 번호·참고 그림·비용 요약 기록).
5. 업로드를 확인한 뒤 임시 폴더를 공장 정리 함수(`deleteToolJobFolder`, 해당 폴더 하나만)로 지운다. 못 올렸으면 폴더를 남기고 실패로 보고한다.
6. AI 턴이 필요한 방법(`AI_TURN_METHODS`)은 이번 범위 밖이라 「지원 안 함」으로 거절한다. 지금 설명서의 방법(codex·pixellab·claude·manual)은 모두 툴킷이 직접 처리하므로 해당 없음.

## 비용 한도 (PixelLab 호출 수)
- 서버 설정: 하루·한 달 한도(기본 30·300, 0 = 제한 없음, 한국 시간). 끝난 일감은 실제 비용, 진행 중은 예상 비용으로 센다.
- 넘으면 일감을 가져가기 전에 `needs_confirmation` 으로 멈추고 통제실 「할 일」과 텔레그램으로 알린다. 카드 설정 자체의 한도(`cost.pixellab_per_job`·`per_month`)에 도구가 멈춰도 같은 상태가 된다.
- 통제실 [그대로 진행]은 일감에 `confirmed` 를 켜서 다시 대기열로 보낸다(이번 실행은 한도 검사와 카드 설정의 비용 한도를 건너뛴다). [취소]도 된다.

## 상태 흐름
`pending → approved → running → done | failed`, 비용 한도에서 `running/approved → needs_confirmation → (그대로 진행) approved`.
