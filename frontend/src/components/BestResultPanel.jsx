export default function BestResultPanel({ bestReward, bestEpisode, params }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.title}>Best result</div>
      <div style={styles.row}>
        <span>Best reward:</span>
        <span>{bestReward?.toFixed(1)}</span>
      </div>
      <div style={styles.row}>
        <span>Best episode:</span>
        <span>{bestEpisode}</span>
      </div>
      {Object.entries(params).map(([k, v]) => (
        <div key={k} style={styles.row}>
          <span style={{ opacity: 0.7 }}>{k}:</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  )
}

const styles = {
  wrap: {
    background: '#06192e',
    border: '1px solid #00ffaa44',
    borderRadius: '8px',
    padding: '10px',
    fontSize: '11px',
    lineHeight: 1.7,
  },
  title: {
    fontWeight: 600,
    color: '#00ffaa',
    marginBottom: '6px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#7fd9ff',
  },
}
