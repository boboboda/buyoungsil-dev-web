"use client";

import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { toast } from "react-toastify";

export interface EduReplyItem {
  id: string;
  content: string;
  createdAt: string;
}

export interface EduPostItem {
  id: string;
  board: string;
  nickname: string;
  title: string;
  content: string;
  isSecret: boolean;
  status: string;
  createdAt: string;
  replies: EduReplyItem[];
}

const BOARDS = [{ value: "request", label: "💡 앱·도구 요청" }];

const STATUSES = [
  { value: "open", label: "접수" },
  { value: "reviewing", label: "검토 중" },
  { value: "planned", label: "제작 예정" },
  { value: "done", label: "완료" },
];

const statusLabel = (value: string) =>
  STATUSES.find((s) => s.value === value)?.label ?? value;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function EduBoardAdmin({ posts }: { posts: EduPostItem[] }) {
  const [items, setItems] = useState(posts);
  const [board, setBoard] = useState("request");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () => items.filter((p) => p.board === board),
    [items, board],
  );
  const selected = items.find((p) => p.id === selectedId) ?? null;

  const countNoReply = (b: string) =>
    items.filter((p) => p.board === b && p.replies.length === 0).length;

  const call = async (id: string, payload: Record<string, unknown>) => {
    setBusy(true);

    try {
      const res = await fetch(`/api/admin/edu/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.message ?? "처리하지 못했어요.");

        return null;
      }

      return data;
    } catch {
      toast.error("네트워크 오류가 났어요.");

      return null;
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (post: EduPostItem, status: string) => {
    const data = await call(post.id, { action: "status", status });

    if (!data) return;

    setItems((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, status } : p)),
    );
    toast.success("상태를 바꿨어요.");
  };

  const sendReply = async (post: EduPostItem) => {
    const content = replyText.trim();

    if (!content) return;

    const data = await call(post.id, { action: "reply", content });

    if (!data) return;

    setItems((prev) =>
      prev.map((p) =>
        p.id === post.id ? { ...p, replies: [...p.replies, data.reply] } : p,
      ),
    );
    setReplyText("");
    toast.success("답변을 달았어요.");
  };

  const removeReply = async (post: EduPostItem, replyId: string) => {
    if (!window.confirm("이 답변을 지울까요?")) return;

    const data = await call(post.id, { action: "deleteReply", replyId });

    if (!data) return;

    setItems((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, replies: p.replies.filter((r) => r.id !== replyId) }
          : p,
      ),
    );
  };

  const removePost = async (post: EduPostItem) => {
    if (!window.confirm(`"${post.title}" 글을 지울까요? 되돌릴 수 없어요.`)) {
      return;
    }

    const data = await call(post.id, { action: "deletePost" });

    if (!data) return;

    setItems((prev) => prev.filter((p) => p.id !== post.id));
    setSelectedId(null);
    toast.success("글을 지웠어요.");
  };

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {BOARDS.map((b) => (
          <button
            key={b.value}
            className={`rounded-lg border-2 px-4 py-2 font-semibold transition-colors ${
              board === b.value
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                : "border-gray-200 dark:border-gray-700"
            }`}
            type="button"
            onClick={() => {
              setBoard(b.value);
              setSelectedId(null);
              setReplyText("");
            }}
          >
            {b.label}
            {countNoReply(b.value) > 0 && (
              <span className="ml-2 text-sm text-red-500">
                답변 대기 {countNoReply(b.value)}
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-12 text-center text-gray-500">
          아직 글이 없어요.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
          <ul className="space-y-2">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  className={`w-full text-left rounded-lg border-2 p-4 transition-colors ${
                    p.id === selectedId
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setReplyText("");
                  }}
                >
                  <p className="font-semibold line-clamp-1">{p.title}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {p.nickname} · {formatDate(p.createdAt)}
                  </p>
                  <p className="text-xs mt-2">
                    <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">
                      {statusLabel(p.status)}
                    </span>
                    <span className="ml-2 text-gray-500">
                      {p.replies.length > 0
                        ? `답변 ${p.replies.length}`
                        : "답변 없음"}
                    </span>
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div>
            {!selected ? (
              <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-12 text-center text-gray-500">
                왼쪽에서 글을 골라 주세요.
              </div>
            ) : (
              <article className="rounded-xl border-2 border-gray-200 dark:border-gray-700 p-6 space-y-6">
                <header>
                  <h2 className="text-xl font-bold">{selected.title}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selected.nickname} · {formatDate(selected.createdAt)}
                    {selected.isSecret ? " · 🔒 비밀글" : ""}
                  </p>
                </header>

                <p className="whitespace-pre-wrap break-words leading-relaxed">
                  {selected.content}
                </p>

                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold" htmlFor="edu-status">
                    상태
                  </label>
                  <select
                    className="rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-transparent px-3 py-1"
                    disabled={busy}
                    id="edu-status"
                    value={selected.status}
                    onChange={(e) => changeStatus(selected, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <section>
                  <h3 className="font-semibold mb-3">
                    답변 ({selected.replies.length})
                  </h3>
                  <ul className="space-y-3 mb-4">
                    {selected.replies.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4"
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {r.content}
                        </p>
                        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                          <span>{formatDate(r.createdAt)}</span>
                          <button
                            className="text-red-500"
                            disabled={busy}
                            type="button"
                            onClick={() => removeReply(selected, r.id)}
                          >
                            삭제
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <textarea
                    className="w-full rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-transparent p-3"
                    maxLength={3000}
                    placeholder="작성자에게 보일 답변을 적어 주세요."
                    rows={4}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                  <div className="flex justify-between mt-3">
                    <Button
                      color="danger"
                      isDisabled={busy}
                      variant="light"
                      onPress={() => removePost(selected)}
                    >
                      글 삭제
                    </Button>
                    <Button
                      color="primary"
                      isDisabled={busy || !replyText.trim()}
                      onPress={() => sendReply(selected)}
                    >
                      답변 달기
                    </Button>
                  </div>
                </section>
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
