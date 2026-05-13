import { useState } from 'react';
import CodeBlock from './CodeBlock';

export default function TaskDetails({ task }) {
  const [fullscreenImage, setFullscreenImage] = useState(null);

  let t = { ...task }

  // Robust parsing: If description contains JSON, merge it to get rich fields (images, requirements, etc.)
  if (t.description && typeof t.description === 'string' && (t.description.trim().startsWith('{') || t.description.trim().startsWith('['))) {
    try {
      const parsed = JSON.parse(t.description)
      if (parsed && typeof parsed === 'object') {
        // Merge parsed fields into t, but keep existing non-null fields
        t = { 
          ...t, 
          ...parsed,
          problem: t.problem || parsed.problem || (t.description.trim().startsWith('{') ? '' : t.description),
          description_images: t.description_images || parsed.description_images || parsed.images || []
        }
      }
    } catch (e) {
      console.warn('Task JSON parsing failed:', e)
    }
  }

  // Fallback for problem if still missing
  if (!t.problem && t.description && typeof t.description === 'string' && !t.description.trim().startsWith('{')) {
    t.problem = t.description
  }

  // Debug log to help identify missing fields
  console.log('[TaskDetails] Final Render Data:', { 
    taskId: t.id, 
    title: t.title,
    hasProblem: !!t.problem, 
    imageCount: t.description_images?.length || 0,
    imageUrls: t.description_images?.map(img => img.url || img.dataUrl)
  })

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-4">
      {/* SECTION 1: Problem */}
      <div className="bg-[#111827] p-5 rounded-xl shadow-lg border border-white/5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          📋 Problem Statement
        </h3>
        <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
          {t?.problem || t?.details || 'No problem statement provided.'}
        </p>

        {/* Description Images */}
        {t?.description_images && t.description_images.length > 0 && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
            {t.description_images.map((img, i) => (
              <div
                key={i}
                className="group relative aspect-video rounded-xl overflow-hidden border border-white/5 bg-black/20 shadow-xl transition-all hover:border-white/20 cursor-pointer"
                onClick={() => setFullscreenImage(img.url || img.dataUrl)}
              >
                <img
                  src={img.url || img.dataUrl}
                  alt={img.name || `Reference image ${i + 1}`}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    e.target.src = 'https://via.placeholder.com/400x225?text=Image+Load+Error';
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                  <span className="text-[10px] text-gray-300 font-medium truncate">{img.name || `Image ${i+1}`}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 2: Requirements */}
      <div className="bg-[#111827] p-5 rounded-xl shadow-lg border border-white/5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          ✅ Requirements
        </h3>
        <ul className="space-y-3 text-sm text-gray-400">
          {(t?.requirements?.length > 0 ? t.requirements : [
            'Clean, well-documented code',
            'Handle edge cases properly',
            'Optimize for performance'
          ]).map((req, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="leading-relaxed">{req}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* SECTION 3: Input */}
      <div className="bg-[#111827] p-5 rounded-xl shadow-lg border border-white/5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          📥 Input
        </h3>
        <CodeBlock code={t?.input || '{\n  "users": [1, 2, 3]\n}'} language="json" />
      </div>

      {/* SECTION 4: Output */}
      <div className="bg-[#111827] p-5 rounded-xl shadow-lg border border-white/5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          📤 Expected Output
        </h3>
        <CodeBlock code={t?.output || '{\n  "count": 3,\n  "status": "success"\n}'} language="json" />
      </div>

      {/* SECTION 5: Evaluation */}
      <div className="bg-[#111827] p-5 rounded-xl shadow-lg border border-white/5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          🧠 Evaluation Criteria
        </h3>
        <div className="space-y-4">
          {t?.evaluation ? Object.entries(t.evaluation).map(([key, val]) => (
            <div key={key}>
              <div className="flex justify-between text-xs font-bold text-gray-400 mb-1.5 capitalize">
                <span>{key === 'ui' ? 'UI/UX' : key}</span>
                <span className="text-blue-400">{val}%</span>
              </div>
              <div className="h-1.5 w-full bg-black rounded-full overflow-hidden shadow-inner">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${val}%` }} />
              </div>
            </div>
          )) : (
            <>
              {Object.entries({ logic: 30, code: 30, performance: 20, ui: 20 }).map(([key, val]) => (
                <div key={key}>
                  <div className="flex justify-between text-xs font-bold text-gray-400 mb-1.5 capitalize">
                    <span>{key === 'ui' ? 'UI/UX' : key}</span>
                    <span className="text-blue-400">{val}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-black rounded-full overflow-hidden shadow-inner">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${val}%` }} />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* SECTION 6: Submission Rules */}
      <div className="bg-[#111827] p-5 rounded-xl shadow-lg border border-white/5 mb-8">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          📦 Submission Rules
        </h3>
        <ul className="space-y-2 text-sm text-gray-400 list-disc list-inside">
          {t?.submission ? (
            <li className="leading-relaxed list-none whitespace-pre-wrap">{t.submission}</li>
          ) : (
            <>
              <li>Submit source code inside a ZIP file.</li>
              <li>Do not include node_modules or large binaries.</li>
              <li>Include a README with instructions.</li>
            </>
          )}
        </ul>
      </div>

      {/* FULLSCREEN IMAGE LIGHTBOX */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setFullscreenImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl font-bold z-10"
            onClick={() => setFullscreenImage(null)}
          >
            ✕
          </button>
          <img
            src={fullscreenImage}
            alt="Fullscreen view"
            className="max-w-full max-h-full rounded-lg shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
