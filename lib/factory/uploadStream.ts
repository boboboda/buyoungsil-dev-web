// lib/factory/uploadStream.ts
// 큰 파일(검토용 영상)을 메모리에 통째로 올리지 않고 업로드 서버의 POST /upload/single(multipart, 필드 'file')로 흘려 보낸다.
// 요청 본문(원시 바이트)을 앞부분만 읽어 형식을 확인한 뒤, multipart 머리·본문·꼬리를 이어 붙인 스트림으로 바로 전달한다.
import { randomUUID } from "node:crypto";

import { uploadConfig } from "@/config/upload";

/** mp4 인지: 4~8바이트가 'ftyp' */
export function isMp4Head(buf: Uint8Array): boolean {
  return buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
}

/** 스트림 앞에서 최소 min 바이트를 읽는다(끝나면 그때까지). 돌려준 reader 로 나머지를 이어 읽는다 */
export async function readHead(body: ReadableStream<Uint8Array>, min: number) {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;

  while (n < min) {
    const { done, value } = await reader.read();

    if (done) break;
    parts.push(value);
    n += value.length;
  }
  const head = new Uint8Array(n);
  let at = 0;

  for (const p of parts) {
    head.set(p, at);
    at += p.length;
  }

  return { head, reader };
}

/**
 * head + reader 의 나머지를 multipart 'file' 필드 하나로 감싼 스트림. 합계가 expect 와 다르거나 max 를 넘으면 스트림을 오류로 끝낸다
 * (업로드 서버는 끊긴 요청을 저장하지 않는다). 돌려주는 값: { stream, contentType, received() }
 */
export function multipartStream(
  head: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts: { filename: string; type: string; expect: number; max: number },
) {
  const boundary = `----factory${randomUUID().replace(/-/g, "")}`;
  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${opts.filename.replace(/["\r\n]/g, "")}"\r\nContent-Type: ${opts.type}\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--\r\n`);
  let n = head.length;
  let stage = 0; // 0: 머리+앞부분, 1: 나머지, 2: 끝
  const tooBig = () => n > opts.max || n > opts.expect;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 0) {
        stage = 1;
        if (tooBig()) return controller.error(new Error("파일이 상한보다 커요."));
        controller.enqueue(pre);
        if (head.length) controller.enqueue(head);

        return;
      }
      if (stage === 1) {
        const { done, value } = await reader.read();

        if (!done) {
          n += value.length;
          if (tooBig()) {
            await reader.cancel().catch(() => {});

            return controller.error(new Error("파일이 상한보다 커요."));
          }
          controller.enqueue(value);

          return;
        }
        if (n !== opts.expect) return controller.error(new Error(`받은 크기가 맞지 않아요(${n}/${opts.expect}).`));
        stage = 2;
        controller.enqueue(post);
        controller.close();
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
    },
  });

  return { stream, contentType: `multipart/form-data; boundary=${boundary}`, received: () => n };
}

// ───────── 업로드 서버로 전달(store-video·store-image·업로드 시험이 같이 쓴다) ─────────

/** 업로드 서버 주소(FACTORY_UPLOAD_URL 또는 config/upload.ts) */
export function uploadBase(): string {
  return (process.env.FACTORY_UPLOAD_URL?.trim() || uploadConfig.customServerUrl || "").replace(/\/+$/, "");
}

/**
 * 업로드 서버로 보낸 결과.
 * ok: url 은 공개 주소. 실패: status 는 이 홈페이지가 감독 프로그램에 돌려줄 HTTP 상태, stage 는 어느 구간인지,
 * upstreamStatus 는 업로드 서버(또는 그 앞 nginx)가 준 HTTP 상태.
 */
export type ForwardResult =
  | { ok: true; url: string; upstreamStatus: number }
  | { ok: false; status: number; stage: "receive" | "upstream"; message: string; upstreamStatus: number | null };

const preview = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 160);

/** 업로드 서버 응답 읽기: { filename, url } 이 와야 한다(url 은 '/files/…' 처럼 base 뒤에 붙는 경로) */
export async function readUploadResponse(base: string, response: Response): Promise<ForwardResult> {
  if (!response.ok) {
    const big = response.status === 413;

    return {
      ok: false,
      status: big ? 413 : 502,
      stage: "upstream",
      upstreamStatus: response.status,
      message: big
        ? "업로드 서버(또는 그 앞 nginx)가 파일이 너무 크다고 거절했어요(413)."
        : `업로드 서버가 오류를 돌려줬어요(HTTP ${response.status}).`,
    };
  }
  const text = await response.text().catch(() => "");
  let result: { filename?: unknown; url?: unknown } | null = null;

  try {
    result = JSON.parse(text) as { filename?: unknown; url?: unknown };
  } catch {
    return {
      ok: false,
      status: 502,
      stage: "upstream",
      upstreamStatus: response.status,
      message: `업로드 서버 응답이 JSON 이 아니에요(${response.headers.get("content-type") ?? "형식 모름"}): ${preview(text) || "(빈 응답)"}`,
    };
  }
  if (!result || typeof result.filename !== "string" || !result.filename || typeof result.url !== "string" || !result.url) {
    return {
      ok: false,
      status: 502,
      stage: "upstream",
      upstreamStatus: response.status,
      message: `업로드 서버 응답 형식이 예상과 달라요(filename·url 이 있어야 해요): ${preview(text)}`,
    };
  }

  return { ok: true, url: /^https?:\/\//.test(result.url) ? result.url : `${base}${result.url.startsWith("/") ? "" : "/"}${result.url}`, upstreamStatus: response.status };
}

/** 큰 파일: 요청 본문을 흘려 보낸다(머리는 이미 읽어 형식 확인을 마친 상태) */
export async function forwardStream(
  base: string,
  head: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts: { filename: string; type: string; expect: number; max: number },
): Promise<ForwardResult> {
  const body = multipartStream(head, reader, opts);
  let response: Response;

  try {
    response = await fetch(`${base}/upload/single`, {
      method: "POST",
      headers: { "Content-Type": body.contentType },
      body: body.stream,
      duplex: "half",
      cache: "no-store",
    } as RequestInit & { duplex: "half" });
  } catch (error) {
    console.error("[factory] 업로드 서버 전달 실패:", error instanceof Error ? error.message : error);
    const short = body.received() !== opts.expect;

    return short
      ? { ok: false, status: 400, stage: "receive", upstreamStatus: null, message: "파일을 끝까지 받지 못했어요(PC→홈페이지 전송이 끊김)." }
      : { ok: false, status: 502, stage: "upstream", upstreamStatus: null, message: "업로드 서버에 연결하지 못했어요." };
  }

  return readUploadResponse(base, response);
}

/** 작은 파일(이미지): 메모리의 바이트를 multipart 로 보낸다 */
export async function forwardBuffer(base: string, buf: Uint8Array, type: string, filename: string): Promise<ForwardResult> {
  const upstream = new FormData();

  upstream.append("file", new Blob([buf as BlobPart], { type }), filename);
  let response: Response;

  try {
    response = await fetch(`${base}/upload/single`, { method: "POST", body: upstream });
  } catch (error) {
    console.error("[factory] 업로드 서버 전달 실패:", error instanceof Error ? error.message : error);

    return { ok: false, status: 502, stage: "upstream", upstreamStatus: null, message: "업로드 서버에 연결하지 못했어요." };
  }

  return readUploadResponse(base, response);
}
