import { useState } from 'react'
import RoomSelector from './components/RoomSelector.jsx'
import Room1_DP from './rooms/Room1_DP.jsx'
import Room2_SARSA from './rooms/Room2_SARSA.jsx'
import Room3_QLearning from './rooms/Room3_QLearning.jsx'
import Room4_DQN from './rooms/Room4_DQN.jsx'
import Room5_Obstacles from './rooms/Room5_Obstacles.jsx'

const AVAILABLE_ROOMS = [1, 2, 3, 4, 5]

export default function App() {
  const [activeRoom, setActiveRoom] = useState(1)

  return (
    <div style={styles.app}>
      <RoomSelector activeRoom={activeRoom} onSelect={setActiveRoom} availableRooms={AVAILABLE_ROOMS} />
      <div style={styles.content}>
        {activeRoom === 1 && <Room1_DP />}
        {activeRoom === 2 && <Room2_SARSA />}
        {activeRoom === 3 && <Room3_QLearning />}
        {activeRoom === 4 && <Room4_DQN />}
        {activeRoom === 5 && <Room5_Obstacles />}
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
  content: {
    flex: 1,
    minHeight: 0,
  },
}
