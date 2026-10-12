import { handleLocalUpload, VIDEO_UPLOAD } from "@/lib/upload/localUpload";

// 관리자 전용 영상 업로드(mp4/mov/webm, 120MB)
export async function POST(request: Request) {
  return handleLocalUpload(request, VIDEO_UPLOAD);
}
