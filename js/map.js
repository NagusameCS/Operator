/* ===== PROCEDURAL MAP GENERATION ===== */
const TILE = { VOID: 0, WALL: 1, FLOOR: 2, DOOR: 3, OBSTACLE: 4, WINDOW: 5, SPAWN_SWAT: 6, SPAWN_TERROR: 7 };
const TILE_SIZE = 24;
const MAP_W = 100;
const MAP_H = 75;

class BSPNode {
    constructor(x, y, w, h) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.left = null; this.right = null;
        this.room = null;
    }

    split(rng, depth = 0, maxDepth = 5) {
        if (depth >= maxDepth || this.w < 14 || this.h < 14) {
            // Create room with padding
            const pad = 2;
            const rw = rng.nextInt(Math.max(5, this.w - 8), this.w - pad * 2);
            const rh = rng.nextInt(Math.max(5, this.h - 8), this.h - pad * 2);
            const rx = this.x + rng.nextInt(pad, this.w - rw - pad);
            const ry = this.y + rng.nextInt(pad, this.h - rh - pad);
            this.room = { x: rx, y: ry, w: rw, h: rh, id: -1 };
            return;
        }

        const horizontal = this.w / this.h < 0.8 ? true : (this.w / this.h > 1.2 ? false : rng.next() > 0.5);

        if (horizontal) {
            const split = rng.nextInt(Math.floor(this.h * 0.35), Math.floor(this.h * 0.65));
            this.left = new BSPNode(this.x, this.y, this.w, split);
            this.right = new BSPNode(this.x, this.y + split, this.w, this.h - split);
        } else {
            const split = rng.nextInt(Math.floor(this.w * 0.35), Math.floor(this.w * 0.65));
            this.left = new BSPNode(this.x, this.y, split, this.h);
            this.right = new BSPNode(this.x + split, this.y, this.w - split, this.h);
        }

        this.left.split(rng, depth + 1, maxDepth);
        this.right.split(rng, depth + 1, maxDepth);
    }

    getRooms() {
        if (this.room) return [this.room];
        const rooms = [];
        if (this.left) rooms.push(...this.left.getRooms());
        if (this.right) rooms.push(...this.right.getRooms());
        return rooms;
    }

    getLeafPairs() {
        if (this.room) return [];
        const pairs = [];
        if (this.left && this.right) {
            const leftRooms = this.left.getRooms();
            const rightRooms = this.right.getRooms();
            if (leftRooms.length > 0 && rightRooms.length > 0) {
                // Find closest pair
                let bestDist = Infinity, bestL = null, bestR = null;
                for (const l of leftRooms) {
                    for (const r of rightRooms) {
                        const d = dist(l.x + l.w / 2, l.y + l.h / 2, r.x + r.w / 2, r.y + r.h / 2);
                        if (d < bestDist) { bestDist = d; bestL = l; bestR = r; }
                    }
                }
                pairs.push([bestL, bestR]);
            }
        }
        if (this.left) pairs.push(...this.left.getLeafPairs());
        if (this.right) pairs.push(...this.right.getLeafPairs());
        return pairs;
    }
}

class GameMap {
    constructor(seed) {
        this.seed = seed;
        this.rng = new SeededRNG(seed);
        this.width = MAP_W;
        this.height = MAP_H;
        this.tiles = [];
        this.rooms = [];
        this.corridors = [];
        this.doors = [];
        this.obstacles = [];
        this.spawnSwat = [];
        this.spawnTerror = [];
        this.hostageSlots = []; // Valid positions for hostage placement
        this.bombSlots = [];   // Valid positions for bomb placement
        this.generate();
    }

