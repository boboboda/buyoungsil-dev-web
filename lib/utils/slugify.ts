// lib/utils/slugify.ts
// ID 기반 slug 생성 (가장 안전하고 추천하는 방법)

/**
 * 한글을 로마자로 변환하는 함수
 */
function koreanToRoman(text: string): string {
  const koreanMap: Record<string, string> = {
    // 자음
    'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt',
    'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅃ': 'pp', 'ㅅ': 's',
    'ㅆ': 'ss', 'ㅇ': '', 'ㅈ': 'j', 'ㅉ': 'jj', 'ㅊ': 'ch',
    'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h',
    // 모음
    'ㅏ': 'a', 'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo',
    'ㅔ': 'e', 'ㅕ': 'yeo', 'ㅖ': 'ye', 'ㅗ': 'o', 'ㅘ': 'wa',
    'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅛ': 'yo', 'ㅜ': 'u', 'ㅝ': 'wo',
    'ㅞ': 'we', 'ㅟ': 'wi', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅢ': 'ui',
    'ㅣ': 'i',
  };

  function decomposeHangul(char: string): string {
    const code = char.charCodeAt(0);
    
    // 한글 음절 범위가 아니면 그대로 반환
    if (code < 0xAC00 || code > 0xD7A3) {
      return char;
    }
    
    const baseCode = code - 0xAC00;
    const initialIndex = Math.floor(baseCode / 588);
    const medialIndex = Math.floor((baseCode % 588) / 28);
    const finalIndex = baseCode % 28;
    
    const initials = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    const medials = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
    const finals = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    
    const result = 
      (koreanMap[initials[initialIndex]] || initials[initialIndex]) +
      (koreanMap[medials[medialIndex]] || medials[medialIndex]) +
      (finalIndex > 0 ? (koreanMap[finals[finalIndex]] || finals[finalIndex]) : '');
    
    return result;
  }

  return text
    .split('')
    .map(char => decomposeHangul(char))
    .join('')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * ID 기반 slug 생성 (메인 함수)
 * @param title - 제목
 * @param id - DB ID (숫자 또는 문자열)
 * @returns slug
 * 
 * @example
 * generateSlug("프론트엔드 개발", "123")
 * → "123-peuronteuendeu-gaebal"
 * 
 * generateSlug("Next.js 시작하기", "cly8x9z0d")
 * → "cly8x9z0d-nextjs-sijakhagi"
 */
export function generateSlug(title: string, id?: string | number): string {
  const romanized = koreanToRoman(title);
  
  // ID가 있으면 ID 기반 slug
  if (id) {
    if (romanized.length > 0) {
      // ID + 변환된 제목
      return `${id}-${romanized}`;
    } else {
      // 변환 실패 시 ID만
      return String(id);
    }
  }
  
  // ID가 없으면 변환된 제목만 (임시 slug)
  return romanized || `temp-${Date.now()}`;
}

/**
 * 제목만으로 임시 slug 생성 (폼에서 미리보기용)
 * @param title - 제목
 * @returns 임시 slug
 * 
 * @example
 * generateTempSlug("프론트엔드 개발")
 * → "peuronteuendeu-gaebal"
 */
export function generateTempSlug(title: string): string {
  const romanized = koreanToRoman(title);
  return romanized || 'untitled';
}

/**
 * 기존 slug가 유효한지 검사
 * @param slug - 검사할 slug
 * @returns 유효 여부
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}