// components/editor/utils/defaultCodeLanguage.ts
//
// 코드블록을 새로 만들 때 사용할 "기본 언어"를 모듈 전역으로 관리한다.
//
// 배경: @lexical/code의 registerCodeHighlighting()은 언어가 지정되지 않은
// (undefined) CodeNode를 만나면 하이라이팅을 위해 무조건 'javascript'를
// 기본 언어로 못박아버린다. 그래서 사용자가 언어를 직접 고르지 않고 Kotlin,
// Swift 등의 코드를 작성하면 전부 "JavaScript"로 표시되는 문제가 있었다.
//
// 해결: 코드블록 생성 시점($createCodeNode 호출 시점)에 항상 "언어가 있는
// 상태"로 만들어서 위 기본값 로직이 아예 실행되지 않게 한다. 노트 에디터는
// 노트의 메인 카테고리에 맞는 언어로 이 값을 갱신하고, 이 값과 무관한 화면
// (예: /editor 플레이그라운드 데모)은 'javascript' 그대로 사용한다.
let currentDefaultCodeLanguage = 'javascript';

export function setDefaultCodeLanguage(lang: string | null | undefined) {
  currentDefaultCodeLanguage = lang || 'javascript';
}

export function getDefaultCodeLanguage(): string {
  return currentDefaultCodeLanguage;
}
