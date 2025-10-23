"use client";

import React, { useState, useEffect, useRef } from "react";

import CircularProgress from "./CircularProgress";
import { operateingCounts } from "./visitCounter";

import { useVisitorStore } from "@/store/visitorStore";
import {
  getTodayVisitorCount,
  getTotalVisitorCount,
} from "@/serverActions/visitor";
import { fetchTotalUserCount } from "@/serverActions/fetchUser";

interface HeroProps {
  initialTodayCount: number;
  initialTotalCount: number;
  initialUserTotalCount: number;
}

const VisitCalculateView = ({
  initialTodayCount,
  initialTotalCount,
  initialUserTotalCount,
}: HeroProps) => {
  const [progress, setProgress] = useState<number>(0);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [scrollY, setScrollY] = useState<number>(0);
  const [operatingDays, setOperatingDays] = useState(0);

  const { todayCount, totalCount, totalUserCount, setCounts } =
    useVisitorStore();

  useEffect(() => {
    setCounts(initialTodayCount, initialTotalCount, initialUserTotalCount);

    const fetchLatestCounts = async () => {
      const today = await getTodayVisitorCount();
      const total = await getTotalVisitorCount();
      const totalUser = await fetchTotalUserCount();

      setCounts(today, total, totalUser);
    };

    const intervalId = setInterval(fetchLatestCounts, 60 * 1000);

    return () => clearInterval(intervalId);
  }, [initialTodayCount, initialTotalCount, initialUserTotalCount, setCounts]);

  const animationTriggeredRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    setScrollY(window.scrollY);
  };

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const fetchVisitData = () => {
      const { operatingDays } = operateingCounts();

      setOperatingDays(operatingDays);
    };

    fetchVisitData();
    const intervalId = setInterval(fetchVisitData, 60000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const checkVisibility = () => {
      if (animationTriggeredRef.current) return;

      const containerElement = containerRef.current;

      if (!containerElement) return;

      const rect = containerElement.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      const isShortPage = document.body.scrollHeight < windowHeight + 300;
      const isInViewport = rect.top < windowHeight;

      if (
        (scrollY > 250 || isShortPage || isInViewport) &&
        !animationTriggeredRef.current
      ) {
        const timer = setTimeout(() => {
          setIsVisible(true);
          setProgress(75);
          setIsMounted(true);
          animationTriggeredRef.current = true;
        }, 100);

        return () => clearTimeout(timer);
      }
    };

    checkVisibility();

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !animationTriggeredRef.current) {
          setIsVisible(true);
          setProgress(75);
          setIsMounted(true);
          animationTriggeredRef.current = true;
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [scrollY]);

  return (
    <div
      ref={containerRef}
      className="w-full grid grid-cols-2 gap-y-6 gap-x-3 sm:gap-y-8 sm:gap-x-4 justify-items-center"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: `translateY(${isVisible ? 0 : "50px"})`,
        transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
      }}
    >
      <CircularProgress
        color="#624E88"
        id="daily-visitors"
        label={"오늘 방문자 수"}
        mounted={isMounted}
        progress={progress}
        size={window.innerWidth < 640 ? 130 : 200}
        strokeWidth={window.innerWidth < 640 ? 10 : 15}
        trackColor="#d9d9d9"
        type={"명"}
        visitors={todayCount}
      />
      <CircularProgress
        color="#C96868"
        id="total-visitors"
        label={"총 방문자 수"}
        mounted={isMounted}
        progress={progress}
        size={window.innerWidth < 640 ? 130 : 200}
        strokeWidth={window.innerWidth < 640 ? 10 : 15}
        trackColor="#d9d9d9"
        type={"명"}
        visitors={totalCount}
      />
      <CircularProgress
        color="#FF885B"
        id="operating-days"
        label={"운영 중"}
        mounted={isMounted}
        progress={progress}
        size={window.innerWidth < 640 ? 130 : 200}
        strokeWidth={window.innerWidth < 640 ? 10 : 15}
        trackColor="#d9d9d9"
        type={"일째"}
        visitors={operatingDays}
      />
      <CircularProgress
        color="#7695FF"
        id="total-users"
        label={"총 가입자 수"}
        mounted={isMounted}
        progress={progress}
        size={window.innerWidth < 640 ? 130 : 200}
        strokeWidth={window.innerWidth < 640 ? 10 : 15}
        trackColor="#d9d9d9"
        type={"명"}
        visitors={totalUserCount}
      />
    </div>
  );
};

export default VisitCalculateView;