import React from "react";

export interface ChatMessage {
  sender: string;
  text: string;
  ts: number;
}

interface ChatOverlayProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({ messages, onSend }) => {
  const [input, setInput] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const now = Date.now();
  const recent = messages.filter(m => now - m.ts < 30000).slice(-5);

  const submit = () => {
    const text = input.trim();
    if (text) {
      onSend(text);
      setInput("");
    }
    setOpen(false);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyT" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="absolute left-3 top-14 z-50 w-72 flex flex-col gap-1 pointer-events-none">
      <div className="flex flex-col gap-0.5">
        {recent.map((m, i) => (
          <div key={i} className="text-[9px] font-mono bg-black/45 rounded px-1.5 py-0.5 leading-snug">
            <span className="text-amber-400 font-black">{m.sender}</span>
            <span className="text-slate-200 ml-1">{m.text}</span>
          </div>
        ))}
      </div>
      {open && (
        <div className="pointer-events-auto flex items-center gap-1 bg-black/70 border border-slate-700 rounded px-2 py-1 mt-0.5">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setOpen(false);
                setInput("");
              }
            }}
            maxLength={120}
            placeholder="Press Enter to send..."
            className="flex-1 bg-transparent text-[9px] text-white outline-none font-mono placeholder-slate-500"
          />
          <span className="text-[7px] text-slate-500 font-mono">ESC</span>
        </div>
      )}
      {!open && recent.length === 0 && (
        <div className="text-[6.5px] text-slate-600 font-mono">[T] CHAT</div>
      )}
    </div>
  );
};
