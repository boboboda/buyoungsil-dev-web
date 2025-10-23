import { useEffect, useRef } from "react";
import Typed from "typed.js";

// className을 props로 추가합니다.
const TypedComponent = ({
  text,
  start,
  className,
  showEndCursor,
}: {
  showEndCursor?: string;
  text: string;
  start: boolean;
  className?: string;
}) => {
  const el = useRef(null);

  useEffect(() => {
    if (start) {
      const typed = new Typed(el.current, {
        strings: [text],
        typeSpeed: 100,
        backSpeed: 50,
        loop: false,
        showCursor: true,
        onComplete: (self) => {
          self.cursor.style.display = `${showEndCursor}`; // 타이핑 완료 후 커서 숨기기
        },
      });

      return () => typed.destroy();
    }
  }, [start, text]);

  // className을 h1 태그에 적용합니다.
  return (
    <h1 className={className}>
      <span ref={el} />
    </h1>
  );
};

export default TypedComponent;
