import RewardChart from './RewardChart.jsx'

export default function LossChart({ data }) {
  return <RewardChart data={data} xKey="step" yKey="loss" title="DQN loss (MSE)" color="#ff5577" />
}
