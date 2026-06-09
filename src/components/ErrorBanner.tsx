import { X } from "lucide-react";

interface Props {
  message: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-400 text-xs flex items-center gap-2 font-mono">
      <X className="w-3 h-3 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-red-300 flex-shrink-0"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
