// scripts/migrate-note-categories.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 카테고리 초기 데이터 생성 시작...\n');

  const categories = [
    // 📱 모바일 (언어 + UI)
    {
      slug: "kotlin-compose",
      name: "Kotlin + Compose",
      description: "Jetpack Compose를 활용한 안드로이드 앱 개발",
      icon: "🤖",
      order: 1,
      isPublished: false
    },
    {
      slug: "swift-swiftui",
      name: "Swift + SwiftUI",
      description: "SwiftUI를 활용한 iOS 앱 개발",
      icon: "🍎",
      order: 2,
      isPublished: false
    },
    {
      slug: "flutter",
      name: "Flutter",
      description: "Flutter로 크로스플랫폼 모바일 앱 개발",
      icon: "🦋",
      order: 3,
      isPublished: false
    },
    
    // 💻 웹 (프레임워크 + UI)
    {
      slug: "nextjs-heroui",
      name: "Next.js + HeroUI",
      description: "Next.js와 HeroUI로 웹 애플리케이션 개발",
      icon: "▲",
      order: 4,
      isPublished: false
    },
    {
      slug: "react",
      name: "React",
      description: "React를 활용한 프론트엔드 개발",
      icon: "⚛️",
      order: 5,
      isPublished: false
    },
    
    // ⚙️ 백엔드 (프레임워크 + 언어)
    {
      slug: "nestjs-typescript",
      name: "NestJS + TypeScript",
      description: "NestJS와 TypeScript로 백엔드 개발",
      icon: "🐈",
      order: 6,
      isPublished: false
    },
    {
      slug: "nodejs",
      name: "Node.js",
      description: "Node.js를 활용한 백엔드 개발",
      icon: "💚",
      order: 7,
      isPublished: false
    },
    
    // 🐍 기타
    {
      slug: "python-crawling",
      name: "Python 크롤링",
      description: "Python을 활용한 웹 크롤링 및 데이터 수집",
      icon: "🐍",
      order: 8,
      isPublished: false
    },
    
    // 📚 기초
    {
      slug: "basics",
      name: "개발 기초",
      description: "프로그래밍 입문과 기본 개념",
      icon: "📚",
      order: 9,
      isPublished: true  // 🔥 기초만 공개
    }
  ];

  for (const category of categories) {
    const existing = await prisma.noteCategory.findUnique({
      where: { slug: category.slug }
    });

    if (existing) {
      console.log(`⏭️  "${category.name}" 이미 존재 - 건너뜀`);
      continue;
    }

    await prisma.noteCategory.create({
      data: category
    });

    console.log(`✅ "${category.name}" 생성 완료 (${category.isPublished ? '공개' : '비공개'})`);
  }

  console.log('\n✅ 카테고리 초기 데이터 생성 완료!');
  console.log('\n📊 현재 상태:');
  console.log('   - 공개 카테고리: 1개 (개발 기초)');
  console.log('   - 비공개 카테고리: 8개');
}

main()
  .catch((error) => {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });