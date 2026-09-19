import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filename = resolve(process.env.PVZ_DATA_DIR ?? resolve(root, 'data'), 'game.sqlite');
if (!existsSync(filename)) {
  console.error('数据库尚未创建，请先启动一次游戏。');
  process.exitCode = 1;
} else {
  const directory = resolve(root, 'backups');
  mkdirSync(directory, { recursive: true });
  const destination = resolve(
    directory,
    `game-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
  );
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    await backup(database, destination);
    console.log(`数据库已备份：${destination}`);
  } finally {
    database.close();
  }
}
