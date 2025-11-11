import { escapeRegex } from '../../../utils/util';
import { CiPo } from '../../page-objects/ciPo';
import { CommonPO } from '../../page-objects/commonPo';
import { CIPlugin } from './ciPlugin';
import { expect, Locator, Page } from '@playwright/test';
import { AcsPO } from '../../page-objects/acsPo';

export class BaseCIPlugin implements CIPlugin {
    private name: string;
    private imageUrlRegex: RegExp;

    constructor(name: string, registryOrg: string) {
        this.name = name;
        this.imageUrlRegex = new RegExp(`^${escapeRegex(registryOrg)}/`, 'i');
    }

    public async checkCIHeading(page: Page): Promise<void> {
        await expect(page.getByRole('heading', { name: this.name })).toBeVisible();
    }

    protected async checkImageScanTable(page: Locator): Promise<void> {
        // Check the titles are visible
        for (const titleName of [AcsPO.cvesBySeverityTitle, AcsPO.cvesByStatusTitle, AcsPO.totalScanResultsTitle]) {
            const title = page.getByText(titleName, { exact: true }).first();
            await expect(title).toBeVisible();
        }

        // Check the ACS vulnerability scan message is visible
        const acsVulnerabilityScanMessage = page.getByText(AcsPO.imageScanMessage);
        await expect(acsVulnerabilityScanMessage).toBeVisible();

        // Check the image url is visible
        await expect(page.getByText(this.imageUrlRegex)).toBeVisible();

        // Check the table is visible
        const table = page.getByTestId(AcsPO.imageScanTableTestId);
        await expect(table).toBeVisible();  
    }

    protected async checkImageCheckTable(page: Locator): Promise<void> {
        for (const titleName of [AcsPO.cvesBySeverityTitle, AcsPO.failingPolicyChecksTitle]) {
            const title = page.getByText(titleName, { exact: true }).first();
            await expect(title).toBeVisible();
        }

        // Check the ACS vulnerability image check message is visible
        const acsVulnerabilityScanMessage = page.getByText(AcsPO.imageCheckMessage);
        await expect(acsVulnerabilityScanMessage).toBeVisible();

        // Check the image url is visible
        await expect(page.getByText(this.imageUrlRegex)).toBeVisible();

        // Check the table is visible
        const table = page.getByTestId(AcsPO.imageCheckTableTestId);
        await expect(table).toBeVisible();
    }

    protected async checkDeploymentCheckTable(page: Locator): Promise<void> {
        // Check the titles are visible
        for (const titleName of [AcsPO.violationsBySeverityTitle, AcsPO.failingPolicyChecksTitle]) {
            const title = page.getByText(titleName, { exact: true }).first();
            await expect(title).toBeVisible();
        }

        // Check the ACS vulnerability deployment check message is visible
        const acsDeploymentCheckMessage = page.getByText(`${AcsPO.deploymentCheckMessagePrefix} ${this.name}`);
        await expect(acsDeploymentCheckMessage).toBeVisible();

        // Check the table is visible
        const table = page.getByTestId(AcsPO.deploymentCheckTableTestId);
        await expect(table).toBeVisible();
    }

    protected async checkViewOutputPopup(page: Page, row: Locator): Promise<void> {
        const viewOutputButton = row.getByTestId(CommonPO.viewOutputIconTestId);
        await viewOutputButton.click();

        const acsTitle = page.locator(`div[data-testid="${AcsPO.cardTitleTestId}"]`).first();
        await expect(acsTitle).toBeVisible();

        const visiblePanel = page.locator(AcsPO.visibleTabPanelSelector);
        await expect(visiblePanel).toBeVisible();

        const imageScanTabButton = page.getByRole('tab', { name: CiPo.imageScanTabName });
        await imageScanTabButton.click();
        await this.checkImageScanTable(visiblePanel);

        const imageCheckTabButton = page.getByRole('tab', { name: CiPo.imageCheckTabName });
        await imageCheckTabButton.click();
        await this.checkImageCheckTable(visiblePanel);

        const deploymentCheckTabButton = page.getByRole('tab', { name: CiPo.deploymentCheckTabName });
        await deploymentCheckTabButton.click();
        await this.checkDeploymentCheckTable(visiblePanel);

        const closeButton = page.getByRole('dialog').getByTestId(CommonPO.closeIconTestId);
        await closeButton.click();
    }

    protected async verifyImageScanRegistryLink(
        page: Page,
        row: Locator,
        expectedHref: string,
    ): Promise<void> {
        // "View Scan Results" button, exposed to the tests through `view-output-icon`.
        const viewOutputButton = row.getByTestId(CommonPO.viewOutputIconTestId);
        await viewOutputButton.click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        const imageScanTabButton = dialog.getByRole('tab', { name: CiPo.imageScanTabName });
        await imageScanTabButton.click();

        const visiblePanel = page.locator(AcsPO.visibleTabPanelSelector);
        await expect(visiblePanel).toBeVisible();

        const registryLink = visiblePanel.getByRole('link', { name: this.imageUrlRegex });
        await expect(registryLink).toBeVisible();
        await expect(registryLink).toHaveAttribute('href', expectedHref);

        // Confirm the link opens a new tab leading to the external Quay registry.
        const [externalPage] = await Promise.all([
            page.waitForEvent('popup'),
            registryLink.click(),
        ]);

        try {
            await externalPage.waitForLoadState();
            const destinationUrl = externalPage.url();
            expect(destinationUrl.startsWith('https://quay.io/')).toBe(true);
            expect(destinationUrl).toContain(expectedHref);
            const backstageOrigin = new URL(page.url()).origin;
            expect(destinationUrl.startsWith(backstageOrigin)).toBe(false);
        } finally {
            await externalPage.close();
        }

        const closeButton = dialog.getByTestId(CommonPO.closeIconTestId);
        await closeButton.click();
    }

    // eslint-disable-next-line no-unused-vars
    public async checkActions(_page: Page): Promise<void> {
    }

    // eslint-disable-next-line no-unused-vars
    public async checkPipelineRunsTable(_page: Page): Promise<void> {
    }
}
