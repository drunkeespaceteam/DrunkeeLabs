export default function Tabs({ tabs, activeTab, setActiveTab }) {
  return (
    <div className="flex flex-row gap-8 border-b border-white/5 px-6 pt-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`py-3 text-[11px] font-bold uppercase tracking-widest transition-all relative outline-none ${
            activeTab === tab.id
              ? 'text-sky-400'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {tab.label}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.5)] rounded-t-full" />
          )}
        </button>
      ))}
    </div>
  );
}
