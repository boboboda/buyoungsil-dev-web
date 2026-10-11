// lib/factory/rules.ts
// 감독 프로그램이 앱 폴더 CLAUDE.md 에 넣는 작업 규칙과 Claude 에게 주는 첫 지시문(프롬프트).
// 서버에 두고 일감을 내줄 때 같이 보낸다(/api/factory/next 의 job.rules, job.prompt). 감독 프로그램은 이 값이 없으면 자기 코드 안 기본값을 쓴다.
// 통제실 설정에서 구역(section)별로 고칠 수 있다(factorySetting "workRules"). 고친 값이 없으면 아래 기본값.
//
// 자리표시자: {{appSlug}} {{title}} {{stack}} {{pkg}}(appSlug 의 - 를 _ 로) 는 서버가 채운다.
//            {{ANDROID_SDK}} 는 PC 마다 달라서 감독 프로그램이 채운다.
// 주의: 이 글은 작업 PC 에서 Bash 를 쓸 수 있는 Claude 에게 그대로 전달된다. 관리자만 고칠 수 있다.
import prisma from "@/lib/prisma";

const KEY = "workRules";
const MAX_SECTION = 8000;

export const RULE_SECTIONS = [
  { id: "intro", label: "머리말과 공통 규칙(앞)" },
  { id: "stack:flutter", label: "앱 종류: Flutter" },
  { id: "stack:kotlin-compose", label: "앱 종류: Kotlin + Compose" },
  { id: "stack:swift-swiftui", label: "앱 종류: SwiftUI" },
  { id: "stack:nextjs", label: "앱 종류: Next.js" },
  { id: "stack:nestjs", label: "앱 종류: NestJS" },
  { id: "stack:default", label: "앱 종류: 그 밖" },
  { id: "common", label: "공통 규칙(뒤): 키·백그라운드·진행 단계·스크린샷·결과 요약" },
  { id: "release", label: "출시 준비 일감(kind=release)" },
  { id: "prompt:new", label: "첫 지시문: 새 앱" },
  { id: "prompt:revision", label: "첫 지시문: 수정" },
  { id: "prompt:release", label: "첫 지시문: 출시 준비" },
] as const;
export type RuleSectionId = (typeof RULE_SECTIONS)[number]["id"];

