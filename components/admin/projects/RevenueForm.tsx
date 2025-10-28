"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectItem,
  Input,
  Textarea,
  Button,
  Card
} from "@heroui/react";
import { toast } from "react-toastify";
import { createOrUpdateRevenue } from "@/serverActions/projects";
import type { Project } from "@/types";

interface RevenueFormProps {
  projects: Project[];
}

export default function RevenueForm({ projects }: RevenueFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  
  const currentMonth = new Date().toISOString().slice(0, 7); // "2025-01"
  
  const [formData, setFormData] = useState({
    projectId: "",
    month: currentMonth,
    adsense: "",
    inapp: "",
    dau: "",
    mau: "",
    downloads: "",
    notes: ""
  });

  const total = (Number(formData.adsense) || 0) + (Number(formData.inapp) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.projectId || !formData.month) {
      toast.error("프로젝트와 월을 선택하세요");
      return;
    }

    setLoading(true);

    try {
      await createOrUpdateRevenue({
        projectId: formData.projectId,
        month: formData.month,
        adsense: Number(formData.adsense) || 0,
        inapp: Number(formData.inapp) || 0,
        dau: formData.dau ? Number(formData.dau) : undefined,
        mau: formData.mau ? Number(formData.mau) : undefined,
        downloads: formData.downloads ? Number(formData.downloads) : undefined,
        notes: formData.notes || undefined
      });

      toast.success("수익 데이터가 저장되었습니다");
      router.push("/admin/projects");
      router.refresh();
    } catch (error) {
      toast.error("저장에 실패했습니다");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 프로젝트 선택 */}
      <Select
        label="프로젝트"
        placeholder="출시된 프로젝트를 선택하세요"
        selectedKeys={formData.projectId ? [formData.projectId] : []}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as string;
          setFormData(prev => ({ ...prev, projectId: value }));
        }}
        isRequired
      >
        {projects.map((project) => (
          <SelectItem key={project.id}>
            {project.title}
          </SelectItem>
        ))}
      </Select>

      {/* 월 선택 */}
      <Input
        label="월"
        type="month"
        value={formData.month}
        onValueChange={(value) => setFormData(prev => ({ ...prev, month: value }))}
        isRequired
      />

      {/* 수익 입력 */}
      <Card className="p-4">
        <h3 className="text-lg font-bold mb-4">💰 수익</h3>
        <div className="space-y-4">
          <Input
            label="애드센스 수익 (원)"
            type="number"
            placeholder="0"
            value={formData.adsense}
            onValueChange={(value) => setFormData(prev => ({ ...prev, adsense: value }))}
          />
          
          <Input
            label="인앱결제 수익 (원)"
            type="number"
            placeholder="0"
            value={formData.inapp}
            onValueChange={(value) => setFormData(prev => ({ ...prev, inapp: value }))}
          />

          <div className="pt-4 border-t">
            <p className="text-lg font-bold">
              합계: {total.toLocaleString()}원
            </p>
          </div>
        </div>
      </Card>

      {/* 통계 데이터 */}
      <Card className="p-4">
        <h3 className="text-lg font-bold mb-4">📊 통계 (선택사항)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="DAU (일평균 사용자)"
            type="number"
            placeholder="0"
            value={formData.dau}
            onValueChange={(value) => setFormData(prev => ({ ...prev, dau: value }))}
          />
          
          <Input
            label="MAU (월평균 사용자)"
            type="number"
            placeholder="0"
            value={formData.mau}
            onValueChange={(value) => setFormData(prev => ({ ...prev, mau: value }))}
          />

          <Input
            label="다운로드 수"
            type="number"
            placeholder="0"
            value={formData.downloads}
            onValueChange={(value) => setFormData(prev => ({ ...prev, downloads: value }))}
          />
        </div>
      </Card>

      {/* 메모 */}
      <Textarea
        label="메모"
        placeholder="이번 달 특이사항, 개선 사항 등을 기록하세요"
        value={formData.notes}
        onValueChange={(value) => setFormData(prev => ({ ...prev, notes: value }))}
        minRows={4}
      />

      {/* 저장 버튼 */}
      <Button
        type="submit"
        color="primary"
        size="lg"
        isLoading={loading}
        className="w-full"
      >
        저장
      </Button>
    </form>
  );
}