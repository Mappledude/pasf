export interface BossProfile {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface PlayerProfile {
  id: string;
  codename: string;
  displayName?: string | null;
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
  displayName?: string | null;
  joinedAt?: string;
  authUid?: string;
  profileId?: string;
  lastSeen?: string;
  expireAt?: string;
}

export interface ArenaSeatAssignment {
  seatNo: number;
  playerId: string;
  uid: string;
  joinedAt?: string;
  profileId?: string;
  codename?: string | null;
  displayName?: string | null;
}

export interface LeaderboardEntry {
  id: string;
  playerId: string;
  playerCodename?: string;
  wins: number;
  losses: number;
  streak: number;
  updatedAt: string;
  lastWinAt?: string;
}
