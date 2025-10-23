"use client";

import { useEffect, useState } from "react";

import VisitCalcurateView from "./visitCalcurateView";
import CustomTyped from "./customTyped";
import Animation from "./animation";
import TypedComponent from "./heroTyped";
import SocialLoginDetector from "./SocialLoginDetector";

import { title } from "@/components/primitives";
import { useVisitor } from "@/app/hooks/main/useVisitor";

export default function Hero() {
  const [startFirst, setStartFirst] = useState(false);
  const [startSecond, setStartSecond] = useState(false);
  const [startThird, setStartThird] = useState(false);
  const [startFour, setStartFour] = useState(false);
  const [startFive, setStartFive] = useState(false);

  const { todayCount, totalCount, userCount, loading, error } = useVisitor();

  useEffect(() => {
    const timer1 = setTimeout(() => setStartFirst(true), 300);
    const timer2 = setTimeout(() => setStartSecond(true), 1000);
    const timer3 = setTimeout(() => setStartThird(true), 2500);
    const timer4 = setTimeout(() => setStartFour(true), 4500);
    const timer5 = setTimeout(() => setStartFive(true), 7000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      clearTimeout(timer5);
    };
  }, []);

  return (
    <>
      <SocialLoginDetector />
      <div className="flex flex-col w-full lg:h-[1500px] justify-start items-center">
        {/* 🔥 상단 섹션: 모바일 세로, 데스크톱 가로 */}
        <div className="flex flex-col md:flex-row w-full max-w-[1400px] lg:h-[700px] justify-center items-center gap-6 md:gap-0 py-6 md:py-0">
          
          {/* 🔥 애니메이션 섹션 */}
          <div className="w-full md:w-1/2 flex justify-center items-center">
            <div className="w-[200px] sm:w-[250px] md:w-[320px] lg:w-[450px]">
              <Animation />
            </div>
          </div>

          {/* 🔥 프로필 텍스트 섹션 */}
          <div className="w-full md:w-1/2 flex flex-col items-center md:items-start justify-center md:pt-[100px] px-4 md:px-6 lg:pr-[150px] space-y-2 md:space-y-4">
            <TypedComponent
              className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-center md:text-left"
              showEndCursor="none"
              start={startFirst}
              text="프로필"
            />
            <TypedComponent
              className="text-sm sm:text-base md:text-lg lg:text-xl text-center md:text-left"
              showEndCursor="none"
              start={startSecond}
              text="이름: 부영실"
            />
            <TypedComponent
              className="text-sm sm:text-base md:text-lg lg:text-xl text-center md:text-left"
              showEndCursor="none"
              start={startThird}
              text="취미: 코딩, 게임 등"
            />
            <TypedComponent
              className="text-sm sm:text-base md:text-lg lg:text-xl text-center md:text-left"
              showEndCursor="none"
              start={startFour}
              text="관심사: 재테크, 개발, 1인기업"
            />
            <TypedComponent
              className="text-sm sm:text-base md:text-lg lg:text-xl text-center md:text-left"
              start={startFive}
              text="할줄 아는 것: 안드로이드 개발, IOS 개발, 웹 개발"
            />
          </div>
        </div>

        {/* 🔥 하단 섹션: 방문자 카운터와 소개글 - full-width 배경 */}
        <div className="w-screen bg-slate-300 dark:bg-slate-900 flex justify-center -mx-4 md:mx-0">
          <div className="w-full max-w-[1400px] flex flex-col lg:flex-row bg-slate-300 dark:bg-slate-900 py-8 lg:py-[80px] px-4 lg:px-0 gap-8 lg:gap-0">
            
            {/* 방문자 계산 뷰 섹션 */}
            <div className="w-full lg:w-1/2 flex justify-center">
              <VisitCalcurateView
                initialTodayCount={todayCount}
                initialTotalCount={totalCount}
                initialUserTotalCount={userCount}
              />
            </div>

            {/* 소개글 섹션 */}
            <div className="flex flex-col w-full lg:w-1/2 lg:pl-[50px] space-y-4 lg:space-y-10 text-center lg:text-left items-center lg:items-start">
              <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold">안녕하세요!!</h1>
              <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl">코딩천재 부영실입니다.</p>
              <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl">여러분은 꿈을 꾸십니까?</p>
              <CustomTyped />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}