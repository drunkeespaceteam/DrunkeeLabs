import { useEffect, useRef } from 'react';

export default function TerminalLogs({ logs }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getColor = (line) => {
    const lower = line.toLowerCase();
    if (lower.includes('[err]') || lower.includes('error') || lower.includes('fail') || lower.includes('fatal')) return 'text-red-400';
    if (lower.includes('success') || lower.includes('ready') || lower.includes('healthy') || lower.includes('running')) return 'text-emerald-400';
    if (lower.includes('warn')) return 'text-amber-400';
    if (lower.includes('[err]')) return 'text-orange-400';
    if (lower.match(/\[\d{4}-\d{2}-\d{2}/)) return 'text-slate-300'; // ISO timestamp log line
    return 'text-slate-400';
  };

  // Deduplicate consecutive identical lines (can happen on socket reconnect)
  const dedupedLogs = logs.filter((line, i) => i === 0 || line !== logs[i - 1]);

  return (
    <div className="bg-black/90 p-4 rounded-xl h-full overflow-y-auto font-mono text-sm shadow-inner border border-white/5 custom-scrollbar">
      {dedupedLogs.length === 0 ? (
        <div className="text-slate-600 italic">Waiting for logs...</div>
      ) : (
        <div className="space-y-1.5 pb-4">
          {dedupedLogs.map((line, i) => (
            <div key={i} className={`${getColor(line)} leading-relaxed break-words`}>
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
