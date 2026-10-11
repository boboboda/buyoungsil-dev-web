// app/api/admin/factory/release/route.ts
// 통제실 "출시 패키지": 배포 계정 A/B, 앱별 출시 상태, 출시 일감 보내기(+승인), 재시도, 키 비밀번호 등록, 키 점검. 관리자만.
// 키 비밀번호는 setKeyPassword 로 들어오기만 하고, 어떤 응답에도 다시 나가지 않는다(등록 상태만).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { APP_SLUG_RE, ID_RE, adminAction } from "@/lib/factory/jobs";
import { registerKeyPassword } from "@/lib/factory/keyPasswords";
import { enqueueReleaseJob } from "@/lib/factory/mcp";
import prisma from "@/lib/prisma";
import { savePromoVideoUrl } from "@/lib/factory/storeAssets";
import {
  createSharedKey,
  deleteKey,
  registerExistingKey,
  requestKeyCheck,
  retryCreateKey,
  setVaultKeyPassword,
  updateKey,
} from "@/lib/factory/keyVault";
import {
  RELEASE_KIND_LABELS,
  UPDATE_ITEMS,
  effectiveKey,
  isReleaseKind,
  releaseOverview,
  removeAppRelease,
  requestKeyScan,
  retryRelease,
  saveReleaseAccount,
  updateAppRelease,
} from "@/lib/factory/release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await releaseOverview());
}

// 키 비밀번호를 받을 키: 배포 계정 공용 키(accountId) 또는 앱별 다른 키(appSlug)
async function keyTarget(body: Record<string, unknown>) {
  if (typeof body.accountId === "string") {
    const acc = await prisma.factoryReleaseAccount.findUnique({ where: { id: body.accountId }, include: { defaultKey: true } });

    return acc ? effectiveKey(null, acc) : null;
  }
  if (typeof body.appSlug === "string" && APP_SLUG_RE.test(body.appSlug)) {
    const app = await prisma.factoryApp.findUnique({ where: { appSlug: body.appSlug }, include: { key: true } });
    const key = app ? effectiveKey(app, null) : null;

    return key?.source === "custom" ? key : null;
  }

  return null;
}

