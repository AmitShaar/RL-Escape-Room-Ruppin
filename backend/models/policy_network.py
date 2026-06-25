import torch.nn as nn


class PolicyNetwork(nn.Module):
    """Outputs raw logits over actions; callers apply softmax themselves
    (kept separate so training code can use log_softmax directly for
    numerically stable log-probabilities)."""

    def __init__(self, state_dim=100, action_dim=4, hidden=64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, action_dim),
        )

    def forward(self, x):
        return self.net(x)
