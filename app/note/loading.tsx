export const dynamic = "force-dynamic";

// 글 목록/본문이 준비되는 동안 보이는 화면. 크롤러가 첫 제목을 "로딩중"으로 읽지 않도록 h1 대신 p 를 쓴다.
export default function Loading() {
  return (
    <div className="flex flex-col w-full h-screen items-center justify-center" role="status">
      <p className="text-black dark:text-white">불러오는 중...</p>
    </div>
  );
}
