"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";

export default function SocialLoginProvider() {
  const searchParams = useSearchParams();
  const hasProcessed = useRef(false); // 이미 처리했는지 확인
  const processedKey = useRef<string | null>(null); // 어떤 키를 처리했는지 기록

  useEffect(() => {
    const login = searchParams.get("login");
    const provider = searchParams.get("provider");

    // 현재 URL의 고유 키 생성
    const currentKey = `${login}-${provider}-${Date.now()}`;

    // 이미 처리했거나, 필요한 파라미터가 없으면 무시
    if (hasProcessed.current || !login || !provider) {
      return;
    }

    // 같은 파라미터를 다시 처리하는 것 방지
    const lastProcessedTime = localStorage.getItem("lastSocialLoginProcess");
    const currentTime = Date.now();

    if (lastProcessedTime && currentTime - parseInt(lastProcessedTime) < 5000) {
      console.log("최근에 처리한 소셜로그인이라 스킵");

      return;
    }

    if (login === "success") {
      console.log("소셜로그인 성공 감지:", provider);

      if (provider === "github") {
        toast.success("GitHub 로그인 되었습니다!");
      } else if (provider === "google") {
        toast.success("Google 로그인 되었습니다!");
      }

      // 처리 완료 표시
      hasProcessed.current = true;
      processedKey.current = currentKey;
      localStorage.setItem("lastSocialLoginProcess", currentTime.toString());

      // URL 정리 (파라미터 제거)
      const newUrl = window.location.pathname;

      window.history.replaceState({}, "", newUrl);

      console.log("URL 정리 완료");
    }
  }, [searchParams]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      // 5분 후 localStorage 정리
      setTimeout(() => {
        localStorage.removeItem("lastSocialLoginProcess");
      }, 300000); // 5분
    };
  }, []);

  return null; // UI는 렌더링하지 않음
}
