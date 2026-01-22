const Database = require('better-sqlite3');
const db = new Database('vaultquest.db');

// Enable WAL mode for performance
db.pragma('journal_mode = WAL');

// Users table
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        wallet INTEGER DEFAULT 0,
        vault INTEGER DEFAULT 0,
        vault_capacity INTEGER DEFAULT 5000,
        security_level INTEGER DEFAULT 1,
        last_daily INTEGER DEFAULT 0,
        last_work INTEGER DEFAULT 0,
        ink_bomb_until INTEGER DEFAULT 0,
        faction_id TEXT
    )
`).run();

// Factions table
db.prepare(`
    CREATE TABLE IF NOT EXISTS factions (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        owner_id TEXT,
        vault INTEGER DEFAULT 0,
        last_interest INTEGER DEFAULT 0
    )
`).run();

// Businesses table
db.prepare(`
    CREATE TABLE IF NOT EXISTS businesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        type TEXT,
        last_claim INTEGER,
        sabotaged_until INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
`).run();

// Inventory table
db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        item_id TEXT,
        durability INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
`).run();

// Bounties table
db.prepare(`
    CREATE TABLE IF NOT EXISTS bounties (
        user_id TEXT PRIMARY KEY,
        amount INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
`).run();

// Territory table
db.prepare(`
    CREATE TABLE IF NOT EXISTS territory (
        channel_id TEXT PRIMARY KEY,
        faction_id TEXT,
        FOREIGN KEY(faction_id) REFERENCES factions(id)
    )
`).run();

// Helper to get user or create if not exists
const getUser = (userId) => {
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
        db.prepare('INSERT INTO users (id) VALUES (?)').run(userId);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }
    return user;
};

// Helper for transactions
const transaction = (fn) => {
    const execute = db.transaction(fn);
    return execute();
};

module.exports = {
    db,
    getUser,
    transaction
};
