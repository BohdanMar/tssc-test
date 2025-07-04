import { GitLabClient } from '../../../../../../src/api/git/gitlabClient';
import { KubeClient } from '../../../../../../src/api/ocp/kubeClient';
import { Environment } from '../../cd/argocd';
import { BaseGitProvider } from '../baseGitProvider';
import { GitType } from '../gitInterface';
import { PullRequest } from '../models';
import {
  ContentModifications,
  ITemplate,
  TemplateFactory,
  TemplateType,
} from '../templates/templateFactory';

/**
 * GitLab provider class
 *
 * This class implements the Git interface for GitLab repositories.
 */
export class GitlabProvider extends BaseGitProvider {
  private gitlabClient!: GitLabClient;
  private template!: ITemplate;
  private baseUrl: string = '';

  constructor(componentName: string, templateType: TemplateType, kubeClient: KubeClient) {
    super(componentName, GitType.GITLAB, kubeClient);
    this.template = TemplateFactory.createTemplate(templateType);
    // Initialization happens when initialize() is called explicitly by GitFactory
  }

  /**
   * Initialize GitLab client with token
   * @returns Promise with GitLab client
   */
  private async initGitlabClient(): Promise<GitLabClient> {
    const gitlabToken = this.getToken();
    const hostname = this.getHost();
    this.baseUrl = `https://${hostname}`;

    // Initialize the GitLab client with the base URL and token
    const gitlabClient = new GitLabClient({
      token: gitlabToken,
      baseUrl: this.baseUrl,
    });
    return gitlabClient;
  }

  /**
   * Initialize the GitLab provider
   * This method is called explicitly by GitFactory after creating an instance
   */
  public async initialize(): Promise<void> {
    this.secret = await this.loadSecret();
    this.gitlabClient = await this.initGitlabClient();
  }

  public getGroup(): string {
    if (!this.secret?.group) {
      throw new Error('GitLab group not found in the secret. Please ensure the group is provided.');
    }
    return this.secret.group;
  }

  /**
   * Loads GitLab integration secrets from Kubernetes
   * @returns Promise with the secret data
   */
  protected async loadSecret(): Promise<Record<string, string>> {
    const secret = await this.kubeClient.getSecret('tssc-gitlab-integration', 'tssc');
    if (!secret) {
      throw new Error(
        'GitLab token secret not found in the cluster. Please ensure the secret exists.'
      );
    }
    return secret;
  }

  public getToken(): string {
    if (!this.secret?.token) {
      throw new Error('GitLab token not found in the secret. Please ensure the token is provided.');
    }
    return this.secret.token;
  }

  public getClientID(): string {
    if (!this.secret?.clientId) {
      throw new Error(
        'Client ID not found in the secret. Please ensure the client ID is provided.'
      );
    }
    return this.secret.clientId;
  }

  public getClientSecret(): string {
    if (!this.secret?.clientSecret) {
      throw new Error(
        'Client secret not found in the secret. Please ensure the client secret is provided.'
      );
    }
    return this.secret.clientSecret;
  }

  public getWebhookSecret(): string {
    if (!this.secret?.webhookSecret) {
      throw new Error(
        'Webhook secret not found in the secret. Please ensure the webhook secret is provided.'
      );
    }
    return this.secret.webhookSecret;
  }

  public override async getFileContentInString(
    owner: string,
    repo: string,
    filePath: string,
    branch: string
  ): Promise<string> {
    try {
      const project = await this.gitlabClient.getProject(`${owner}/${repo}`);
      const projectId = project.id;

      console.log(`Getting File Contents of ${filePath} in repo ${repo}`);
      // Get the current content of the deployment patch file
      const fileContent = await this.gitlabClient.getFileContent(projectId, filePath, branch);

      // Decode the content from base64
      return Buffer.from(fileContent.content, 'base64').toString('utf-8');
    } catch (error: any) {
      console.error(`Error getting file contents of ${filePath} in repo ${repo}:${error.message}`);
      throw error;
    }
  }

