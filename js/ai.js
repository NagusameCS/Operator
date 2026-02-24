/* ===== BOT AI SYSTEM ===== */

const AI_STATE = {
    IDLE: 'idle',
    PATROL: 'patrol',
    ENGAGE: 'engage',
    OBJECTIVE: 'objective',
    GUARD: 'guard',
    RETREAT: 'retreat'
};

class BotAI {
    constructor(agent, map) {
        this.agent = agent;
        this.map = map;
        this.state = AI_STATE.IDLE;
        this.stateTimer = 0;
        this.lookTimer = 0;
        this.targetEnemy = null;
        this.patrolTarget = null;
        this.lastKnownEnemyPos = null;
        this.alertLevel = 0; // 0 = calm, 1 = alert, 2 = engaged
    }

    update(dt, game) {
        if (!this.agent.alive) return;
        if (this.agent.controlledByPlayer) return;

        this.stateTimer -= dt * 1000;
        this.lookTimer -= dt * 1000;

        // Check for visible enemies
        const visibleEnemies = this.getVisibleEnemies(game);

        if (visibleEnemies.length > 0) {
            this.state = AI_STATE.ENGAGE;
            this.targetEnemy = this.pickBestTarget(visibleEnemies);
            this.alertLevel = 2;
            this.lastKnownEnemyPos = { x: this.targetEnemy.x, y: this.targetEnemy.y };
        } else if (this.state === AI_STATE.ENGAGE) {
            // Lost sight of enemy
            if (this.lastKnownEnemyPos) {
                this.state = AI_STATE.PATROL;
                this.setPatrolTarget(this.lastKnownEnemyPos.x, this.lastKnownEnemyPos.y);
                this.lastKnownEnemyPos = null;
            } else {
                this.state = AI_STATE.PATROL;
            }
        }

        switch (this.state) {
            case AI_STATE.IDLE:
                this.doIdle(dt, game);
                break;
            case AI_STATE.PATROL:
                this.doPatrol(dt, game);
                break;
            case AI_STATE.ENGAGE:
                this.doEngage(dt, game);
                break;
            case AI_STATE.OBJECTIVE:
                this.doObjective(dt, game);
                break;
            case AI_STATE.GUARD:
                this.doGuard(dt, game);
                break;
        }
    }

    doIdle(dt, game) {
        // Look around randomly
        if (this.lookTimer <= 0) {
            this.agent.targetAngle += (Math.random() - 0.5) * 1.5;
            this.lookTimer = 1000 + Math.random() * 2000;
        }

        if (this.stateTimer <= 0) {
            // Decide what to do
            if (this.agent.team === 'swat') {
                // SWAT should try to find objectives
                if (Math.random() < 0.7) {
                    this.state = AI_STATE.OBJECTIVE;
                } else {
                    this.state = AI_STATE.PATROL;
                    this.pickRandomPatrolTarget();
                }
            } else {
                // Terrorists should guard objectives
                if (Math.random() < 0.6) {
                    this.state = AI_STATE.GUARD;
                } else {
                    this.state = AI_STATE.PATROL;
                    this.pickRandomPatrolTarget();
                }
            }
            this.stateTimer = 2000 + Math.random() * 3000;
        }
    }

    doPatrol(dt, game) {
        if (!this.agent.path || this.agent.pathIndex >= (this.agent.path?.length || 0)) {
            this.pickRandomPatrolTarget();
            this.stateTimer = 3000 + Math.random() * 4000;
        }

        // Look in movement direction
        if (this.agent.path && this.agent.pathIndex < this.agent.path.length) {
            const next = this.agent.path[this.agent.pathIndex];
            const wx = next.x * TILE_SIZE + TILE_SIZE / 2;
            const wy = next.y * TILE_SIZE + TILE_SIZE / 2;
            this.agent.targetAngle = angleBetween(this.agent.x, this.agent.y, wx, wy);
        }

        if (this.stateTimer <= 0) {
            this.state = AI_STATE.IDLE;
            this.stateTimer = 1000 + Math.random() * 2000;
        }
    }

