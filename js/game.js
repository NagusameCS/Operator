/* ===== GAME STATE & LOGIC ===== */

const PHASE = {
    LOBBY: 'lobby',
    SETUP: 'setup',
    ACTION: 'action',
    HALFTIME: 'halftime',
    END: 'end'
};

const SETUP_TIME = 30000;     // 30 seconds
const ACTION_TIME = 180000;   // 3 minutes
const BOMB_TIMER = 120000;    // 2 minutes
const HOSTAGE_DEATH_INTERVAL = 45000; // 45 seconds per hostage
const HOSTAGE_COUNT = 3;
const AGENTS_PER_TEAM = 5;
const STATE_SYNC_RATE = 50;   // ms between state broadcasts

class Game {
    constructor(isHost) {
        this.isHost = isHost;
        this.map = null;
        this.phase = PHASE.LOBBY;
        this.round = 1; // 1 or 2
        this.timer = 0;
        this.setupTimer = 0;

        // Agents
        this.agents = { swat: [], terrorist: [] };

        // Objectives
        this.hostages = [];
        this.bomb = null;
        this.extractionZone = null;

        // Combat
        this.bullets = [];
        this.killFeed = [];

        // Score
        this.scores = { swat: 0, terrorist: 0 };

        // Visibility (per team)
        this.visibility = { swat: null, terrorist: null };

        // AI
        this.bots = [];

        // State sync
        this.lastStateSend = 0;
        this.stateBuffer = null;

        // Phase overlay
        this.phaseOverlayTimer = 0;
        this.phaseOverlayText = '';
        this.phaseOverlaySubtext = '';

        // Hostage death tracking
        this.nextHostageDeath = 0;

        // Defuse state
        this.defusing = false;
        this.defuseProgress = 0;
        this.defuseTime = 5000; // 5 seconds to defuse

        // Rescue state
        this.rescuing = false;

        // Setup placement tracking
        this.setupPlacedHostages = 0;
        this.setupPlacedBomb = false;

        // Practice mode
        this.isPractice = false;
    }

    initMap(seed) {
        this.map = new GameMap(seed);
        this.visibility.swat = new VisibilitySystem(this.map);
        this.visibility.terrorist = new VisibilitySystem(this.map);

        // Set extraction zone near SWAT spawn
        const swatSpawn = this.map.spawnSwat[0];
        if (swatSpawn) {
            this.extractionZone = {
                x: Math.max(0, swatSpawn.x - 3),
                y: Math.max(0, swatSpawn.y - 3),
                w: 6, h: 6
            };
        }
    }

    initAgents(weaponSeed) {
        const rng = new SeededRNG(weaponSeed);
        this.agents.swat = [];
        this.agents.terrorist = [];

        for (let i = 0; i < AGENTS_PER_TEAM; i++) {
            const swatSpawn = this.map.spawnSwat[i] || this.map.spawnSwat[0];
            const terrorSpawn = this.map.spawnTerror[i] || this.map.spawnTerror[0];

            const swatAgent = new Agent(i, 'swat', swatSpawn.x, swatSpawn.y, getRandomWeapon(rng));
            const terrorAgent = new Agent(i + AGENTS_PER_TEAM, 'terrorist', terrorSpawn.x, terrorSpawn.y, getRandomWeapon(rng));

            this.agents.swat.push(swatAgent);
            this.agents.terrorist.push(terrorAgent);
        }

        // Initialize AI for all agents
        this.bots = [];
        for (const agent of [...this.agents.swat, ...this.agents.terrorist]) {
            this.bots.push(new BotAI(agent, this.map));
        }
    }

    initHostagesAndBomb() {
        this.hostages = [];
        for (let i = 0; i < HOSTAGE_COUNT; i++) {
            this.hostages.push({
                id: i, x: 0, y: 0, placed: false,
                alive: true, rescued: false, beingCarried: false,
                carriedBy: null,
                deathTimer: HOSTAGE_DEATH_INTERVAL,
                maxDeathTimer: HOSTAGE_DEATH_INTERVAL
            });
        }
        this.bomb = {
            x: 0, y: 0, placed: false, defused: false,
            timer: BOMB_TIMER, active: false
        };
        this.setupPlacedHostages = 0;
        this.setupPlacedBomb = false;
    }

    startSetup() {
        this.phase = PHASE.SETUP;
        this.setupTimer = SETUP_TIME;
        this.initHostagesAndBomb();
        this.showPhaseOverlay('SETUP PHASE', 'Defense places objectives', 3000);
    }

    startAction() {
        this.phase = PHASE.ACTION;
        this.timer = ACTION_TIME;
        this.bomb.active = true;
        this.nextHostageDeath = HOSTAGE_DEATH_INTERVAL;
        this.bullets = [];
        this.showPhaseOverlay('ACTION PHASE', 'Operators move in!', 3000);
    }