  /**
   * Creates a direct commit to the gitops repository to update the image for a specific environment
   * @param environment The target environment for promotion (e.g., 'development', 'stage', 'prod')
   * @param image The new image to be deployed (full image URL with tag)
   * @returns Promise with the commit SHA
   */
  public override async createPromotionCommitOnGitOpsRepo(
    environment: Environment,
    image: string
  ): Promise<string> {
    if (!environment) {
      throw new Error('Environment cannot be null.');
    }
    if (image === '') {
      throw new Error('Image cannot be empty.');
    }

    const branch = 'main'; // Default branch for GitOps repo
    const commitMessage = `Update ${environment} environment to image ${image}`;

    // The file path in the gitops repository to be modified
    const filePath = `components/${this.componentName}/overlays/${environment}/deployment-patch.yaml`;

    const contentModifications: ContentModifications = {};

    try {
      console.log(`Creating a direct promotion commit for environment: ${environment}`);

      const currentContent = await this.getFileContentInString(
        this.getGroup(),
        this.gitOpsRepoName,
        filePath,
        branch
      );

      // Parse the content to find the current image line
      const lines = currentContent.split('\n');
      let imageLineIndex = -1;
      let oldImageLine = '';

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('- image:')) {
          imageLineIndex = i;
          oldImageLine = lines[i];
          break;
        }
      }

      if (imageLineIndex === -1) {
        throw new Error(`Could not find image line in file: ${filePath}`);
      }

      // Create the new image line with the same indentation
      const indentation = oldImageLine.match(/^\s*/)?.[0] || '';
      const newImageLine = `${indentation}- image: ${image}`;

      // Add the modification
      contentModifications[filePath] = [
        {
          oldContent: oldImageLine,
          newContent: newImageLine,
        },
      ];

      console.log(`Will update image from "${oldImageLine.trim()}" to "${newImageLine.trim()}"`);

      // Use the common commit method
      const commitSha = await this.commitChangesToRepo(
        this.getGroup(),
        this.gitOpsRepoName,
        contentModifications,
        commitMessage,
        branch
      );

