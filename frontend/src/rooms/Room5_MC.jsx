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
import EpisodeCounterOverlay from '../components/EpisodeCounterOverlay.jsx'
import OutcomeFlash from '../components/OutcomeFlash.jsx'

const SCHEMA = [
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'epsilon', label: 'Epsilon (exploration)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'slip_prob', label: 'Slip probability', min: 0, max: 0.5, step: 0.01 },
  { key: 'k_bones', label: '🦴 Bones to collect (K)', min: 1, max: 5, step: 1 },
  { key: 'episodes', label: 'Episodes', min: 50, max: 2000, step: 50 },
  { key: 'max_steps', label: 'Max steps', min: 50, max: 500, step: 50 },
  { key: 'step_delay_ms', label: '👁️ Training speed (ms)', min: 0, max: 200, step: 10 },
]

const DEFAULT_PARAMS = {
  alpha: 0.1,
  gamma: 0.95,
  epsilon: 0.3,
  slip_prob: 0.1,
  k_bones: 3,
  episodes: 500,
  max_steps: 300,
  step_delay_ms: 0,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))

export default function Room5_MC() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [qHeatmap, setQHeatmap] = useState(ZERO_TABLE)
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [special, setSpecial] = useState({ bones: [], slip_cells: [], walls: [] })
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [collectedMask, setCollectedMask] = useState(0)
  const [liveAgentPos, setLiveAgentPos] = useState(null)
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)
  const [liveEpisode, setLiveEpisode] = useState(null)
  const [liveStep, setLiveStep] = useState(0)
  const [liveTotalEpisodes, setLiveTotalEpisodes] = useState(params.episodes)
  const [liveEpsilon, setLiveEpsilon] = useState(null)
  const [flashOutcome, setFlashOutcome] = useState(null)

  const sendRef = useRef(() => {})
  const flashTimeoutRef = useRef(null)

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ bones: msg.bones, slip_cells: msg.slip_cells, walls: msg.walls })
    } else if (msg.type === 'step_update') {
      setLiveAgentPos(msg.agent_pos)
      setCollectedMask(msg.bitmask ?? 0)
      if (msg.q_values) setQHeatmap(msg.q_values)
      setLiveEpisode(msg.episode)
      setLiveStep(msg.step)
      if (msg.total_episodes != null) setLiveTotalEpisodes(msg.total_episodes)
      if (msg.epsilon != null) setLiveEpsilon(msg.epsilon)
    } else if (msg.type === 'episode_end') {
      setEpisodeHistory((prev) => [...prev, { episode: msg.episode, total_reward: msg.total_reward, epsilon: msg.epsilon }])
      setFlashOutcome(msg.outcome)
      clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setFlashOutcome(null), 300)
    } else if (msg.type === 'training_complete') {
      setPolicy(msg.policy)
      setQHeatmap(msg.q_values)
      setSpecial({ bones: msg.bones, slip_cells: msg.slip_cells, walls: msg.walls })
      setStatus('complete')
      setLiveAgentPos(null)
      setLiveEpisode(null)
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
      setCollectedMask(0)
      setLiveAgentPos(null)
      setBestReward(null)
      setBestEpisode(null)
      setLiveEpisode(null)
      setFlashOutcome(null)
      setStatus('idle')
      setSpecial({ bones: msg.bones, slip_cells: msg.slip_cells, walls: msg.walls })
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

  // The exit only ends the episode once every bone is collected, so success
  // means reaching it AND holding the full bitmask - not just position.
  const fullMask = useMemo(() => (1 << params.k_bones) - 1, [params.k_bones])
  const checkSuccess = useCallback(
    (traj) => {
      const last = traj[traj.length - 1]
      return last?.pos?.[0] === 9 && last?.pos?.[1] === 9 && last?.bitmask === fullMask
    },
    [fullMask]
  )

  const onReplayStep = useCallback(
    (step) => {
      const point = trajectory[step]
      setAgentRC(point ? point.pos : [0, 0])
      setCollectedMask(point ? point.bitmask ?? 0 : 0)
    },
    [trajectory]
  )

  const displayRC = liveAgentPos || agentRC
  const dogPos = useMemo(() => gridToWorld(displayRC[0], displayRC[1], 0.4), [displayRC])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.mcExplainer}>
          <strong>Monte Carlo:</strong> unlike SARSA and Q-Learning which update after
          every step, חיזקי plays the full episode first, then looks back at the
          complete trajectory to update Q-values from the actual returns seen.
          Watch: he plays randomly at first, then improves episode by episode!
        </div>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'complete' && <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />}
        <RewardChart data={episodeHistory} xKey="episode" yKey="total_reward" title="Reward per episode" />
        <RewardChart data={episodeHistory} xKey="episode" yKey="epsilon" title="Epsilon decay" color="#ffaa00" />
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} checkSuccess={checkSuccess} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <GridWorld3D
              vTable={qHeatmap}
              policy={status === 'complete' ? policy : null}
              walls={special.walls}
              vents={special.slip_cells}
              treats={special.bones}
              treatsCollectedMask={collectedMask}
            />
            <DogModel position={dogPos} />
          </Scene3D>
          <OutcomeFlash outcome={flashOutcome} />
          {status === 'training' && (
            <EpisodeCounterOverlay
              episode={liveEpisode}
              totalEpisodes={liveTotalEpisodes}
              step={liveStep}
              epsilon={liveEpsilon}
            />
          )}
        </div>
        <div style={styles.heatmapWrap}>
          <QValueHeatmap
            table={qHeatmap}
            special={{ vents: special.slip_cells, walls: special.walls }}
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
  mcExplainer: {
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
  heatmapWrap: {
    width: '300px',
    padding: '14px',
  },
}
