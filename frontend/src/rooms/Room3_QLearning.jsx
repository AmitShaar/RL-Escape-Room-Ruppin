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
import XMark3D from '../components/XMark3D.jsx'

// Trimmed to the 6 controls that matter day-to-day; fragment/shark counts
// and reward values plus epsilon_decay stay fixed at sensible defaults
// below instead of being exposed (still sent to the backend unchanged,
// so training behavior is identical to before - just not user-editable).
const SCHEMA = [
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'epsilon', label: 'Epsilon (exploration)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'epsilon_decay', label: 'Epsilon decay', min: 0.9, max: 0.999, step: 0.001 },
  { key: 'episodes', label: 'Episodes', min: 50, max: 5000, step: 50 },
  { key: 'max_steps', label: 'Max steps', min: 50, max: 1000, step: 10 },
  { key: 'M_fragments', label: 'Num fragments', min: 1, max: 5, step: 1 },
  { key: 'shark_speed', label: 'X speed (steps/move)', min: 1, max: 10, step: 1 },
  { key: 'fragment_reward', label: 'Fragment reward', min: 5, max: 50, step: 5 },
  { key: 'shark_penalty', label: 'X hit penalty', min: -50, max: -5, step: 5 },
  { key: 'exit_reward', label: 'Exit reward', min: 50, max: 200, step: 10 },
  { key: 'step_delay_ms', label: 'Training animation speed (ms)', min: 0, max: 200, step: 10 },
]

const DEFAULT_PARAMS = {
  alpha: 0.1,
  gamma: 0.95,
  epsilon: 0.2,
  epsilon_decay: 0.995,
  episodes: 500,
  max_steps: 300,
  M_fragments: 3,
  shark_speed: 3,
  exit_reward: 100,
  fragment_reward: 15,
  shark_penalty: -25,
  step_penalty: -0.1,
  step_delay_ms: 0,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))

function sharkPosAtStep(patrol, shark_speed, step) {
  if (!patrol || patrol.length === 0) return null
  const idx = Math.floor(step / shark_speed) % patrol.length
  return patrol[idx]
}

