/* ===== AGENT (CHARACTER) SYSTEM ===== */
const AGENT_RADIUS = 8;
const AGENT_SPEED = 1.8;  // tiles per second in world units
const AGENT_MAX_HP = 100;
const RESPAWN_TIME = 20000; // 20 seconds

class Agent {
    constructor(id, team, x, y, weapon) {
        this.id = id;
        this.team = team; // 'swat' or 'terrorist'
        this.x = x * TILE_SIZE + TILE_SIZE / 2;
        this.y = y * TILE_SIZE + TILE_SIZE / 2;
        this.angle = 0;
        this.targetAngle = 0;
        this.hp = AGENT_MAX_HP;
        this.maxHp = AGENT_MAX_HP;
        this.alive = true;
        this.weapon = weapon;
        this.lastShot = 0;
        this.shooting = false;

        // Vision
        this.visionRange = VISION_RANGE;
        this.visionFov = VISION_FOV;

        // Movement
        this.path = null;
        this.pathIndex = 0;
        this.moveTarget = null;
        this.speed = AGENT_SPEED * TILE_SIZE; // pixels per second
        this.wasdMoving = false;
        this.wasdDx = 0;
        this.wasdDy = 0;

        // State
        this.controlledByPlayer = false;
        this.selected = false;
        this.respawnTimer = 0;
        this.deathTime = 0;

        // Carrying
        this.carryingHostage = null;

        // Visual
        this.flashTimer = 0;
    }

    update(dt, map) {
        if (!this.alive) {
            this.respawnTimer -= dt * 1000;
            return;
        }

        // WASD direct movement
        if (this.wasdMoving && (this.wasdDx !== 0 || this.wasdDy !== 0)) {
            const len = Math.sqrt(this.wasdDx * this.wasdDx + this.wasdDy * this.wasdDy);
            const ndx = this.wasdDx / len;
            const ndy = this.wasdDy / len;
            const newX = this.x + ndx * this.speed * dt;
            const newY = this.y + ndy * this.speed * dt;
            this.tryMove(newX, newY, map);
            this.path = null; // Cancel pathfinding
        }
        // Pathfinding movement
        else if (this.path && this.pathIndex < this.path.length) {
            const target = this.path[this.pathIndex];
            const wx = target.x * TILE_SIZE + TILE_SIZE / 2;
            const wy = target.y * TILE_SIZE + TILE_SIZE / 2;
            const d = dist(this.x, this.y, wx, wy);

            if (d < 3) {
                this.pathIndex++;
            } else {
                const dx = (wx - this.x) / d;
                const dy = (wy - this.y) / d;
                const newX = this.x + dx * this.speed * dt;
                const newY = this.y + dy * this.speed * dt;
                this.tryMove(newX, newY, map);

                // If not controlled by player, face movement direction
                if (!this.controlledByPlayer) {
                    this.targetAngle = Math.atan2(dy, dx);
                }
            }
        }

        // Smoothly rotate towards target angle
        this.angle = lerpAngle(this.angle, this.targetAngle, Math.min(1, dt * 8));

        // Weapon reload
        if (this.weapon.reloading) {
            this.weapon.reloadTimer -= dt * 1000;
            if (this.weapon.reloadTimer <= 0) {
                this.weapon.ammo = this.weapon.magSize;
                this.weapon.reloading = false;
            }
        }

        // Flash timer
        if (this.flashTimer > 0) this.flashTimer -= dt * 1000;
    }

    tryMove(newX, newY, map) {
        // Collision check with tile grid
        const r = AGENT_RADIUS;

        // Check X movement
        const testTile1 = map.worldToTile(newX + r, this.y);
        const testTile2 = map.worldToTile(newX - r, this.y);
        const testTile3 = map.worldToTile(newX, this.y + r);
        const testTile4 = map.worldToTile(newX, this.y - r);

        if (!map.isBlocking(testTile1.x, testTile1.y) && !map.isBlocking(testTile2.x, testTile2.y)) {
            this.x = newX;
        }

        const testTile5 = map.worldToTile(this.x, newY + r);
        const testTile6 = map.worldToTile(this.x, newY - r);
        const testTile7 = map.worldToTile(this.x + r, newY);
        const testTile8 = map.worldToTile(this.x - r, newY);

        if (!map.isBlocking(testTile5.x, testTile5.y) && !map.isBlocking(testTile6.x, testTile6.y)) {
            this.y = newY;
        }

        // Clamp to map bounds
        this.x = clamp(this.x, r, map.width * TILE_SIZE - r);
        this.y = clamp(this.y, r, map.height * TILE_SIZE - r);
    }

    shoot(now) {
        if (!this.alive) return null;
        if (this.weapon.reloading) return null;
        if (now - this.lastShot < this.weapon.fireRate) return null;
        if (this.weapon.ammo <= 0) {
            this.reload();
            return null;
        }

        this.lastShot = now;
        this.weapon.ammo--;
        this.flashTimer = 80;

        const bullets = [];
        const pellets = this.weapon.pellets || 1;

        for (let i = 0; i < pellets; i++) {
            const spread = (Math.random() - 0.5) * this.weapon.spread * 2;
            bullets.push({
                x: this.x,
                y: this.y,
                angle: this.angle + spread,
                damage: this.weapon.damage,
                range: this.weapon.range,
                team: this.team,
                shooterId: this.id,
                speed: 800
            });
        }

        if (this.weapon.ammo <= 0) this.reload();
        return bullets;
    }

    reload() {
        if (this.weapon.reloading) return;
        this.weapon.reloading = true;
        this.weapon.reloadTimer = this.weapon.reloadTime;
    }

    takeDamage(amount) {
        if (!this.alive) return false;
        this.hp -= amount;
        this.flashTimer = 150;
        if (this.hp <= 0) {
            this.hp = 0;
            this.die();
            return true;
        }
        return false;
    }

    die() {
        this.alive = false;
        this.respawnTimer = RESPAWN_TIME;
        this.deathTime = Date.now();
        this.path = null;
        this.carryingHostage = null;
    }

    respawn(x, y) {
        this.alive = true;
        this.hp = this.maxHp;
        this.x = x * TILE_SIZE + TILE_SIZE / 2;
        this.y = y * TILE_SIZE + TILE_SIZE / 2;
        this.weapon.ammo = this.weapon.magSize;
        this.weapon.reloading = false;
        this.carryingHostage = null;
    }

    setMoveTarget(tx, ty, map) {
        const current = map.worldToTile(this.x, this.y);
        const path = findPath(map.walkGrid, current.x, current.y, tx, ty);
        if (path) {
            this.path = path;
            this.pathIndex = 1; // Skip current tile
            this.wasdMoving = false;
        }
    }

    serialize() {
        return {
            id: this.id, team: this.team,
            x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10,
            angle: Math.round(this.angle * 100) / 100,
            hp: this.hp, alive: this.alive,
            weapon: { type: this.weapon.type, name: this.weapon.name, ammo: this.weapon.ammo, reloading: this.weapon.reloading },
            respawnTimer: Math.round(this.respawnTimer),
            carryingHostage: this.carryingHostage
        };
    }

    deserialize(data) {
        this.x = data.x; this.y = data.y;
        this.angle = data.angle; this.targetAngle = data.angle;
        this.hp = data.hp; this.alive = data.alive;
        this.weapon.ammo = data.weapon.ammo;
        this.weapon.reloading = data.weapon.reloading;
        this.respawnTimer = data.respawnTimer;
        this.carryingHostage = data.carryingHostage;
    }
}
