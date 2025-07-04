import {
  CredentialType,
  JenkinsBuildTrigger,
  JenkinsClient,
} from '../../../../../../src/api/ci/jenkinsClient';
import { KubeClient } from '../../../../../../src/api/ocp/kubeClient';
import { PullRequest } from '../../git/models';
import { BaseCI } from '../baseCI';
import { CIType, EventType, Pipeline, PipelineStatus } from '../ciInterface';
import retry from 'async-retry';

export class JenkinsCI extends BaseCI {
  private jenkinsClient!: JenkinsClient;
  private componentName: string;
  private secret!: Record<string, string>;

  // Standardized retry configuration
  private static readonly MAX_RETRIES = 10;
  private static readonly MIN_TIMEOUT = 2000; // 2 seconds
  private static readonly MAX_TIMEOUT = 15000; // 15 seconds
  private static readonly BACKOFF_FACTOR = 1.5;

  constructor(componentName: string, kubeClient: KubeClient) {
    super(CIType.JENKINS, kubeClient);
    this.componentName = componentName;
  }

  private async loadSecret(): Promise<Record<string, string>> {
    const secret = await this.kubeClient.getSecret('tssc-jenkins-integration', 'tssc');
    if (!secret) {
      throw new Error('Jenkins secret not found in the cluster. Please ensure the secret exists.');
    }
    this.secret = secret;
    return secret;
  }

  public getbaseUrl(): string {
    if (!this.secret.baseUrl) {
      throw new Error('Jenkins base URL not found in the secret. Please ensure the secret exists.');
    }
    return this.secret.baseUrl;
  }

  public getUsername(): string {
    if (!this.secret.username) {
      throw new Error('Jenkins username not found in the secret. Please ensure the secret exists.');
    }
    return this.secret.username;
  }

  public getToken(): string {
    if (!this.secret.token) {
      throw new Error('Jenkins token not found in the secret. Please ensure the secret exists.');
    }
    return this.secret.token;
  }
  /**
   * Initialize the Jenkins client by retrieving credentials from a Kubernetes secret
   * 1. create a folder with the repo name
   * 2. create 2 job with the names of source repo and gitops repo
   * 3. create secrets under the folder
   */
  public async initialize(): Promise<void> {
    try {
      await this.initJenkinsClient();
      console.log('Jenkins client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Jenkins client:', error);
      throw error;
    }
  }

  /**
   * Create a folder in Jenkins
   * @param folderName The name of the folder to create
   */
  public async createFolder(folderName: string): Promise<void> {
    try {
      // Create a folder in Jenkins
      const folderConfig = {
        name: folderName,
        description: `Folder for ${folderName}`,
      };
      await this.jenkinsClient.createFolder(folderConfig);
      console.log(`Folder ${folderName} created successfully`);
    } catch (error) {
      console.error(`Failed to create folder ${folderName}:`, error);
      throw error;
    }
  }

  /**
   * Create a job in Jenkins
   * @param jobName The name of the job to create
   * @param folderName The name of the folder to create the job in
   * @param repoUrl The URL of the repository for the job
   */
  public async createJob(jobName: string, folderName: string, repoUrl: string): Promise<void> {
    try {
      // Create a job in Jenkins
      await this.jenkinsClient.createJob(jobName, repoUrl, folderName);
      console.log(`Job ${jobName} created successfully in folder ${folderName}`);
    } catch (error) {
      console.error(`Failed to create job ${jobName} in folder ${folderName}:`, error);
      throw error;
    }
  }

  public async addCredential(
    folderName: string,
    key: string,
    value: string,
    credentialType: CredentialType = CredentialType.SECRET_TEXT
  ): Promise<void> {
    try {
      await this.jenkinsClient.createCredential(folderName, key, value, credentialType);
    } catch (error) {
      console.error(`Failed to apply credentials in folder ${folderName}:`, error);
      throw error;
    }
  }

