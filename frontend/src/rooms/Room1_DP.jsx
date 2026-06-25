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
import ReplayRewardOverlay from '../components/ReplayRewardOverlay.jsx'

// Trimmed to the 7 controls that actually matter to the user (rewards,
// slip, gamma); environment complexity (walls/vents/traps/treat & hole
// counts, theta, trap penalty, step cost) stays fixed at the backend's
// existing defaults instead of being exposed here.
const SCHEMA = [
  { key: 'gamma', label: 'γ (gamma)', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'slip_prob', label: 'Slip probability', min: 0, max: 0.5, step: 0.01 },
  { key: 'treat_reward', label: '🦴 Treat reward', min: 1, max: 20, step: 1 },
  { key: 'hole_penalty', label: '🕳️ Black hole penalty', min: -30, max: -1, step: 1 },
  { key: 'bone_reward', label: '🦴 Bone reward (exit)', min: 10, max: 200, step: 10 },
  { key: 'replay_episodes', label: 'Episodes (replay)', min: 1, max: 10, step: 1 },
  { key: 'max_steps', label: 'Max steps', min: 50, max: 500, step: 50 },
]

const DEFAULT_PARAMS = {
  gamma: 0.95,
  slip_prob: 0.1,
  treat_reward: 5,
  hole_penalty: -10,
  bone_reward: 100,
  replay_episodes: 1,
  max_steps: 200,
}

const ZERO_TABLE = Array.from({ length: 10 }, () => Array(10).fill(0))
const EMPTY_POLICY = Array.from({ length: 10 }, () => Array(10).fill(-1))

export default function Room1_DP() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [status, setStatus] = useState('idle')
  const [vTable, setVTable] = useState(ZERO_TABLE)
  const [policy, setPolicy] = useState(EMPTY_POLICY)
  const [deltaHistory, setDeltaHistory] = useState([])
  const [special, setSpecial] = useState({ walls: [], vents: [], traps: [], treats: [], holes: [] })
  const [trajectory, setTrajectory] = useState([])
  const [agentRC, setAgentRC] = useState([0, 0])
  const [collectedMask, setCollectedMask] = useState(0)
  const [bestReward, setBestReward] = useState(null)
  const [bestEpisode, setBestEpisode] = useState(null)
  const [currentRow, setCurrentRow] = useState(null)
  const [replayStepIdx, setReplayStepIdx] = useState(0)

  const sendRef = useRef(() => {})

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'room_info') {
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps, treats: msg.treats, holes: msg.holes })
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
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps, treats: msg.treats, holes: msg.holes })
      setStatus('complete')
      setCurrentRow(null)
      setBestReward(msg.best_reward)
      setBestEpisode(msg.best_episode)
      sendRef.current({ type: 'get_replay', episode: msg.best_episode })
    } else if (msg.type === 'replay_data') {
      setTrajectory(msg.trajectory || [])
    } else if (msg.type === 'reset_complete') {
      setVTable(ZERO_TABLE)
      setPolicy(EMPTY_POLICY)
      setDeltaHistory([])
      setTrajectory([])
      setAgentRC([0, 0])
      setCollectedMask(0)
      setBestReward(null)
      setBestEpisode(null)
      setCurrentRow(null)
      setReplayStepIdx(0)
      setStatus('idle')
      setSpecial({ walls: msg.walls, vents: msg.vents, traps: msg.traps, treats: msg.treats, holes: msg.holes })
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
    // The backend's field is still named exit_reward; bone_reward is just
    // the UI-facing name for the same value.
    send({ type: 'start_training', params: { ...params, exit_reward: params.bone_reward } })
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

  // Room 1's exit always ends the episode on arrival (no preconditions), so
  // checking the final position is reliable regardless of the configured
  // exit_reward value (unlike a reward-magnitude threshold).
  const checkSuccess = useCallback((traj) => {
    const last = traj[traj.length - 1]
    return last?.pos?.[0] === 9 && last?.pos?.[1] === 9
  }, [])

  const onReplayStep = useCallback(
    (step) => {
      const point = trajectory[step]
      setAgentRC(point ? point.pos : [0, 0])
      setCollectedMask(point ? point.bitmask ?? 0 : 0)
      setReplayStepIdx(step)
    },
    [trajectory]
  )

  const dogPos = useMemo(() => gridToWorld(agentRC[0], agentRC[1], 0.4), [agentRC])

  // Live-updating reward readout while scrubbing/playing the best-run
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
        <EpisodeReplay trajectory={trajectory} onStepChange={onReplayStep} checkSuccess={checkSuccess} />
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
              treats={special.treats}
              treatsCollectedMask={collectedMask}
              holes={special.holes}
              currentRow={currentRow}
            />
            <DogModel position={dogPos} />
          </Scene3D>
          {trajectory.length > 0 && (
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
            table={vTable}
            special={{ ...special, bonuses: special.treats, start: [0, 0], exit: [9, 9] }}
            label="V(s) Heatmap"
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
    position: 'relative',
  },
  heatmapWrap: {
    width: '300px',
    padding: '14px',
  },
}
