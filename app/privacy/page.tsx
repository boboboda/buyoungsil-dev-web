import { Metadata } from "next";
import Link from "next/link";

import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 코딩천재 부영실",
  description:
    "코딩천재 부영실 웹사이트가 수집하는 개인정보, 이용 목적, 보관 기간, 쿠키와 광고 사용 방식을 안내합니다.",
  alternates: { canonical: "/privacy" },
};

// 시행일이 바뀌면 이 값만 수정하세요.
const EFFECTIVE_DATE = "2026-10-05";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      <div className="space-y-2 leading-relaxed text-gray-700 dark:text-gray-300">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">개인정보처리방침</h1>
      <p className="text-sm text-gray-500 mb-10">시행일: {EFFECTIVE_DATE}</p>

      <p className="mb-8 leading-relaxed text-gray-700 dark:text-gray-300">
        코딩천재 부영실({siteConfig.url}, 이하 &quot;사이트&quot;)은 이용자의
        개인정보를 중요하게 생각하며, 「개인정보 보호법」 등 관련 법령을
        준수합니다. 이 방침은 사이트가 어떤 정보를 어떤 목적으로 수집하고
        어떻게 보호하는지 설명합니다. 사이트에서 소개하는 개별 앱의
        개인정보처리방침은 각 프로젝트 페이지에서 따로 확인할 수 있습니다.
      </p>

      <Section title="1. 수집하는 개인정보 항목과 방법">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>회원가입·로그인:</strong> 이메일, 이름(닉네임), 프로필
            이미지. 이메일 가입 시 비밀번호는 암호화(해시)하여 저장하며 원문은
            알 수 없습니다. Google·GitHub 계정으로 로그인하면 해당 서비스가
            제공하는 이름, 이메일, 프로필 이미지를 받습니다.
          </li>
          <li>
            <strong>게시판·댓글:</strong> 작성자 이름, 이메일, 작성한 내용.
          </li>
          <li>
            <strong>외주 신청:</strong> 이름, 이메일, 회사명(선택), 연락처(선택),
            프로젝트 내용과 참고 링크.
          </li>
          <li>
            <strong>방문 통계:</strong> 하루 단위의 방문자 수 집계. 개인을
            식별하지 않으며, 같은 날 중복 집계를 막기 위해 브라우저 저장소와
            쿠키를 사용합니다.
          </li>
          <li>
            <strong>문의 채팅:</strong> 채널톡(Channel Talk) 위젯을 통해 입력한
            대화 내용과 연락처. 처리는 채널톡의 방침을 따릅니다.
          </li>
        </ul>
      </Section>

      <Section title="2. 개인정보의 이용 목적">
        <ul className="list-disc pl-5 space-y-1">
          <li>회원 식별, 로그인 유지, 작성한 글의 수정·삭제 권한 확인</li>
          <li>문의와 외주 신청에 대한 답변 및 연락</li>
          <li>사이트 이용 통계 분석과 서비스 개선</li>
          <li>부정 이용 방지와 보안 유지</li>
        </ul>
      </Section>

      <Section title="3. 보유 및 이용 기간">
        <p>
          개인정보는 수집·이용 목적이 달성되면 지체 없이 파기합니다. 회원 정보는
          탈퇴 요청 시까지, 문의·외주 신청 내용은 처리 완료 후 필요한 기간
          동안만 보관합니다. 법령에서 보관 기간을 정한 경우에는 그 기간 동안
          보관합니다.
        </p>
      </Section>

      <Section title="4. 쿠키와 광고">
        <p>
          사이트는 로그인 유지와 방문 집계를 위해 쿠키를 사용합니다. 또한
          Google AdSense 등 제3자 광고 서비스를 사용하거나 사용할 수 있습니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Google을 포함한 제3자 공급업체는 쿠키를 사용해 이용자가 이 사이트나
            다른 사이트를 방문한 기록을 바탕으로 광고를 게재할 수 있습니다.
          </li>
          <li>
            Google은 광고 쿠키를 사용해 이용자의 사이트 방문 기록을 기반으로 맞춤
            광고를 제공합니다.
          </li>
          <li>
            이용자는{" "}
            <a
              className="text-blue-600 hover:underline"
              href="https://adssettings.google.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google 광고 설정
            </a>
            에서 맞춤 광고를 해제할 수 있으며,{" "}
            <a
              className="text-blue-600 hover:underline"
              href="https://policies.google.com/technologies/ads"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google 광고 기술 안내
            </a>
            에서 자세한 내용을 확인할 수 있습니다.
          </li>
          <li>
            브라우저 설정에서 쿠키 저장을 거부하거나 삭제할 수 있습니다. 다만
            로그인 등 일부 기능이 제한될 수 있습니다.
          </li>
        </ul>
      </Section>

      <Section title="5. 개인정보의 제3자 제공과 처리 위탁">
        <p>
          사이트는 이용자의 동의가 있거나 법령에 근거가 있는 경우를 제외하고
          개인정보를 제3자에게 제공하지 않습니다. 서비스 제공을 위해 아래
          외부 서비스를 이용합니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Google LLC: 소셜 로그인, 광고(AdSense)</li>
          <li>GitHub, Inc.: 소셜 로그인</li>
          <li>Channel Corp.(채널톡): 문의 채팅</li>
        </ul>
      </Section>

      <Section title="6. 이용자의 권리">
        <p>
          이용자는 언제든지 자신의 개인정보에 대해 열람, 정정, 삭제, 처리 정지를
          요청할 수 있으며 회원 탈퇴를 요구할 수 있습니다. 아래 연락처로
          요청하면 지체 없이 조치합니다.
        </p>
      </Section>

      <Section title="7. 안전성 확보 조치">
        <ul className="list-disc pl-5 space-y-1">
          <li>비밀번호 암호화 저장</li>
          <li>전송 구간 암호화(HTTPS) 적용</li>
          <li>관리자 페이지 접근 권한 제한</li>
          <li>비정상 접근 차단 및 접근 기록 점검</li>
        </ul>
      </Section>

      <Section title="8. 만 14세 미만 아동">
        <p>
          사이트는 만 14세 미만 아동의 회원가입을 받지 않으며, 아동의 개인정보를
          의도적으로 수집하지 않습니다.
        </p>
      </Section>

      <Section title="9. 개인정보 보호책임자 및 문의">
        <p>
          운영자: 부영실
          <br />
          이메일:{" "}
          <a
            className="text-blue-600 hover:underline"
            href={`mailto:${siteConfig.contactEmail}`}
          >
            {siteConfig.contactEmail}
          </a>
        </p>
        <p>
          그 밖의 개인정보 침해 신고는 개인정보침해신고센터(privacy.kisa.or.kr,
          국번없이 118)에 문의할 수 있습니다.
        </p>
      </Section>

      <Section title="10. 방침의 변경">
        <p>
          이 방침이 변경되면 시행일과 함께 이 페이지에 공지합니다. 앱별
          개인정보처리방침은{" "}
          <Link className="text-blue-600 hover:underline" href="/project">
            프로젝트 페이지
          </Link>
          에서 확인하세요.
        </p>
      </Section>
    </div>
  );
}