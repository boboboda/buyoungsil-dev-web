import { NoteLevel } from "@/components/developmentNote/EditorHeader";
import { SVGProps } from "react";

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

export type Post = {
  id: string;
  listNumber: string;
  writer: string;
  email: string;
  title: string;
  content: string;
  created_at: string;
  comments: Comment[];
};

export interface PostSummary {
  id: string;
  listNumber: string;
  writer: string;
  email: string;
  title: string;
  content: string;
  commentCount: number; // 댓글들 대신 개수만
  created_at: string;
}

export type Comment = {
  id: string;
  writer: string;
  email: string;
  content: string;
  created_at: string;
  replys: Reply[];
};

export type Reply = {
  id: string;
  writer: string;
  email: string;
  content: string;
  mentionTo: string | null; // 멘션 대상 (단순 문자열)
  created_at: string;
};

const columns = [
  { name: "번호", uid: "listNumber", sortable: true, className: "w-[10%]" },
  { name: "글쓴이", uid: "writer", className: "w-[25%]" },
  { name: "제목", uid: "title", className: "w-[50%]" }, // 가장 크게!
  { name: "생성일자", uid: "created_at", sortable: true, className: "w-[15%]" },
];

const noteColumns = [
  { name: "번호", uid: "noteId", sortable: true },
  { name: "메인카테고리", uid: "mainCategory" },
  { name: "서브카테고리", uid: "subCategory" },
  { name: "제목", uid: "title" },
  { name: "액션", uid: "actions" },
];

export type CustomModalType =
  | "detail"
  | "edit"
  | "delete"
  | "add"
  | "deleteAuth"
  | "editAuth"
  | "passwordModal";

export type FocusedPostType = {
  focusedPost: Post | null;
  modalType: CustomModalType;
  appName?: string;
};

export type NoteCategory =
  | "basics"
  | "android"
  | "Ios"
  | "react"
  | "python"
  | "javascript"
  | "typescript"
  | "nestjs"
  | "nextjs"
  | "nodejs"
  | "express"
  | "mongodb"
  | "firebase"
  | "graphql"
  | "docker"
  | "kubernetes";

export const noteCategories: NoteCategory[] = [
  "basics",
  "android",
  "Ios",
  "react",
  "python",
  "javascript",
  "typescript",
  "nestjs",
  "nextjs",
  "nodejs",
  "express",
  "mongodb",
  "firebase",
  "graphql",
  "docker",
  "kubernetes",
];

export type NoteEditorType = "add" | "edit" | "read";

export { columns, noteColumns };

export interface App {
  id: string;
  name: string;
  title: string;
  description: string;
  appLink: string;
  coverImage?: string | null;
  databaseId?: string | null;
  tags: Tag[];
  createdAt: string;
  updatedAt?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface AppInput {
  title: string;
  description: string;
  appLink: string;
  coverImage?: string;
  tags: { name: string; color: string }[];
  databaseId?: string;
}

// ========================================
// 프로젝트 타입 (🔥 신규)
// ========================================
export type ProjectStatus = "released" | "in-progress" | "backend";
export type ProjectType = "mobile" | "web" | "backend";
export type LogType = "progress" | "issue" | "solution" | "milestone";

export interface Project {
  id: string;
  name: string;
  title: string;
  description: string;
  coverImage?: string | null;
  appLink?: string | null;
  status: ProjectStatus;
  progress: number;
  type: ProjectType;
  databaseId?: string | null;
  tags: ProjectTag[];
  logCount?: number;      // 계산 필드
  revenue?: number;       // 최근 월 수익
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTag {
  id: string;
  name: string;
  color: string;
}

export interface ProjectLog {
  id: string;
  projectId: string;
  title: string;
  content: string;
  logType: LogType;
  noteId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Revenue {
  id: string;
  projectId: string;
  month: string;
  adsense: number;
  inapp: number;
  total: number;
  dau?: number | null;
  mau?: number | null;
  downloads?: number | null;
  retention?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ========================================
// 스토리 타입 (🔥 신규)
// ========================================
export type StoryCategory = "삽질기" | "꿀팁" | "일상";

export interface Story {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt?: string | null;
  category: StoryCategory;
  tags: string[];
  isPublished: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

// ========================================
// 개발노트 타입 업데이트 (🔥 필드 추가)
// ========================================
export interface Note {
  noteId?: number | null;
  title?: string | null;
  mainCategory?: string | null; // 🔥 NoteCategory 대신 string
  subCategory?: SubCategory | null;
  level?: string | null; // 🔥 NoteLevel 대신 string
  content?: any;
  isPublished?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubCategory {
  id: number;
  name: string;
}