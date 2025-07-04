import {
  GitHubActionsClient,
  WorkflowRun,
  WorkflowRunFilter,
} from '../../../../../api/ci/githubActionsClient';
import { GitHubClientFactory } from '../../../../../api/git/githubClientFactory';
import { KubeClient } from '../../../../../api/ocp/kubeClient';
import { PullRequest } from '../../git/models';
import { BaseCI } from '../baseCI';
import { CIType, EventType, Pipeline, PipelineStatus } from '../ciInterface';

export class GitHubActionsCI extends BaseCI {
  private githubAction!: GitHubActionsClient;
  private componentName: string;
  private secret?: Record<string, string>;
  private clientFactory: GitHubClientFactory;
  private repoOwner!: string;

  constructor(componentName: string, kubeClient: KubeClient) {
    super(CIType.GITHUB_ACTIONS, kubeClient);
    this.componentName = componentName;
    this.clientFactory = GitHubClientFactory.getInstance();
  }

  public async getIntegrationSecret(): Promise<Record<string, string>> {
    if (this.secret) {
      return this.secret;
    }
    // Load the secret from the provider-specific implementation
    this.secret = await this.loadSecret();
    return this.secret;
  }

  public getRepoOwner(): string {
    if (!this.repoOwner) {
      throw new Error(
        'Repository owner is not set. Please ensure the GitHub client is initialized.'
      );
    }
    return this.repoOwner;
  }

  public setRepoOwner(repoOwner: string): void {
    if (!repoOwner) {
      throw new Error('Repository owner cannot be empty.');
    }
    this.repoOwner = repoOwner;
  }

  public async initialize(): Promise<void> {
    this.secret = await this.loadSecret();
    this.githubAction = await this.initGithubActionsClient();
  }

  /**
   * Loads GitHub integration secrets from Kubernetes
   * @returns Promise with the secret data
   */
  private async loadSecret(): Promise<Record<string, string>> {
    // First try to get token from the factory
    const existingToken = this.clientFactory.getTokenForComponent(this.componentName);
    if (existingToken) {
      return { token: existingToken };
    }

    // Otherwise load from Kubernetes
    const secret = await this.kubeClient.getSecret('tssc-github-integration', 'tssc');
    if (!secret) {
      throw new Error(
        'GitHub integration secret not found in the cluster. Please ensure the secret exists.'
      );
    }

    // Register the token with the factory
    if (secret.token) {
      this.clientFactory.registerToken(this.componentName, secret.token);
    }

    return secret;
  }

  private async initGithubActionsClient(): Promise<GitHubActionsClient> {
    const githubToken = this.getToken();
    const githubActionClient = new GitHubActionsClient({
      token: githubToken,
      // Use the same client factory across the application
      // GitHubActionsClient will use this token to get a client from the factory
    });
    return githubActionClient;
  }