    generate() {
        // Initialize grid with void
        this.tiles = Array.from({ length: this.height }, () => Array(this.width).fill(TILE.VOID));

        // BSP to generate rooms
        const buildingPad = 8;
        const bsp = new BSPNode(buildingPad, buildingPad, this.width - buildingPad * 2, this.height - buildingPad * 2);
        bsp.split(this.rng, 0, 4);
        this.rooms = bsp.getRooms();

        // Assign room IDs
        this.rooms.forEach((r, i) => r.id = i);

        // Carve rooms
        for (const room of this.rooms) {
            // Walls
            for (let y = room.y; y < room.y + room.h; y++) {
                for (let x = room.x; x < room.x + room.w; x++) {
                    if (y === room.y || y === room.y + room.h - 1 || x === room.x || x === room.x + room.w - 1) {
                        this.tiles[y][x] = TILE.WALL;
                    } else {
                        this.tiles[y][x] = TILE.FLOOR;
                    }
                }
            }
        }

        // Connect rooms with corridors
        const pairs = bsp.getLeafPairs();
        for (const [r1, r2] of pairs) {
            this.carveCorridor(r1, r2);
        }

        // Ensure full connectivity with extra corridors if needed
        this.ensureConnectivity();

        // Add obstacles inside rooms
        for (const room of this.rooms) {
            this.addObstacles(room);
        }

        // Create door tiles where corridors meet room walls
        this.placeDoors();

        // Generate spawn points
        this.generateSpawnPoints();

        // Compute valid hostage/bomb slots (floor tiles inside rooms)
        this.computeObjectiveSlots();

        // Build walkability grid
        this.walkGrid = this.tiles.map(row => row.map(t =>
            (t === TILE.WALL || t === TILE.OBSTACLE || t === TILE.VOID) ? 1 : 0
        ));
    }

