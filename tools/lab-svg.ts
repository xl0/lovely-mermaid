/**
 * Render a /lab snapshot to PNG for inspection — the same picture the page
 * shows, so a pasted lab link reproduces the exact frame.
 *
 *   bun tools/lab-svg.ts <snapshot.json | lab-url> [--out x.png] [-w 1600]
 *                        [--sx 10] [--sy 20] [--gapx 4] [--gapy 2]
 *
 * A lab URL carries the JSON and the view; flags override the view. Prints
 * the PNG path; stats and warnings go to stderr. Requires inkscape.
 */
import { unpackHash } from '../demo/src/lib/hash.ts'
import { parseSnapshot } from '../demo/src/lib/lab/snapshot.ts'
import { DEFAULT_VIEW, snapshotSvg, type View } from '../demo/src/lib/lab/snapshot-svg.ts'

const args = process.argv.slice(2)
const opt = (name: string): string | null => {
  const i = args.indexOf(name)
  if (i === -1) return null
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const out = opt('--out')
const width = opt('-w') ?? '1600'
const flags: Partial<View> = {}
if (opt('--grid') === '0') flags.grid = false
for (const [flag, key] of [
  ['--sx', 'sx'],
  ['--sy', 'sy'],
  ['--gapx', 'gapX'],
  ['--gapy', 'gapY'],
] as const) {
  const v = opt(flag)
  if (v !== null) flags[key] = Number(v)
}
const input = args[0]
if (input === undefined) {
  console.error(
    'usage: lab-svg.ts <snapshot.json | lab-url> [--out x.png] [-w 1600] [--sx --sy --gapx --gapy]',
  )
  process.exit(1)
}

let text: string
let view: View = { ...DEFAULT_VIEW }
const m = input.includes('://') ? input.match(/\/lab\/([A-Za-z0-9_-]+)/) : null
if (m !== null) {
  const o = JSON.parse(await unpackHash(m[1])) as { text: string; view: Partial<View> }
  text = o.text
  view = { ...view, ...o.view }
} else {
  text = await Bun.file(input).text()
}
view = { ...view, ...flags }

const { svg, stats, warnings } = snapshotSvg(parseSnapshot(text), view)
console.error(
  Object.entries(stats)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · '),
)
for (const w of warnings) console.error(`warning: ${w}`)
const png = out ?? (m !== null ? 'lab.png' : `${input.replace(/\.[^.]*$/, '')}.png`)
const svgPath = png.replace(/\.png$/, '.svg')
await Bun.write(svgPath, svg)
const proc = Bun.spawn(['inkscape', svgPath, '-o', png, '-w', width, '-b', '#101014'], {
  stderr: 'ignore',
})
if ((await proc.exited) !== 0) {
  console.error('inkscape failed')
  process.exit(1)
}
console.log(png)
