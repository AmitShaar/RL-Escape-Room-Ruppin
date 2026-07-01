import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import LossChart from '../components/LossChart.jsx'
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
  { key: 'max_steps', label: 'Max Steps', min: 100, max: 1000, step: 50 },
  { key: 'n_obstacles', label: 'Obstacles (N)', min: 1, max: 10, step: 1 },
  { key: 'visibility_range', label: 'Visibility range (m)', min: 1, max: 6, step: 0.5 },
]

const DEFAULT_PARAMS = {
  learning_rate: 0.001,
  gamma: 0.99,
  epsilon: 1.0,
  epsilon_decay: 0.995,
  episodes: 300,
  max_steps: 500,
  n_obstacles: 5,
  visibility_range: 3.0,
}

export default function Room5_Storm() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [special, setSpecial] = useState({ start: [1, 1], exit_center: [9, 9], exit_radius: 0.5, obstacles: [] })
  const [liveObstacles, setLiveObstacles] = useState([])
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [lossHistory, setLossHistory] = useState([])
  const [bufferFill, setBufferFill] = useState({ size: 0, capacity: DEFAULT_BUFFER_CAPACITY })
  const [liveAgentXY, setLiveAgentXY] = useState(null)
  const [liveVelocity, setLiveVelocity] = useState([0, 0])
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)
  const [genResult, setGenResult] = useState(null)
  const [genLoading, setGenLoading] = useState(false)

  const sendRef = useRef(() => {})
  const lossStepRef = useRef(0)

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ start: msg.start, exit_center: msg.exit_center, exit_radius: msg.exit_radius, obstacles: msg.obstacles || [] })
      setLiveObstacles(msg.obstacles || [])
    } else if (msg.type === 'step_update') {
      setLiveAgentXY(msg.agent_pos)
      setLiveVelocity(msg.velocity || [0, 0])
      if (msg.obstacles) setLiveObstacles(msg.obstacles)
      if (msg.loss != null) {
        lossStepRef.current += 1
        setLossHistory((prev) => [...prev.slice(-300), { step: lossStepRef.current, loss: msg.loss }])
      }
      if (msg.buffer_size != null) {
        setBufferFill({ size: msg.buffer_size, capacity: msg.buffer_capacity || DEFAULT_BUFFER_CAPACITY })
      }
    } else if (msg.type === 'episode_end') {
      setEpisodeHistory((prev) => [...prev, { episode: msg.episode, total_reward: msg.total_reward, epsilon: msg.epsilon }])
    } else if (msg.type === 'training_complete') {
      setSpecial((s) => ({ ...s, start: msg.start, exit_center: msg.exit_center, exit_radius: msg.exit_radius }))
      setStatus('complete')
      setLiveAgentXY(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
    } else if (msg.type === 'generalization_result') {
      setGenResult(msg)
      setGenLoading(false)
    } else if (msg.type === 'reset_complete') {
      setEpisodeHistory([])
      setLossHistory([])
      lossStepRef.current = 0
      setBufferFill({ size: 0, capacity: DEFAULT_BUFFER_CAPACITY })
      setLiveAgentXY(null)
      setLiveVelocity([0, 0])
      setBestReward(null)
      setBestEpisode(null)
      setGenResult(null)
      setStatus('idle')
      setSpecial({ start: msg.start, exit_center: msg.exit_center, exit_radius: msg.exit_radius, obstacles: msg.obstacles || [] })
      setLiveObstacles(msg.obstacles || [])
    } else if (msg.type === 'error') {
      console.error('Room5 error:', msg.message)
      setGenLoading(false)
    }
  }, [])

  const { send, connected } = useWebSocket(5, handleMessage)
  useEffect(() => { sendRef.current = send }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setEpisodeHistory([])
    setLossHistory([])
    lossStepRef.current = 0
    setGenResult(null)
    setStatus('training')
    send({ type: 'start_training', params })
  }
  const onPause  = () => { setStatus('paused');   send({ type: 'pause_training' }) }
  const onResume = () => { setStatus('training'); send({ type: 'resume_training' }) }
  const onReset  = () => send({ type: 'reset' })

  const onTestGeneralization = () => {
    setGenLoading(true)
    setGenResult(null)
    send({ type: 'test_generalization' })
  }

  const displayXY = liveAgentXY || [special.start[0], special.start[1]]
  const displayVelocity = liveAgentXY ? liveVelocity : [0, 0]
  const displayObstacles = liveAgentXY ? liveObstacles : special.obstacles
  const dogPos = useMemo(() => continuousToWorld(displayXY[0], displayXY[1], 0.4), [displayXY])
  const bufferPct = bufferFill.capacity ? Math.min(100, (bufferFill.size / bufferFill.capacity) * 100) : 0

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />

        {status === 'complete' && (
          <>
            <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />
            <button style={styles.genBtn} onClick={onTestGeneralization} disabled={genLoading}>
              {genLoading ? 'Testing...' : 'Test on new layout'}
            </button>
            {genResult && (
              <div style={styles.genPanel}>
                <div style={styles.genTitle}>Generalization test (10 new layouts)</div>
                <div>Success rate: <strong>{(genResult.success_rate * 100).toFixed(0)}%</strong></div>
                <div>Avg reward: {genResult.avg_reward?.toFixed(1)}</div>
                <div>Avg steps: {genResult.avg_steps?.toFixed(0)}</div>
              </div>
            )}
          </>
        )}

        <div style={styles.bufferWrap}>
          <div style={styles.bufferLabel}>Replay buffer: {bufferFill.size} / {bufferFill.capacity}</div>
          <div style={styles.bufferTrack}>
            <div style={{ ...styles.bufferFill, width: `${bufferPct}%` }} />
          </div>
        </div>

        <RewardChart data={episodeHistory} xKey="episode" yKey="total_reward" title="Reward per episode" />
        <LossChart data={lossHistory} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <ContinuousWorld3D
              agentPos={displayXY}
              velocity={displayVelocity}
              exitCenter={special.exit_center}
              exitRadius={special.exit_radius}
              obstacles={displayObstacles}
            />
            <DogModel position={dogPos} />
          </Scene3D>
        </div>
      </main>
    </div>
  )
}

const styles = {
  layout: { display: 'flex', height: '100%', width: '100%' },
  sidebar: {
    width: '320px', padding: '14px', display: 'flex', flexDirection: 'column',
    gap: '12px', overflowY: 'auto', borderRight: '1px solid #103252',
  },
  connStatus: { fontSize: '11px', opacity: 0.6 },
  genBtn: {
    background: '#002244', border: '1px solid #4499ff', borderRadius: '6px',
    color: '#7fd9ff', padding: '8px 14px', fontSize: '13px', cursor: 'pointer',
  },
  genPanel: {
    background: '#06192e', border: '1px solid #4499ff44', borderRadius: '8px',
    padding: '10px 12px', fontSize: '12px', lineHeight: 1.7, color: '#7fd9ff',
  },
  genTitle: { fontWeight: 600, color: '#4499ff', marginBottom: '4px' },
  bufferWrap: { background: '#06192e', border: '1px solid #103252', borderRadius: '8px', padding: '10px' },
  bufferLabel: { fontSize: '11px', color: '#7fd9ff', marginBottom: '6px' },
  bufferTrack: { height: '8px', background: '#0a2a4a', borderRadius: '4px', overflow: 'hidden' },
  bufferFill: { height: '100%', background: '#00ffaa' },
  main: { flex: 1, display: 'flex', minWidth: 0 },
  sceneWrap: { flex: 1, minWidth: 0 },
}
