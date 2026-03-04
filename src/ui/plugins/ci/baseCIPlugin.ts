import { escapeRegex } from '../../../utils/util';
import { CiPo } from '../../page-objects/ciPo';
import { CommonPO } from '../../page-objects/commonPo';
import { CIPlugin } from './ciPlugin';
import { expect, Locator, Page } from '@playwright/test';

export class BaseCIPlugin implements CIPlugin {
    protected name: string;
    protected imageUrlRegex: RegExp;

    constructor(name: string, registryOrg: string) {
        this.name = name;
        this.imageUrlRegex = new RegExp(`^${escapeRegex(registryOrg)}/`, 'i');
    }

    public async checkCIHeading(page: Page): Promise<void> {
        // For GitHub Actions, the name appears as a tab in Security Information, not a heading
        const heading = page.getByRole('heading', { name: this.name });
        const tab = page.getByRole('tab', { name: this.name });

        // Check if either heading or tab is visible
        const headingVisible = await heading.isVisible().catch(() => false);
        const tabVisible = await tab.isVisible().catch(() => false);

        if (!headingVisible && !tabVisible) {
            // Fallback: check for "Github Actions" tab (different casing)
            const tabAlt = page.getByRole('tab', { name: 'Github Actions' });
            await expect(tabAlt).toBeVisible({ timeout: 10000 });
        }
    }

    protected async checkViewOutputPopup(page: Page, row: Locator): Promise<void> {
        const viewOutputButton = row.getByTestId(CommonPO.viewOutputIconTestId);
        await viewOutputButton.click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Check results table
        const resultsTable = dialog.getByTestId(CiPo.resultsTableTestId);
        await expect(resultsTable).toBeVisible();

        // Check column headers
        for (const column of CiPo.resultsTableColumns) {
            await expect(resultsTable.getByRole('columnheader', { name: column })).toBeVisible();
        }

        // Check expected rows exist
        for (const rowName of CiPo.resultsTableRows) {
            await expect(resultsTable.getByRole('gridcell', { name: rowName, exact: true })).toBeVisible();
        }

        // Check IMAGE_URL contains component name
        const imageUrlRow = resultsTable.getByRole('row').filter({ hasText: CiPo.imageUrlRow });
        await expect(imageUrlRow).toContainText(this.name);

        // Check CHAINS-GIT_URL has a link
        const gitUrlRow = resultsTable.getByRole('row').filter({ hasText: CiPo.chainsGitUrlRow });
        await expect(gitUrlRow.getByRole('link')).toBeVisible();

        const closeButton = dialog.getByTestId(CommonPO.closeIconTestId);
        await closeButton.click();
    }

    // eslint-disable-next-line no-unused-vars
    public async checkImageRegistryLinks(_page: Page): Promise<void> {
    }

    // eslint-disable-next-line no-unused-vars
    public async checkActions(_page: Page): Promise<void> {
    }

    // eslint-disable-next-line no-unused-vars
    public async checkPipelineRunsTable(_page: Page): Promise<void> {
    }

    public async checkSecurityInformation(page: Page): Promise<void> {
        // Check the Security Information heading is visible
        const heading = page.getByRole('heading', { name: CiPo.securityInformationHeading });
        await expect(heading).toBeVisible({ timeout: 10000 });

        // Scope column header checks to the security table
        const securityTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: CiPo.securityTableColumns[0] }) });
        for (const column of CiPo.securityTableColumns) {
            await expect(securityTable.getByRole('columnheader', { name: column })).toBeVisible();
        }
    }
}
