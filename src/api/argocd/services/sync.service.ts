import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import retry from 'async-retry';
import { ArgoCDConnectionService } from './connection.service';
import { ArgoCDApplicationService } from './application.service';
import {
  ArgoCDConnectionConfig,
  ArgoCDCliConfig,
} from '../types/connection.types';
import {
  ApplicationSyncResult,
  SyncOptions,
} from '../types/application.types';
import {
  ArgoCDSyncError,
  ArgoCDTimeoutError,
  ArgoCDConnectionError,
} from '../errors/argocd.errors';

// Promisified exec function
const exec = promisify(execCallback);

/**
 * Service for managing ArgoCD application synchronization
 */
export class ArgoCDSyncService {
  constructor(
    private readonly connectionService: ArgoCDConnectionService,
    private readonly applicationService: ArgoCDApplicationService
  ) {}

  /**
   * Triggers and monitors a synchronization operation for an ArgoCD application using the ArgoCD CLI.
   */
  public async syncApplication(
    applicationName: string,
    config: ArgoCDConnectionConfig,
    options: SyncOptions = {},
    timeoutMs: number = 4 * 60 * 1000
  ): Promise<ApplicationSyncResult> {
    if (!applicationName || !config.namespace) {
      throw new ArgoCDSyncError(
        applicationName,
        'Application name and namespace are required parameters'
      );
    }

    console.log(
      `Starting sync process for application ${applicationName} in namespace ${config.namespace}...`
    );
    const startTime = Date.now();

    try {
      // Get ArgoCD connection info
      const connectionInfo = await this.connectionService.getConnectionInfo(config);
      const cliConfig = this.connectionService.createCliConfig(connectionInfo);

      // Build ArgoCD CLI commands
      const loginCmd = this.buildLoginCommand(cliConfig);
      const syncCmd = this.buildSyncCommand(applicationName, options);

      console.log(`Attempting to sync application ${applicationName} using ArgoCD CLI...`);

      // Execute login command with retries
      await this.executeLogin(loginCmd, applicationName);

      // Execute sync command
      await this.executeSync(syncCmd, applicationName);

      // Monitor the sync process
      const result = await this.monitorSyncProcess(
        applicationName,
        config.namespace,
        timeoutMs,
        startTime
      );

      return result;
    } catch (error) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      
      if (error instanceof ArgoCDSyncError || error instanceof ArgoCDTimeoutError) {
        throw error;
      }
      
      console.error(
        `Failed to sync application ${applicationName} after ${elapsed}s: ${error instanceof Error ? error.message : String(error)}`
      );
      
      return {
        success: false,
        message: `Sync failed after ${elapsed}s: ${error instanceof Error ? error.message : String(error)}`,
        health: 'Unknown',
        sync: 'Unknown',
        operationPhase: 'Unknown',
      };
    }
  }

  /**
   * Safely escapes a shell argument to prevent command injection
   */
  private escapeShellArg(arg: string): string {
    // Replace single quotes with '\'' and wrap in single quotes
    return `'${arg.replace(/'/g, `'\\''`)}'`;
  }

  private buildLoginCommand(cliConfig: ArgoCDCliConfig): string {
    const { serverUrl, username, password, insecure, skipTestTls, grpcWeb } = cliConfig;
    
    // Build command with properly escaped arguments
    const args = ['argocd', 'login', this.escapeShellArg(serverUrl)];
    
    if (insecure) args.push('--insecure');
    if (skipTestTls) args.push('--skip-test-tls');
    if (grpcWeb) args.push('--grpc-web');
    
    args.push('--username', this.escapeShellArg(username));
    args.push('--password', this.escapeShellArg(password));
    
    return args.join(' ');
  }

  private buildSyncCommand(applicationName: string, options: SyncOptions): string {
    // Build command with properly escaped arguments
    const args = ['argocd', 'app', 'sync', this.escapeShellArg(applicationName), '--insecure'];
    
    if (options.dryRun) args.push('--dry-run');
    if (options.prune) args.push('--prune');
    if (options.force) args.push('--force');
    
    return args.join(' ');
  }

  private async executeLogin(loginCmd: string, applicationName: string): Promise<void> {
    const maxRetries = 5;
    
          await retry(
      async () => {
        try {
          const { stdout: _, stderr: loginErr } = await exec(loginCmd);
          if (loginErr && loginErr.trim()) {
            console.warn(`ArgoCD login warnings: ${loginErr}`);
          }
          console.log('Successfully logged into ArgoCD server');
        } catch (loginError: any) {
          console.error(`Error logging into ArgoCD: ${loginError.message}`);
          throw new ArgoCDConnectionError(
            `Failed to login to ArgoCD: ${loginError.message}`,
            loginError
          );
        }
      },
      {
        retries: maxRetries,
        minTimeout: 2000,
        factor: 2,
        onRetry: (error: Error, attempt: number) => {
          console.log(
            `[LOGIN-RETRY ${attempt}/${maxRetries}] 🔄 Application: ${applicationName} | Status: Retrying login | Reason: ${error.message}`
          );
        },
      }
    );
  }

  private async executeSync(syncCmd: string, applicationName: string): Promise<void> {
    const maxRetries = 5;
    
    await retry(
      async (bail) => {
        try {
          console.log(`Executing sync command: ${syncCmd}`);
          const { stdout, stderr } = await exec(syncCmd);

          if (stderr && stderr.trim()) {
            console.warn(`ArgoCD sync warnings: ${stderr}`);
          }
          if (stdout) {
            console.log(`ArgoCD sync output: ${stdout}`);
          }
        } catch (syncError: any) {
          console.error(`Error executing sync command: ${syncError.message}`);
          
          // Check if this is the "another operation is already in progress" error
          if (syncError.message && (
            syncError.message.includes('another operation is already in progress') ||
            syncError.message.includes('FailedPrecondition')
          )) {
            // This is a retryable error - throw to trigger retry
            throw new Error(`ArgoCD sync conflict: ${syncError.message}`);
          }
          
          // For other errors, use bail() to make them non-retryable
          bail(new ArgoCDSyncError(
            applicationName,
            `Failed to execute sync command: ${syncError.message}`,
            syncError
          ));
        }
      },
      {
        retries: maxRetries,
        minTimeout: 2000,
        factor: 2,
        maxTimeout: 30000,
        onRetry: (error: Error, attempt: number) => {
          console.log(
            `[SYNC-RETRY ${attempt}/${maxRetries}] 🔄 Application: ${applicationName} | Status: Retrying sync | Reason: ${error.message}`
          );
        },
      }
    );
  }

  private async monitorSyncProcess(
    applicationName: string,
    namespace: string,
    timeoutMs: number,
    startTime: number
  ): Promise<ApplicationSyncResult> {
    const maxRetries = Math.floor(timeoutMs / 10000);

    const monitorSyncProcess = async (bail: (e: Error) => void): Promise<ApplicationSyncResult> => {
      // Check if we've exceeded the timeout
      if (Date.now() - startTime > timeoutMs) {
        const message = `Timeout reached after ${Math.round(timeoutMs / 1000 / 60)} minutes waiting for application ${applicationName} to sync`;
        bail(new ArgoCDTimeoutError('sync monitoring', timeoutMs));
        return {
          success: false,
          message,
          health: 'Unknown',
          sync: 'Unknown',
          operationPhase: 'Unknown',
        };
      }

      // Get current application status
      const healthStatus = await this.applicationService.getApplicationHealth(applicationName, namespace);
      const syncStatus = await this.applicationService.getApplicationSyncStatus(applicationName, namespace);
      const operationPhase = await this.applicationService.getApplicationOperationPhase(applicationName, namespace);

      // Check for success condition
      if (healthStatus === 'Healthy' && syncStatus === 'Synced') {
        console.log(
          `✅ Sync completed successfully for application ${applicationName} - Health: ${healthStatus}, Sync: ${syncStatus}`
        );
        return {
          success: true,
          message: `Sync completed successfully`,
          health: healthStatus,
          sync: syncStatus,
          operationPhase: operationPhase,
        };
      }

      // Check for clear failure cases
      if (
        healthStatus === 'Degraded' ||
        syncStatus === 'SyncFailed' ||
        operationPhase === 'Failed' ||
        operationPhase === 'Error'
      ) {
        const errorMessage = `Sync failed for application ${applicationName} - Health: ${healthStatus}, Sync: ${syncStatus}, Operation: ${operationPhase}`;
        bail(new ArgoCDSyncError(applicationName, errorMessage));
        return {
          success: false,
          message: errorMessage,
          health: healthStatus,
          sync: syncStatus,
          operationPhase: operationPhase,
        };
      }

      // Still in progress
      const statusMsg = `Application ${applicationName} - Health: ${healthStatus}, Sync: ${syncStatus}, Operation: ${operationPhase}`;
      console.log(`⏳ ${statusMsg} - continuing to monitor`);
      throw new Error(`Waiting for sync to complete: ${statusMsg}`);
    };

    try {
      const result = await retry(monitorSyncProcess, {
        retries: maxRetries,
        factor: 1.5,
        minTimeout: 5000,
        maxTimeout: 30000,
        onRetry: (error: Error, attempt: number) => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(
            `[SYNC-MONITOR ${attempt}/${maxRetries}] 🔄 Application: ${applicationName} | Elapsed: ${elapsed}s | Reason: ${error.message}`
          );
        },
      });

      return result;
    } catch (error: any) {
      // Get detailed application status for debugging
      try {
        const status = await this.applicationService.getApplicationStatus(applicationName, namespace);
        console.log(`Application details: ${status}`);
      } catch (statusError) {
        console.error(`Unable to fetch application status: ${statusError}`);
      }

      return {
        success: false,
        message: error.message || 'Sync monitoring failed',
        health: 'Unknown',
        sync: 'Unknown',
        operationPhase: 'Unknown',
      };
    }
  }
} 