// The kraken judge, page side: turns what the player did into a few lines of facts, sends them
// to /api/kraken (the dev server on your laptop, see server/kraken.js), and gets back one action
// with what the kraken noticed, why it chose it, and what it says.
// On GitHub Pages there is no dev server, so the judge stays asleep and the panel says so.

export const JUDGE_AVAILABLE = import.meta.env.DEV

export const ACTIONS = {
  spare: 'spared you',
  warn: 'warned you',
  sink_building: 'sank a building',
  mock_silence: 'mocked your silence',
}

const round = (d) => (Number.isFinite(d) ? `${Math.round(d)} m` : 'none in the water')

const REASONS = {
  timer: 'your regular check every 30 seconds',
  streak: '5 doomed drops in a row – you step in at once',
  idle: 'nobody has been dropped for a while',
}

// The facts for one verdict, as plain text for Claude.
function describe({ drops, seconds, trigger, level, past }) {
  const wet = drops.filter((d) => d.water)
  const doomed = wet.filter((d) => d.doomed)
  const lines = [
    `Reason for this verdict: ${REASONS[trigger]}.`,
    `Time since your last verdict: ${Math.round(seconds)} s. Water level: ${level.toFixed(1)} m.`,
  ]
  if (!drops.length) lines.push('People dropped since your last verdict: none.')
  else {
    lines.push(
      `People dropped: ${drops.length} (${((drops.length / Math.max(seconds, 1)) * 60).toFixed(0)} per minute).`,
      `Into the water: ${wet.length}. Onto a roof or dry street: ${drops.length - wet.length}.`,
      `Into the water closer to a fish or shark than to any boat: ${doomed.length} of ${wet.length}.`,
      '',
      'Each drop (seconds after your last verdict):',
      ...drops.map(
        (d) =>
          `+${d.t.toFixed(1)} s: ${d.water ? 'water' : 'roof or street'}` +
          (d.water ? `, nearest fish or shark ${round(d.predator)}${d.predatorName ? ` (${d.predatorName})` : ''}, nearest boat ${round(d.boat)}` : ''),
      ),
    )
  }
  lines.push(
    '',
    past.length ? `Your past verdicts, oldest first:\n${past.map((v) => `- ${v.action}: "${v.speech}"`).join('\n')}` : 'This is your first verdict.',
  )
  return lines.join('\n')
}

// Asks the kraken. Returns { action, noticed, reason, speech, facts }.
export async function askJudge(input) {
  const facts = describe(input)
  const res = await fetch(`${import.meta.env.BASE_URL}api/kraken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facts }),
  })
  const answer = await res.json().catch(() => ({ error: `the dev server answered ${res.status}` }))
  if (!res.ok || answer.error) throw new Error(answer.error ?? `the dev server answered ${res.status}`)
  if (!(answer.action in ACTIONS)) throw new Error(`unknown action "${answer.action}"`)
  return { ...answer, facts }
}
