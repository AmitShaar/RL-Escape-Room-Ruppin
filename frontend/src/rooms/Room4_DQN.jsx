import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import EpisodeReplay from '../components/EpisodeReplay.jsx'
import Scene3D from '../components/Scene3D.jsx'
import ContinuousWorld3D, { continuousToWorld } from '../components/ContinuousWorld3D.jsx'
import DogModel from '../components/DogModel.jsx'
import BestResultPanel from '../components/BestResultPanel.jsx'
import TrainingStatusBanner from '../components/TrainingStatusBanner.jsx'

const DEFAULT_BUFFER_CAPACITY = 10000
const SCHEMA = [
  { key: 'learning_rate', label: 'LR (learning rate)', min: 0.0001, max: 0.01, step: 0.0001 },
  { key: 'gamma', label: 'Gamma', min: 0.8, max: 0.999, step: 0.01 },
  { key: 'epsilon', label: 'Epsilon', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'epsilon_decay', label: 'Decay', min: 0.9, max: 0.999, step: 0.001 },
  { key: 'episodes', label: 'Episodes', min: 50, max: 500, step: 50 },
  { key: 'max_steps', label: 'Max Steps', min: 100, max: 500, step: 50 },
  { key: 'batch_size', label: 'Batch size', min: 16, max: 256, step: 16 },
  { key: 'buffer_size', label: 'Replay buffer size', min: 1000, max: 50000, step: 1000 },
  { key: 'target_sync', label: 'Target sync (steps)', min: 10, max: 500, step: 10 },
  { key: 'exit_reward', label: 'Exit reward', min: 10, max: 200, step: 10 },
  { key: 'wall_penalty', label: 'Wall penalty', min: -30, max: -1, step: 1 },
  { key: 'step_penalty', label: 'Step penalty', min: -0.5, max: 0, step: 0.05 },
  { key: 'wind_strength', label: 'Wind strength (0=off)', min: 0, max: 1.0, step: 0.1 },
]

const DEFAULT_PARAMS = {
  learning_rate: 0.001,
  gamma: 0.99,
  epsilon: 1.0,
  epsilon_decay: 0.995,
  episodes: 100,
  max_steps: 200,
  batch_size: 64,
  buffer_size: 10000,
  target_sync: 100,
  exit_reward: 100,
  wall_penalty: -10,
  step_penalty: -0.05,
  wind_strength: 0.4,
}

