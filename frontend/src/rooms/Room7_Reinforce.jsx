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
import ReplayRewardOverlay from '../components/ReplayRewardOverlay.jsx'

const SCHEMA = [
  { key: 'learning_rate', label: 'Learning rate', min: 0.001, max: 0.1, step: 0.001 },
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'episodes', label: 'Episodes', min: 50, max: 2000, step: 50 },
  { key: 'max_steps', label: 'Max steps', min: 50, max: 500, step: 50 },
  { key: 'step_delay_ms', label: '👁️ Training speed (ms)', min: 0, max: 200, step: 10 },
]

const DEFAULT_PARAMS = {
  learning_rate: 0.01,
  gamma: 0.95,
  episodes: 200,
  max_steps: 200,
  step_delay_ms: 0,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))
const UNIFORM_PROBS = [0.25, 0.25, 0.25, 0.25]
const ACTION_LABELS = ['⬆ UP', '⬇ DOWN', '⬅ LEFT', '➡ RIGHT']

function ActionProbBars({ probs }) {
  return (
    <div style={styles.probWrap}>
      <h4 style={styles.probTitle}>חיזקי's action probabilities (live)</h4>
      {ACTION_LABELS.map((label, i) => {
        const pct = Math.round(probs[i] * 100)
        const confident = probs[i] > 0.7
        return (
          <div key={label} style={styles.probRow}>
            <span style={styles.probLabel}>{label}</span>
            <div style={styles.probTrack}>
              <div style={{ ...styles.probFill, width: `${pct}%`, background: confident ? '#00ffaa' : '#4499ff' }} />
            </div>
            <span style={styles.probPct}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

export default function Room7_Reinforce() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [confidence, setConfidence] = useState(ZERO_TABLE)
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [special, setSpecial] = useState({ walls: [], vents: [] })
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [replayStepIdx, setReplayStepIdx] = useState(0)
  const [liveAgentPos, setLiveAgentPos] = useState(null)
  const [liveActionProbs, setLiveActionProbs] = useState(UNIFORM_PROBS)
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)
  const [liveEpisode, setLiveEpisode] = useState(null)
  const [liveStep, setLiveStep] = useState(0)
  const [liveTotalEpisodes, setLiveTotalEpisodes] = useState(params.episodes)
  const [flashOutcome, setFlashOutcome] = useState(null)

  const sendRef = useRef(() => {})
  const flashTimeoutRef = useRef(null)

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ walls: msg.walls, vents: msg.vents })
    } else if (msg.type === 'step_update') {
      setLiveAgentPos(msg.agent_pos)
      if (msg.action_probs) setLiveActionProbs(msg.action_probs)
      setLiveEpisode(msg.episode)
      setLiveStep(msg.step)
      if (msg.total_episodes != null) setLiveTotalEpisodes(msg.total_episodes)
    } else if (msg.type === 'episode_end') {
      setEpisodeHistory((prev) => [...prev, { episode: msg.episode, total_reward: msg.total_reward }])
      if (msg.confidence) setConfidence(msg.confidence)
      if (msg.policy) setPolicy(msg.policy)
      setFlashOutcome(msg.outcome)
      clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setFlashOutcome(null), 300)
    } else if (msg.type === 'training_complete') {
      setConfidence(msg.confidence)
      setPolicy(msg.policy)
      setSpecial({ walls: msg.walls, vents: msg.vents })
      setStatus('complete')
      setLiveAgentPos(null)
      setLiveEpisode(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
      sendRef.current({ type: 'get_replay', episode: msg.best_episode })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setConfidence(ZERO_TABLE)
      setPolicy(EMPTY_POLICY)
      setEpisodeHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setReplayStepIdx(0)
      setLiveAgentPos(null)
      setLiveActionProbs(UNIFORM_PROBS)
      setBestReward(null)
      setBestEpisode(null)
      setLiveEpisode(null)
      setFlashOutcome(null)
      setStatus('idle')
      setSpecial({ walls: msg.walls, vents: msg.vents })
    } else if (msg.type === 'error') {
      console.error('Room7 error:', msg.message)
    }
  }, [])

  const { send, connected } = useWebSocket(7, handleMessage)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setEpisodeHistory([])
    setLiveActionProbs(UNIFORM_PROBS)
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

  // No preconditions on the exit here (unlike Rooms 2/3's beacon/fragment
  // gating), so checking the final position alone is reliable.
  const checkSuccess = useCallback((traj) => {
    const last = traj[traj.length - 1]
    return last?.pos?.[0] === 9 && last?.pos?.[1] === 9
  }, [])

  const onReplayStep = useCallback(
    (step) => {
      const point = trajectory[step]
      setAgentRC(point ? point.pos : [0, 0])
      setReplayStepIdx(step)
    },
    [trajectory]
  )

  const stepReward = trajectory[replayStepIdx]?.reward ?? 0
  const cumulativeReward = useMemo(
    () => trajectory.slice(0, replayStepIdx + 1).reduce((sum, p) => sum + (p.reward || 0), 0),
    [trajectory, replayStepIdx]
  )

  const displayRC = liveAgentPos || agentRC
  const dogPos = useMemo(() => gridToWorld(displayRC[0], displayRC[1], 0.4), [displayRC])

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.explainer}>
          <strong>Policy Gradient (REINFORCE):</strong> every other room learns
          how good an action is, then acts greedily. This room learns
          probabilities directly - a tiny network maps each cell to "how
          likely is each direction", and after each full attempt, every move
          taken gets nudged up or down based on how the whole attempt turned
          out. Watch the bars below sharpen from 25%/25%/25%/25% toward
          confident choices.
        </div>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'training' && <ActionProbBars probs={liveActionProbs} />}
        {status === 'complete' && <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />}
        <RewardChart data={episodeHistory} xKey="episode" yKey="total_reward" title="Reward per episode" />
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} checkSuccess={checkSuccess} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <GridWorld3D vTable={confidence} policy={status === 'complete' ? policy : null} walls={special.walls} vents={special.vents} />
            <DogModel position={dogPos} />
          </Scene3D>
          <OutcomeFlash outcome={flashOutcome} />
          {status === 'training' && (
            <EpisodeCounterOverlay episode={liveEpisode} totalEpisodes={liveTotalEpisodes} step={liveStep} epsilon={null} />
          )}
          {status === 'complete' && trajectory.length > 0 && (
            <ReplayRewardOverlay
              step={replayStepIdx}
              totalSteps={trajectory.length - 1}
              stepReward={stepReward}
              cumulativeReward={cumulativeReward}
            />
          )}
        </div>
        <div style={styles.heatmapWrap}>
          <QValueHeatmap table={confidence} special={{ vents: special.vents, walls: special.walls, start: [0, 0], exit: [9, 9] }} label="Policy Confidence Heatmap" />
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
  probWrap: {
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '10px',
  },
  probTitle: {
    margin: '0 0 8px 4px',
    fontSize: '12px',
    color: '#7fd9ff',
  },
  probRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  probLabel: {
    fontSize: '11px',
    color: '#d7ecff',
    width: '64px',
    fontFamily: 'monospace',
  },
  probTrack: {
    flex: 1,
    height: '10px',
    background: '#0a2a4a',
    borderRadius: '5px',
    overflow: 'hidden',
  },
  probFill: {
    height: '100%',
    transition: 'width 0.15s ease-out',
  },
  probPct: {
    fontSize: '11px',
    color: '#7fd9ff',
    width: '36px',
    textAlign: 'right',
    fontFamily: 'monospace',
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
