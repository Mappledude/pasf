export interface BossProfile {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface PlayerProfile {
  id: string;
  codename: string;
  createdAt: string;
  lastActiveAt?: string;
}

export interface Arena {
  id: string;
  name: string;
  description?: string;
  capacity?: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface ArenaPresenceEntry {
  playerId: string;
  codename: string;
  joinedAt?: string;
  authUid?: string;
  profileId?: string;
}

export interface LeaderboardEntry {
  id: string;
  playerId: string;
  playerCodename?: string;
  wins: number;
  losses: number;
  streak: number;
  updatedAt: string;
}
