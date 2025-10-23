// lib/extensions/VideoExtension/VideoUpload.ts
// 🎯 비디오 업로드 UI를 제공하는 노드

import { Node, ReactNodeViewRenderer } from "@tiptap/react";

import { VideoUpload as VideoUploadComponent } from "./view/VideoUpload";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    videoUpload: {
      setVideoUpload: () => ReturnType;
    };
  }
}

export const VideoUpload = Node.create({
  name: "videoUpload",

  isolating: true,
  defining: true,
  group: "block",
  draggable: true,
  selectable: true,
  inline: false,

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML() {
    return ["div", { "data-type": this.name }];
  },

  addCommands() {
    return {
      setVideoUpload:
        () =>
        ({ commands }) =>
          commands.insertContent(`<div data-type="${this.name}"></div>`),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoUploadComponent);
  },
});

export default VideoUpload;
