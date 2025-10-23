// app/note/[slug]/page.tsx

export const dynamic = 'force-dynamic'

import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";
import { Note } from "@/store/editorSotre";
import NoteItemView from "@/components/developmentNote/userNote/noteItemView";
import { NoteStoreProvider } from "@/components/providers/editor-provider";
import { Metadata } from "next";

// 카테고리별 메타데이터 정의
function getCategoryMetadata(slug: string) {
    const categoryMap: Record<string, { title: string; description: string; keywords: string[] }> = {
        'nestjs': {
            title: 'NestJS 프레임워크',
            description: 'NestJS 프레임워크 개발 경험과 실전 노하우를 공유합니다.',
            keywords: ['NestJS', 'TypeScript', 'Node.js', '백엔드', 'API']
        },
        'react': {
            title: 'React 개발',
            description: 'React 컴포넌트 설계와 상태 관리 실전 경험을 정리했습니다.',
            keywords: ['React', 'JavaScript', '프론트엔드', 'UI', '컴포넌트']
        },
        'flutter': {
            title: 'Flutter 앱 개발',
            description: 'Flutter로 크로스플랫폼 모바일 앱 개발 방법을 공유합니다.',
            keywords: ['Flutter', 'Dart', '모바일', '앱개발']
        },
        'default': {
            title: '개발노트',
            description: '다양한 개발 기술과 경험을 정리한 개발노트입니다.',
            keywords: ['개발', '프로그래밍', '웹개발', '앱개발']
        }
    };

    return categoryMap[slug] || categoryMap['default'];
}

// ✅ 수정된 generateMetadata - params가 Promise로 변경
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params; // ✅ await 추가!
    
    try {
        const noteRes = await allFetchEdtiorServer();
        const notes: Note[] = JSON.parse(noteRes);
        const filterNotes = notes.filter((note) => note.mainCategory === slug); // ✅ slug 사용

        const categoryMeta = getCategoryMetadata(slug); // ✅ slug 사용

        if (!filterNotes || filterNotes.length === 0) {
            return {
                title: `${categoryMeta.title} - 코딩천재 부영실`,
                description: `${categoryMeta.title} 관련 개발노트를 준비 중입니다.`,
            };
        }

        const noteCount = filterNotes.length;
        const noteTitles = filterNotes.slice(0, 3).map(note => note.title).filter((title): title is string => title != null && title !== undefined);
        const description = `${categoryMeta.description} ${noteCount}개의 노트: ${noteTitles.join(', ')}`;

        const categoryKeywords: string[] = categoryMeta.keywords.filter(Boolean);

        return {
            title: `${categoryMeta.title} (${noteCount}개 노트)`,
            description: description,
            keywords: [...categoryKeywords, ...noteTitles],
            openGraph: {
                title: `${categoryMeta.title} 개발노트`,
                description: description,
                url: `https://www.buyoungsilcoding.com/note/${slug}`, // ✅ slug 사용
                type: 'article',
            }
        };

    } catch (error) {
        console.error('메타데이터 생성 실패:', error);
        return {
            title: '개발노트 - 코딩천재 부영실',
            description: '개발 관련 노트와 경험을 공유합니다.',
        };
    }
}

const EmptyNoteMessage = () => (
    <div className="flex h-full w-full items-center justify-center min-h-[400px]">
        <div className="text-center">
            <h1 className="text-gray-500 text-3xl font-bold mb-2">
                아직 작성된 노트가 없습니다.
            </h1>
        </div>
    </div>
);

// ✅ 수정된 페이지 컴포넌트 - params가 Promise로 변경
export default async function NoteContentItemPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params; // ✅ await 추가!

    const noteRes = await allFetchEdtiorServer();
    const notes: Note[] = JSON.parse(noteRes);
    const filterNotes = notes.filter((note) => note.mainCategory === slug); // ✅ slug 사용

    if (!filterNotes || filterNotes.length === 0) {
        return <EmptyNoteMessage />;
    }

    const initialNote = filterNotes[0];

    return (
        <NoteStoreProvider>
            <div className="w-full">
                <NoteItemView fetchNotes={filterNotes} initialNote={initialNote} />
            </div>
        </NoteStoreProvider>
    );
}