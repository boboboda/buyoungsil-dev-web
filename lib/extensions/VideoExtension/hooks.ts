// lib/extensions/VideoExtension/hooks.ts
// 🎯 비디오 전용 훅들

import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { mediaUploader } from "@/lib/utils/mediaUpload";

// 🎥 비디오 업로드 훅
export const useVideoUploader = ({
  onUpload,
}: {
  onUpload: (url: string) => void;
}) => {
  const [loading, setLoading] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const result = await mediaUploader.uploadVideo(file);

        if (result.success) {
          onUpload(result.url!);
          toast.success("비디오 업로드 성공!");
        } else {
          toast.error(result.error || "비디오 업로드 실패");
        }
      } catch (error) {
        console.error("Video upload error:", error);
        toast.error("비디오 업로드 중 오류가 발생했습니다.");
      }
      setLoading(false);
    },
    [onUpload],
  );

  return { loading, uploadFile };
};

// 🎥 비디오 파일 선택 훅
export const useVideoFileUpload = () => {
  const fileInput = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback(() => {
    fileInput.current?.click();
  }, []);

  return { ref: fileInput, handleUploadClick };
};

// 🎥 비디오 드래그앤드롭 훅
export const useVideoDropZone = ({
  uploader,
}: {
  uploader: (file: File) => void;
}) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [draggedInside, setDraggedInside] = useState<boolean>(false);

  useEffect(() => {
    const dragStartHandler = () => {
      setIsDragging(true);
    };

    const dragEndHandler = () => {
      setIsDragging(false);
    };

    document.body.addEventListener("dragstart", dragStartHandler);
    document.body.addEventListener("dragend", dragEndHandler);

    return () => {
      document.body.removeEventListener("dragstart", dragStartHandler);
      document.body.removeEventListener("dragend", dragEndHandler);
    };
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      setDraggedInside(false);
      if (e.dataTransfer.files.length === 0) {
        return;
      }

      const fileList = e.dataTransfer.files;
      const files: File[] = [];

      for (let i = 0; i < fileList.length; i += 1) {
        const item = fileList.item(i);

        if (item) {
          files.push(item);
        }
      }

      // 비디오 파일만 필터링
      const videoFiles = files.filter((f) => f.type.startsWith("video/"));

      if (videoFiles.length === 0) {
        toast.error("비디오 파일만 업로드할 수 있습니다.");

        return;
      }

      e.preventDefault();

      const file = videoFiles[0];

      if (file) {
        uploader(file);
      }
    },
    [uploader],
  );

  const onDragEnter = () => {
    setDraggedInside(true);
  };

  const onDragLeave = () => {
    setDraggedInside(false);
  };

  return { isDragging, draggedInside, onDragEnter, onDragLeave, onDrop };
};
