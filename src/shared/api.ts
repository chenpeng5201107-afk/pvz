export interface PublicUser {
  id: number;
  username: string;
  progressRevision: number;
}
export interface CompletionPayload {
  userId: number;
  progressRevision: number;
  level: number;
  stars: number;
  seconds: number;
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
