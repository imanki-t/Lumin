import { userRepo } from '@/core/database/repositories/index.js';
import { UserProfileGraph } from '@/core/database/schema.js';

export class UserProfileGraphManager {
  private static instance: UserProfileGraphManager;

  private constructor() {}

  public static get(): UserProfileGraphManager {
    if (!UserProfileGraphManager.instance) {
      UserProfileGraphManager.instance = new UserProfileGraphManager();
    }
    return UserProfileGraphManager.instance;
  }

  /**
   * Retrieves user profile facts and preferences as formatted context string
   */
  public async getUserContextSnippet(userId: string): Promise<string> {
    const profile = await userRepo.getProfile(userId);
    if (!profile || profile.personalFacts.length === 0) {
      return '';
    }

    const factsList = profile.personalFacts.map((f) => `- ${f.fact}`).join('\n');
    return `[User Profile & Known Facts]:\n${factsList}\n`;
  }

  public async getProfile(userId: string): Promise<UserProfileGraph> {
    return await userRepo.getProfile(userId);
  }

  public async recordInteraction(userId: string): Promise<void> {
    const profile = await userRepo.getProfile(userId);
    await userRepo.updateProfile(userId, {
      totalInteractions: (profile.totalInteractions || 0) + 1,
      lastActiveAt: new Date()
    });
  }

  public async recordGamePlayed(userId: string, game: 'akinator' | 'tds' | 'nhie' | 'wyr', won = false): Promise<void> {
    const profile = await userRepo.getProfile(userId);
    const stats = { ...profile.gameStats };
    if (game === 'akinator') {
      stats.akinatorPlayed = (stats.akinatorPlayed || 0) + 1;
      if (won) stats.akinatorWon = (stats.akinatorWon || 0) + 1;
    } else if (game === 'tds') {
      stats.tdsPlayed = (stats.tdsPlayed || 0) + 1;
    } else if (game === 'nhie') {
      stats.nhiePlayed = (stats.nhiePlayed || 0) + 1;
    } else if (game === 'wyr') {
      stats.wyrPlayed = (stats.wyrPlayed || 0) + 1;
    }

    await userRepo.updateProfile(userId, { gameStats: stats });
  }
}

export const profileManager = UserProfileGraphManager.get();
