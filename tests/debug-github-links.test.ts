import { createBasicFixture } from '../src/utils/test/fixtures';
import { UiComponent } from '../src/ui/uiComponent';
import { loadFromEnv } from '../src/utils/util';

const test = createBasicFixture();
const { expect } = test;

test.describe('Debug GitHub Links', () => {
  let component: UiComponent;

  test.beforeAll('', async ({ testItem }) => {
    const componentName = loadFromEnv('IMAGE_REGISTRY_ORG');
    const imageName = `${componentName}`;
    console.log(`Creating component: ${componentName}`);
    component = await UiComponent.new(componentName, testItem, imageName);
  });

  test('debug - find all links on component overview page', async ({ page }) => {
    // Login first
    await page.goto(component.getCoreComponent().getDeveloperHub().getUrl());
    await component.getGit().login(page);
    
    // Navigate to component overview
    const developerHubUrl = component.getCoreComponent().getDeveloperHub().getUrl();
    const componentName = component.getCoreComponent().getName();
    const componentOverviewUrl = `${developerHubUrl}/catalog/default/component/${componentName}/overview`;
    
    console.log(`Navigating to: ${componentOverviewUrl}`);
    await page.goto(componentOverviewUrl);
    await page.waitForLoadState('networkidle');
    
    // Take a screenshot
    await page.screenshot({ path: 'debug-component-page.png', fullPage: true });
    console.log('Screenshot saved as debug-component-page.png');
    
    // Find all links
    const allLinks = await page.locator('a').all();
    console.log(`Found ${allLinks.length} links on the page`);
    
    // Log all links with text and href
    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      const text = await link.textContent();
      const href = await link.getAttribute('href');
      const innerHTML = await link.innerHTML();
      
      if (href && (href.includes('github') || text?.toLowerCase().includes('source') || text?.toLowerCase().includes('git'))) {
        console.log(`\n=== POTENTIAL GITHUB LINK ${i + 1} ===`);
        console.log(`Text: "${text}"`);
        console.log(`Href: "${href}"`);
        console.log(`HTML: ${innerHTML}`);
        console.log('=====================================');
      }
    }
    
    // Look for specific patterns
    const patterns = [
      'a:has-text("View Source")',
      'a:has-text("Source")',
      'a:has-text("Repository")',
      'a:has-text("GitHub")',
      'a[href*="github.com"]',
      'a[href*="github"]',
      '*[data-testid*="source"]',
      '*[data-testid*="github"]'
    ];
    
    for (const pattern of patterns) {
      const elements = await page.locator(pattern).all();
      if (elements.length > 0) {
        console.log(`\n*** Found ${elements.length} elements matching pattern: ${pattern} ***`);
        for (let i = 0; i < elements.length; i++) {
          const text = await elements[i].textContent();
          const href = await elements[i].getAttribute('href');
          console.log(`  Element ${i + 1}: Text="${text}", Href="${href}"`);
        }
      }
    }
  });
}); 