import { createBasicFixture } from '../src/utils/test/fixtures';
import { loadFromEnv } from '../src/utils/util';

const test = createBasicFixture();
const { expect } = test;

test.describe('Simple GitHub Link Test', () => {
  test('check component page accessibility', async ({ page }) => {
    // Direct navigation to component page without login
    const componentName = loadFromEnv('IMAGE_REGISTRY_ORG');
    const developerHubUrl = loadFromEnv('DEVELOPER_HUB_URL');
    const componentOverviewUrl = `${developerHubUrl}/catalog/default/component/${componentName}/overview`;
    
    console.log(`Direct navigation to: ${componentOverviewUrl}`);
    
    try {
      await page.goto(componentOverviewUrl);
      await page.waitForLoadState('networkidle');
      
      // Take a screenshot to see what we get
      await page.screenshot({ path: 'direct-access-debug.png', fullPage: true });
      console.log('📸 Screenshot saved as direct-access-debug.png');
      
      // Check page title
      const title = await page.title();
      console.log(`Page title: "${title}"`);
      
      // Check if we're redirected to login
      const currentUrl = page.url();
      console.log(`Current URL: ${currentUrl}`);
      
      if (currentUrl.includes('login') || currentUrl.includes('auth')) {
        console.log('🔒 Page requires authentication - redirected to login');
      } else {
        console.log('✅ Page accessible without login');
        
        // Count all elements on the page
        const allElements = await page.locator('*').count();
        console.log(`Total elements on page: ${allElements}`);
        
        // Count all links
        const allLinks = await page.locator('a').count();
        console.log(`Total links on page: ${allLinks}`);
        
        // Look for any text containing "github"
        const githubText = await page.getByText(/github/i).count();
        console.log(`Elements containing "github": ${githubText}`);
        
        // Look for any href containing "github"
        const githubLinks = await page.locator('a[href*="github"]').count();
        console.log(`Links to GitHub: ${githubLinks}`);
      }
      
    } catch (error) {
      console.error('Error accessing page:', error);
      throw error;
    }
  });
}); 