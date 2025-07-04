import { Component } from '../../src/rhtap/core/component';
import { ArgoCD, Environment } from '../../src/rhtap/core/integration/cd/argocd';
import { CI } from '../../src/rhtap/core/integration/ci';
import { Git } from '../../src/rhtap/core/integration/git';
import { TPA } from '../../src/rhtap/core/integration/tpa';
import { ComponentPostCreateAction } from '../../src/rhtap/postcreation/componentPostCreateAction';
import {
  handleSourceRepoCodeChanges,
  promoteToEnvironmentWithPR,
} from '../../src/utils/test/common';
import { createBasicFixture } from '../../src/utils/test/fixtures';
import { randomString } from '../../src/utils/util';
import { expect } from '@playwright/test';

/**
 * Create a basic test fixture with testItem
 */
const test = createBasicFixture();

/**
 * A complete test scenario for TSSC workflow:
 *
 * This test suite follows a full component lifecycle through:
 * 1. Component creation and verification
 * 2. Source repo changes and pipeline execution
 * 3. Promotion across environments (dev → stage → prod)
 * 4. Verification of deployments in all environments
 * 5. SBOM validation in Trustification server
 */
test.describe('TSSC Complete Workflow', () => {
  // Shared variables for test steps
  let component: Component;
  let cd: ArgoCD;
  let ci: CI;
  let git: Git;
  let image: string = '';

  test.describe('Component Creation', () => {
    test('should create a component successfully', async ({ testItem }) => {
      // Generate component name directly in the test
      const componentName = `${testItem.getTemplate()}-${randomString()}`;
      const imageName = `${componentName}`;
      console.log(`Creating component: ${componentName}`);

      // Create the component directly in the test
      component = await Component.new(componentName, testItem, imageName);

      // Wait for the component to be created
      await component.waitUntilComponentIsCompleted();

      // Initialize shared resources
      cd = component.getCD();
      git = component.getGit();
      ci = component.getCI();

      // Verify component status
      const componentStatus = await component.getStatus();
      expect(componentStatus).toBe('completed');
      console.log('Component was created successfully!');

      // Execute post-creation actions
      const postCreateAction = new ComponentPostCreateAction(component);
      await postCreateAction.execute();
      console.log('✅ Post-creation actions executed successfully!');

      // Wait for all initial pipelines to finish
      await ci.waitForAllPipelinesToFinish();
      console.log('All initial pipelines have finished successfully!');
    });
  });

  test.describe('Build Application Image', () => {
    test('should build application changes as new image through pipelines', async () => {
      // Handle source code changes based on CI provider type
      await handleSourceRepoCodeChanges(git, ci);
      console.log('Source code changes processed successfully!');
    });
  });

  test.describe('Deployment Verification', () => {
    test('should verify deployment to development environment', async () => {
      // Verify application exists in development environment
      const application = await cd.getApplication(Environment.DEVELOPMENT);
      expect(application).not.toBeNull();

      // Get latest git commit and sync application
      const commitSha = await git.getGitOpsRepoCommitSha();
      await cd.syncApplication(Environment.DEVELOPMENT);

      // Verify sync was successful
      const result = await cd.waitUntilApplicationIsSynced(Environment.DEVELOPMENT, commitSha);
      expect(result.synced).toBe(true);
      console.log('Application deployed correctly in the development environment!');
    });

    test('should promote and verify deployment to stage environment', async () => {
      // Extract the image from development
      image = await git.extractApplicationImage(Environment.DEVELOPMENT);
      expect(image).toBeTruthy();

      // Promote to stage environment using PR workflow
      await promoteToEnvironmentWithPR(git, ci, cd, Environment.STAGE, image);
      console.log('Image promoted to stage environment successfully!');

      // Additional verification for stage environment could be added here
    });

    test('should promote and verify deployment to production environment', async () => {
      // Extract the image from stage
      image = await git.extractApplicationImage(Environment.STAGE);
      expect(image).toBeTruthy();

      // Promote to production environment using PR workflow
      await promoteToEnvironmentWithPR(git, ci, cd, Environment.PROD, image);
      console.log('Image promoted to production environment successfully!');

      // Additional verification for production environment could be added here
    });
  });

  test.describe('Security and Compliance', () => {
    test('should verify SBOM is uploaded to Trustification server', async () => {
      // Skip if no image to verify
      test.skip(!image, 'No image available to verify SBOM');

      // Extract image digest from image URL
      const imageDigest = image.split(':')[2];
      expect(imageDigest).toBeTruthy();

      // Get TPA instance and search for SBOM
      const tpa = await TPA.initialize(component.getKubeClient());
      const sbom = await tpa.searchSBOMBySha256(imageDigest);

      // Verify SBOM results exist
      expect(sbom).toBeDefined();
      console.log(`SBOM verification successful! Found SBOM for image: ${imageDigest}`);
    });
  });
});