  /**
   * Init the Jenkins client by retrieving credentials from a Kubernetes secret
   * 1. create a folder with the repo name
   * 2. create 2 job with the names of source repo and gitops repo
   * 3. create secrets under the folder
   */
  private async initJenkinsClient(): Promise<void> {
    try {
      await this.loadSecret();
      // Initialize the Jenkins client with credentials from the secret
      this.jenkinsClient = new JenkinsClient({
        baseUrl: this.getbaseUrl(),
        username: this.getUsername(),
        token: this.getToken(),
      });

      console.log('Jenkins client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Jenkins client:', error);
      throw error;
    }
  }

  /**
   * Get a pipeline for a given pull request
   * For Jenkins, we need to find the job specifically for the pullRequest's commit SHA
   * @param pullRequest The pull request to get the pipeline for
   * @param pipelineStatus The status of the pipeline to filter by
   * @param eventType The type of event that triggered the pipeline
   * @returns Pipeline object or null if no matching pipeline is found
   */
  public override async getPipeline(
    pullRequest: PullRequest,
    pipelineStatus: PipelineStatus,
    eventType?: EventType
  ): Promise<Pipeline | null> {
    const jobName = pullRequest.repository;
    const folderName = this.componentName;
    const commitSha = pullRequest.sha;

    console.log(
      `Searching for Jenkins pipeline in job ${jobName} with commit SHA ${commitSha} in folder ${folderName}`
    );

    // Define the pipeline retrieval operation that will be retried
    const findPipelineOperation = async (): Promise<Pipeline | null> => {
      try {
        // Use getBuildByCommitSha to find the specific build for this commit
        const buildInfo = await this.jenkinsClient.getBuildByCommitSha(
          jobName,
          commitSha,
          folderName
        );

        if (!buildInfo) {
          console.log(`No build found for job ${jobName} with commit SHA ${commitSha}`);
          return null;
        }

        const buildNumber = buildInfo.number;

        // Map Jenkins build status to our standardized PipelineStatus format
        let status = PipelineStatus.UNKNOWN;

        if (buildInfo.building) {
          status = PipelineStatus.RUNNING;
        } else if (buildInfo.result) {
          switch (buildInfo.result.toUpperCase()) {
            case 'SUCCESS':
              status = PipelineStatus.SUCCESS;
              break;
            case 'FAILURE':
              status = PipelineStatus.FAILURE;
              break;
            case 'UNSTABLE':
              status = PipelineStatus.FAILURE; // Map unstable to failure
              break;
            case 'ABORTED':
              status = PipelineStatus.FAILURE; // Map aborted to failure
              break;
            case 'NOT_BUILT':
              status = PipelineStatus.PENDING;
              break;
            default:
              status = PipelineStatus.UNKNOWN;
          }
        }

        // If we're filtering by status and this pipeline doesn't match, return null
        if (pipelineStatus !== PipelineStatus.UNKNOWN && status !== pipelineStatus) {
          return null;
        }

        // If eventType is specified, get the build trigger type and check if it matches
        if (eventType) {
          // Get full build information with trigger detection enabled
          const buildWithTriggerInfo = await this.jenkinsClient.getBuild(
            jobName,
            buildNumber,
            folderName,
            true
          );

          // Check if the trigger type matches the requested event type
          if (buildWithTriggerInfo.triggerType) {
            const isPR = buildWithTriggerInfo.triggerType === JenkinsBuildTrigger.PULL_REQUEST;
            const isPush = buildWithTriggerInfo.triggerType === JenkinsBuildTrigger.PUSH;

            // Determine if we should filter this build based on event type
            if (
              (eventType === EventType.PULL_REQUEST && !isPR) ||
              (eventType === EventType.PUSH && !isPush)
            ) {
              console.log(
                `Build trigger type ${buildWithTriggerInfo.triggerType} doesn't match requested event type ${eventType}`
              );
              return null;
            }
          }
        }

        // Get build logs for more detailed information
        let logs = '';
        try {
          const logResponse = await this.jenkinsClient.getBuildLog(
            jobName,
            buildNumber,
            folderName
          );
          logs = logResponse.text;
        } catch (error) {
          console.warn('Could not retrieve build logs:', error);
        }

        // Use the helper method to convert JenkinsBuild to Pipeline
        return this.jenkinsClient.convertBuildToPipeline(
          buildInfo,
          jobName,
          pullRequest.repository,
          logs,
          commitSha
        );
      } catch (error) {
        console.error(`Error fetching Jenkins pipeline for commit SHA ${commitSha}:`, error);
        return null;
      }
    };

    // Execute the operation with retries when searching for pipelines with specific status
    if (pipelineStatus !== PipelineStatus.UNKNOWN) {
      const maxRetries = JenkinsCI.MAX_RETRIES;
      try {
        return await retry(
          async (): Promise<Pipeline> => {
            const pipeline = await findPipelineOperation();

            // If no matching pipeline found, trigger retry
            if (!pipeline) {
              throw new Error(
                `Waiting for pipeline in job ${jobName} with status ${pipelineStatus}`
              );
            }

            return pipeline;
          },
          {
            retries: maxRetries,
            minTimeout: JenkinsCI.MIN_TIMEOUT,
            maxTimeout: JenkinsCI.MAX_TIMEOUT,
            factor: JenkinsCI.BACKOFF_FACTOR,
            onRetry: (error: Error, attemptNumber) => {
              console.log(
                `[JENKINS-RETRY ${attemptNumber}/${maxRetries}] 🔄 Job: ${jobName} | SHA: ${commitSha} | Status: ${pipelineStatus} | Reason: ${error.message}`
              );
            },
          }
        );
      } catch (error: any) {
        console.log(
          `No matching pipeline found after retries for job ${jobName} with commit SHA ${commitSha} and status ${pipelineStatus}`
        );
        return null;
      }
    } else {
      // If not filtering by a specific status, just try once without retries
      return await findPipelineOperation();
    }
  }

