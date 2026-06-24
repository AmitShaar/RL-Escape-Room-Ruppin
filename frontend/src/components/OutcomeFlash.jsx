export default function OutcomeFlash({ outcome }) {
  if (!outcome) return null
  return (
    <div
      style={{
        ...styles.flash,
        background: outcome === 'success' ? 'rgba(0,255,170,0.28)' : 'rgba(255,68,68,0.28)',
      }}
    />
  )
}

const styles = {
  flash: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 4,
  },
}
