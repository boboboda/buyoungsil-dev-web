// lib/factory/uploadStream.ts
// 큰 파일(검토용 영상)을 메모리에 통째로 올리지 않고 업로드 서버의 POST /upload/single(multipart, 필드 'file')로 흘려 보낸다.
// 요청 본문(원시 바이트)을 앞부분만 읽어 형식을 확인한 뒤, multipart 머리·본문·꼬리를 이어 붙인 스트림으로 바로 전달한다.
import { randomUUID } from "node:crypto";

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