export const DEFAULT_RULES: Record<RuleSectionId, string> = {
  intro: `# 앱 공장 작업 규칙 (자동 생성, 이 블록은 수정하지 마세요)

- 앱 이름(폴더 이름): {{appSlug}} / 표시 이름: {{title}} / 종류: {{stack}}
- 사람에게 질문하지 마세요. 정보가 모자라면 합리적으로 가정하고 ASSUMPTIONS.md 에 한 줄씩 적으세요.
- 새 앱이면 PLAN.md 가 기획서입니다. 수정 지시면 CHANGE_REQUEST.md 에 적힌 내용만 반영하고 나머지는 건드리지 마세요.
- 폴더에 이미 작업물이 있으면 처음부터 다시 만들지 말고 이어서 진행하세요. 기획서의 MVP 범위만 구현하고 범위 밖 기능은 추가하지 마세요.`,
  "stack:flutter": `- Flutter 앱입니다. 프로젝트가 없을 때만 \`flutter create . --project-name {{pkg}}\` 로 만드세요.
- 끝내기 전에 \`flutter analyze\` 를 통과시키세요. 가능하면 \`flutter build apk --debug\` 도 시도하고, 환경 때문에 못 하면 그 이유를 결과에 적으세요.
- 스크린샷은 위젯 테스트(골든 등)로 화면을 그려 만들 수 있습니다.`,
  "stack:kotlin-compose": `- Android 네이티브 앱(Kotlin + Jetpack Compose, Material 3, 단일 Activity)입니다. 패키지 이름은 \`com.factory.{{pkg}}\` 로 하세요.
- 프로젝트가 없을 때만 Gradle Kotlin DSL(settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml) 구조로 직접 만드세요.
- 이 PC에는 \`gradle\` 명령이 없습니다. gradlew 가 없으면 Gradle 배포판을 내려받아 \`gradle wrapper\` 로 gradlew 를 만드세요(배포판은 앱 폴더 밖 임시 폴더에).
- Android SDK: {{ANDROID_SDK}}
- 끝내기 전에 \`./gradlew assembleDebug\` 를 통과시키세요. 단위 테스트가 있으면 \`./gradlew testDebugUnitTest\` 도 돌리세요.
- 스크린샷은 가능하면 Compose 프리뷰 렌더링(예: Paparazzi/Roborazzi)으로 만들고, 어려우면 건너뛰세요.`,
  "stack:swift-swiftui": `- iOS 네이티브 앱(SwiftUI)입니다. **이 작업 PC는 Windows라 Swift·Xcode 가 없어서 빌드와 실행을 할 수 없습니다.**
- 소스는 \`Sources/\`(App, Views, Models)에 두고, Mac에서 바로 열 수 있게 XcodeGen 용 \`project.yml\` 을 만드세요(번들 ID \`com.factory.{{appSlug}}\`, iOS 17 이상).
- 컴파일 확인을 못 하니 표준 SwiftUI/Foundation API 만 쓰고, 외부 패키지는 꼭 필요할 때만 Swift Package 로 적으세요.
- README.md 에 Mac에서 여는 방법(\`brew install xcodegen && xcodegen\` → Xcode 실행)을 적으세요. 결과 요약에 "빌드 확인 안 됨"을 분명히 적으세요.
- 스크린샷은 만들 수 없으니 건너뛰세요.`,
  "stack:nextjs": `- 웹 앱(Next.js App Router, TypeScript)입니다. 프로젝트가 없을 때만 \`npx create-next-app@latest . --ts --eslint --app --src-dir --use-npm --yes\` 로 만드세요.
- 끝내기 전에 \`npm run lint\` 와 \`npm run build\` 를 통과시키세요.
- 스크린샷은 가능하면 \`next start\` 로 띄운 뒤 Playwright 로 주요 화면을 찍으세요. 띄운 서버는 끝내기 전에 반드시 종료하세요.`,
  "stack:nestjs": `- 백엔드 API 서버(NestJS, TypeScript)입니다. 프로젝트가 없을 때만 \`npx @nestjs/cli@latest new . --package-manager npm --skip-git\` 로 만드세요.
- 끝내기 전에 \`npm run build\` 와 \`npm test\` 를 통과시키세요. 주요 API 는 e2e 테스트(\`npm run test:e2e\`)로 확인하세요.
- README.md 에 API 목록(메서드, 경로, 요청·응답 예)을 적으세요. DB 가 필요하면 기획서에 정해진 게 없을 때 SQLite 로 하세요.
- 화면이 없으니 스크린샷은 건너뛰세요. 띄운 서버는 끝내기 전에 반드시 종료하세요.`,
  "stack:default": `- 앱 종류 '{{stack}}' 에 맞는 표준 도구로 프로젝트를 만들고, 끝내기 전에 그 도구의 분석·빌드·테스트를 통과시키세요.`,
  common: `- 외부 서비스 키는 환경변수로만 읽을 수 있습니다(이 지시에 허용된 이름만). 키 값을 파일, 로그, 커밋에 쓰거나 출력하지 마세요.
- 에뮬레이터, 개발 서버, 감시 프로세스처럼 백그라운드로 띄운 것은 마지막 응답 전에 반드시 직접 끄세요. 남아 있으면 작업이 끝나지 않아 감독 프로그램이 강제로 정리해요.
- 진행 단계가 바뀔 때마다 .factory/phase.txt 에 한 단어(scaffold, code, build, screenshots, done 중 하나)를 덮어써 주세요.
- 화면 스크린샷을 만들 수 있으면 .factory/screenshots/ 에 png 로 저장하세요(예: home.png, result.png). 못 만들면 건너뛰세요.
- 마지막 응답은 한국어 3~6줄 결과 요약으로 하세요: 만든 화면, 분석/빌드 결과, 사람이 해야 할 일.`,
  release: `## 출시 준비 (이 일감은 kind=release)
- RELEASE_REQUEST.md 가 이번 지시예요(종류: 첫 출시 / 스토어 자료 수정 / 프로젝트 업데이트). 앱 기능은 바꾸지 말고 그 종류가 허락한 것만 하세요.
- 진행 단계는 RELEASE_REQUEST.md 의 단계 이름(key, build, sign, store, upload, homepage, done)으로 .factory/phase.txt 에 쓰고(위 공통 규칙의 단계 이름 대신),
  더 진행할 수 없으면 .factory/fail.json 에 {"stage": "단계", "reason": "이유"} 를 쓰고 끝내세요(비밀번호·키 값 금지).
- 결과는 \`.factory/outbox/\` 에 JSON 파일로 저장하세요(첫 출시: 아래 두 개, 스토어 자료 수정: release.json, 프로젝트 업데이트: project.json). 감독 프로그램이 일감이 끝날 때 홈페이지로 보내요. 다른 파일 이름은 보내지 않아요.
  - \`project.json\` (홈페이지 프로젝트의 빈 항목만 채워요): {"description": "소개 2~3문장", "privacyPolicy": "개인정보처리방침 마크다운"}
    - 방침에 [[ ... ]] 자리표시자를 남기지 마세요(남으면 거절돼요). 모르는 값은 release.json 의 checklist 에 적으세요.
  - \`release.json\`:
    {"storeListing": {"ko": {"title": "30자 이내", "shortDescription": "80자 이내", "fullDescription": "4000자 이내"}, "en": {...같은 형식}},
     "dataSafety": {"collects": false, "shares": false, "items": [{"type": "데이터 유형", "purpose": "목적", "optional": true}], "encryptedInTransit": true, "deletionRequest": "삭제 요청 방법"},
     "contentRating": {"violence": "없음", "sexual": "없음", "language": "없음", "drugs": "없음", "gambling": "없음", "userInteraction": "없음", "sharesLocation": false, "digitalPurchases": false, "summary": "예상 등급"},
     "checklist": [{"item": "할 일", "done": false, "note": "설명"}],
     "privacyPolicyDraft": "project.json 과 같은 방침 마크다운",
     "sdks": ["코드에서 찾은 광고·분석·오류 수집 SDK 이름"],
     "notes": "사람이 알아야 할 것",
     "aab": {"path": "build/app/outputs/bundle/release/app-release.aab", "versionName": "1.0.0", "versionCode": 1}}
  - aab 는 실제로 서명 빌드를 만든 경우에만 넣으세요. 경로는 앱 폴더 기준. 파일은 PC 에만 두고 서버로 올리지 않아요(크기·시각은 감독 프로그램이 채워요).
- 서명 키·서비스 계정 키 파일은 RELEASE_REQUEST.md 에 적힌 PC 경로에서 읽기만 하세요. 앱 폴더로 복사하거나 커밋하지 마세요.
- 비밀번호는 환경변수로만 읽고, 파일·로그·커밋·JSON 에 쓰지 마세요.
- 스토어 업로드는 RELEASE_REQUEST.md 가 허락한 경우에만, 비공개 테스트 트랙에만 하세요. 프로덕션 트랙은 절대 건드리지 마세요.`,
  "prompt:new": "PLAN.md 의 기획서대로 앱의 MVP 를 만드세요. CLAUDE.md 의 작업 규칙을 따르세요. 폴더에 이미 작업물이 있으면 이어서 진행하세요.",
  "prompt:revision":
    "CHANGE_REQUEST.md 에 적힌 수정 내용만 이 앱에 반영하세요. 기존 기획은 PLAN.md 를 참고하되 요청 밖의 부분은 바꾸지 마세요. CLAUDE.md 의 작업 규칙을 따르세요.",
  "prompt:release":
    "RELEASE_REQUEST.md 에 적힌 출시 일감(종류와 허락된 동작)대로 하세요. 앱 기능은 바꾸지 말고, CLAUDE.md 작업 규칙의 '출시 준비' 형식대로 .factory/outbox/ 에 결과를 저장하세요. 재시도 안내가 있으면 그 단계부터 이어서 하세요.",
};

