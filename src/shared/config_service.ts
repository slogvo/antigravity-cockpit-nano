/**
 * Antigravity Cockpit - Configuration Service
 * Unified management of configuration reading and updates
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { CONFIG_KEYS, TIMING, LOG_LEVELS, STATUS_BAR_FORMAT, QUOTA_THRESHOLDS, DISPLAY_MODE, QUOTA_SOURCE } from './constants';
import { logger } from './log_service';

/** Configuration Object Interface */
export interface CockpitConfig {
    /** Refresh interval (seconds) */
    refreshInterval: number;
    /** Show Prompt Credits */
    showPromptCredits: boolean;
    /** List of pinned models */
    pinnedModels: string[];
    /** Model sort order */
    modelOrder: string[];
    /** Model customized name map (modelId -> displayName) */
    modelCustomNames: Record<string, string>;
    /** Log Level */
    logLevel: string;
    /** Enable Notifications */
    notificationEnabled: boolean;
    /** Status Bar Format */
    statusBarFormat: string;
    /** Enable Grouping */
    groupingEnabled: boolean;
    /** Group customized name map (modelId -> groupName) */
    groupingCustomNames: Record<string, string>;
    /** Show Group in Status Bar */
    groupingShowInStatusBar: boolean;
    pinnedGroups: string[];
    groupOrder: string[];
    groupCustomNames: Record<string, string>;
    groupMappings: Record<string, string>;
    dataMasked: boolean;
    quotaSource: 'local' | 'authorized';
}

/** Configuration Service Class */
class ConfigService {
    private readonly configSection = 'agCockpit';
    private configChangeListeners: Array<(config: CockpitConfig) => void> = [];
    private cachedConfig: CockpitConfig | undefined;
    private version: string = '1.0.0';

