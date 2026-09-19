export interface PublicUser {
  id: number;
  username: string;
}
export interface LevelProgress {
  level: number;
  stars: number;
  bestSeconds: number;
}
export interface SessionInfo {
  user: PublicUser | null;
  progress: LevelProgress[];
}
