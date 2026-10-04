// components/project/PrivacyPolicyView.tsx
// 마크다운으로 저장된 개인정보처리방침을 렌더링 (상세 탭 / 독립 페이지 공용)
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import moment from "moment";

interface PrivacyPolicyViewProps {
  policy: string;
  /** 시행일 (ISO 문자열) */
  updatedAt?: string | null;
}

export default function PrivacyPolicyView({ policy, updatedAt }: PrivacyPolicyViewProps) {
  return (
    <article>
      {updatedAt && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          시행일: {moment(updatedAt).format("YYYY년 M월 D일")}
        </p>
      )}

      {/* react-markdown 은 기본적으로 원본 HTML 을 렌더링하지 않아 XSS 에 안전합니다 */}
      <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {policy}
        </ReactMarkdown>
      </div>
    </article>
  );
}