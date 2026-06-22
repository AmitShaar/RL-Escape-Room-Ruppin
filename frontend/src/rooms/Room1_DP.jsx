import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import QValueHeatmap from '../components/QValueHeatmap.jsx'
import EpisodeReplay from '../components/EpisodeReplay.jsx'
import Scene3D from '../components/Scene3D.jsx'
import GridWorld3D, { gridToWorld } from '../components/GridWorld3D.jsx'
import SubmarineModel from '../components/SubmarineModel.jsx'

const SCHEMA = [
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'theta', label: 'Theta (convergence)', min: 0.0001, max: 0.01, step: 0.0001 },
  { key: 'slip_prob', label: 'Slip probability', min: 0, max: 0.5, step: 0.01 },
  { key: 'num_coral', label: 'Coral reefs (walls)', min: 0, max: 20, step: 1 },
  { key: 'num_vents', label: 'Thermal vents (slip)', min: 0, max: 15, step: 1 },
  { key: 'num_traps', label: 'Electric traps', min: 0, max: 8, step: 1 },
]

const DEFAULT_PARAMS = {
  gamma: 0.95,
  theta: 0.0001,
  slip_prob: 0.1,
  num_coral: 8,
  num_vents: 6,
  num_traps: 3,
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

  const sendRef = useRef(() => {})

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'vi_iteration') {
      setVTable(msg.v_table)
      setPolicy(msg.policy)
      setDeltaHistory((prev) => [...prev, { iteration: msg.iteration, delta: msg.delta }])
    } else if (msg.type === 'training_complete') {
      setVTable(msg.v_table)
      setPolicy(msg.policy)
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps })
      setStatus('complete')
      sendRef.current({ type: 'get_replay', episode: 0 })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setVTable(ZERO_TABLE)
      setPolicy(EMPTY_POLICY)
      setDeltaHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setStatus('idle')
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

  const submarinePos = useMemo(() => gridToWorld(agentRC[0], agentRC[1], 0.4), [agentRC])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
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
            />
            <SubmarineModel position={submarinePos} />
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
