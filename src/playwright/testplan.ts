import { CIType } from '../rhtap/core/integration/ci';
import { GitType } from '../rhtap/core/integration/git';
import { TemplateType } from '../rhtap/core/integration/git/templates/templateFactory';
import { ImageRegistryType } from '../rhtap/core/integration/registry';
import { TestItem } from './testItem';

export interface TSScConfig {
  git: GitType;
  ci: CIType;
  registry: ImageRegistryType;
  tpa: string;
  acs: string;
}

export class TestPlan {
  templates: string[];
  tsscConfigs: TSScConfig[];
  tests: string[];

  constructor(data: any) {
    this.templates = data.templates || [];
    this.tsscConfigs = (data.tssc || []).map((config: any) => ({
      git: config.git || '',
      ci: config.ci || '',
      registry: config.registry || '',
      tpa: config.tpa || '',
      acs: config.acs || '',
    }));
    this.tests = data.tests || [];
  }

  hasTemplate(name: string): boolean {
    return this.templates.includes(name);
  }

  hasTest(name: string): boolean {
    return this.tests.includes(name);
  }

  getTestItems(): TestItem[] {
    const testItems: TestItem[] = [];
    
    this.templates.forEach(template => {
      this.tsscConfigs.forEach(tsscConfig => {
        testItems.push(
          new TestItem(
            template as TemplateType,
            tsscConfig.registry,
            tsscConfig.git,
            tsscConfig.ci,
            tsscConfig.tpa,
            tsscConfig.acs
          )
        );
      });
    });
    
    return testItems;
  }

  getProjectConfigs(): Array<{
    name: string;
    testItem: TestItem;
  }> {
    const projects: Array<{ name: string; testItem: TestItem }> = [];
    
    this.templates.forEach(template => {
      this.tsscConfigs.forEach(tsscConfig => {
        projects.push({
          name: `${template}[${tsscConfig.git}-${tsscConfig.ci}-${tsscConfig.registry}]`,
          testItem: new TestItem(
            template as TemplateType,
            tsscConfig.registry,
            tsscConfig.git,
            tsscConfig.ci,
            tsscConfig.tpa,
            tsscConfig.acs
          )
        });
      });
    });
    
    return projects;
  }

  // Helper methods for validation
  isValid(): boolean {
    return this.templates.length > 0 && this.tsscConfigs.length > 0;
  }

  getTotalProjectCount(): number {
    return this.templates.length * this.tsscConfigs.length;
  }

  getTemplateNames(): string[] {
    return [...this.templates];
  }

  getTsscConfigNames(): string[] {
    return this.tsscConfigs.map(config => `${config.git}-${config.ci}`);
  }
}