    doEngage(dt, game) {
        if (!this.targetEnemy || !this.targetEnemy.alive) {
            this.state = AI_STATE.PATROL;
            this.targetEnemy = null;
            return;
        }

        // Face the enemy
        this.agent.targetAngle = angleBetween(this.agent.x, this.agent.y, this.targetEnemy.x, this.targetEnemy.y);

        const d = dist(this.agent.x, this.agent.y, this.targetEnemy.x, this.targetEnemy.y);

        // Try to shoot
        const angleDelta = Math.abs(angleDiff(this.agent.angle, this.agent.targetAngle));
        if (angleDelta < 0.3 && d < this.agent.weapon.range) {
            const bullets = this.agent.shoot(Date.now());
            if (bullets) {
                game.addBullets(bullets);
            }
        }

        // Move to optimal range
        const optimalDist = this.agent.weapon.range * 0.5;
        if (d > optimalDist + 50) {
            // Move closer
            const targetTile = this.map.worldToTile(this.targetEnemy.x, this.targetEnemy.y);
            if (!this.agent.path || this.stateTimer <= 0) {
                this.agent.setMoveTarget(targetTile.x, targetTile.y, this.map);
                this.stateTimer = 500;
            }
        } else if (d < optimalDist - 30) {
            // Move away (retreat)
            const awayAngle = angleBetween(this.targetEnemy.x, this.targetEnemy.y, this.agent.x, this.agent.y);
            const retreatX = this.agent.x + Math.cos(awayAngle) * TILE_SIZE * 3;
            const retreatY = this.agent.y + Math.sin(awayAngle) * TILE_SIZE * 3;
            const rt = this.map.worldToTile(retreatX, retreatY);
            if (this.map.isWalkable(rt.x, rt.y)) {
                this.agent.setMoveTarget(rt.x, rt.y, this.map);
            }
        } else {
            // At good range, strafe
            this.agent.path = null;
        }
    }

    doObjective(dt, game) {
        // SWAT: find and rescue hostages or defuse bomb
        const objectives = [];

        // Add hostages that need rescuing
        for (const h of game.hostages) {
            if (h.alive && !h.rescued && !h.beingCarried) {
                objectives.push({ x: h.x, y: h.y, type: 'hostage', priority: 2 });
            }
        }

        // Add bomb if not defused
        if (game.bomb && !game.bomb.defused) {
            objectives.push({ x: game.bomb.x, y: game.bomb.y, type: 'bomb', priority: 3 });
        }

        if (objectives.length === 0) {
            this.state = AI_STATE.PATROL;
            return;
        }

        // Pick nearest objective
        objectives.sort((a, b) => {
            const da = dist(this.agent.x, this.agent.y, a.x * TILE_SIZE, a.y * TILE_SIZE);
            const db = dist(this.agent.x, this.agent.y, b.x * TILE_SIZE, b.y * TILE_SIZE);
            return (da - b.priority * 50) - (db - a.priority * 50);
        });

        const target = objectives[0];
        const targetTile = { x: target.x, y: target.y };
        const d = dist(this.agent.x, this.agent.y, target.x * TILE_SIZE, target.y * TILE_SIZE);

        if (d < TILE_SIZE * 2) {
            // Close enough to interact
            this.agent.path = null;
            // Auto-interact
            if (target.type === 'hostage') {
                game.tryRescueHostage(this.agent);
            } else if (target.type === 'bomb') {
                game.tryDefuseBomb(this.agent);
            }
        } else if (!this.agent.path || this.stateTimer <= 0) {
            this.agent.setMoveTarget(targetTile.x, targetTile.y, this.map);
            this.stateTimer = 2000;
        }

        // Look in movement direction
        if (this.agent.path && this.agent.pathIndex < this.agent.path.length) {
            const next = this.agent.path[this.agent.pathIndex];
            this.agent.targetAngle = angleBetween(this.agent.x, this.agent.y,
                next.x * TILE_SIZE + TILE_SIZE / 2, next.y * TILE_SIZE + TILE_SIZE / 2);
        }
    }

