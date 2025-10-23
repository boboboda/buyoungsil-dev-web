// "use client";

// import { useState, useEffect } from "react";
// import {
//   ModalHeader,
//   ModalBody,
//   ModalFooter,
//   Button,
//   Input,
//   CircularProgress,
//   Textarea,
// } from "@heroui/react";

// import { toast } from 'react-toastify';
// import { EyeSlashFilledIcon, EyeFilledIcon } from "../../icons";
// import CommentSection from "./CommnetSection";

// import { CustomModalType, Post } from "@/types";

// import { User } from "next-auth";

// const PostCustomModal = ({
//   user,
//   appName,
//   focusedPost,
//   modalType,
//   postType,
//   onDeleteAuth,
//   onAddComment,
//   ondeleteComment,
//   onEditAuth,
//   onClose,
//   onEdit,
//   onDelete,
//   onAddReply,
//   onDeleteReply,
//   onEditReply,
//   onAdd,
//   onEditComment,
// }: {
//   user: User;
//   appName?: string;
//   focusedPost?: Post;
//   postType: string;
//   modalType: CustomModalType;
//   onDeleteAuth?: (post: Post) => void;
//   onEditAuth?: (post: Post) => void;
//   onClose: () => void;
//   onEdit?: (id: string, title: string, content: string) => void;
//   onDelete?: (id: string) => void;
//   onAddComment?: (values: {
//     postId: string;
//     writer: string;
//     content: string;
//     email: string;
//   }) => void;
//   onEditComment?: (values: {
//     postId: string;
//     commentId: string;
//     email: string;
//     content: string;
//   }) => void;
//   ondeleteComment?: (values: {
//     postId: string;
//     commentId: string;
//     commentEmail: string;
//   }) => void;
//   onAdd?: (values: { writer: string; title: string; content: string }) => void;
//   onAddReply?: (values: {
//     postId: string;
//     commentId: string;
//     writer: string;
//     content: string;
//     email: string;
//   }) => void;
//   onDeleteReply?: (values: {
//     postId: string;
//     commentId: string;
//     replyId: string;
//     replyEmail: string;
//   }) => void;
//   onEditReply?: (values: {
//     postId: string;
//     replyId: string;
//     email: string;
//     content: string;
//   }) => void;
// }) => {
//   const [localPostData, setLocalPostData] = useState(focusedPost);
//   const [isLoading, setIsLoading] = useState(false);

//   // 게시글 수정 관련 상태
//   const [editedPostTitleInput, setEditedPostTitleInput] = useState(
//     localPostData?.title ?? "",
//   );
//   const [editedPostContentInput, setEditedPostContentInput] = useState(
//     localPostData?.content ?? "",
//   );

//   // 게시글 추가 관련 상태
//   const [addedPostTitleInput, setAddedPostTitleInput] = useState("");
//   const [addedPostContentInput, setAddedPostContentInput] = useState("");

//   const postName = postType === "notice" ? "공지사항" : "문의";

//   // 포커스된 공지사항이 변경될 때 로컬 상태 업데이트
//   useEffect(() => {
//     setLocalPostData(focusedPost);
//   }, [focusedPost]);

//   // 댓글 관련 상태
//   const [hiddenComment, setHiddenComment] = useState(false);
//   const commentToggleOpen = () => setHiddenComment(!hiddenComment);

//   const notifySuccessEvent = (msg) => toast.success(msg);

//   // 모달 컨텐츠 - 상세보기
//   const DetailModal = () => (
//     <>
//       <ModalHeader className="flex flex-col gap-1">게시글 상세보기</ModalHeader>
//       <ModalBody>
//         <p>
//           <span className="font-bold">글쓴이 : </span>
//           {localPostData?.writer ?? ""}
//         </p>
//         <p className="font-bold text-[1rem]">
//           <span className="font-bold text-[1rem]">제목 : </span>
//           {localPostData?.title ?? ""}
//         </p>
//         <p>내용</p>
//         <Textarea
//           isReadOnly
//           className="w-full text-[1rem]"
//           defaultValue={localPostData?.content ?? ""}
//           placeholder="Enter your description"
//           variant="bordered"
//         />
//         <div className="flex py-1 space-x-4">
//           <span className="font-bold">작성일 : </span>
//           <p>{`${localPostData?.created_at ?? ""}`}</p>
//         </div>

