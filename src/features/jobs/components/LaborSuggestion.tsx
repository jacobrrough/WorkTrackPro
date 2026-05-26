

interface LaborSuggestionProps {
  suggestion: number | null | undefined;
  onApply: () => void;
}

export function LaborSuggestion({ suggestion, onApply }: LaborSuggestionProps) {
  if (suggestion == null) return null;

  return (
    <button
      type="button"
      onClick={onApply}
      className="text-[10px] text-primary hover:underline"
    >
      Use {suggestion.toFixed(1)}h
    </button>
  );
}
