import { handleLocalUpload, IMAGE_UPLOAD } from "@/lib/upload/localUpload";

// 관리자 전용 이미지 업로드(jpeg/png/webp/gif, 10MB)
export async function POST(request: Request) {
  return handleLocalUpload(request, IMAGE_UPLOAD);
}
