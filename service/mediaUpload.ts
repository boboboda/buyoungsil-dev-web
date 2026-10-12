import { UploadConfig, UploadResult } from "@/types/upload";

export class MediaUploadService {
  private config: UploadConfig;

  constructor(config: UploadConfig) {
    this.config = config;
  }

  async uploadImage(file: File): Promise<UploadResult> {
    // 공통 검증
    if (!this.validateFile(file)) {
      return { success: false, error: "유효하지 않은 파일입니다." };
    }

    // 프로바이더별 처리
    switch (this.config.provider) {
      case "local":
        return this.uploadToLocal(file);
      case "customServer":
        return this.uploadToCustomServer(file);
      default:
        return { success: false, error: "지원하지 않는 업로드 방식입니다." };
    }
  }

  private validateFile(file: File): boolean {
    const maxSize = this.config.maxSize || 10 * 1024 * 1024; // 기본 10MB
    const allowedTypes = this.config.allowedTypes || [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (file.size > maxSize) {
      return false;
    }

    if (!allowedTypes.includes(file.type)) {
      return false;
    }

    return true;
  }

  // 로컬 업로드 (현재 구현)
  private async uploadToLocal(file: File): Promise<UploadResult> {
    try {
      const formData = new FormData();

      formData.append("image", file);

      const response = await fetch("/api/upload/local", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        return { success: true, url: result.imageUrl };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: "업로드 중 오류가 발생했습니다." };
    }
  }

  // 개인 서버 업로드 (미래 구현)
  private async uploadToCustomServer(file: File): Promise<UploadResult> {
  try {
    if (!this.config.customServerUrl) {
      return {
        success: false,
        error: "Custom 서버 URL이 설정되지 않았습니다.",
      };
    }

    const formData = new FormData();
    formData.append("file", file); // "image" → "file"

    const response = await fetch(
      `${this.config.customServerUrl}/upload/single`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    // NestJS 응답 구조에 맞게 수정
    if (result.filename) {
      return { 
        success: true, 
        url: `${this.config.customServerUrl}${result.url}` 
      };
    } else {
      return { 
        success: false, 
        error: result.message || "업로드 실패" 
      };
    }
  } catch (error) {
    console.error("Upload error:", error);
    return {
      success: false,
      error: "Custom 서버 업로드 중 오류가 발생했습니다.",
    };
  }
}

  async uploadVideo(file: File): Promise<UploadResult> {
    // 비디오 파일 검증
    if (!this.validateVideoFile(file)) {
      return { success: false, error: "유효하지 않은 비디오 파일입니다." };
    }

    // 프로바이더별 처리 (이미지와 동일한 방식)
    switch (this.config.provider) {
      case "local":
        return this.uploadVideoToLocal(file);
      case "customServer":
        return this.uploadVideoToCustomServer(file);
      default:
        return { success: false, error: "지원하지 않는 업로드 방식입니다." };
    }
  }

  private validateVideoFile(file: File): boolean {
  const maxSize = this.config.maxVideoSize || 500 * 1024 * 1024; // 500MB로 늘림

  console.log("🔍 비디오 파일 체크 (임시 - 모든 비디오 허용):", {
    fileName: file.name,
    fileType: file.type,
    fileSize: (file.size / 1024 / 1024).toFixed(2) + "MB"
  });

  // 크기만 체크
  if (file.size > maxSize) {
    console.error("💥 파일 크기가 너무 큽니다:", (file.size / 1024 / 1024).toFixed(2) + "MB");
    return false;
  }

  // 비디오 관련 파일이면 모두 허용
  if (file.type.startsWith('video/') || 
      file.name.match(/\.(mp4|webm|ogg|mov|avi|wmv|mkv|flv)$/i)) {
    console.log("✅ 비디오 파일 허용");
    return true;
  }

  console.error("💥 비디오 파일이 아닙니다");
  return false;
}

  // 로컬 비디오 업로드
  private async uploadVideoToLocal(file: File): Promise<UploadResult> {
    try {
      const formData = new FormData();

      formData.append("video", file);

      const response = await fetch("/api/upload/video/local", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        return { success: true, url: result.videoUrl };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: "비디오 업로드 중 오류가 발생했습니다." };
    }
  }

  // 커스텀 서버 비디오 업로드
  private async uploadVideoToCustomServer(file: File): Promise<UploadResult> {
  try {
    console.log("🚀 커스텀 서버 비디오 업로드 시작:", this.config.customServerUrl);
    
    if (!this.config.customServerUrl) {
      console.error("❌ customServerUrl이 설정되지 않음");
      return {
        success: false,
        error: "Custom 서버 URL이 설정되지 않았습니다.",
      };
    }

    const formData = new FormData();
    formData.append("file", file);

    console.log("📤 서버 요청 시작:", `${this.config.customServerUrl}/upload/single`);
    
    const response = await fetch(
      `${this.config.customServerUrl}/upload/single`,
      {
        method: "POST",
        body: formData,
      },
    );

    console.log("📥 서버 응답 상태:", response.status);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.filename) {
      const finalUrl = `${this.config.customServerUrl}${result.url}`;
      console.log("✅ 비디오 업로드 성공:", finalUrl);
      return {
        success: true,
        url: finalUrl
      };
    } else {
      console.error("❌ filename이 없음:", result);
      return {
        success: false,
        error: result.message || "비디오 업로드 실패"
      };
    }
  } catch (error) {
    console.error("🔥 비디오 업로드 예외:", error);
    return {
      success: false,
      error: "Custom 서버 비디오 업로드 중 오류가 발생했습니다.",
    };
  }
}
}
