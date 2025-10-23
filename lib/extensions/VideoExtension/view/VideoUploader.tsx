// lib/extensions/VideoExtension/view/VideoUploader.tsx
// 🎯 실제 업로드 UI 컴포넌트 (ImageUploader.tsx와 같은 역할)

import { useCallback, ChangeEvent } from "react";

import {
  useVideoUploader,
  useVideoDropZone,
  useVideoFileUpload,
} from "../hooks";

interface VideoUploaderProps {
  onUpload: (url: string) => void;
}

export const VideoUploader = ({ onUpload }: VideoUploaderProps) => {
  // 비디오 전용 훅들 사용
  const { loading, uploadFile } = useVideoUploader({ onUpload });
  const { handleUploadClick, ref } = useVideoFileUpload();
  const { draggedInside, onDrop, onDragEnter, onDragLeave } = useVideoDropZone({
    uploader: uploadFile,
  });

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        uploadFile(e.target.files[0]);
      }
    },
    [uploadFile],
  );

  // 로딩 중 UI
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 rounded-lg min-h-[10rem] border-2 border-dashed border-gray-300 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-600">비디오 업로드 중...</span>
        </div>
      </div>
    );
  }

  const wrapperClasses = [
    "flex flex-col items-center justify-center px-8 py-10 rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200",
    draggedInside
      ? "bg-green-50 border-green-400 scale-[1.02]"
      : "bg-gray-50 border-gray-300 hover:border-gray-400 hover:bg-gray-100",
  ].join(" ");

  return (
    <div
      className={wrapperClasses}
      contentEditable={false}
      onDragLeave={onDragLeave}
      onDragOver={onDragEnter}
      onDrop={onDrop}
    >
      {/* 비디오 아이콘 */}
      <div className="w-16 h-16 mb-4 flex items-center justify-center">
        <svg
          className="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
        </svg>
      </div>

      <div className="flex flex-col items-center justify-center gap-3">
        <div className="text-center">
          <div className="text-base font-medium text-gray-700 mb-1">
            {draggedInside
              ? "🎥 비디오를 여기에 놓으세요!"
              : "비디오를 드래그하거나"}
          </div>
          {!draggedInside && (
            <div className="text-sm text-gray-500">
              파일을 선택해서 업로드하세요
            </div>
          )}
        </div>

        {!draggedInside && (
          <button
            className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors duration-200 flex items-center gap-2"
            disabled={loading}
            onClick={handleUploadClick}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            {loading ? "업로드 중..." : "비디오 업로드"}
          </button>
        )}

        <div className="text-xs text-gray-400 text-center">
          <div>MP4, WebM, MOV, AVI 지원</div>
          <div className="mt-1">최대 100MB</div>
        </div>
      </div>

      <input
        ref={ref}
        accept=".mp4,.webm,.mov,.avi,video/*"
        className="hidden"
        type="file"
        onChange={onFileChange}
      />
    </div>
  );
};

export default VideoUploader;
