/**
 * GitHub Integration Page Objects
 * 
 * Contains locators and constants for GitHub-specific UI elements
 * in the Developer Hub component overview page.
 */

export const GithubIntegrationPO = {
    /**
     * Primary selector for the GitHub "View Source" link button
     * This link appears in the About section of the component overview page
     */
    viewSourceLinkSelector: 'a:has-text("View Source")',
    
    /**
     * Alternative selectors for GitHub links
     * Based on common Backstage UI patterns
     */
    githubLinkSelectors: {
        // Text-based selectors
        byText: 'a:has-text("View Source")',
        bySourceText: 'a:has-text("Source")',
        byRepoText: 'a:has-text("Repository")',
        byGithubText: 'a:has-text("GitHub")',
        
        // Href-based selectors
        byGithubHref: 'a[href*="github.com"]',
        byGithubHrefGeneric: 'a[href*="github"]',
        
        // Data attribute selectors
        byTestId: '[data-testid*="source"]',
        byGithubTestId: '[data-testid*="github"]',
        
        // Card and section-based selectors
        inAboutSection: '.MuiCard-root:has(h2:has-text("About")) a',
        inAboutCard: '[data-testid="about-card"] a',
        inLinksSection: '.MuiCard-root:has(h2:has-text("Links")) a',
        
        // Icon-based selectors (common in Backstage)
        withGithubIcon: 'a:has(svg[data-testid="GitHubIcon"])',
        withSourceIcon: 'a:has(svg[data-testid="SourceIcon"])',
        
        // Backstage-specific patterns
        backstageEntityLinks: '[data-testid="entity-metadata"] a',
        backstageAboutLinks: '[data-testid="about-card"] a[href*="github"]',
        
        // Generic fallbacks
        anyGithubLink: 'a[href*="github.com"]',
        anySourceLink: 'a[title*="source" i], a[aria-label*="source" i]'
    },
    
    /**
     * Expected GitHub URL pattern
     * Updated to handle both basic repo URLs and URLs with branch/tree paths
     */
    githubUrlPattern: /^https:\/\/github\.com\/[\w-]+\/[\w-]+(\/.*)?$/,
    
    /**
     * Valid HTTP status codes for repository accessibility check
     */
    validHttpStatusCodes: ['200', '301', '302'],
    
    /**
     * Timeout for waiting for elements
     */
    elementTimeout: 30000,
    
    /**
     * All possible selectors to try in order of preference
     */
    allSelectors: [
        'a:has-text("View Source")',
        'a:has-text("Source")',
        'a[href*="github.com"]',
        '[data-testid="about-card"] a[href*="github"]',
        '.MuiCard-root:has(h2:has-text("About")) a[href*="github"]',
        'a:has(svg[data-testid="GitHubIcon"])',
        '[data-testid="entity-metadata"] a[href*="github"]'
    ]
}; 