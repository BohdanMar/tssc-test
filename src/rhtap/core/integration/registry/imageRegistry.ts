import { KubeClient } from './../../../../../src/api/ocp/kubeClient';

export enum ImageRegistryType {
  QUAY = 'quay',
  QUAY_IO = 'quay_io',
  ARTIFACTORY = 'artifactory',
  NEXUS = 'nexus',
}

export interface ImageRegistry {
  // Add getter methods
  getOrganization(): string;
  getRegistryHost(): string;
  getImageName(): string;

  /**
   * The format is {"auths":{"<image-registry-host-url>":{"auth":"base64encoded", "email":""}}}
   */
  getDockerConfig(): string;
  getImageRegistryUser(): string;
  getImageRegistryPassword(): string;
  getUrl(): string;

  // Add KubeClient handling
  setKubeClient(kubeClient: KubeClient): void;
  getKubeClient(): KubeClient;
  initialize(): Promise<void>;
}

// Add an abstract base class for common registry functionality
export abstract class BaseImageRegistry implements ImageRegistry {
  organization: string;
  imageName: string;
  protected kubeClient!: KubeClient;
  protected secret: Record<string, string> = {};

  // Define protected fields for secret name and namespace
  protected secretName: string;
  protected secretNamespace: string;

  protected constructor(organization: string, imageName: string) {
    this.organization = organization;
    this.imageName = imageName;

    // Default values - will be overridden by subclasses
    this.secretName = '';
    this.secretNamespace = '';
  }

  getOrganization(): string {
    return this.organization;
  }

  getImageName(): string {
    return this.imageName;
  }

  public setKubeClient(kubeClient: KubeClient): void {
    this.kubeClient = kubeClient;
  }

  public getKubeClient(): KubeClient {
    return this.kubeClient;
  }

  public async initialize(): Promise<void> {
    if (!this.kubeClient) {
      throw new Error('KubeClient is not set. Please set it before calling initialize.');
    }
    await this.loadIntegrationSecret();
  }

  // Default implementation for integration secret loading
  protected async loadIntegrationSecret(): Promise<void> {
    // Retrieve the integration secret from Kubernetes
    this.secret = await this.kubeClient.getSecret(this.secretName, this.secretNamespace);
    if (!this.secret) {
      throw new Error(`Secret ${this.secretName} not found in namespace ${this.secretNamespace}`);
    }
  }

  public getDockerConfig(): string {
    return this.secret['.dockerconfigjson'];
  }

  public getImageRegistryUser(): string {
    try {
      const dockerConfig = JSON.parse(this.getDockerConfig());

      if (!dockerConfig.auths || Object.keys(dockerConfig.auths).length === 0) {
        throw new Error('No registry hosts found in Docker config');
      }

      const registryHost = this.getRegistryHost();
      const authData = dockerConfig.auths[registryHost];

      if (!authData || !authData.auth) {
        throw new Error(`Auth information not found for registry host: ${registryHost}`);
      }

      const authBase64 = authData.auth;
      const authDecoded = Buffer.from(authBase64, 'base64').toString('utf-8');

      // Auth is in the format "username:password"
      const [username] = authDecoded.split(':', 2);

      if (!username) {
        throw new Error('Username not found in auth string');
      }

      return username;
    } catch (error) {
      throw new Error(`Failed to extract registry username: ${error}`);
    }
  }

  public getImageRegistryPassword(): string {
    try {
      const dockerConfig = JSON.parse(this.getDockerConfig());

      if (!dockerConfig.auths || Object.keys(dockerConfig.auths).length === 0) {
        throw new Error('No registry hosts found in Docker config');
      }

      const registryHost = this.getRegistryHost();
      const authData = dockerConfig.auths[registryHost];

      if (!authData || !authData.auth) {
        throw new Error(`Auth information not found for registry host: ${registryHost}`);
      }

      const authBase64 = authData.auth;
      const authDecoded = Buffer.from(authBase64, 'base64').toString('utf-8');

      // Auth is in the format "username:password"
      const parts = authDecoded.split(':', 2);
      if (parts.length < 2 || !parts[1]) {
        throw new Error('Password not found in auth string');
      }

      return parts[1];
    } catch (error) {
      throw new Error(`Failed to extract registry password: ${error}`);
    }
  }

  public getRegistryHost(): string {
    try {
      const dockerConfig = JSON.parse(this.getDockerConfig());
      const registryHosts = Object.keys(dockerConfig.auths);
      if (registryHosts.length > 0) {
        return registryHosts[0];
      }
    } catch (error) {
      throw new Error(`Failed to extract registry host from Docker config: ${error}`);
    }
    throw new Error('Registry host not found in Docker config');
  }

  public abstract getRegistryType(): ImageRegistryType;
  public abstract getUrl(): string;
}
