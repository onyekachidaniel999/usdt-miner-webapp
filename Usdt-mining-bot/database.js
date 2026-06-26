const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'mining_bot.db');
const db = new Database(DB_PATH);

const REFERRAL_MILESTONES = {
  3: 50, 5: 90, 10: 220, 20: 470,
  50: 1200, 100: 2500, 200: 5000, 500: 10000,
};

// ── Init ──────────────────────────────────────────────────────────────────────
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id         INTEGER PRIMARY KEY,
      username        TEXT,
      full_name       TEXT,
      ghs             REAL    DEFAULT 220,
      balance         REAL    DEFAULT 0.0,
      mining_start    INTEGER DEFAULT 0,
      last_ad_watch   INTEGER DEFAULT 0,
      referred_by     INTEGER DEFAULT NULL,
      referral_count  INTEGER DEFAULT 0,
      wallet_address  TEXT    DEFAULT NULL,
      joined_at       INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER,
      amount          REAL,
      wallet          TEXT,
      status          TEXT DEFAULT 'pending',
      requested_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS claimed_milestones (
      user_id         INTEGER,
      milestone       INTEGER,
      PRIMARY KEY (user_id, milestone)
    );
  `);
}

// ── Users ─────────────────────────────────────────────────────────────────────
function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

function createUser(userId, username, fullName, referredBy = null) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO users (user_id, username, full_name, ghs, referred_by, joined_at)
    VALUES (?, ?, ?, 220, ?, ?)
  `).run(userId, username, fullName, referredBy, now);

  if (referredBy) creditReferral(referredBy);
}

function creditReferral(referrerId) {
  db.prepare(`
    UPDATE users SET ghs = ghs + 15, referral_count = referral_count + 1
    WHERE user_id = ?
  `).run(referrerId);

  const row = db.prepare('SELECT referral_count FROM users WHERE user_id = ?').get(referrerId);
  if (!row) return;

  for (const [milestone, bonus] of Object.entries(REFERRAL_MILESTONES)) {
    if (row.referral_count >= parseInt(milestone)) {
      grantMilestone(referrerId, parseInt(milestone), bonus);
    }
  }
}

function grantMilestone(userId, milestone, bonus) {
  try {
    db.prepare('INSERT INTO claimed_milestones (user_id, milestone) VALUES (?, ?)').run(userId, milestone);
    db.prepare('UPDATE users SET ghs = ghs + ? WHERE user_id = ?').run(bonus, userId);
  } catch (_) { /* already granted */ }
}

// ── Mining ────────────────────────────────────────────────────────────────────
function startMining(userId) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE users SET mining_start = ? WHERE user_id = ?').run(now, userId);
}

function claimMining(userId, earned) {
  db.prepare('UPDATE users SET balance = balance + ?, mining_start = 0 WHERE user_id = ?').run(earned, userId);
}

function addGhs(userId, amount) {
  db.prepare('UPDATE users SET ghs = ghs + ? WHERE user_id = ?').run(amount, userId);
}

function updateAdWatch(userId) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE users SET last_ad_watch = ? WHERE user_id = ?').run(now, userId);
}

// ── Wallet & Withdrawal ───────────────────────────────────────────────────────
function setWallet(userId, wallet) {
  db.prepare('UPDATE users SET wallet_address = ? WHERE user_id = ?').run(wallet, userId);
}

function createWithdrawal(userId, amount, wallet) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO withdrawals (user_id, amount, wallet, requested_at) VALUES (?, ?, ?, ?)').run(userId, amount, wallet, now);
  db.prepare('UPDATE users SET balance = balance - ? WHERE user_id = ?').run(amount, userId);
}

function getPendingWithdrawals() {
  return db.prepare(`
    SELECT w.*, u.username, u.full_name FROM withdrawals w
    JOIN users u ON w.user_id = u.user_id
    WHERE w.status = 'pending' ORDER BY w.requested_at ASC
  `).all();
}

function getWithdrawalById(id) {
  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
}

function updateWithdrawalStatus(id, status) {
  db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').run(status, id);
}

function refundWithdrawal(userId, amount) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?').run(amount, userId);
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function getTopUsers(limit = 10) {
  return db.prepare('SELECT full_name, balance, ghs FROM users ORDER BY balance DESC LIMIT ?').all(limit);
}

module.exports = {
  initDb, getUser, createUser, startMining, claimMining,
  addGhs, updateAdWatch, setWallet, createWithdrawal,
  getPendingWithdrawals, getWithdrawalById, updateWithdrawalStatus,
  refundWithdrawal, getTopUsers, REFERRAL_MILESTONES,
};
