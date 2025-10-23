"use client";

import { useEffect, useState } from "react";

import VisitCalcurateView from "./visitCalcurateView";
import CustomTyped from "./customTyped";
// import { useAuthStore, useAuthStoreSubscribe } from "@/components/providers/auth-store-provider";
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
        {/* 상단 섹션: 애니메이션(왼쪽)과 프로필 텍스트(오른쪽) */}
        <div className="flex flex-row w-full max-w-[1400px] lg:h-[700px] justify-center items-center px-4 lg:px-0">
          {/* 애니메이션 섹션 - 항상 왼쪽에 배치 */}
          <div className="w-1/2 h-full flex  py-4 items-start lg:py-0 scale-75 sm:scale-90 lg:scale-100">
            <Animation />
          </div>

          {/* 프로필 텍스트 섹션 - 항상 오른쪽에 배치 */}
          <div className="w-1/2 h-full flex flex-col items-start justify-start pt-[50px] lg:pt-[100px] pr-[10px] lg:pr-[150px] scale-75 sm:scale-90 lg:scale-100">
            <TypedComponent
              className={`${title({ size: "smd", color: "black" })} lg:text-[3rem] lg: font-bold`}
              showEndCursor="none"
              start={startFirst}
              text="프로필"
            />
            <br />
            <TypedComponent
              className={title({ size: "sm", color: "black" })}
              showEndCursor="none"
              start={startSecond}
              text="이름: 부영실"
            />
            <br />
            <TypedComponent
              className={title({ size: "sm", color: "black" })}
              showEndCursor="none"
              start={startThird}
              text="취미: 코딩, 게임 등"
            />
            <br />
            <TypedComponent
              className={title({ size: "sm", color: "black" })}
              showEndCursor="none"
              start={startFour}
              text="관심사: 재테크, 개발, 1인기업"
            />
            <br />
            <TypedComponent
              className={title({ size: "sm", color: "black" })}
              start={startFive}
              text="할줄 아는 것: 안드로이드 개발, IOS 개발, 웹 개발"
            />
          </div>
        </div>

        {/* 하단 섹션: 방문자 카운터와 소개글 */}
        <div className="w-full bg-slate-300 dark:bg-slate-900 flex justify-center">
          <div className="w-full max-w-[1400px] flex flex-col lg:flex-row bg-slate-300 dark:bg-slate-900 py-8 lg:py-[80px] px-4 lg:px-0">
            {/* 방문자 계산 뷰 섹션 */}
            <div className="w-full lg:w-1/2 flex justify-center mb-10 lg:mb-0">
              <VisitCalcurateView
                initialTodayCount={todayCount}
                initialTotalCount={totalCount}
                initialUserTotalCount={userCount}
              />
            </div>

            {/* 소개글 섹션 */}
            <div className="flex flex-col w-full lg:w-1/2 lg:pl-[50px] space-y-6 lg:space-y-10 text-center lg:text-left items-center lg:items-start px-4 lg:px-0">
              <h1 className={title({ size: "sm" })}>안녕하세요!!</h1>
              <li className={title({ size: "sm" })}>코딩천재 부영실입니다.</li>
              <li className={title({ size: "sm" })}>여러분은 꿈을 꾸십니까?</li>
              <CustomTyped />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
