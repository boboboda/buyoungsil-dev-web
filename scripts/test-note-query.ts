// scripts/test-note-query.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 노트 조회 테스트\n');

  // 1. 전체 노트 확인
  const allNotes = await prisma.developNote.findMany({
    select: {
      noteId: true,
      title: true,
      mainCategory: true,
      isPublished: true
    }
  });

  console.log('📊 전체 노트:');
  console.table(allNotes);

  // 2. basics 카테고리 노트 확인 (공개 여부 무관)
  const basicsNotes = await prisma.developNote.findMany({
    where: {
      mainCategory: 'basics'
    },
    select: {
      noteId: true,
      title: true,
      mainCategory: true,
      isPublished: true
    }
  });

  console.log('\n📊 basics 카테고리 노트:');
  console.table(basicsNotes);

  // 3. basics + 공개 노트
  const publishedBasicsNotes = await prisma.developNote.findMany({
    where: {
      mainCategory: 'basics',
      isPublished: true
    },
    select: {
      noteId: true,
      title: true,
      mainCategory: true,
      isPublished: true
    }
  });

  console.log('\n📊 basics 카테고리 공개 노트:');
  console.table(publishedBasicsNotes);

  // 4. count 테스트
  const count = await prisma.developNote.count({
    where: {
      mainCategory: 'basics',
      isPublished: true
    }
  });

  console.log('\n📝 basics 공개 노트 개수:', count);
}

main()
  .catch((error) => {
    console.error('❌ 오류:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });