"use client";

import React, { useState } from "react";
import { Input, Textarea, Button, Card, CardBody } from "@heroui/react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useSession } from "next-auth/react";

import { addAPost } from "@/serverActions/posts";

interface ReceivedData {
  postType?: string;
  email?: string;
  writeName?: string;
  appName?: string;
}

export default function PostWrite({
  postType,
  appName,
}: {
  postType?: string;
  appName?: string;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [receivedData, setReceivedData] = useState<ReceivedData | null>(null);

  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);

  const notifySuccessEvent = (msg: string) => toast.success(msg);
  const notifyErrorEvent = (msg: string) => toast.error(msg);

  const { data: session, status } = useSession();

  const handleSubmit = async () => {
    setIsLoading(true);

    await new Promise((f) => setTimeout(f, 600));

    try {
      await addAPost({
        appName: appName!,
        postType: postType || "notice",
        title: title,
        writer: session?.user.name || "익명",
        email: session?.user.email!,
        content: content,
      });

      setIsLoading(false);

      router.push(`/project/${appName}/board/${postType}`);

      notifySuccessEvent(`성공적으로 작성되었습니다!`);

      console.log(`게시글 추가완료`);
    } catch (error) {
      setIsLoading(false);
      console.error("공지사항 작성 실패:", error);
      notifyErrorEvent(`작성이 실패되었습니다!`);
    }
  };

  const handleCancel = () => {
    setTitle("");
    setContent("");
  };

  return (
    <div className="w-full p-6">
      <Card className="w-full shadow-lg" fullWidth={true}>
        <CardBody className="p-8">
          <h1 className="text-2xl font-bold mb-8 text-left">공지사항 작성</h1>

          <div className="w-full space-y-6">
            <div className="w-full space-y-2">
              <label htmlFor="post-title" className="text-sm font-medium text-gray-700 block text-left">
                제목:
              </label>
              <Input
                className="text-left"
                id="post-title"
                classNames={{
                  input: "text-left",
                  inputWrapper: "border-2",
                }}
                placeholder="제목을 입력해주세요"
                size="lg"
                type="text"
                value={title}
                variant="bordered"
                onValueChange={setTitle}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 block text-left">
                내용:
              </label>
              <Textarea
                className="text-left"
                classNames={{
                  input: "text-left",
                  inputWrapper: "border-2",
                }}
                minRows={8}
                placeholder="내용을 입력해주세요"
                size="lg"
                value={content}
                variant="bordered"
                onValueChange={setContent}
              />
            </div>

            <div className="flex flex-row justify-end gap-4 pt-6">
              <Button
                className="px-8"
                color="primary"
                isLoading={isLoading}
                size="lg"
                onPress={handleSubmit}
              >
                작성 완료
              </Button>
              <Button
                className="px-8"
                size="lg"
                variant="bordered"
                onPress={handleCancel}
              >
                취소
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}