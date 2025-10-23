// @/config/upload.ts
import { UploadConfig } from '@/types/upload';

export const uploadConfig: UploadConfig = {
  provider: "customServer", // "local"에서 "customServer"로 변경
  customServerUrl: "http://buyoungsil.ddns.net:8080", // Docker 서버 URL 추가
  maxSize: 5 * 1024 * 1024, // 5MB (이미지용)
  allowedTypes: [
    "image/jpeg",
    "image/png", 
    "image/gif",
    "image/webp"
  ],
  maxVideoSize: 100 * 1024 * 1024, // 100MB (비디오용)
  allowedVideoTypes: [
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",    // .mov
    "video/x-msvideo",    // .avi
    "video/avi",          // .avi 다른 형태
    "video/mov",          // .mov 다른 형태
    "video/x-ms-wmv",     // .wmv
    "video/x-matroska",   // .mkv
    "video/x-flv",        // .flv
  ]
};