// 페이지가 준비되는 동안 잠깐 보이는 화면.
// 이 내용은 서버 HTML 에도 남을 수 있어서, 크롤러가 페이지의 첫 제목을 "로딩중..."으로 읽지 않도록
// 제목 태그(h1)와 글자를 쓰지 않는다. (스크린리더용 안내만 aria-label 로 둔다)
export default function Loading() {
  return <div aria-label="불러오는 중" className="h-screen" role="status" />;
}