    startHalftime() {
        this.phase = PHASE.HALFTIME;
        this.round = 2;
        this.showPhaseOverlay('HALFTIME', 'Teams swap roles', 4000);

        // Swap teams - players will pick new teams
        // Reset agents
        setTimeout(() => {
            this.resetForRound2();
        }, 4000);
    }

    resetForRound2() {
        // Re-init agents with new spawn positions (swapped)
        const weaponSeed = Math.floor(Math.random() * 999999);
        const rng = new SeededRNG(weaponSeed);

        this.agents.swat = [];
        this.agents.terrorist = [];

        for (let i = 0; i < AGENTS_PER_TEAM; i++) {
            const swatSpawn = this.map.spawnSwat[i] || this.map.spawnSwat[0];
            const terrorSpawn = this.map.spawnTerror[i] || this.map.spawnTerror[0];

            this.agents.swat.push(new Agent(i, 'swat', swatSpawn.x, swatSpawn.y, getRandomWeapon(rng)));
            this.agents.terrorist.push(new Agent(i + AGENTS_PER_TEAM, 'terrorist', terrorSpawn.x, terrorSpawn.y, getRandomWeapon(rng)));
        }

        this.bots = [];
        for (const agent of [...this.agents.swat, ...this.agents.terrorist]) {
            this.bots.push(new BotAI(agent, this.map));
        }

        this.bullets = [];
        this.killFeed = [];

        this.startSetup();
    }

    endMatch() {
        this.phase = PHASE.END;
    }

    update(dt) {
        if (this.phase === PHASE.SETUP) {
            this.updateSetup(dt);
        } else if (this.phase === PHASE.ACTION) {
            this.updateAction(dt);
        }

        // Update phase overlay
        if (this.phaseOverlayTimer > 0) {
            this.phaseOverlayTimer -= dt * 1000;
        }
    }

    updateSetup(dt) {
        this.setupTimer -= dt * 1000;

        // Auto-place remaining if timer expires
        if (this.setupTimer <= 0) {
            this.autoPlaceRemaining();
            this.startAction();
        }
    }

    updateAction(dt) {
        // Timer
        this.timer -= dt * 1000;

        // Update agents
        for (const team of ['swat', 'terrorist']) {
            for (const agent of this.agents[team]) {
                agent.update(dt, this.map);

                // Check respawn
                if (!agent.alive && agent.respawnTimer <= 0) {
                    const spawns = team === 'swat' ? this.map.spawnSwat : this.map.spawnTerror;
                    const spawn = spawns[agent.id % spawns.length];
                    agent.respawn(spawn.x, spawn.y);
                    this.addKillFeedEntry(null, agent, 'respawned');
                }
            }
        }

        // Update bullets
        this.updateBullets(dt);

        // Update AI
        for (const bot of this.bots) {
            bot.update(dt, this);
        }

        // Update visibility
        this.visibility.swat.computeForAgents(this.agents.swat);
        this.visibility.terrorist.computeForAgents(this.agents.terrorist);

        // Hostage death timer
        this.nextHostageDeath -= dt * 1000;
        if (this.nextHostageDeath <= 0) {
            this.killRandomHostage();
            this.nextHostageDeath = HOSTAGE_DEATH_INTERVAL;
        }

        // Update individual hostage timers 
        for (const h of this.hostages) {
            if (h.alive && h.placed && !h.rescued && !h.beingCarried) {
                h.deathTimer -= dt * 1000;
                if (h.deathTimer <= 0) {
                    h.alive = false;
                    this.scores.terrorist += 1;
                    this.addKillFeedEntry(null, null, 'A hostage has died!');
                }
            }
        }

        // Bomb timer
        if (this.bomb && this.bomb.active && !this.bomb.defused && this.bomb.placed) {
            this.bomb.timer -= dt * 1000;
            if (this.bomb.timer <= 0) {
                // Bomb explodes - SWAT loses
                this.bomb.timer = 0;
                this.scores.terrorist += 3;
                this.addKillFeedEntry(null, null, 'BOMB EXPLODED! Terrorists win the round!');
                this.endRound();
                return;
            }
        }

        // Check hostage carrying & extraction
        for (const agent of this.agents.swat) {
            if (!agent.alive || agent.carryingHostage === null) continue;
            const hostage = this.hostages[agent.carryingHostage];
            if (!hostage) continue;

            // Move hostage with agent
            hostage.x = Math.floor(agent.x / TILE_SIZE);
            hostage.y = Math.floor(agent.y / TILE_SIZE);

            // Check if at extraction zone
            if (this.extractionZone) {
                const ez = this.extractionZone;
                const ax = agent.x / TILE_SIZE;
                const ay = agent.y / TILE_SIZE;
                if (ax >= ez.x && ax < ez.x + ez.w && ay >= ez.y && ay < ez.y + ez.h) {
                    hostage.rescued = true;
                    hostage.beingCarried = false;
                    agent.carryingHostage = null;
                    this.scores.swat += 2;
                    this.addKillFeedEntry(null, null, 'Hostage rescued! +2 SWAT');
                }
            }
        }

        // Defuse progress
        if (this.defusing) {
            this.defuseProgress += dt * 1000;
            if (this.defuseProgress >= this.defuseTime) {
                this.bomb.defused = true;
                this.bomb.active = false;
                this.defusing = false;
                this.defuseProgress = 0;
                this.scores.swat += 3;
                this.addKillFeedEntry(null, null, 'Bomb defused! +3 SWAT');
            }
        }

        // Check round end conditions
        if (this.timer <= 0) {
            this.addKillFeedEntry(null, null, 'Time up!');
            this.endRound();
            return;
        }

        // Check if all agents of one team are dead (and none respawning soon)
        const swatAlive = this.agents.swat.some(a => a.alive);
        const terrorAlive = this.agents.terrorist.some(a => a.alive);
        // Don't end just because someone died - they respawn

        // Check if all objectives resolved
        const allHostagesDone = this.hostages.every(h => h.rescued || !h.alive);
        const bombDone = this.bomb.defused;
        if (allHostagesDone && bombDone) {
            this.addKillFeedEntry(null, null, 'All objectives complete!');
            this.endRound();
        }
    }

