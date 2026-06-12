import sys
import os
import time
import json
import random
import socket
class DefensiveStateEnv:
    def __init__(self):
        self.action_space = ['OBSERVE', 'DECEPTIVE_PROBE', 'ESCALATE', 'NEUTRALISE', 'ISOLATE']
    def sample_state(self):
        return {
            'anomaly_score': random.random(),
            'decoy_tripped': random.randint(0, 1),
            'network_entropy': random.random(),
            'cpu_pct': random.random(),
            'auth_failure_rate': random.random(),
            'lateral_movement': random.random(),
            'time_since_alert': random.random(),
            'active_connections': random.random()
        }
    def compute_reward(self, action, state, outcome):
        reward = 0.0
        if action == 'ISOLATE' and state['decoy_tripped'] == 0 and state['anomaly_score'] < 0.7:
            reward = -500.0
        elif action == 'ISOLATE' and state['decoy_tripped'] == 1:
            reward = 300.0
        elif action == 'NEUTRALISE' and outcome.get('threat_eradicated'):
            reward = 500.0
        elif action == 'DECEPTIVE_PROBE' and outcome.get('probe_successful'):
            reward = 100.0
        elif action == 'OBSERVE' and state['anomaly_score'] > 0.8:
            reward = -200.0
        return reward
class SimplePPOAgent:
    def __init__(self, state_dim=8, action_dim=5, lr=0.01):
        self.action_dim = action_dim
        self.lr = lr
        self.weights = [[random.gauss(0, 0.1) for _ in range(action_dim)] for _ in range(state_dim)]
    def select_action(self, state_vector, epsilon=0.1):
        if random.random() < epsilon:
            return random.randint(0, self.action_dim - 1)
        scores = [0] * self.action_dim
        for a in range(self.action_dim):
            for f in range(len(state_vector)):
                scores[a] += state_vector[f] * self.weights[f][a]
        max_idx = 0
        for i in range(1, self.action_dim):
            if scores[i] > scores[max_idx]:
                max_idx = i
        return max_idx
    def update_weights(self, state_vector, action_idx, reward):
        for f in range(len(state_vector)):
            self.weights[f][action_idx] += self.lr * reward * state_vector[f]
def live_fire_matrix():
    print("[*] Launching Defensive Reinforcement Training Loop (live_fire_matrix)...")
    env = DefensiveStateEnv()
    agent = SimplePPOAgent(state_dim=8, action_dim=5)
    
    # Run a simple training loop for 100 steps
    for step in range(100):
        state_dict = env.sample_state()
        state_vector = [
            state_dict['anomaly_score'],
            state_dict['decoy_tripped'],
            state_dict['network_entropy'],
            state_dict['cpu_pct'],
            state_dict['auth_failure_rate'],
            state_dict['lateral_movement'],
            state_dict['time_since_alert'],
            state_dict['active_connections']
        ]
        action_idx = agent.select_action(state_vector)
        action = env.action_space[action_idx]
        
        # Simulate outcome
        outcome = {
            'threat_eradicated': random.choice([True, False]),
            'probe_successful': random.choice([True, False])
        }
        
        reward = env.compute_reward(action, state_dict, outcome)
        agent.update_weights(state_vector, action_idx, reward)
        
        if step % 20 == 0:
            print(f"Step {step}: Action={action}, Reward={reward:.2f}")
            
    print("[+] Training completed successfully.")

if __name__ == "__main__":
    exec_mode = os.environ.get("BAYEZID_EXECUTION_MODE", "SIMULATION").upper()
    
    if exec_mode == "LIVE_FIRE":
        print("[+] PPO Agent: Absolute Symphony Native Enforcement Active (Live Fire).")
        live_fire_matrix()
    else:
        print("[+] PPO Agent: Running in SIMULATION mode.")
        live_fire_matrix()

