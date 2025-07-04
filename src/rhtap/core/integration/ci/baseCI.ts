import { PullRequest } from '../git/models';
import { KubeClient } from './../../../../../src/api/ocp/kubeClient';
import { CI, CIType, EventType, Pipeline, PipelineStatus } from './ciInterface';
import retry from 'async-retry';

/**
 * Base class for all CI implementations with common functionality
 */
export abstract class BaseCI implements CI {
  constructor(
    public readonly ciType: CIType,
    public readonly kubeClient: KubeClient
  ) {}

  /**
   * Get a pipeline for the given pull request
   * @param pullRequest The pull request to get the pipeline for
   * @param eventType Optional event type - some CI systems like Tekton use this to filter pipelines,
   *                  while others like Jenkins may ignore it
   * @param pipelineStatus The status of the pipeline to filter by
   */
  public abstract getPipeline(
    pullRequest: PullRequest,
    pipelineStatus: PipelineStatus,
    eventType?: EventType
  ): Promise<Pipeline | null>;

  public getPipelineStatus(): Promise<PipelineStatus> {
    throw new Error('Method not implemented.');
  }
  public abstract getPipelineLogs(pipeline: Pipeline): Promise<string>;

  public getPipelineResults(): Promise<string> {
    throw new Error('Method not implemented.');
  }

  public getCIType(): CIType {
    return this.ciType;
  }

  public getKubeClient(): KubeClient {
    return this.kubeClient;
  }

  /**
   * Wait for a pipeline to finish executing and return its final status
   * @param pipeline The Pipeline object representing the pipeline to wait for
   * @param timeoutMs Optional timeout in milliseconds
   * @returns A promise that resolves to the final status of the pipeline
   */
  //TODO: needs one more parameter to specify the final status to wait for
  public async waitForPipelineToFinish(
    pipeline: Pipeline,
    timeoutMs: number = 600000
  ): Promise<PipelineStatus> {
    console.log(`Waiting for pipeline ${pipeline.getDisplayName()} to finish...`);

    let status: PipelineStatus = PipelineStatus.UNKNOWN;
    const startTime = Date.now();

    try {
      const checkPipelineStatus = async (bail: (e: Error) => void): Promise<PipelineStatus> => {
        // Check if timeout has been reached
        if (Date.now() - startTime >= timeoutMs) {
          console.warn(`Timed out waiting for pipeline ${pipeline.getDisplayName()} to finish`);
          bail(new Error('Timeout reached'));
          return PipelineStatus.UNKNOWN;
        }

        // Implement status checking logic specific to each CI type in subclasses
        status = await this.checkPipelineStatus(pipeline);
        pipeline.updateStatus(status);

        console.log(`Pipeline ${pipeline.getDisplayName()} status: ${status}`);

        // If pipeline is not yet complete, throw error to trigger retry
        if (!pipeline.isCompleted()) {
          throw new Error(
            `Pipeline ${pipeline.getDisplayName()} not yet completed, status: ${status}`
          );
        }

        return status;
      };

      status = await retry(checkPipelineStatus, {
        retries: Math.floor(timeoutMs / 5000), // Calculate retries based on timeout
        minTimeout: 5000, // 5 seconds between retries
        maxTimeout: 5000, // Keep consistent timing
        factor: 1, // No backoff
        onRetry: (error: Error, attempt: number) => {
          console.log(
            `[RETRY ${attempt}] 🔄 Pipeline: ${pipeline.getDisplayName()} | Status: ${status} | Reason: ${error.message}`
          );
        },
      });

      return status;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === 'Timeout reached') {
        return PipelineStatus.UNKNOWN;
      }
      console.error(
        `Error while waiting for pipeline ${pipeline.getDisplayName()}: ${errorMessage}`
      );
      //TODO: Print out pipeline logs if available
      // This is a placeholder for actual log retrieval logic
      return status;
    }
  }

  /**
   * Abstract method to check the status of a pipeline
   * This should be implemented by each CI provider subclass
   */
  protected abstract checkPipelineStatus(pipeline: Pipeline): Promise<PipelineStatus>;

  public abstract waitForAllPipelinesToFinish(): Promise<void>;

  public abstract getWebhookUrl(): Promise<string>;

  public abstract getIntegrationSecret(): Promise<Record<string, string>>;

  public abstract getCIFilePathInRepo(): Promise<string>;
}