    updateBullets(dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            const speed = b.speed || 800;
            b.x += Math.cos(b.angle) * speed * dt;
            b.y += Math.sin(b.angle) * speed * dt;
            b.traveled = (b.traveled || 0) + speed * dt;

            // Check wall collision
            const tile = this.map.worldToTile(b.x, b.y);
            if (this.map.isBlocking(tile.x, tile.y)) {
                this.bullets.splice(i, 1);
                continue;
            }

            // Check range
            if (b.traveled > b.range) {
                this.bullets.splice(i, 1);
                continue;
            }

            // Check agent collision
            const enemyTeam = b.team === 'swat' ? 'terrorist' : 'swat';
            for (const agent of this.agents[enemyTeam]) {
                if (!agent.alive) continue;
                if (dist(b.x, b.y, agent.x, agent.y) < AGENT_RADIUS + 2) {
                    const killed = agent.takeDamage(b.damage);
                    if (killed) {
                        const shooter = this.findAgent(b.shooterId);
                        this.addKillFeedEntry(shooter, agent, 'eliminated');
                    }
                    this.bullets.splice(i, 1);
                    break;
                }
            }
        }
    }

    endRound() {
        if (this.round === 1) {
            this.startHalftime();
        } else {
            this.endMatch();
        }
    }

    autoPlaceRemaining() {
        const rng = new SeededRNG(Date.now());
        const slots = rng.shuffle(this.map.hostageSlots);
        let slotIdx = 0;

        for (const h of this.hostages) {
            if (!h.placed && slotIdx < slots.length) {
                h.x = slots[slotIdx].x;
                h.y = slots[slotIdx].y;
                h.placed = true;
                slotIdx++;
            }
        }

        if (!this.bomb.placed && slotIdx < slots.length) {
            this.bomb.x = slots[slotIdx].x;
            this.bomb.y = slots[slotIdx].y;
            this.bomb.placed = true;
        }
    }

    placeHostage(tileX, tileY) {
        if (this.setupPlacedHostages >= HOSTAGE_COUNT) return false;

        // Check valid position (floor inside a room)
        if (!this.map.isWalkable(tileX, tileY)) return false;
        const room = this.map.getRoomAt(tileX, tileY);
        if (!room) return false;

        // Check not too close to another placement
        for (const h of this.hostages) {
            if (h.placed && dist(h.x, h.y, tileX, tileY) < 3) return false;
        }

        const hostage = this.hostages[this.setupPlacedHostages];
        hostage.x = tileX;
        hostage.y = tileY;
        hostage.placed = true;
        this.setupPlacedHostages++;
        return true;
    }

    placeBomb(tileX, tileY) {
        if (this.setupPlacedBomb) return false;
        if (!this.map.isWalkable(tileX, tileY)) return false;
        const room = this.map.getRoomAt(tileX, tileY);
        if (!room) return false;

        this.bomb.x = tileX;
        this.bomb.y = tileY;
        this.bomb.placed = true;
        this.setupPlacedBomb = true;
        return true;
    }

    tryRescueHostage(agent) {
        if (agent.team !== 'swat') return false;
        if (agent.carryingHostage !== null) return false;

        for (const h of this.hostages) {
            if (!h.alive || h.rescued || h.beingCarried) continue;
            if (!h.placed) continue;
            const d = dist(agent.x, agent.y, h.x * TILE_SIZE + TILE_SIZE / 2, h.y * TILE_SIZE + TILE_SIZE / 2);
            if (d < TILE_SIZE * 2) {
                h.beingCarried = true;
                h.carriedBy = agent.id;
                agent.carryingHostage = h.id;
                this.addKillFeedEntry(null, null, 'Hostage picked up!');
                return true;
            }
        }
        return false;
    }

    tryDefuseBomb(agent) {
        if (agent.team !== 'swat') return false;
        if (!this.bomb || !this.bomb.placed || this.bomb.defused) return false;

        const d = dist(agent.x, agent.y, this.bomb.x * TILE_SIZE + TILE_SIZE / 2, this.bomb.y * TILE_SIZE + TILE_SIZE / 2);
        if (d < TILE_SIZE * 2) {
            this.defusing = true;
            return true;
        }
        return false;
    }

    stopDefuse() {
        this.defusing = false;
        this.defuseProgress = 0;
    }

    killRandomHostage() {
        const alive = this.hostages.filter(h => h.alive && h.placed && !h.rescued && !h.beingCarried);
        if (alive.length > 0) {
            // Only kill if timer is low - handled by individual timers now
        }
    }

    addBullets(bullets) {
        if (bullets) this.bullets.push(...bullets);
    }

    addKillFeedEntry(killer, victim, action) {
        this.killFeed.unshift({
            killer: killer ? `${killer.team === 'swat' ? 'SWAT' : 'OPFOR'}-${(killer.id % 5) + 1}` : null,
            victim: victim ? `${victim.team === 'swat' ? 'SWAT' : 'OPFOR'}-${(victim.id % 5) + 1}` : null,
            action: action,
            time: Date.now()
        });
        if (this.killFeed.length > 8) this.killFeed.pop();
    }

    getTeamAgents(team) {
        return this.agents[team] || [];
    }

    findAgent(id) {
        for (const team of ['swat', 'terrorist']) {
            const agent = this.agents[team].find(a => a.id === id);
            if (agent) return agent;
        }
        return null;
    }

    showPhaseOverlay(text, subtext, duration) {
        this.phaseOverlayText = text;
        this.phaseOverlaySubtext = subtext;
        this.phaseOverlayTimer = duration;
    }

    // Check if an agent is near an interactive object
    getNearbyInteraction(agent) {
        if (!agent || !agent.alive) return null;

        // Check hostages
        if (agent.team === 'swat' && agent.carryingHostage === null) {
            for (const h of this.hostages) {
                if (!h.alive || h.rescued || h.beingCarried || !h.placed) continue;
                const d = dist(agent.x, agent.y, h.x * TILE_SIZE + TILE_SIZE / 2, h.y * TILE_SIZE + TILE_SIZE / 2);
                if (d < TILE_SIZE * 2.5) return { type: 'rescue', hostage: h };
            }
        }

        // Check bomb
        if (agent.team === 'swat' && this.bomb && this.bomb.placed && !this.bomb.defused) {
            const d = dist(agent.x, agent.y, this.bomb.x * TILE_SIZE + TILE_SIZE / 2, this.bomb.y * TILE_SIZE + TILE_SIZE / 2);
            if (d < TILE_SIZE * 2.5) return { type: 'defuse' };
        }

        return null;
    }

    serialize() {
        return {
            phase: this.phase,
            round: this.round,
            timer: Math.round(this.timer),
            setupTimer: Math.round(this.setupTimer),
            scores: { ...this.scores },
            agents: {
                swat: this.agents.swat.map(a => a.serialize()),
                terrorist: this.agents.terrorist.map(a => a.serialize())
            },
            hostages: this.hostages.map(h => ({ ...h })),
            bomb: this.bomb ? { ...this.bomb } : null,
            bullets: this.bullets.map(b => ({
                x: Math.round(b.x), y: Math.round(b.y),
                angle: Math.round(b.angle * 100) / 100,
                team: b.team
            })),
            killFeed: this.killFeed.slice(0, 5)
        };
    }

    deserialize(data) {
        this.phase = data.phase;
        this.round = data.round;
        this.timer = data.timer;
        this.setupTimer = data.setupTimer;
        this.scores = data.scores;

        // Update agents
        for (const team of ['swat', 'terrorist']) {
            if (data.agents[team]) {
                for (let i = 0; i < data.agents[team].length; i++) {
                    if (this.agents[team][i]) {
                        this.agents[team][i].deserialize(data.agents[team][i]);
                    }
                }
            }
        }

        this.hostages = data.hostages;
        this.bomb = data.bomb;
        this.killFeed = data.killFeed || [];

        // Reconstruct bullets minimally
        this.bullets = data.bullets || [];
    }
}
