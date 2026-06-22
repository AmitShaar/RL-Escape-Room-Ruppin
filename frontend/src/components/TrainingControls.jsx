export default function TrainingControls({ status, onStart, onPause, onResume, onReset }) {
  const isTraining = status === 'training'
  const isPaused = status === 'paused'

  return (
    <div style={styles.row}>
      {!isTraining && !isPaused && (
        <button style={styles.btnPrimary} onClick={onStart}>
          ▶ Train
        </button>
      )}
      {isTraining && (
        <button style={styles.btn} onClick={onPause}>
          ⏸ Pause
        </button>
      )}
      {isPaused && (
        <button style={styles.btnPrimary} onClick={onResume}>
          ▶ Resume
        </button>
      )}
      <button style={styles.btn} onClick={onReset}>
        ⟲ Reset
      </button>
      <span style={styles.status}>{status}</span>
    </div>
  )
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
  },
  btn: {
    background: '#0a2a4a',
    border: '1px solid #1a4a6a',
    borderRadius: '6px',
    color: '#d7ecff',
    padding: '8px 14px',
    fontSize: '13px',
  },
  btnPrimary: {
    background: '#00ffaa22',
    border: '1px solid #00ffaa',
    borderRadius: '6px',
    color: '#00ffaa',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 600,
  },
  status: {
    marginLeft: 'auto',
    fontSize: '11px',
    opacity: 0.7,
    textTransform: 'uppercase',
  },
}
