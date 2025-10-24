"use client";

import { CountUp } from "countup.js";
import { useEffect, useRef } from "react";

interface CountUpProps {
  id: string;
  end: number;
  start?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  separator?: string;
  mounted?: boolean;
  color: string;
}

const CountUpComponent: React.FC<CountUpProps> = ({
  id,
  end,
  start = 0,
  duration = 2,
  prefix = "",
  suffix = "",
  separator = ",",
  color,
  mounted = false,
}) => {
  const countUpRef = useRef<CountUp | null>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    // mounted가 true이고 아직 애니메이션을 실행하지 않았을 때만 실행
    if (mounted && !hasAnimated.current && end !== undefined && end !== null) {
      const element = document.getElementById(id);
      
      if (element) {
        // 먼저 실제 값을 표시
        element.textContent = `${prefix}${end.toLocaleString()}${suffix}`;
        
        // 그 다음 애니메이션 실행
        const countUp = new CountUp(id, end, {
          startVal: start,
          duration: duration,
          prefix: prefix,
          suffix: suffix,
          separator: separator,
        });

        if (!countUp.error) {
          countUp.start();
          countUpRef.current = countUp;
          hasAnimated.current = true;
          console.log(`✅ CountUp started for ${id}:`, { start, end });
        } else {
          console.error(`❌ CountUp error for ${id}:`, countUp.error);
        }
      }
    }
  }, [id, mounted, end, start, duration, prefix, suffix, separator]);

  // end 값이 변경되었을 때 CountUp 업데이트
  useEffect(() => {
    if (countUpRef.current && hasAnimated.current && end !== undefined) {
      countUpRef.current.update(end);
      console.log(`🔄 CountUp updated for ${id}:`, end);
    }
  }, [end, id]);

  return (
    <span className="text-white" id={id} style={{ color }}>
      {end?.toLocaleString() || 0}
    </span>
  );
};

export default CountUpComponent;