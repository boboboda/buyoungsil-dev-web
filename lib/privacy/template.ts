// lib/privacy/template.ts
// 프로젝트(앱)별 개인정보처리방침 기본 템플릿 생성기
//
// - 결과물은 마크다운 문자열이며 Project.privacyPolicy 에 그대로 저장됩니다.
// - 사용자가 직접 채워야 하는 부분은 [[ ... ]] 로 표시되고,
//   남아 있으면 저장 전에 hasUnfilledPlaceholder() 로 걸러냅니다.

export interface PrivacyTemplateOptions {
  /** 앱(프로젝트) 이름 */
  title: string;
  /** 문의 이메일 (개인 메일 대신 블로그용 별도 메일 권장) */
  contactEmail?: string;
  /** Google AdMob / AdSense 등 광고 SDK 사용 여부 */
  usesAds?: boolean;
  /** Firebase Analytics / Crashlytics 등 분석·오류 수집 도구 사용 여부 */
  usesAnalytics?: boolean;
}

const PLACEHOLDER_PATTERN = /\[\[[^\]]*\]\]/;

/** 아직 채우지 않은 [[ ... ]] 자리표시자가 남아 있는지 확인 */
export function hasUnfilledPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERN.test(text);
}

export function buildPrivacyTemplate({
  title,
  contactEmail,
  usesAds = false,
  usesAnalytics = false,
}: PrivacyTemplateOptions): string {
  const appName = title.trim() || "[[앱 이름]]";
  const email = contactEmail?.trim() || "[[문의 이메일]]";

  const collected: string[] = [];
  if (usesAds) {
    collected.push(
      "- 광고 식별자(Android 광고 ID, iOS IDFA), 기기 정보, 대략적인 위치, 광고 노출·클릭 기록 (광고 SDK가 자동 수집)"
    );
  }
  if (usesAnalytics) {
    collected.push(
      "- 앱 사용 기록, 오류·충돌 기록, 기기 모델 및 OS 버전 (분석·오류 수집 도구가 자동 수집)"
    );
  }
  collected.push(
    "- [[앱이 직접 수집하는 정보를 적어 주세요. 예: 이메일, 닉네임. 수집하지 않으면 이 줄을 지우고 아래 문장을 남기세요]]",
    "- 앱이 회원가입이나 서버 전송 없이 모든 데이터를 사용자 기기에만 저장하는 경우, 별도의 개인정보를 수집하지 않습니다."
  );

  const thirdParty: string[] = [];
  if (usesAds) {
    thirdParty.push(
      "- **Google AdMob**: 광고 게재 및 성과 측정. 개인정보처리방침: https://policies.google.com/privacy"
    );
  }
  if (usesAnalytics) {
    thirdParty.push(
      "- **Google Firebase (Analytics, Crashlytics)**: 이용 통계 및 오류 분석. 개인정보처리방침: https://policies.google.com/privacy"
    );
  }
  if (thirdParty.length === 0) {
    thirdParty.push("- 이 앱은 개인정보를 제3자에게 제공하거나 처리를 위탁하지 않습니다.");
  }

  const adsSection = usesAds
    ? `
## 5. 광고에 관한 안내

이 앱은 Google AdMob 등 제3자 광고 서비스를 사용합니다. Google을 포함한 제3자 공급업체는 광고 식별자와 이전 앱 사용 기록을 바탕으로 맞춤 광고를 게재할 수 있습니다.

- 맞춤 광고는 [Google 광고 설정](https://adssettings.google.com)에서 해제할 수 있습니다.
- 기기 설정에서도 광고 ID를 재설정하거나 맞춤 광고를 끌 수 있습니다. (Android: 설정 > Google > 광고 / iOS: 설정 > 개인정보 보호 및 보안 > 추적)
`
    : "";

  const base = usesAds ? 6 : 5;

  return `# ${appName} 개인정보처리방침

'${appName}'(이하 "앱")은 이용자의 개인정보를 소중하게 다루며, 「개인정보 보호법」 등 관련 법령을 준수합니다. 이 방침은 앱이 어떤 정보를 어떤 목적으로 처리하는지 안내합니다.

## 1. 수집하는 개인정보 항목

${collected.join("\n")}

## 2. 수집 및 이용 목적

- 앱 기능 제공 및 서비스 품질 개선
- 오류 분석 및 안정성 향상${usesAds ? "\n- 광고 게재 및 광고 성과 측정" : ""}

## 3. 보유 및 이용 기간

수집한 정보는 이용 목적이 달성되면 지체 없이 파기합니다. 이용자가 앱을 삭제하거나 삭제를 요청하는 경우에도 지체 없이 파기하며, 법령에서 보관 의무를 정한 경우에는 해당 기간 동안 보관합니다.

## 4. 제3자 제공 및 처리 위탁

${thirdParty.join("\n")}
${adsSection}
## ${base}. 이용자의 권리

이용자는 언제든지 자신의 개인정보에 대해 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 아래 문의처로 연락해 주시면 지체 없이 조치하겠습니다.

## ${base + 1}. 아동의 개인정보

이 앱은 만 14세 미만 아동으로부터 법정대리인의 동의 없이 개인정보를 수집하지 않습니다.

## ${base + 2}. 개인정보 보호책임자 및 문의처

- 책임자: 부영실
- 이메일: ${email}

## ${base + 3}. 방침의 변경

이 방침의 내용이 변경되는 경우 앱 소개 페이지를 통해 변경 사항을 공지합니다. 시행일은 이 페이지 상단에 표시된 날짜를 기준으로 합니다.
`;
}