import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 플랫폼 필드 추가 중...\n');

  // 1. NoteCategory에 platform 추가
  const categories = [
    { slug: "kotlin-compose", platform: "mobile" },
    { slug: "swift-swiftui", platform: "mobile" },
    { slug: "flutter", platform: "mobile" },
    { slug: "nextjs-heroui", platform: "web" },
    { slug: "react", platform: "web" },
    { slug: "nestjs-typescript", platform: "backend" },
    { slug: "nodejs", platform: "backend" },
    { slug: "python-crawling", platform: "backend" },
    { slug: "basics", platform: null }
  ];

  for (const cat of categories) {
    await prisma.noteCategory.updateMany({
      where: { slug: cat.slug },
      data: { platform: cat.platform }
    });
    console.log(`✅ ${cat.slug} → platform: ${cat.platform || 'null'}`);
  }

  // 2. Project에 platform 추가 (기존 프로젝트가 있다면)
  const projects = await prisma.project.findMany({
    include: { tags: true }
  });

  for (const project of projects) {
    // 태그 기반으로 플랫폼 추정
    let platform = "mobile"; // 기본값

    const tagNames = project.tags.map(t => t.name.toLowerCase());
    
    if (tagNames.some(t => ['flutter', 'kotlin', 'swift', 'android', 'ios'].includes(t))) {
      platform = "mobile";
    } else if (tagNames.some(t => ['next.js', 'react', 'vue', 'web'].includes(t))) {
      platform = "web";
    } else if (tagNames.some(t => ['nestjs', 'node', 'python', 'api', 'backend'].includes(t))) {
      platform = "backend";
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { platform }
    });

    console.log(`✅ ${project.title} → platform: ${platform}`);
  }

  console.log('\n✅ 플랫폼 필드 추가 완료!');
}

main()
  .catch((error) => {
    console.error('❌ 오류:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });