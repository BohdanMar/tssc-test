/**
 * UI Component Module
 * 
 * This module provides the main UI automation interface for RHTAP components.
 * It serves as a bridge between the core backend functionality and UI-specific operations.
 * 
 * Key responsibilities:
 * - Wraps core Component functionality for UI testing
 * - Manages UI-specific Git provider implementations
 * - Provides access to Developer Hub URLs and Git operations
 * 
 * @module UiComponent
 */

import { TestItem } from '../playwright/testItem';
import { Component } from '../rhtap/core/component';
import { GitPlugin } from './plugins/git/gitUiInterface';
import { GitUiFactory } from './plugins/git/gitUiFactory';

export class UiComponent {
  private component: Component;
  private git: GitPlugin | undefined;

  private constructor(component: Component, git: GitPlugin | undefined) {
    this.component = component;
    this.git = git;
  }

  /**
   * Creates a new UI Component instance for UI automation testing.
   * This factory method initializes both the core providers and its UI-specific components.
   * 
   * @param name - The name of the component to be created
   * @param testItem - Test configuration containing Git type and other test-specific settings
   * @param imageName - Name of the container image to be used
   * @returns A Promise resolving to a new UiComponent instance
   * 
   * The method performs the following steps:
   * 1. Creates a core Component instance (skip actual creation as component from backend e2e test is reused)
   * 2. Creates a Git UI plugin based on the test configuration (GitHub/GitLab)
   * 3. Returns a new UiComponent that wraps both the core component and UI plugin
   */
  static async new(
    name: string,
    testItem: TestItem,
    imageName: string,
  ): Promise<UiComponent> {
    const component = await Component.new(name, testItem, imageName, false);
    const git = await GitUiFactory.createGitPlugin(
      testItem.getGitType(),
      component.getGit()
    );
    return new UiComponent(component, git);
  }

  /**
   * Gets the core component instance.
   * 
   * @returns The core component instance
   */
  public getCoreComponent(): Component {
    return this.component;
  }

  /**
   * Gets the UI-specific Git plugin instance.
   * This plugin handles UI automation for Git operations like login.
   * 
   * @returns The GitPlugin instance for UI automation
   */
  public getGit(): GitPlugin | undefined {
    return this.git;
  }

  /**
   * Gets the component URL for the Developer Hub UI.
   * Constructs the URL using the Developer Hub base URL and component name.
   * 
   * @returns The full URL to the component page in Developer Hub
   */
  public getComponentUrl(): string {
    const developerHubUrl = this.component.getDeveloperHub().getUrl();
    const componentName = this.component.getName();
    return `${developerHubUrl}/catalog/default/component/${componentName}`;
  }
}
