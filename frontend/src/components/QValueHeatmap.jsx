import { useMemo, useState } from 'react'

const LOW = [10, 42, 74] // #0a2a4a
const HIGH = [255, 153, 0] // #ff9900

function lerpColor(t) {
  const r = Math.round(LOW[0] + (HIGH[0] - LOW[0]) * t)
  const g = Math.round(LOW[1] + (HIGH[1] - LOW[1]) * t)
  const b = Math.round(LOW[2] + (HIGH[2] - LOW[2]) * t)
  return `rgb(${r},${g},${b})`
}

function cellKind(r, c, special) {
  const key = `${r},${c}`
  if (special.start && special.start[0] === r && special.start[1] === c) return 'start'
  if (special.exit && special.exit[0] === r && special.exit[1] === c) return 'exit'
  if (special.walls?.has(key)) return 'wall'
  if (special.holes?.has(key)) return 'hole'
  if (special.traps?.has(key)) return 'trap'
  if (special.bonuses?.has(key)) return 'bonus'
  if (special.vents?.has(key)) return 'vent'
  return 'normal'
}

// Kept visually distinct from the orange-ish high end of the value
// gradient itself, so "this cell is a bonus/reward spot" never gets
// confused with "this cell just happens to have a high learned value".
const KIND_COLORS = {
  wall: '#2a4a2a',
  trap: '#4a0a0a',
  hole: '#150522',
  bonus: '#ff66ff',
  start: '#3388ff',
  exit: '#00ffaa',
}

const LEGEND_LABELS = {
  start: 'Start',
  exit: 'Exit (goal)',
  bonus: 'Reward (+)',
  trap: 'Danger (−)',
  hole: 'Black hole (−)',
  wall: 'Wall',
  vent: 'Slippery',
}

export default function QValueHeatmap({ table, special = {}, onCellClick, label = 'Value Heatmap' }) {
  const [hover, setHover] = useState(null)

  const { min, max } = useMemo(() => {
    let mn = Infinity
    let mx = -Infinity
    for (const row of table) {
      for (const v of row) {
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
    }
    if (!Number.isFinite(mn)) mn = 0
    if (!Number.isFinite(mx)) mx = 1
    return { min: mn, max: mx }
  }, [table])

  const specialSets = useMemo(
    () => ({
      ...special,
      walls: special.walls instanceof Set ? special.walls : new Set((special.walls || []).map((p) => `${p[0]},${p[1]}`)),
      traps: special.traps instanceof Set ? special.traps : new Set((special.traps || []).map((p) => `${p[0]},${p[1]}`)),
      holes: special.holes instanceof Set ? special.holes : new Set((special.holes || []).map((p) => `${p[0]},${p[1]}`)),
      bonuses: special.bonuses instanceof Set ? special.bonuses : new Set((special.bonuses || []).map((p) => `${p[0]},${p[1]}`)),
      vents: special.vents instanceof Set ? special.vents : new Set((special.vents || []).map((p) => `${p[0]},${p[1]}`)),
    }),
    [special]
  )

  const presentKinds = useMemo(() => {
    const kinds = new Set()
    if (special.start) kinds.add('start')
    if (special.exit) kinds.add('exit')
    if (specialSets.bonuses.size) kinds.add('bonus')
    if (specialSets.traps.size) kinds.add('trap')
    if (specialSets.holes.size) kinds.add('hole')
    if (specialSets.walls.size) kinds.add('wall')
    if (specialSets.vents.size) kinds.add('vent')
    return [...kinds]
  }, [special.start, special.exit, specialSets])

  return (
    <div style={styles.wrap}>
      <h4 style={styles.title}>{label}</h4>
      <div style={styles.grid}>
        {table.map((row, r) =>
          row.map((v, c) => {
            const kind = cellKind(r, c, specialSets)
            const t = max > min ? (v - min) / (max - min) : 0
            const bg = KIND_COLORS[kind] || lerpColor(t)
            return (
              <div
                key={`${r}-${c}`}
                style={{ ...styles.cell, background: bg }}
                onMouseEnter={() => setHover({ r, c, v, kind })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onCellClick?.(r, c)}
              />
            )
          })
        )}
      </div>
      {hover && (
        <div style={styles.tooltip}>
          ({hover.r}, {hover.c}) → {hover.v.toFixed(3)}
          {hover.kind !== 'normal' ? ` [${LEGEND_LABELS[hover.kind] ?? hover.kind}]` : ''}
        </div>
      )}
      {presentKinds.length > 0 && (
        <div style={styles.legend}>
          {presentKinds.map((kind) => (
            <span key={kind} style={styles.legendItem}>
              <span style={{ ...styles.legendSwatch, background: KIND_COLORS[kind] }} />
              {LEGEND_LABELS[kind]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '10px',
  },
  title: {
    margin: '0 0 8px 4px',
    fontSize: '12px',
    color: '#7fd9ff',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(10, 1fr)',
    gap: '2px',
    aspectRatio: '1 / 1',
  },
  cell: {
    width: '100%',
    aspectRatio: '1 / 1',
    borderRadius: '2px',
    cursor: 'pointer',
  },
  tooltip: {
    marginTop: '6px',
    fontSize: '11px',
    fontFamily: 'monospace',
    color: '#d7ecff',
  },
  legend: {
    marginTop: '8px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #103252',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    color: '#d7ecff',
  },
  legendSwatch: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    display: 'inline-block',
  },
}
