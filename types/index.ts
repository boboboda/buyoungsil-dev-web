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


export interface Note {
  noteId?: number | null;
  title?: string | null;
  mainCategory?: NoteCategory | null;
  subCategory?: SubCategory | null;
  level?: NoteLevel;
  content?: any;  // 🔥 any로 유연하게
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

// ========================================
// 프로젝트 타입 (이미 추가했다면 skip)
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
  logCount?: number;
  revenue?: number;
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
// 스토리 타입
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


// types/index.ts

export type NoteCategory =
  // 모바일 (언어 + UI)
  | "kotlin-compose"      // Kotlin + Jetpack Compose
  | "swift-swiftui"       // Swift + SwiftUI
  | "flutter"             // Flutter + Dart
  
  // 웹 (프레임워크 + UI)
  | "nextjs-heroui"       // Next.js + HeroUI
  | "react"               // React
  
  // 백엔드 (프레임워크 + 언어)
  | "nestjs-typescript"   // NestJS + TypeScript
  | "nodejs"              // Node.js
  
  // 기타
  | "python-crawling"     // Python + 크롤링
  | "basics";             // 개발 기초

export const noteCategories: NoteCategory[] = [
  "kotlin-compose",
  "swift-swiftui",
  "flutter",
  "nextjs-heroui",
  "react",
  "nestjs-typescript",
  "nodejs",
  "python-crawling",
  "basics",
];

// 카테고리 표시 정보
export const noteCategoryInfo: Record<NoteCategory, {
  name: string;
  description: string;
  icon: string;
  tags: string[];
}> = {
  "kotlin-compose": {
    name: "Kotlin + Compose",
    description: "Jetpack Compose를 활용한 안드로이드 앱 개발",
    icon: "🤖",
    tags: ["Android", "Kotlin", "Jetpack Compose"]
  },
  "swift-swiftui": {
    name: "Swift + SwiftUI",
    description: "SwiftUI를 활용한 iOS 앱 개발",
    icon: "🍎",
    tags: ["iOS", "Swift", "SwiftUI"]
  },
  "flutter": {
    name: "Flutter",
    description: "Flutter로 크로스플랫폼 모바일 앱 개발",
    icon: "🦋",
    tags: ["Flutter", "Dart", "Cross-Platform"]
  },
  "nextjs-heroui": {
    name: "Next.js + HeroUI",
    description: "Next.js와 HeroUI로 웹 애플리케이션 개발",
    icon: "▲",
    tags: ["Next.js", "HeroUI", "React", "TypeScript"]
  },
  "react": {
    name: "React",
    description: "React를 활용한 프론트엔드 개발",
    icon: "⚛️",
    tags: ["React", "JavaScript", "Frontend"]
  },
  "nestjs-typescript": {
    name: "NestJS + TypeScript",
    description: "NestJS와 TypeScript로 백엔드 개발",
    icon: "🐈",
    tags: ["NestJS", "TypeScript", "Backend"]
  },
  "nodejs": {
    name: "Node.js",
    description: "Node.js를 활용한 백엔드 개발",
    icon: "💚",
    tags: ["Node.js", "JavaScript", "Backend"]
  },
  "python-crawling": {
    name: "Python 크롤링",
    description: "Python을 활용한 웹 크롤링 및 데이터 수집",
    icon: "🐍",
    tags: ["Python", "Crawling", "Data"]
  },
  "basics": {
    name: "개발 기초",
    description: "프로그래밍 입문과 기본 개념",
    icon: "📚",
    tags: ["기초", "입문"]
  }
};