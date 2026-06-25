import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import TrainingStatusBanner from '../components/TrainingStatusBanner.jsx'

const SCHEMA = [
  { key: 'epsilon', label: 'Epsilon (exploration)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'n_pulls', label: 'Number of pulls', min: 50, max: 1000, step: 50 },
  { key: 'step_delay_ms', label: '👁️ Speed (ms per pull)', min: 0, max: 500, step: 10 },
]

const DEFAULT_PARAMS = {
  epsilon: 0.2,
  alpha: 0.1,
  n_pulls: 200,
  step_delay_ms: 0,
}

const MACHINE_COLORS = ['#ff5566', '#4499ff', '#44dd88']
const N_MACHINES = 3

function emptyArray(n, fill) {
  return Array.from({ length: n }, () => fill)
}

function SlotMachine({ index, color, qValue, pullCount, lastResult, justPulled, trueProb, revealed, isBest }) {
  const barPct = Math.max(0, Math.min(100, qValue * 100))
  return (
    <div
      style={{
        ...styles.machine,
        borderColor: justPulled ? color : '#1a4a6a',
        boxShadow: justPulled ? `0 0 16px ${color}88` : 'none',
        ...(isBest ? { background: `${color}14` } : {}),
      }}
    >
      <div style={{ ...styles.machineTitle, color }}>Machine {index + 1}</div>
      <div key={`icon-${pullCount}`} style={styles.machineIcon} className="bandit-spin">
        {lastResult == null ? '❔' : lastResult > 0 ? '🦴' : '❌'}
      </div>
      <div style={styles.pullCount}>Pulled: {pullCount} times</div>
      <div style={styles.barLabel}>
        Q(a) = {qValue.toFixed(3)}
      </div>
      <div style={styles.barTrack}>
        <div style={{ ...styles.barFill, width: `${barPct}%`, background: color }} />
      </div>
      {revealed && (
        <div style={styles.revealRow}>
          True prob: <strong>{trueProb.toFixed(2)}</strong> {isBest ? '✓' : ''}
        </div>
      )}
    </div>
  )
}

export default function Room5_Bandit() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [nPulls, setNPulls] = useState(DEFAULT_PARAMS.n_pulls)
  const [qValues, setQValues] = useState(emptyArray(N_MACHINES, 0))
  const [pullCounts, setPullCounts] = useState(emptyArray(N_MACHINES, 0))
  const [lastResults, setLastResults] = useState(emptyArray(N_MACHINES, null))
  const [lastPulledMachine, setLastPulledMachine] = useState(null)
  const [totalReward, setTotalReward] = useState(0)
  const [livePull, setLivePull] = useState(0)
  const [pullHistory, setPullHistory] = useState([])
  const [trueProbs, setTrueProbs] = useState(null)
  const [bestMachine, setBestMachine] = useState(null)

  const sendRef = useRef(() => {})

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setNPulls(msg.n_pulls ?? DEFAULT_PARAMS.n_pulls)
    } else if (msg.type === 'pull_result') {
      setQValues(msg.q_values)
      setPullCounts(msg.pull_counts)
      setLastPulledMachine(msg.machine)
      setLastResults((prev) => prev.map((v, i) => (i === msg.machine ? msg.reward : v)))
      setTotalReward(msg.total_reward)
      setLivePull(msg.pull)
      setPullHistory((prev) => [
        ...prev,
        {
          pull: msg.pull,
          total_reward: msg.total_reward,
          q0: msg.q_values[0],
          q1: msg.q_values[1],
          q2: msg.q_values[2],
        },
      ])
    } else if (msg.type === 'training_complete') {
      setQValues(msg.q_values)
      setPullCounts(msg.pull_counts)
      setTotalReward(msg.total_reward)
      setTrueProbs(msg.true_probs)
      setBestMachine(msg.best_machine)
      setStatus('complete')
    } else if (msg.type === 'reset_complete') {
      setQValues(emptyArray(N_MACHINES, 0))
      setPullCounts(emptyArray(N_MACHINES, 0))
      setLastResults(emptyArray(N_MACHINES, null))
      setLastPulledMachine(null)
      setTotalReward(0)
      setLivePull(0)
      setPullHistory([])
      setTrueProbs(null)
      setBestMachine(null)
      setStatus('idle')
      setNPulls(msg.n_pulls ?? DEFAULT_PARAMS.n_pulls)
    } else if (msg.type === 'error') {
      console.error('Room5 error:', msg.message)
    }
  }, [])

  const { send, connected } = useWebSocket(5, handleMessage)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setPullHistory([])
    setLastResults(emptyArray(N_MACHINES, null))
    setTrueProbs(null)
    setBestMachine(null)
    setStatus('training')
    send({ type: 'start_training', params })
  }
  const onPause = () => {
    setStatus('paused')
    send({ type: 'pause_training' })
  }
  const onResume = () => {
    setStatus('training')
    send({ type: 'resume_training' })
  }
  const onReset = () => send({ type: 'reset' })

  const bestQIdx = useMemo(() => qValues.indexOf(Math.max(...qValues)), [qValues])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.explainer}>
          חיזקי doesn't know which machine gives bones most often. Using
          epsilon-greedy: mostly exploit the best known machine, sometimes
          explore the others. Watch the Q-values converge to the true
          (hidden) probabilities!
        </div>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'training' && (
          <div style={styles.liveCounter}>
            Pull {livePull + 1} / {nPulls} &nbsp;·&nbsp; Total reward: {totalReward.toFixed(0)}
          </div>
        )}
        {status === 'complete' && trueProbs && (
          <div style={styles.resultPanel}>
            <div style={styles.resultTitle}>Training complete</div>
            <div>
              Best machine: #{bestMachine + 1} (Q={qValues[bestMachine].toFixed(2)})
            </div>
            <div>
              True prob was: {trueProbs[bestMachine].toFixed(2)}{' '}
              {bestMachine === trueProbs.indexOf(Math.max(...trueProbs)) ? '✓ correct!' : ''}
            </div>
            <div style={{ marginTop: '4px', opacity: 0.8 }}>Total reward: {totalReward.toFixed(0)} / {nPulls} pulls</div>
          </div>
        )}
      </aside>

      <main style={styles.main}>
        <div style={styles.machinesRow}>
          {[0, 1, 2].map((i) => (
            <SlotMachine
              key={i}
              index={i}
              color={MACHINE_COLORS[i]}
              qValue={qValues[i]}
              pullCount={pullCounts[i]}
              lastResult={lastResults[i]}
              justPulled={lastPulledMachine === i}
              trueProb={trueProbs ? trueProbs[i] : 0}
              revealed={Boolean(trueProbs)}
              isBest={status === 'complete' ? i === bestMachine : i === bestQIdx}
            />
          ))}
        </div>

        <div style={styles.chartsRow}>
          <div style={styles.chartCol}>
            <RewardChart data={pullHistory} xKey="pull" yKey="total_reward" title="Cumulative reward" />
          </div>
          <div style={styles.wrap}>
            <h4 style={styles.chartTitle}>Q-value convergence</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={pullHistory} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="#103252" strokeDasharray="3 3" />
                <XAxis dataKey="pull" stroke="#5a8fb0" fontSize={11} />
                <YAxis stroke="#5a8fb0" fontSize={11} domain={[0, 1]} />
                <Tooltip contentStyle={{ background: '#04162c', border: '1px solid #1a4a6a' }} />
                <Line type="monotone" dataKey="q0" stroke={MACHINE_COLORS[0]} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="q1" stroke={MACHINE_COLORS[1]} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="q2" stroke={MACHINE_COLORS[2]} dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes bandit-spin-kf {
          0% { transform: scale(0.4) rotate(-20deg); opacity: 0.3; }
          60% { transform: scale(1.25) rotate(8deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .bandit-spin { animation: bandit-spin-kf 0.35s ease-out; }
      `}</style>
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    height: '100%',
    width: '100%',
  },
  sidebar: {
    width: '320px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    overflowY: 'auto',
    borderRight: '1px solid #103252',
  },
  explainer: {
    background: '#06192e',
    border: '1px solid #1a4a6a',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '11px',
    lineHeight: 1.6,
    color: '#d7ecff',
  },
  connStatus: {
    fontSize: '11px',
    opacity: 0.6,
  },
  liveCounter: {
    fontSize: '12px',
    color: '#7fd9ff',
    fontFamily: 'monospace',
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '6px',
    padding: '8px 10px',
  },
  resultPanel: {
    background: '#06192e',
    border: '1px solid #00ffaa44',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '12px',
    lineHeight: 1.7,
    color: '#7fd9ff',
  },
  resultTitle: {
    fontWeight: 600,
    color: '#00ffaa',
    marginBottom: '4px',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    padding: '20px',
    gap: '20px',
    overflowY: 'auto',
  },
  machinesRow: {
    display: 'flex',
    gap: '20px',
    justifyContent: 'center',
  },
  machine: {
    width: '200px',
    background: '#06192e',
    border: '2px solid #1a4a6a',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
  },
  machineTitle: {
    fontWeight: 700,
    fontSize: '14px',
  },
  machineIcon: {
    fontSize: '40px',
    lineHeight: 1,
  },
  pullCount: {
    fontSize: '11px',
    color: '#7fd9ff',
    opacity: 0.8,
  },
  barLabel: {
    fontSize: '11px',
    color: '#d7ecff',
    fontFamily: 'monospace',
  },
  barTrack: {
    width: '100%',
    height: '10px',
    background: '#0a2a4a',
    borderRadius: '5px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    transition: 'width 0.2s ease-out',
  },
  revealRow: {
    fontSize: '11px',
    color: '#d7ecff',
    marginTop: '2px',
  },
  chartsRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  chartCol: {
    flex: 1,
    minWidth: '280px',
  },
  wrap: {
    flex: 1,
    minWidth: '280px',
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '10px',
  },
  chartTitle: {
    margin: '0 0 4px 4px',
    fontSize: '12px',
    color: '#7fd9ff',
  },
}
