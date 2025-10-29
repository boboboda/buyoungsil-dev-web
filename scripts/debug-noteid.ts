// scripts/debug-noteid.ts
// 현재 DB 상태와 noteId 생성 로직 테스트

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 noteId 중복 문제 디버깅\n');

  // 1. 모든 노트 조회
  const allNotes = await prisma.developNote.findMany({
    orderBy: { noteId: 'asc' },
    select: {
      noteId: true,
      title: true,
      isPublished: true
    }
  });

  console.log('📊 전체 노트 목록:');
  console.table(allNotes);
  console.log(`총 ${allNotes.length}개\n`);

  // 2. 마지막 노트 확인
  if (allNotes.length > 0) {
    const lastNote = allNotes[allNotes.length - 1];
    console.log('📌 마지막 노트:');
    console.log(`  - noteId: ${lastNote.noteId}`);
    console.log(`  - title: ${lastNote.title}`);
    console.log(`  - 다음 생성될 ID: ${lastNote.noteId + 1}\n`);
  }

  // 3. noteId 중복 체크
  const noteIds = allNotes.map(n => n.noteId);
  const uniqueIds = new Set(noteIds);
  
  if (noteIds.length !== uniqueIds.size) {
    console.log('🔥 중복된 noteId 발견!');
    const duplicates = noteIds.filter((id, index) => noteIds.indexOf(id) !== index);
    console.log('중복 ID:', duplicates);
  } else {
    console.log('✅ noteId 중복 없음\n');
  }

  // 4. noteId 연속성 체크
  console.log('🔢 noteId 연속성 체크:');
  for (let i = 0; i < allNotes.length - 1; i++) {
    const current = allNotes[i].noteId;
    const next = allNotes[i + 1].noteId;
    
    if (next - current !== 1) {
      console.log(`⚠️  건너뛴 ID 발견: ${current} → ${next}`);
    }
  }

  // 5. 다음 생성 시도 시뮬레이션
  console.log('\n🎯 다음 노트 생성 시뮬레이션:');
  
  if (allNotes.length > 0) {
    const lastData = allNotes[allNotes.length - 1];
    const nextId = (lastData.noteId ?? 0) + 1;
    
    console.log(`  마지막 noteId: ${lastData.noteId}`);
    console.log(`  계산된 다음 ID: ${nextId}`);
    
    // 이미 존재하는지 확인
    const exists = await prisma.developNote.findUnique({
      where: { noteId: nextId }
    });
    
    if (exists) {
      console.log(`  ❌ noteId ${nextId}는 이미 존재합니다!`);
      console.log(`     제목: ${exists.title}`);
    } else {
      console.log(`  ✅ noteId ${nextId}는 사용 가능합니다`);
    }
  } else {
    console.log('  첫 번째 노트 생성: noteId = 1');
  }
}

main()
  .catch((error) => {
    console.error('❌ 오류:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });