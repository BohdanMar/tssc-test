import { Component } from '../../core/component';
import { GitType } from '../../core/integration/git';
import { AddGitlabProjectVariablesCommand } from './commands/addGitlabProjectVariablesCommand';
import { Command } from './commands/command';
import { UpdateCIRunnerImage } from './commands/updateCIRunnerImage';
import { PostCreateActionStrategy } from './postCreateActionStrategy';

/**
 * GitLab-specific implementation of post-creation action strategy
 * Uses command pattern to organize and execute different actions
 */
export class GitlabCIPostCreateActionStrategy implements PostCreateActionStrategy {
  /**
   * Map of Git provider types to their handler functions
   * This allows for easy extension with new Git providers
   */
  private readonly gitProviderHandlers: Partial<
    Record<GitType, (component: Component) => Promise<void>>
  > = {
    [GitType.GITLAB]: this.handleGitLabActions.bind(this),
  };

  /**
   * Creates a new instance of GitlabCIPostCreateActionStrategy
   */
  constructor() {}

  /**
   * Executes GitLabCI-specific post-creation actions
   * The following is the matrix of supported actions:
   * - GitLab:
   *   - Add environment variables/secrets to GitLab
   * - Github:
   *   - Not supported
   * - Bitbucket:
   *   - Not supported
   * @param component The component being created
   * @throws Error if the Git provider is not supported
   */
  public async execute(component: Component): Promise<void> {
    const git = component.getGit();
    const gitType = git.getGitType();

    const handler = this.gitProviderHandlers[gitType];

    if (!handler) {
      throw new Error(`Unsupported Git provider: ${gitType} for GitLab CI`);
    }

    await handler(component);
  }

  /**
   * Handles actions specific to GitLab repositories
   * @param component The component being created
   */
  private async handleGitLabActions(component: Component): Promise<void> {
    const componentName = component.getName();
    console.log(`Executing post-creation actions for component: ${componentName} (GitLab CI)`);

    try {
      const commands = this.createCommandsForGitLab(component);
      await this.executeCommands(commands);
      console.log(`GitLab CI post-creation actions completed successfully for ${componentName}`);
    } catch (error) {
      console.error(`Error executing GitLab CI post-creation actions: ${error}`);
      throw new Error(
        `GitLab CI post-creation actions failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Creates commands for GitLab integration
   * This factory method can be extended to support different command sets
   *
   * @param component The component for which commands should be created
   * @returns Array of Command instances suitable for GitLab integration
   */
  private createCommandsForGitLab(component: Component): Command[] {
    return [new AddGitlabProjectVariablesCommand(component), new UpdateCIRunnerImage(component)];
  }

  /**
   * Executes a list of commands sequentially
   * @param commands List of commands to execute
   */
  private async executeCommands(commands: Command[]): Promise<void> {
    for (const command of commands) {
      await command.execute();
    }
  }
}
