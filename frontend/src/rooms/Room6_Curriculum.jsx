import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useWebSocket } from '../hooks/useWebSocket.js'
import HyperparamPanel from '../components/HyperparamPanel.jsx'
import TrainingControls from '../components/TrainingControls.jsx'
import RewardChart from '../components/RewardChart.jsx'
import EpisodeReplay from '../components/EpisodeReplay.jsx'
import Scene3D from '../components/Scene3D.jsx'
import GrowingGridWorld3D, { gridToWorld } from '../components/GrowingGridWorld3D.jsx'
import DogModel from '../components/DogModel.jsx'
import TrainingStatusBanner from '../components/TrainingStatusBanner.jsx'
import EpisodeCounterOverlay from '../components/EpisodeCounterOverlay.jsx'
import OutcomeFlash from '../components/OutcomeFlash.jsx'
import ReplayRewardOverlay from '../components/ReplayRewardOverlay.jsx'

// Mirrors backend/rooms/room6_curriculum.py's STAGES - needed on the
// frontend too, to know where each stage's episodes fall in the global
// episode count for the reward chart's stage-divider lines/regions.
const STAGES = [
  { size: 4, label: 'Stage 1: 4×4', episodes: 100 },
  { size: 6, label: 'Stage 2: 6×6', episodes: 150 },
  { size: 10, label: 'Stage 3: 10×10', episodes: 250 },
]
const TOTAL_EPISODES = STAGES.reduce((sum, s) => sum + s.episodes, 0)
const STAGE_BOUNDARIES = [STAGES[0].episodes, STAGES[0].episodes + STAGES[1].episodes]
const STAGE_REGION_COLORS = ['#7fd9ff', '#4499ff', '#0a2a4a']

