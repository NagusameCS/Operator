/* ===== VISIBILITY / FOG OF WAR SYSTEM ===== */
const VISION_RANGE = 12; // tiles
const VISION_FOV = Math.PI * 0.6; // 108 degrees field of view

class VisibilitySystem {
    constructor(map) {
        this.map = map;
        this.visibleTiles = Array.from({ length: map.height }, () => new Uint8Array(map.width));
        this.exploredTiles = Array.from({ length: map.height }, () => new Uint8Array(map.width));
    }

    reset() {
        for (let y = 0; y < this.map.height; y++) {
            this.visibleTiles[y].fill(0);
        }
    }

    computeForAgents(agents) {
        this.reset();
        for (const agent of agents) {
            if (!agent.alive) continue;
            this.computeForAgent(agent);
        }
    }

    computeForAgent(agent) {
        const tile = this.map.worldToTile(agent.x, agent.y);
        const range = agent.visionRange || VISION_RANGE;
        const fov = agent.visionFov || VISION_FOV;

        // Always see own tile
        if (tile.y >= 0 && tile.y < this.map.height && tile.x >= 0 && tile.x < this.map.width) {
            this.visibleTiles[tile.y][tile.x] = 1;
            this.exploredTiles[tile.y][tile.x] = 1;
        }

        // Cast rays in the vision cone
        const numRays = Math.ceil(fov * range * 2); // Enough rays for coverage
        const startAngle = agent.angle - fov / 2;
        const step = fov / numRays;

        for (let i = 0; i <= numRays; i++) {
            const rayAngle = startAngle + step * i;
            this.castRay(tile.x, tile.y, rayAngle, range);
        }

        // Also add a small 360-degree awareness radius (close range)
        const awarenessRange = 3;
        for (let dy = -awarenessRange; dy <= awarenessRange; dy++) {
            for (let dx = -awarenessRange; dx <= awarenessRange; dx++) {
                if (dx * dx + dy * dy > awarenessRange * awarenessRange) continue;
                const nx = tile.x + dx, ny = tile.y + dy;
                if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
                if (this.hasLineOfSight(tile.x, tile.y, nx, ny)) {
                    this.visibleTiles[ny][nx] = 1;
                    this.exploredTiles[ny][nx] = 1;
                }
            }
        }
    }

    castRay(startX, startY, angle, range) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        let x = startX + 0.5;
        let y = startY + 0.5;

        for (let i = 0; i < range; i++) {
            const tx = Math.floor(x);
            const ty = Math.floor(y);

            if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) break;

            this.visibleTiles[ty][tx] = 1;
            this.exploredTiles[ty][tx] = 1;

            // Check if this tile blocks vision
            if (this.map.isBlocking(tx, ty)) break;

            x += dx;
            y += dy;
        }
    }

    hasLineOfSight(x0, y0, x1, y1) {
        const points = bresenhamLine(x0, y0, x1, y1);
        for (let i = 1; i < points.length - 1; i++) {
            if (this.map.isBlocking(points[i].x, points[i].y)) return false;
        }
        return true;
    }

    hasLineOfSightWorld(wx0, wy0, wx1, wy1) {
        const t0 = this.map.worldToTile(wx0, wy0);
        const t1 = this.map.worldToTile(wx1, wy1);
        return this.hasLineOfSight(t0.x, t0.y, t1.x, t1.y);
    }

    isTileVisible(tx, ty) {
        if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) return false;
        return this.visibleTiles[ty][tx] === 1;
    }

    isTileExplored(tx, ty) {
        if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) return false;
        return this.exploredTiles[ty][tx] === 1;
    }

    isWorldPosVisible(wx, wy) {
        const t = this.map.worldToTile(wx, wy);
        return this.isTileVisible(t.x, t.y);
    }

    // Get vision cone polygon for rendering (returns array of points)
    getVisionConePoints(agent, numRays = 30) {
        const points = [{ x: agent.x, y: agent.y }];
        const range = (agent.visionRange || VISION_RANGE) * TILE_SIZE;
        const fov = agent.visionFov || VISION_FOV;
        const startAngle = agent.angle - fov / 2;
        const step = fov / numRays;

        for (let i = 0; i <= numRays; i++) {
            const a = startAngle + step * i;
            const dx = Math.cos(a);
            const dy = Math.sin(a);

            // Ray march
            let hitDist = range;
            for (let d = 0; d < range; d += TILE_SIZE / 2) {
                const wx = agent.x + dx * d;
                const wy = agent.y + dy * d;
                const t = this.map.worldToTile(wx, wy);
                if (this.map.isBlocking(t.x, t.y)) {
                    hitDist = d;
                    break;
                }
            }

            points.push({
                x: agent.x + dx * hitDist,
                y: agent.y + dy * hitDist
            });
        }

        return points;
    }
}