    doGuard(dt, game) {
        // Terrorists: guard hostages or bomb
        const things = [];
        for (const h of game.hostages) {
            if (h.alive && !h.rescued) things.push({ x: h.x, y: h.y });
        }
        if (game.bomb && !game.bomb.defused) {
            things.push({ x: game.bomb.x, y: game.bomb.y });
        }

        if (things.length === 0) {
            this.state = AI_STATE.PATROL;
            return;
        }

        // Guard nearest objective
        const nearest = things.reduce((best, t) => {
            const d = dist(this.agent.x, this.agent.y, t.x * TILE_SIZE, t.y * TILE_SIZE);
            return d < best.d ? { ...t, d } : best;
        }, { d: Infinity });

        const d = dist(this.agent.x, this.agent.y, nearest.x * TILE_SIZE, nearest.y * TILE_SIZE);

        if (d > TILE_SIZE * 5) {
            // Move closer
            if (!this.agent.path || this.stateTimer <= 0) {
                // Move to a nearby position, not exactly on the objective
                const offset = Math.random() * Math.PI * 2;
                const guardDist = 2 + Math.random() * 3;
                const gx = Math.floor(nearest.x + Math.cos(offset) * guardDist);
                const gy = Math.floor(nearest.y + Math.sin(offset) * guardDist);
                if (this.map.isWalkable(gx, gy)) {
                    this.agent.setMoveTarget(gx, gy, this.map);
                }
                this.stateTimer = 3000;
            }
        } else {
            // At guard position, look around
            this.agent.path = null;
            if (this.lookTimer <= 0) {
                this.agent.targetAngle += (Math.random() - 0.5) * 2;
                this.lookTimer = 800 + Math.random() * 1500;
            }
        }

        if (this.stateTimer <= 0) {
            this.stateTimer = 4000 + Math.random() * 3000;
            // Occasionally switch to patrol
            if (Math.random() < 0.3) this.state = AI_STATE.PATROL;
        }
    }

    getVisibleEnemies(game) {
        const enemies = game.getTeamAgents(this.agent.team === 'swat' ? 'terrorist' : 'swat');
        const visible = [];

        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            const d = dist(this.agent.x, this.agent.y, enemy.x, enemy.y);
            if (d > this.agent.visionRange * TILE_SIZE) continue;

            // Check if within FOV
            const angleToEnemy = angleBetween(this.agent.x, this.agent.y, enemy.x, enemy.y);
            const delta = Math.abs(angleDiff(this.agent.angle, angleToEnemy));
            if (delta > this.agent.visionFov / 2) continue;

            // Check line of sight
            const vis = game.visibility[this.agent.team];
            if (vis && vis.hasLineOfSightWorld(this.agent.x, this.agent.y, enemy.x, enemy.y)) {
                visible.push(enemy);
            }
        }

        return visible;
    }

    pickBestTarget(enemies) {
        // Pick closest enemy
        return enemies.reduce((best, e) => {
            const d = dist(this.agent.x, this.agent.y, e.x, e.y);
            const bestD = dist(this.agent.x, this.agent.y, best.x, best.y);
            return d < bestD ? e : best;
        });
    }

    pickRandomPatrolTarget() {
        // Pick a random room to patrol to
        const room = this.map.rooms[Math.floor(Math.random() * this.map.rooms.length)];
        const tx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const ty = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
        if (this.map.isWalkable(tx, ty)) {
            this.agent.setMoveTarget(tx, ty, this.map);
        }
    }

    setPatrolTarget(wx, wy) {
        const t = this.map.worldToTile(wx, wy);
        if (this.map.isWalkable(t.x, t.y)) {
            this.agent.setMoveTarget(t.x, t.y, this.map);
        }
    }
}
