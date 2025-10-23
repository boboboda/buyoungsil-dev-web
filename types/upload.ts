export interface UploadConfig {
  provider: "local" | "customServer";
  maxSize?: number;
  allowedTypes?: string[];
  customServerUrl?: string; // customServer 사용 시 필요

  maxVideoSize?: number;
  allowedVideoTypes?: string[];
}

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}
