import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import QValueHeatmap from '../components/QValueHeatmap.jsx'
import EpisodeReplay from '../components/EpisodeReplay.jsx'
import Scene3D from '../components/Scene3D.jsx'
import GridWorld3D, { gridToWorld } from '../components/GridWorld3D.jsx'
import DogModel from '../components/DogModel.jsx'
import BestResultPanel from '../components/BestResultPanel.jsx'
import TrainingStatusBanner from '../components/TrainingStatusBanner.jsx'

const SCHEMA = [
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'epsilon', label: 'Epsilon (exploration)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'epsilon_decay', label: 'Epsilon decay', min: 0.9, max: 1.0, step: 0.001 },
  { key: 'episodes', label: 'Episodes', min: 50, max: 5000, step: 50 },
  { key: 'max_steps', label: 'Max steps', min: 50, max: 1000, step: 10 },
  { key: 'slip_prob', label: 'Slip probability', min: 0, max: 0.5, step: 0.01 },
  { key: 'K_beacons', label: 'Scent markers (K)', min: 1, max: 5, step: 1 },
]

const DEFAULT_PARAMS = {
  alpha: 0.1,
  gamma: 0.95,
  epsilon: 0.2,
  epsilon_decay: 0.995,
  episodes: 500,
  max_steps: 300,
  slip_prob: 0.15,
  K_beacons: 3,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))

export default function Room2_SARSA() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [qHeatmap, setQHeatmap] = useState(ZERO_TABLE)
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [special, setSpecial] = useState({ beacons: [], slip_cells: [], traps: [] })
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [visitedCount, setVisitedCount] = useState(0)
  const [liveAgentPos, setLiveAgentPos] = useState(null)
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)

  const sendRef = useRef(() => {})

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ beacons: msg.beacons, slip_cells: msg.slip_cells, traps: msg.traps })
    } else if (msg.type === 'step_update') {
      setLiveAgentPos(msg.agent_pos)
      if (msg.q_values) setQHeatmap(msg.q_values)
    } else if (msg.type === 'episode_end') {
      setEpisodeHistory((prev) => [...prev, { episode: msg.episode, total_reward: msg.total_reward, epsilon: msg.epsilon }])
    } else if (msg.type === 'training_complete') {
      setPolicy(msg.policy)
      setQHeatmap(msg.q_values)
      setSpecial({ beacons: msg.beacons, slip_cells: msg.slip_cells, traps: msg.traps })
      setStatus('complete')
      setLiveAgentPos(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
      sendRef.current({ type: 'get_replay', episode: msg.best_episode })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setQHeatmap(ZERO_TABLE)
      setPolicy(EMPTY_POLICY)
      setEpisodeHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setVisitedCount(0)
      setLiveAgentPos(null)
      setBestReward(null)
      setBestEpisode(null)
      setStatus('idle')
      setSpecial({ beacons: msg.beacons, slip_cells: msg.slip_cells, traps: msg.traps })
    } else if (msg.type === 'error') {
      console.error('Room2 error:', msg.message)
    }
  }, [])

  const { send, connected } = useWebSocket(2, handleMessage)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setEpisodeHistory([])
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
      setVisitedCount(point ? point.visited : 0)
    },
    [trajectory]
  )

  const displayRC = liveAgentPos || agentRC
  const dogPos = useMemo(() => gridToWorld(displayRC[0], displayRC[1], 0.4), [displayRC])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'complete' && <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />}
        <RewardChart data={episodeHistory} xKey="episode" yKey="total_reward" title="Reward per episode" />
        <RewardChart data={episodeHistory} xKey="episode" yKey="epsilon" title="Epsilon decay" color="#ffaa00" />
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <GridWorld3D
              vTable={qHeatmap}
              policy={status === 'complete' ? policy : null}
              vents={special.slip_cells}
              traps={special.traps}
              beacons={special.beacons}
              beaconsVisitedCount={visitedCount}
            />
            <DogModel position={dogPos} />
          </Scene3D>
        </div>
        <div style={styles.heatmapWrap}>
          <QValueHeatmap
            table={qHeatmap}
            special={{ vents: special.slip_cells, traps: special.traps }}
            label="max Q(s,a) Heatmap"
          />
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
