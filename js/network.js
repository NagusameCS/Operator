/* ===== PEERJS NETWORKING / PARTY SYSTEM ===== */

class Network {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> connection
        this.isHost = false;
        this.partyCode = '';
        this.playerId = randomId();
        this.playerName = 'Player';
        this.players = new Map(); // playerId -> { name, team, ready, peerId }
        this.onMessage = null;
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onConnected = null;
        this.onError = null;
        this.hostConnection = null; // Client's connection to host
        this.connected = false;
        this.latency = 0;
        this.lastPing = 0;
    }

    createParty(playerName) {
        return new Promise((resolve, reject) => {
            this.playerName = playerName || 'Host';
            this.isHost = true;
            this.partyCode = generatePartyCode();
            const peerId = 'operator-' + this.partyCode.toLowerCase();

            this.peer = new Peer(peerId, {
                debug: 0,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', (id) => {
                console.log('[NET] Party created:', this.partyCode);
                this.players.set(this.playerId, {
                    name: this.playerName, team: null, ready: false,
                    peerId: id, isHost: true
                });
                this.connected = true;
                resolve(this.partyCode);
            });

            this.peer.on('connection', (conn) => {
                this.handleNewConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error('[NET] Error:', err);
                if (this.onError) this.onError(err.type);
                reject(err);
            });
        });
    }

    joinParty(partyCode, playerName) {
        return new Promise((resolve, reject) => {
            this.playerName = playerName || 'Player';
            this.isHost = false;
            this.partyCode = partyCode.toUpperCase();
            const hostPeerId = 'operator-' + this.partyCode.toLowerCase();

            this.peer = new Peer(undefined, {
                debug: 0,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            this.peer.on('open', () => {
                const conn = this.peer.connect(hostPeerId, { reliable: true });

                conn.on('open', () => {
                    this.hostConnection = conn;
                    this.connected = true;
                    // Send join message
                    this.sendToHost({
                        type: 'join',
                        playerId: this.playerId,
                        name: this.playerName
                    });
                    this.setupConnection(conn, 'host');
                    resolve(this.partyCode);
                });

                conn.on('error', (err) => {
                    console.error('[NET] Connection error:', err);
                    reject(err);
                });
            });

            this.peer.on('error', (err) => {
                console.error('[NET] Error:', err);
                if (this.onError) this.onError(err.type);
                reject(err);
            });

            // Timeout
            setTimeout(() => {
                if (!this.connected) reject(new Error('Connection timeout'));
            }, 10000);
        });
    }

    handleNewConnection(conn) {
        conn.on('open', () => {
            this.setupConnection(conn, conn.peer);
            console.log('[NET] Player connected:', conn.peer);
        });
    }

    setupConnection(conn, id) {
        this.connections.set(id, conn);

        conn.on('data', (data) => {
            this.handleMessage(data, id, conn);
        });

        conn.on('close', () => {
            this.connections.delete(id);
            // Find and remove player by peerId
            for (const [pid, player] of this.players) {
                if (player.peerId === conn.peer) {
                    this.players.delete(pid);
                    if (this.onPlayerLeave) this.onPlayerLeave(pid);
                    // Notify others
                    if (this.isHost) {
                        this.broadcastPlayerList();
                    }
                    break;
                }
            }
        });
    }

    handleMessage(data, senderId, conn) {
        if (this.isHost) {
            // Host handles messages from clients
            switch (data.type) {
                case 'join':
                    this.players.set(data.playerId, {
                        name: data.name, team: null, ready: false,
                        peerId: conn.peer, isHost: false
                    });
                    // Send current player list to new player
                    this.send(conn, {
                        type: 'player_list',
                        players: this.getPlayerListData(),
                        yourId: data.playerId
                    });
                    // Broadcast updated list to all
                    this.broadcastPlayerList();
                    if (this.onPlayerJoin) this.onPlayerJoin(data.playerId, data.name);
                    break;

                case 'team_select':
                    if (this.players.has(data.playerId)) {
                        this.players.get(data.playerId).team = data.team;
                        this.broadcastPlayerList();
                    }
                    break;

                case 'ready':
                    if (this.players.has(data.playerId)) {
                        this.players.get(data.playerId).ready = data.ready;
                        this.broadcastPlayerList();
                    }
                    break;

                case 'input':
                    // Forward to game
                    if (this.onMessage) this.onMessage(data, data.playerId);
                    break;

                case 'setup_action':
                    if (this.onMessage) this.onMessage(data, data.playerId);
                    break;

                case 'pong':
                    this.latency = Date.now() - this.lastPing;
                    break;

                default:
                    if (this.onMessage) this.onMessage(data, data.playerId);
            }
        } else {
            // Client handles messages from host
            switch (data.type) {
                case 'player_list':
                    this.players.clear();
                    for (const [id, p] of Object.entries(data.players)) {
                        this.players.set(id, p);
                    }
                    if (data.yourId) this.playerId = data.yourId;
                    if (this.onPlayerJoin) this.onPlayerJoin();
                    break;

                case 'ping':
                    this.sendToHost({ type: 'pong', time: data.time });
                    break;

                default:
                    if (this.onMessage) this.onMessage(data);
            }
        }
    }

    send(conn, data) {
        if (conn && conn.open) {
            conn.send(data);
        }
    }

    sendToHost(data) {
        if (this.hostConnection && this.hostConnection.open) {
            this.hostConnection.send(data);
        }
    }

    sendToAll(data) {
        for (const conn of this.connections.values()) {
            this.send(conn, data);
        }
    }

    broadcast(data) {
        if (this.isHost) {
            this.sendToAll(data);
        }
    }

    broadcastPlayerList() {
        this.broadcast({
            type: 'player_list',
            players: this.getPlayerListData()
        });
    }

    getPlayerListData() {
        const data = {};
        for (const [id, p] of this.players) {
            data[id] = { ...p };
        }
        return data;
    }

    sendInput(action) {
        const msg = { type: 'input', playerId: this.playerId, action };
        if (this.isHost) {
            if (this.onMessage) this.onMessage(msg, this.playerId);
        } else {
            this.sendToHost(msg);
        }
    }

    sendSetupAction(action) {
        const msg = { type: 'setup_action', playerId: this.playerId, ...action };
        if (this.isHost) {
            if (this.onMessage) this.onMessage(msg, this.playerId);
        } else {
            this.sendToHost(msg);
        }
    }

    setTeam(team) {
        if (this.isHost) {
            this.players.get(this.playerId).team = team;
            this.broadcastPlayerList();
            if (this.onPlayerJoin) this.onPlayerJoin();
        } else {
            this.sendToHost({ type: 'team_select', playerId: this.playerId, team });
        }
    }

    setReady(ready) {
        if (this.isHost) {
            this.players.get(this.playerId).ready = ready;
            this.broadcastPlayerList();
            if (this.onPlayerJoin) this.onPlayerJoin();
        } else {
            this.sendToHost({ type: 'ready', playerId: this.playerId, ready });
        }
    }

    getMyTeam() {
        const me = this.players.get(this.playerId);
        return me ? me.team : null;
    }

    allPlayersReady() {
        if (this.players.size < 1) return false;
        let allReady = true;
        let hasSwat = false, hasTerrorist = false;
        for (const p of this.players.values()) {
            if (!p.ready) allReady = false;
            if (p.team === 'swat') hasSwat = true;
            if (p.team === 'terrorist') hasTerrorist = true;
        }
        return allReady && hasSwat && hasTerrorist;
    }

    ping() {
        if (this.isHost) {
            this.lastPing = Date.now();
            this.sendToAll({ type: 'ping', time: this.lastPing });
        }
    }

    disconnect() {
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections.clear();
        this.players.clear();
        this.connected = false;
    }
}
