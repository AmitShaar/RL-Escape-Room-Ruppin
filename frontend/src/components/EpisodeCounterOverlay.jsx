export default function EpisodeCounterOverlay({ episode, totalEpisodes, step, epsilon }) {
  if (episode == null) return null
  return (
    <div style={styles.wrap}>
      <div>
        Episode {episode + 1} / {totalEpisodes}
      </div>
      <div>Step {step}</div>
      {epsilon != null && <div>ε = {epsilon.toFixed(3)}</div>}
    </div>
  )
}

const styles = {
  wrap: {
    position: 'absolute',
    top: '10px',
    right: '10px',
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
