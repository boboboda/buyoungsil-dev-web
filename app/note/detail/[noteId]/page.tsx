// app/note/detail/[noteId]/page.tsx
// 예전 주소(/note/detail/번호)로 들어온 요청을 글 고유 주소로 보낸다.
// (관리자 목록, 프로젝트 로그 등에 이 주소가 아직 쓰이고 있음)
import { notFound, permanentRedirect } from "next/navigation";

import prisma from "@/lib/prisma";
import { noteHref } from "@/lib/note/noteUtils";

export const dynamic = "force-dynamic";

export default async function NoteDetailRedirectPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  const id = Number(noteId);

  if (!Number.isInteger(id)) notFound();

  const note = await prisma.developNote.findUnique({
    where: { noteId: id },
    select: { mainCategory: true, isPublished: true },
  });

  if (!note || !note.isPublished || !note.mainCategory) notFound();

  permanentRedirect(noteHref(note.mainCategory, id));
}