/**
 * Render a mermaid source file to PNG for visual inspection.
 *
 *   bun .claude/skills/render-png/render-png.ts <file.mmd> [--rule] [--out x.png] [-w 2000] [--opt k=v ...]
 *
 * Default renderer is ELK (layout-elk.ts); --rule uses the rule-based
 * layout via render(). --opt passes extra elk layoutOptions for A/B runs.
 * Prints the PNG path on success. Requires inkscape.
 */
import { defaultTheme, exportSvg } from '../../../demo/node_modules/lovely-ansi-svg/dist/index.js'
import { toAnsi } from '../../../packages/lovely-mermaid/src/ansi.ts'
import { render } from '../../../packages/lovely-mermaid/src/index.ts'
import { renderElk } from '../../../packages/lovely-mermaid/src/layout-elk.ts'

const args = process.argv.slice(2)
const flag = (name: string): boolean => {
  const i = args.indexOf(name)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}
const opt = (name: string): string | null => {
  const i = args.indexOf(name)
  if (i === -1) return null
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const rule = flag('--rule')
const out = opt('--out')
const width = opt('-w') ?? '2000'
const extra: Record<string, string> = {}
for (let v = opt('--opt'); v !== null; v = opt('--opt')) {
  const eq = v.indexOf('=')
  extra[v.slice(0, eq)] = v.slice(eq + 1)
}
const input = args[0]
if (input === undefined) {
  console.error('usage: render-png.ts <file.mmd> [--rule] [--out x.png] [-w 2000] [--opt k=v]')
  process.exit(1)
}

const src = await Bun.file(input).text()
const art = rule ? render(src) : await renderElk(src, extra)
if (art === null) {
  console.error(`renderer returned null (${rule ? 'rule' : 'elk'}) — unsupported or over caps`)
  process.exit(1)
}
if (art.warnings?.length) console.error('warnings:', art.warnings.join('; '))

// Concrete RGB colors: the default dim-SGR theme makes exportSvg emit
// color-mix(), which inkscape cannot rasterize (invisible strokes).
const ansi = toAnsi(art, {
  border: '38;2;110;118;129',
  edge: '38;2;57;197;207',
  edgeLabel: '38;2;145;152;161',
  title: '1',
}).join('\n')
const png = out ?? `${input.replace(/\.[^.]*$/, '')}.png`
const svg = png.replace(/\.png$/, '.svg')
await Bun.write(
  svg,
  exportSvg(ansi, {
    cellSize: 14,
    background: '#0d1117',
    // Inkscape resolves the default stack to Liberation Mono, which lacks
    // the arc corners (╭); DejaVu has the full box-drawing set.
    fontFamily: "'DejaVu Sans Mono', monospace",
    theme: { ...defaultTheme, foreground: '#e6edf3' },
  }),
)
const proc = Bun.spawn(['inkscape', svg, '-o', png, '-w', width], { stderr: 'ignore' })
if ((await proc.exited) !== 0) {
  console.error('inkscape failed')
  process.exit(1)
}
console.log(png)
process.exit(0) // the elk worker keeps bun alive otherwise