const isSection = (id: string): id is RuleSectionId => RULE_SECTIONS.some((s) => s.id === id);

export async function getRuleOverrides(): Promise<Partial<Record<RuleSectionId, string>>> {
  const row = await prisma.factorySetting.findUnique({ where: { key: KEY } });

  if (!row) return {};
  try {
    const v = JSON.parse(row.value) as Record<string, unknown>;
    const out: Partial<Record<RuleSectionId, string>> = {};

    for (const [k, t] of Object.entries(v)) if (isSection(k) && typeof t === "string") out[k] = t;

    return out;
  } catch {
    return {};
  }
}

/** 구역 하나를 고친다. text 가 null 이면 기본값으로 되돌린다. */
export async function setRuleOverride(section: string, text: string | null): Promise<{ ok: boolean; message: string }> {
  if (!isSection(section)) return { ok: false, message: "없는 구역이에요." };
  const cur = await getRuleOverrides();

  if (text === null || text.trim() === DEFAULT_RULES[section].trim()) delete cur[section];
  else {
    const t = text.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();

    if (!t) return { ok: false, message: "비워 둘 수는 없어요. 기본값으로 되돌리려면 '기본값' 을 누르세요." };
    if (t.length > MAX_SECTION) return { ok: false, message: `${MAX_SECTION}자 이하로 적어 주세요.` };
    if (t.includes("<!-- factory:")) return { ok: false, message: "<!-- factory: 표시는 쓸 수 없어요(규칙 블록 경계)." };
    cur[section] = t;
  }
  const value = JSON.stringify(cur);

  await prisma.factorySetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });

  return { ok: true, message: text === null ? "기본값으로 되돌렸어요." : "저장했어요. 다음 일감부터 적용돼요." };
}

export interface RuleJob {
  appSlug: string;
  title: string;
  stack: string;
  kind: string;
}

const fill = (t: string, job: RuleJob) =>
  t
    .replace(/\{\{appSlug\}\}/g, job.appSlug)
    .replace(/\{\{title\}\}/g, job.title)
    .replace(/\{\{stack\}\}/g, job.stack)
    .replace(/\{\{pkg\}\}/g, job.appSlug.replace(/-/g, "_"));

/** 일감 하나에 맞춘 작업 규칙(블록 경계 표시는 감독 프로그램이 붙인다)과 첫 지시문. */
export function renderRules(job: RuleJob, overrides: Partial<Record<RuleSectionId, string>>): { rules: string; prompt: string } {
  const pick = (id: RuleSectionId) => overrides[id] ?? DEFAULT_RULES[id];
  const stackId = `stack:${job.stack}`;
  const stack = isSection(stackId) ? pick(stackId) : pick("stack:default");
  const parts = [pick("intro"), stack, pick("common")];

  if (job.kind === "release") parts.push("", pick("release"));
  const promptId = job.kind === "release" ? "prompt:release" : job.kind === "revision" ? "prompt:revision" : "prompt:new";

  return { rules: fill(parts.join("\n"), job), prompt: fill(pick(promptId), job) };
}
