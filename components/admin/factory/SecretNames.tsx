// components/admin/factory/SecretNames.tsx
// 앱 제작에 쓸 수 있는 키 "이름" 목록 관리. 이름과 설명만 다루고 키 값은 다루지 않는다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Input } from "@heroui/react";

interface SecretName {
  name: string;
  description: string;
}

export default function SecretNames() {
  const [secrets, setSecrets] = useState<SecretName[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/secret-names", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) setSecrets(data.names);
      else setMessage(data.message ?? "키 이름 목록을 읽지 못했어요.");
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const res = await fetch("/api/admin/factory/secret-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        description: newDesc.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));

    setMessage(
      res.ok ? "키 이름을 저장했어요." : (data.message ?? "저장하지 못했어요."),
    );
    if (res.ok) {
      setNewName("");
      setNewDesc("");
      load();
    }
  };

  const remove = async (name: string) => {
    if (
      !window.confirm(
        `${name} 이름을 목록에서 지울까요? (키 값은 건드리지 않아요)`,
      )
    )
      return;
    const res = await fetch(
      `/api/admin/factory/secret-names?name=${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      },
    );
    const data = await res.json().catch(() => ({}));

    setMessage(res.ok ? "지웠어요." : (data.message ?? "지우지 못했어요."));
    load();
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-lg font-bold">🔑 사용할 수 있는 키 이름</h2>
        <p className="text-xs text-default-500">
          이름과 설명만 저장해요. 실제 키 값은 이 홈페이지에 두지 않고 내 PC에만
          있어요. 채팅의 Claude가 이 목록을 보고 기획서에 필요한 키를 골라요.
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        {message && <p className="text-sm text-default-600">{message}</p>}
        {secrets?.length === 0 && (
          <p className="text-sm text-default-500">등록된 이름이 없어요.</p>
        )}
        {secrets?.map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <div className="min-w-0">
              <span className="font-mono font-semibold">{s.name}</span>
              <span className="ml-2 text-default-500">{s.description}</span>
            </div>
            <Button
              color="danger"
              size="sm"
              variant="light"
              onPress={() => remove(s.name)}
            >
              삭제
            </Button>
          </div>
        ))}
        <div className="flex flex-col gap-2 border-t border-default-200 pt-3 sm:flex-row">
          <Input
            label="키 이름"
            placeholder="PIXELLAB_TOKEN"
            size="sm"
            value={newName}
            onValueChange={setNewName}
          />
          <Input
            label="어디에 쓰는지"
            placeholder="도트 이미지 생성"
            size="sm"
            value={newDesc}
            onValueChange={setNewDesc}
          />
          <Button
            color="primary"
            isDisabled={!newName.trim() || !newDesc.trim()}
            onPress={add}
          >
            추가
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
