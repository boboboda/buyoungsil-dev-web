"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Select, SelectItem, Button } from "@heroui/react";
import { toast } from "react-toastify";
import { createWorkRequest, WorkRequestFormData } from "@/serverActions/workRequests";

export default function WorkRequestForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<WorkRequestFormData>({
    name: "",
    email: "",
    company: "",
    phone: "",
    projectType: "",
    budget: "",
    timeline: "",
    title: "",
    description: "",
    requirements: "",
    reference: ""
  });

  const projectTypes = [
    { value: "mobile", label: "📱 모바일 앱" },
    { value: "web", label: "🌐 웹 사이트/서비스" },
    { value: "backend", label: "⚙️ 백엔드/API" },
    { value: "consulting", label: "💡 컨설팅" }
  ];

  const budgets = [
    { value: "under-1000", label: "1000만원 이하" },
    { value: "1000-3000", label: "1000만원 ~ 3000만원" },
    { value: "3000-5000", label: "3000만원 ~ 5000만원" },
    { value: "over-5000", label: "5000만원 이상" }
  ];

  const timelines = [
    { value: "1month", label: "1개월" },
    { value: "2-3months", label: "2-3개월" },
    { value: "3-6months", label: "3-6개월" },
    { value: "over-6months", label: "6개월 이상" }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.email || !formData.projectType || 
        !formData.budget || !formData.timeline || !formData.title || 
        !formData.description) {
      toast.error("필수 항목을 모두 입력해주세요.");
      return;
    }

    setLoading(true);

    try {
      const result = await createWorkRequest(formData);

      if (result.success) {
        toast.success("프로젝트 의뢰가 접수되었습니다! 빠른 시일 내에 연락드리겠습니다.");
        router.push("/");
      } else {
        toast.error(result.error || "의뢰 접수 중 오류가 발생했습니다.");
      }
    } catch (error) {
      console.error("의뢰 제출 오류:", error);
      toast.error("의뢰 접수 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 신청자 정보 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-xl font-bold mb-4">👤 신청자 정보</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="이름 *"
            placeholder="홍길동"
            value={formData.name}
            onValueChange={(v) => setFormData({ ...formData, name: v })}
            required
          />
          <Input
            label="이메일 *"
            type="email"
            placeholder="example@email.com"
            value={formData.email}
            onValueChange={(v) => setFormData({ ...formData, email: v })}
            required
          />
          <Input
            label="회사명"
            placeholder="(주)회사명"
            value={formData.company}
            onValueChange={(v) => setFormData({ ...formData, company: v })}
          />
          <Input
            label="연락처"
            placeholder="010-1234-5678"
            value={formData.phone}
            onValueChange={(v) => setFormData({ ...formData, phone: v })}
          />
        </div>
      </div>

      {/* 프로젝트 정보 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-xl font-bold mb-4">💼 프로젝트 정보</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Select
            label="프로젝트 유형 *"
            placeholder="선택하세요"
            selectedKeys={formData.projectType ? [formData.projectType] : []}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string;
              setFormData({ ...formData, projectType: value });
            }}
            required
          >
            {projectTypes.map((type) => (
              <SelectItem key={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </Select>

          <Select
            label="예산 *"
            placeholder="선택하세요"
            selectedKeys={formData.budget ? [formData.budget] : []}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string;
              setFormData({ ...formData, budget: value });
            }}
            required
          >
            {budgets.map((budget) => (
              <SelectItem key={budget.value}>
                {budget.label}
              </SelectItem>
            ))}
          </Select>

          <Select
            label="희망 기간 *"
            placeholder="선택하세요"
            selectedKeys={formData.timeline ? [formData.timeline] : []}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string;
              setFormData({ ...formData, timeline: value });
            }}
            required
          >
            {timelines.map((timeline) => (
              <SelectItem key={timeline.value}>
                {timeline.label}
              </SelectItem>
            ))}
          </Select>
        </div>

        <Input
          label="프로젝트 제목 *"
          placeholder="ex) 식당 예약 모바일 앱 개발"
          value={formData.title}
          onValueChange={(v) => setFormData({ ...formData, title: v })}
          required
          className="mb-4"
        />

        <Textarea
          label="프로젝트 설명 *"
          placeholder="프로젝트에 대해 자세히 설명해주세요"
          value={formData.description}
          onValueChange={(v) => setFormData({ ...formData, description: v })}
          minRows={6}
          required
          className="mb-4"
        />

        <Textarea
          label="주요 기능/요구사항"
          placeholder="필요한 주요 기능들을 나열해주세요"
          value={formData.requirements}
          onValueChange={(v) => setFormData({ ...formData, requirements: v })}
          minRows={4}
          className="mb-4"
        />

        <Input
          label="참고 URL"
          placeholder="참고할 만한 웹사이트나 앱이 있다면 URL을 적어주세요"
          value={formData.reference}
          onValueChange={(v) => setFormData({ ...formData, reference: v })}
        />
      </div>

      {/* 제출 버튼 */}
      <Button
        type="submit"
        size="lg"
        isLoading={loading}
        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-lg py-6 hover:shadow-2xl transition-shadow"
      >
        프로젝트 의뢰하기
      </Button>

      <p className="text-sm text-gray-500 text-center">
        제출하신 정보는 프로젝트 검토 목적으로만 사용되며, 영업일 기준 2-3일 내에 회신드립니다.
      </p>
    </form>
  );
}