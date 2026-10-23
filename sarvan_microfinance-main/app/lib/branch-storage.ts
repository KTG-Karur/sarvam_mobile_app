/**
 * Branch Storage Utility
 * Handles storing and retrieving the selected/active branch from localStorage
 */

const ACTIVE_BRANCH_KEY = 'activeBranch';

export interface StoredBranch {
  id: string;
  name: string;
  code: string;
  address?: string | null;
}

export const branchStorage = {
  /**
   * Set the active branch
   */
  setActiveBranch(branch: StoredBranch): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ACTIVE_BRANCH_KEY, JSON.stringify(branch));
    }
  },

  /**
   * Get the active branch
   */
  getActiveBranch(): StoredBranch | null {
    if (typeof window !== 'undefined') {
      const branchStr = localStorage.getItem(ACTIVE_BRANCH_KEY);
      if (branchStr) {
        try {
          return JSON.parse(branchStr) as StoredBranch;
        } catch {
          return null;
        }
      }
    }
    return null;
  },

  /**
   * Clear the active branch
   */
  clearActiveBranch(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACTIVE_BRANCH_KEY);
    }
  },
};
