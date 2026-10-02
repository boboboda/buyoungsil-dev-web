"use client";
// import { useUserStore } from '@/components/providers/user-store-provider';
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "react-toastify";

import { Post } from "@/types";
import SimpleModal from "@/components/modal/simpleModal";
import { usePostDetail } from "@/app/hooks/posts/usePostDtail";

export default function PostDetail({
  appName,
  postId,
  post,
  postType,
}: {
  appName: string;
  postId: string;
  post: Post;
  postType: string;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post?.title || "");
  const [editContent, setEditContent] = useState(post?.content || "");

  const { data: session } = useSession();

  // 작성자 정보는 서버가 세션에서 직접 읽는다. 여기서는 로그인/관리자 여부만 UI 용으로 사용.
  const isLoggedIn = !!session?.user?.email;
  const isAdmin = session?.user?.role === "admin";

  const requireLogin = () => {
    if (!isLoggedIn) {
      toast.info("로그인 후 이용할 수 있습니다.");

      return false;
    }

    return true;
  };

  const {
    post: currentPost,
    isLoading,
    error,

    //모달 관련
    isModalOpen,
    onModalOpenChange,
    modalConfig,
    showConfirmModal,
    hideModal,

    // 댓글 관련
    newComment,
    setNewComment,
    replyTo,
    setReplyTo,
    replyContent,
    setReplyContent,
    showReplies,
    editingComment,
    editingReply,
    editCommentContent,
    setEditCommentContent,
    editReplyContent,
    setEditReplyContent,

    // 액션들
    handleCommentSubmit,
    handleReplySubmit,
    handleCommentEdit,
    handleReplyEdit,
    handleEditPost,
    openPostDeleteModal,
    openCommentDeleteModal,
    openReplyDeleteModal,
    toggleReplies,
    startEditingComment,
    startEditingReply,
    cancelEditing,

    // 멘션관련
    mentionTarget,
    setMentionTarget,
    handleReplyToReply,
    removeMention,

    // 로딩 상태들
    isCreatingComment,
    isCreatingReply,
    isDeletingComment,
    isDeletingReply,
    isEditingCommentLoading,
    isEditingReplyLoading,
    isDeleting,
    isEditing: isEditingPost,
  } = usePostDetail(appName, postType, postId, post);

  // 서버에서 받은 초기값(post)이 아니라 갱신되는 캐시(currentPost)를 기준으로 그린다.
  const viewPost = currentPost ?? post;

  return (
    <>
      {/* 모달 */}
      {modalConfig && (
        <SimpleModal
          cancelText="취소"
          confirmColor={modalConfig.confirmColor}
          confirmText={modalConfig.confirmText}
          content={modalConfig.content}
          isOpen={isModalOpen}
          onConfirm={modalConfig.onConfirm}
          onOpenChange={onModalOpenChange}
        />
      )}
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {/* 뒤로가기 & 목록 버튼 */}
          <div className="mb-6">
            <button
              className="flex items-center space-x-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              onClick={() => {
                router.back();
              }}
            >
              <span>←</span>
              <span>목록으로</span>
            </button>
          </div>

          {/* 게시글 메인 */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 mb-6">
            {/* 헤더 */}
            <div className="border-b border-slate-100 dark:border-slate-800 p-6 sm:p-8">
              {isEditing ? (
                /* 수정 모드 - 제목 입력 */
                <div className="mb-6">
                  <input
                    className="w-full text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-slate-50 bg-transparent border-2 border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="제목을 입력하세요..."
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
              ) : (
                /* 읽기 모드 - 제목 */
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-slate-50 mb-6 leading-tight">
                  {viewPost.title}
                </h1>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center space-x-4 mb-3 sm:mb-0">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-lg">
                      {post.writer.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 text-lg">
                      {post.writer}
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      {post.created_at}
                    </div>
                  </div>
                </div>

                {/* 편집모드 칩 */}
                {isEditing && (
                  <div className="flex items-center space-x-2 px-3 py-1.5 bg-orange-100 dark:bg-orange-900 border border-orange-200 dark:border-orange-800 rounded-full">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    <span className="text-orange-700 dark:text-orange-300 text-sm font-medium">
                      편집모드
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 본문 */}
            <div className="p-6 sm:p-8">
              {isEditing ? (
                /* 수정 모드 - 내용 입력 */
                <textarea
                  className="w-full h-80 text-slate-700 dark:text-slate-300 bg-transparent border-2 border-slate-300 dark:border-slate-600 rounded-lg p-4 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="내용을 입력하세요..."
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              ) : (
                /* 읽기 모드 - 내용 */
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <div className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line text-base sm:text-lg">
                    {viewPost.content}
                  </div>
                </div>
              )}
            </div>

            {/* 액션 버튼 */}
            <div className="border-t border-slate-100 dark:border-slate-800 p-6 sm:p-8">
              {isEditing ? (
                /* 수정 모드 - 저장/취소 버튼 */
                <div className="flex justify-end space-x-3">
                  <button
                    className="px-5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
                    onClick={() => {
                      setIsEditing(false);
                      setEditTitle(viewPost.title);
                      setEditContent(viewPost.content);
                    }}
                  >
                    취소
                  </button>
                  <button
                    className="px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200"
                    disabled={isEditingPost}
                    onClick={() => {
                      if (!editTitle.trim() || !editContent.trim()) {
                        toast.warn("제목과 내용을 입력해주세요.");

                        return;
                      }
                      // 저장에 성공했을 때만 편집 모드를 닫는다.
                      handleEditPost(editTitle, editContent, () =>
                        setIsEditing(false),
                      );
                    }}
                  >
                    {isEditingPost ? "저장중..." : "저장"}
                  </button>
                </div>
              ) : (
                /* 읽기 모드 - 기본 버튼들 */
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                  <div className="flex space-x-3">
                    <button className="flex items-center space-x-2 px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 text-sm font-medium">
                      <span>💬</span>
                      <span>댓글 {viewPost.comments.length}</span>
                    </button>
                    <button className="flex items-center space-x-2 px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 text-sm font-medium">
                      <span>📤</span>
                      <span className="hidden sm:inline">공유</span>
                    </button>
                  </div>
                  <div className="flex space-x-3">
                    {viewPost.isMine && (
                      <button
                        className="px-5 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950 transition-all duration-200"
                        onClick={() => {
                          setEditTitle(viewPost.title);
                          setEditContent(viewPost.content);
                          setIsEditing(true);
                        }}
                      >
                        수정
                      </button>
                    )}
                    {(viewPost.isMine || isAdmin) && (
                      <button
                        className="px-5 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-50 dark:hover:bg-red-950 transition-all duration-200"
                        onClick={() => openPostDeleteModal(viewPost.id)}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 댓글 섹션 */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="p-6 sm:p-8">
              <h3 className="text-xl sm:text-2xl font-bold mb-8 flex items-center text-slate-900 dark:text-slate-50">
                <span>댓글</span>
                <span className="ml-3 px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm font-medium rounded-full">
                  {viewPost.comments.length}
                </span>
              </h3>

              {/* 댓글 작성 */}
              <div className="mb-10">
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                  <textarea
                    className="w-full p-4 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 resize-none h-28 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-all duration-200"
                    placeholder="따뜻한 댓글을 남겨보세요..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                  />
                  <div className="flex justify-end mt-4">
                    <button
                      className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
                      disabled={isCreatingComment}
                      onClick={() => {
                        if (requireLogin()) handleCommentSubmit();
                      }}
                    >
                      {isCreatingComment ? "작성중..." : "댓글 작성"}
                    </button>
                  </div>
                </div>
              </div>

              {/* 댓글 목록 */}
              <div className="space-y-8">
                {viewPost.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="border-b border-slate-100 dark:border-slate-800 pb-8 last:border-b-0 last:pb-0"
                  >
                    {/* 댓글 */}
                    <div className="flex space-x-4">
                      <div className="w-11 h-11 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white font-bold text-sm">
                          {comment.writer.charAt(0)}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3">
                          <div className="flex items-center space-x-3 mb-2 sm:mb-0">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 text-base">
                              {comment.writer}
                            </span>
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                              {comment.created_at}
                            </span>
                          </div>

                          {/* 댓글 액션 버튼 */}
                          <div className="flex items-center space-x-2">
                            {comment.isMine && (
                              <button
                                className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                onClick={() =>
                                  startEditingComment(
                                    comment.id,
                                    comment.content,
                                  )
                                }
                              >
                                수정
                              </button>
                            )}
                            {(comment.isMine || isAdmin) && (
                              <button
                                className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                                disabled={isDeletingComment}
                                onClick={() =>
                                  openCommentDeleteModal(comment.id)
                                }
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 댓글 내용 - 수정 모드 분기 */}
                        {editingComment === comment.id ? (
                          <div className="mb-4">
                            <textarea
                              className="w-full p-3 border-2 border-blue-200 dark:border-blue-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              value={editCommentContent}
                              onChange={(e) =>
                                setEditCommentContent(e.target.value)
                              }
                            />
                            <div className="flex justify-end space-x-2 mt-3">
                              <button
                                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                onClick={cancelEditing}
                              >
                                취소
                              </button>
                              <button
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs rounded-lg transition-colors disabled:cursor-not-allowed"
                                disabled={isEditingCommentLoading}
                                onClick={() => handleCommentEdit(comment.id)}
                              >
                                {isEditingCommentLoading
                                  ? "수정중..."
                                  : "수정완료"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-700 dark:text-slate-300 mb-4 text-base leading-relaxed">
                            {comment.content}
                          </p>
                        )}

                        <div className="flex items-center space-x-6 text-sm">
                          <button
                            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium transition-colors duration-200"
                            onClick={() => {
                              if (!requireLogin()) return;
                              setReplyTo(
                                replyTo === comment.id ? null : comment.id,
                              );
                            }}
                          >
                            답글
                          </button>
                          {comment.replys.length > 0 && (
                            <button
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors duration-200"
                              onClick={() => toggleReplies(comment.id)}
                            >
                              {showReplies[comment.id]
                                ? "답글 숨기기"
                                : `답글 ${comment.replys.length}개 보기`}
                            </button>
                          )}
                        </div>

                        {/* 답글 작성 폼 */}
                        {replyTo === comment.id && (
                          <div className="mt-6">
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 p-5 rounded-xl border border-blue-200 dark:border-blue-800">
                              {/* 🔥 멘션 대상 표시 (추가) */}
                              {mentionTarget && (
                                <div className="mb-3 flex items-center space-x-2">
                                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                                    @{mentionTarget}님에게 답글
                                  </span>
                                  <button
                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
                                    onClick={removeMention}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )}

                              <textarea
                                className="w-full p-4 border border-blue-200 dark:border-blue-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-all duration-200"
                                placeholder={
                                  mentionTarget
                                    ? `@${mentionTarget}님에게 답글을 작성해주세요...`
                                    : `${comment.writer}님에게 답글을 작성해주세요...`
                                }
                                value={replyContent}
                                onChange={(e) =>
                                  setReplyContent(e.target.value)
                                }
                              />
                              <div className="flex justify-end space-x-3 mt-4">
                                <button
                                  className="px-4 py-2 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-all duration-200"
                                  onClick={() => {
                                    setReplyTo(null);
                                    setReplyContent(""); // 🔥 추가
                                    setMentionTarget(null); // 🔥 추가
                                  }}
                                >
                                  취소
                                </button>
                                <button
                                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-all duration-200 disabled:cursor-not-allowed"
                                  disabled={isCreatingReply}
                                  onClick={() => handleReplySubmit(comment.id)}
                                >
                                  {isCreatingReply ? "작성중..." : "답글 작성"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 답글 목록 */}
                        {showReplies[comment.id] &&
                          comment.replys.length > 0 && (
                            <div className="mt-6 ml-6 space-y-6 border-l-2 border-slate-200 dark:border-slate-700 pl-6">
                              {comment.replys.map((reply) => (
                                <div key={reply.id} className="flex space-x-4">
                                  <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-white font-bold text-sm">
                                      {reply.writer.charAt(0)}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex items-center space-x-3">
                                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                                          {reply.writer}
                                        </span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                          {reply.created_at}
                                        </span>
                                      </div>

                                      {/* 답글 액션 버튼 */}
                                      <div className="flex items-center space-x-2">
                                        {reply.isMine && (
                                          <button
                                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                            onClick={() =>
                                              startEditingReply(
                                                reply.id,
                                                reply.content,
                                                reply.mentionTo,
                                              )
                                            }
                                          >
                                            수정
                                          </button>
                                        )}
                                        {(reply.isMine || isAdmin) && (
                                          <button
                                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                                            disabled={isDeletingReply}
                                            onClick={() =>
                                              openReplyDeleteModal(reply.id)
                                            }
                                          >
                                            삭제
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* 답글 내용 - 수정 모드 분기 */}
                                    {editingReply === reply.id ? (
                                      <div>
                                        <textarea
                                          className="w-full p-3 border-2 border-blue-200 dark:border-blue-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-none h-20 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                          value={editReplyContent}
                                          onChange={(e) =>
                                            setEditReplyContent(e.target.value)
                                          }
                                        />
                                        <div className="flex justify-end space-x-2 mt-2">
                                          <button
                                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                            onClick={cancelEditing}
                                          >
                                            취소
                                          </button>
                                          <button
                                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs rounded transition-colors disabled:cursor-not-allowed"
                                            disabled={isEditingReplyLoading}
                                            onClick={() =>
                                              handleReplyEdit(reply.id)
                                            }
                                          >
                                            {isEditingReplyLoading
                                              ? "수정중..."
                                              : "수정완료"}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div>
                                        {/* 멘션 표시와 답글 내용 */}
                                        <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed mb-2">
                                          {reply.mentionTo && (
                                            <span className="bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium mr-1">
                                              @{reply.mentionTo}
                                            </span>
                                          )}
                                          {reply.content}
                                        </p>

                                        {/* 이 답글에 답글 달기 버튼 */}
                                        <button
                                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium transition-colors"
                                          onClick={() => {
                                            if (!requireLogin()) return;
                                            handleReplyToReply(
                                              comment.id,
                                              reply.writer,
                                            );
                                          }}
                                        >
                                          {reply.writer}님에게 답글
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}