import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import QValueHeatmap from '../components/QValueHeatmap.jsx'
import EpisodeReplay from '../components/EpisodeReplay.jsx'
import Scene3D from '../components/Scene3D.jsx'
import GridWorld3D, { gridToWorld } from '../components/GridWorld3D.jsx'
import { Text } from '@react-three/drei'
import DogModel from '../components/DogModel.jsx'
import BestResultPanel from '../components/BestResultPanel.jsx'
import TrainingStatusBanner from '../components/TrainingStatusBanner.jsx'
import EpisodeCounterOverlay from '../components/EpisodeCounterOverlay.jsx'
import OutcomeFlash from '../components/OutcomeFlash.jsx'
import ReplayRewardOverlay from '../components/ReplayRewardOverlay.jsx'

// Trimmed to the 6 controls that matter day-to-day; slip/beacon-count/
// reward values and epsilon_decay stay fixed at sensible defaults below
// instead of being exposed (still sent to the backend unchanged, so
// training behavior is identical to before - just not user-editable).
const SCHEMA = [
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'epsilon', label: 'Epsilon (exploration)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'episodes', label: 'Episodes', min: 50, max: 5000, step: 50 },
  { key: 'max_steps', label: 'Max steps', min: 50, max: 1000, step: 10 },
  { key: 'step_delay_ms', label: 'Training animation speed (ms)', min: 0, max: 200, step: 10 },
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
  exit_reward: 100,
  beacon_reward: 20,
  trap_reward: -15,
  step_penalty: -0.1,
  step_delay_ms: 0,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))

function SpinningNumber({ position, number, collected }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 1.5
  })
  return (
    <group ref={ref} position={position}>
      <Text
        fontSize={0.38}
        color="white"
        outlineWidth={0.06}
        outlineColor="black"
        anchorX="center"
        anchorY="middle"
        opacity={collected ? 0.3 : 1}
      >
        {String(number)}
      </Text>
    </group>
  )
}
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))

export default function Room2_SARSA() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [qHeatmap, setQHeatmap] = useState(ZERO_TABLE)
  const [qHeatmapAll, setQHeatmapAll] = useState(null)   // all visited-count slices
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [special, setSpecial] = useState({ beacons: [], slip_cells: [], traps: [] })
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [visitedCount, setVisitedCount] = useState(0)
  const [liveAgentPos, setLiveAgentPos] = useState(null)
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)
  const [liveEpisode, setLiveEpisode] = useState(null)
  const [liveStep, setLiveStep] = useState(0)
  const [liveTotalEpisodes, setLiveTotalEpisodes] = useState(params.episodes)
  const [liveEpsilon, setLiveEpsilon] = useState(null)
  const [flashOutcome, setFlashOutcome] = useState(null)
  const [replayStepIdx, setReplayStepIdx] = useState(0)

  const sendRef = useRef(() => {})
  const flashTimeoutRef = useRef(null)

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ beacons: msg.beacons, slip_cells: msg.slip_cells, traps: msg.traps })
    } else if (msg.type === 'step_update') {
      setLiveAgentPos(msg.agent_pos)
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
      if (msg.q_values_all) setQHeatmapAll(msg.q_values_all)
      setSpecial({ beacons: msg.beacons, slip_cells: msg.slip_cells, traps: msg.traps })
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
      setQHeatmapAll(null)
      setPolicy(EMPTY_POLICY)
      setEpisodeHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setVisitedCount(0)
      setLiveAgentPos(null)
      setBestReward(null)
      setBestEpisode(null)
      setLiveEpisode(null)
      setFlashOutcome(null)
      setReplayStepIdx(0)
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

  // Room 2's exit cell only ends the episode once all beacons are collected
  // in order, so checking position alone can't tell success from "just
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
      setVisitedCount(point ? point.visited : 0)
      setReplayStepIdx(step)
    },
    [trajectory]
  )

  const displayRC = liveAgentPos || agentRC
  const dogPos = useMemo(() => gridToWorld(displayRC[0], displayRC[1], 0.4), [displayRC])

  // During replay: show the Q-slice matching the current beacon-collection
  // state so the heatmap updates live as Hizki collects beacons.
  const displayedQHeatmap = useMemo(() => {
    if (qHeatmapAll && qHeatmapAll[visitedCount]) return qHeatmapAll[visitedCount]
    return qHeatmap
  }, [qHeatmapAll, visitedCount, qHeatmap])
  const heatmapLabel = qHeatmapAll
    ? `max Q(s,a) — ${visitedCount} / ${qHeatmapAll.length - 1} beacons collected`
    : 'max Q(s,a) Heatmap'

  // Live-updating reward readout while scrubbing/playing the best-episode
  // replay: the step reward at the current frame, plus the running sum
  // from the start of the trajectory up to (and including) that frame.
  const stepReward = trajectory[replayStepIdx]?.reward ?? 0
  const cumulativeReward = useMemo(
    () => trajectory.slice(0, replayStepIdx + 1).reduce((sum, p) => sum + (p.reward || 0), 0),
    [trajectory, replayStepIdx]
  )

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
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} checkSuccess={checkSuccess} />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <GridWorld3D
              vTable={displayedQHeatmap}
              policy={status === 'complete' ? policy : null}
              vents={special.slip_cells}
              traps={special.traps}
              beacons={special.beacons}
              beaconsVisitedCount={visitedCount}
            />
            <DogModel position={dogPos} />
            {status === 'complete' && special.beacons.map(([r, c], idx) => {
              const [x, , z] = gridToWorld(r, c, 0.5)
              return (
                <SpinningNumber
                  key={`order-${idx}`}
                  position={[x, 1.1, z]}
                  number={idx + 1}
                  collected={idx < visitedCount}
                />
              )
            })}
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
              step={replayStepIdx}
              totalSteps={trajectory.length - 1}
              stepReward={stepReward}
              cumulativeReward={cumulativeReward}
            />
          )}
        </div>
        <div style={styles.heatmapWrap}>
          <QValueHeatmap
            table={displayedQHeatmap}
            special={{ vents: special.slip_cells, traps: special.traps, bonuses: special.beacons, start: [0, 0], exit: [9, 9] }}
            label={heatmapLabel}
            labelOverrides={{ bonus: 'Key' }}
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
    position: 'relative',
  },
  heatmapWrap: {
    width: '300px',
    padding: '14px',
  },
}
