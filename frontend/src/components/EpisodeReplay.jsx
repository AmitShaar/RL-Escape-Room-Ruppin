import { useEffect, useRef, useState } from 'react'

const SPEEDS = [0.5, 1, 2, 5]
const SUCCESS_THRESHOLD = 50
const OUTCOME_PAUSE_MS = 1500

function defaultCheckSuccess(trajectory) {
  const last = trajectory[trajectory.length - 1]
  return (last?.reward ?? 0) >= SUCCESS_THRESHOLD
}

export default function EpisodeReplay({
  trajectory,
  onStepChange,
  title = "Replay חיזקי's best run",
  checkSuccess = defaultCheckSuccess,
}) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [outcome, setOutcome] = useState(null)
  const intervalRef = useRef(null)
  const outcomeTimeoutRef = useRef(null)

  const maxStep = Math.max(0, trajectory.length - 1)

  useEffect(() => {
    onStepChange?.(step)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Playback: advance one step per tick. On reaching the end, flash the
  // outcome, pause, then loop back to the start and keep playing.
  //
  // This is done imperatively inside the tick (rather than as a second
  // effect keyed on `step`/`outcome`) because an effect keyed on `outcome`
  // re-runs — and cleans up — the instant `setOutcome` causes a re-render,
  // cancelling its own just-scheduled timeout before it can fire.
  useEffect(() => {
    if (!playing) return
    intervalRef.current = setInterval(() => {
      setStep((s) => {
        if (s < maxStep) return s + 1
        setPlaying(false)
        setOutcome(checkSuccess(trajectory) ? 'success' : 'fail')
        outcomeTimeoutRef.current = setTimeout(() => {
          setOutcome(null)
          setStep(0)
          setPlaying(true)
        }, OUTCOME_PAUSE_MS)
        return s
      })
    }, 400 / speed)
    return () => clearInterval(intervalRef.current)
  }, [playing, speed, maxStep, trajectory, checkSuccess])

  useEffect(() => {
    clearTimeout(outcomeTimeoutRef.current)
    setStep(0)
    setPlaying(false)
    setOutcome(null)
  }, [trajectory])

  if (trajectory.length === 0) {
    return <div style={styles.empty}>No replay available yet — train the agent first.</div>
  }

  return (
    <div style={styles.wrap}>
      <h4 style={styles.title}>{title}</h4>
      {outcome && (
        <div style={{ ...styles.outcome, ...(outcome === 'success' ? styles.outcomeSuccess : styles.outcomeFail) }}>
          {outcome === 'success' ? '🦴 חיזקי found the bone!' : '😢 חיזקי failed'}
        </div>
      )}
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
  outcome: {
    margin: '0 0 8px 0',
    padding: '8px 10px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    textAlign: 'center',
  },
  outcomeSuccess: {
    background: '#00ffaa22',
    border: '1px solid #00ffaa',
    color: '#00ffaa',
  },
  outcomeFail: {
    background: '#ff444422',
    border: '1px solid #ff4444',
    color: '#ff8888',
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
