/* eslint-disable no-unused-vars */
import { Page } from '@playwright/test';

export interface CIPlugin {
    /**
     * Check that the CI heading is visible
     * @param page - The page object
     */
    checkCIHeading(page: Page): Promise<void>;

    /**
     * Check that the table content is visible
     * @param page - The page object
     */
    checkActions(page: Page): Promise<void>;

    /**
     * Check Pipeline Runs table row values
     * @param page - The page object
     */
    checkPipelineRunsTable(page: Page): Promise<void>;

    /**
     * Verify image registry links in the View Output popup are actual clickable links
     * that navigate to the external registry (not just text)
     * @param page - The page object
     */
    checkImageRegistryLinks(page: Page): Promise<void>;

    /**
     * Check the Security Information (multi-source security viewer) section
     * @param page - The page object
     */
    checkSecurityInformation(page: Page): Promise<void>;
}
