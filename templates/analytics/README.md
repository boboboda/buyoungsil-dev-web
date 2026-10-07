# 앱 분석 템플릿

어떤 앱이든 어떤 웹사이트든, **주소와 수집 키만 넣으면** `/admin/analytics` 에 나타나는 분석 SDK 모음입니다.

| 플랫폼 | 파일 | 외부 라이브러리 |
|---|---|---|
| Android (Kotlin / Compose) | `android/Analytics.kt` | 없음 |
| 웹 (Next.js · React · 일반 JS) | `web/analytics.ts` | 없음 |
| Flutter | `flutter/analytics.dart` | `http`, `shared_preferences` |

> 웹 SDK는 서버 검증 로직(`lib/analytics/ingest.ts`)과 맞춰 테스트했습니다. Android·Flutter 파일은 이 환경에 컴파일러가 없어 빌드 확인을 하지 못했으니, 처음 넣을 때 빌드가 되는지 확인하세요.

## 한 번에 보는 흐름

```
관리자 > 프로젝트 등록 (모바일·웹)
   └ 분석 앱 자동 생성 (appId = 프로젝트 name, 수집 키 ak_… 발급)
관리자 > 프로젝트 수정 > "📈 앱 분석 연동" > [수집 키 보기] → 주소·키 복사
앱/웹사이트 > SDK 파일 복사 + init(주소, 키)
   └ 이벤트가 쌓이면 /admin/analytics 앱 목록에 해당 프로젝트가 나타남
```

- 이미 등록해 둔 프로젝트는 수정 화면에서 **수집 키 보기**를 처음 누를 때 분석 앱이 만들어집니다. 한꺼번에 만들려면 서버에서 `npx tsx scripts/backfill-analytics-apps.ts` 를 실행하세요.
- 백엔드 프로젝트(`platform = backend`)는 분석 대상이 아닙니다.
- 수집 키는 이벤트를 **쓰기만** 할 수 있는 키입니다. 앱에 넣어도 조회·삭제는 안 됩니다. 그래도 저장소에 직접 적지 말고 빌드 설정(`local.properties`, `--dart-define`, 환경 변수)으로 넣으세요.

## 설정값 두 개

| 값 | 예시 |
|---|---|
| 주소 | `https://buyoungsilcoding.com` (SDK가 `/api/analytics/collect` 를 붙입니다. 웹 SDK는 전체 주소를 넣습니다) |
| 수집 키 | `ak_xxxxxxxx…` |

둘 중 하나라도 비어 있으면 SDK는 아무것도 하지 않습니다. 키를 받기 전에도 앱은 정상 동작합니다.

## 빠른 시작

### Android

1. `Analytics.kt` 를 앱 소스에 복사하고 맨 윗줄 `package` 를 앱 패키지로 바꿉니다.
2. `app/build.gradle.kts` (`android { defaultConfig { … } }` 안):
   ```kotlin
   val analyticsKey = providers.gradleProperty("ANALYTICS_KEY").orElse("").get()
   buildConfigField("String", "ANALYTICS_URL", "\"https://buyoungsilcoding.com\"")
   buildConfigField("String", "ANALYTICS_KEY", "\"$analyticsKey\"")
   ```
   `buildFeatures { buildConfig = true }` 가 켜져 있어야 합니다. 키는 `~/.gradle/gradle.properties` 에 `ANALYTICS_KEY=ak_xxx` 로 둡니다. 저장소에는 올라가지 않습니다.
3. `Application.onCreate()`:
   ```kotlin
   Analytics.init(this, BuildConfig.ANALYTICS_URL, BuildConfig.ANALYTICS_KEY,
                  BuildConfig.VERSION_NAME, BuildConfig.DEBUG)
   ```
4. 이벤트: `Analytics.screen("menu")`, `Analytics.feature("picture_complete", mapOf("picture" to "cat"))`
5. AdMob 연결 (광고 탭의 노출·클릭·수익):
   ```kotlin
   ad.onPaidEventListener = OnPaidEventListener { v ->
       Analytics.Ads.paid("rewarded", v.valueMicros, v.currencyCode)
   }
   // 로드 성공/실패, 노출(onAdShowedFullScreenContent), 클릭(onAdClicked), 보상(OnUserEarnedRewardListener)에도
   // Analytics.Ads.loaded / loadFailed / impression / click / rewardEarned 를 호출합니다.
   ```

### 웹 (Next.js 예시)

