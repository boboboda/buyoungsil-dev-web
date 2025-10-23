// lib/extensions/VideoExtension/VideoExtension.ts
// 🎯 실제 비디오 태그를 렌더링하는 익스텐션

import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: {
        src: string;
        width?: string;
        height?: string;
      }) => ReturnType;
      setVideoAt: (options: {
        pos: number;
        src: string;
        width?: string;
        height?: string;
      }) => ReturnType;
    };
  }
}

export const VideoExtension = Node.create({
  name: "video",

  group: "block",
  atom: true,

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      width: {
        default: "100%",
      },
      height: {
        default: "auto",
      },
      controls: {
        default: true,
      },
      autoplay: {
        default: false,
      },
      muted: {
        default: false,
      },
      loop: {
        default: false,
      },
      poster: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "video[src]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        controls: "controls",
      }),
    ];
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
      setVideoAt:
        (options) =>
        ({ commands }) => {
          return commands.insertContentAt(options.pos, {
            type: this.name,
            attrs: {
              src: options.src,
              width: options.width || "100%",
              height: options.height || "auto",
              controls: true,
            },
          });
        },
    };
  },
});

export default VideoExtension;