  /**
   * Check the status of a Jenkins pipeline
   * Uses retry logic for resilience against transient network issues
   */
  protected override async checkPipelineStatus(pipeline: Pipeline): Promise<PipelineStatus> {
    if (!pipeline.jobName || pipeline.buildNumber === undefined) {
      throw new Error('Job name and build number are required for Jenkins pipelines');
    }

    const jobName = pipeline.jobName;
    const buildNumber = pipeline.buildNumber;

    try {
      // Use async-retry to get build status with resilience against transient failures
      const maxRetries = JenkinsCI.MAX_RETRIES;

      return await retry(
        async (): Promise<PipelineStatus> => {
          try {
            const buildInfo = await this.jenkinsClient.getBuild(jobName, buildNumber);

            if (!buildInfo) {
              console.log(`Build info for ${jobName} #${buildNumber} not found`);
              return PipelineStatus.UNKNOWN;
            }

            // Convert the JenkinsBuild to a Pipeline and get its status
            const convertedPipeline = this.jenkinsClient.convertBuildToPipeline(
              buildInfo,
              jobName,
              pipeline.repositoryName
            );

            return convertedPipeline.status;
          } catch (error) {
            // If there's an error, throw it to trigger retry
            throw new Error(`Error checking build status: ${error}`);
          }
        },
        {
          retries: maxRetries,
          minTimeout: JenkinsCI.MIN_TIMEOUT,
          maxTimeout: JenkinsCI.MAX_TIMEOUT,
          factor: JenkinsCI.BACKOFF_FACTOR,
          onRetry: (error: Error, attemptNumber) => {
            console.log(
              `[JENKINS-RETRY ${attemptNumber}/${maxRetries}] 🔄 Checking status of ${jobName} #${buildNumber} | Reason: ${error.message}`
            );
          },
        }
      );
    } catch (error) {
      console.error(
        `Failed to check Jenkins build status for ${jobName} #${buildNumber} after multiple retries:`,
        error
      );
      return PipelineStatus.UNKNOWN;
    }
  }