export default function Room3_QLearning() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [qHeatmap, setQHeatmap] = useState(ZERO_TABLE)
  const [qHeatmapAll, setQHeatmapAll] = useState(null)  // all 8 bitmask slices
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [special, setSpecial] = useState({ artifacts: [], shark_patrol: [] })
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [collectedMask, setCollectedMask] = useState(0)
  const [replayStep, setReplayStep] = useState(0)
  const [liveAgentPos, setLiveAgentPos] = useState(null)
  const [liveSharkPos, setLiveSharkPos] = useState(null)
  const [portalFirstEpisode, setPortalFirstEpisode] = useState(null)
  const [bestPortal, setBestPortal] = useState(null)
  const [bestPortalDest, setBestPortalDest] = useState(null)
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
      setSpecial({ artifacts: msg.artifacts, shark_patrol: msg.shark_patrol })
    } else if (msg.type === 'step_update') {
      setLiveAgentPos(msg.agent_pos)
      setLiveSharkPos(msg.shark_pos)
      if (msg.q_values) setQHeatmap(msg.q_values)
      setLiveEpisode(msg.episode)
      setLiveStep(msg.step)
      if (msg.total_episodes != null) setLiveTotalEpisodes(msg.total_episodes)
      if (msg.epsilon != null) setLiveEpsilon(msg.epsilon)
    } else if (msg.type === 'episode_end') {
      setEpisodeHistory((prev) => [...prev, { episode: msg.episode, total_reward: msg.total_reward, epsilon: msg.epsilon, success: msg.success }])
      setFlashOutcome(msg.outcome)
      clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setFlashOutcome(null), 300)
    } else if (msg.type === 'training_complete') {
      setPolicy(msg.policy)
      setQHeatmap(msg.q_values)
      if (msg.q_values_all) setQHeatmapAll(msg.q_values_all)
      setSpecial({ artifacts: msg.artifacts, shark_patrol: msg.shark_patrol })
      setPortalFirstEpisode(msg.portal_first_episode)
      setBestPortal(msg.best_portal || null)
      setBestPortalDest(msg.best_portal_dest || null)
      setStatus('complete')
      setLiveAgentPos(null)
      setLiveSharkPos(null)
      setLiveEpisode(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
      sendRef.current({ type: 'get_replay', episode: msg.best_episode })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setQHeatmap(ZERO_TABLE)
      setQHeatmapAll(null)
      setPolicy(EMPTY_POLICY)
      setEpisodeHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setCollectedMask(0)
      setReplayStep(0)
      setLiveAgentPos(null)
      setLiveSharkPos(null)
      setPortalFirstEpisode(null)
      setBestPortal(null)
      setBestPortalDest(null)
      setBestReward(null)
      setBestEpisode(null)
      setLiveEpisode(null)
      setFlashOutcome(null)
      setStatus('idle')
      setSpecial({ artifacts: msg.artifacts, shark_patrol: msg.shark_patrol })
    } else if (msg.type === 'error') {
      console.error('Room3 error:', msg.message)
    }
  }, [])

  const { send, connected } = useWebSocket(3, handleMessage)
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

  // Room 3's exit cell only ends the episode once all fragments are
  // collected, so checking position alone can't tell success from "just
  // passing through" - the big reward only fires on genuine completion.
  const checkSuccess = useCallback(
    (traj) => {
      const last = traj[traj.length - 1]
      return (last?.reward ?? 0) >= params.exit_reward
    },
    [params.exit_reward]
  )

  const onReplayStep = useCallback(
    (step) => {
      const point = trajectory[step]
      setAgentRC(point ? point.pos : [0, 0])
      const mask = point ? (point.bitmask ?? 0) : 0
      setCollectedMask(mask)
      setReplayStep(step)
      if (qHeatmapAll && qHeatmapAll[mask]) setQHeatmap(qHeatmapAll[mask])
    },
    [trajectory, qHeatmapAll]
  )

  // Heatmap label shows the binary representation of the current bitmask
  const replayBitmask = trajectory[replayStep]?.bitmask ?? 0
  const heatmapLabel = qHeatmapAll
    ? `max Q(s,a) — bitmask ${replayBitmask} (${replayBitmask.toString(2).padStart(3, '0')})`
    : 'max Q(s,a) Heatmap'

  const displayRC = liveAgentPos || agentRC
  const dogPos = useMemo(() => gridToWorld(displayRC[0], displayRC[1], 0.4), [displayRC])
  const replaySharkPos = useMemo(
    () => sharkPosAtStep(special.shark_patrol, params.shark_speed, replayStep),
    [special.shark_patrol, params.shark_speed, replayStep]
  )
  const sharkPos = liveSharkPos || replaySharkPos

  // Live-updating reward readout while scrubbing/playing the best-episode
  // replay: the step reward at the current frame, plus the running sum
  // from the start of the trajectory up to (and including) that frame.
  const stepReward = trajectory[replayStep]?.reward ?? 0
  const cumulativeReward = useMemo(
    () => trajectory.slice(0, replayStep + 1).reduce((sum, p) => sum + (p.reward || 0), 0),
    [trajectory, replayStep]
  )

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'complete' && <BestResultPanel bestReward={bestReward} bestEpisode={bestEpisode} params={params} />}
        {portalFirstEpisode != null && (
          <div style={styles.badge}>Portal first used at episode {portalFirstEpisode}</div>
        )}
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
              artifacts={special.artifacts}
              collectedMask={collectedMask}
              sharkPos={null}
            />
            <DogModel position={dogPos} />
            {sharkPos && (() => {
              const [sx, , sz] = gridToWorld(sharkPos[0], sharkPos[1], 0.35)
              return <XMark3D position={[sx, 0.35, sz]} />
            })()}
            {bestPortal && (
              <mesh position={gridToWorld(bestPortal[0], bestPortal[1], 0.45)}>
                <sphereGeometry args={[0.22, 14, 10]} />
                <meshStandardMaterial color="#aa44ff" emissive="#aa44ff" emissiveIntensity={1.5} transparent opacity={0.85} />
              </mesh>
            )}
            {bestPortalDest && (
              <mesh position={gridToWorld(bestPortalDest[0], bestPortalDest[1], 0.45)}>
                <sphereGeometry args={[0.18, 14, 10]} />
                <meshStandardMaterial color="#dd88ff" emissive="#dd88ff" emissiveIntensity={1.0} transparent opacity={0.7} />
              </mesh>
            )}
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
          {status === 'complete' && trajectory.length > 0 && (
            <ReplayRewardOverlay
              step={replayStep}
              totalSteps={trajectory.length - 1}
              stepReward={stepReward}
              cumulativeReward={cumulativeReward}
            />
          )}
        </div>
        <div style={styles.heatmapWrap}>
          <QValueHeatmap
            table={qHeatmap}
            special={{ bonuses: special.artifacts, traps: special.shark_patrol, start: [0, 0], exit: [9, 9], portal: bestPortal, portalDest: bestPortalDest }}
            label={heatmapLabel}
            labelOverrides={{ trap: 'X חוסם — מסלול (−)' }}
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
  badge: {
    background: '#aaff4422',
    border: '1px solid #aaff44',
    color: '#aaff44',
    fontSize: '11px',
    padding: '6px 10px',
    borderRadius: '6px',
  },
  insight: {
    fontSize: '11px',
    opacity: 0.8,
    lineHeight: 1.4,
    padding: '0 2px',
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