const SCHEMA = [
  { key: 'alpha', label: 'Alpha (learning rate)', min: 0.01, max: 1.0, step: 0.01 },
  { key: 'gamma', label: 'Gamma (discount)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'epsilon', label: 'Epsilon (start)', min: 0.1, max: 1.0, step: 0.01 },
  { key: 'step_delay_ms', label: '👁️ Training speed (ms)', min: 0, max: 200, step: 10 },
]

const DEFAULT_PARAMS = {
  alpha: 0.1,
  gamma: 0.95,
  epsilon: 0.3,
  step_delay_ms: 0,
}

function makeZeroTable(n) {
  return Array.from({ length: n }, () => Array(n).fill(0))
}

function StageIndicator({ stageIdx, stageLabel }) {
  return (
    <div style={styles.stageIndicator}>
      <span style={styles.stageLabel}>{stageLabel}</span>
      <div style={styles.stageDots}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              ...styles.dot,
              background: i < stageIdx ? '#00ffaa' : i === stageIdx ? '#7dd3fc' : '#1a3a5c',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default function Room6_Curriculum() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [stageIdx, setStageIdx] = useState(0)
  const [stageLabel, setStageLabel] = useState(STAGES[0].label)
  const [size, setSize] = useState(STAGES[0].size)
  const [qHeatmap, setQHeatmap] = useState(makeZeroTable(STAGES[0].size))
  const [policy, setPolicy] = useState(null)
  const [special, setSpecial] = useState({ walls: [], start: [0, 0], exit: [STAGES[0].size - 1, STAGES[0].size - 1] })
  const [episodeHistory, setEpisodeHistory] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [replayStepIdx, setReplayStepIdx] = useState(0)
  const [liveAgentPos, setLiveAgentPos] = useState(null)
  const [liveEpisode, setLiveEpisode] = useState(null)
  const [liveStep, setLiveStep] = useState(0)
  const [liveEpsilon, setLiveEpsilon] = useState(null)
  const [flashOutcome, setFlashOutcome] = useState(null)
  const [stageFlash, setStageFlash] = useState(null)
  const [stagesCompleted, setStagesCompleted] = useState(null)

  const sendRef = useRef(() => {})
  const flashTimeoutRef = useRef(null)
  const stageFlashTimeoutRef = useRef(null)

  const applyMapInfo = useCallback((msg) => {
    if (msg.size != null) setSize(msg.size)
    setSpecial({ walls: msg.walls || [], start: msg.start || [0, 0], exit: msg.exit || [(msg.size || 10) - 1, (msg.size || 10) - 1] })
  }, [])

  const handleMessage = useCallback(
    (msg) => {
      if (msg.type === 'room_info') {
        setStageIdx(msg.stage ?? 0)
        setStageLabel(msg.stage_label ?? STAGES[0].label)
        applyMapInfo(msg)
        setQHeatmap(makeZeroTable(msg.size ?? STAGES[0].size))
      } else if (msg.type === 'stage_start') {
        setStageIdx(msg.stage)
        setStageLabel(msg.stage_label)
        applyMapInfo(msg)
        setQHeatmap(makeZeroTable(msg.size))
        setPolicy(null)
        setLiveAgentPos(null)
        if (msg.stage > 0) {
          setStageFlash(msg.stage_label)
          clearTimeout(stageFlashTimeoutRef.current)
          stageFlashTimeoutRef.current = setTimeout(() => setStageFlash(null), 2000)
        }
      } else if (msg.type === 'step_update') {
        setLiveAgentPos(msg.agent_pos)
        if (msg.q_values) setQHeatmap(msg.q_values)
        setLiveEpisode(msg.episode)
        setLiveStep(msg.step)
      } else if (msg.type === 'episode_end') {
        setEpisodeHistory((prev) => [
          ...prev,
          { global_episode: msg.global_episode, stage: msg.stage, total_reward: msg.total_reward, epsilon: msg.epsilon },
        ])
        setLiveEpsilon(msg.epsilon)
        setFlashOutcome(msg.outcome)
        clearTimeout(flashTimeoutRef.current)
        flashTimeoutRef.current = setTimeout(() => setFlashOutcome(null), 300)
      } else if (msg.type === 'training_complete') {
        setPolicy(msg.policy)
        setQHeatmap(msg.q_values)
        applyMapInfo(msg)
        setStageIdx(msg.stage ?? 2)
        setStageLabel(msg.stage_label ?? STAGES[2].label)
        setStagesCompleted(msg.stages_completed)
        setStatus('complete')
        setLiveAgentPos(null)
        setLiveEpisode(null)
        sendRef.current({ type: 'get_replay', episode: TOTAL_EPISODES - 1 })
      } else if (msg.type === 'replay_data') {
        setTrajectory(msg.trajectory || [])
      } else if (msg.type === 'reset_complete') {
        setStageIdx(msg.stage ?? 0)
        setStageLabel(msg.stage_label ?? STAGES[0].label)
        applyMapInfo(msg)
        setQHeatmap(makeZeroTable(msg.size ?? STAGES[0].size))
        setPolicy(null)
        setEpisodeHistory([])
        setTrajectory([])
        setAgentRC([0, 0])
        setReplayStepIdx(0)
        setLiveAgentPos(null)
        setLiveEpisode(null)
        setFlashOutcome(null)
        setStageFlash(null)
        setStagesCompleted(null)
        setStatus('idle')
      } else if (msg.type === 'error') {
        console.error('Room6 error:', msg.message)
      }
    },
    [applyMapInfo]
  )

  const { send, connected } = useWebSocket(5, handleMessage)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const onParamChange = (key, value) => setParams((p) => ({ ...p, [key]: value }))

  const onStart = () => {
    setEpisodeHistory([])
    setStagesCompleted(null)
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

  // The replay is always fetched for the final (stage-3) episode, so the
  // exit cell currently in `special` is already the right one to check
  // against - position alone is enough since stage 3 always ends on arrival.
  const checkSuccess = useCallback(
    (traj) => {
      const last = traj[traj.length - 1]
      return last?.pos?.[0] === special.exit[0] && last?.pos?.[1] === special.exit[1]
    },
    [special.exit]
  )

  const onReplayStep = useCallback(
    (step) => {
      const point = trajectory[step]
      setAgentRC(point ? point.pos : [0, 0])
      setReplayStepIdx(step)
    },
    [trajectory]
  )

  const displayRC = liveAgentPos || agentRC
  const dogPos = useMemo(() => gridToWorld(displayRC[0], displayRC[1], size, 0.4), [displayRC, size])

  // Live-updating reward readout while scrubbing/playing the final-stage
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
        <div style={styles.explainer}>
          <strong>Curriculum Learning:</strong> חיזקי starts easy (4×4) and gradually
          faces harder challenges. Knowledge transfers between stages — the Q-table
          grows with the grid! Watch how quickly חיזקי masters each new size.
        </div>
        <StageIndicator stageIdx={stageIdx} stageLabel={stageLabel} />
        <HyperparamPanel schema={SCHEMA} values={params} onChange={onParamChange} disabled={status === 'training'} />
        <TrainingControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onReset={onReset} />
        <div style={styles.connStatus}>WS: {connected ? 'connected' : 'disconnected'}</div>
        <TrainingStatusBanner status={status} />
        {status === 'complete' && (
          <div style={styles.resultPanel}>
            <div style={styles.resultTitle}>Training complete</div>
            <div>Stages completed: {stagesCompleted} / 3</div>
            <div>Final grid size: {size}×{size}</div>
          </div>
        )}
        <div style={styles.chartWrap}>
          <h4 style={styles.chartTitle}>Reward per episode (all stages)</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={episodeHistory} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#103252" strokeDasharray="3 3" />
              <ReferenceArea x1={0} x2={STAGE_BOUNDARIES[0]} fill={STAGE_REGION_COLORS[0]} fillOpacity={0.06} />
              <ReferenceArea x1={STAGE_BOUNDARIES[0]} x2={STAGE_BOUNDARIES[1]} fill={STAGE_REGION_COLORS[1]} fillOpacity={0.08} />
              <ReferenceArea x1={STAGE_BOUNDARIES[1]} x2={TOTAL_EPISODES} fill={STAGE_REGION_COLORS[2]} fillOpacity={0.18} />
              <ReferenceLine x={STAGE_BOUNDARIES[0]} stroke="#7dd3fc" strokeDasharray="4 2" label={{ value: '→ 6×6', fill: '#7dd3fc', fontSize: 10, position: 'top' }} />
              <ReferenceLine x={STAGE_BOUNDARIES[1]} stroke="#00ffaa" strokeDasharray="4 2" label={{ value: '→ 10×10', fill: '#00ffaa', fontSize: 10, position: 'top' }} />
              <XAxis dataKey="global_episode" stroke="#5a8fb0" fontSize={11} />
              <YAxis stroke="#5a8fb0" fontSize={11} />
              <Tooltip contentStyle={{ background: '#04162c', border: '1px solid #1a4a6a' }} />
              <Line type="monotone" dataKey="total_reward" stroke="#00ffaa" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <RewardChart data={episodeHistory} xKey="global_episode" yKey="epsilon" title="Epsilon decay" color="#ffaa00" />
        <EpisodeReplay
          trajectory={trajectory}
          onStepChange={onReplayStep}
          checkSuccess={checkSuccess}
          title="Replay חיזקי's final (Stage 3) run"
        />
      </aside>

      <main style={styles.main}>
        <div style={styles.sceneWrap}>
          <Scene3D>
            <GrowingGridWorld3D size={size} vTable={qHeatmap} policy={status === 'complete' ? policy : null} walls={special.walls} start={special.start} exit={special.exit} />
            <DogModel position={dogPos} />
          </Scene3D>
          <OutcomeFlash outcome={flashOutcome} />
          {status === 'training' && (
            <EpisodeCounterOverlay
              episode={liveEpisode}
              totalEpisodes={STAGES[stageIdx]?.episodes ?? 0}
              step={liveStep}
              epsilon={liveEpsilon}
            />
          )}
          {stageFlash && (
            <div style={styles.stageFlashBanner}>Grid grew → {stageFlash}!</div>
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
  stageIndicator: {
    background: '#06192e',
    border: '1px solid #103252',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#7dd3fc',
  },
  stageDots: {
    display: 'flex',
    gap: '6px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  connStatus: {
    fontSize: '11px',
    opacity: 0.6,
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
  chartWrap: {
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
  stageFlashBanner: {
    position: 'absolute',
    top: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,255,170,0.18)',
    border: '1px solid #00ffaa',
    color: '#00ffaa',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 600,
    pointerEvents: 'none',
    zIndex: 6,
  },
}
