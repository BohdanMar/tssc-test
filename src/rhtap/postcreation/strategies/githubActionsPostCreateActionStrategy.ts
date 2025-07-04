import { Component } from '../../core/component';
import { GitType } from '../../core/integration/git';
import { AddGithubSecretsAndVariablesCommand } from './commands/addGithubSecretsAndVariablesCommand';
import { Command } from './commands/command';
import { UpdateCIRunnerImage } from './commands/updateCIRunnerImage';
import { PostCreateActionStrategy } from './postCreateActionStrategy';

export class GithubActionsPostCreateActionStrategy implements PostCreateActionStrategy {
  private readonly gitProviderHandlers: Partial<
    Record<GitType, (component: Component) => Promise<void>>
  > = {
    [GitType.GITHUB]: this.handleGithubProviderActions.bind(this),
  };

  public async execute(component: Component): Promise<void> {
    const git = component.getGit();
    const gitType = git.getGitType();

    const handler = this.gitProviderHandlers[gitType];

    if (!handler) {
      throw new Error(`Unsupported Git provider: ${gitType} for GitHub Actions`);
    }

    await handler(component);
  }

  private async handleGithubProviderActions(component: Component): Promise<void> {
    const componentName = component.getName();
    const commands: Command[] = [
      new AddGithubSecretsAndVariablesCommand(component),
      new UpdateCIRunnerImage(component),
    ];
    for (const command of commands) {
      await command.execute();
    }
    console.log(
      `No post-creation actions needed for component: ${componentName} (GitHub + GitHub Actions)`
    );
  }
}