    constructor() {
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.configSection)) {
                logger.info('Configuration changed, clearing cache.');
                this.cachedConfig = undefined; // Chỉ xóa cache khi có sự kiện thực sự từ VS Code
                const newConfig = this.getConfig();
                this.configChangeListeners.forEach(listener => listener(newConfig));
            }
        });

        // Load version from package.json
        try {
            const extensionPath = vscode.extensions.getExtension('antigravity-cockpit-nano.antigravity-cockpit-nano')?.extensionPath;
            if (extensionPath) {
                const packageJsonPath = path.join(extensionPath, 'package.json');
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                this.version = packageJson.version;
            }
        } catch (err) {
            logger.error('Failed to load version from package.json', err);
        }
    }

    public getVersion(): string {
        return this.version;
    }

    /**
     * Get complete configuration
     */
    public getConfig(): CockpitConfig {
        // Return cached version if available to ensure speed and avoid race conditions
        if (this.cachedConfig) {
            return this.cachedConfig;
        }

        const config = vscode.workspace.getConfiguration(this.configSection);
        
        this.cachedConfig = {
            refreshInterval: config.get<number>(CONFIG_KEYS.REFRESH_INTERVAL, TIMING.DEFAULT_REFRESH_INTERVAL_MS / 1000),
            showPromptCredits: config.get<boolean>(CONFIG_KEYS.SHOW_PROMPT_CREDITS, false),
            pinnedModels: config.get<string[]>(CONFIG_KEYS.PINNED_MODELS, []),
            modelOrder: config.get<string[]>(CONFIG_KEYS.MODEL_ORDER, []),
            modelCustomNames: config.get<Record<string, string>>(CONFIG_KEYS.MODEL_CUSTOM_NAMES, {}),
            logLevel: config.get<string>(CONFIG_KEYS.LOG_LEVEL, LOG_LEVELS.INFO),
            notificationEnabled: config.get<boolean>(CONFIG_KEYS.NOTIFICATION_ENABLED, true),
            statusBarFormat: config.get<string>(CONFIG_KEYS.STATUS_BAR_FORMAT, STATUS_BAR_FORMAT.STANDARD),
            groupingEnabled: config.get<boolean>(CONFIG_KEYS.GROUPING_ENABLED, false),
            groupingCustomNames: config.get<Record<string, string>>(CONFIG_KEYS.GROUPING_CUSTOM_NAMES, {}),
            groupingShowInStatusBar: config.get<boolean>(CONFIG_KEYS.GROUPING_SHOW_IN_STATUS_BAR, false),
            pinnedGroups: config.get<string[]>(CONFIG_KEYS.PINNED_GROUPS, []),
            groupOrder: config.get<string[]>(CONFIG_KEYS.GROUP_ORDER, []),
            groupCustomNames: config.get<Record<string, string>>(CONFIG_KEYS.GROUPING_CUSTOM_NAMES, {}), // Fixed key
            groupMappings: config.get<Record<string, string>>(CONFIG_KEYS.GROUP_MAPPINGS, {}),
            dataMasked: config.get<boolean>(CONFIG_KEYS.DATA_MASKED, false),
            quotaSource: config.get<'local' | 'authorized'>(CONFIG_KEYS.QUOTA_SOURCE, QUOTA_SOURCE.LOCAL),
        };

        return this.cachedConfig;
    }

    /**
     * Get refresh interval (ms)
     */
    getRefreshIntervalMs(): number {
        return this.getConfig().refreshInterval * 1000;
    }

    /**
     * Update configuration item
     */
    private async updateConfig<K extends keyof CockpitConfig>(
        key: K, 
        value: CockpitConfig[K], 
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
    ): Promise<void> {
        // Update the cache immediately
        const current = this.getConfig();
        const nextConfig = { ...current, [key]: value };
        this.cachedConfig = nextConfig;
        
        // Notify listeners immediately so the UI reflects the change (star glows instantly)
        this.configChangeListeners.forEach(listener => listener(nextConfig));

        logger.info(`Updating config '${this.configSection}.${key}':`, JSON.stringify(value));
        const config = vscode.workspace.getConfiguration(this.configSection);
        
        // We DON'T clear the cache here anymore. 
        // We wait for VS Code's onDidChangeConfiguration event to clear it, 
        // which ensures we don't reload the old value due to disk IO lag.
        await config.update(key, value, target);
    }

    /**
     * Toggle pinned model
     */
    public async togglePinnedModel(modelId: string): Promise<void> {
        logger.info(`Toggling pin state for model: ${modelId}`);
        const currentPins = this.getConfig().pinnedModels;
        const index = currentPins.indexOf(modelId);

        if (index === -1) {
            // Check limit: Max 3 models
            if (currentPins.length >= 3) {
                vscode.window.showWarningMessage(
                    `Maximum of 3 models can be pinned.`,
                );
                return;
            }
            logger.info(`Model ${modelId} not found in pins, adding.`);
            const newPins = [...currentPins, modelId];
            await this.updateConfig('pinnedModels', newPins);
        } else {
            logger.info(`Model ${modelId} found in pins at index ${index}, removing.`);
            const newPins = [...currentPins];
            newPins.splice(index, 1);
            await this.updateConfig('pinnedModels', newPins);
        }
    }

    /**
     * Toggle Show Prompt Credits
     */
    async toggleShowPromptCredits(): Promise<boolean> {
        const config = this.getConfig();
        const newValue = !config.showPromptCredits;
        await this.updateConfig('showPromptCredits', newValue);
        return newValue;
    }

    /**
     * Update model order
     */
    async updateModelOrder(order: string[]): Promise<void> {
        await this.updateConfig('modelOrder', order);
    }

    /**
     * Reset model order (Clear custom order)
     */
    async resetModelOrder(): Promise<void> {
        await this.updateConfig('modelOrder', []);
    }

    /**
     * Update Model Custom Name
     * @param modelId Model ID
     * @param displayName New display name
     */
    async updateModelName(modelId: string, displayName: string): Promise<void> {
        const config = this.getConfig();
        const customNames = { ...config.modelCustomNames };
        
        if (displayName.trim()) {
            customNames[modelId] = displayName.trim();
        } else {
            // If name is empty, delete custom name (revert to original name)
            delete customNames[modelId];
        }
        
        logger.info(`Updating model name for ${modelId} to: ${displayName}`);
        await this.updateConfig('modelCustomNames', customNames);
    }

    /**
     * Update Group Name
     * Associate all models in a group with a specified name (Anchor Consensus Mechanism)
     * @param modelIds All Model IDs in the group
     * @param groupName New group name
     */
    async updateGroupName(modelIds: string[], groupName: string): Promise<void> {
        const config = this.getConfig();
        const customNames = { ...config.groupingCustomNames };
        
        // Associate all model IDs in the group with this name
        for (const modelId of modelIds) {
            customNames[modelId] = groupName;
        }
        
        logger.info(`Updating group name for ${modelIds.length} models to: ${groupName}`);
        await this.updateConfig('groupingCustomNames', customNames);
    }

    /**
     * Toggle Grouping Enabled
     */
    async toggleGroupingEnabled(): Promise<boolean> {
        const config = this.getConfig();
        const newValue = !config.groupingEnabled;
        await this.updateConfig('groupingEnabled', newValue);
        return newValue;
    }

    /**
     * Toggle Group Status Bar Display
     */
    async toggleGroupingStatusBar(): Promise<boolean> {
        const config = this.getConfig();
        const newValue = !config.groupingShowInStatusBar;
        await this.updateConfig('groupingShowInStatusBar', newValue);
        return newValue;
    }

    /**
     * Toggle Pinned Group
     */
    async togglePinnedGroup(groupId: string): Promise<string[]> {
        logger.info(`Toggling pin state for group: ${groupId}`);
        const config = this.getConfig();
        const pinnedGroups = [...config.pinnedGroups];

        const existingIndex = pinnedGroups.indexOf(groupId);

        if (existingIndex > -1) {
            logger.info(`Group ${groupId} found at index ${existingIndex}, removing.`);
            pinnedGroups.splice(existingIndex, 1);
        } else {
            logger.info(`Group ${groupId} not found, adding.`);
            pinnedGroups.push(groupId);
        }

        logger.info(`New pinned groups: ${JSON.stringify(pinnedGroups)}`);
        await this.updateConfig('pinnedGroups', pinnedGroups);
        return pinnedGroups;
    }

    /**
     * Update Group Order
     */
    async updateGroupOrder(order: string[]): Promise<void> {
        await this.updateConfig('groupOrder', order);
    }

    /**
     * Reset Group Order
     */
    async resetGroupOrder(): Promise<void> {
        await this.updateConfig('groupOrder', []);
    }

    /**
     * Update Group Mappings (modelId -> groupId)
     */
    async updateGroupMappings(mappings: Record<string, string>): Promise<void> {
        await this.updateConfig('groupMappings', mappings);
    }

    /**
     * Clear Group Mappings (Trigger re-auto-grouping)
     */
    async clearGroupMappings(): Promise<void> {
        await this.updateConfig('groupMappings', {});
    }

    /**
     * Register Configuration Change Listener
     */
    onConfigChange(listener: (config: CockpitConfig) => void): vscode.Disposable {
        this.configChangeListeners.push(listener);
        return {
            dispose: () => {
                const index = this.configChangeListeners.indexOf(listener);
                if (index > -1) {
                    this.configChangeListeners.splice(index, 1);
                }
            },
        };
    }

    /**
     * Check if model is pinned
     */
    isModelPinned(modelId: string): boolean {
        return this.getConfig().pinnedModels.some(
            p => p.toLowerCase() === modelId.toLowerCase(),
        );
    }
}

// Export Singleton
export const configService = new ConfigService();
