"use client";
import React, { useState } from "react";
import {
  Input,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardFooter,
  Textarea,
  Divider,
  Image,
  Chip,
  Select,
  SelectItem,
} from "@heroui/react";
import { toast } from "react-toastify";
import { useRouter } from "next/navigation";

import { addApp } from "@/serverActions/releases";

const colorOptions = [
  { value: "default", label: "회색" },
  { value: "primary", label: "파란색" },
  { value: "secondary", label: "보라색" },
  { value: "success", label: "초록색" },
  { value: "warning", label: "노란색" },
  { value: "danger", label: "빨간색" },
];

const ReleaseItemAddComponent = () => {
  const [formData, setFormData] = useState({
    appTitle: "",
    appLink: "",
    description: "",
    databaseId: "",
    imageUrl: "", // coverImage 대신 imageUrl 사용
  });

  const router = useRouter();

  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedColor, setSelectedColor] = useState("default");
  const [previewUrl, setPreviewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false); // 업로드 상태 추가

  const handleInputChange = (field, value) => {
    setFormData({
      ...formData,
      [field]: value,
    });
  };

  // 이미지 처리 공통 함수 - 서버 업로드 방식으로 변경
  const processImageFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드할 수 있습니다.");

      return;
    }

    setIsUploading(true);

    try {
      // 이미지를 즉시 서버에 업로드
      const uploadFormData = new FormData();

      uploadFormData.append("image", file);

      const response = await fetch("/api/upload/local", {
        method: "POST",
        body: uploadFormData,
      });

      const result = await response.json();

      if (result.success) {
        // 서버에서 받은 URL로 설정
        setPreviewUrl(result.imageUrl);
        setFormData((prev) => ({
          ...prev,
          imageUrl: result.imageUrl, // URL 저장
        }));
        toast.success("이미지 업로드 성공!");
      } else {
        toast.error(result.error || "이미지 업로드 실패");
      }
    } catch (error) {
      toast.error("이미지 업로드 중 오류가 발생했습니다.");
      console.error("Upload error:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];

    if (file) {
      processImageFile(file);
    }
  };

  // 드래그앤드롭 이벤트 핸들러들
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files) as File[];
    const imageFile = files.find((file: File) =>
      file.type.startsWith("image/"),
    );

    if (imageFile) {
      processImageFile(imageFile);
    } else {
      toast.error("이미지 파일을 드래그해주세요.");
    }
  };

  const addTag = () => {
    if (tagInput.trim()) {
      setTags([...tags, { name: tagInput.trim(), color: selectedColor }]);
      setTagInput("");
    }
  };

  const removeTag = (index) => {
    const newTags = [...tags];

    newTags.splice(index, 1);
    setTags(newTags);
  };

  const notifySuccessEvent = (msg) => toast.success(msg);
  const notifyErrorEvent = (msg) => toast.error(msg);

  const handleSubmit = async () => {
    setIsLoading(true);

    try {
      const formDataToSend = new FormData();

      formDataToSend.append("title", formData.appTitle);
      formDataToSend.append("description", formData.description);
      formDataToSend.append("appLink", formData.appLink);

      if (formData.databaseId) {
        formDataToSend.append("databaseId", formData.databaseId);
      }

      // 이미지 URL 추가 (File 객체 대신)
      if (formData.imageUrl) {
        formDataToSend.append("imageUrl", formData.imageUrl);
      }

      formDataToSend.append("tags", JSON.stringify(tags));

      await addApp(formDataToSend);

      notifySuccessEvent("앱 정보가 성공적으로 저장되었습니다!");

      // 폼 초기화
      setFormData({
        appTitle: "",
        appLink: "",
        description: "",
        databaseId: "",
        imageUrl: "", // 초기화
      });
      setTags([]);
      setPreviewUrl("");

      router.push("/release");
    } catch (error) {
      notifyErrorEvent("앱 정보 저장에 실패했습니다. 다시 시도해주세요.");
      console.error("Error saving app info:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col items-center w-full max-w-4xl mx-auto py-8 px-4">
        <Card className="w-full shadow-lg">
          <CardHeader className="flex gap-3 bg-gradient-to-r from-blue-500 to-purple-500">
            <div className="flex flex-col">
              <p className="text-xl font-bold text-white">
                앱 릴리즈 정보 등록
              </p>
              <p className="text-white text-small">
                새로운 앱 정보를 등록합니다
              </p>
            </div>
          </CardHeader>

          <CardBody className="gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                isRequired
                label="앱 제목"
                placeholder="앱의 이름을 입력하세요"
                value={formData.appTitle}
                variant="bordered"
                onValueChange={(value) => handleInputChange("appTitle", value)}
              />

              <Input
                isRequired
                label="앱 링크"
                placeholder="example.com/app"
                startContent={
                  <div className="pointer-events-none flex items-center">
                    <span className="text-small text-default-400">
                      https://
                    </span>
                  </div>
                }
                value={formData.appLink}
                variant="bordered"
                onValueChange={(value) => handleInputChange("appLink", value)}
              />
            </div>

            <Divider className="my-2" />

            <div className="flex flex-col gap-2">
              <p className="text-small font-medium">커버 이미지</p>
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center transition-all duration-200 ${
                  isDragging
                    ? "border-blue-500 bg-blue-50 scale-[1.02]"
                    : previewUrl
                      ? "border-gray-200"
                      : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                }`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                {previewUrl ? (
                  <div className="relative flex items-center justify-center">
                    <Image
                      alt="미리보기"
                      className="max-h-64 object-contain"
                      src={previewUrl}
                    />
                    <Button
                      className="absolute top-2 right-2"
                      color="danger"
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        setPreviewUrl("");
                        setFormData({ ...formData, imageUrl: "" });
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                ) : (
                  <div className="py-8">
                    {isUploading ? (
                      <div className="text-blue-600">
                        <p className="text-lg font-medium mb-2">
                          ⏳ 이미지 업로드 중...
                        </p>
                        <p className="text-sm">잠시만 기다려주세요</p>
                      </div>
                    ) : isDragging ? (
                      <div className="text-blue-600">
                        <p className="text-lg font-medium mb-2">
                          📁 이미지를 여기에 놓으세요!
                        </p>
                        <p className="text-sm">파일을 놓으면 업로드됩니다</p>
                      </div>
                    ) : (
                      <div className="text-gray-500">
                        <p className="mb-4">
                          🖼️ 이미지를 여기에 드래그하거나 파일을 선택하세요
                        </p>
                        <p className="text-xs mb-4 text-gray-400">
                          JPG, PNG, GIF, WebP 파일을 지원합니다
                        </p>
                        <Button
                          color="primary"
                          isDisabled={isUploading}
                          variant="flat"
                          onPress={() =>
                            document.getElementById("image-upload").click()
                          }
                        >
                          {isUploading ? "업로드 중..." : "이미지 업로드"}
                        </Button>
                        <input
                          accept="image/*"
                          className="hidden"
                          disabled={isUploading}
                          id="image-upload"
                          type="file"
                          onChange={handleImageUpload}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-small font-medium">태그 추가</p>
                <div className="flex flex-row gap-2">
                  <Select
                    aria-label="색상"
                    className="w-1/3"
                    defaultSelectedKeys={["default"]}
                    placeholder="색상"
                    onChange={(e) => setSelectedColor(e.target.value)}
                  >
                    {colorOptions.map((color) => (
                      <SelectItem key={color.value}>{color.label}</SelectItem>
                    ))}
                  </Select>

                  <Input
                    aria-label="태그명"
                    className="w-2/3"
                    placeholder="태그명 입력"
                    value={tagInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    onValueChange={setTagInput}
                  />

                  <Button color="primary" onPress={addTag}>
                    추가
                  </Button>
                </div>

                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {tags.map((tag, index) => (
                      <Chip
                        key={index}
                        color={tag.color}
                        variant="flat"
                        onClose={() => removeTag(index)}
                      >
                        {tag.name}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              <Input
                label="데이터베이스 ID"
                placeholder="관련 데이터베이스 ID를 입력하세요"
                value={formData.databaseId}
                variant="bordered"
                onValueChange={(value) =>
                  handleInputChange("databaseId", value)
                }
              />
            </div>

            <Textarea
              isRequired
              label="앱 설명"
              minRows={5}
              placeholder="앱에 대한 설명을 입력하세요. 줄바꿈을 사용하여 요점을 구분할 수 있습니다."
              value={formData.description}
              variant="bordered"
              onValueChange={(value) => handleInputChange("description", value)}
            />
          </CardBody>

          <CardFooter className="justify-end gap-2">
            <Button variant="flat">취소</Button>
            <Button
              color="primary"
              isDisabled={isUploading}
              isLoading={isLoading}
              onPress={handleSubmit}
            >
              저장하기
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
};

export default ReleaseItemAddComponent;
