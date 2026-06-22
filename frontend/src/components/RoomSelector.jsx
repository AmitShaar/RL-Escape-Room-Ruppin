const ROOMS = [
  { id: 1, name: 'Sonar Mapping', algo: 'Value Iteration' },
  { id: 2, name: 'Ocean Currents', algo: 'SARSA' },
  { id: 3, name: 'Treasure Hunt', algo: 'Q-Learning' },
  { id: 4, name: 'Deep Trench', algo: 'DQN' },
  { id: 5, name: 'The Storm', algo: 'DQN + Obstacles', bonus: true },
]

export default function RoomSelector({ activeRoom, onSelect, availableRooms }) {
  return (
    <nav style={styles.nav}>
      <div style={styles.title}>🌊 Deep Sea RL</div>
      <div style={styles.tabs}>
        {ROOMS.map((room) => {
          const available = availableRooms.includes(room.id)
          const isActive = activeRoom === room.id
          return (
            <button
              key={room.id}
              disabled={!available}
              onClick={() => available && onSelect(room.id)}
              style={{
                ...styles.tab,
                ...(isActive ? styles.tabActive : {}),
                ...(available ? {} : styles.tabDisabled),
              }}
            >
              <span style={styles.tabNum}>{room.id}</span>
              <span>
                {room.name}
                {room.bonus ? ' ★' : ''}
              </span>
              <span style={styles.tabAlgo}>{room.algo}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

const styles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '10px 20px',
    background: '#04162c',
    borderBottom: '1px solid #103252',
  },
  title: {
    fontWeight: 700,
    fontSize: '18px',
    color: '#7fd9ff',
    whiteSpace: 'nowrap',
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  tab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '6px 12px',
    background: '#0a2a4a',
    border: '1px solid #1a4a6a',
    borderRadius: '6px',
    color: '#d7ecff',
    fontSize: '12px',
  },
  tabActive: {
    background: '#00ffaa22',
    border: '1px solid #00ffaa',
    color: '#00ffaa',
  },
  tabDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
  tabNum: {
    fontSize: '10px',
    opacity: 0.7,
  },
  tabAlgo: {
    fontSize: '10px',
    opacity: 0.6,
  },
}