```tsx
"use client";
import { useEffect } from "react";
import { Analytics } from "@/lib/analytics"; // analytics.ts 를 복사한 위치

export default function AnalyticsInit() {
  useEffect(() => {
    Analytics.init({
      endpoint: "https://buyoungsilcoding.com/api/analytics/collect",
      key: process.env.NEXT_PUBLIC_ANALYTICS_KEY ?? "",
      appVersion: "1.0.0",
      debug: process.env.NODE_ENV !== "production",
    });
  }, []);

  return null;
}
```
`layout.tsx` 에 `<AnalyticsInit />` 을 한 번 넣으면 페이지 이동마다 `screen_view` 가 자동으로 기록됩니다. 기능 이벤트는 `Analytics.feature("signup_click", { plan: "free" })`.

### Flutter

`analytics.dart` 를 `lib/` 에 복사하고 `pubspec.yaml` 에 `http`, `shared_preferences` 를 추가합니다.
```dart
await Analytics.init(
  baseUrl: const String.fromEnvironment('ANALYTICS_URL'),
  key: const String.fromEnvironment('ANALYTICS_KEY'),
  appVersion: '1.0.0',
  debug: kDebugMode,
);
```
빌드: `flutter build appbundle --dart-define=ANALYTICS_URL=https://buyoungsilcoding.com --dart-define=ANALYTICS_KEY=ak_xxx`

## 프로토콜 (SDK를 직접 만들 때)

`POST {주소}/api/analytics/collect` · 헤더 `x-analytics-key`, `content-type: application/json`

```json
{
  "installId": "기기 고유 UUID (최대 100자)",
  "appVersion": "1.0.0 (디버그 빌드는 1.0.0-debug, 최대 40자)",
  "platform": "android | ios | web (최대 20자)",
  "osVersion": "14 (최대 40자)",
  "events": [
    { "id": "이벤트 UUID (최대 64자, 재전송해도 한 번만 저장)",
      "name": "허용된 이름",
      "ts": 1760000000000,
      "sessionId": "세션 UUID (선택)",
      "params": { "feature": "picture_complete", "score": 87 } }
  ]
}
```

| 항목 | 규칙 |
|---|---|
| 허용 이벤트 | `session_start`, `screen_view`, `ad_load`, `ad_load_failed`, `ad_impression`, `ad_click`, `ad_paid`, `ad_reward_earned`, `feature_use`. 그 밖의 이름은 서버가 버립니다 |
| 한 번에 | 최대 50건, 본문 100KB |
| params | 최대 10개, 키 40자, 값 200자, 전체 2KB. 값은 문자열·숫자·불리언·null만. 규칙을 어기면 params만 버려집니다 |
| `ts` | 최근 7일 이내 ~ 5분 후까지만 인정. 벗어나면 서버 수신 시각 사용 |
| 요청 제한 | IP당 분당 60회, 키당 분당 300회 (429면 나중에 다시 보내세요) |
| 응답 | 200 → 저장됨 / 400·401·413 → 다시 보내도 소용없음(버림) / 429·5xx·네트워크 오류 → 나중에 재시도 |

**관리자 화면과 이벤트의 약속**
- 오늘 앱을 연 사용자(DAU)는 `session_start` 기준 (한국 시간 날짜)입니다. 앱이 앞으로 올 때 한 번 보내세요.
- 광고 탭: `params.format` 으로 광고 종류를 나누고, 수익은 `ad_paid` 의 `valueMicros`(숫자)와 `currency` 를 합산합니다.
- 실시간 탭: `screen_view` 는 `params.screen`, `feature_use` 는 `params.feature` 를 보여 줍니다.
- 디버그 빌드는 `appVersion` 끝에 `-debug` 를 붙이면 관리자 화면의 "디버그 제외" 필터로 뺄 수 있습니다.

게임이나 서비스 고유 이벤트는 새 이름을 만들지 말고 `feature_use` 의 `feature` 값으로 구분하세요. (예: `feature = "picture_complete"`, `"picture_give_up"`) 서버 허용 목록을 바꾸지 않아도 됩니다.

## 출시 전에 확인

- 개인정보처리방침과 스토어 **데이터 보안** 양식에 "앱 사용 분석, 기기 식별자(설치 ID)를 수집한다"고 적어야 합니다. 프로젝트 수정 화면의 처리방침 템플릿에서 *분석·오류 수집 사용*을 체크하세요.
- 설치 ID는 앱 삭제 시 사라지는 임의의 UUID이며 광고 ID나 개인정보를 쓰지 않습니다.
- 어린이 대상 앱이면 분석 수집이 정책상 제한될 수 있으니 대상 연령 설정과 함께 확인하세요.
