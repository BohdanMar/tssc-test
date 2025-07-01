# GitHub Integration UI Test

## Overview

This document describes the GitHub integration UI test that validates the GitHub link functionality in the RHTAP Developer Hub.

## Test Purpose

The test verifies that after a component is successfully created using a template, the GitHub repository link is properly displayed and functional in the Developer Hub UI.

## What the Test Does

1. **Navigation**: Navigates to the component's overview page in Developer Hub
2. **Link Detection**: Finds the "View Source" GitHub link button in the About section
3. **URL Validation**: Validates that the GitHub URL follows the correct format
4. **Accessibility Check**: Optionally verifies the repository is accessible via HTTP request
5. **UI Validation**: Ensures the link is clickable and has proper attributes

## Test Location

The test is located in: `tests/tssc/ui.test.ts` under the "GitHub Integration" test suite.

## Running the Test

### Prerequisites

1. Component must be created (either manually or via backend tests)
2. Component name must be set in environment variable `IMAGE_REGISTRY_ORG`
3. GitHub credentials must be configured in `.env` file:
   ```
   GH_USERNAME=your-github-username
   GH_PASSWORD=your-github-password
   GH_SECRET=your-github-2fa-secret
   ```

### Execution

Run the UI test suite:
```bash
npm run test:ui
```

Or run in UI mode for debugging:
```bash
npm run ui
```

## Expected Results

The test passes when:
- The GitHub link is visible on the component overview page
- The link URL matches the pattern: `https://github.com/{owner}/{repo}`
- The link is clickable and properly configured
- (Optional) The repository returns a valid HTTP response

## Test Implementation Details

### Page Object

The test uses the `GithubIntegrationPO` page object located in `src/ui/page-objects/github_po.ts` which contains:
- Selectors for finding the GitHub link
- URL validation patterns
- Configuration constants

### Key Selectors

- Primary selector: `a:has-text("View Source")`
- Alternative selectors available in the page object for different UI variations

### Validation Steps

1. **Format Validation**: Uses regex pattern to ensure valid GitHub URL format
2. **HTTP Validation**: Uses curl to check repository accessibility (non-blocking)
3. **Attribute Validation**: Checks link attributes like target="_blank"

## Troubleshooting

### Common Issues

1. **Link Not Found**: 
   - Ensure the component was created successfully
   - Check if the UI has loaded completely
   - Verify the selector matches the current UI

2. **URL Validation Fails**:
   - Check if the repository URL format is correct
   - Ensure the Git provider is properly configured

3. **Accessibility Check Fails**:
   - This is non-blocking and may fail for private repositories
   - Check network connectivity
   - Verify repository permissions

## Screenshots Reference

The test validates the GitHub link shown in the Developer Hub UI as illustrated in the provided screenshots:
- The link appears in the "About" section of the component overview
- It's labeled as "View Source" with a GitHub icon
- Clicking it should navigate to the component's source repository 