import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export default function RewardChart({ data, xKey, yKey, title, color = '#00ffaa', yScale }) {
  return (
    <div style={styles.wrap}>
      <h4 style={styles.title}>{title}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#103252" strokeDasharray="3 3" />
          <XAxis dataKey={xKey} stroke="#5a8fb0" fontSize={11} />
          <YAxis stroke="#5a8fb0" fontSize={11} scale={yScale} domain={yScale === 'log' ? ['auto', 'auto'] : undefined} />
          <Tooltip contentStyle={{ background: '#04162c', border: '1px solid #1a4a6a' }} />
          <Line type="monotone" dataKey={yKey} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
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
    margin: '0 0 4px 4px',
    fontSize: '12px',
    color: '#7fd9ff',
  },
}
