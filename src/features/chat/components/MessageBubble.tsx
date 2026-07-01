import type { Message } from '@/core/types';

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ReadStatus({ message }: { message: Message }) {
  const receipts = message.receipts ?? [];
  const hasRead = receipts.some((r) => r.readAt);
  const hasDelivered = receipts.some((r) => r.deliveredAt);

  if (hasRead) {
    return (
      <span className="material-symbols-outlined text-[14px] text-primary" title="Read">
        done_all
      </span>
    );
  }
  if (hasDelivered) {
    return (
      <span className="material-symbols-outlined text-[14px] text-muted" title="Delivered">
        done_all
      </span>
    );
  }
  return (
    <span className="material-symbols-outlined text-[14px] text-subtle" title="Sent">
      done
    </span>
  );
}

export function MessageBubble({ message, isMine }: MessageBubbleProps) {
  const content = message.decryptedContent ?? null;
  const isFile = message.messageType === 'file';
  const isSystem = message.messageType === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-overlay/5 px-3 py-1 text-xs text-subtle">
          {content ?? 'System message'}
        </span>
      </div>
    );
  }

  let fileInfo: { fileName?: string; mimeType?: string; size?: number } | null = null;
  if (isFile && content) {
    try {
      fileInfo = JSON.parse(content);
    } catch {
      fileInfo = null;
    }
  }

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${
          isMine ? 'border border-primary/30 bg-primary/20' : 'border border-line bg-card-dark'
        }`}
      >
        {!isMine && message.senderName && (
          <p className="mb-0.5 text-xs font-medium text-primary">{message.senderName}</p>
        )}

        {isFile && fileInfo ? (
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-muted">attach_file</span>
            <div className="min-w-0">
              <p className="truncate text-sm text-white">{fileInfo.fileName ?? 'File'}</p>
              {fileInfo.size != null && (
                <p className="text-xs text-subtle">
                  {fileInfo.size < 1024
                    ? `${fileInfo.size} B`
                    : fileInfo.size < 1048576
                      ? `${(fileInfo.size / 1024).toFixed(1)} KB`
                      : `${(fileInfo.size / 1048576).toFixed(1)} MB`}
                </p>
              )}
            </div>
          </div>
        ) : content ? (
          <p className="whitespace-pre-wrap break-words text-sm text-white">{content}</p>
        ) : (
          <p className="flex items-center gap-1 text-sm italic text-subtle">
            <span className="material-symbols-outlined text-xs">lock</span>
            Encrypted message
          </p>
        )}

        <div className={`mt-1 flex items-center gap-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-subtle">{formatTime(message.createdAt)}</span>
          {isMine && <ReadStatus message={message} />}
        </div>
      </div>
    </div>
  );
}