  /**
   * Wait for all Jenkins jobs to finish
   */
  public override async waitForAllPipelinesToFinish(): Promise<void> {
    try {
      // Get all jobs in the component folder
      const folderName = this.componentName;

      console.log(`Waiting for all Jenkins jobs to finish in folder ${folderName}`);

      const maxRetries = JenkinsCI.MAX_RETRIES;

      try {
        // Use async-retry to get running builds with retries
        const jobs = await retry(
          async (): Promise<any[]> => {
            try {
              const jobs = await this.jenkinsClient.getRunningBuilds(
                `${this.componentName}`,
                folderName
              );

              if (!jobs || jobs.length === 0) {
                console.log(`No running Jenkins jobs found in folder ${folderName}`);
                return [];
              }

              return jobs;
            } catch (error) {
              // If there's an error, throw it to trigger retry
              throw new Error(`Error getting running builds: ${error}`);
            }
          },
          {
            retries: maxRetries,
            minTimeout: JenkinsCI.MIN_TIMEOUT,
            maxTimeout: JenkinsCI.MAX_TIMEOUT,
            factor: JenkinsCI.BACKOFF_FACTOR,
            onRetry: (error: Error, attemptNumber) => {
              console.log(
                `[JENKINS-RETRY ${attemptNumber}/${maxRetries}] 🔄 Folder: ${folderName} | Status: Waiting | Reason: ${error.message}`
              );
            },
          }
        );

        console.log(`Found ${jobs.length} Jenkins jobs`);

        // Check all jobs for running builds
        for (const job of jobs) {
          if (!job.lastBuild) continue;

          const buildInfo = await this.jenkinsClient.getBuild(job.name, job.lastBuild.number);

          if (buildInfo?.building) {
            // Create a pipeline object for the running build
            const pipeline = Pipeline.createJenkinsPipeline(
              job.name,
              job.lastBuild.number,
              PipelineStatus.RUNNING,
              job.name, // Using job name as repository name
              '',
              ''
            );

            // Wait for this pipeline to finish
            await this.waitForPipelineToFinish(pipeline);
          }
        }
      } catch (error: any) {
        // Log error but continue execution
        console.log(
          `Could not retrieve Jenkins jobs after ${maxRetries} retries: ${error.message}`
        );
      }
    } catch (error) {
      console.error('Error waiting for Jenkins builds to finish:', error);
      // Don't rethrow to make error handling easier for callers, similar to TektonCI
      console.log('Continuing despite Jenkins job check failures');
    }
  }

  public override async getWebhookUrl(): Promise<string> {
    const webhookUrl = `${this.getbaseUrl()}/github-webhook/`;
    return webhookUrl;
  }

  public override async getIntegrationSecret(): Promise<Record<string, string>> {
    if (this.secret) {
      return this.secret;
    }
    // Load the secret from the provider-specific implementation
    this.secret = await this.loadSecret();
    return this.secret;
  }

  public override async getCIFilePathInRepo(): Promise<string> {
    return 'Jenkinsfile';
  }

  /**
   * Get logs for a Jenkins pipeline build
   * @param pipeline The pipeline to get logs for
   * @returns Promise<string> The logs for the pipeline build
   * @throws Error if the pipeline doesn't have required identifiers or if log retrieval fails
   */
  public async getPipelineLogs(pipeline: Pipeline): Promise<string> {
    if (!pipeline.jobName || pipeline.buildNumber === undefined) {
      throw new Error('Job name and build number are required for Jenkins pipelines');
    }

    try {
      const folderName = this.componentName;
      const logs = await this.jenkinsClient.getBuildLog(
        pipeline.jobName,
        pipeline.buildNumber,
        folderName
      );

      if (!logs) {
        throw new Error(`No logs found for pipeline: ${pipeline.jobName} #${pipeline.buildNumber}`);
      }

      return logs;
    } catch (error) {
      console.error(
        `Error getting pipeline logs for ${pipeline.jobName} #${pipeline.buildNumber}:`,
        error
      );
      throw new Error(`Failed to get pipeline logs: ${error}`);
    }
  }
}
