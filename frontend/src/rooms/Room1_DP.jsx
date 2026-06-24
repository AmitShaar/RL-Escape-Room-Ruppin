import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import QValueHeatmap from '../components/QValueHeatmap.jsx'
import EpisodeReplay from '../components/EpisodeReplay.jsx'
import Scene3D from '../components/Scene3D.jsx'
import GridWorld3D, { gridToWorld, GRID_SIZE } from '../components/GridWorld3D.jsx'
import DogModel from '../components/DogModel.jsx'
import BestResultPanel from '../components/BestResultPanel.jsx'
import TrainingStatusBanner from '../components/TrainingStatusBanner.jsx'

const SCHEMA = [
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'theta', label: 'Theta (convergence)', min: 0.0001, max: 0.01, step: 0.0001 },
  { key: 'slip_prob', label: 'Slip probability', min: 0, max: 0.5, step: 0.01 },
  { key: 'num_coral', label: 'Coral reefs (walls)', min: 0, max: 20, step: 1 },
  { key: 'num_vents', label: 'Thermal vents (slip)', min: 0, max: 15, step: 1 },
  { key: 'num_traps', label: 'Electric traps', min: 0, max: 8, step: 1 },
  { key: 'exit_reward', label: 'Exit reward (bone)', min: 10, max: 200, step: 10 },
  { key: 'trap_reward', label: 'Trap penalty', min: -50, max: -1, step: 1 },
  { key: 'step_penalty', label: 'Step penalty', min: -1, max: -0.01, step: 0.01 },
]

const DEFAULT_PARAMS = {
  gamma: 0.95,
  theta: 0.0001,
  slip_prob: 0.1,
  num_coral: 8,
  num_vents: 6,
  num_traps: 3,
  exit_reward: 100,
  trap_reward: -20,
  step_penalty: -0.1,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))

export default function Room1_DP() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [vTable, setVTable] = useState(ZERO_TABLE)
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [deltaHistory, setDeltaHistory] = useState([])
  const [special, setSpecial] = useState({ walls: [], vents: [], traps: [] })
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)
  const [currentRow, setCurrentRow] = useState(null)

  const sendRef = useRef(() => {})

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps })
    } else if (msg.type === 'vi_iteration') {
      setVTable(msg.v_table)
      setPolicy(msg.policy)
      setCurrentRow(msg.current_row)
      // vi_iteration now streams once per row (for the sweep effect); only
      // record one convergence-chart point per full sweep (the last row).
      if (msg.current_row === GRID_SIZE - 1) {
        setDeltaHistory((prev) => [...prev, { iteration: msg.iteration, delta: msg.delta }])
      }
    } else if (msg.type === 'training_complete') {
      setVTable(msg.v_table)
      setPolicy(msg.policy)
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps })
      setStatus('complete')
      setCurrentRow(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
      sendRef.current({ type: 'get_replay', episode: 0 })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setVTable(ZERO_TABLE)
      setPolicy(EMPTY_POLICY)
      setDeltaHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setBestReward(null)
      setBestEpisode(null)
      setCurrentRow(null)
      setStatus('idle')
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps })
    } else if (msg.type === 'error') {
      console.error('Room1 error:', msg.message)
    }
  }, [])

  const { send, connected } = useWebSocket(1, handleMessage)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setDeltaHistory([])
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

  const onReplayStep = useCallback(
    (step) => {
      const point = trajectory[step]
      setAgentRC(point ? point.pos : [0, 0])
    },
    [trajectory]
  )

  const dogPos = useMemo(() => gridToWorld(agentRC[0], agentRC[1], 0.4), [agentRC])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {deltaHistory.length > 0 && (
          <div style={styles.iterCounter}>
            <span style={styles.iterCount}>{deltaHistory.length}</span>
            <span style={styles.iterLabel}>{status === 'complete' ? ' iterations to converge' : ' iterations so far'}</span>
            <div style={styles.iterDelta}>
              Δ = {deltaHistory[deltaHistory.length - 1]?.delta?.toFixed(6) ?? '—'}
            </div>
          </div>
        )}
        {status === 'complete' && <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />}
        <RewardChart data={deltaHistory} xKey="iteration" yKey="delta" title="Convergence (delta per iteration)" />
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <GridWorld3D
              vTable={vTable}
              policy={policy}
              walls={special.walls}
              vents={special.vents}
              traps={special.traps}
              currentRow={currentRow}
            />
            <DogModel position={dogPos} />
          </Scene3D>
        </div>
        <div style={styles.heatmapWrap}>
          <QValueHeatmap table={vTable} special={special} label="V(s) Heatmap" />
        </div>
      </main>
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
  connStatus: {
    fontSize: '11px',
    opacity: 0.6,
  },
  iterCounter: {
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
  },
  iterCount: {
    fontSize: '22px',
    fontWeight: 600,
    color: '#7dd3fc',
  },
  iterLabel: {
    fontSize: '11px',
    opacity: 0.7,
  },
  iterDelta: {
    fontSize: '11px',
    color: '#00ffaa',
    marginTop: '2px',
  },
  main: {
    flex: 1,
    display: 'flex',
    minWidth: 0,
  },
  sceneWrap: {
    flex: 1,
    minWidth: 0,
  },
  heatmapWrap: {
    width: '300px',
    padding: '14px',
  },
}
