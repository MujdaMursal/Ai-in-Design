import { useMemo } from 'react'
import { USE_COLOURS, USE_LABELS } from './City.jsx'

// The colour of each main use that occurs among `houses`.
export default function Legend({ houses }) {
  const uses = useMemo(() => {
    const present = new Set(houses.map((h) => h.use ?? 'none'))
    return Object.keys(USE_COLOURS).filter((u) => present.has(u))
  }, [houses])

  return (
    <aside className="legend">
      <h2>Main use</h2>
      <ul>
        {uses.map((u) => (
          <li key={u}>
            <span className="swatch" style={{ background: USE_COLOURS[u] }} />
            {USE_LABELS[u]}
          </li>
        ))}
      </ul>
    </aside>
  )
}
