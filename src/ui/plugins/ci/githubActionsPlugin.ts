import { expect, Page } from '@playwright/test';
import { BaseCIPlugin } from './baseCIPlugin';
import { GitPO } from '../../page-objects/commonPo';

export class GithubActionsPlugin extends BaseCIPlugin {
    constructor(name: string, registryOrg: string) {
        super(name, registryOrg);
    }

    public async checkCIHeading(_page: Page): Promise<void> {}

    public async checkActions(_page: Page): Promise<void> {}

    public async checkPipelineRunsTable(page: Page): Promise<void> {
        const overviewUrl = page.url().replace(/\/ci(?:\?.*)?$/, '');
        await page.goto(overviewUrl, { timeout: 20000 });
        await page.waitForLoadState('domcontentloaded');

        const viewSourceLink = page.locator(`${GitPO.githubLinkSelector}:has-text("${GitPO.viewSourceLinkText}")`);
        await expect(viewSourceLink).toBeVisible({ timeout: 20000 });

        const repoUrl = await viewSourceLink.getAttribute('href');
        if (!repoUrl) {
            throw new Error('Missing repository URL on View Source link');
        }

        const githubPagePromise = page.context().waitForEvent('page');
        await viewSourceLink.click();
        const githubPage = await githubPagePromise;
        await githubPage.waitForLoadState('domcontentloaded');

        const actionsUrl = this.buildActionsUrl(repoUrl);
        if (!githubPage.url().startsWith(actionsUrl)) {
            await githubPage.goto(actionsUrl, { timeout: 20000, waitUntil: 'domcontentloaded' });
        }

        await expect(githubPage).toHaveURL(actionsUrl, { timeout: 20000 });

        await githubPage.close();
    }

    private buildActionsUrl(repoUrl: string): string {
        const trimmedUrl = repoUrl.endsWith('/') ? repoUrl.slice(0, -1) : repoUrl;
        return `${trimmedUrl}/actions`;
    }
}

