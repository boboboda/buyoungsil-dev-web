import { Metadata } from "next";
import StoryForm from "@/components/admin/stories/StoryForm";

export const metadata: Metadata = {
  title: "스토리 작성 | 관리자",
};

export default function CreateStoryPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">📝 새 스토리 작성</h1>
      <StoryForm />
    </div>
  );
}