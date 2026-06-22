import { useEffect, useRef, useState } from 'react'

const SPEEDS = [0.5, 1, 2, 5]

export default function EpisodeReplay({ trajectory, onStepChange }) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const intervalRef = useRef(null)

  const maxStep = Math.max(0, trajectory.length - 1)

  useEffect(() => {
    onStepChange?.(step)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return
    intervalRef.current = setInterval(() => {
      setStep((s) => {
        if (s >= maxStep) {
          setPlaying(false)
          return s
        }
        return s + 1
      })
    }, 400 / speed)
    return () => clearInterval(intervalRef.current)
  }, [playing, speed, maxStep])

  useEffect(() => {
    setStep(0)
    setPlaying(false)
  }, [trajectory])

  if (trajectory.length === 0) {
    return <div style={styles.empty}>No replay available yet — train the agent first.</div>
  }

  return (
    <div style={styles.wrap}>
      <h4 style={styles.title}>Episode Replay</h4>
      <input
        type="range"
        min={0}
        max={maxStep}
        value={step}
        onChange={(e) => setStep(parseInt(e.target.value, 10))}
      />
      <div style={styles.controls}>
        <button style={styles.btn} onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸' : '▶'}
        </button>
        <span style={styles.stepLabel}>
          step {step} / {maxStep}
        </span>
        <div style={styles.speeds}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{ ...styles.speedBtn, ...(speed === s ? styles.speedActive : {}) }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
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
  empty: {
    fontSize: '12px',
    opacity: 0.6,
    padding: '10px',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '8px',
  },
  btn: {
    background: '#0a2a4a',
    border: '1px solid #1a4a6a',
    borderRadius: '6px',
    color: '#d7ecff',
    padding: '4px 10px',
  },
  stepLabel: {
    fontSize: '11px',
    fontFamily: 'monospace',
  },
  speeds: {
    display: 'flex',
    gap: '4px',
    marginLeft: 'auto',
  },
  speedBtn: {
    background: '#0a2a4a',
    border: '1px solid #1a4a6a',
    borderRadius: '4px',
    color: '#d7ecff',
    fontSize: '10px',
    padding: '3px 6px',
  },
  speedActive: {
    background: '#00ffaa22',
    border: '1px solid #00ffaa',
    color: '#00ffaa',
  },
}
