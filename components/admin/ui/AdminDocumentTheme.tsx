// components/admin/ui/AdminDocumentTheme.tsx
// 관리자 화면(/admin/*)에 있는 동안 <html>·<body> 에 data-admin 속성을 단다. admin-ui.css 가 이 속성으로 html·body 바탕을 어둡게(color-scheme: dark,
// overscroll 막음) 한다. 같은 규칙을 html:has(.factory-ui) 로도 걸어 서버 HTML 첫 화면부터 어둡고, 이 속성은 :has 를 모르는 브라우저용이다.
// 관리자 레이아웃이 사라지면(공개 사이트로 이동) 속성을 떼서 공개 사이트 배경은 원래대로 돌아간다.
"use client";

import { useEffect } from "react";

export const ADMIN_ATTR = "data-admin";

type AttrTarget = Pick<Element, "setAttribute" | "removeAttribute">;

/** 속성을 달고, 떼는 정리 함수를 돌려준다 */
export function applyAdminDocument(doc: {
  documentElement: AttrTarget;
  body: AttrTarget;
}) {
  doc.documentElement.setAttribute(ADMIN_ATTR, "");
  doc.body.setAttribute(ADMIN_ATTR, "");

  return () => {
    doc.documentElement.removeAttribute(ADMIN_ATTR);
    doc.body.removeAttribute(ADMIN_ATTR);
  };
}

export default function AdminDocumentTheme() {
  useEffect(() => applyAdminDocument(document), []);

  return null;
}
