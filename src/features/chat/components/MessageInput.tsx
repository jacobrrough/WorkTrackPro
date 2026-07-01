import React, { useCallback, useRef, useState } from 'react';

interface MessageInputProps {
  onSendText: (text: string) => Promise<void>;
  onSendFile: (file: File) => Promise<void>;
  onTyping?: () => void;
  disabled?: boolean;
}

export function MessageInput({ onSendText, onSendFile, onTyping, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSendText(trimmed);
      setText('');
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
  }, [text, sending, onSendText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSending(true);
      try {
        await onSendFile(file);
      } finally {
        setSending(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [onSendFile]
  );

  return (
    <div className="border-t border-line bg-surface-dark p-3">
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-overlay/10 hover:text-white disabled:opacity-50"
          title="Attach file"
        >
          <span className="material-symbols-outlined text-xl">attach_file</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onTyping?.();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled || sending}
          rows={1}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-line bg-overlay/5 px-3 py-2 text-sm text-white placeholder-subtle focus:border-primary focus:outline-none disabled:opacity-50"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || sending || !text.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-on-accent transition-colors hover:bg-primary/90 disabled:opacity-50"
          title="Send"
        >
          <span className="material-symbols-outlined text-xl">
            {sending ? 'hourglass_empty' : 'send'}
          </span>
        </button>
      </div>
    </div>
  );
}