// 본문: { action: "saveAccount", ...계정 } | { action: "updateApp", appSlug, releaseAccountId?, releaseStatus?, packageName?, firstUploadDone?, customKeystorePath?, customKeyAlias? }
//       | { action: "enqueueRelease", appSlug, kind?: first|store|project, runNow?, overwriteProject? }  (통제실 '승인'은 runNow: true 로 일감 생성 + 승인.
//         overwriteProject: store/project 만, 홈페이지 프로젝트 기존 값도 덮어쓰기. 기본 꺼짐.
//         updateItems: store/project 는 필수(1개 이상). store=images|listing|video|privacy, project=description|cover|privacy)
//       | { action: "savePromoVideo", appSlug, url }  (홍보 영상 YouTube 링크. 빈 값이면 지움)
//       | { action: "retryRelease", jobId }  (실패한 단계부터 다시)
//       | { action: "setKeyPassword", keyId | accountId | appSlug, storePassword, keyPassword? }
//       키 보관함: { action: "vaultCreate", name, keystorePath?, keyAlias?, dname?, description?, password, password2 }  (PC 가 keytool 로 만듦, 있으면 덮어쓰지 않음)
//                | { action: "vaultRegister", name, kind?, keystorePath, keyAlias?, description?, production?, storePassword, keyPassword? }  (등록만)
//                | { action: "vaultUpdate", keyId, name?, kind?, description?, production? } | { action: "vaultDelete", keyId }  (보관함 항목만, PC 파일은 그대로)
//                | { action: "vaultCheck", keyId }  (PC 가 그 파일을 확인) | { action: "vaultRetry", keyId }  (실패한 공용 키 만들기 다시)
//       | { action: "requestKeyScan", appSlug? }  (appSlug 를 주면 그 앱 하나만 점검)
//       | { action: "removeApps", appSlugs: string[] }  (출시 패키지 목록에서만 지움. 지시 기록·앱 소스·PC 파일은 그대로)
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";
  let res: { ok: boolean; status: number; message: string };

  if (action === "saveAccount") {
    res = await saveReleaseAccount(body ?? {});
  } else if (action === "updateApp") {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 가 올바르지 않아요." }, { status: 400 });
    res = await updateAppRelease(appSlug, body ?? {});
  } else if (action === "enqueueRelease") {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 가 올바르지 않아요." }, { status: 400 });
    if (body?.kind !== undefined && !isReleaseKind(body.kind)) {
      return NextResponse.json({ message: "kind 는 first, store, project 중 하나예요." }, { status: 400 });
    }
    const kind = isReleaseKind(body?.kind) ? body.kind : "first";

    // 통제실에서는 갱신 항목을 반드시 고른다(커넥터는 빼면 예전 범위)
    if (UPDATE_ITEMS[kind] && !Array.isArray(body?.updateItems)) {
      return NextResponse.json({ message: "갱신할 항목을 하나 이상 고르세요." }, { status: 400 });
    }
    // 커넥터 도구(enqueue_release_job)와 같은 함수: 지시문은 배포 계정 정보로 서버가 만든다
    const r = await enqueueReleaseJob({
      appSlug,
      kind,
      source: "통제실 출시 패키지",
      overwriteProject: body?.overwriteProject === true,
      ...(UPDATE_ITEMS[kind] ? { updateItems: body?.updateItems } : {}),
    });
    const message = r.content[0]?.text ?? "";

    if (r.isError) return NextResponse.json({ message }, { status: 409 });
    const id = /id: ([A-Za-z0-9_-]+)/.exec(message)?.[1];

    if (body?.runNow === true && id) {
      const approved = await adminAction(id, { action: "approve" });

      res = { ok: true, status: 200, message: approved.ok ? `${RELEASE_KIND_LABELS[kind]} 일감을 만들고 승인했어요.` : message };
    } else {
      res = { ok: true, status: 200, message: `${RELEASE_KIND_LABELS[kind]} 일감을 보냈어요. 승인하면 시작해요.` };
    }
  } else if (action === "savePromoVideo") {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 가 올바르지 않아요." }, { status: 400 });
    res = await savePromoVideoUrl(appSlug, body?.url ?? null);
  } else if (action === "retryRelease") {
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";

    if (!ID_RE.test(jobId)) return NextResponse.json({ message: "jobId 가 올바르지 않아요." }, { status: 400 });
    res = await retryRelease(jobId);
  } else if (typeof action === "string" && action.startsWith("vault")) {
    const keyId = typeof body?.keyId === "string" ? body.keyId : "";

    if (action === "vaultCreate") res = await createSharedKey(body ?? {});
    else if (action === "vaultRegister") res = await registerExistingKey(body ?? {});
    else if (!ID_RE.test(keyId)) return NextResponse.json({ message: "keyId 가 올바르지 않아요." }, { status: 400 });
    else if (action === "vaultUpdate") res = await updateKey(keyId, body ?? {});
    else if (action === "vaultDelete") res = await deleteKey(keyId);
    else if (action === "vaultCheck") res = await requestKeyCheck(keyId);
    else if (action === "vaultRetry") res = await retryCreateKey(keyId);
    else return NextResponse.json({ message: "알 수 없는 키 보관함 동작이에요." }, { status: 400 });
  } else if (action === "setKeyPassword" && typeof body?.keyId === "string") {
    if (!ID_RE.test(body.keyId)) return NextResponse.json({ message: "keyId 가 올바르지 않아요." }, { status: 400 });
    res = await setVaultKeyPassword(body.keyId, body.storePassword, body.keyPassword);
  } else if (action === "setKeyPassword") {
    const key = await keyTarget(body ?? {});

    if (!key) return NextResponse.json({ message: "비밀번호를 등록할 키 경로가 없어요. 먼저 키 경로를 저장하세요." }, { status: 400 });
    res = await registerKeyPassword(key.path, key.alias, body?.storePassword, body?.keyPassword);
  } else if (action === "requestKeyScan") {
    if (body?.appSlug !== undefined && !APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 가 올바르지 않아요." }, { status: 400 });
    res = await requestKeyScan(appSlug || undefined);
  } else if (action === "removeApps") {
    const slugs = Array.isArray(body?.appSlugs) ? body.appSlugs.filter((s): s is string => typeof s === "string").map((s) => s.trim()) : [];

    if (slugs.length > 50 || slugs.some((s) => !APP_SLUG_RE.test(s))) return NextResponse.json({ message: "appSlugs 가 올바르지 않아요." }, { status: 400 });
    res = await removeAppRelease(slugs);
  } else {
    return NextResponse.json(
      {
        message:
          "action 은 saveAccount, updateApp, enqueueRelease, savePromoVideo, retryRelease, setKeyPassword, requestKeyScan, removeApps, vaultCreate, vaultRegister, vaultUpdate, vaultDelete, vaultCheck, vaultRetry 중 하나예요.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ message: res.message, ...(res.ok ? await releaseOverview() : {}) }, { status: res.status });
}
