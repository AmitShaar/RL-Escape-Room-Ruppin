export default function TrainingStatusBanner({ status }) {
  if (status === 'training') {
    return <div style={styles.banner}>חיזקי is learning...</div>
  }
  if (status === 'complete') {
    return <div style={{ ...styles.banner, ...styles.complete }}>חיזקי found the bone!</div>
  }
  return null
}

const styles = {
  banner: {
    fontSize: '12px',
    color: '#7fd9ff',
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '6px',
    padding: '6px 10px',
  },
  complete: {
    color: '#FFD700',
    border: '1px solid #FFD70055',
  },
}
