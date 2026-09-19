import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PublicUser, LevelProgress } from '../src/shared/api.ts';

export interface UserRecord extends PublicUser {
  password_hash: string;
  salt: string;
}
export interface DatabaseUserView extends PublicUser {
  createdAt: number;
  activeSessions: number;
}
export interface DatabaseProgressView extends LevelProgress {
  userId: number;
  username: string;
}
export class Store {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS progress(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,level INTEGER NOT NULL CHECK(level >= 1),stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 3),best_seconds REAL NOT NULL,PRIMARY KEY(user_id,level));`);
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version as number;
    if (version < 1) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // Rebuild the legacy CHECK constraint in one transaction; keep earned records unchanged.
        this.db.exec(`
          CREATE TABLE progress_next(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,level INTEGER NOT NULL CHECK(level >= 1),stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 3),best_seconds REAL NOT NULL,PRIMARY KEY(user_id,level));
          INSERT INTO progress_next SELECT user_id,level,stars,best_seconds FROM progress;
          DROP TABLE progress;
          ALTER TABLE progress_next RENAME TO progress;
          PRAGMA user_version=1;
          COMMIT;
        `);
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.db.close();
        throw error;
      }
    }
    if (version < 2) {
      // Disable foreign keys before the transaction so replacing users cannot cascade into saves.
      this.db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
      try {
        this.db.exec(`
          CREATE TABLE users_next(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at INTEGER NOT NULL);
          INSERT INTO users_next SELECT id,username,username_key,password_hash,salt,created_at FROM users;
          DROP TABLE users;
          ALTER TABLE users_next RENAME TO users;
          PRAGMA user_version=2;
        `);
        if (this.db.prepare('PRAGMA foreign_key_check').all().length)
          throw new Error('账号升级失败：存档关联校验未通过');
        this.db.exec('COMMIT; PRAGMA foreign_keys=ON');
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.db.close();
        throw error;
      }
    }
    if (version < 3) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(`
          ALTER TABLE users ADD COLUMN progress_revision INTEGER NOT NULL DEFAULT 0;
          PRAGMA user_version=3;
          COMMIT;
        `);
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.db.close();
        throw error;
      }
    }
  }
  userByName(username: string): UserRecord | undefined {
    return this.db
      .prepare(
        'SELECT id,username,progress_revision AS progressRevision,password_hash,salt FROM users WHERE username_key=?',
      )
      .get(username.toLocaleLowerCase('en-US')) as unknown as UserRecord | undefined;
  }
  userById(id: number): PublicUser | undefined {
    return this.db
      .prepare('SELECT id,username,progress_revision AS progressRevision FROM users WHERE id=?')
      .get(id) as unknown as PublicUser | undefined;
  }
  addUser(username: string, passwordHash: string, salt: string): PublicUser {
    const result = this.db
      .prepare(
        'INSERT INTO users(username,username_key,password_hash,salt,created_at) VALUES(?,?,?,?,?)',
      )
      .run(username, username.toLocaleLowerCase('en-US'), passwordHash, salt, Date.now());
    return { id: Number(result.lastInsertRowid), username, progressRevision: 0 };
  }
  createSession(tokenHash: string, userId: number, expires: number): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
      .run(tokenHash, userId, expires);
  }
  session(tokenHash: string): PublicUser | undefined {
    return this.db
      .prepare(
        'SELECT users.id,users.username,users.progress_revision AS progressRevision FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?',
      )
      .get(tokenHash, Date.now()) as unknown as PublicUser | undefined;
  }
  logout(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
  }
  progress(userId: number): LevelProgress[] {
    return this.db
      .prepare(
        'SELECT level,stars,best_seconds AS bestSeconds FROM progress WHERE user_id=? ORDER BY level',
      )
      .all(userId) as unknown as LevelProgress[];
  }
  complete(userId: number, level: number, stars: number, seconds: number): LevelProgress[] {
    this.db
      .prepare(
        `INSERT INTO progress(user_id,level,stars,best_seconds) VALUES(?,?,?,?)
      ON CONFLICT(user_id,level) DO UPDATE SET stars=MAX(progress.stars,excluded.stars),best_seconds=MIN(progress.best_seconds,excluded.best_seconds)`,
      )
      .run(userId, level, stars, seconds);
    return this.progress(userId);
  }
  databaseView(): { users: DatabaseUserView[]; progress: DatabaseProgressView[] } {
    const users = this.db
      .prepare(
        `SELECT id,username,progress_revision AS progressRevision,created_at AS createdAt,
         (SELECT COUNT(*) FROM sessions WHERE user_id=users.id AND expires_at>?) AS activeSessions
         FROM users ORDER BY id`,
      )
      .all(Date.now()) as unknown as DatabaseUserView[];
    const progress = this.db
      .prepare(
        `SELECT users.id AS userId,users.username,progress.level,progress.stars,progress.best_seconds AS bestSeconds
         FROM progress JOIN users ON users.id=progress.user_id
         ORDER BY users.id,progress.level`,
      )
      .all() as unknown as DatabaseProgressView[];
    return { users, progress };
  }
  revokeSessions(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  }
  private manageUser(userId: number, change: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      change();
      this.revokeSessions(userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  renameUser(userId: number, username: string): void {
    this.manageUser(userId, () => {
      this.db
        .prepare('UPDATE users SET username=?,username_key=? WHERE id=?')
        .run(username, username.toLocaleLowerCase('en-US'), userId);
    });
  }
  resetPassword(userId: number, hash: string, salt: string): void {
    this.manageUser(userId, () => {
      this.db.prepare('UPDATE users SET password_hash=?,salt=? WHERE id=?').run(hash, salt, userId);
    });
  }
  setProgress(userId: number, level: number, stars: number, seconds: number): void {
    this.manageUser(userId, () => {
      this.db
        .prepare('UPDATE users SET progress_revision=progress_revision+1 WHERE id=?')
        .run(userId);
      this.db
        .prepare(
          `INSERT INTO progress(user_id,level,stars,best_seconds) VALUES(?,?,?,?)
        ON CONFLICT(user_id,level) DO UPDATE SET stars=excluded.stars,best_seconds=excluded.best_seconds`,
        )
        .run(userId, level, stars, seconds);
    });
  }
  resetProgress(userId: number): void {
    this.manageUser(userId, () => {
      this.db
        .prepare('UPDATE users SET progress_revision=progress_revision+1 WHERE id=?')
        .run(userId);
      this.db.prepare('DELETE FROM progress WHERE user_id=?').run(userId);
    });
  }
  deleteUser(userId: number): void {
    // Foreign keys remove this user's progress and sessions in the same statement.
    this.db.prepare('DELETE FROM users WHERE id=?').run(userId);
  }
  close(): void {
    this.db.close();
  }
}
