import { useCallback, useEffect, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import RewardChart from '../components/RewardChart.jsx'

const SCHEMA = [
  { key: 'epsilon', label: 'Epsilon (autoplay exploration only)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
]

const DEFAULT_PARAMS = { epsilon: 0.2, alpha: 0.1 }

const MAX_PULLS = 200
const N_MACHINES = 3
const MACHINE_COLORS = ['#ff5566', '#4499ff', '#44dd88']
const SPIN_MS = 500
const AUTOPLAY_INTERVAL_MS = 300

function emptyArray(n, fill) {
  return Array.from({ length: n }, () => fill)
}

function SlotMachine({ index, color, qValue, pullCount, lastResult, spinning, isBest, trueProb, revealed, disabled, onPull }) {
  const barPct = Math.max(0, Math.min(100, qValue * 100))
  let display = '❔'
  if (spinning) display = '⭐⭐⭐'
  else if (lastResult != null) display = lastResult > 0 ? '🦴' : '❌'

  return (
    <div
      style={{
        ...styles.machine,
        borderColor: isBest ? color : '#1a4a6a',
        boxShadow: isBest ? `0 0 18px ${color}99` : 'none',
        ...(isBest ? { background: `${color}14` } : {}),
      }}
    >
      <div style={{ ...styles.machineTitle, color }}>Machine {index + 1}</div>

      <div style={styles.displayWindow}>
        <div key={`icon-${pullCount}-${spinning}`} style={styles.machineIcon} className={spinning ? 'bandit-spinning' : 'bandit-spin'}>
          {display}
        </div>
      </div>

      <button
        style={{ ...styles.pullButton, borderColor: color, color, opacity: disabled ? 0.4 : 1 }}
        disabled={disabled}
        onClick={onPull}
      >
        <div className={spinning ? 'bandit-lever-pulled' : ''} style={{ ...styles.leverKnob, background: color }} />
        <span style={styles.pullLabel}>🎰 PULL</span>
      </button>

      <div style={styles.pullCount}>Pulled: {pullCount} times</div>
      <div style={styles.barLabel}>Q(a) = {qValue.toFixed(3)}</div>
      <div style={styles.barTrack}>
        <div style={{ ...styles.barFill, width: `${barPct}%`, background: color }} />
      </div>
      {revealed && (
        <div key={`reveal-${index}`} style={styles.revealRow} className="bandit-spin">
          True prob: <strong>{trueProb.toFixed(2)}</strong>
        </div>
      )}
    </div>
  )
}

export default function Room5_Bandit() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [qValues, setQValues] = useState(emptyArray(N_MACHINES, 0))
  const [pullCounts, setPullCounts] = useState(emptyArray(N_MACHINES, 0))
  const [lastResults, setLastResults] = useState(emptyArray(N_MACHINES, null))
  const [spinningMachine, setSpinningMachine] = useState(null)
  const [pulling, setPulling] = useState(false)
  const [totalPulls, setTotalPulls] = useState(0)
  const [totalReward, setTotalReward] = useState(0)
  const [pullHistory, setPullHistory] = useState([])
  const [trueProbs, setTrueProbs] = useState(null)
  const [bestMachine, setBestMachine] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [revealBanner, setRevealBanner] = useState(false)
  const [autoplay, setAutoplay] = useState(false)

  const spinStateRef = useRef({ timerDone: false, msg: null })
  const doAutoTickRef = useRef(() => {})
  const revealBannerTimeoutRef = useRef(null)

  const applyPullResult = useCallback((msg) => {
    setQValues(msg.q_values)
    setPullCounts(msg.pull_counts)
    setTotalPulls(msg.total_pulls)
    setTotalReward(msg.total_reward)
    setLastResults((prev) => prev.map((v, i) => (i === msg.machine ? msg.reward : v)))
    setPullHistory((prev) => [
      ...prev,
      { pull: msg.total_pulls, total_reward: msg.total_reward, q0: msg.q_values[0], q1: msg.q_values[1], q2: msg.q_values[2] },
    ])
    setSpinningMachine(null)
    setPulling(false)
    if (msg.done) {
      setTrueProbs(msg.true_probs)
      setBestMachine(msg.best_machine)
      setRevealed(true)
      setAutoplay(false)
      setRevealBanner(true)
      clearTimeout(revealBannerTimeoutRef.current)
      revealBannerTimeoutRef.current = setTimeout(() => setRevealBanner(false), 2800)
    }
  }, [])

  const handleMessage = useCallback(
    (msg) => {
      if (msg.type === 'pull_result') {
        spinStateRef.current.msg = msg
        if (spinStateRef.current.timerDone) applyPullResult(msg)
      } else if (msg.type === 'reset_complete') {
        setQValues(emptyArray(N_MACHINES, 0))
        setPullCounts(emptyArray(N_MACHINES, 0))
        setLastResults(emptyArray(N_MACHINES, null))
        setSpinningMachine(null)
        setPulling(false)
        setTotalPulls(0)
        setTotalReward(0)
        setPullHistory([])
        setTrueProbs(null)
        setBestMachine(null)
        setRevealed(false)
        setRevealBanner(false)
        setAutoplay(false)
      } else if (msg.type === 'error') {
        console.error('Room5 error:', msg.message)
      }
    },
    [applyPullResult]
  )

  const { send, connected } = useWebSocket(5, handleMessage)

  const pullMachine = useCallback(
    (idx) => {
      if (pulling || revealed) return
      setPulling(true)
      setSpinningMachine(idx)
      spinStateRef.current = { timerDone: false, msg: null }
      send({ type: 'single_pull', machine: idx, params: { alpha: params.alpha, n_pulls: MAX_PULLS } })
      setTimeout(() => {
        spinStateRef.current.timerDone = true
        if (spinStateRef.current.msg) applyPullResult(spinStateRef.current.msg)
      }, SPIN_MS)
    },
    [pulling, revealed, send, params.alpha, applyPullResult]
  )

  const doAutoTick = useCallback(() => {
    if (pulling || revealed) return
    const idx = Math.random() < params.epsilon ? Math.floor(Math.random() * N_MACHINES) : qValues.indexOf(Math.max(...qValues))
    pullMachine(idx)
  }, [pulling, revealed, params.epsilon, qValues, pullMachine])

  useEffect(() => {
    doAutoTickRef.current = doAutoTick
  }, [doAutoTick])

  useEffect(() => {
    if (!autoplay) return
    const interval = setInterval(() => doAutoTickRef.current(), AUTOPLAY_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [autoplay])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))
  const onReset = () => {
    setAutoplay(false)
    send({ type: 'reset' })
  }

  const bestQIdx = qValues.indexOf(Math.max(...qValues))
  const actualBestIdx = trueProbs ? trueProbs.indexOf(Math.max(...trueProbs)) : null

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.explainer}>
          חיזקי doesn't know which machine gives bones most often. Click a
          machine to pull it yourself, or let חיזקי play on his own using
          epsilon-greedy: mostly exploiting the best known machine, sometimes
          exploring the others. Watch the Q-values converge to the true
          (hidden) probabilities!
        </div>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={false} />

        <label style={styles.autoplayRow}>
          <input
            type="checkbox"
            checked={autoplay}
            disabled={revealed}
            onChange={(e) => setAutoplay(e.target.checked)}
          />
          🤖 Let חיזקי play (auto-pulls every {AUTOPLAY_INTERVAL_MS}ms)
        </label>

        <button style={styles.resetBtn} onClick={onReset}>
          ⟲ Reset
        </button>

        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>

        <div style={styles.liveCounter}>
          Pull {totalPulls} / {MAX_PULLS} &nbsp;·&nbsp; Total reward: {totalReward.toFixed(0)}
        </div>

        {revealed && trueProbs && (
          <div style={styles.resultPanel} className="bandit-spin">
            <div style={styles.resultTitle}>🎉 Round complete — revealed!</div>
            <div>
              Best machine (by Q): #{bestMachine + 1} (Q={qValues[bestMachine].toFixed(2)})
            </div>
            <div>
              Actually best machine: #{actualBestIdx + 1} (true prob {trueProbs[actualBestIdx].toFixed(2)})
            </div>
            <div style={{ marginTop: '4px', fontWeight: 600, color: bestMachine === actualBestIdx ? '#00ffaa' : '#ff8888' }}>
              {bestMachine === actualBestIdx ? 'חיזקי chose correctly! ✓' : 'חיזקי picked the wrong machine ✗'}
            </div>
          </div>
        )}

        <div style={styles.chartCol}>
          <RewardChart data={pullHistory} xKey="pull" yKey="total_reward" title="Cumulative reward" />
        </div>
        <div style={styles.wrap}>
          <h4 style={styles.chartTitle}>Q-value convergence</h4>
          <ResponsiveContainer width="100%" height={160}>
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
              spinning={spinningMachine === i}
              isBest={i === bestQIdx}
              trueProb={trueProbs ? trueProbs[i] : 0}
              revealed={revealed}
              disabled={pulling || revealed}
              onPull={() => pullMachine(i)}
            />
          ))}
        </div>

        {revealBanner && (
          <div style={styles.revealBannerWrap}>
            <div style={styles.revealBanner} className="bandit-reveal-banner">
              🎉 True probabilities revealed!
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes bandit-spin-kf {
          0% { transform: scale(0.4) rotate(-20deg); opacity: 0.3; }
          60% { transform: scale(1.25) rotate(8deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .bandit-spin { animation: bandit-spin-kf 0.35s ease-out; }

        @keyframes bandit-spinning-kf {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-4px) rotate(-6deg); }
          50% { transform: translateY(0) rotate(0deg); }
          75% { transform: translateY(4px) rotate(6deg); }
        }
        .bandit-spinning { animation: bandit-spinning-kf 0.25s linear infinite; }

        @keyframes bandit-lever-kf {
          0% { transform: translateY(0); }
          40% { transform: translateY(10px); }
          100% { transform: translateY(0); }
        }
        .bandit-lever-pulled { animation: bandit-lever-kf 0.4s ease-out; }

        @keyframes bandit-reveal-kf {
          0% { opacity: 0; transform: translateY(-12px) scale(0.9); }
          15% { opacity: 1; transform: translateY(0) scale(1.05); }
          25% { transform: scale(1); }
          85% { opacity: 1; }
          100% { opacity: 0; }
        }
        .bandit-reveal-banner { animation: bandit-reveal-kf 2.8s ease-in-out; }
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
  autoplayRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#7fd9ff',
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '6px',
    padding: '8px 10px',
    cursor: 'pointer',
  },
  resetBtn: {
    background: '#0a2a4a',
    border: '1px solid #1a4a6a',
    borderRadius: '6px',
    color: '#d7ecff',
    padding: '8px 14px',
    fontSize: '13px',
    alignSelf: 'flex-start',
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
    position: 'relative',
  },
  machinesRow: {
    display: 'flex',
    gap: '24px',
    justifyContent: 'center',
  },
  machine: {
    width: '200px',
    background: '#06192e',
    border: '2px solid #1a4a6a',
    borderRadius: '16px',
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
  displayWindow: {
    width: '100%',
    height: '80px',
    background: '#020e1c',
    border: '2px solid #0a2a4a',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'inset 0 0 12px #000',
  },
  machineIcon: {
    fontSize: '36px',
    lineHeight: 1,
  },
  pullButton: {
    width: '100%',
    background: '#0a1a2a',
    border: '2px solid',
    borderRadius: '10px',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '12px',
  },
  leverKnob: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
  },
  pullLabel: {
    fontSize: '11px',
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
  chartCol: {
    minWidth: '100px',
  },
  wrap: {
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
  revealBannerWrap: {
    position: 'absolute',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 6,
    pointerEvents: 'none',
  },
  revealBanner: {
    background: 'rgba(0,255,170,0.18)',
    border: '1px solid #00ffaa',
    color: '#00ffaa',
    borderRadius: '10px',
    padding: '12px 22px',
    fontSize: '16px',
    fontWeight: 700,
  },
}
