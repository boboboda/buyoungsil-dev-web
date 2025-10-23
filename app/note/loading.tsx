// 'use client'

// import { useEffect } from 'react';
export const dynamic = "force-dynamic";

export default function Loading() {
  // useEffect(() => {
  //   console.log('Component mounted and visible');
  // }, []);

  console.log("노트 로딩");

  return (
    <div className="flex flex-col w-full h-screen items-center justify-center">
      <h1 className="text-black">노트 로딩중...</h1>
    </div>
  );
}