export default function Room4_DQN() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [special, setSpecial] = useState({ start: [1, 1], exit_center: [9, 9], exit_radius: 0.5 })
  const [wind, setWind] = useState([0, 0])
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [lossHistory, setLossHistory] = useState([])
  const [bufferFill, setBufferFill] = useState({ size: 0, capacity: DEFAULT_BUFFER_CAPACITY })
  const [trajectory, setTrajectory] = useState([])
  const [agentXY, setAgentXY] = useState([1, 1])
  const [velocity, setVelocity] = useState([0, 0])
  const [liveAgentXY, setLiveAgentXY] = useState(null)
  const [liveVelocity, setLiveVelocity] = useState([0, 0])
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)

  const sendRef = useRef(() => {})
  const lossStepRef = useRef(0)

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ start: msg.start, exit_center: msg.exit_center, exit_radius: msg.exit_radius })
      if (msg.wind) setWind(msg.wind)
    } else if (msg.type === 'step_update') {
      setLiveAgentXY(msg.agent_pos)
      setLiveVelocity(msg.velocity || [0, 0])
      if (msg.wind) setWind(msg.wind)
      if (msg.loss != null) {
        lossStepRef.current += 1
        setLossHistory((prev) => [...prev.slice(-300), { step: lossStepRef.current, loss: msg.loss }])
      }
      if (msg.buffer_size != null) {
        setBufferFill({ size: msg.buffer_size, capacity: msg.buffer_capacity })
      }
    } else if (msg.type === 'episode_end') {
      setEpisodeHistory((prev) => [...prev, { episode: msg.episode, total_reward: msg.total_reward, epsilon: msg.epsilon }])
    } else if (msg.type === 'training_complete') {
      setSpecial({ start: msg.start, exit_center: msg.exit_center, exit_radius: msg.exit_radius })
      setStatus('complete')
      setLiveAgentXY(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
      sendRef.current({ type: 'get_replay', episode: msg.best_episode })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setEpisodeHistory([])
      setLossHistory([])
      lossStepRef.current = 0
      setBufferFill({ size: 0, capacity: msg.buffer_capacity || DEFAULT_BUFFER_CAPACITY })
      setTrajectory([])
      setAgentXY(msg.start || [1, 1])
      setVelocity([0, 0])
      setLiveAgentXY(null)
      setLiveVelocity([0, 0])
      setBestReward(null)
      setBestEpisode(null)
      setWind([0, 0])
      setStatus('idle')
      setSpecial({ start: msg.start, exit_center: msg.exit_center, exit_radius: msg.exit_radius })
    } else if (msg.type === 'error') {
      console.error('Room4 error:', msg.message)
    }
  }, [])

  const { send, connected } = useWebSocket(4, handleMessage)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setEpisodeHistory([])
    setLossHistory([])
    lossStepRef.current = 0
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
      const prev = trajectory[step - 1]
      if (!point) return
      setAgentXY(point.pos)
      if (point.wind) setWind(point.wind)
      if (prev) {
        setVelocity([(point.pos[0] - prev.pos[0]) * 50, (point.pos[1] - prev.pos[1]) * 50])
      } else {
        setVelocity([0, 0])
      }
    },
    [trajectory]
  )

  const displayXY = liveAgentXY || agentXY
  const displayVelocity = liveAgentXY ? liveVelocity : velocity
  const dogPos = useMemo(() => continuousToWorld(displayXY[0], displayXY[1], 0.4), [displayXY])
  const bufferPct = bufferFill.capacity ? Math.min(100, (bufferFill.size / bufferFill.capacity) * 100) : 0

  const windLabel = useMemo(() => {
    const [wx, wy] = wind
    const mag = Math.hypot(wx, wy)
    if (mag < 0.02) return null
    const deg = Math.round(Math.atan2(wy, wx) * 180 / Math.PI)
    const pct = Math.round((mag / 0.6) * 100)
    const arrows = ['→','↗','↑','↖','←','↙','↓','↘']
    const idx = Math.round(((deg + 360) % 360) / 45) % 8
    return `${arrows[idx]} Wind ${pct}%`
  }, [wind])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'complete' && <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />}

        <div style={styles.bufferWrap}>
          <div style={styles.bufferLabel}>
            Replay buffer: {bufferFill.size} / {bufferFill.capacity}
          </div>
          <div style={styles.bufferTrack}>
            <div style={{ ...styles.bufferFill, width: `${bufferPct}%` }} />
          </div>
        </div>

        <RewardChart data={episodeHistory} xKey="episode" yKey="total_reward" title="Reward per episode" />
        <RewardChart data={lossHistory} xKey="step" yKey="loss" title="DQN loss (MSE)" color="#ff5577" />
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <ContinuousWorld3D
              agentPos={displayXY}
              velocity={displayVelocity}
              exitCenter={special.exit_center}
              exitRadius={special.exit_radius}
            />
            <DogModel position={dogPos} />
          </Scene3D>
          {windLabel && (
            <div style={styles.windBadge}>{windLabel}</div>
          )}
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
    gap: '8px',
    overflowY: 'auto',
    borderRight: '1px solid #103252',
  },
  connStatus: {
    fontSize: '11px',
    opacity: 0.6,
  },
  bufferWrap: {
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '10px',
  },
  bufferLabel: {
    fontSize: '11px',
    color: '#7fd9ff',
    marginBottom: '6px',
  },
  bufferTrack: {
    height: '8px',
    background: '#0a2a4a',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  bufferFill: {
    height: '100%',
    background: '#00ffaa',
  },
  main: {
    flex: 1,
    display: 'flex',
    minWidth: 0,
  },
  sceneWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  windBadge: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: 'rgba(0,30,60,0.75)',
    border: '1px solid #4488cc',
    borderRadius: '6px',
    padding: '5px 10px',
    fontSize: '13px',
    color: '#88ccff',
    fontFamily: 'monospace',
    pointerEvents: 'none',
  },
}
