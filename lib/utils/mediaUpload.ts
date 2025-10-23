import { MediaUploadService} from "@/service/mediaUpload";
import { uploadConfig } from "@/config/upload";

export const mediaUploader = new MediaUploadService(uploadConfig);
