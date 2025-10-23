"use client";

import { CountUp } from "countup.js";
import { useEffect } from "react";

interface CountUpProps {
  end: number;
  start?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  separator?: string;
}

const CountUpComponent: React.FC<CountUpProps> = ({
  end,
  start = 0,
  duration = 2,
  prefix = "",
  suffix = "",
  separator = ",",
}) => {
  useEffect(() => {
    // 고유한 ID 생성
    const uniqueId = `countup-${Math.random().toString(36).substr(2, 9)}`;
    const element = document.getElementById(uniqueId);

    if (element) {
      const countUp = new CountUp(uniqueId, end, {
        startVal: start,
        duration: duration,
        prefix: prefix,
        suffix: suffix,
        separator: separator,
      });

      if (!countUp.error) {
        countUp.start();
      } else {
        console.error("CountUp error:", countUp.error);
      }
    }
  }, [end, start, duration, prefix, suffix, separator]);

  // 고유한 ID를 미리 생성하여 일관성 유지
  const countId = `countup-${end}-${start}`;

  return (
    <span id={countId}>
      {start}
    </span>
  );
};

export default CountUpComponent;