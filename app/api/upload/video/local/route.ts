import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("video") as File;

    if (!file || file.size === 0) {
      return Response.json({ success: false, error: "파일이 없습니다" });
    }

    // 비디오 파일 검증
    if (!file.type.startsWith("video/")) {
      return Response.json({
        success: false,
        error: "비디오 파일만 업로드할 수 있습니다",
      });
    }

    // 파일 크기 검증 (100MB 제한)
    if (file.size > 100 * 1024 * 1024) {
      return Response.json({
        success: false,
        error: "파일 크기가 너무 큽니다 (최대 100MB)",
      });
    }

    const bytes = await file.arrayBuffer();
    const buffer = new Uint8Array(bytes);

    const uploadDir = path.join(process.cwd(), "public", "uploads", "videos");

    await mkdir(uploadDir, { recursive: true }).catch(() => {});

    const uniqueFilename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "")}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    await writeFile(filePath, buffer);
    const videoUrl = `/uploads/videos/${uniqueFilename}`;

    return Response.json({
      success: true,
      videoUrl,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
    });
  }
}
