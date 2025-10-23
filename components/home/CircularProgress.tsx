import React, { useEffect, useState } from "react";

import CountUpComponent from "./countUpComponent";
import "@/styles/svg.css";

interface CircularProgressProps {
  size: number;
  progress: number;
  strokeWidth: number;
  color: string;
  trackColor: string;
  visitors: number;
  label: string;
  type: string;
  mounted: boolean;
  id: string;
}

const CircularProgress: React.FC<CircularProgressProps> = ({
  size,
  progress,
  strokeWidth,
  color,
  trackColor,
  visitors,
  label,
  type,
  mounted,
  id,
}) => {
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 0,
  );

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    setWindowWidth(window.innerWidth);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedProgress(progress);
    }, 1000);

    return () => clearTimeout(timer);
  }, [progress]);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (animatedProgress / 100) * circumference;

  // 🔥 반응형 텍스트 크기
  const textSizeClass = windowWidth < 640 ? "text-lg" : "text-3xl";
  const labelSizeClass = windowWidth < 640 ? "text-xs" : "text-sm";
  const typeSizeClass = windowWidth < 640 ? "text-xs" : "text-sm";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        className="circular-progress-svg"
        height={size}
        id={id}
        width={size}
      >
        {/* 배경 트랙 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="transparent"
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* 진행 상태 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="transparent"
          r={radius}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          style={{
            transition: "stroke-dashoffset 1s ease-in-out",
            transform: "rotate(-90deg)",
            transformOrigin: "50% 50%",
          }}
        />
      </svg>
      
      {/* 중앙 텍스트 */}
      <div className="absolute flex flex-col items-center justify-center">
        <p className={`${labelSizeClass} font-medium text-gray-600 dark:text-gray-300 mb-1 text-center px-2`}>
          {label}
        </p>
        <p className={`${textSizeClass} font-bold flex items-baseline gap-1`}>
          {mounted ? (
            <CountUpComponent end={visitors} separator="," />
          ) : (
            <span>0</span>
          )}
          <span className={`${typeSizeClass} font-normal text-gray-500`}>
            {type}
          </span>
        </p>
      </div>
    </div>
  );
};

export default CircularProgress;