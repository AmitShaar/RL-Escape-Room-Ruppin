export default function HyperparamPanel({ schema, values, onChange, disabled }) {
  return (
    <div style={styles.panel}>
      <h3 style={styles.heading}>Hyperparameters</h3>
      {schema.map((field) => (
        <div key={field.key} style={styles.field}>
          <div style={styles.labelRow}>
            <label>{field.label}</label>
            <span style={styles.value}>{values[field.key]}</span>
          </div>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={values[field.key]}
            disabled={disabled}
            onChange={(e) => onChange(field.key, parseFloat(e.target.value))}
          />
        </div>
      ))}
    </div>
  )
}

const styles = {
  panel: {
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '8px 10px',
  },
  heading: {
    margin: '0 0 6px 0',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#7fd9ff',
  },
  field: {
    marginBottom: '5px',
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    marginBottom: '1px',
  },
  value: {
    color: '#00ffaa',
    fontFamily: 'monospace',
  },
}
