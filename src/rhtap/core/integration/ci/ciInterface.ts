import { IntegrationSecret } from '../../integrationSecret';
import { PullRequest } from '../git/models';
import { Pipeline, PipelineStatus } from './pipeline';

export enum CIType {
  TEKTON = 'tekton',
  GITHUB_ACTIONS = 'githubactions',
  GITLABCI = 'gitlabci',
  JENKINS = 'jenkins',
}

// event types
//TODO: it matches the value of annotation "pipelinesascode.tekton.dev/on-event" in pipelinerun.
// why don't use label "pipelinesascode.tekton.dev/event-type" in pipelinerun? this is because Gitlab is using Merge_Request, github is using pull_request. we need unified event type to manage them.
// Jenkins, GitHub Actions, and GitLab CI may have different event types?
export enum EventType {
  PULL_REQUEST = 'pull_request',
  PUSH = 'push',
  // Add Jenkins-specific event types if needed
  COMMIT = 'commit',
  BUILD = 'build',
  // MERGE_REQUEST="Merge_Request"
}

export interface CI extends IntegrationSecret {
  //TODO: it should wait for all pipeines to finish triggered from both source and gitops repos
  waitForAllPipelinesToFinish(): Promise<void>;
  getCIType(): CIType;

  /**
   * Get a pipeline for the given pull request
   * @param pullRequest The pull request to get the pipeline for
   * @param eventType Optional event type - some CI systems like Tekton use this to filter pipelines,
   *                  while others like Jenkins may ignore it
   * @param pipelineStatus The status of the pipeline to filter by
   */
  getPipeline(
    pullRequest: PullRequest,
    pipelineStatus: PipelineStatus,
    eventType?: EventType
  ): Promise<Pipeline | null>;
  waitForPipelineToFinish(pipeline: Pipeline): Promise<PipelineStatus>;
  getPipelineStatus(): Promise<PipelineStatus>;
  getPipelineLogs(pipeline: Pipeline): Promise<string>;
  getPipelineResults(): Promise<string>;

  getWebhookUrl(): Promise<string>;
  getCIFilePathInRepo(): Promise<string>;
}
export { PipelineStatus, Pipeline };
