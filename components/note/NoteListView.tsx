// "use client";

// import { useState, useMemo } from "react";
// import Link from "next/link";
// import { Input, Chip } from "@heroui/react";
// import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

// interface Note {
//   noteId: number;
//   title: string | null;
//   mainCategory: string | null;
//   subCategory: any;
//   level: string;
//   createdAt: Date;
// }

// interface NoteListViewProps {
//   notes: Note[];
// }

// export default function NoteListView({ notes }: NoteListViewProps) {
//   const [searchQuery, setSearchQuery] = useState("");

//   // 서브카테고리별 그룹핑
//   const groupedNotes = useMemo(() => {
//     const groups: Record<string, Note[]> = {};

//     notes.forEach((note) => {
//       const subCategoryName = note.subCategory?.name || "기타";
//       if (!groups[subCategoryName]) {
//         groups[subCategoryName] = [];
//       }
//       groups[subCategoryName].push(note);
//     });

//     return groups;
//   }, [notes]);

//   // 검색 필터링
//   const filteredGroups = useMemo(() => {
//     if (!searchQuery.trim()) return groupedNotes;

//     const filtered: Record<string, Note[]> = {};
//     const lowerQuery = searchQuery.toLowerCase();

//     Object.entries(groupedNotes).forEach(([subCategory, noteList]) => {
//       const matchedNotes = noteList.filter(
//         (note) =>
//           note.title?.toLowerCase().includes(lowerQuery) ||
//           subCategory.toLowerCase().includes(lowerQuery)
//       );

//       if (matchedNotes.length > 0) {
//         filtered[subCategory] = matchedNotes;
//       }
//     });

//     return filtered;
//   }, [groupedNotes, searchQuery]);

//   const totalNotes = notes.length;
//   const filteredCount = Object.values(filteredGroups).reduce(
//     (sum, notes) => sum + notes.length,
//     0
//   );

//   return (
//     <div>
//       {/* 검색 바 */}
//       <div className="mb-8 flex items-center gap-4">
//         <Input
//           placeholder="노트 제목 또는 카테고리 검색..."
//           value={searchQuery}
//           onChange={(e) => setSearchQuery(e.target.value)}
//           startContent={<MagnifyingGlassIcon className="w-5 h-5 text-gray-400" />}
//           size="lg"
//           className="max-w-md"
//         />
//         <span className="text-sm text-gray-600 dark:text-gray-400">
//           {searchQuery ? `${filteredCount}개 / ` : ""}전체 {totalNotes}개
//         </span>
//       </div>

//       {/* 노트 목록 */}
//       {Object.keys(filteredGroups).length > 0 ? (
//         <div className="space-y-12">
//           {Object.entries(filteredGroups).map(([subCategory, noteList]) => (
//             <div key={subCategory}>
//               {/* 서브카테고리 헤더 */}
//               <div className="flex items-center gap-3 mb-6">
//                 <h2 className="text-2xl font-bold">{subCategory}</h2>
//                 <Chip size="sm" variant="flat">
//                   {noteList.length}개
//                 </Chip>
//               </div>

//               {/* 노트 카드 그리드 */}
//               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//                 {noteList.map((note) => (
//                   <Link
//                     key={note.noteId}
//                     href={`/note/detail/${note.noteId}`}
//                     className="group"
//                   >
//                     <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 h-full">
//                       {/* 레벨 뱃지 */}
//                       <div className="flex items-center justify-between mb-4">
//                         <Chip
//                           size="sm"
//                           color={
//                             note.level === "BEGINNER"
//                               ? "success"
//                               : note.level === "INTERMEDIATE"
//                                 ? "warning"
//                                 : "danger"
//                           }
//                           variant="flat"
//                         >
//                           {note.level === "BEGINNER"
//                             ? "🟢 초급"
//                             : note.level === "INTERMEDIATE"
//                               ? "🟡 중급"
//                               : "🔴 고급"}
//                         </Chip>
//                         <span className="text-xs text-gray-500">
//                           #{note.noteId}
//                         </span>
//                       </div>

//                       {/* 제목 */}
//                       <h3 className="text-lg font-bold mb-3 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
//                         {note.title || "제목 없음"}
//                       </h3>

//                       {/* 작성일 */}
//                       <p className="text-sm text-gray-500 dark:text-gray-400">
//                         {new Date(note.createdAt).toLocaleDateString("ko-KR", {
//                           year: "numeric",
//                           month: "long",
//                           day: "numeric",
//                         })}
//                       </p>
//                     </div>
//                   </Link>
//                 ))}
//               </div>
//             </div>
//           ))}
//         </div>
//       ) : (
//         <div className="text-center py-20">
//           <div className="text-4xl mb-4">🔍</div>
//           <p className="text-gray-600 dark:text-gray-400">
//             '{searchQuery}'에 대한 검색 결과가 없습니다.
//           </p>
//         </div>
//       )}
//     </div>
//   );
// }