// app/api/admin/novel/works/route.ts
// 통제실 [작품] 탭: 작품 목록(상태별 화수, 쓴 화·공개된 화, 최근 화 상태). 관리자만.
import { adminGate, json } from "@/lib/novel/adminHttp";
import { listWorksForAdmin } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await adminGate();

  if (denied) return denied;

  return json({ works: await listWorksForAdmin() });
}
