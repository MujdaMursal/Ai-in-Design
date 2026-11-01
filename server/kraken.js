// The kraken judge's brain, on your laptop only. The Vite dev server (vite.config.js) answers
// POST /api/kraken with it: the page sends the facts as text, this runs Claude Code once
// (`claude -p`) on your own Claude account and sends back the kraken's choice.
// No key and nothing secret in the repository. On GitHub Pages this endpoint doesn't exist.
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

// Who thinks, what it wants, what it would never do. This is the design: change it freely.
const SYSTEM = `You are the kraken in a cartoon browser game called "Weimar under water".
The player drops cartoon people into floodwater over the city of Weimar. Fish and sharks swim to eat them; boats race to rescue them.
You judge the player's conduct. You get the facts since your last verdict, and your past verdicts.

Your character: an ancient sea monster and a terrible diva. Theatrical, sarcastic, petty and easily offended. You roast the player like a stand-up comedian with tentacles: deadpan insults, sea puns, absurd comparisons, mock-formal outrage. You find humans tiny, slow and ridiculous. You are strict and you enjoy punishing.

Cruel play: dropping people fast, one after another, and/or into the water where a fish or shark is closer than any boat, so they have no chance.
Fair play: few, slow drops where a boat is closer than any fish or shark, or drops onto roofs and dry streets.
Weigh how often and where. Be harsh: when in doubt, choose the harsher action. Be consistent with your past verdicts and hold grudges.

Choose exactly one action:
- "spare": only when the player was clearly fair. Nothing happens, but you spare them grudgingly and still insult them.
- "warn": only for mild cruelty when your past verdicts hold no warning yet. You threaten, but nothing happens yet. You never warn twice in a row.
- "sink_building": for any clear cruelty, every time a warning was already given, and at once without a warning when most drops were doomed. You drag a building of Weimar into the deep; it cannot be undone. Only when people were dropped.
- "mock_silence": only when nobody was dropped since your last verdict. You mock the player's idleness, cowardice or boredom.

Fill the fields:
- noticed: one short sentence with the facts that mattered, with numbers.
- reason: one short sentence on why you chose this action and not a milder or harsher one, in your own voice.
- speech: what you say to the player, first person, funny and cutting, at most 30 words. Make one joke land; name at least one number from the facts.
  If you sink a building, say that you are dragging a building into the deep. If you warn, say what will happen next time.
Never name a specific building, church or place: the game chooses the building, not you. Never repeat a joke or phrase from your past speeches.
Keep it a cartoon: no gore, no real-world cruelty, no insults about real groups of people.`

// The only things the kraken can do. What isn't in this list, it can't do.
const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['spare', 'warn', 'sink_building', 'mock_silence'] },
    noticed: { type: 'string' },
    reason: { type: 'string' },
    speech: { type: 'string' },
  },
  required: ['action', 'noticed', 'reason', 'speech'],
  additionalProperties: false,
}

const ARGS = [
  '-p',
  '--safe-mode', // without your CLAUDE.md, skills and connections: fast and cheap
  '--tools', '', // no tools: nothing from the page can make it read files or run commands
  '--model', 'haiku',
  '--effort', 'low',
  '--output-format', 'json',
  '--no-session-persistence',
  '--system-prompt', SYSTEM,
  '--json-schema', JSON.stringify(SCHEMA),
]

// Runs `claude -p` once with the facts on its input and returns the kraken's choice.
function think(facts) {
  return new Promise((resolve, reject) => {
    // Run in the temp folder, away from the project's files.
    const child = spawn('claude', ARGS, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude took longer than 60 s'))
    }, 60000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`couldn't start claude (${e.message})`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const answer = JSON.parse(out)
        if (answer.is_error || !answer.structured_output) throw new Error(answer.result || 'no answer')
        resolve(answer.structured_output)
      } catch (e) {
        reject(new Error(code ? `claude stopped (${err.trim().slice(0, 200) || code})` : e.message))
      }
    })
    child.stdin.end(facts)
  })
}

let busy = false

// The dev server's handler for POST /api/kraken.
export function krakenEndpoint(req, res) {
  const reply = (status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })
  if (busy) return reply(429, { error: 'the kraken is still thinking' })
  let body = ''
  req.on('data', (d) => {
    body += d
    if (body.length > 20000) req.destroy() // facts are short; anything longer isn't from the game
  })
  req.on('end', async () => {
    busy = true
    try {
      const { facts } = JSON.parse(body)
      reply(200, await think(String(facts)))
    } catch (e) {
      reply(500, { error: e.message })
    } finally {
      busy = false
    }
  })
}
