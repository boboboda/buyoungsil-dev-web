import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 App → Project 마이그레이션 시작...\n');

  // 1. 기존 App 데이터 가져오기
  const apps = await prisma.app.findMany({
    include: { tags: true }
  });

  console.log(`📦 ${apps.length}개의 앱 발견\n`);

  if (apps.length === 0) {
    console.log('⚠️  마이그레이션할 앱이 없습니다.');
    return;
  }

  // 2. 각 앱을 프로젝트로 변환
  for (const app of apps) {
    try {
      // 태그 기반으로 타입 추론
      const type = inferTypeFromTags(app.tags);
      
      // Project 생성
      const project = await prisma.project.create({
        data: {
          name: app.name,
          title: app.title,
          description: app.description,
          coverImage: app.coverImage,
          appLink: app.appLink,
          databaseId: app.databaseId,
          status: 'released', // 기존 앱은 모두 출시된 상태
          progress: 100,
          type: type,
          tags: {
            create: app.tags.map(tag => ({
              name: tag.name,
              color: tag.color
            }))
          }
        },
        include: {
          tags: true
        }
      });
      
      console.log(`✅ ${app.title}`);
      console.log(`   → 타입: ${type}`);
      console.log(`   → 태그: ${project.tags.map(t => t.name).join(', ')}\n`);
    } catch (error) {
      console.error(`❌ ${app.title} 마이그레이션 실패:`, error);
    }
  }

  console.log('\n✅ 마이그레이션 완료!');
  console.log('\n📌 다음 단계:');
  console.log('   1. 프로젝트 데이터를 확인하세요: npx prisma studio');
  console.log('   2. 문제가 없다면 다음 단계로 진행하세요');
}

/**
 * 태그 기반으로 프로젝트 타입 추론
 */
function inferTypeFromTags(tags: any[]): 'mobile' | 'web' | 'backend' {
  const tagNames = tags.map(t => t.name.toLowerCase());
  
  // 모바일 관련 태그
  if (tagNames.some(t => 
    ['flutter', 'android', 'ios', 'react native', 'mobile', 'app'].includes(t)
  )) {
    return 'mobile';
  }
  
  // 웹 관련 태그
  if (tagNames.some(t => 
    ['web', 'nextjs', 'react', 'frontend', 'website', 'next.js'].includes(t)
  )) {
    return 'web';
  }
  
  // 기본값: 백엔드
  return 'backend';
}

main()
  .catch((error) => {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });