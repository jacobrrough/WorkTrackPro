import type { Comment, User } from '@/core/types';

interface JobCommentsProps {
  comments: Comment[];
  currentUser: User;
  newComment: string;
  setNewComment: (value: string) => void;
  isSubmitting: boolean;
  onSubmitComment: () => void;
  editingCommentId: string | null;
  editingCommentText: string;
  setEditingCommentId: (id: string | null) => void;
  setEditingCommentText: (value: string) => void;
  onUpdateComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  formatCommentTime: (timestamp: string) => string;
}

export default function JobComments({
  comments,
  currentUser,
  newComment,
  setNewComment,
  isSubmitting,
  onSubmitComment,
  editingCommentId,
  editingCommentText,
  setEditingCommentId,
  setEditingCommentText,
  onUpdateComment,
  onDeleteComment,
  formatCommentTime,
}: JobCommentsProps) {
  return (
    <div className="p-3 pt-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        <span className="material-symbols-outlined text-lg text-primary">chat</span>
        Comments ({comments.length})
      </h3>

      <div className="mb-3 rounded-sm bg-[#261a32] p-3">
        <div className="flex gap-2">
          <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-bold text-white">
            {currentUser.initials}
          </div>
          <div className="flex-1">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              rows={2}
            />
            <div className="flex justify-end">
              <button
                onClick={onSubmitComment}
                disabled={!newComment.trim() || isSubmitting}
                className="rounded-sm bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {isSubmitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {comments.map((comment) => {
          const isOwnComment = comment.user === currentUser.id;
          const canEdit = isOwnComment || currentUser.isAdmin;
          const isEditingThis = editingCommentId === comment.id;

          const timestamp =
            (comment as Comment & { created?: string; timestamp?: string }).created ||
            (comment as Comment & { created?: string; timestamp?: string }).timestamp ||
            comment.createdAt;

          return (
            <div key={comment.id} className="rounded-sm bg-[#261a32] p-3">
              <div className="flex items-start gap-2">
                <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-sm bg-slate-600 text-xs font-bold text-white">
                  {comment.userInitials || 'U'}
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{comment.userName || 'User'}</p>
                      <p className="text-xs text-slate-500">{formatCommentTime(timestamp)}</p>
                    </div>
                    {canEdit && !isEditingThis && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setEditingCommentId(comment.id);
                            setEditingCommentText(comment.text);
                          }}
                          className="p-1 text-slate-400 hover:text-primary"
                          title="Edit comment"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                        <button
                          onClick={() => onDeleteComment(comment.id)}
                          className="p-1 text-slate-400 hover:text-red-500"
                          title="Delete comment"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingThis ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingCommentText}
                        onChange={(e) => setEditingCommentText(e.target.value)}
                        className="w-full resize-none rounded border border-primary/30 bg-[#1a1122] p-2 text-sm text-white outline-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingCommentText('');
                          }}
                          className="rounded px-3 py-1 text-xs font-bold text-slate-400 hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => onUpdateComment(comment.id)}
                          disabled={!editingCommentText.trim()}
                          className="rounded bg-primary px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-300">{comment.text}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {comments.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-500">No comments yet</p>
        )}
      </div>
    </div>
  );
}
