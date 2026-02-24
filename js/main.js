/* ===== MAIN ENTRY POINT - UI, INPUT, GAME LOOP ===== */

(() => {
    // === DOM Elements ===
    const screens = {
        menu: document.getElementById('menuScreen'),
        lobby: document.getElementById('lobbyScreen'),
        game: document.getElementById('gameScreen')
    };
    const canvas = document.getElementById('gameCanvas');
    const playerNameInput = document.getElementById('playerName');
    const partyCodeInput = document.getElementById('partyCodeInput');
    const partyCodeDisplay = document.getElementById('partyCodeDisplay');
    const swatPlayerList = document.getElementById('swatPlayerList');
    const terroristPlayerList = document.getElementById('terroristPlayerList');
    const lobbyStatus = document.getElementById('lobbyStatus');
    const menuStatus = document.getElementById('menuStatus');
    const agentBar = document.getElementById('agentBar');
    const timerDisplay = document.getElementById('timerDisplay');
    const swatScoreEl = document.getElementById('swatScore');
    const terroristScoreEl = document.getElementById('terroristScore');
    const phaseDisplayEl = document.getElementById('phaseDisplay');
    const setupPanel = document.getElementById('setupPanel');
    const setupItems = document.querySelectorAll('.setup-item');
    const phaseOverlay = document.getElementById('phaseOverlay');
    const phaseOverlayText = document.getElementById('phaseOverlayText');
    const phaseOverlaySubtext = document.getElementById('phaseOverlaySubtext');
    const endScreen = document.getElementById('endScreen');
    const endScores = document.getElementById('endScores');
    const killFeedEl = document.getElementById('killFeed');
    const interactPrompt = document.getElementById('interactPrompt');

    // === State ===
    let network = null;
    let game = null;
    let renderer = null;
    let myTeam = null;
    let selectedAgentIdx = 0;
    let setupPlaceType = 'hostage';
    let lastFrameTime = 0;
    let keys = {};
    let mouse = { x: 0, y: 0, worldX: 0, worldY: 0, buttons: 0 };
    let isPractice = false;
    let gameStarted = false;

    // === Screen Management ===
    function showScreen(name) {
        for (const [k, el] of Object.entries(screens)) {
            el.classList.toggle('active', k === name);
        }
    }

    // === MENU HANDLERS ===
    document.getElementById('createPartyBtn').addEventListener('click', async () => {
        const name = playerNameInput.value.trim() || 'Host';
        menuStatus.textContent = 'Creating party...';
        try {
            network = new Network();
            const code = await network.createParty(name);
            setupNetworkHandlers();
            partyCodeDisplay.textContent = code;
            showScreen('lobby');
            updateLobbyUI();
        } catch (e) {
            menuStatus.textContent = 'Error: ' + (e.message || e.type || 'Connection failed');
        }
    });

    document.getElementById('joinPartyBtn').addEventListener('click', async () => {
        const name = playerNameInput.value.trim() || 'Player';
        const code = partyCodeInput.value.trim().toUpperCase();
        if (code.length < 4) {
            menuStatus.textContent = 'Enter a valid party code';
            return;
        }
        menuStatus.textContent = 'Joining party...';
        try {
            network = new Network();
            await network.joinParty(code, name);
            setupNetworkHandlers();
            partyCodeDisplay.textContent = code;
            showScreen('lobby');
        } catch (e) {
            menuStatus.textContent = 'Error: ' + (e.message || e.type || 'Could not join');
        }
    });

    document.getElementById('practiceBtn').addEventListener('click', () => {
        isPractice = true;
        network = new Network();
        network.isHost = true;
        network.playerId = 'local';
        network.players.set('local', { name: 'You', team: 'swat', ready: true, isHost: true });
        network.players.set('bot', { name: 'Bot', team: 'terrorist', ready: true, isHost: false });
        setupNetworkHandlers();
        myTeam = 'swat';
        startGame();
    });

    document.getElementById('copyCodeBtn').addEventListener('click', () => {
        navigator.clipboard?.writeText(partyCodeDisplay.textContent);
    });

    // === LOBBY HANDLERS ===
    document.getElementById('joinSwatBtn').addEventListener('click', () => {
        if (!network) return;
        network.setTeam('swat');
        myTeam = 'swat';
        updateLobbyUI();
    });

    document.getElementById('joinTerroristBtn').addEventListener('click', () => {
        if (!network) return;
        network.setTeam('terrorist');
        myTeam = 'terrorist';
        updateLobbyUI();
    });

    document.getElementById('readyBtn').addEventListener('click', () => {
        if (!network) return;
        const me = network.players.get(network.playerId);
        if (!me || !me.team) {
            lobbyStatus.textContent = 'Select a team first!';
            return;
        }
        const newReady = !me.ready;
        network.setReady(newReady);
        document.getElementById('readyBtn').textContent = newReady ? 'UNREADY' : 'READY';
        updateLobbyUI();

        // Check if all ready (host starts game)
        if (network.isHost) {
            setTimeout(() => {
                if (network.allPlayersReady()) {
                    startGame();
                }
            }, 500);
        }
    });

    document.getElementById('leaveBtn').addEventListener('click', () => {
        if (network) network.disconnect();
        network = null;
        showScreen('menu');
    });

    // === NETWORK HANDLERS ===
    function setupNetworkHandlers() {
        if (!network) return;

        network.onPlayerJoin = () => { updateLobbyUI(); };
        network.onPlayerLeave = () => { updateLobbyUI(); };
        network.onError = (type) => {
            menuStatus.textContent = 'Network error: ' + type;
            lobbyStatus.textContent = 'Network error: ' + type;
        };

        network.onMessage = (data, senderId) => {
            switch (data.type) {
                case 'game_start':
                    if (!game) {
                        myTeam = network.getMyTeam();
                        initGame(data.mapSeed, data.weaponSeed);
                        game.phase = PHASE.SETUP;
                        game.setupTimer = SETUP_TIME;
                        showScreen('game');
                        gameStarted = true;
                        updateSetupUI();
                    }
                    break;

                case 'state':
                    if (game && !network.isHost) {
                        game.deserialize(data.state);
                        // Recompute visibility for our team
                        if (game.visibility[myTeam]) {
                            game.visibility[myTeam].computeForAgents(game.agents[myTeam]);
                        }
                    }
                    break;

                case 'input':
                    if (game && network.isHost) {
                        handleRemoteInput(data.action, senderId);
                    }
                    break;

                case 'setup_action':
                    if (game && network.isHost) {
                        handleSetupAction(data, senderId);
                    }
                    break;

                case 'start_action':
                    if (game) {
                        game.startAction();
                        updateGameUI();
                    }
                    break;

                case 'halftime_swap':
                    if (game) {
                        // Swap my team
                        myTeam = myTeam === 'swat' ? 'terrorist' : 'swat';
                    }
                    break;
            }
        };
    }

    function handleRemoteInput(action, playerId) {
        if (!game || !action) return;
        // Determine player's team
        const player = network.players.get(playerId);
        if (!player) return;
        const team = player.team;

        switch (action.type) {
            case 'move':
                const agent = game.agents[team]?.[action.agentIdx];
                if (agent && agent.alive) {
                    agent.setMoveTarget(action.tx, action.ty, game.map);
                }
                break;

            case 'wasd':
                const agentW = game.agents[team]?.[action.agentIdx];
                if (agentW && agentW.alive) {
                    agentW.wasdMoving = action.moving;
                    agentW.wasdDx = action.dx;
                    agentW.wasdDy = action.dy;
                }
                break;

            case 'aim':
                const agentA = game.agents[team]?.[action.agentIdx];
                if (agentA && agentA.alive) {
                    agentA.targetAngle = action.angle;
                }
                break;

            case 'shoot':
                const agentS = game.agents[team]?.[action.agentIdx];
                if (agentS && agentS.alive) {
                    agentS.targetAngle = action.angle;
                    const bullets = agentS.shoot(Date.now());
                    game.addBullets(bullets);
                }
                break;

            case 'interact':
                const agentI = game.agents[team]?.[action.agentIdx];
                if (agentI && agentI.alive) {
                    game.tryRescueHostage(agentI) || game.tryDefuseBomb(agentI);
                }
                break;
        }
    }

    function handleSetupAction(data, senderId) {
        if (!game || game.phase !== PHASE.SETUP) return;
        const player = network.players.get(senderId);
        if (!player || player.team !== 'terrorist') return;

        if (data.action === 'place_hostage') {
            game.placeHostage(data.tx, data.ty);
        } else if (data.action === 'place_bomb') {
            game.placeBomb(data.tx, data.ty);
        } else if (data.action === 'confirm_setup') {
            game.autoPlaceRemaining();
            game.startAction();
            network.broadcast({ type: 'start_action' });
        }
    }

    // === GAME INITIALIZATION ===
    function initGame(mapSeed, weaponSeed) {
        game = new Game(network.isHost);
        game.isPractice = isPractice;
        renderer = new Renderer(canvas);
        renderer.resize();

        game.initMap(mapSeed);
        game.initAgents(weaponSeed);
        game.initHostagesAndBomb();

        // Set initial camera
        const myAgents = game.getTeamAgents(myTeam);
        if (myAgents.length > 0) {
            renderer.setCameraTarget(myAgents[0].x, myAgents[0].y, 1.5);
            renderer.camera.x = myAgents[0].x;
            renderer.camera.y = myAgents[0].y;
            renderer.camera.zoom = 1.5;
        }

        // Mark all agents as bot-controlled initially
        for (const team of ['swat', 'terrorist']) {
            for (const agent of game.agents[team]) {
                agent.controlledByPlayer = false;
            }
        }

        selectedAgentIdx = 0;
        selectAgent(0);

        updateAgentBar();
    }

    function startGame() {
        if (!network) return;

        const mapSeed = Math.floor(Math.random() * 999999);
        const weaponSeed = Math.floor(Math.random() * 999999);

        myTeam = network.getMyTeam() || 'swat';
        initGame(mapSeed, weaponSeed);
        game.phase = PHASE.SETUP;
        game.setupTimer = SETUP_TIME;

        showScreen('game');
        gameStarted = true;
        updateSetupUI();

        // Broadcast game start to other players
        if (network.isHost) {
            network.broadcast({
                type: 'game_start',
                mapSeed,
                weaponSeed
            });
        }
    }

    // === AGENT SELECTION ===
    function selectAgent(idx) {
        const agents = game?.getTeamAgents(myTeam);
        if (!agents || idx < 0 || idx >= agents.length) return;

        // Deselect previous
        agents.forEach(a => { a.selected = false; a.controlledByPlayer = false; });

        selectedAgentIdx = idx;
        const agent = agents[idx];
        agent.selected = true;
        agent.controlledByPlayer = true;

        updateAgentBar();
    }

    // === INPUT HANDLING ===
    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;

        if (!game || game.phase === PHASE.LOBBY) return;

        // Number keys to select agents
        if (e.key >= '1' && e.key <= '5') {
            selectAgent(parseInt(e.key) - 1);
        }

        // Tab to cycle agents
        if (e.key === 'Tab') {
            e.preventDefault();
            const agents = game.getTeamAgents(myTeam);
            let next = (selectedAgentIdx + 1) % agents.length;
            // Skip dead agents
            let attempts = 0;
            while (!agents[next].alive && attempts < agents.length) {
                next = (next + 1) % agents.length;
                attempts++;
            }
            selectAgent(next);
        }

        // Space for interact
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            const agent = game.getTeamAgents(myTeam)[selectedAgentIdx];
            if (agent && agent.alive) {
                if (network.isHost) {
                    game.tryRescueHostage(agent) || game.tryDefuseBomb(agent);
                } else {
                    network.sendInput({ type: 'interact', agentIdx: selectedAgentIdx });
                }
            }
        }

        // R to reload
        if (e.key === 'r') {
            const agent = game.getTeamAgents(myTeam)[selectedAgentIdx];
            if (agent && agent.alive) agent.reload();
        }

        // +/- or scroll for zoom
        if (e.key === '=' || e.key === '+') {
            renderer.targetCamera.zoom = Math.min(3, renderer.targetCamera.zoom + 0.2);
        }
        if (e.key === '-') {
            renderer.targetCamera.zoom = Math.max(0.5, renderer.targetCamera.zoom - 0.2);
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    canvas.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        if (renderer) {
            const wp = renderer.screenToWorld(e.clientX, e.clientY);
            mouse.worldX = wp.x;
            mouse.worldY = wp.y;
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        if (!game) return;
        e.preventDefault();

        const wp = renderer.screenToWorld(e.clientX, e.clientY);
        const tile = game.map.worldToTile(wp.x, wp.y);

        // Setup phase - place objectives
        if (game.phase === PHASE.SETUP && myTeam === 'terrorist') {
            if (e.button === 0) {
                const action = setupPlaceType === 'hostage' ? 'place_hostage' : 'place_bomb';
                if (network.isHost) {
                    if (setupPlaceType === 'hostage') {
                        if (game.placeHostage(tile.x, tile.y)) {
                            updateSetupUI();
                        }
                    } else {
                        if (game.placeBomb(tile.x, tile.y)) {
                            updateSetupUI();
                        }
                    }
                } else {
                    network.sendSetupAction({ action, tx: tile.x, ty: tile.y });
                }
            }
            return;
        }

        if (game.phase !== PHASE.ACTION) return;

        const agents = game.getTeamAgents(myTeam);

        if (e.button === 0) {
            // Left click
            // Check if clicking on own agent to select
            for (let i = 0; i < agents.length; i++) {
                if (!agents[i].alive) continue;
                if (dist(wp.x, wp.y, agents[i].x, agents[i].y) < AGENT_RADIUS * 2) {
                    selectAgent(i);
                    return;
                }
            }

            // Otherwise shoot
            const agent = agents[selectedAgentIdx];
            if (agent && agent.alive) {
                const angle = angleBetween(agent.x, agent.y, wp.x, wp.y);
                if (network.isHost) {
                    agent.targetAngle = angle;
                    const bullets = agent.shoot(Date.now());
                    game.addBullets(bullets);
                } else {
                    network.sendInput({ type: 'shoot', agentIdx: selectedAgentIdx, angle });
                }
            }
        }

        if (e.button === 2) {
            // Right click - move to
            const agent = agents[selectedAgentIdx];
            if (agent && agent.alive) {
                if (network.isHost) {
                    agent.setMoveTarget(tile.x, tile.y, game.map);
                    agent.wasdMoving = false;
                } else {
                    network.sendInput({ type: 'move', agentIdx: selectedAgentIdx, tx: tile.x, ty: tile.y });
                }
            }
        }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
        if (!renderer) return;
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        renderer.targetCamera.zoom = clamp(renderer.targetCamera.zoom + delta, 0.5, 3);
    });

    // === SETUP UI ===
    setupItems.forEach(item => {
        item.addEventListener('click', () => {
            setupPlaceType = item.dataset.type;
            setupItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });

    document.getElementById('confirmSetupBtn').addEventListener('click', () => {
        if (!game || game.phase !== PHASE.SETUP) return;
        if (network.isHost) {
            game.autoPlaceRemaining();
            game.startAction();
            network.broadcast({ type: 'start_action' });
            updateGameUI();
        } else {
            network.sendSetupAction({ action: 'confirm_setup' });
        }
    });

    // === END SCREEN ===
    document.getElementById('playAgainBtn')?.addEventListener('click', () => {
        if (!game) return;
        endScreen.classList.add('hidden');
        if (network.isHost) {
            game.round = 1;
            const mapSeed = Math.floor(Math.random() * 999999);
            const weaponSeed = Math.floor(Math.random() * 999999);
            initGame(mapSeed, weaponSeed);
            game.phase = PHASE.SETUP;
            game.setupTimer = SETUP_TIME;
            updateSetupUI();
            network.broadcast({ type: 'game_start', mapSeed, weaponSeed });
        }
    });

    document.getElementById('backToLobbyBtn')?.addEventListener('click', () => {
        endScreen.classList.add('hidden');
        game = null;
        gameStarted = false;
        showScreen('lobby');
        updateLobbyUI();
    });

    // === UI Updates ===
    function updateLobbyUI() {
        swatPlayerList.innerHTML = '';
        terroristPlayerList.innerHTML = '';

        if (!network) return;

        for (const [id, p] of network.players) {
            const el = document.createElement('div');
            el.className = 'player-entry';
            el.innerHTML = `
                <span>${p.name}${p.isHost ? ' (Host)' : ''}</span>
                ${p.ready ? '<span class="ready-badge">READY</span>' : ''}
            `;
            if (p.team === 'swat') swatPlayerList.appendChild(el);
            else if (p.team === 'terrorist') terroristPlayerList.appendChild(el);
        }

        lobbyStatus.textContent = `Players: ${network.players.size}`;
    }

    function updateAgentBar() {
        if (!game) return;
        const agents = game.getTeamAgents(myTeam);
        agentBar.innerHTML = '';

        agents.forEach((agent, idx) => {
            const slot = document.createElement('div');
            slot.className = 'agent-slot' +
                (idx === selectedAgentIdx ? ' selected' : '') +
                (!agent.alive ? ' dead' : '');

            if (agent.alive) {
                slot.innerHTML = `
                    <span class="agent-number">${idx + 1}</span>
                    <span class="agent-weapon">${agent.weapon.name}</span>
                    <div class="agent-hp">
                        <div class="agent-hp-fill" style="width:${(agent.hp / agent.maxHp) * 100}%"></div>
                    </div>
                `;
            } else {
                slot.innerHTML = `
                    <span class="agent-number">${idx + 1}</span>
                    <span class="respawn-timer">${Math.ceil(agent.respawnTimer / 1000)}s</span>
                `;
            }

            slot.addEventListener('click', () => selectAgent(idx));
            agentBar.appendChild(slot);
        });
    }

    function updateSetupUI() {
        if (!game) return;
        if (game.phase === PHASE.SETUP && myTeam === 'terrorist') {
            setupPanel.classList.remove('hidden');
            const hostageBtn = setupItems[0];
            const bombBtn = setupItems[1];
            if (hostageBtn) hostageBtn.textContent = `HOSTAGE (${Math.max(0, HOSTAGE_COUNT - game.setupPlacedHostages)})`;
            if (bombBtn) bombBtn.textContent = game.setupPlacedBomb ? 'BOMB (Placed)' : 'BOMB (1)';
        } else if (game.phase === PHASE.SETUP) {
            setupPanel.classList.remove('hidden');
            document.getElementById('setupTitle').textContent = 'WAITING';
            document.getElementById('setupInstructions').textContent = 'Defense is placing objectives...';
            document.getElementById('setupItems').classList.add('hidden');
            document.getElementById('confirmSetupBtn').classList.add('hidden');
        } else {
            setupPanel.classList.add('hidden');
        }
    }

    function updateGameUI() {
        if (!game) return;

        // Timer
        const timeMs = game.phase === PHASE.SETUP ? game.setupTimer : game.timer;
        const secs = Math.max(0, Math.ceil(timeMs / 1000));
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        timerDisplay.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        timerDisplay.style.color = secs <= 10 ? '#ff3333' : '#fff';

        // Scores
        swatScoreEl.textContent = `SWAT: ${game.scores.swat}`;
        terroristScoreEl.textContent = `OPFOR: ${game.scores.terrorist}`;

        // Phase
        const phaseNames = { setup: 'SETUP PHASE', action: 'ACTION PHASE', halftime: 'HALFTIME', end: 'MATCH OVER' };
        phaseDisplayEl.textContent = phaseNames[game.phase] || game.phase.toUpperCase();

        // Agent bar
        updateAgentBar();

        // Setup panel
        updateSetupUI();

        // Phase overlay
        if (game.phaseOverlayTimer > 0) {
            phaseOverlay.classList.remove('hidden');
            phaseOverlayText.textContent = game.phaseOverlayText;
            phaseOverlaySubtext.textContent = game.phaseOverlaySubtext;
        } else {
            phaseOverlay.classList.add('hidden');
        }

        // End screen
        if (game.phase === PHASE.END) {
            endScreen.classList.remove('hidden');
            endScores.innerHTML = `
                <span class="score-blue">SWAT: ${game.scores.swat}</span>
                <span class="score-red">OPFOR: ${game.scores.terrorist}</span>
            `;
            const winner = game.scores.swat > game.scores.terrorist ? 'SWAT WINS!' :
                           game.scores.terrorist > game.scores.swat ? 'OPPOSITION WINS!' : 'DRAW!';
            document.getElementById('endTitle').textContent = winner;
        } else {
            endScreen.classList.add('hidden');
        }

        // Kill feed
        killFeedEl.innerHTML = '';
        for (const entry of game.killFeed) {
            const age = Date.now() - entry.time;
            if (age > 8000) continue;
            const el = document.createElement('div');
            el.className = 'kill-entry';
            if (entry.killer && entry.victim) {
                el.innerHTML = `<span class="killer">${entry.killer}</span> ${entry.action} <span class="victim">${entry.victim}</span>`;
            } else {
                el.textContent = entry.action;
            }
            el.style.opacity = Math.max(0, 1 - age / 8000);
            killFeedEl.appendChild(el);
        }

        // Interact prompt
        const selAgent = game.getTeamAgents(myTeam)?.[selectedAgentIdx];
        const interaction = selAgent ? game.getNearbyInteraction(selAgent) : null;
        if (interaction) {
            interactPrompt.classList.remove('hidden');
            interactPrompt.textContent = interaction.type === 'rescue' ? 'Press SPACE to rescue hostage' :
                                         interaction.type === 'defuse' ? 'Press SPACE to defuse bomb' : '';
        } else {
            interactPrompt.classList.add('hidden');
        }
    }

    // === GAME LOOP ===
    function gameLoop(time) {
        requestAnimationFrame(gameLoop);

        const dt = Math.min(0.05, (time - lastFrameTime) / 1000);
        lastFrameTime = time;

        if (!game || !renderer || !gameStarted) return;

        // Handle WASD input
        if (game.phase === PHASE.ACTION) {
            const agents = game.getTeamAgents(myTeam);
            const agent = agents[selectedAgentIdx];
            if (agent && agent.alive) {
                let dx = 0, dy = 0;
                if (keys['w'] || keys['arrowup']) dy -= 1;
                if (keys['s'] || keys['arrowdown']) dy += 1;
                if (keys['a'] || keys['arrowleft']) dx -= 1;
                if (keys['d'] || keys['arrowright']) dx += 1;

                const isMoving = dx !== 0 || dy !== 0;

                if (network.isHost) {
                    agent.wasdMoving = isMoving;
                    agent.wasdDx = dx;
                    agent.wasdDy = dy;
                } else if (isMoving) {
                    network.sendInput({ type: 'wasd', agentIdx: selectedAgentIdx, moving: true, dx, dy });
                } else if (agent.wasdMoving) {
                    network.sendInput({ type: 'wasd', agentIdx: selectedAgentIdx, moving: false, dx: 0, dy: 0 });
                    agent.wasdMoving = false;
                }

                // Aim towards mouse
                const angle = angleBetween(agent.x, agent.y, mouse.worldX, mouse.worldY);
                if (network.isHost) {
                    agent.targetAngle = angle;
                }
                // Send aim updates less frequently
                if (!network.isHost && time % 3 < 1) {
                    network.sendInput({ type: 'aim', agentIdx: selectedAgentIdx, angle });
                }

                // Auto-fire if holding mouse button
                if (mouse.buttons & 1 && agent.weapon.automatic) {
                    if (network.isHost) {
                        const bullets = agent.shoot(Date.now());
                        game.addBullets(bullets);
                    } else {
                        network.sendInput({ type: 'shoot', agentIdx: selectedAgentIdx, angle });
                    }
                }
            }
        }

        // Update game (host authoritative)
        if (network.isHost) {
            game.update(dt);

            // Broadcast state
            if (time - game.lastStateSend > STATE_SYNC_RATE) {
                game.lastStateSend = time;
                network.broadcast({ type: 'state', state: game.serialize() });
            }
        } else {
            // Client: update visibility locally for smooth rendering
            if (game.visibility[myTeam]) {
                game.visibility[myTeam].computeForAgents(game.agents[myTeam]);
            }
            // Simple client-side interpolation for agents
            for (const team of ['swat', 'terrorist']) {
                for (const agent of game.agents[team]) {
                    agent.angle = lerpAngle(agent.angle, agent.targetAngle, Math.min(1, dt * 10));
                }
            }
        }

        // Camera follow selected agent
        const selAgent = game.getTeamAgents(myTeam)?.[selectedAgentIdx];
        if (selAgent && selAgent.alive) {
            renderer.setCameraTarget(selAgent.x, selAgent.y);
        }
        renderer.updateCamera(dt);

        // Render
        renderer.render(game, myTeam, selAgent?.id ?? -1, mouse);

        // Update HUD
        updateGameUI();
    }

    // === RESIZE ===
    window.addEventListener('resize', () => {
        if (renderer) renderer.resize();
    });

    // Track mouse buttons
    canvas.addEventListener('mousedown', (e) => { mouse.buttons = e.buttons; });
    canvas.addEventListener('mouseup', (e) => { mouse.buttons = e.buttons; });

    // === START ===
    requestAnimationFrame(gameLoop);

    // Generate random name
    const callsigns = ['Ghost', 'Viper', 'Shadow', 'Eagle', 'Wolf', 'Falcon', 'Storm', 'Reaper', 'Phoenix', 'Cobra'];
    playerNameInput.value = callsigns[Math.floor(Math.random() * callsigns.length)] + Math.floor(Math.random() * 99);
})();
