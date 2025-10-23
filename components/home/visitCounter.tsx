// utils/visitCounter.ts

// 날짜를 YYYY-MM-DD 형식으로 반환하는 함수
const getFormattedDate = (): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// 두 날짜 간의 일수를 계산하는 함수
const getDaysBetweenDates = (startDate: string, endDate: string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());

  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// 방문자 수와 총 방문자 수를 로컬 스토리지에 저장하고 증가시키는 함수
export const operateingCounts = (): { operatingDays: number } => {
  const today = getFormattedDate();

  const startDate = "2024-01-01"; // 운영 시작 날짜를 고정

  localStorage.setItem("startDate", startDate); // 운영 시작 날짜 저장

  const operatingDays = getDaysBetweenDates(startDate, today);

  return {
    operatingDays: operatingDays,
  };
};

// 운영 일수를 반환하는 함수
export const getOperatingDays = (): number => {
  const startDate = "2024-01-01"; // 운영 시작 날짜를 고정
  const today = getFormattedDate();

  return getDaysBetweenDates(startDate, today);
};
