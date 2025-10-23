"use client";

import toast from "react-hot-toast";


import { isChangeOrigin } from "@tiptap/extension-collaboration";

import { ImageUpload } from "./ImageUpload";
import { TableOfContentsNode } from "./TableOfContentsNode";
import { VideoExtension, VideoUpload } from "./VideoExtension";

import {
  BlockquoteFigure,
  CharacterCount,
  CodeBlock,
  Color,
  Details,
  DetailsContent,
  DetailsSummary,
  Document,
  Dropcursor,
  Emoji,
  Figcaption,
  FileHandler,
  Focus,
  FontFamily,
  FontSize,
  Heading,
  Highlight,
  HorizontalRule,
  ImageBlock,
  Link,
  Placeholder,
  Selection,
  SlashCommand,
  StarterKit,
  Subscript,
  Superscript,
  Table,
  TableOfContents,
  TableCell,
  TableHeader,
  TableRow,
  TextAlign,
  TextStyle,
  TrailingNode,
  Typography,
  Underline,
  emojiSuggestion,
  Columns,
  Column,
  TaskItem,
  TaskList,
  UniqueID,
} from ".";

import { mediaUploader } from "@/lib/utils/mediaUpload";

export const ExtensionKit = ({ clientID }: { clientID: string }) => [
  Document,
  Columns,
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  Column,
  Selection,
  Heading.configure({
    levels: [1, 2, 3, 4, 5, 6],
  }),
  HorizontalRule,
  UniqueID.configure({
    types: ["paragraph", "heading", "blockquote", "codeBlock", "table"],
    filterTransaction: (transaction) => !isChangeOrigin(transaction),
  }),
  StarterKit.configure({
    document: false,
    dropcursor: false,
    heading: false,
    horizontalRule: false,
    blockquote: false,
    undoRedo: false,
    codeBlock: false,
  }),
  Details.configure({
    persist: true,
    HTMLAttributes: {
      class: "details",
    },
  }),
  DetailsContent,
  DetailsSummary,
  VideoExtension,
  VideoUpload,
  CodeBlock,
  TextStyle,
  FontSize,
  FontFamily,
  Color,
  TrailingNode,
  Link.configure({
    openOnClick: false,
  }),
  Highlight.configure({ multicolor: true }),
  Underline,
  CharacterCount.configure({ limit: 50000 }),

  TableOfContents,
  TableOfContentsNode,

  ImageUpload.configure({
    clientId: clientID,
  }),
  ImageBlock,

  // 기존 비디오 훅 사용하여 간단하게 처리
  FileHandler.configure({
  allowedMimeTypes: [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'
  ],
  
  onDrop: (currentEditor, files, pos) => {
    console.log('Files dropped:', files.length);
    
    files.forEach(async (file) => {
      console.log('Processing file:', file.name, file.type);
      
      if (file.type.startsWith('image/')) {
        try {
          const result = await mediaUploader.uploadImage(file);
          
          if (result.success) {
            currentEditor
              .chain()
              .insertContentAt(pos, {
                type: 'imageBlock',
                attrs: {
                  src: result.url,
                },
              })
              .focus()
              .run();
          }
        } catch (error) {
          console.error('Image upload error:', error);
        }
      } else if (file.type.startsWith('video/')) {
        try {
          const result = await mediaUploader.uploadVideo(file);
          
          if (result.success) {
            currentEditor
              .chain()
              .insertContentAt(pos, {
                type: 'video',
                attrs: {
                  src: result.url,
                  controls: true,
                },
              })
              .focus()
              .run();
          }
        } catch (error) {
          console.error('Video upload error:', error);
        }
      }
    });
  },

  onPaste: (currentEditor, files, htmlContent) => {
    if (htmlContent) {
      console.log('HTML content pasted, letting other extensions handle');
      return false;
    }
    
    files.forEach(async (file) => {
      if (file.type.startsWith('image/')) {
        try {
          const result = await mediaUploader.uploadImage(file);
          
          if (result.success) {
            currentEditor
              .chain()
              .insertContentAt(currentEditor.state.selection.anchor, {
                type: 'image',
                attrs: {
                  src: result.url,
                },
              })
              .focus()
              .run();
          }
        } catch (error) {
          console.error('Image paste error:', error);
        }
      }
    });
  },
}),
  Emoji.configure({
    enableEmoticons: true,
    suggestion: emojiSuggestion,
  }),
  TextAlign.extend({
    addKeyboardShortcuts() {
      return {};
    },
  }).configure({
    types: ["heading", "paragraph"],
  }),
  Subscript,
  Superscript,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Typography,
  Placeholder.configure({
    includeChildren: true,
    showOnlyCurrent: false,
    placeholder: () => "",
  }),
  SlashCommand,
  Focus,
  Figcaption,
  BlockquoteFigure,
  Dropcursor.configure({
    width: 2,
    class: "ProseMirror-dropcursor border-black",
  }),
];

export default ExtensionKit;