//         {/* 댓글 섹션 */}
//         <CommentSection
//           commentToggleOpen={commentToggleOpen}
//           hiddenComment={hiddenComment}
//           isLoading={isLoading}
//           localPostData={localPostData}
//           notifySuccessEvent={notifySuccessEvent}
//           ondeleteComment={ondeleteComment}
//           setIsLoading={setIsLoading}
//           user={user}
//           onAddComment={onAddComment} 
//           onAddReply={onAddReply}
//           onDeleteReply={onDeleteReply}
//           onEditComment={onEditComment}
//           onEditReply={onEditReply}
//         />
//       </ModalBody>

//       <ModalFooter>
//         <Button color="default" onPress={onClose}>
//           닫기
//         </Button>
//       </ModalFooter>
//     </>
//   );

//   // 모달 컨텐츠 - 관리자 확인
//   const CheckAdminHandler = (modalType) => {
//     // 1. 관리자인 경우 - 모든 권한 허용
//     if (user?.role === "admin") {
//       switch (modalType) {
//         case "deleteAuth":
//           onDeleteAuth?.(localPostData);
//           break;
//         case "editAuth":
//           onEditAuth?.(localPostData);
//           break;
//         default:
//           break;
//       }

//       return null; // 모달을 표시하지 않음
//     }

//     // 2. 일반 사용자이고, 일반 게시판(post)이며, 자신이 작성한 게시글인 경우
//     if (
//       user?.role === "user" &&
//       postType === "post" &&
//       localPostData?.email === user?.email
//     ) {
//       switch (modalType) {
//         case "deleteAuth":
//           onDeleteAuth?.(localPostData);
//           break;
//         case "editAuth":
//           onEditAuth?.(localPostData);
//           break;
//         default:
//           break;
//       }

//       return null; // 모달을 표시하지 않음
//     }

//     // 3. 그 외의 경우 - 권한 없음 알림
//     let errorMessage = "";

//     if (postType === "notice") {
//       errorMessage = "공지사항은 관리자만 수정/삭제할 수 있습니다.";
//     } else if (postType === "post") {
//       errorMessage = "자신이 작성한 게시글만 수정/삭제할 수 있습니다.";
//     } else {
//       errorMessage = "이 작업을 수행할 권한이 없습니다.";
//     }

//     return (
//       <>
//         <ModalHeader className="flex flex-col gap-1">권한 오류</ModalHeader>
//         <ModalBody>
//           <div className="space-y-4 py-2 text-center">
//             <div className="text-danger text-xl">
//               <p>권한이 필요합니다</p>
//             </div>
//             <p className="text-sm text-gray-500 mt-2">{errorMessage}</p>
//           </div>
//         </ModalBody>
//         <ModalFooter>
//           <Button color="default" onPress={onClose}>
//             확인
//           </Button>
//         </ModalFooter>
//       </>
//     );
//   };

//   // 모달 컨텐츠 - 수정
//   const EditModal = () => (
//     <>
//       <ModalHeader className="flex flex-col gap-1">{postName} 수정</ModalHeader>
//       <ModalBody>
//         <p className="ps-1">
//           <span className="font-bold">글쓴이 : </span>
//           {localPostData?.writer}
//         </p>
//         <Input
//           isRequired
//           defaultValue={localPostData?.title}
//           label="제목"
//           placeholder="제목을 입력해주세요"
//           type="text"
//           value={editedPostTitleInput}
//           variant="bordered"
//           onValueChange={setEditedPostTitleInput}
//         />

//         <Textarea
//           className=""
//           label="내용"
//           placeholder="내용을 입력해주세요"
//           type="text"
//           value={editedPostContentInput}
//           variant="bordered"
//           onValueChange={setEditedPostContentInput}
//         />

