import React, { useState, useRef, useEffect } from 'react';
import { aiChatService, type AIChatMessage } from '@/services/api/aiChat';

interface AIAssistantPanelProps {
  onClose: () => void;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setError(null);
    const userMsg: DisplayMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    const apiMessages: AIChatMessage[] = updatedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const result = await aiChatService.sendMessage(apiMessages);

    if (result.ok && result.reply) {
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply! }]);
    } else {
      setError(result.error || 'Failed to get a response');
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex h-[min(85dvh,700px)] w-full max-w-lg flex-col rounded-sm border border-white/10 bg-[#1a1122] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary" aria-hidden="true">
              smart_toy
            </span>
            <h2 className="text-sm font-bold text-white">AI Assistant</h2>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close AI Assistant"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !isLoading && (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-sm text-white/40">
                Ask me anything about your workflow, jobs, or inventory.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-sm px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary/30 text-white'
                    : 'border border-white/10 bg-white/5 text-white/90'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="mb-3 flex justify-start">
              <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60">
                <span className="material-symbols-outlined animate-spin text-[16px]">
                  progress_activity
                </span>
                Thinking...
              </div>
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 resize-none rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 outline-none transition-colors focus:border-primary/50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex size-9 items-center justify-center rounded-sm bg-primary text-white transition-opacity disabled:opacity-40"
              aria-label="Send message"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPanel;
