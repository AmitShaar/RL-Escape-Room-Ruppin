import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export default function ComparisonChart({ data, series, xKey = 'episode', title, portalEpisode }) {
  return (
    <div style={styles.wrap}>
      <h4 style={styles.title}>{title}</h4>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#103252" strokeDasharray="3 3" />
          <XAxis dataKey={xKey} stroke="#5a8fb0" fontSize={11} />
          <YAxis stroke="#5a8fb0" fontSize={11} />
          <Tooltip contentStyle={{ background: '#04162c', border: '1px solid #1a4a6a' }} />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          {portalEpisode != null && (
            <ReferenceLine
              x={portalEpisode}
              stroke="#aaff44"
              strokeDasharray="4 2"
              label={{ value: 'Portal found', fill: '#aaff44', fontSize: 10 }}
            />
          )}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
            />
          ))}
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
