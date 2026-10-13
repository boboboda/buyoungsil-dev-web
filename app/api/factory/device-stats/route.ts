// app/api/factory/device-stats/route.ts
// 서버1·서버2·메인PC 가 1분마다 장비 상태(숫자만)를 보내는 주소. 통제실 [사용량] '장비 상태' 패널이 읽는다.
//
// 요청: POST, 헤더 Authorization: Bearer <토큰>, 본문 JSON(8KB 까지)
//   토큰: 상태 수신 토큰(CLAUDE_STATUS_TOKEN, 서버1·서버2 수집 스크립트) 또는 작업 PC 토큰(메인PC 감독 프로그램)
//   {
//     "device": "server1 | server2 | main-pc",   // 이 셋만
//     "measuredAt": 유닉스 초,                    // 선택. 1시간 넘게 지난 값은 거부
//     "cpuPct": 0~100,
//     "ram": { "usedGb": 12.3, "totalGb": 31.2 },
//     "gpu": { "state": "ok", "list": [{ "utilPct", "memUsedGb", "memTotalGb", "tempC" }] } | { "state": "none" | "unknown" },
//     "disks": [{ "mount": "/" | "C:", "usedGb", "totalGb" }],   // 최대 4개
//     "containers": { "state": "ok", "names": ["web", …] } | { "state": "unknown" }  // 서버1만, 컨테이너 이름만
//   }
// 정해진 필드 외의 값은 버린다. 범위 밖·음수·숫자 아닌 값은 400, 토큰이 틀리면 401.
import { NextRequest, NextResponse } from "next/server";

import { isValidClaudeStatusToken } from "@/lib/claude-status/auth";
import { isValidFactoryWorkerToken } from "@/lib/factory/auth";
import {
  MAX_DEVICE_BODY_CHARS,
  saveDeviceStat,
  validateDevicePayload,
} from "@/lib/factory/devices";
import { getClientIP, hit } from "@/lib/factory/http";
import { noteDeviceReport } from "@/lib/factory/supervisorLog";
import { saveToolkitInfo, validateToolkitReport } from "@/lib/factory/toolkit";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PER_IP_PER_WINDOW = 60;
const MAX_AUTH_FAILS_PER_WINDOW = 20;

const fail = (status: number, message: string) =>
  NextResponse.json({ message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);

  if (hit(`device-stats-ip:${ip}`, MAX_PER_IP_PER_WINDOW))
    return fail(429, "요청이 너무 많습니다.");

  const authorization = req.headers.get("authorization");
  const allowed =
    isValidClaudeStatusToken(authorization) ||
    (await isValidFactoryWorkerToken(authorization));

  if (!allowed) {
    if (hit(`device-stats-fail:${ip}`, MAX_AUTH_FAILS_PER_WINDOW))
      return fail(429, "요청이 너무 많습니다.");

    return fail(401, "권한이 없습니다.");
  }

  const declared = Number(req.headers.get("content-length") ?? 0);

  if (declared > MAX_DEVICE_BODY_CHARS) return fail(413, "요청이 너무 큽니다.");

  let body: unknown;

  try {
    const text = await req.text();

    if (text.length > MAX_DEVICE_BODY_CHARS)
      return fail(413, "요청이 너무 큽니다.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "JSON 형식이 아닙니다.");
  }

  // 툴킷 도구 목록(감독 프로그램만): { device:"main-pc", toolkit:{…} }. 장비 숫자와 섞지 않고 따로 저장한다
  if (typeof body === "object" && body !== null && !Array.isArray(body) && "toolkit" in body) {
    if (!(await isValidFactoryWorkerToken(authorization))) return fail(401, "권한이 없습니다.");

    const parsed = validateToolkitReport((body as { toolkit: unknown }).toolkit);

    if (parsed.ok === false) return fail(400, parsed.reason);
    try {
      return NextResponse.json({ ok: true, saved: await saveToolkitInfo(prisma, parsed.info) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("[device-stats] 툴킷 도구 목록 저장 실패:", error);

      return fail(500, "저장에 실패했습니다.");
    }
  }

  const result = validateDevicePayload(body);

  if (result.ok === false) {
    const dev = typeof body === "object" && body !== null ? (body as { device?: unknown }).device : null;

    if (dev === "main-pc") await noteDeviceReport("main-pc", false, result.reason);

    return fail(400, result.reason);
  }

  try {
    await saveDeviceStat(result.payload);
    await noteDeviceReport(result.payload.device, true);

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[device-stats] 저장 실패:", error);
    await noteDeviceReport(result.payload.device, false, "저장 실패");

    return fail(500, "저장에 실패했습니다.");
  }
}
