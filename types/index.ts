import { NoteLevel } from "@/components/developmentNote/NoteEditorHeader";
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
  platform: string;  // 🔥 type 제거하고 platform만 사용
  status: string;
  progress: number;

  techStack: string[];

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
  id: number | string;
  name: string;
}

// ========================================
// 프로젝트 타입 (이미 추가했다면 skip)
// ========================================
// ========================================
// 프로젝트 타입
// ========================================
export type ProjectStatus = "released" | "in-progress" | "backend";
export type LogType = "progress" | "issue" | "solution" | "milestone";

export interface Project {
  id: string;
  name: string;
  title: string;
  description: string;
  coverImage?: string | null;
  appLink?: string | null;
  platform: string;  // 🔥 type 제거하고 platform만 사용
  status: string;
  progress: number;
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
  projectId?: string;  // 🔥 추가 (Prisma에서 반환됨)
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


// ========================================
// 플랫폼 & 카테고리 타입
// ========================================

export type Platform = "mobile" | "web" | "backend";

export type NoteCategory = 
  // Mobile
  | "kotlin-compose"
  | "swift-swiftui"
  | "flutter"
  // Web
  | "nextjs-heroui"
  | "react"
  // Backend
  | "nestjs-typescript"
  | "nodejs"
  | "python-crawling"
  // Basics
  | "basics";

// 🔥 카테고리 → 플랫폼 매핑
export const categoryToPlatform: Record<NoteCategory, Platform | null> = {
  // Mobile
  "kotlin-compose": "mobile",
  "swift-swiftui": "mobile",
  "flutter": "mobile",
  // Web
  "nextjs-heroui": "web",
  "react": "web",
  // Backend
  "nestjs-typescript": "backend",
  "nodejs": "backend",
  "python-crawling": "backend",
  // Basics (플랫폼 무관)
  "basics": null
};

// 🔥 플랫폼 → 카테고리 목록
export const platformToCategories: Record<Platform, NoteCategory[]> = {
  mobile: ["kotlin-compose", "swift-swiftui", "flutter"],
  web: ["nextjs-heroui", "react"],
  backend: ["nestjs-typescript", "nodejs", "python-crawling"]
};

// 🔥 카테고리 메타데이터
export const noteCategoryInfo: Record<NoteCategory, {
  name: string;
  description: string;
  icon: string;
  platform: Platform | null;
  tags: string[];
}> = {
  // Mobile
  "kotlin-compose": {
    name: "Kotlin + Compose",
    description: "Jetpack Compose를 활용한 안드로이드 앱 개발",
    icon: "🤖",
    platform: "mobile",
    tags: ["Kotlin", "Android", "Jetpack Compose", "Mobile"]
  },
  "swift-swiftui": {
    name: "Swift + SwiftUI",
    description: "SwiftUI를 활용한 iOS 앱 개발",
    icon: "🍎",
    platform: "mobile",
    tags: ["Swift", "iOS", "SwiftUI", "Mobile"]
  },
  "flutter": {
    name: "Flutter",
    description: "Flutter로 크로스플랫폼 모바일 앱 개발",
    icon: "🦋",
    platform: "mobile",
    tags: ["Flutter", "Dart", "Cross-platform", "Mobile"]
  },
  // Web
  "nextjs-heroui": {
    name: "Next.js + HeroUI",
    description: "Next.js와 HeroUI로 웹 애플리케이션 개발",
    icon: "▲",
    platform: "web",
    tags: ["Next.js", "React", "HeroUI", "Web"]
  },
  "react": {
    name: "React",
    description: "React를 활용한 프론트엔드 개발",
    icon: "⚛️",
    platform: "web",
    tags: ["React", "JavaScript", "Frontend", "Web"]
  },
  // Backend
  "nestjs-typescript": {
    name: "NestJS + TypeScript",
    description: "NestJS와 TypeScript로 백엔드 개발",
    icon: "🐈",
    platform: "backend",
    tags: ["NestJS", "TypeScript", "Node.js", "Backend"]
  },
  "nodejs": {
    name: "Node.js",
    description: "Node.js를 활용한 백엔드 개발",
    icon: "💚",
    platform: "backend",
    tags: ["Node.js", "JavaScript", "Backend", "API"]
  },
  "python-crawling": {
    name: "Python 크롤링",
    description: "Python을 활용한 웹 크롤링 및 데이터 수집",
    icon: "🐍",
    platform: "backend",
    tags: ["Python", "Crawling", "Data", "Automation"]
  },
  // Basics
  "basics": {
    name: "개발 기초",
    description: "프로그래밍 입문과 기본 개념",
    icon: "📚",
    platform: null,
    tags: ["Programming", "Basics", "Tutorial"]
  }
};

// 🔥 기술 스택 옵션 (노트 카테고리와 매핑)
export const TECH_STACK_OPTIONS = [
  { value: "flutter", label: "Flutter", category: "flutter" },
  { value: "kotlin", label: "Kotlin + Compose", category: "kotlin-compose" },
  { value: "swift", label: "Swift + SwiftUI", category: "swift-swiftui" },
  { value: "nextjs", label: "Next.js", category: "nextjs-heroui" },
  { value: "react", label: "React", category: "react" },
  { value: "nestjs", label: "NestJS", category: "nestjs-typescript" },
  { value: "nodejs", label: "Node.js", category: "nodejs" },
  { value: "python", label: "Python", category: "python-crawling" },
] as const;