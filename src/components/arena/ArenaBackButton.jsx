import { useNavigate } from 'react-router-dom'

export default function ArenaBackButton({ to }) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm font-bold"
    >
      <span aria-hidden="true">←</span> Back
    </button>
  )
}

