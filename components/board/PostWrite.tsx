"use client";

import React, { useState } from "react";
import { Input, Textarea, Button, Card, CardBody } from "@heroui/react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import { addAPost } from "@/serverActions/posts";
import { useBoardBase, useViewer } from "@/components/app/AppViewerContext";

export default function PostWrite({
  postType,
  appName,
}: {
  postType?: string;
  appName?: string;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const router = useRouter();
  const { isApp, isLoggedIn } = useViewer();

  const resolvedPostType = postType || "notice";
  const base = useBoardBase(appName!, resolvedPostType);

  const notifySuccessEvent = (msg: string) => toast.success(msg);
  const notifyErrorEvent = (msg: string) => toast.error(msg);

  const handleSubmit = async () => {
    if (isLoading) return;

    if (!isLoggedIn) {
      notifyErrorEvent(
        isApp
          ? "작성 권한을 확인하지 못했습니다. 앱을 닫고 다시 열어주세요."
          : "로그인 후 작성할 수 있습니다.",
      );

      return;
    }

    if (!title.trim() || !content.trim()) {
      notifyErrorEvent("제목과 내용을 입력해주세요.");

      return;
    }

    setIsLoading(true);

    try {
      // 작성자 이름과 소유자 키는 서버가 직접 확인한다.
      await addAPost({
        appName: appName!,
        postType: resolvedPostType,
        title,
        content,
      });

      router.push(base);

      notifySuccessEvent(`성공적으로 작성되었습니다!`);
    } catch (error) {
      console.error("게시글 작성 실패:", error);
      notifyErrorEvent(`작성이 실패되었습니다!`);
    } finally {
      setIsLoading(false);
    }
  };

  // WebView에서는 window.confirm이 동작하지 않을 수 있어 두 번 눌러 취소하는 방식으로 처리한다.
  const handleCancel = () => {
    const hasContent = title.trim() !== "" || content.trim() !== "";

    if (hasContent && !confirmCancel) {
      setConfirmCancel(true);
      toast.info("작성 중인 내용이 사라집니다. 한 번 더 누르면 취소됩니다.");

      return;
    }

    router.push(base);
  };

  return (
    <div className="w-full p-4 sm:p-6 box-border">
      <Card className="w-full shadow-lg" fullWidth={true}>
        <CardBody className="p-4 sm:p-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-6 text-left">
            {resolvedPostType === "notice" ? "공지사항" : "문의사항"} 작성
          </h1>

          <div className="w-full space-y-5">
            <div className="w-full space-y-2">
              <label
                className="text-sm font-medium text-gray-700 block text-left"
                htmlFor="post-title"
              >
                제목:
              </label>
              <Input
                className="text-left"
                classNames={{
                  input: "text-left",
                  inputWrapper: "border-2",
                }}
                id="post-title"
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

            <div className="flex flex-row justify-end gap-3 pt-4">
              <Button
                className="px-6"
                color="primary"
                isLoading={isLoading}
                size="lg"
                onPress={handleSubmit}
              >
                작성 완료
              </Button>
              <Button
                className="px-6"
                color={confirmCancel ? "danger" : "default"}
                size="lg"
                variant="bordered"
                onPress={handleCancel}
              >
                {confirmCancel ? "정말 취소" : "취소"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}