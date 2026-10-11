-- 앱 공장 출시 카드: 사람이 정한 앱 이름(스토어·홈페이지에 보일 이름). 새 열만 추가한다(비어 있으면 예전처럼 자동).
ALTER TABLE "factory_apps" ADD COLUMN "appName" TEXT;