      console.log(
        `Successfully created direct promotion commit (${commitSha.substring(0, 7)}) for ${environment} environment`
      );
      return commitSha;
    } catch (error: any) {
      console.error(`Error creating promotion commit for ${environment}: ${error.message}`);
      throw error;
    }
  }
  /**
   * Merges a pull request in the GitLab repository and returns the updated PR
   * with merge information
   *
   * @param pullRequest The pull request to merge
   * @returns Updated PullRequest object with merge information
   */
  public override async mergePullRequest(pullRequest: PullRequest): Promise<PullRequest> {
    if (!pullRequest) {
      throw new Error('Pull request cannot be null.');
    }

    console.log(`Merging merge request #${pullRequest.pullNumber}...`);

    // if pullRequest is already merged, return it
    if (pullRequest.isMerged) {
      console.log(`Merge request #${pullRequest.pullNumber} is already merged.`);
      return pullRequest;
    }

    try {
      // Find the project ID for the repository using direct path lookup (more efficient)
      let projectId;
      try {
        const project = await this.gitlabClient.getProject(
          `${this.getGroup()}/${pullRequest.repository}`
        );
        projectId = project.id;
      } catch (error) {
        throw new Error(`Project ${this.getGroup()}/${pullRequest.repository} not found`);
      }

      // Execute the merge operation using the GitLabClient
      const mergeResponse = await this.gitlabClient.mergeMergeRequest(
        projectId,
        pullRequest.pullNumber,
        {
          shouldRemoveSourceBranch: true, // Clean up by removing the source branch
          mergeCommitMessage: `Merge request #${pullRequest.pullNumber}`, // Custom merge commit message
        }
      );

      console.log(
        `Merge request #${pullRequest.pullNumber} merged successfully with merge commit SHA: ${mergeResponse.mergeCommitSha}`
      );

      // Create a new PR object with the updated merge information
      const mergedPR = new PullRequest(
        pullRequest.pullNumber,
        mergeResponse.mergeCommitSha, // Use the merge commit SHA
        pullRequest.repository,
        true, // Mark as merged
        new Date().toISOString() // Set merge timestamp
      );

      return mergedPR;
    } catch (error: unknown) {
      console.error(`Failed to merge merge request #${pullRequest.pullNumber}: ${error}`);
      throw error;
    }
  }
  /**
   * Creates a promotion pull request in the gitops repository to move changes between environments
   * @param environment The target environment for promotion (e.g., 'development', 'stage', 'prod')
   * @param image The new image to be deployed (full image URL with tag)
   * @returns Promise with the created pull request details
   */
  public override async createPromotionPullRequestOnGitopsRepo(
    environment: Environment,
    image: string
  ): Promise<PullRequest> {
    if (!environment) {
      throw new Error('Environment cannot be null.');
    }
    if (image === '') {
      throw new Error('Image cannot be empty.');
    }

    const newBranchName = `promote-to-${environment}-${Date.now()}`;
    const title = `Promote to ${environment} environment`;
    const description = `This MR promotes the application to the ${environment} environment with image: ${image}`;
    const baseBranch = 'main'; // Default base branch

    // The file path in the gitops repository to be modified
    const filePath = `components/${this.componentName}/overlays/${environment}/deployment-patch.yaml`;

    const contentModifications: ContentModifications = {};

    try {
      const currentContent = await this.getFileContentInString(
        this.getGroup(),
        this.gitOpsRepoName,
        filePath,
        baseBranch
      );

      // Parse the content to find the current image line
      const lines = currentContent.split('\n');
      let imageLineIndex = -1;
      let oldImageLine = '';

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('- image:')) {
          imageLineIndex = i;
          oldImageLine = lines[i];
          break;
        }
      }

      if (imageLineIndex === -1) {
        throw new Error(`Could not find image line in file: ${filePath}`);
      }

      // Create the new image line with the same indentation
      const indentation = oldImageLine.match(/^\s*/)?.[0] || '';
      const newImageLine = `${indentation}- image: ${image}`;

      // Add the modification
      contentModifications[filePath] = [
        {
          oldContent: oldImageLine,
          newContent: newImageLine,
        },
      ];

      console.log(`Creating a promotion PR for environment: ${environment}`);
      console.log(`Will update image from "${oldImageLine.trim()}" to "${newImageLine.trim()}"`);

      // Create a merge request with the changes
      const result = await this.gitlabClient.createMergeRequest(
        this.getGroup(),
        this.gitOpsRepoName,
        this.getGroup(),
        baseBranch,
        newBranchName,
        contentModifications,
        title,
        description
      );

      // Extract the merge request ID and commit SHA
      const { prNumber, commitSha } = result;

      console.log(`Successfully created promotion MR #${prNumber} for ${environment} environment`);
      return new PullRequest(prNumber, commitSha, this.gitOpsRepoName);
    } catch (error: any) {
      console.error(`Error creating promotion PR for ${environment}: ${error.message}`);
      throw error;
    }
  }
  /**
   * Extracts the application image from the deployment patch in the GitOps repo
   * @param environment The environment to extract the image from
   * @returns Promise with the image string
   */
  public override async extractApplicationImage(environment: Environment): Promise<string> {
    if (!environment) {
      throw new Error('Environment cannot be null.');
    }

    const filePath = `components/${this.componentName}/overlays/${environment}/deployment-patch.yaml`;
    console.log(`Extracting application image from file: ${filePath}`);

    try {
      // Find the GitOps project ID using direct path lookup (more efficient)
      let projectId;
      try {
        const project = await this.gitlabClient.getProject(
          `${this.getGroup()}/${this.gitOpsRepoName}`
        );
        projectId = project.id;
      } catch (error) {
        throw new Error(`GitOps project ${this.getGroup()}/${this.gitOpsRepoName} not found`);
      }

      // Use a regex pattern that can handle both inline and multi-line image formats
      // Pattern explanation:
      // 1. (?:^|\s+)- image:(?:\s+(.+)$)? - Matches '- image:' with optional value on same line
      // 2. |\s+- image:$\s+(.+)$ - Matches '- image:' with value on next line (indented)
      const imagePattern = /(?:^|\s+)-\s+image:(?:\s+(.+)$)?|(^\s+.+$)/gm;

      const matches = await this.gitlabClient.extractContentByRegex(
        projectId,
        filePath,
        imagePattern,
        'main'
      );

      if (!matches || matches.length === 0) {
        throw new Error(`No image value found in file: ${filePath}`);
      }

      // Process the matches to extract the actual image URL
      let imageValue = '';

      // Check if we have a direct match with '- image: value'
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (match.includes('- image:')) {
          // This is a line with "- image:" that might have the value directly
          const parts = match.split('- image:');
          if (parts.length > 1 && parts[1].trim()) {
            imageValue = parts[1].trim();
            break;
          } else if (i + 1 < matches.length && !matches[i + 1].includes('- image:')) {
            // If this line just has "- image:" and next line doesn't have "- image:",
            // assume next line is the image value
            imageValue = matches[i + 1].trim();
            break;
          }
        }
      }

      if (!imageValue) {
        throw new Error(`Could not parse image value from matches in file: ${filePath}`);
      }

      console.log(`Extracted image from ${filePath}: ${imageValue}`);
      return imageValue;
    } catch (error: any) {
      console.error(`Error extracting application image: ${error.message}`);
      throw error;
    }
  }
  /**
   * Creates a sample pull request with modifications based on template type in the source repository
   *
   * @returns {Promise<PullRequest>} - Returns a PullRequest object with pull number and commit SHA
   */
  public override async createSamplePullRequestOnSourceRepo(): Promise<PullRequest> {
    const newBranchName = 'test-branch-' + Date.now();
    const title = 'Test MR from TSSC e2e test';
    const description = 'This MR was created automatically by the TSSC e2e test';
    const baseBranch = 'main'; // Default base branch

    try {
      // Get contentModifications from the template
      if (!this.template) {
        throw new Error('Template not set for this repository');
      }

      const contentModifications = this.template.getContentModifications();

      console.log(`Creating a sample merge request in GitLab with the following parameters:`);
      console.log(`New Branch Name: ${newBranchName}`);
      console.log(`Source Repository: ${this.sourceRepoName}`);

      // Use the GitLabClient's createMergeRequest method which handles branch creation and file modifications
      const result = await this.gitlabClient.createMergeRequest(
        this.getGroup(),
        this.sourceRepoName,
        this.getGroup(), // targetOwner
        baseBranch,
        newBranchName,
        contentModifications,
        title,
        description
      );

      // Extract the merge request number and commit SHA from the result
      const { prNumber, commitSha } = result as { prNumber: number; commitSha: string };

      console.log(`Successfully created merge request #${prNumber} with commit SHA: ${commitSha}`);

      // Return a PullRequest object with the merge request details
      return new PullRequest(prNumber, commitSha, this.sourceRepoName);
    } catch (error: any) {
      console.error(`Error creating sample merge request: ${error.message}`);
      throw error;
    }
  }

  /**
   * Creates a sample commit directly to the main branch of the source repository
   */
  public override async createSampleCommitOnSourceRepo(): Promise<string> {
    // Get contentModifications from the template
    if (!this.template) {
      throw new Error('Template not set for this repository');
    }

    const contentModifications = this.template.getContentModifications();
    const commitMessage = 'Test commit from TSSC e2e test';

    // Use the common commit method
    return this.commitChangesToRepo(
      this.getGroup(),
      this.sourceRepoName,
      contentModifications,
      commitMessage,
      'main'
    );
  }

  public async createSamplePullRequest(
    newBranchName: string,
    contentModifications: ContentModifications,
    title: string,
    description: string,
    baseBranch: string = 'main'
  ): Promise<PullRequest> {
    try {
      console.log(`Creating a sample pull request in GitLab with the following parameters:`);
      console.log(`New Branch Name: ${newBranchName}`);
      console.log(`Title: ${title}`);
      console.log(`Description: ${description}`);
      console.log(`Base Branch: ${baseBranch}`);

      // Use GitLabClient's createMergeRequest method which already supports batch changes
      const result = await this.gitlabClient.createMergeRequest(
        this.getGroup(),
        this.sourceRepoName,
        this.getGroup(), // targetOwner
        baseBranch,
        newBranchName,
        contentModifications,
        title,
        description
      );

      // Extract the merge request number and commit SHA
      const { prNumber, commitSha } = result;

      console.log(`Successfully created merge request #${prNumber} with commit SHA: ${commitSha}`);

      // Return a PullRequest object with the details
      return new PullRequest(prNumber, commitSha, this.sourceRepoName);
    } catch (error: any) {
      console.error(`Error creating sample merge request: ${error.message}`);
      throw error;
    }
  }

  /**
   * Commits changes to files in a specified repository
   * @param owner The repository owner
   * @param repo The repository name
   * @param contentModifications Object containing file modifications
   * @param commitMessage Message for the commit
   * @param branch The branch to commit to (default: 'main')
   * @returns Promise with commit SHA
   */
  public override async commitChangesToRepo(
    owner: string,
    repo: string,
    contentModifications: ContentModifications,
    commitMessage: string,
    branch: string = 'main'
  ): Promise<string> {
    try {
      // Validate inputs
      if (!owner || !repo) {
        throw new Error('Owner and repository name are required');
      }
      if (!contentModifications) {
        throw new Error('Content modifications are required');
      }
      if (!commitMessage) {
        throw new Error('Commit message is required');
      }

      console.log(`Committing changes directly to ${owner}/${repo} in branch ${branch}`);

      // Find the project ID for the repository using direct path lookup (more efficient)
      let projectId;
      try {
        const project = await this.gitlabClient.getProject(`${owner}/${repo}`);
        projectId = project.id;
      } catch (error) {
        throw new Error(`Project ${owner}/${repo} not found`);
      }

      // Prepare all file modifications for a single batch commit
      const fileActions: { action: 'create' | 'update'; file_path: string; content: string }[] = [];

      // Process each file modification
      for (const [filePath, modifications] of Object.entries(contentModifications)) {
        try {
          let fileContent: string;
          let fileExists = true;

          // Try to get existing file content first
          try {
            const fileData = await this.gitlabClient.getFileContent(projectId, filePath, branch);
            fileContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
          } catch (error: any) {
            if (error.message && error.message.includes('not found')) {
              // File doesn't exist yet, start with empty content
              fileContent = '';
              fileExists = false;
            } else {
              throw error;
            }
          }

          // Apply each modification in sequence
          for (const { oldContent, newContent } of modifications) {
            if (!fileExists) {
              // For new files, use the new content directly
              fileContent = newContent;
            } else if (oldContent && fileContent.includes(oldContent)) {
              // For existing files with matching patterns, replace just those patterns
              fileContent = fileContent.replace(oldContent, newContent);
            } else {
              // For existing files where pattern isn't found, log a warning and skip
              // Don't replace the entire file content when a pattern isn't found
              console.warn(
                `Couldn't find match for pattern in ${filePath}, skipping this modification`
              );
            }
          }

          // Add to batch actions using file_path (will be converted to filePath in createCommit)
          fileActions.push({
            action: fileExists ? 'update' : 'create',
            file_path: filePath,
            content: fileContent,
          });
        } catch (error: any) {
          console.error(`Error preparing file modification for ${filePath}: ${error.message}`);
          throw error;
        }
      }

      // Execute a direct batch commit to the target branch
      console.log(`Committing ${fileActions.length} file changes in a single batch`);

      // Make a direct commit to the repository - this is using the internal GitLab APIs through gitlabClient
      const commitResult = await this.gitlabClient.createCommit(
        projectId,
        branch,
        commitMessage,
        fileActions
      );

      // Get the commit SHA from the result or fetch it
      let commitSha = commitResult?.id;

      if (!commitSha) {
        // Fallback: Get the commit SHA from the most recent commit
        const commits = await this.gitlabClient.getCommits(projectId, { ref_name: branch });
        commitSha = commits[0]?.id;
      }

      if (!commitSha) {
        throw new Error(`Failed to retrieve commit SHA after committing changes`);
      }

      console.log(
        `Successfully committed all changes directly to branch '${branch}' with SHA: ${commitSha}`
      );
      return commitSha;
    } catch (error: any) {
      console.error(`Error creating direct commit on branch '${branch}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets the SHA256 commit hash for the source repository
   *
   * @param branch - The branch name to get the commit hash for (default: 'main')
   * @returns Promise resolving to the SHA256 commit hash of the latest commit in the source repository
   */
  public override async getSourceRepoCommitSha(branch: string = 'main'): Promise<string> {
    try {
      console.log(
        `Getting latest commit SHA for source repo: ${this.sourceRepoName}, branch: ${branch}`
      );

      // Find the project ID for the source repository
      // Find the project ID using direct path lookup (more efficient)
      let projectId;
      try {
        const project = await this.gitlabClient.getProject(
          `${this.getGroup()}/${this.sourceRepoName}`
        );
        projectId = project.id;
      } catch (error) {
        throw new Error(`Project ${this.getGroup()}/${this.sourceRepoName} not found`);
      }

      // Get the latest commit for the branch
      const commits = await this.gitlabClient.getCommits(projectId, { ref_name: branch });

      if (!commits || commits.length === 0) {
        throw new Error(`No commits found for branch ${branch}`);
      }

      const commitSha = commits[0].id;
      console.log(`Latest commit SHA for ${this.sourceRepoName}/${branch}: ${commitSha}`);

      return commitSha;
    } catch (error: any) {
      console.error(`Failed to get commit SHA for source repo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets the SHA256 commit hash for the GitOps repository
   *
   * @param branch - The branch name to get the commit hash for (default: 'main')
   * @returns Promise resolving to the SHA256 commit hash of the latest commit in the GitOps repository
   */
  public override async getGitOpsRepoCommitSha(branch: string = 'main'): Promise<string> {
    try {
      console.log(
        `Getting latest commit SHA for GitOps repo: ${this.gitOpsRepoName}, branch: ${branch}`
      );

      // Find the project ID for the GitOps repository using direct path lookup (more efficient)
      let projectId;
      try {
        const project = await this.gitlabClient.getProject(
          `${this.getGroup()}/${this.gitOpsRepoName}`
        );
        projectId = project.id;
      } catch (error) {
        throw new Error(`GitOps project ${this.getGroup()}/${this.gitOpsRepoName} not found`);
      }

      // Get the latest commit for the branch
      const commits = await this.gitlabClient.getCommits(projectId, { ref_name: branch });

      if (!commits || commits.length === 0) {
        throw new Error(`No commits found for branch ${branch}`);
      }

      const commitSha = commits[0].id;
      console.log(`Latest commit SHA for ${this.gitOpsRepoName}/${branch}: ${commitSha}`);

      return commitSha;
    } catch (error: any) {
      console.error(`Failed to get commit SHA for GitOps repo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Configures a webhook for the source repository
   * @param webhookUrl The URL of the webhook to configure
   */
  public override async configWebhookOnSourceRepo(webhookUrl: string): Promise<void> {
    try {
      console.log(
        `Configuring webhook for source repo ${this.getGroup()}/${this.sourceRepoName} with ${webhookUrl}`
      );

      // Set up webhook using GitLab client with specific event triggers
      await this.gitlabClient.configWebhook(this.getGroup(), this.sourceRepoName, webhookUrl);

      console.log(
        `Webhook configured successfully for source repo ${this.getGroup()}/${this.sourceRepoName} with ${webhookUrl}`
      );
    } catch (error: any) {
      console.error(`Failed to configure webhook on source repo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Configures a webhook for the GitOps repository
   * @param webhookUrl The URL of the webhook to configure
   */
  public override async configWebhookOnGitOpsRepo(webhookUrl: string): Promise<void> {
    try {
      console.log(
        `Configuring webhook for GitOps repo ${this.getGroup()}/${this.gitOpsRepoName} with ${webhookUrl}`
      );

      // Set up webhook using GitLab client with specific event triggers
      await this.gitlabClient.configWebhook(this.getGroup(), this.gitOpsRepoName, webhookUrl);

      console.log(
        `Webhook configured successfully for GitOps repo ${this.getGroup()}/${this.gitOpsRepoName} with ${webhookUrl}`
      );
    } catch (error: any) {
      console.error(`Failed to configure webhook on GitOps repo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets the URL for the GitOps repository
   * @returns The GitOps repository URL
   */
  public override getGitOpsRepoUrl(): string {
    const hostname = this.getHost();
    return `https://${hostname}/${this.getGroup()}/${this.getGitOpsRepoName()}`;
  }

  /**
   * Gets the URL for the source repository
   * @returns The source repository URL
   */
  public override getSourceRepoUrl(): string {
    const hostname = this.getHost();
    return `https://${hostname}/${this.getGroup()}/${this.getSourceRepoName()}`;
  }

  /**
   * Gets the template type for this repository
   * @returns The template type
   */
  public getTemplateType(): TemplateType {
    return this.template.getType();
  }

  /**
   * Gets the owner identifier for the repository
   * For GitLab, this is the group name
   * @returns The repository owner (group)
   */
  public override getRepoOwner(): string {
    return this.getGroup();
  }

  /**
   * Set multiple environment variables in the GitLab project's CI/CD settings
   *
   * @param variables - Object containing variable names as keys and values
   * @param groupName - Name of the GitLab group containing the repository
   * @param repositoryName - Name of the repository to set variables for (optional, defaults to component name)
   * @returns Promise that resolves when all variables are processed
   * @throws Error if the project cannot be found or if any critical errors occur
   */
  public async setProjectVariables(
    variables: Record<string, string>,
    groupName: string,
    repositoryName?: string
  ): Promise<void> {
    const repoName = repositoryName || this.componentName;
    const repoFullPath = `${groupName}/${repoName}`;

    console.log(`Setting project variables for ${repoFullPath}`);

    try {
      // Get project first to validate existence
      const project = await this.getProjectOrThrow(repoFullPath);

      // Process variables concurrently
      const operations = Object.entries(variables).map(async ([key, value]) => {
        try {
          console.log(`Setting project variable '${key}' for repository ${repoFullPath}`);
          await this.gitlabClient.setEnvironmentVariable(project.id, key, value);
          console.log(`Project variable '${key}' set successfully`);
        } catch (error) {
          console.error(`Error setting project variable '${key}': ${error}`);
          // Don't throw here, just log the error and continue with other variables
        }
      });

      // Wait for all operations to complete
      await Promise.allSettled(operations);

      console.log(`Completed setting project variables for ${repoFullPath}`);
    } catch (error) {
      console.error(`Error accessing project ${repoFullPath}: ${error}`);
      throw new Error(`Failed to set project variables for ${repoFullPath}: ${error}`);
    }
  }

  /**
   * Helper method to get a project by path or throw a standardized error
   *
   * @param repoFullPath - Full path to the repository (group/project)
   * @returns The project object
   * @throws Error if the project cannot be found
   */
  private async getProjectOrThrow(repoFullPath: string): Promise<any> {
    try {
      return await this.gitlabClient.getProject(repoFullPath);
    } catch (error) {
      throw new Error(`Project ${repoFullPath} not found: ${error}`);
    }
  }

  public async setProjectVariableOnSourceRepo(variables: Record<string, string>): Promise<void> {
    await this.setProjectVariables(variables, this.getGroup(), this.sourceRepoName);
  }

  public async setProjectVariableOnGitOpsRepo(variables: Record<string, string>): Promise<void> {
    await this.setProjectVariables(variables, this.getGroup(), this.gitOpsRepoName);
  }
}
