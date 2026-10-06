-- 카테고리 카드/SEO 정보를 DB에서 관리하기 위한 컬럼 추가
ALTER TABLE "note_categories"
  ADD COLUMN "gradient" TEXT,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "metaTitle" TEXT,
  ADD COLUMN "metaDescription" TEXT,
  ADD COLUMN "metaKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 기존 9개 카테고리: 코드에 하드코딩돼 있던 색상/태그/SEO 값을 DB로 옮긴다
UPDATE "note_categories" SET "gradient" = 'purple-pink', "tags" = ARRAY['Kotlin','Android','Jetpack Compose','Mobile'], "metaTitle" = 'Kotlin + Compose', "metaDescription" = 'Jetpack Compose를 활용한 안드로이드 앱 개발 경험을 공유합니다.', "metaKeywords" = ARRAY['Kotlin','Jetpack Compose','Android','안드로이드'] WHERE "slug" = 'kotlin-compose';
UPDATE "note_categories" SET "gradient" = 'blue-cyan', "tags" = ARRAY['Swift','iOS','SwiftUI','Mobile'], "metaTitle" = 'Swift + SwiftUI', "metaDescription" = 'SwiftUI를 활용한 iOS 앱 개발 노하우를 정리했습니다.', "metaKeywords" = ARRAY['Swift','SwiftUI','iOS','iPhone'] WHERE "slug" = 'swift-swiftui';
UPDATE "note_categories" SET "gradient" = 'sky-indigo', "tags" = ARRAY['Flutter','Dart','Cross-platform','Mobile'], "metaTitle" = 'Flutter', "metaDescription" = 'Flutter로 크로스플랫폼 모바일 앱 개발 방법을 공유합니다.', "metaKeywords" = ARRAY['Flutter','Dart','모바일','앱개발'] WHERE "slug" = 'flutter';
UPDATE "note_categories" SET "gradient" = 'gray-dark', "tags" = ARRAY['Next.js','React','HeroUI','Web'], "metaTitle" = 'Next.js + HeroUI', "metaDescription" = 'Next.js와 HeroUI로 웹 애플리케이션 개발 경험을 정리했습니다.', "metaKeywords" = ARRAY['Next.js','HeroUI','React','TypeScript'] WHERE "slug" = 'nextjs-heroui';
UPDATE "note_categories" SET "gradient" = 'cyan-blue', "tags" = ARRAY['React','JavaScript','Frontend','Web'], "metaTitle" = 'React', "metaDescription" = 'React 컴포넌트 설계와 상태 관리 실전 경험을 공유합니다.', "metaKeywords" = ARRAY['React','JavaScript','프론트엔드','UI'] WHERE "slug" = 'react';
UPDATE "note_categories" SET "gradient" = 'red-pink', "tags" = ARRAY['NestJS','TypeScript','Node.js','Backend'], "metaTitle" = 'NestJS + TypeScript', "metaDescription" = 'NestJS와 TypeScript로 백엔드 개발 노하우를 정리했습니다.', "metaKeywords" = ARRAY['NestJS','TypeScript','Node.js','백엔드'] WHERE "slug" = 'nestjs-typescript';
UPDATE "note_categories" SET "gradient" = 'green-emerald', "tags" = ARRAY['Node.js','JavaScript','Backend','API'], "metaTitle" = 'Node.js', "metaDescription" = 'Node.js를 활용한 백엔드 개발 경험을 공유합니다.', "metaKeywords" = ARRAY['Node.js','JavaScript','백엔드','API'] WHERE "slug" = 'nodejs';
UPDATE "note_categories" SET "gradient" = 'yellow-orange', "tags" = ARRAY['Python','Crawling','Data','Automation'], "metaTitle" = 'Python 크롤링', "metaDescription" = 'Python을 활용한 웹 크롤링 및 데이터 수집 방법을 정리했습니다.', "metaKeywords" = ARRAY['Python','크롤링','데이터','자동화'] WHERE "slug" = 'python-crawling';
UPDATE "note_categories" SET "gradient" = 'indigo-purple', "tags" = ARRAY['Programming','Basics','Tutorial'], "metaTitle" = '개발 기초', "metaDescription" = '프로그래밍 입문과 기본 개념을 정리한 노트입니다.', "metaKeywords" = ARRAY['프로그래밍','기초','입문','개발'] WHERE "slug" = 'basics';
