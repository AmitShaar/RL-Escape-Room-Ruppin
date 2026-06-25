export default function ReplayRewardOverlay({ step, totalSteps, stepReward, cumulativeReward }) {
  return (
    <div style={styles.wrap}>
      <div>Replay — step {step} / {totalSteps}</div>
      <div>
        Step reward: <span style={{ color: stepReward >= 0 ? '#00ffaa' : '#ff8888' }}>{stepReward.toFixed(2)}</span>
      </div>
      <div>
        Cumulative reward: <strong>{cumulativeReward.toFixed(2)}</strong>
      </div>
    </div>
  )
}

const styles = {
  wrap: {
    position: 'absolute',
    top: '10px',
    left: '10px',
    background: 'rgba(4,22,44,0.8)',
    border: '1px solid #1a4a6a',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '12px',
    color: '#7fd9ff',
    fontFamily: 'monospace',
    lineHeight: 1.6,
    pointerEvents: 'none',
    zIndex: 5,
  },
}
