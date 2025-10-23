// components/SocialLoginDetector.tsx
"use client";
import { useEffect } from "react";
import { toast } from "react-toastify";

export default function SocialLoginDetector() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const login = urlParams.get("login");
    const provider = urlParams.get("provider");

    console.log("홈페이지 파라미터 체크:", { login, provider });

    if (login === "success") {
      if (provider === "github") {
        toast.success("GitHub 로그인 되었습니다!");
      } else if (provider === "google") {
        toast.success("Google 로그인 되었습니다!");
      }

      // URL 정리
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  return null;
}
