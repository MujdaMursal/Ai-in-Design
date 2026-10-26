import { useEffect, useMemo, useState } from 'react'
import City, { REACH_COLOURS } from './City.jsx'
import Legend from './Legend.jsx'
import { ATTRIBUTION, loadKit } from './geo.js'
import { analyse, buildNetwork, findStart, BAND, MAX_START, MINUTES, SPEED } from './reach.js'

const number = (n) => n.toLocaleString('en-GB')

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [walk, setWalk] = useState(null) // { start, level, results } or { far }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadKit().then(setData).catch((e) => setError(e.message))
  }, [])

  const network = useMemo(() => data && buildNetwork(data.nodes, data.edges), [data])

  const pick = (x, y) => {
    const start = findStart(network, x, y)
    if (!start.ok) {
      setWalk({ far: Math.round(start.street) })
      return
    }
    setBusy(true)
    // Let the page show "Walking…" before the calculation holds up the browser.
    setTimeout(() => {
      const { level, results } = analyse(network, start.node, data.houses, data.cells)
      setWalk({ start: data.nodes[start.node], level, results })
      setBusy(false)
    }, 30)
  }

  if (error) return <p className="message error">The city kit didn't load ({error}).</p>
  if (!data) return <p className="message">Loading the city kit…</p>

  const results = walk?.results

  return (
    <div className="app">
      <City data={data} level={walk?.level} results={results} start={walk?.start} onPick={pick} busy={busy} />

      <aside className="panel">
        <h1>How far can you walk?</h1>
        <a className="switch" href={`${import.meta.env.BASE_URL}corridor.html`}>
          Map: Bauhaus-Universität to Hauptbahnhof →
        </a>
        <p className="hint">
          {busy
            ? 'Walking…'
            : walk?.far != null
              ? `No walkable street within ${MAX_START} m of this point (the nearest is ${walk.far} m away). Click closer to a street.`
              : results
                ? 'Click somewhere else to start again.'
                : 'Click on the ground to start a walk. Drag to orbit, right-drag to pan, scroll to zoom.'}
        </p>

        <table>
          <thead>
            <tr>
              <th>Walk</th>
              <th>Buildings</th>
              <th>Residents</th>
            </tr>
          </thead>
          <tbody>
            {MINUTES.map((m, k) => {
              const r = results?.[k]
              return (
                <tr key={m}>
                  <td>
                    <span className="swatch" style={{ background: REACH_COLOURS[k] }} />
                    {m} min
                  </td>
                  <td className="num">{r ? number(r.buildings) : '–'}</td>
                  <td className="num">
                    {r ? `about ${number(r.residents)}` : '–'}
                    {r?.withoutFigure > 0 && (
                      <span className="note">
                        {' '}
                        + {r.withoutFigure} {r.withoutFigure === 1 ? 'cell' : 'cells'} without a figure
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="method">
          <p>
            The walk starts at the street junction nearest to your click and follows the pedestrian network at{' '}
            {(SPEED * 60) / 1000} km/h, which is {SPEED} m per minute. Each area is the streets reached in that time,
            including the reachable part of the last street, widened by a band of {BAND} m on each side and joined
            into one shape. A building counts when its footprint touches the area.
          </p>
          <p>
            Residents come from the Zensus 2022 grid of 100 m squares. Each square that overlaps the area adds its
            residents times the share of its area that lies inside. The sum is rounded to the nearest 10. Squares
            with no published figure are not counted as zero: they are left out of the sum, and the number left out
            is shown next to it.
          </p>
        </div>
      </aside>

      <Legend houses={data.houses} />

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
