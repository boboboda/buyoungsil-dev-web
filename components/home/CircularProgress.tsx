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
  // icon: React.ReactNode;
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

    // 초기값 설정
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

  // 반응형 텍스트 크기 조정
  const textSizeClass = windowWidth < 640 ? "text-xl" : "text-3xl";
  const labelSizeClass = windowWidth < 640 ? "text-xs" : "text-sm";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        className="circular-progress-svg"
        height={size}
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
        }}
        width={size}
      >
        <defs>
          <linearGradient
            id={`gradient-${id}`}
            x1="0%"
            x2="100%"
            y1="0%"
            y2="0%"
          >
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="#000000"
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />

        <circle
          cx={size / 2}
          cy={size / 2}
          fill="transparent"
          r={radius}
          stroke={`url(#gradient-${id})`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="butt"
          strokeWidth={strokeWidth}
          style={{
            transition:
              "stroke-dashoffset 0.75s ease-in-out, filter 0.75s ease",
            filter: "drop-shadow(0px 0px 4px rgba(255, 255, 255, 0.5))",
          }}
        />
      </svg>
      <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center">
        <div className="flex flex-col items-center justify-center gap-1">
          <div
            className={`flex flex-row gap-1 ${textSizeClass} font-bold text-gray-500`}
          >
            <CountUpComponent
              color={color}
              duration={3}
              end={visitors}
              id={id}
              mounted={mounted}
              start={0}
            />
            <span>{type}</span>
          </div>
          <span className={`${labelSizeClass} text-white`}>{label}</span>
        </div>
      </div>
    </div>
  );
};

export default CircularProgress;
