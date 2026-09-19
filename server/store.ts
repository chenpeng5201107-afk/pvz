import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PublicUser, LevelProgress } from '../src/shared/api.ts';

export interface UserRecord extends PublicUser {
  password_hash: string;
  salt: string;
}
export class Store {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at INTEGER NOT NULL);
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
  }
  userByName(username: string): UserRecord | undefined {
    return this.db
      .prepare('SELECT id,username,password_hash,salt FROM users WHERE username_key=?')
      .get(username.toLocaleLowerCase('en-US')) as unknown as UserRecord | undefined;
  }
  addUser(username: string, passwordHash: string, salt: string): PublicUser {
    const result = this.db
      .prepare(
        'INSERT INTO users(username,username_key,password_hash,salt,created_at) VALUES(?,?,?,?,?)',
      )
      .run(username, username.toLocaleLowerCase('en-US'), passwordHash, salt, Date.now());
    return { id: Number(result.lastInsertRowid), username };
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
        'SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?',
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
  close(): void {
    this.db.close();
  }
}
