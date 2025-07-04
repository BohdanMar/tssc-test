import { loadFromEnv } from '../../../../utils/util';
import { getRunnerImageFromCIFile } from '../../../../utils/util';
import { CIType } from '../../../core/integration/ci/ciInterface';
import { ContentModifications } from '../../../core/integration/git';
import { BaseCommand } from './baseCommand';

/**
 * Command to update runner image in CI file on Git repositories
 */
export class UpdateCIRunnerImage extends BaseCommand {
  public async execute(): Promise<void> {
    if (process.env['CI_TEST_RUNNER_IMAGE']) {
      this.logStart('Update CI Runner Image For Testing');

      const ciTestRunnerImage = loadFromEnv('CI_TEST_RUNNER_IMAGE');
      const ciFilePathInRepo = await this.ci.getCIFilePathInRepo();

      // Update CI File Path if CITYPE is GITHUB_ACTIONS
      // ci file names are differnt in source and gitops repo for GITHUB_ACTIONS
      const sourceCIFilePath =
        this.ci.getCIType() === CIType.GITHUB_ACTIONS
          ? `${ciFilePathInRepo}/build-and-update-gitops.yml`
          : ciFilePathInRepo;
      const gitopsCIFilePath =
        this.ci.getCIType() === CIType.GITHUB_ACTIONS
          ? `${ciFilePathInRepo}/gitops-promotion.yml`
          : ciFilePathInRepo;

      // Update CI runner image on both repositories
      await Promise.all([
        this.updateCIRunnerImageOnRepo(
          this.git.getSourceRepoName(),
          sourceCIFilePath,
          ciTestRunnerImage
        ),
        this.updateCIRunnerImageOnRepo(
          this.git.getGitOpsRepoName(),
          gitopsCIFilePath,
          ciTestRunnerImage
        ),
      ]);

      this.logComplete(`CI Runner Image Updated`);
    }
  }

  /**
   * Update CI runner image on the specified repository
   * @param repoName The repo name in git
   * @param ciFilePathInRepo The CI file path in git repo
   * @param ciTestRunnerImage The new runner image to replace the existing one in CI file
   */
  private async updateCIRunnerImageOnRepo(
    repoName: string,
    ciFilePathInRepo: string,
    ciTestRunnerImage: string
  ): Promise<void> {
    const branch = 'main'; // Default branch for repo

    // Get content of CI file
    const fileContent = await this.git.getFileContentInString(
      this.git.getRepoOwner(),
      repoName,
      ciFilePathInRepo,
      branch
    );

    // Add the modification
    const contentModifications: ContentModifications = {
      [ciFilePathInRepo]: [
        {
          oldContent: getRunnerImageFromCIFile(fileContent),
          newContent: ciTestRunnerImage,
        },
      ],
    };

    // Commit changes to the repo
    await this.git.commitChangesToRepo(
      this.git.getRepoOwner(),
      repoName,
      contentModifications,
      `Update CI Runner Image to ${ciTestRunnerImage}`,
      branch
    );
  }
}
