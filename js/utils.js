/* ===== SEEDED RNG (Mulberry32) ===== */
class SeededRNG {
    constructor(seed) { this.state = seed | 0; }
    next() {
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    nextInt(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
    nextFloat(min, max) { return this.next() * (max - min) + min; }
    pick(arr) { return arr[this.nextInt(0, arr.length - 1)]; }
    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}

/* ===== MATH UTILITIES ===== */
function dist(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}
function angleBetween(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }
function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}
function angleDiff(a, b) { return normalizeAngle(b - a); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) { return a + angleDiff(a, b) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function randomId() { return Math.random().toString(36).substr(2, 8); }

/* ===== COLLISION ===== */
function pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
}

function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    // Check if line segment intersects rectangle
    const left = lineIntersectsLine(x1, y1, x2, y2, rx, ry, rx, ry + rh);
    const right = lineIntersectsLine(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh);
    const top = lineIntersectsLine(x1, y1, x2, y2, rx, ry, rx + rw, ry);
    const bottom = lineIntersectsLine(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh);
    return left || right || top || bottom;
}

function lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 0.0001) return false;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function raycastHit(x1, y1, angle, maxDist, checkFn, step = 2) {
    const dx = Math.cos(angle) * step;
    const dy = Math.sin(angle) * step;
    let x = x1, y = y1;
    const steps = Math.ceil(maxDist / step);
    for (let i = 0; i < steps; i++) {
        x += dx; y += dy;
        const result = checkFn(x, y);
        if (result) return { x, y, dist: dist(x1, y1, x, y), hit: result };
    }
    return { x, y, dist: maxDist, hit: null };
}

/* ===== A* PATHFINDING ===== */
function findPath(grid, sx, sy, ex, ey, maxIter = 2000) {
    const W = grid[0].length, H = grid.length;
    sx = clamp(Math.floor(sx), 0, W - 1);
    sy = clamp(Math.floor(sy), 0, H - 1);
    ex = clamp(Math.floor(ex), 0, W - 1);
    ey = clamp(Math.floor(ey), 0, H - 1);

    if (grid[ey][ex] === 1) return null; // Target is wall
    if (sx === ex && sy === ey) return [{ x: ex, y: ey }];

    const key = (x, y) => y * W + x;
    const open = new Map();
    const closed = new Set();
    const gScore = new Map();
    const parent = new Map();

    const h = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);
    const startKey = key(sx, sy);
    gScore.set(startKey, 0);
    open.set(startKey, h(sx, sy));

    const dirs = [
        [0, -1], [1, 0], [0, 1], [-1, 0],
        [1, -1], [1, 1], [-1, 1], [-1, -1]
    ];

    let iterations = 0;
    while (open.size > 0 && iterations < maxIter) {
        iterations++;
        // Find lowest f-score
        let bestKey = null, bestF = Infinity;
        for (const [k, f] of open) {
            if (f < bestF) { bestF = f; bestKey = k; }
        }
        const cx = bestKey % W, cy = Math.floor(bestKey / W);
        if (cx === ex && cy === ey) {
            // Reconstruct path
            const path = [];
            let k = bestKey;
            while (k !== undefined) {
                path.unshift({ x: k % W, y: Math.floor(k / W) });
                k = parent.get(k);
            }
            return path;
        }

        open.delete(bestKey);
        closed.add(bestKey);

        for (const [ddx, ddy] of dirs) {
            const nx = cx + ddx, ny = cy + ddy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            if (grid[ny][nx] === 1) continue; // Wall
            const nk = key(nx, ny);
            if (closed.has(nk)) continue;

            // Diagonal: check both adjacent cells are passable
            if (ddx !== 0 && ddy !== 0) {
                if (grid[cy][cx + ddx] === 1 || grid[cy + ddy][cx] === 1) continue;
            }

            const cost = ddx !== 0 && ddy !== 0 ? 1.414 : 1;
            const ng = gScore.get(bestKey) + cost;
            if (!gScore.has(nk) || ng < gScore.get(nk)) {
                gScore.set(nk, ng);
                parent.set(nk, bestKey);
                open.set(nk, ng + h(nx, ny));
            }
        }
    }
    return null; // No path found
}

/* ===== BRESENHAM LINE (for visibility) ===== */
function bresenhamLine(x0, y0, x1, y1) {
    const points = [];
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
        points.push({ x: x0, y: y0 });
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return points;
}

/* ===== GENERATE PARTY CODE ===== */
function generatePartyCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}
