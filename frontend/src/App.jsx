import { useState } from 'react'
import RoomSelector from './components/RoomSelector.jsx'
import { ROOM_META } from './roomMeta.js'
import Room1_DP from './rooms/Room1_DP.jsx'
import Room2_SARSA from './rooms/Room2_SARSA.jsx'
import Room3_QLearning from './rooms/Room3_QLearning.jsx'
import Room4_DQN from './rooms/Room4_DQN.jsx'
import Room5_Curriculum from './rooms/Room6_Curriculum.jsx'

const AVAILABLE_ROOMS = [1, 2, 3, 4, 5]

function RoomSlot({ active, children }) {
  return <div style={{ ...styles.roomSlot, display: active ? 'block' : 'none' }}>{children}</div>
}

export default function App() {
  const [activeRoom, setActiveRoom] = useState(1)
  const meta = ROOM_META[activeRoom]

  return (
    <div style={styles.app}>
      <RoomSelector activeRoom={activeRoom} onSelect={setActiveRoom} availableRooms={AVAILABLE_ROOMS} />
      <div style={styles.statusBar}>
        <span>
          Room {activeRoom}: {meta.name}
        </span>
        <span style={styles.statusSep}>|</span>
        <span>Algorithm: {meta.algo}</span>
        <span style={styles.subtitle}>Follow חיזקי's journey through 5 rooms</span>
      </div>
      <div style={styles.content}>
        {/* All rooms stay mounted permanently (just hidden via CSS when
            inactive) instead of being conditionally rendered. Conditional
            rendering would unmount the inactive room's component on every
            tab switch, destroying its React state (trained results, charts,
            replay data) and closing its WebSocket - so switching tabs to
            show a different room mid-demo would silently wipe out training
            you already did. This way, state (and the live connection) only
            resets on an actual full page reload, matching what's needed to
            present results across rooms without re-training each time. */}
        <RoomSlot active={activeRoom === 1}>
          <Room1_DP />
        </RoomSlot>
        <RoomSlot active={activeRoom === 2}>
          <Room2_SARSA />
        </RoomSlot>
        <RoomSlot active={activeRoom === 3}>
          <Room3_QLearning />
        </RoomSlot>
        <RoomSlot active={activeRoom === 4}>
          <Room4_DQN />
        </RoomSlot>
        <RoomSlot active={activeRoom === 5}>
          <Room5_Curriculum />
        </RoomSlot>
      </div>
    </div>
  )
}

const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 20px',
    background: '#020e1c',
    borderBottom: '1px solid #103252',
    fontSize: '12px',
    color: '#7fd9ff',
  },
  statusSep: {
    opacity: 0.4,
  },
  subtitle: {
    marginLeft: 'auto',
    opacity: 0.6,
    fontSize: '11px',
  },
  content: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  roomSlot: {
    height: '100%',
    width: '100%',
  },
}