//         <div className="flex py-1 space-x-4">
//           <span className="font-bold">작성일 : </span>
//           <p>{`${localPostData?.created_at}`}</p>
//         </div>
//       </ModalBody>
//       <ModalFooter>
//         <Button
//           color="warning"
//           variant="flat"
//           onPress={() => {
//             setIsLoading(true);
//             onEdit?.(
//               localPostData?.id ?? "",
//               editedPostTitleInput,
//               editedPostContentInput,
//             );
//           }}
//         >
//           {isLoading ? (
//             <CircularProgress
//               size="sm"
//               color="warning"
//               aria-label="Loading..."
//             />
//           ) : (
//             "수정"
//           )}
//         </Button>
//         <Button color="default" onPress={onClose}>
//           닫기
//         </Button>
//       </ModalFooter>
//     </>
//   );

//   // 모달 컨텐츠 - 삭제
//   const DeleteModal = () => (
//     <>
//       <ModalHeader className="flex flex-col gap-1">
//         {postName}을 삭제하시겠습니까?
//       </ModalHeader>
//       <ModalBody>
//         <p>
//           <span className="font-bold">글쓴이 : </span>
//           {localPostData?.writer}
//         </p>
//         <p className="font-bold text-[1rem]">
//           <span className="font-bold text-[1rem]">제목 : </span>
//           {localPostData?.title}
//         </p>
//         <Textarea
//           isReadOnly
//           className="max-w-xs text-[1rem]"
//           defaultValue={localPostData?.content}
//           label="내용"
//           labelPlacement="outside"
//           placeholder="Enter your description"
//           variant="bordered"
//         />
//         <div className="flex py-1 space-x-4">
//           <span className="font-bold">작성일 : </span>
//           <p>{`${localPostData?.created_at}`}</p>
//         </div>
//       </ModalBody>
//       <ModalFooter>
//         <Button
//           color="danger"
//           variant="flat"
//           onPress={() => {
//             setIsLoading(true);
//             onDelete?.(localPostData?.id ?? "");
//           }}
//         >
//           {isLoading ? (
//             <CircularProgress
//               aria-label="Loading..."
//             color="danger"
//             size="sm" /> : '삭제'}
//         </Button>
//         <Button color="default" onPress={onClose}>
//           닫기
//         </Button>
//       </ModalFooter>
//     </>
//   );

//   // 모달 컨텐츠 - 추가
//   const AddModal = ({ user }: { user: User }) => {
//     const writerName =
//       user?.role === "admin" ? "운영자" : (user?.name ?? "익명");

//     return (
//       <>
//         <ModalHeader className="flex flex-col gap-1">
//           {postName} 작성
//         </ModalHeader>
//         <ModalBody>
//           <Input
//             isRequired
//           className="pt-5 max-w-full"
//           label="제목"
//           placeholder="제목을 입력해주세요"
//           type="text"
//           value={addedPostTitleInput}
//           variant="bordered"
//           onValueChange={setAddedPostTitleInput}
//           />

//           <Textarea
//             label="내용"
//             type="text"
//             placeholder="내용을 입력해주세요"
//             className=""
//             variant="bordered"
//             value={addedPostContentInput}
//             onValueChange={setAddedPostContentInput}
//           />
//         </ModalBody>
//         <ModalFooter>
//           <Button
//             color="warning"
//             variant="flat"
//             onPress={() => {
//               setIsLoading(true);
//               onAdd?.({
//                 writer: writerName,
//                 title: addedPostTitleInput,
//                 content: addedPostContentInput,
//               });
//             }}
//           >
//             {isLoading ? (
//               <CircularProgress
//                 aria-label="Loading..."
//             color="warning"
//             size="sm" /> : '완료'}
//           </Button>

//           <Button color="default" onPress={onClose}>
//             닫기
//           </Button>
//         </ModalFooter>
//       </>
//     );
//   };

//   // 모달 타입에 따라 적절한 컨텐츠 반환
//   const getModal = ({ type, user }: { type: CustomModalType; user: User }) => {
//     switch (type) {
//       case "add":
//         return AddModal({ user });
//       case "detail":
//         return DetailModal();
//       case "delete":
//         return DeleteModal();
//       case "edit":
//         return EditModal();
//       case "deleteAuth":
//         return CheckAdminHandler(type);
//       case "editAuth":
//         return CheckAdminHandler(type);
//       case "passwordModal":
//         return CheckAdminHandler(type);
//       default:
//         break;
//     }
//   };

//   return (
//     <>
//       {getModal({
//         type: modalType,
//         user: user,
//       })}
//     </>
//   );
// };

// export default PostCustomModal;
