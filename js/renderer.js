/* ===== CANVAS RENDERER ===== */

const COLORS = {
    void: '#0a0a0f',
    wall: '#2a2a35',
    wallTop: '#3a3a45',
    floor: '#1a1a22',
    floorAlt: '#1e1e28',
    door: '#4a3520',
    doorOpen: '#3a2510',
    obstacle: '#333340',
    swat: '#2288ff',
    swatLight: '#44aaff',
    terrorist: '#ff3333',
    terroristLight: '#ff6666',
    hostage: '#ffcc00',
    bomb: '#ff6600',
    bombPulse: '#ff3300',
    fog: 'rgba(0, 0, 0, 0.75)',
    fogExplored: 'rgba(0, 0, 0, 0.5)',
    visionCone: 'rgba(255, 255, 200, 0.04)',
    bullet: '#ffff00',
    muzzleFlash: '#ffaa00',
    grid: 'rgba(255, 255, 255, 0.02)',
    healthGreen: '#00ff66',
    healthYellow: '#ffcc00',
    healthRed: '#ff3333',
    extraction: '#00ffaa'
};

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.targetCamera = { x: 0, y: 0, zoom: 1 };
        this.minimapSize = 180;
        this.particles = [];
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setCameraTarget(x, y, zoom) {
        this.targetCamera.x = x;
        this.targetCamera.y = y;
        if (zoom) this.targetCamera.zoom = zoom;
    }

    updateCamera(dt) {
        this.camera.x = lerp(this.camera.x, this.targetCamera.x, Math.min(1, dt * 5));
        this.camera.y = lerp(this.camera.y, this.targetCamera.y, Math.min(1, dt * 5));
        this.camera.zoom = lerp(this.camera.zoom, this.targetCamera.zoom, Math.min(1, dt * 5));
    }

    worldToScreen(wx, wy) {
        return {
            x: (wx - this.camera.x) * this.camera.zoom + this.canvas.width / 2,
            y: (wy - this.camera.y) * this.camera.zoom + this.canvas.height / 2
        };
    }

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.canvas.width / 2) / this.camera.zoom + this.camera.x,
            y: (sy - this.canvas.height / 2) / this.camera.zoom + this.camera.y
        };
    }

    render(game, myTeam, selectedAgentId, mouseWorld) {
        const ctx = this.ctx;
        const map = game.map;
        const vis = game.visibility[myTeam];

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = COLORS.void;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();

        // Apply camera transform
        const zoom = this.camera.zoom;
        ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-this.camera.x, -this.camera.y);

        // Calculate visible tile range
        const viewW = this.canvas.width / zoom;
        const viewH = this.canvas.height / zoom;
        const startTX = Math.max(0, Math.floor((this.camera.x - viewW / 2) / TILE_SIZE) - 1);
        const startTY = Math.max(0, Math.floor((this.camera.y - viewH / 2) / TILE_SIZE) - 1);
        const endTX = Math.min(map.width, Math.ceil((this.camera.x + viewW / 2) / TILE_SIZE) + 1);
        const endTY = Math.min(map.height, Math.ceil((this.camera.y + viewH / 2) / TILE_SIZE) + 1);

        // Draw tiles
        for (let ty = startTY; ty < endTY; ty++) {
            for (let tx = startTX; tx < endTX; tx++) {
                const tile = map.tiles[ty][tx];
                const wx = tx * TILE_SIZE;
                const wy = ty * TILE_SIZE;

                // Always show map layout (player knows the layout)
                switch (tile) {
                    case TILE.VOID:
                        continue; // Already cleared to void color
                    case TILE.WALL:
                        ctx.fillStyle = COLORS.wall;
                        ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
                        // Top edge highlight
                        ctx.fillStyle = COLORS.wallTop;
                        ctx.fillRect(wx, wy, TILE_SIZE, 2);
                        break;
                    case TILE.FLOOR:
                        ctx.fillStyle = (tx + ty) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
                        ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
                        break;
                    case TILE.DOOR:
                        ctx.fillStyle = COLORS.door;
                        ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
                        ctx.fillStyle = '#5a4530';
                        ctx.fillRect(wx + 2, wy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                        break;
                    case TILE.OBSTACLE:
                        ctx.fillStyle = COLORS.floor;
                        ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
                        ctx.fillStyle = COLORS.obstacle;
                        ctx.fillRect(wx + 2, wy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                        break;
                }
            }
        }

        // Draw vision cones for my team
        const myAgents = game.getTeamAgents(myTeam);
        for (const agent of myAgents) {
            if (!agent.alive) continue;
            this.drawVisionCone(ctx, agent, vis);
        }

        // Draw hostages (only if visible or during setup)
        for (const hostage of game.hostages) {
            if (!hostage.placed) continue;
            const hx = hostage.x * TILE_SIZE + TILE_SIZE / 2;
            const hy = hostage.y * TILE_SIZE + TILE_SIZE / 2;
            const isVisible = game.phase === 'setup' || (vis && vis.isWorldPosVisible(hx, hy));
            // Terrorists always see hostages
            const isTerrorist = myTeam === 'terrorist';

            if (isVisible || isTerrorist) {
                this.drawHostage(ctx, hx, hy, hostage);
            }
        }

        // Draw bomb (only if visible)
        if (game.bomb && game.bomb.placed) {
            const bx = game.bomb.x * TILE_SIZE + TILE_SIZE / 2;
            const by = game.bomb.y * TILE_SIZE + TILE_SIZE / 2;
            const isVisible = game.phase === 'setup' || (vis && vis.isWorldPosVisible(bx, by));
            const isTerrorist = myTeam === 'terrorist';

            if (isVisible || isTerrorist) {
                this.drawBomb(ctx, bx, by, game.bomb);
            }
        }

        // Draw extraction zone
        if (game.extractionZone) {
            const ez = game.extractionZone;
            ctx.save();
            ctx.strokeStyle = COLORS.extraction;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 500) * 0.2;
            ctx.strokeRect(ez.x * TILE_SIZE, ez.y * TILE_SIZE, ez.w * TILE_SIZE, ez.h * TILE_SIZE);
            ctx.fillStyle = COLORS.extraction;
            ctx.globalAlpha = 0.08;
            ctx.fillRect(ez.x * TILE_SIZE, ez.y * TILE_SIZE, ez.w * TILE_SIZE, ez.h * TILE_SIZE);
            ctx.restore();
        }

        // Draw enemy agents (only if visible)
        const enemyTeam = myTeam === 'swat' ? 'terrorist' : 'swat';
        const enemies = game.getTeamAgents(enemyTeam);
        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            const isVisible = vis && vis.isWorldPosVisible(enemy.x, enemy.y);
            if (isVisible) {
                this.drawAgent(ctx, enemy, false, enemy.id === selectedAgentId);
            }
        }

        // Draw my team's agents (always visible)
        for (const agent of myAgents) {
            if (!agent.alive) {
                // Show death marker
                this.drawDeathMarker(ctx, agent);
                continue;
            }
            this.drawAgent(ctx, agent, true, agent.id === selectedAgentId);
        }

        // Draw bullets
        for (const bullet of game.bullets) {
            this.drawBullet(ctx, bullet);
        }

        // Draw particles
        this.updateAndDrawParticles(ctx, 1/60);

        // Draw fog of war overlay
        if (vis && game.phase !== 'setup') {
            this.drawFog(ctx, map, vis, startTX, startTY, endTX, endTY);
        }

        // Draw move target indicator for selected agent
        const selectedAgent = myAgents.find(a => a.id === selectedAgentId);
        if (selectedAgent && selectedAgent.path && selectedAgent.pathIndex < selectedAgent.path.length) {
            const last = selectedAgent.path[selectedAgent.path.length - 1];
            const wx = last.x * TILE_SIZE + TILE_SIZE / 2;
            const wy = last.y * TILE_SIZE + TILE_SIZE / 2;
            ctx.save();
            ctx.strokeStyle = myTeam === 'swat' ? COLORS.swatLight : COLORS.terroristLight;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 300) * 0.3;
            ctx.beginPath();
            ctx.arc(wx, wy, 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(wx - 5, wy); ctx.lineTo(wx + 5, wy);
            ctx.moveTo(wx, wy - 5); ctx.lineTo(wx, wy + 5);
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();

        // Draw minimap
        this.drawMinimap(ctx, game, myTeam);

        // Draw cursor crosshair in world
        // (handled by CSS cursor)
    }

    drawVisionCone(ctx, agent, vis) {
        if (!vis) return;
        const points = vis.getVisionConePoints(agent, 40);
        if (points.length < 3) return;

        ctx.save();
        ctx.fillStyle = COLORS.visionCone;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawAgent(ctx, agent, isFriendly, isSelected) {
        const color = agent.team === 'swat' ? COLORS.swat : COLORS.terrorist;
        const lightColor = agent.team === 'swat' ? COLORS.swatLight : COLORS.terroristLight;

        ctx.save();

        // Selection ring
        if (isSelected) {
            ctx.strokeStyle = lightColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(agent.x, agent.y, AGENT_RADIUS + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Body
        ctx.fillStyle = color;
        if (agent.flashTimer > 0) {
            ctx.fillStyle = '#fff';
        }
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, AGENT_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        // Direction indicator
        const dirX = agent.x + Math.cos(agent.angle) * (AGENT_RADIUS + 4);
        const dirY = agent.y + Math.sin(agent.angle) * (AGENT_RADIUS + 4);
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(agent.x + Math.cos(agent.angle) * AGENT_RADIUS, agent.y + Math.sin(agent.angle) * AGENT_RADIUS);
        ctx.lineTo(dirX, dirY);
        ctx.stroke();

        // Muzzle flash
        if (agent.flashTimer > 50) {
            ctx.fillStyle = COLORS.muzzleFlash;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(dirX, dirY, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // Health bar
        const hpWidth = AGENT_RADIUS * 2.5;
        const hpHeight = 3;
        const hpX = agent.x - hpWidth / 2;
        const hpY = agent.y - AGENT_RADIUS - 8;
        const hpPct = agent.hp / agent.maxHp;

        ctx.fillStyle = '#000';
        ctx.fillRect(hpX - 1, hpY - 1, hpWidth + 2, hpHeight + 2);
        ctx.fillStyle = hpPct > 0.6 ? COLORS.healthGreen : hpPct > 0.3 ? COLORS.healthYellow : COLORS.healthRed;
        ctx.fillRect(hpX, hpY, hpWidth * hpPct, hpHeight);

        // Agent number label
        if (isFriendly) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Show agent index (1-5)
            const teamAgents = agent.team; // We'll just show id+1
            ctx.fillText(String((agent.id % 5) + 1), agent.x, agent.y);
        }

        // Reload indicator
        if (agent.weapon.reloading) {
            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 2;
            const reloadPct = 1 - (agent.weapon.reloadTimer / agent.weapon.reloadTime);
            ctx.beginPath();
            ctx.arc(agent.x, agent.y, AGENT_RADIUS + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reloadPct);
            ctx.stroke();
        }

        // Carrying hostage indicator
        if (agent.carryingHostage !== null) {
            ctx.fillStyle = COLORS.hostage;
            ctx.font = 'bold 8px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('H', agent.x, agent.y + AGENT_RADIUS + 10);
        }

        ctx.restore();
    }

    drawDeathMarker(ctx, agent) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = agent.team === 'swat' ? COLORS.swat : COLORS.terrorist;
        ctx.lineWidth = 2;
        const s = 6;
        ctx.beginPath();
        ctx.moveTo(agent.x - s, agent.y - s);
        ctx.lineTo(agent.x + s, agent.y + s);
        ctx.moveTo(agent.x + s, agent.y - s);
        ctx.lineTo(agent.x - s, agent.y + s);
        ctx.stroke();

        // Respawn timer
        if (agent.respawnTimer > 0) {
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(Math.ceil(agent.respawnTimer / 1000) + 's', agent.x, agent.y + 15);
        }
        ctx.restore();
    }

    drawHostage(ctx, x, y, hostage) {
        ctx.save();
        if (!hostage.alive) {
            ctx.globalAlpha = 0.3;
        }
        if (hostage.rescued) {
            ctx.globalAlpha = 0.5;
        }

        // Body
        ctx.fillStyle = COLORS.hostage;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();

        // 'H' label
        ctx.fillStyle = '#000';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', x, y);

        // Health timer indicator
        if (hostage.alive && !hostage.rescued && hostage.deathTimer > 0) {
            const pct = hostage.deathTimer / hostage.maxDeathTimer;
            ctx.strokeStyle = pct > 0.5 ? COLORS.healthGreen : pct > 0.25 ? COLORS.healthYellow : COLORS.healthRed;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawBomb(ctx, x, y, bomb) {
        ctx.save();
        const pulse = Math.sin(Date.now() / (bomb.defused ? 1000 : 200)) * 0.3 + 0.7;

        if (bomb.defused) {
            ctx.globalAlpha = 0.4;
        }

        // Glow
        if (!bomb.defused) {
            const grd = ctx.createRadialGradient(x, y, 0, x, y, 20);
            grd.addColorStop(0, `rgba(255, 100, 0, ${0.3 * pulse})`);
            grd.addColorStop(1, 'rgba(255, 100, 0, 0)');
            ctx.fillStyle = grd;
            ctx.fillRect(x - 20, y - 20, 40, 40);
        }

        // Body
        ctx.fillStyle = bomb.defused ? '#666' : (pulse > 0.8 ? COLORS.bombPulse : COLORS.bomb);
        ctx.fillRect(x - 7, y - 5, 14, 10);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 7px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bomb.defused ? 'X' : 'B', x, y);

        // Timer display
        if (!bomb.defused && bomb.timer > 0) {
            const secs = Math.ceil(bomb.timer / 1000);
            ctx.fillStyle = secs <= 10 ? COLORS.healthRed : '#fff';
            ctx.font = 'bold 9px Arial';
            ctx.fillText(secs + 's', x, y - 12);
        }

        ctx.restore();
    }

    drawBullet(ctx, bullet) {
        ctx.save();
        ctx.fillStyle = COLORS.bullet;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 2, 0, Math.PI * 2);
        ctx.fill();

        // Trail
        ctx.strokeStyle = COLORS.bullet;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(bullet.x - Math.cos(bullet.angle) * 10, bullet.y - Math.sin(bullet.angle) * 10);
        ctx.stroke();
        ctx.restore();
    }

    drawFog(ctx, map, vis, startTX, startTY, endTX, endTY) {
        ctx.save();
        for (let ty = startTY; ty < endTY; ty++) {
            for (let tx = startTX; tx < endTX; tx++) {
                if (vis.isTileVisible(tx, ty)) continue;
                const wx = tx * TILE_SIZE;
                const wy = ty * TILE_SIZE;

                if (vis.isTileExplored(tx, ty)) {
                    ctx.fillStyle = COLORS.fogExplored;
                } else {
                    ctx.fillStyle = COLORS.fog;
                }
                ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
            }
        }
        ctx.restore();
    }

    drawMinimap(ctx, game, myTeam) {
        const size = this.minimapSize;
        const padding = 10;
        const mx = this.canvas.width - size - padding;
        const my = padding;
        const scale = Math.min(size / game.map.width, size / game.map.height);

        ctx.save();

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(mx - 2, my - 2, size + 4, size + 4);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.strokeRect(mx - 2, my - 2, size + 4, size + 4);

        // Draw tiles (simplified)
        for (let ty = 0; ty < game.map.height; ty++) {
            for (let tx = 0; tx < game.map.width; tx++) {
                const tile = game.map.tiles[ty][tx];
                if (tile === TILE.VOID) continue;
                let color;
                switch (tile) {
                    case TILE.WALL: color = '#3a3a45'; break;
                    case TILE.FLOOR: color = '#1e1e28'; break;
                    case TILE.DOOR: color = '#4a3520'; break;
                    case TILE.OBSTACLE: color = '#333340'; break;
                    default: color = '#1e1e28';
                }
                ctx.fillStyle = color;
                ctx.fillRect(mx + tx * scale, my + ty * scale, Math.ceil(scale), Math.ceil(scale));
            }
        }

        // Draw agents (my team)
        const myAgents = game.getTeamAgents(myTeam);
        for (const agent of myAgents) {
            if (!agent.alive) continue;
            const ax = mx + (agent.x / TILE_SIZE) * scale;
            const ay = my + (agent.y / TILE_SIZE) * scale;
            ctx.fillStyle = agent.team === 'swat' ? COLORS.swat : COLORS.terrorist;
            ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
        }

        // Draw visible enemies on minimap
        const vis = game.visibility[myTeam];
        const enemyTeam = myTeam === 'swat' ? 'terrorist' : 'swat';
        const enemies = game.getTeamAgents(enemyTeam);
        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            if (vis && vis.isWorldPosVisible(enemy.x, enemy.y)) {
                const ax = mx + (enemy.x / TILE_SIZE) * scale;
                const ay = my + (enemy.y / TILE_SIZE) * scale;
                ctx.fillStyle = enemy.team === 'swat' ? COLORS.swat : COLORS.terrorist;
                ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
            }
        }

        // Camera viewport indicator
        const viewW = this.canvas.width / this.camera.zoom;
        const viewH = this.canvas.height / this.camera.zoom;
        const vx = mx + ((this.camera.x - viewW / 2) / TILE_SIZE) * scale;
        const vy = my + ((this.camera.y - viewH / 2) / TILE_SIZE) * scale;
        const vw = (viewW / TILE_SIZE) * scale;
        const vh = (viewH / TILE_SIZE) * scale;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(vx, vy, vw, vh);

        ctx.restore();
    }

    addParticle(x, y, type) {
        const count = type === 'hit' ? 5 : type === 'death' ? 12 : 3;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 100,
                vy: (Math.random() - 0.5) * 100,
                life: 0.3 + Math.random() * 0.4,
                maxLife: 0.3 + Math.random() * 0.4,
                size: type === 'death' ? 3 : 2,
                color: type === 'hit' ? '#ff6666' : type === 'death' ? '#ff0000' : '#ffaa00'
            });
        }
    }

    updateAndDrawParticles(ctx, dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            ctx.save();
            ctx.globalAlpha = p.life / p.maxLife;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            ctx.restore();
        }
    }
}
