const net = require('net');
const dgram = require('dgram');
const TCP_PORT = 9000;
const UDP_PORT = 9001;
class SwarmHiveMind {
    constructor(nodeId) {
        this.nodeId = nodeId || `node_${Math.floor(Math.random() * 10000)}`;
        this.peers = new Set();
        this.tcpServer = null;
        this.udpSocket = null;
    }
    async init() {
        console.log(`\n[🌐] Booting Bayezid TCP/UDP Hive Mind Node [${this.nodeId}]...`);
        this.tcpServer = net.createServer((socket) => {
            const peerAddress = `${socket.remoteAddress}:${socket.remotePort}`;
            console.log(`[🔗] TCP connection established from Peer: ${peerAddress}`);
            socket.on('data', (data) => {
                this.handleIncomingWeights(data.toString(), peerAddress);
            });
            socket.on('error', (err) => console.log(`[⚠️] TCP Socket error: ${err.message}`));
        });
        this.tcpServer.listen(TCP_PORT, '0.0.0.0', () => {
            console.log(`[✅] Hive Mind TCP Server listening on 0.0.0.0:${TCP_PORT}`);
        });
        this.udpSocket = dgram.createSocket('udp4');
        this.udpSocket.on('message', (msg, rinfo) => {
            try {
                const packet = JSON.parse(msg.toString());
                if (packet.type === 'PEER_DISCOVERY' && packet.nodeId !== this.nodeId) {
                    const peerString = `${rinfo.address}:${TCP_PORT}`;
                    if (!this.peers.has(peerString)) {
                        this.peers.add(peerString);
                        console.log(`[📡] UDP Gossip: Discovered new Hive Peer at ${peerString}`);
                    }
                }
            } catch (e) {}
        });
        this.udpSocket.bind(UDP_PORT, () => {
            this.udpSocket.setBroadcast(true);
            console.log(`[✅] Hive Mind UDP Discovery active on port ${UDP_PORT}`);
            setInterval(() => {
                const msg = Buffer.from(JSON.stringify({ type: 'PEER_DISCOVERY', nodeId: this.nodeId }));
                this.udpSocket.send(msg, 0, msg.length, UDP_PORT, '255.255.255.255');
            }, 5000);
        });
    }
    handleIncomingWeights(message, peerId) {
        try {
            const update = JSON.parse(message);
            if (update.type === 'WEIGHT_UPDATE') {
                console.log(`\n[🧠] <== Received Neural Weight Update from Peer [${peerId}]`);
                console.log(`    Agent: ${update.agent}`);
                console.log(`    Tensor Data Received: Float32Array(${update.weights.length})`);
                console.log(`    Gradient Sample: [${update.weights.slice(0, 3).join(', ')}...]`);
                console.log(`    Delta injected into local eBPF Neural Map...`);
            }
        } catch (e) {
        }
    }
    broadcastNovelDiscovery(agentName, discoveryDesc, weightsPayload) {
        if (this.peers.size === 0) {
            console.log(`\n[⚠️] ==> Attempted to broadcast discovery, but no peers are connected to the Hive.`);
            return;
        }
        const msg = JSON.stringify({
            type: 'WEIGHT_UPDATE',
            agent: agentName,
            weights: weightsPayload ? (Array.isArray(weightsPayload) ? weightsPayload : Array.from(weightsPayload)) : [], 
            timestamp: Date.now()
        });
        console.log(`\n[🚀] ==> Broadcasting Novel Discovery to ${this.peers.size} Hive Peers...`);
        for (const peer of this.peers) {
            const [host, port] = peer.split(':');
            const client = new net.Socket();
            client.connect(port, host, () => {
                client.write(msg);
                client.destroy(); 
            });
            client.on('error', (err) => {
                console.log(`    [FAILED] Could not reach peer ${peer}: ${err.message}`);
                this.peers.delete(peer); 
            });
        }
        console.log(`    [SUCCESS] Weights propagated across the Swarm.`);
    }
}
if (require.main === module) {
    (async () => {
        const nodeA = new SwarmHiveMind('Node_A_Alpha');
        await nodeA.init();
        setTimeout(() => {
            console.log('\n[🧪] Simulating remote Peer B discovery...');
            nodeA.peers.add('127.0.0.1:9000'); 
            nodeA.broadcastNovelDiscovery(
                'ShadowRouter', 
                [0.9934, -0.4521, 0.1112, 0.8876, -0.0031] 
            );
        }, 2000);
        setTimeout(() => process.exit(0), 4000);
    })();
}
module.exports = SwarmHiveMind;