    carveCorridor(r1, r2) {
        const cx1 = Math.floor(r1.x + r1.w / 2);
        const cy1 = Math.floor(r1.y + r1.h / 2);
        const cx2 = Math.floor(r2.x + r2.w / 2);
        const cy2 = Math.floor(r2.y + r2.h / 2);

        const corridor = [];

        // L-shaped corridor
        let x = cx1, y = cy1;
        const goHorizontalFirst = this.rng.next() > 0.5;

        if (goHorizontalFirst) {
            while (x !== cx2) {
                x += x < cx2 ? 1 : -1;
                corridor.push({ x, y });
            }
            while (y !== cy2) {
                y += y < cy2 ? 1 : -1;
                corridor.push({ x, y });
            }
        } else {
            while (y !== cy2) {
                y += y < cy2 ? 1 : -1;
                corridor.push({ x, y });
            }
            while (x !== cx2) {
                x += x < cx2 ? 1 : -1;
                corridor.push({ x, y });
            }
        }

        // Carve corridor (width 2)
        for (const p of corridor) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = p.x + dx, ny = p.y + dy;
                    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                    if (Math.abs(dx) + Math.abs(dy) > 1) {
                        // Corner - make wall if void
                        if (this.tiles[ny][nx] === TILE.VOID) {
                            this.tiles[ny][nx] = TILE.WALL;
                        }
                    } else {
                        if (this.tiles[ny][nx] === TILE.VOID || this.tiles[ny][nx] === TILE.WALL) {
                            if (dx === 0 && dy === 0) {
                                this.tiles[ny][nx] = TILE.FLOOR;
                            } else if (this.tiles[ny][nx] === TILE.VOID) {
                                this.tiles[ny][nx] = TILE.WALL;
                            }
                        }
                    }
                }
            }
            if (p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.height) {
                this.tiles[p.y][p.x] = TILE.FLOOR;
            }
        }

        this.corridors.push(corridor);
    }

    ensureConnectivity() {
        // BFS to find connected components
        if (this.rooms.length <= 1) return;

        const visited = new Set();
        const floodFill = (startRoom) => {
            const component = new Set();
            const queue = [startRoom];
            component.add(startRoom.id);
            while (queue.length > 0) {
                const room = queue.shift();
                const cx = Math.floor(room.x + room.w / 2);
                const cy = Math.floor(room.y + room.h / 2);

                // BFS on tile grid from room center
                const tileVisited = new Set();
                const tileQueue = [{ x: cx, y: cy }];
                tileVisited.add(`${cx},${cy}`);

                while (tileQueue.length > 0) {
                    const { x, y } = tileQueue.shift();
                    // Check if this tile is in another room's center area
                    for (const otherRoom of this.rooms) {
                        if (component.has(otherRoom.id)) continue;
                        if (x >= otherRoom.x + 1 && x < otherRoom.x + otherRoom.w - 1 &&
                            y >= otherRoom.y + 1 && y < otherRoom.y + otherRoom.h - 1) {
                            component.add(otherRoom.id);
                            queue.push(otherRoom);
                        }
                    }
                    for (const [ddx, ddy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                        const nx = x + ddx, ny = y + ddy;
                        const k = `${nx},${ny}`;
                        if (tileVisited.has(k)) continue;
                        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                        if (this.tiles[ny][nx] === TILE.FLOOR || this.tiles[ny][nx] === TILE.DOOR) {
                            tileVisited.add(k);
                            tileQueue.push({ x: nx, y: ny });
                        }
                    }
                }
            }
            return component;
        };

        const component0 = floodFill(this.rooms[0]);
        for (const room of this.rooms) {
            if (!component0.has(room.id)) {
                // Connect to nearest room in component0
                let bestDist = Infinity, bestRoom = null;
                for (const other of this.rooms) {
                    if (!component0.has(other.id)) continue;
                    const d = dist(room.x + room.w / 2, room.y + room.h / 2, other.x + other.w / 2, other.y + other.h / 2);
                    if (d < bestDist) { bestDist = d; bestRoom = other; }
                }
                if (bestRoom) {
                    this.carveCorridor(room, bestRoom);
                    component0.add(room.id);
                }
            }
        }
    }

    placeDoors() {
        // Find wall tiles adjacent to both a room floor and a corridor floor
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (this.tiles[y][x] !== TILE.WALL) continue;
                // Check if this wall separates a corridor from a room
                const adj = [
                    { t: this.tiles[y - 1][x], x: x, y: y - 1 },
                    { t: this.tiles[y + 1][x], x: x, y: y + 1 },
                    { t: this.tiles[y][x - 1], x: x - 1, y: y },
                    { t: this.tiles[y][x + 1], x: x + 1, y: y }
                ];
                const floorAdj = adj.filter(a => a.t === TILE.FLOOR);
                if (floorAdj.length >= 2) {
                    // Check if at least one adjacent floor is in a room and another is corridor-like
                    let inRoom = false, outsideRoom = false;
                    for (const a of floorAdj) {
                        let isInAnyRoom = false;
                        for (const room of this.rooms) {
                            if (a.x > room.x && a.x < room.x + room.w - 1 &&
                                a.y > room.y && a.y < room.y + room.h - 1) {
                                isInAnyRoom = true;
                                break;
                            }
                        }
                        if (isInAnyRoom) inRoom = true;
                        else outsideRoom = true;
                    }
                    if (inRoom && outsideRoom && this.rng.next() < 0.7) {
                        this.tiles[y][x] = TILE.DOOR;
                        this.doors.push({ x, y });
                    }
                }
            }
        }
    }

    addObstacles(room) {
        const innerX = room.x + 2;
        const innerY = room.y + 2;
        const innerW = room.w - 4;
        const innerH = room.h - 4;
        if (innerW < 1 || innerH < 1) return;

        const count = this.rng.nextInt(0, Math.floor((room.w * room.h) / 25));
        for (let i = 0; i < count; i++) {
            const ox = this.rng.nextInt(innerX, innerX + innerW - 1);
            const oy = this.rng.nextInt(innerY, innerY + innerH - 1);
            if (this.tiles[oy][ox] === TILE.FLOOR) {
                this.tiles[oy][ox] = TILE.OBSTACLE;
                this.obstacles.push({ x: ox, y: oy, roomId: room.id });
            }
        }
    }

    generateSpawnPoints() {
        // SWAT spawns on the map edges (outside building)
        const edgeFloors = [];
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < 6; y++) {
                if (this.tiles[y]?.[x] !== TILE.WALL && this.tiles[y]?.[x] !== undefined) {
                    edgeFloors.push({ x, y });
                }
            }
            for (let y = this.height - 6; y < this.height; y++) {
                if (this.tiles[y]?.[x] !== TILE.WALL && this.tiles[y]?.[x] !== undefined) {
                    edgeFloors.push({ x, y });
                }
            }
        }
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < 6; x++) {
                if (this.tiles[y]?.[x] !== TILE.WALL) edgeFloors.push({ x, y });
            }
            for (let x = this.width - 6; x < this.width; x++) {
                if (this.tiles[y]?.[x] !== TILE.WALL) edgeFloors.push({ x, y });
            }
        }

        // Place SWAT spawns at edges
        // Pick a random edge side
        const sides = ['top', 'bottom', 'left', 'right'];
        const side = this.rng.pick(sides);
        for (let i = 0; i < 5; i++) {
            let sx, sy;
            switch (side) {
                case 'top': sx = Math.floor(this.width / 2) - 4 + i * 2; sy = 2; break;
                case 'bottom': sx = Math.floor(this.width / 2) - 4 + i * 2; sy = this.height - 3; break;
                case 'left': sx = 2; sy = Math.floor(this.height / 2) - 4 + i * 2; break;
                case 'right': sx = this.width - 3; sy = Math.floor(this.height / 2) - 4 + i * 2; break;
            }
            // Make sure spawn area is floor
            if (this.tiles[sy] && this.tiles[sy][sx] !== TILE.WALL) {
                this.tiles[sy][sx] = TILE.FLOOR;
            }
            this.spawnSwat.push({ x: sx, y: sy });
        }

        // Terrorists spawn inside rooms (pick the largest rooms)
        const sortedRooms = [...this.rooms].sort((a, b) => (b.w * b.h) - (a.w * a.h));
        for (let i = 0; i < 5; i++) {
            const room = sortedRooms[i % sortedRooms.length];
            const sx = Math.floor(room.x + room.w / 2) + (i % 3 - 1);
            const sy = Math.floor(room.y + room.h / 2) + (Math.floor(i / 3) - 1);
            this.spawnTerror.push({ x: sx, y: sy });
        }
    }

    computeObjectiveSlots() {
        for (const room of this.rooms) {
            for (let y = room.y + 2; y < room.y + room.h - 2; y++) {
                for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
                    if (this.tiles[y][x] === TILE.FLOOR) {
                        this.hostageSlots.push({ x, y, roomId: room.id });
                        this.bombSlots.push({ x, y, roomId: room.id });
                    }
                }
            }
        }
    }

    isWalkable(tx, ty) {
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return false;
        const t = this.tiles[ty][tx];
        return t === TILE.FLOOR || t === TILE.DOOR || t === TILE.SPAWN_SWAT || t === TILE.SPAWN_TERROR;
    }

    isBlocking(tx, ty) {
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return true;
        const t = this.tiles[ty][tx];
        return t === TILE.WALL || t === TILE.OBSTACLE || t === TILE.VOID;
    }

    worldToTile(wx, wy) {
        return { x: Math.floor(wx / TILE_SIZE), y: Math.floor(wy / TILE_SIZE) };
    }

    tileToWorld(tx, ty) {
        return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
    }

    getRoomAt(tx, ty) {
        for (const room of this.rooms) {
            if (tx >= room.x && tx < room.x + room.w && ty >= room.y && ty < room.y + room.h) {
                return room;
            }
        }
        return null;
    }
}
