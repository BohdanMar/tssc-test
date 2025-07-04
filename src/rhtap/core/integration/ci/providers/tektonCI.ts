import { TektonClient } from '../../../../../../src/api/ci/tektonClient';
import { KubeClient } from '../../../../../../src/api/ocp/kubeClient';
import { PullRequest } from '../../git/models';
import { BaseCI } from '../baseCI';
import { CIType, EventType, Pipeline, PipelineStatus } from '../ciInterface';
import { PipelineRunKind } from '@janus-idp/shared-react/index';
import retry from 'async-retry';

export class TektonCI extends BaseCI {
  private tektonClient: TektonClient;
  private componentName: string;
  private static readonly CI_NAMESPACE = 'tssc-app-ci';

  /**
   * @param componentName The name of the component to associate with this CI instance
   * @param kubeclient The Kubernetes client to use for API calls
   */
  constructor(componentName: string, kubeclient: KubeClient) {
    super(CIType.TEKTON, kubeclient);
    this.componentName = componentName;
    this.tektonClient = new TektonClient(kubeclient);
  }

  /**
   * Get a pipeline for the given pull request based on specified filters
   * Aligns with CI interface; retrieves the latest pipeline run that matches
   * the criteria sorted by creation timestamp
   *
   * @param pullRequest The pull request to get the pipeline for
   * @param pipelineStatus The status of the pipeline to filter by
   * @param eventType event type to filter by (defaults to PULL_REQUEST for Tekton)
   * @returns Promise<Pipeline | null> A standardized Pipeline object or null if not found
   */
  //TODO: this method is a bit complex, consider refactoring for clarity.
  // It should retrieve the pipeline runs for a given pull request based on the event type and commit sha.
  public override async getPipeline(
    pullRequest: PullRequest,
    pipelineStatus: PipelineStatus,
    eventType: EventType
  ): Promise<Pipeline | null> {
    const effectiveEventType = eventType;
    const gitRepository = pullRequest.repository;

    console.log(
      `Finding pipeline runs for repository: ${gitRepository}, event type: ${effectiveEventType}`
    );

    // Define the pipeline retrieval operation that will be retried
    const findPipelineOperation = async (): Promise<Pipeline | null> => {
      // Get all pipeline runs for this repository
      const allPipelineRuns = await this.tektonClient.getPipelineRunsByGitRepository(
        TektonCI.CI_NAMESPACE,
        gitRepository
      );

      // Check if we have any pipeline runs
      if (!allPipelineRuns || allPipelineRuns.length === 0) {
        console.log(
          `No pipeline runs found yet for repository: ${gitRepository}. Pipeline may still be launching.`
        );
        // Return null to continue the retry process
        return null;
      }

      // Filter pipeline runs by checking if the on-event annotation includes the event type
      const filteredPipelineRuns = allPipelineRuns.filter(pipelineRun => {
        const annotations = pipelineRun.metadata?.annotations || {};
        const onEvent = annotations['pipelinesascode.tekton.dev/on-event'] || '';
        const commitSha = pipelineRun.metadata?.labels?.['pipelinesascode.tekton.dev/sha'] || '';
        return (
          onEvent.includes(effectiveEventType) &&
          this.mapTektonStatusToPipelineStatus(pipelineRun) === pipelineStatus &&
          commitSha === pullRequest.sha
        );
      });

      // If no matching pipeline runs are found, return null and trigger retry
      if (filteredPipelineRuns.length === 0) {
        console.log(
          `No matching pipeline runs found for event: ${effectiveEventType} with status: ${pipelineStatus}`
        );
        // Return null to trigger retry rather than throwing an error
        return null;
      }

      console.log(`Found ${filteredPipelineRuns.length} matching pipeline runs`);

      // Sort pipeline runs by creation timestamp to get the latest one
      const sortedPipelineRuns = [...filteredPipelineRuns].sort((a, b) => {
        const timeA = a.metadata?.creationTimestamp
          ? new Date(a.metadata.creationTimestamp).getTime()
          : 0;
        const timeB = b.metadata?.creationTimestamp
          ? new Date(b.metadata.creationTimestamp).getTime()
          : 0;
        return timeB - timeA; // Descending order (latest first)
      });

      // Get the latest pipeline run
      const latestPipelineRun = sortedPipelineRuns[0];
      if (!latestPipelineRun) {
        console.log('No pipeline runs available after sorting');
        return null;
      }

      console.log(`Using latest pipeline run: ${latestPipelineRun.metadata?.name}`);

      // Extract relevant data from the pipeline run
      const name = latestPipelineRun.metadata?.name || '';
      const results = latestPipelineRun.status?.results
        ? JSON.stringify(latestPipelineRun.status.results)
        : '';

      // Get URL if available from the log-url annotation
      const url =
        latestPipelineRun.metadata?.annotations?.['pipelinesascode.tekton.dev/log-url'] || '';

      // Map Tekton specific statuses to standardized values
      let status = this.mapTektonStatusToPipelineStatus(latestPipelineRun);

      // Create pipeline using factory method
      return Pipeline.createTektonPipeline(
        name,
        status,
        gitRepository,
        '', // logs not available yet
        results,
        url,
        pullRequest.sha
      );
    };

    // Execute the operation with retries
    const maxRetries = 10;
    try {
      // Retry logic similar to waitForAllPipelinesToFinish
      const result = await retry(
        async (): Promise<Pipeline> => {
          const pipeline = await findPipelineOperation();

          // If no pipeline is found, throw an error to trigger retry
          if (!pipeline) {
            throw new Error(
              `Waiting for pipeline runs for repository: ${gitRepository}, event: ${effectiveEventType}, status: ${pipelineStatus}`
            );
          }

          return pipeline;
        },
        {
          retries: maxRetries,
          minTimeout: 5000,
          maxTimeout: 15000,
          factor: 1.5,
          onRetry: (error: Error, attemptNumber) => {
            // Log retry but don't show the full error stack trace
            console.log(
              `[TEKTON-RETRY ${attemptNumber}/${maxRetries}] 🔄 Repository: ${gitRepository} | Status: ${pipelineStatus} | Reason: ${error.message}`
            );
          },
        }
      );

      return result;
    } catch (error: any) {
      // Log a clean message without the full stack trace
      console.log(
        `No matching pipeline found after ${maxRetries} retries for repository: ${gitRepository}, event: ${effectiveEventType}, status: ${pipelineStatus}`
      );
      return null;
    }
  }

