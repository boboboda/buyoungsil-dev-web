import { writeFile, mkdir } from "fs/promises";
import path from "path";

import { auth } from "@/lib/auth/get-sesstion";

// /api/upload/local, /api/upload/video/local 공통: 관리자만, 허용 형식·크기만, 에러는 일반 문구로.
export type LocalUploadKind = {
  field: string; // formData 칸 이름
  dir: string; // public/uploads/<dir>
  urlKey: string; // 응답에서 주소를 담는 키(imageUrl/videoUrl)
  maxBytes: number;
  // 허용 MIME → 그 MIME 에 맞는 확장자(첫 번째가 기본)
  types: Record<string, string[]>;
  label: string;
};

export const IMAGE_UPLOAD: LocalUploadKind = {
  field: "image",
  dir: "images",
  urlKey: "imageUrl",
  maxBytes: 10 * 1024 * 1024,
  types: {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
  },
  label: "이미지",
};

// 상한은 앱 공장 영상 경로(app/api/factory/store-video 의 MAX_VIDEO)와 같게 둔다
export const VIDEO_UPLOAD: LocalUploadKind = {
  field: "video",
  dir: "videos",
  urlKey: "videoUrl",
  maxBytes: 120 * 1024 * 1024,
  types: {
    "video/mp4": ["mp4", "m4v"],
    "video/quicktime": ["mov"],
    "video/webm": ["webm"],
  },
  label: "영상",
};

function fail(status: number, error: string) {
  return Response.json({ success: false, error }, { status });
}

// 확장자는 검사한 MIME 에 맞는 것만 남기고, 아니면 MIME 의 기본 확장자로 바꾼다
export function safeUploadName(original: string, allowedExts: string[], now = Date.now()): string {
  const cleaned = original.replace(/[^a-zA-Z0-9.-]/g, "").replace(/^\.+/, "");
  const dot = cleaned.lastIndexOf(".");
  const base = (dot > 0 ? cleaned.slice(0, dot) : cleaned).replace(/\./g, "").slice(0, 80) || "file";
  const ext = dot > 0 ? cleaned.slice(dot + 1).toLowerCase() : "";
  return `${now}-${base}.${allowedExts.includes(ext) ? ext : allowedExts[0]}`;
}

export async function handleLocalUpload(request: Request, kind: LocalUploadKind): Promise<Response> {
  const session = await auth().catch(() => null);
  if (!session) return fail(401, "로그인이 필요합니다.");
  if (session.user?.role !== "admin") return fail(403, "권한이 없습니다.");

  // 본문을 읽기 전에 선언된 크기로 먼저 거른다(multipart 여유 1MB)
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > kind.maxBytes + 1024 * 1024) {
    return fail(413, `${kind.label} 크기가 너무 큽니다 (최대 ${kind.maxBytes / 1024 / 1024}MB)`);
  }

  try {
    const formData = await request.formData();
    const file = formData.get(kind.field);

    if (!file || typeof file === "string" || file.size === 0) {
      return fail(400, "파일이 없습니다");
    }
    const exts = kind.types[file.type];
    if (!exts) {
      return fail(415, `허용하지 않는 ${kind.label} 형식입니다`);
    }
    if (file.size > kind.maxBytes) {
      return fail(413, `${kind.label} 크기가 너무 큽니다 (최대 ${kind.maxBytes / 1024 / 1024}MB)`);
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", kind.dir);
    await mkdir(uploadDir, { recursive: true }).catch(() => {});

    const uniqueFilename = safeUploadName(file.name, exts);
    await writeFile(path.join(uploadDir, uniqueFilename), new Uint8Array(await file.arrayBuffer()));

    return Response.json({ success: true, [kind.urlKey]: `/uploads/${kind.dir}/${uniqueFilename}` });
  } catch (error) {
    console.error("로컬 업로드 실패:", error instanceof Error ? error.name : "unknown");
    return fail(500, "업로드 중 오류가 발생했습니다.");
  }
}
