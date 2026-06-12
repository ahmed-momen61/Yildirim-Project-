import torch
import torch.nn as nn
from torch_geometric.nn import SAGEConv
from fastapi import FastAPI, Request
import uvicorn

# ANSI escape codes for styling
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
RED = "\033[31m"
RESET = "\033[0m"

app = FastAPI()

class GraphSAGEOracle(nn.Module):
    def __init__(self, in_channels=16, hidden=64, out=1):
        super().__init__()
        self.conv1 = SAGEConv(in_channels, hidden)
        self.conv2 = SAGEConv(hidden, hidden)
        self.head  = nn.Linear(hidden, out)
        self.relu  = nn.ReLU()
        self.sig   = nn.Sigmoid()
    def forward(self, x, edge_index):
        x = self.relu(self.conv1(x, edge_index))
        x = self.relu(self.conv2(x, edge_index))
        return self.sig(self.head(x))

model = GraphSAGEOracle(in_channels=16)

@app.post("/api/v1/gnn/predict-lateral")
async def predict_lateral(req: Request):
    body = await req.json()
    if not body.get('nodes') or not body.get('edges'):
        print(f"{YELLOW}[🕸️] GNN Oracle: Received empty graph query.{RESET}")
        return {"risk_scores": []}
    print(f"\n{YELLOW}[🕸️] GNN Oracle: Propagating lateral movement risk across {len(body['nodes'])} nodes and {len(body['edges'])} edges...{RESET}")
    x = torch.tensor(body['nodes'], dtype=torch.float)
    ei = torch.tensor(body['edges'], dtype=torch.long).t().contiguous()
    with torch.no_grad():
        risk_scores = model(x, ei).squeeze().tolist()
    if isinstance(risk_scores, float):
        risk_scores = [risk_scores]
    print(f"{GREEN}[⚡] Risk propagation complete. Max Risk: {max(risk_scores) if risk_scores else 0.0:.3f}{RESET}\n")
    return {"risk_scores": risk_scores}

@app.post("/api/v1/native/syscall-topology")
async def analyze_syscall_topology(req: Request):
    body = await req.json()
    nodes = body.get('nodes', [])
    edges = body.get('edges', [])
    print(f"\n{CYAN}[🕸️] GNN Oracle: Analyzing native syscall topology ({len(nodes)} nodes, {len(edges)} edges)...{RESET}")
    if not nodes:
        print(f"{YELLOW}[⚠️] Empty nodes received in syscall topology.{RESET}\n")
        return {
            "risk_scores": [],
            "lateral_movement_probability": 0.0
        }
    try:
        x = torch.tensor(nodes, dtype=torch.float)
        if x.dim() == 1:
            x = x.unsqueeze(0)
        # Pad features to 16 dimensions for GraphSAGE
        if x.shape[1] < 16:
            padding = torch.zeros((x.shape[0], 16 - x.shape[1]), dtype=torch.float)
            x = torch.cat([x, padding], dim=1)
        elif x.shape[1] > 16:
            x = x[:, :16]
        # Parse edges or fallback to self-loops
        if not edges:
            num_nodes = x.shape[0]
            ei = torch.stack([torch.arange(num_nodes, dtype=torch.long), torch.arange(num_nodes, dtype=torch.long)], dim=0)
        else:
            ei = torch.tensor(edges, dtype=torch.long).t().contiguous()
        with torch.no_grad():
            risk_scores = model(x, ei).squeeze().tolist()
        if isinstance(risk_scores, float):
            risk_scores = [risk_scores]
        elif not isinstance(risk_scores, list):
            risk_scores = list(risk_scores)
        lateral_movement_probability = max(risk_scores) if risk_scores else 0.1
    except Exception as e:
        print(f"{RED}[❌] Syscall GNN computation error: {e}{RESET}")
        lateral_movement_probability = min(0.95, len(nodes) * 0.15)
        risk_scores = [lateral_movement_probability] * len(nodes)
    print(f"{GREEN}[⚡] Syscall analysis verdict complete: Lateral movement probability = {lateral_movement_probability:.3f}{RESET}\n")
    return {
        "risk_scores": risk_scores,
        "lateral_movement_probability": lateral_movement_probability
    }

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")
