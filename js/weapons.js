/* ===== WEAPON DEFINITIONS ===== */
const WEAPONS = {
    pistol: {
        name: 'Pistol', type: 'pistol',
        damage: 25, fireRate: 400, range: 300, spread: 0.04,
        magSize: 12, reloadTime: 1500, automatic: false,
        sound: 'pistol', color: '#ffcc00'
    },
    smg: {
        name: 'SMG', type: 'smg',
        damage: 18, fireRate: 80, range: 250, spread: 0.08,
        magSize: 30, reloadTime: 2000, automatic: true,
        sound: 'smg', color: '#ff8800'
    },
    shotgun: {
        name: 'Shotgun', type: 'shotgun',
        damage: 12, fireRate: 800, range: 150, pellets: 6, spread: 0.2,
        magSize: 6, reloadTime: 2500, automatic: false,
        sound: 'shotgun', color: '#ff4400'
    },
    rifle: {
        name: 'Rifle', type: 'rifle',
        damage: 35, fireRate: 150, range: 400, spread: 0.03,
        magSize: 25, reloadTime: 2200, automatic: true,
        sound: 'rifle', color: '#44ff00'
    },
    sniper: {
        name: 'Sniper', type: 'sniper',
        damage: 90, fireRate: 1200, range: 600, spread: 0.01,
        magSize: 5, reloadTime: 3000, automatic: false,
        sound: 'sniper', color: '#ff00ff'
    }
};

const WEAPON_KEYS = Object.keys(WEAPONS);

function getRandomWeapon(rng) {
    const key = rng ? rng.pick(WEAPON_KEYS) : WEAPON_KEYS[Math.floor(Math.random() * WEAPON_KEYS.length)];
    return { ...WEAPONS[key], ammo: WEAPONS[key].magSize, reloading: false };
}