  public getToken(): string {
    if (!this.secret?.token) {
      throw new Error('GitHub token not found in the secret. Please ensure the token is provided.');
    }
    return this.secret.token;
  }
  /**
   * Get a pipeline for the given pull request based on specified filters
   *
   * @param pullRequest The pull request to get the pipeline for
   * @param pipelineStatus The status of the pipeline to filter by
   * @param eventType Optional event type to filter workflows by
   * @returns Promise<Pipeline | null> A standardized Pipeline object or null if not found
   */
  public override async getPipeline(
    pullRequest: PullRequest,
    pipelineStatus: PipelineStatus,
    eventType?: EventType
  ): Promise<Pipeline | null> {
    const gitRepository = pullRequest.repository;

    console.log(
      `Finding workflow runs for repository: ${gitRepository}, event type: ${eventType}, status: ${pipelineStatus}`
    );

    try {
      // Create a filter object for the getWorkflowRuns method
      const filter: WorkflowRunFilter = {
        event: eventType,
        per_page: 100, // Get more results to increase chances of finding relevant runs
      };

      // Map our PipelineStatus to GitHub Actions status for API filtering
      switch (pipelineStatus) {
        case PipelineStatus.RUNNING:
          filter.status = 'in_progress';
          break;
        case PipelineStatus.PENDING:
          filter.status = 'queued'; // Primary filter, we'll check for others in post-processing
          break;
        case PipelineStatus.SUCCESS:
        case PipelineStatus.FAILURE:
          // For success/failure, we want completed runs, then filter by conclusion
          filter.status = 'completed';
          break;
      }

      // If we have a SHA, include it in the filter
      if (pullRequest.sha) {
        filter.head_sha = pullRequest.sha;
      }

      // Get workflow runs using our comprehensive filter - GitHubActionsClient already has retry logic
      const response = await this.githubAction.getWorkflowRuns(
        this.getRepoOwner(),
        gitRepository,
        filter
      );

      const workflowRuns = response.data?.workflow_runs || [];

      // Check if we have any workflow runs
      if (!workflowRuns || workflowRuns.length === 0) {
        console.log(
          `No workflow runs found yet for repository: ${gitRepository}. Workflow may still be launching.`
        );
        return null;
      }

      console.log(`Found ${workflowRuns.length} workflow runs for repository: ${gitRepository}`);

      // Filter workflow runs by the requested pipeline status
      const filteredWorkflowRuns = workflowRuns.filter(run => {
        // Skip null/undefined runs
        if (!run) return false;

        const mappedStatus = this.mapGitHubWorkflowStatusToPipelineStatus(run);
        console.log(
          `Workflow run ID ${run.id}: GitHub status=${run.status}, conclusion=${run.conclusion}, mapped status=${mappedStatus}`
        );

        return mappedStatus === pipelineStatus;
      });

      // If no matching workflow runs are found, check if there are any in progress that might match later
      if (filteredWorkflowRuns.length === 0) {
        console.log(`No matching workflow runs found with status: ${pipelineStatus}`);

        // Special case: For SUCCESS or FAILURE, check if there are any in-progress runs
        if (
          pipelineStatus === PipelineStatus.SUCCESS ||
          pipelineStatus === PipelineStatus.FAILURE
        ) {
          const pendingOrRunning = workflowRuns.some(
            run =>
              run.status &&
              ['queued', 'waiting', 'requested', 'pending', 'in_progress'].includes(run.status)
          );

          if (pendingOrRunning) {
            console.log(
              `Found workflows still executing for repository: ${gitRepository} which may reach status ${pipelineStatus} later`
            );
          } else {
            console.log(
              `All workflows are completed, but none match the requested status: ${pipelineStatus}`
            );
          }
        }

        return null;
      }

      console.log(`Found ${filteredWorkflowRuns.length} matching workflow runs`);

      // Sort workflow runs by creation timestamp to get the latest one
      const sortedWorkflowRuns = [...filteredWorkflowRuns].sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA; // Descending order (latest first)
      });

      // Get the latest workflow run
      const latestRun = sortedWorkflowRuns[0];
      if (!latestRun) {
        console.log('No workflow runs available after sorting');
        return null;
      }

      console.log(`Using latest workflow run: ${latestRun.id} - ${latestRun.name || ''}`);

