import { defineConfig, PlaywrightTestConfig, PlaywrightTestOptions, PlaywrightWorkerOptions } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { TestPlan } from './src/playwright/testplan';
import { TestItem } from './src/playwright/testItem';

// Extend Playwright types to include testItem
declare module '@playwright/test' {
  interface PlaywrightTestOptions {
    testItem?: TestItem;
  }
}

// Load the test plan
const testPlanPath = process.env.TESTPLAN_PATH || path.resolve(process.cwd(), 'testplan.json');
const testPlanData = JSON.parse(readFileSync(testPlanPath, 'utf-8'));
const testPlan = new TestPlan(testPlanData);

// Create projects using the TestPlan class
const projects = testPlan.getProjectConfigs().map(config => ({
  name: config.name,
  use: {
    testItem: config.testItem,
  },
}));

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.test.ts',
  workers: 6,
  projects: projects.length ? projects : [{ name: 'default' }],
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 900000, // Default to 15 minutes (900000ms)
});