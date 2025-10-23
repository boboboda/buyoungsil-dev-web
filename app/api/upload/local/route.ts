import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File;

    if (!file || file.size === 0) {
      return Response.json({ success: false, error: "파일이 없습니다" });
    }

    const bytes = await file.arrayBuffer();
    const buffer = new Uint8Array(bytes);

    const uploadDir = path.join(process.cwd(), "public", "uploads", "images");

    await mkdir(uploadDir, { recursive: true }).catch(() => {});

    const uniqueFilename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "")}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    await writeFile(filePath, buffer);
    const imageUrl = `/uploads/images/${uniqueFilename}`;

    return Response.json({
      success: true,
      imageUrl,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
    });
  }
}
