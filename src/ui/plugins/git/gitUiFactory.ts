/**
 * Git UI Plugin Factory
 * 
 * Factory class for creating UI-specific Git provider implementations.
 * Handles instantiation of the appropriate UI plugin based on Git provider type.
 */

import { Git, GitType } from '../../../rhtap/core/integration/git/gitInterface';
import { GithubUiPlugin } from './github';
import { GitPlugin } from './gitUiInterface';

export class GitUiFactory {
    /**
     * Creates a Git UI plugin instance based on the Git type.
     * 
     * @param gitType - The type of Git provider (GitHub/GitLab)
     * @param git - The core Git provider instance to wrap
     * @returns A Promise resolving to the appropriate GitPlugin instance
     * @throws Error if the Git type is not supported
     */
    static async createGitPlugin(
        gitType: GitType,
        git: Git
    ): Promise<GitPlugin | undefined> {
        switch (gitType) {
            case GitType.GITHUB:
                return new GithubUiPlugin(git);
            default:
                console.warn(`Unsupported Git type: ${gitType}`);
                return undefined;
        }
    }
}