      // Create and return a standardized Pipeline object
      return this.createPipelineFromWorkflowRun(latestRun, gitRepository, pullRequest.sha);
    } catch (error) {
      console.error(
        `Error getting workflow runs: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Maps GitHub Actions workflow run status to standardized PipelineStatus
   *
   * GitHub Actions workflow statuses:
   * - 'queued': Workflow run is queued
   * - 'in_progress': Workflow run is in progress
   * - 'completed': Workflow run is completed
   * - 'waiting': The workflow run is waiting
   * - 'pending': The workflow run is pending
   * - 'requested': The workflow run is requested
   *
   * For completed workflows, we check the conclusion:
   * - 'success': The workflow run completed successfully
   * - 'failure': The workflow run failed
   * - 'cancelled': The workflow run was cancelled
   * - 'skipped': The workflow run was skipped
   * - 'timed_out': The workflow run timed out
   * - 'action_required': The workflow run requires further action
   * - 'neutral': The workflow run completed with a neutral verdict
   * - 'stale': The workflow run became stale
   *
   * @param workflowRun The GitHub Actions workflow run
   * @returns The standardized PipelineStatus
   */
  private mapGitHubWorkflowStatusToPipelineStatus(workflowRun: WorkflowRun): PipelineStatus {
    if (!workflowRun) {
      return PipelineStatus.UNKNOWN;
    }

    // Handle null or undefined values safely
    const status = workflowRun.status ? workflowRun.status.toLowerCase() : '';
    const conclusion = workflowRun.conclusion ? workflowRun.conclusion.toLowerCase() : '';

    console.log(`Mapping GitHub status: ${status || 'null'}, conclusion: ${conclusion || 'none'}`);

    // First check the status
    if (status === 'completed') {
      // For completed workflows, check the conclusion
      if (conclusion === 'success') {
        return PipelineStatus.SUCCESS;
      } else if (['failure', 'timed_out', 'cancelled', 'action_required'].includes(conclusion)) {
        return PipelineStatus.FAILURE;
      } else if (conclusion === 'skipped') {
        // Skipped workflows are technically completed, but didn't run
        // Depending on requirements, you might map these to SUCCESS instead
        return PipelineStatus.UNKNOWN;
      } else if (conclusion === 'neutral') {
        // Neutral means the run completed but didn't explicitly succeed or fail
        // This is often used for informational workflows
        return PipelineStatus.SUCCESS;
      } else if (conclusion === 'stale') {
        // Stale means the run was superseded by another run
        return PipelineStatus.UNKNOWN;
      }
    } else if (status === 'in_progress') {
      return PipelineStatus.RUNNING;
    } else if (['queued', 'waiting', 'requested', 'pending'].includes(status)) {
      return PipelineStatus.PENDING;
    }

    // Default fallback
    console.warn(
      `Unknown GitHub workflow status/conclusion combination: ${status || 'null'}/${conclusion || 'null'}`
    );
    return PipelineStatus.UNKNOWN;
  }

  /**
   * Create a standardized Pipeline object from a GitHub Actions workflow run
   *
   * @param workflowRun The GitHub Actions workflow run
   * @param repositoryName The name of the repository
   * @param sha The commit SHA
   * @returns A standardized Pipeline object
   */
  private createPipelineFromWorkflowRun(
    workflowRun: WorkflowRun,
    repositoryName: string,
    sha?: string
  ): Pipeline {
    if (!workflowRun) {
      throw new Error('Cannot create pipeline from undefined workflow run');
    }

    const id = workflowRun.id.toString();
    const name = workflowRun.name || workflowRun.display_title || `Workflow #${id}`;
    const status = this.mapGitHubWorkflowStatusToPipelineStatus(workflowRun);
    const url = workflowRun.html_url || '';

    // Format any results data - this could be further extended to extract job data if needed
    const results = workflowRun.conclusion
      ? JSON.stringify({
          conclusion: workflowRun.conclusion,
          head_branch: workflowRun.head_branch || null,
          event: workflowRun.event || 'unknown',
        })
      : '';

    return new Pipeline(
      id,
      CIType.GITHUB_ACTIONS,
      repositoryName,
      status,
      name,
      workflowRun.run_number, // Use run_number as build number
      undefined, // No job name for GitHub Actions
      url,
      '', // Logs not available yet
      results,
      workflowRun.created_at ? new Date(workflowRun.created_at) : undefined,
      workflowRun.updated_at ? new Date(workflowRun.updated_at) : undefined,
      sha || workflowRun.head_sha
    );
  }

  protected override async checkPipelineStatus(pipeline: Pipeline): Promise<PipelineStatus> {
    try {
      // For checking pipeline status, we need to fetch the workflow run details by repo owner and commit sha
      if (!pipeline.id || !pipeline.repositoryName) {
        throw new Error('Pipeline ID and repository name are required to check status');
      }
      const workflowRun = await this.githubAction.findWorkflowRunByCommitSha(
        this.getRepoOwner(),
        pipeline.repositoryName,
        pipeline.sha || ''
      );

      if (!workflowRun) {
        console.warn(`Workflow run ${pipeline.id} not found`);
        return PipelineStatus.UNKNOWN;
      }

      // Return the mapped status
      return this.mapGitHubWorkflowStatusToPipelineStatus(workflowRun);
    } catch (error) {
      console.warn(
        `Workflow run ${pipeline.id} not found or inaccessible: ${error instanceof Error ? error.message : String(error)}`
      );
      return PipelineStatus.UNKNOWN;
    }
  }

  public override async waitForAllPipelinesToFinish(
    timeoutMs = 5 * 60 * 1000,
    pollIntervalMs = 5000
  ): Promise<void> {
    console.log(`Waiting for all workflow runs to finish for component: ${this.componentName}`);
    const sourceRepoName = this.componentName;
    const startTime = Date.now();

    while (true) {
      const response = await this.githubAction.getWorkflowRuns(
        this.getRepoOwner(),
        sourceRepoName,
        { per_page: 100 }
      );
      const workflowRuns = response.data?.workflow_runs || [];

      if (!workflowRuns.length) {
        console.log(`No workflow runs found for repository: ${sourceRepoName}`);
        return;
      }

      const runningWorkflowRuns = workflowRuns.filter(run =>
        ['in_progress', 'queued', 'waiting', 'requested', 'pending'].includes(run.status || '')
      );

      if (runningWorkflowRuns.length === 0) {
        console.log('All workflows have finished processing.');
        return;
      }

      console.log(
        `Found ${runningWorkflowRuns.length} running workflow run(s) for ${sourceRepoName}. Waiting...`
      );

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout: Some workflow runs did not finish within ${timeoutMs / 1000}s`);
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  public override async getWebhookUrl(): Promise<string> {
    throw new Error(
      'GitHub Actions does not support webhooks in the same way as other CI systems.'
    );
  }

  public override async getCIFilePathInRepo(): Promise<string> {
    return '.github/workflows';
  }

  public override async getPipelineLogs(pipeline: Pipeline): Promise<string> {
    try {
      console.log(
        `Fetching comprehensive logs for pipeline ${pipeline.id} (${pipeline.name || 'unnamed'})`
      );

      // Use the comprehensive log retrieval method from GitHubActionsClient
      const logs = await this.githubAction.getWorkflowRunLogs(
        this.getRepoOwner(),
        pipeline.repositoryName,
        parseInt(pipeline.id)
      );

      return logs;
    } catch (error) {
      console.error(`Error getting comprehensive workflow logs for ${pipeline.id}:`, error);

      // Fallback to basic job summary if comprehensive logs fail
      try {
        console.log(`Falling back to basic job summary for pipeline ${pipeline.id}`);

        const jobsResponse = await this.githubAction.listJobsForWorkflowRun(
          this.getRepoOwner(),
          pipeline.repositoryName,
          parseInt(pipeline.id)
        );

        const jobs = Array.isArray(jobsResponse.data?.jobs) ? jobsResponse.data.jobs : [];

        if (jobs.length === 0) {
          return `No jobs found for workflow run ${pipeline.id}\n\nView workflow at: ${pipeline.url}`;
        }

        // Build a basic summary of jobs
        let logSummary = `=== GitHub Actions Workflow Logs ===\n`;
        logSummary += `Workflow: ${pipeline.name || pipeline.id}\n`;
        logSummary += `Repository: ${pipeline.repositoryName}\n`;
        logSummary += `Status: ${pipeline.status}\n`;
        logSummary += `URL: ${pipeline.url}\n\n`;

        logSummary += `Jobs in this workflow (${jobs.length}):\n`;
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          if (job && job.name) {
            logSummary += `\n${i + 1}. Job: ${job.name}\n`;
            logSummary += `   ID: ${job.id || 'unknown'}\n`;
            logSummary += `   Status: ${job.status || 'unknown'}\n`;
            logSummary += `   Conclusion: ${job.conclusion || 'in progress'}\n`;

            if (job.started_at) {
              logSummary += `   Started: ${job.started_at}\n`;
            }
            if (job.completed_at) {
              logSummary += `   Completed: ${job.completed_at}\n`;
            }
            if (job.html_url) {
              logSummary += `   Job URL: ${job.html_url}\n`;
            }
          }
        }

        logSummary += `\n${'='.repeat(50)}\n`;
        logSummary += `\nNote: This is a basic summary. For detailed logs:\n`;
        logSummary += `1. Visit the workflow URL above\n`;
        logSummary += `2. Click on individual job names to see step-by-step logs\n`;
        logSummary += `3. Use GitHub CLI: gh run view ${pipeline.id} --log\n`;

        return logSummary;
      } catch (fallbackError) {
        const errorMessage = `Failed to get pipeline logs for workflow ${pipeline.id}`;
        console.error(`${errorMessage}:`, fallbackError);

        return `${errorMessage}\n\nPrimary error: ${error instanceof Error ? error.message : String(error)}\nFallback error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}\n\nPlease visit the workflow URL to view logs: ${pipeline.url}`;
      }
    }
  }
}
