// lib/extensions/VideoExtension/view/VideoUpload.tsx
// 🎯 노드뷰 컴포넌트 (ImageUpload.tsx와 같은 역할)

import { Editor, NodeViewWrapper } from "@tiptap/react";
import { useCallback } from "react";

import { VideoUploader } from "./VideoUploader";

export const VideoUpload = ({
  getPos,
  editor,
}: {
  getPos: () => number;
  editor: Editor;
}) => {
  const onUpload = useCallback(
    (url: string) => {
      if (url) {
        // VideoUpload 노드를 실제 Video 노드로 교체
        editor
          .chain()
          .setVideo({ src: url, width: "100%", height: "auto" })
          .deleteRange({ from: getPos(), to: getPos() })
          .focus()
          .run();
      }
    },
    [getPos, editor],
  );

  return (
    <NodeViewWrapper>
      <div data-drag-handle className="p-0 m-0">
        <VideoUploader onUpload={onUpload} />
      </div>
    </NodeViewWrapper>
  );
};

export default VideoUpload;
