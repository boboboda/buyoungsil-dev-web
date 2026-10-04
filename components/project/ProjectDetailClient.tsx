"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import moment from "moment";
import { Button } from "@heroui/react";
import PrivacyPolicyView from "./PrivacyPolicyView";

// ==================== 타입 정의 ====================
interface Revenue {
  id: string;
  month: string;
  adsense: number;
  inapp: number;
  total: number;
  dau?: number | null;
  mau?: number | null;
  downloads?: number | null;
  retention?: number | null;
  notes?: string | null;
}

interface DevelopNote {
  noteId: number;
  title: string | null;
  mainCategory: string | null;
}

interface ProjectLog {
  id: string;
  title: string;
  content: string;
  logType: string;
  noteId?: number | null;
  createdAt: string;
  note?: DevelopNote | null;
}

interface Project {
  id: string;
  name: string;
  title: string;
  description: string;
  coverImage?: string | null;
  appLink?: string | null;
  status: string;
  progress: number;
  platform: string;
  techStack: string[];
  privacyPolicy?: string | null;
  privacyUpdatedAt?: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  logs?: ProjectLog[];
  revenues?: Revenue[];
  logCount?: number;
  revenue?: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectDetailClientProps {
  project: Project;
}

// ==================== 메인 컴포넌트 ====================
export default function ProjectDetailClient({ project }: ProjectDetailClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "revenues" | "community" | "privacy">("overview");

  const statusEmoji = {
    released: "🚀",
    "in-progress": "🔨",
    backend: "⚙️"
  };

  const statusLabel = {
    released: "출시됨",
    "in-progress": "개발중",
    backend: "백엔드"
  };

  const logTypeEmoji = {
    progress: "📈",
    issue: "🐛",
    solution: "✅",
    milestone: "🎉"
  };

  const logTypeLabel = {
    progress: "진행",
    issue: "이슈",
    solution: "해결",
    milestone: "마일스톤"
  };

  // ✅ 최근 월 수익 계산
  const getLatestMonthRevenue = () => {
    if (!project.revenues || project.revenues.length === 0) return 0;
    const sorted = [...project.revenues].sort((a, b) => 
      new Date(b.month).getTime() - new Date(a.month).getTime()
    );
    return sorted[0].total;
  };

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{statusEmoji[project.status as keyof typeof statusEmoji]}</span>
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {statusLabel[project.status as keyof typeof statusLabel]}
          </span>
        </div>

        <h1 className="text-4xl font-bold mb-4">{project.title}</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
          {project.description}
        </p>

        {/* 태그 */}
        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {project.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-3 py-1 rounded-full text-sm"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* 앱 링크 */}
        {project.appLink && (
          <a
            href={project.appLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            📱 앱 다운로드
          </a>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-8">
        <nav className="flex gap-8">
          <button
            onClick={() => setActiveTab("overview")}
            className={`pb-4 px-2 font-medium transition-colors ${
              activeTab === "overview"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            📋 개요
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`pb-4 px-2 font-medium transition-colors ${
              activeTab === "logs"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            📝 개발 로그 ({project.logs?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("revenues")}
            className={`pb-4 px-2 font-medium transition-colors ${
              activeTab === "revenues"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            💰 수익 현황 ({project.revenues?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("community")}
            className={`pb-4 px-2 font-medium transition-colors ${
              activeTab === "community"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            💬 커뮤니티
          </button>
          {project.privacyPolicy && (
            <button
              onClick={() => setActiveTab("privacy")}
              className={`pb-4 px-2 font-medium transition-colors ${
                activeTab === "privacy"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              🔒 개인정보처리방침
            </button>
          )}
        </nav>
      </div>

      {/* 탭 컨텐츠 */}
      {activeTab === "overview" && (
        <OverviewTab 
          project={project} 
          latestMonthRevenue={getLatestMonthRevenue()} 
        />
      )}

      {activeTab === "logs" && (
        <LogsTab logs={project.logs || []} logTypeEmoji={logTypeEmoji} logTypeLabel={logTypeLabel} />
      )}

      {activeTab === "revenues" && (
        <RevenuesTab revenues={project.revenues || []} />
      )}

      {activeTab === "community" && (
        <CommunityTab projectName={project.name} />
      )}

      {activeTab === "privacy" && project.privacyPolicy && (
        <div className="space-y-4">
          <PrivacyPolicyView
            policy={project.privacyPolicy}
            updatedAt={project.privacyUpdatedAt}
          />
          {/* 스토어 등록용 독립 URL */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            스토어 등록용 주소:{" "}
            <Link
              href={`/project/${project.name}/privacy`}
              className="underline"
            >
              /project/{project.name}/privacy
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

// ==================== 커뮤니티 탭 ====================
function CommunityTab({ projectName }: { projectName: string }) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-700 rounded-xl p-8">
        <h2 className="text-2xl font-bold mb-4">💬 프로젝트 커뮤니티</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          이 프로젝트에 대한 공지사항을 확인하고, 궁금한 점을 문의해보세요.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 공지사항 카드 */}
          <div 
            onClick={() => router.push(`/project/${projectName}/board/notice`)}
            className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg hover:shadow-xl transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-4xl">📢</span>
              <h3 className="text-xl font-bold group-hover:text-blue-600 transition-colors">
                공지사항
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              프로젝트 업데이트, 중요 공지사항을 확인하세요
            </p>
            <Button 
              onPress={() => router.push(`/project/${projectName}/board/notice`)}
              color="primary" 
              variant="flat"
              className="w-full"
            >
              공지사항 보기 →
            </Button>
          </div>

          {/* 문의게시판 카드 */}
          <div 
            onClick={() => router.push(`/project/${projectName}/board/post`)}
            className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg hover:shadow-xl transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-4xl">💬</span>
              <h3 className="text-xl font-bold group-hover:text-blue-600 transition-colors">
                문의게시판
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              궁금한 점을 자유롭게 문의하세요
            </p>
            <Button
              onPress={() => router.push(`/project/${projectName}/board/post`)}
              color="secondary" 
              variant="flat"
              className="w-full"
            >
              문의하기 →
            </Button>
          </div>
        </div>
      </div>

      {/* 추가 안내 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
        <h3 className="font-bold mb-2">💡 이용 안내</h3>
        <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li>• 공지사항: 프로젝트 관련 중요 소식과 업데이트를 확인할 수 있습니다</li>
          <li>• 문의게시판: 버그 리포트, 기능 제안, 일반 문의 등을 남길 수 있습니다</li>
          <li>• 답변은 영업일 기준 1-2일 내에 드립니다</li>
        </ul>
      </div>
    </div>
  );
}

// ==================== 개요 탭 ====================
function OverviewTab({ 
  project, 
  latestMonthRevenue 
}: { 
  project: Project;
  latestMonthRevenue: number;
}) {
  return (
    <div className="space-y-8">
      {/* 프로젝트 정보 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">📌 프로젝트 정보</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoItem label="플랫폼" value={project.platform} />
          <InfoItem label="진행률" value={`${project.progress}%`} />
          <InfoItem 
            label="개발 로그" 
            value={`${project.logCount || project.logs?.length || 0}개`} 
          />
          <InfoItem 
            label="최근 월 수익" 
            value={latestMonthRevenue > 0 ? `${latestMonthRevenue.toLocaleString()}원` : "데이터 없음"} 
          />
        </div>
      </div>

      {/* 기술 스택 */}
      {project.techStack && project.techStack.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">🛠️ 기술 스택</h2>
          <div className="flex flex-wrap gap-2">
            {project.techStack.map((tech, index) => (
              <span
                key={index}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-medium"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 커버 이미지 */}
      {project.coverImage && (
        <div>
          <h2 className="text-2xl font-bold mb-4">🖼️ 프로젝트 이미지</h2>
          <img
            src={project.coverImage}
            alt={project.title}
            className="w-full rounded-lg shadow-lg"
          />
        </div>
      )}
    </div>
  );
}

// ==================== 개발 로그 탭 ====================
function LogsTab({ 
  logs, 
  logTypeEmoji, 
  logTypeLabel 
}: { 
  logs: ProjectLog[];
  logTypeEmoji: Record<string, string>;
  logTypeLabel: Record<string, string>;
}) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        아직 개발 로그가 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {logs.map((log) => (
        <div
          key={log.id}
          className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
        >
          {/* 로그 헤더 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {logTypeEmoji[log.logType as keyof typeof logTypeEmoji]}
              </span>
              <h3 className="text-xl font-bold">{log.title}</h3>
            </div>
            <span className="text-sm text-gray-500">
              {moment(log.createdAt).format("YYYY-MM-DD")}
            </span>
          </div>

          {/* 로그 타입 */}
          <div className="mb-3">
            <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {logTypeLabel[log.logType as keyof typeof logTypeLabel]}
            </span>
          </div>

          {/* 로그 내용 */}
          <p className="text-gray-700 dark:text-gray-300 mb-3 whitespace-pre-wrap">
            {log.content}
          </p>

          {/* 연결된 개발노트 */}
          {log.note && (
            <Link
              href={`/note/detail/${log.note.noteId}`}
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              📚 연결된 개발노트: {log.note.title}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

// ==================== 수익 탭 ====================
function RevenuesTab({ revenues }: { revenues: Revenue[] }) {
  console.log("RevenuesTab - revenues:", revenues); // ✅ 디버깅용

  // null/undefined 체크
  if (!revenues) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-500 rounded-xl p-8 text-center">
        <span className="text-4xl mb-4 block">⚠️</span>
        <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
          수익 데이터를 불러오는 중 오류가 발생했습니다.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          페이지를 새로고침하거나 관리자에게 문의해주세요.
        </p>
      </div>
    );
  }

  // 빈 배열 체크
  if (revenues.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-12 text-center">
        <span className="text-6xl mb-4 block">📊</span>
        <p className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-3">
          아직 등록된 수익 데이터가 없습니다
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          관리자 페이지에서 월별 수익 데이터를 추가해주세요.
        </p>
        <div className="inline-block px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            💡 수익 데이터가 추가되면 이곳에 차트와 통계가 표시됩니다
          </p>
        </div>
      </div>
    );
  }

  // 최신순 정렬
  const sortedRevenues = [...revenues].sort((a, b) => 
    new Date(b.month).getTime() - new Date(a.month).getTime()
  );

  // ✅ 총 누적 수익 계산 (모든 월의 합계)
  const totalRevenue = revenues.reduce((sum, r) => sum + (r.total || 0), 0);
  const totalAdsense = revenues.reduce((sum, r) => sum + (r.adsense || 0), 0);
  const totalInapp = revenues.reduce((sum, r) => sum + (r.inapp || 0), 0);

  // ✅ 최근 월 수익
  const latestRevenue = sortedRevenues[0];

  // ✅ 월 평균 수익
  const avgRevenue = Math.round(totalRevenue / revenues.length);

  return (
    <div className="space-y-8">
      {/* 수익 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="총 누적 수익"
          value={`${totalRevenue.toLocaleString()}원`}
          subtitle={`${revenues.length}개월 누적`}
          icon="💰"
          color="blue"
        />
        <SummaryCard
          title="최근 월 수익"
          value={`${latestRevenue.total.toLocaleString()}원`}
          subtitle={new Date(latestRevenue.month).toLocaleDateString('ko-KR', { month: 'long' })}
          icon="📈"
          color="green"
        />
        <SummaryCard
          title="월 평균 수익"
          value={`${avgRevenue.toLocaleString()}원`}
          subtitle="전체 기간 평균"
          icon="📊"
          color="purple"
        />
        <SummaryCard
          title="수익 발생 기간"
          value={`${revenues.length}개월`}
          subtitle="데이터 집계 기간"
          icon="📅"
          color="orange"
        />
      </div>

      {/* 수익 구성 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6 border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">📢</span>
            <h3 className="font-semibold text-sm text-gray-600 dark:text-gray-400">총 애드센스 수익</h3>
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {totalAdsense.toLocaleString()}원
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            전체의 {((totalAdsense / totalRevenue) * 100).toFixed(1)}%
          </p>
        </div>

        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-6 border border-purple-200 dark:border-purple-800">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">💳</span>
            <h3 className="font-semibold text-sm text-gray-600 dark:text-gray-400">총 인앱 결제 수익</h3>
          </div>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {totalInapp.toLocaleString()}원
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            전체의 {((totalInapp / totalRevenue) * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 월별 수익 상세 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">📅 월별 수익 상세</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            총 {revenues.length}개월 데이터
          </span>
        </div>
        <div className="space-y-4">
          {sortedRevenues.map((revenue, index) => (
            <RevenueCard 
              key={revenue.id} 
              revenue={revenue} 
              isLatest={index === 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== 수익 카드 컴포넌트 ====================
function RevenueCard({ 
  revenue, 
  isLatest 
}: { 
  revenue: Revenue;
  isLatest?: boolean;
}) {
  // 날짜 포맷팅
  const formatMonth = (monthStr: string) => {
    try {
      const date = new Date(monthStr);
      return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
    } catch {
      return monthStr;
    }
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border transition-shadow ${
      isLatest 
        ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-100 dark:ring-blue-900' 
        : 'border-gray-200 dark:border-gray-700 hover:shadow-md'
    }`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">
            {formatMonth(revenue.month)}
          </h3>
          {isLatest && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              최신
            </span>
          )}
        </div>
        <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
          {(revenue.total || 0).toLocaleString()}원
        </span>
      </div>

      {/* 수익 상세 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">애드센스</p>
          <p className="text-lg font-semibold text-green-600 dark:text-green-400">
            {(revenue.adsense || 0).toLocaleString()}원
          </p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">인앱 결제</p>
          <p className="text-lg font-semibold text-purple-600 dark:text-purple-400">
            {(revenue.inapp || 0).toLocaleString()}원
          </p>
        </div>
      </div>

      {/* 추가 지표 */}
      {(revenue.dau || revenue.mau || revenue.downloads || revenue.retention) && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {revenue.dau && (
              <MetricItem label="DAU" value={revenue.dau.toLocaleString()} />
            )}
            {revenue.mau && (
              <MetricItem label="MAU" value={revenue.mau.toLocaleString()} />
            )}
            {revenue.downloads && (
              <MetricItem label="다운로드" value={revenue.downloads.toLocaleString()} />
            )}
            {revenue.retention && (
              <MetricItem label="리텐션" value={`${revenue.retention}%`} />
            )}
          </div>
        </div>
      )}

      {/* 메모 */}
      {revenue.notes && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            📝 {revenue.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ 
  title, 
  value, 
  subtitle,
  icon, 
  color 
}: { 
  title: string; 
  value: string; 
  subtitle?: string;
  icon: string; 
  color: "blue" | "green" | "purple" | "orange";
}) {
  const colorClasses = {
    blue: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400",
    green: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-600 dark:text-green-400",
    purple: "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400",
    orange: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400"
  };

  return (
    <div className={`${colorClasses[color]} border rounded-lg p-6`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{icon}</span>
        <h3 className="font-semibold text-sm text-gray-600 dark:text-gray-400">{title}</h3>
      </div>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

// ==================== 유틸 컴포넌트 ====================
function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{value}</p>
    </div>
  );
}