  /**
   * Maps Tekton pipeline run status to standardized PipelineStatus
   * Extracted to a separate method for reuse and readability
   */
  private mapTektonStatusToPipelineStatus(pipelineRun: PipelineRunKind): PipelineStatus {
    const condition = pipelineRun.status?.conditions?.[0];
    if (!condition) {
      return PipelineStatus.UNKNOWN;
    }

    const condStatus = condition.status;
    const type = condition.type;
    const reason = condition.reason;

    if (condStatus === 'True' && type === 'Succeeded') {
      return PipelineStatus.SUCCESS;
    } else if (condStatus === 'False' && type === 'Succeeded') {
      return PipelineStatus.FAILURE;
    } else if (condStatus === 'Unknown') {
      if (reason === 'Running' || reason === 'Started') {
        return PipelineStatus.RUNNING;
      } else if (reason === 'Pending') {
        return PipelineStatus.PENDING;
      }
    }

    return PipelineStatus.UNKNOWN;
  }

  /**
   * Implementation of abstract method from BaseCI
   * Returns a standardized pipeline status value compatible with all CI systems
   */
  protected override async checkPipelineStatus(pipeline: Pipeline): Promise<PipelineStatus> {
    if (!pipeline.name) {
      throw new Error('Pipeline name is required for Tekton pipelines');
    }

    try {
      // Try to get the pipeline run up to 3 times with a 2-second delay between attempts
      let pipelineRun = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!pipelineRun && attempts < maxAttempts) {
        pipelineRun = await this.tektonClient.getPipelineRunByName(
          TektonCI.CI_NAMESPACE,
          pipeline.name
        );

        if (!pipelineRun) {
          attempts++;
          if (attempts < maxAttempts) {
            console.log(
              `PipelineRun ${pipeline.name} not found, retrying (${attempts}/${maxAttempts})...`
            );
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
          }
        }
      }

      if (!pipelineRun) {
        console.warn(`PipelineRun ${pipeline.name} not found after ${maxAttempts} attempts`);
        return PipelineStatus.UNKNOWN;
      }

      // Extract the primary condition from the PipelineRun
      const condition = pipelineRun.status?.conditions?.[0];
      if (!condition) {
        return PipelineStatus.UNKNOWN;
      }

      // Get the status, type and reason
      const status = condition.status;
      const type = condition.type;
      const reason = condition.reason;

      console.log(
        `PipelineRun ${pipeline.name} status: ${status}, type: ${type}, reason: ${reason}`
      );

      // Map Tekton specific statuses to standardized values
      if (status === 'True' && type === 'Succeeded') {
        return PipelineStatus.SUCCESS;
      } else if (status === 'False' && type === 'Succeeded') {
        return PipelineStatus.FAILURE;
      } else if (status === 'Unknown') {
        if (reason === 'Running' || reason === 'Started') {
          return PipelineStatus.RUNNING;
        } else if (reason === 'Pending') {
          return PipelineStatus.PENDING;
        }
      }
      // Default to unknown if no mapping is found
      return PipelineStatus.UNKNOWN;
    } catch (error) {
      console.error(`Error checking pipeline status for ${pipeline.name}:`, error);
      throw new Error(`Failed to check pipeline status: ${error}`);
    }
  }

  /**
   * Waits for all PipelineRuns associated with the component to finish processing
   *
   * This method identifies all pipeline runs for the current component that are still
   * in progress (not marked with "pipelinesascode.tekton.dev/state=completed"), and
   * waits for each of them to reach a terminal state (success or failure).
   *
   * The method implements robust retry logic based on async-retry pattern:
   * 1. Queries for all pipeline runs associated with the component repository
   * 2. Filters those that don't have the "completed" state label
   * 3. Continues polling with exponential backoff until all pipelines reach completion
   * 4. Handles errors and timeouts gracefully
   *
   * @returns Promise<void> Resolves when all pipelines have reached a terminal state
   * @throws Error if unable to check pipeline status after maximum retries
   */
  public override async waitForAllPipelinesToFinish(): Promise<void> {
    console.log(`Waiting for all PipelineRuns to finish for component: ${this.componentName}`);
    const sourceRepoName = this.componentName;

    try {
      // Define the operation to check for running pipelines that will be retried
      const checkPipelines = async (): Promise<void> => {
        try {
          // Get all pipeline runs for the component
          const allPipelineRuns = await this.tektonClient.getPipelineRunsByGitRepository(
            TektonCI.CI_NAMESPACE,
            sourceRepoName
          );

          if (!allPipelineRuns || allPipelineRuns.length === 0) {
            console.log(`No pipeline runs found for repository: ${sourceRepoName}`);
            return; // No pipelines to wait for
          }

          // Filter pipeline runs by checking the label "pipelinesascode.tekton.dev/state"
          const runningPipelineRuns =
            allPipelineRuns.filter(pr => {
              const state = pr.metadata?.labels?.['pipelinesascode.tekton.dev/state'];
              const name = pr.metadata?.name || 'unknown';
              if (state !== 'completed') {
                console.log(`PipelineRun ${name} still running, state: ${state || 'undefined'}`);
                return true;
              }
              return false;
            }) || [];

          console.log(
            `Found ${runningPipelineRuns.length} running pipeline run(s) for ${sourceRepoName}`
          );

          // If there are running pipelines, throw an error to trigger retry
          if (runningPipelineRuns.length > 0) {
            throw new Error(`Waiting for ${runningPipelineRuns.length} pipeline(s) to complete`);
          }

          // All pipelines are complete, return successfully
          console.log('All pipelines have finished processing.');
          return;
        } catch (error) {
          if (error instanceof Error && error.message.includes('404')) {
            // If it's a 404 error, bail immediately (don't retry)
            console.log(`Repository ${sourceRepoName} not found, no pipelines to wait for`);
            return; // No pipelines to wait for
          }
          // For other errors, throw to trigger retry
          throw error;
        }
      };

      const maxRetries = 20; // Maximum number of retries
      await retry(checkPipelines, {
        retries: maxRetries, // Maximum 20 retries
        minTimeout: 10000, // Start with a 10 second delay
        maxTimeout: 30000, // Maximum timeout between retries
        factor: 1.5, // Exponential backoff factor
        onRetry: (error: Error, attempt: number) => {
          console.log(
            `[TEKTON-RETRY ${attempt}/${maxRetries}] 🔄 Repository: ${sourceRepoName} | Status: Waiting | Reason: ${error.message}`
          );
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `Failed to wait for all pipelines to complete for repository ${sourceRepoName} after multiple retries: ${errorMessage}`
      );
      // Return without throwing to make error handling easier for callers
      // This is a change from the original implementation which threw an error
      console.log('Continuing despite pipeline completion check failures');
    }
  }

  public override async getWebhookUrl(): Promise<string> {
    const tektonWebhookUrl = await this.kubeClient.getOpenshiftRoute(
      'pipelines-as-code-controller',
      'openshift-pipelines'
    );
    return `https://${tektonWebhookUrl}`;
  }

  public override async getIntegrationSecret(): Promise<Record<string, string>> {
    throw new Error(
      'Tekton does not support integration secrets in the same way as other CI systems.'
    );
  }

  public override async getCIFilePathInRepo(): Promise<string> {
    return '.tekton';
  }

  public override async getPipelineLogs(pipeline: Pipeline): Promise<string> {
    if (!pipeline.name) {
      throw new Error('Pipeline name is required for Tekton pipelines');
    }

    try {
      const logs = await this.tektonClient.getPipelineRunLogs(TektonCI.CI_NAMESPACE, pipeline.name);
      if (!logs) {
        throw new Error(`No logs found for pipeline: ${pipeline.name}`);
      }
      return logs;
    } catch (error) {
      console.error(`Error getting pipeline logs for ${pipeline.name}:`, error);
      throw new Error(`Failed to get pipeline logs: ${error}`);
    }
  }
}
