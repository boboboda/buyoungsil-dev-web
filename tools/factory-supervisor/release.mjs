// 앱 공장 감독 프로그램: 출시(반자동) 관련
// - 출시 준비 일감(kind=release)의 작업 규칙
// - 일감이 끝나면 앱 폴더 .factory/outbox/ 의 정해진 파일만, 정해진 홈페이지 주소로 보낸다(그 밖의 파일·주소는 없다)
// - 배포 계정 키 파일이 PC 에 "있는지"만 확인해 알린다(파일 내용은 읽지 않는다)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// outbox 파일 이름 → 보낼 주소. 이 목록에 없는 파일은 보내지 않는다.
const OUTBOX = {
  "project.json": "/api/factory/project", // 홈페이지 프로젝트의 빈 항목만 채움(이미 있는 값은 서버가 덮어쓰지 않음)
  "release.json": "/api/factory/release", // 출시 패키지(스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·방침 초안·AAB 정보)
};
const MAX_OUTBOX_BYTES = 300 * 1024;
const PROJECT_KEYS = ["description", "coverImage", "appLink", "techStack", "privacyPolicy"];

export function releaseRules(job) {
  if (job.kind !== "release") return "";
  return `
## 출시 준비 (이 일감은 kind=release)
- RELEASE_REQUEST.md 가 이번 지시예요. 앱 기능은 바꾸지 말고 출시 자료만 만드세요(꼭 필요한 빌드 설정 변경만).
- 결과는 \`.factory/outbox/\` 에 JSON 파일 두 개로 저장하세요. 감독 프로그램이 일감이 끝날 때 홈페이지로 보내요. 다른 파일 이름은 보내지 않아요.
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
- 스토어 업로드는 RELEASE_REQUEST.md 가 허락한 경우에만, 비공개 테스트 트랙에만 하세요. 프로덕션 트랙은 절대 건드리지 마세요.
`;
}

// AAB 정보는 실제 파일을 보고 채운다(앱 폴더 안의 .aab 만). 없으면 빼고 이유를 돌려준다.
function realAab(dir, aab) {
  if (!aab || typeof aab !== "object" || typeof aab.path !== "string") return { aab: undefined };
  const full = path.resolve(dir, aab.path);
  if (!full.startsWith(dir + path.sep) || !full.toLowerCase().endsWith(".aab")) return { aab: undefined, warn: `AAB 경로가 앱 폴더 밖이거나 .aab 가 아니라서 뺐어요: ${aab.path}` };
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return { aab: undefined, warn: `AAB 파일이 없어서 뺐어요: ${aab.path}` };
  }
  return {
    aab: {
      path: full,
      size: st.size,
      versionName: typeof aab.versionName === "string" ? aab.versionName : null,
      versionCode: Number.isInteger(aab.versionCode) ? aab.versionCode : null,
      builtAt: st.mtime.toISOString(),
    },
  };
}

// 일감이 끝날 때(완료 보고 전에) 부른다. 보낸 파일은 .factory/outbox/sent/ 로 옮긴다.
export async function sendOutbox({ dir, job, api, addLog }) {
  const box = path.join(dir, ".factory", "outbox");
  let names = [];
  try {
    names = fs.readdirSync(box).filter((n) => fs.statSync(path.join(box, n)).isFile());
  } catch {
    return;
  }
  for (const name of names) {
    const endpoint = OUTBOX[name];
    if (!endpoint) {
      addLog("warn", `outbox 의 ${name} 은 보낼 수 있는 파일이 아니라서 건너뛰어요(허용: ${Object.keys(OUTBOX).join(", ")}).`);
      continue;
    }
    const full = path.join(box, name);
    let data;
    try {
      if (fs.statSync(full).size > MAX_OUTBOX_BYTES) throw new Error(`${MAX_OUTBOX_BYTES / 1024}KB 를 넘어요`);
      data = JSON.parse(fs.readFileSync(full, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON 객체가 아니에요");
    } catch (e) {
      addLog("warn", `outbox ${name} 을 읽지 못했어요: ${e.message}`);
      continue;
    }
    let body;
    if (name === "project.json") {
      body = { appSlug: job.appSlug };
      for (const k of PROJECT_KEYS) if (data[k] !== undefined) body[k] = data[k];
    } else {
      const { aab, warn } = realAab(dir, data.aab);
      if (warn) addLog("warn", warn);
      body = { ...data, jobId: job.id, aab };
    }
    try {
      const r = await api("POST", endpoint, body);
      const msg = r.data?.message ?? "";
      if (r.status === 200) {
        addLog("info", `outbox ${name} 보냄: ${msg}`);
        fs.mkdirSync(path.join(box, "sent"), { recursive: true });
        fs.renameSync(full, path.join(box, "sent", `${job.id}-${name}`));
      } else {
        addLog("warn", `outbox ${name} 보내기 거절(${r.status}): ${msg}`);
      }
    } catch (e) {
      addLog("warn", `outbox ${name} 보내기 오류: ${e.message}`);
    }
  }
}

// ───────── 배포 계정 키 파일 존재 확인 ─────────
const expand = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);
const ALLOWED_EXT = [".jks", ".keystore", ".json"];
let lastPcSig = "";
let lastPcAt = 0;

// /next 응답의 pcPaths 를 받아, 바뀌었거나 10분이 지났으면 존재 여부만 알린다. 내용은 읽지 않는다.
export async function reportPcPaths(pcPaths, api, log) {
  if (!Array.isArray(pcPaths) || pcPaths.length === 0) return;
  const sig = JSON.stringify(pcPaths);
  if (sig === lastPcSig && Date.now() - lastPcAt < 10 * 60 * 1000) return;
  lastPcSig = sig;
  lastPcAt = Date.now();
  const items = [];
  for (const it of pcPaths.slice(0, 20)) {
    if (!it || typeof it.key !== "string" || typeof it.path !== "string") continue;
    if (!ALLOWED_EXT.some((e) => it.path.toLowerCase().endsWith(e))) continue; // 키 파일 확장자만 확인한다
    let st = null;
    try {
      st = fs.statSync(path.resolve(expand(it.path)));
    } catch {
      /* 없음 */
    }
    items.push({ key: it.key, path: it.path, exists: !!st && st.isFile(), size: st?.isFile() ? st.size : null, mtime: st ? st.mtime.toISOString() : null });
  }
  try {
    const r = await api("POST", "/api/factory/pc-status", { items });
    if (r.status !== 200) log(`키 파일 확인 결과 보내기 거절(${r.status})`);
  } catch (e) {
    log(`키 파일 확인 결과 보내기 오류: ${e.message}`);
  }
}
