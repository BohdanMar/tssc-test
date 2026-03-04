export const CiPo = {
    // Status constants
    statusOkTestId: 'status-ok',
    statusSucceededText: 'Succeeded',

    // ACS constants
    acsTitle: 'Advanced Cluster Security',
    imageScanTabName: 'Image Scan',
    imageCheckTabName: 'Image Check',
    deploymentCheckTabName: 'Deployment Check',

    // Results table
    resultsTableTestId: 'results-table',
    resultsTableColumns: ['Name', 'Value'],
    resultsTableRows: [
        'IMAGE_DIGEST',
        'IMAGE_URL',
        'BASE_IMAGES_DIGESTS',
        'SBOM_BLOB_URL',
        'CHAINS-GIT_URL',
        'CHAINS-GIT_COMMIT',
        'ACS_SCAN_OUTPUT',
    ],
    imageUrlRow: 'IMAGE_URL',
    chainsGitUrlRow: 'CHAINS-GIT_URL',

    // Security Information (multi-source security viewer)
    securityInformationHeading: 'Security Information',
    securityTableColumns: ['Pipeline Run ID', 'Type', 'Critical', 'Important', 'Moderate', 'Low', 'SBOM', 'Actions'],
    viewLogsButtonTestId: 'button-logs',
    gitlabCITabName: 'Gitlab CI',
};
