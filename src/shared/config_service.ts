/**
 * Antigravity Cockpit - Configuration Service
 * Unified management of configuration reading and updates
 */

import * as vscode from 'vscode';
import { CONFIG_KEYS, TIMING, LOG_LEVELS, STATUS_BAR_FORMAT, QUOTA_THRESHOLDS, DISPLAY_MODE } from './constants';
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
    /** List of pinned groups */
    pinnedGroups: string[];
    /** Group sort order */
    groupOrder: string[];
    /** Group mappings (modelId -> groupId) */
    groupMappings: Record<string, string>;
    /** Warning Threshold (%) */
    warningThreshold: number;
    /** Critical Threshold (%) */
    criticalThreshold: number;
    /** Display Mode */
    displayMode: string;
    /** Hide Plan Details Panel */
    profileHidden: boolean;
    /** View Mode (card | list) */
    viewMode: string;
    /** Mask Sensitive Data */
    dataMasked: boolean;
}

/** Configuration Service Class */
class ConfigService {
    private readonly configSection = 'agCockpit';
    private configChangeListeners: Array<(config: CockpitConfig) => void> = [];

    constructor() {
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(this.configSection)) {
                const newConfig = this.getConfig();
                this.configChangeListeners.forEach(listener => listener(newConfig));
            }
        });
    }

    /**
     * Get complete configuration
     */
    getConfig(): CockpitConfig {
        const config = vscode.workspace.getConfiguration(this.configSection);
        
        return {
            refreshInterval: config.get<number>(CONFIG_KEYS.REFRESH_INTERVAL, TIMING.DEFAULT_REFRESH_INTERVAL_MS / 1000),
            showPromptCredits: config.get<boolean>(CONFIG_KEYS.SHOW_PROMPT_CREDITS, false),
            pinnedModels: config.get<string[]>(CONFIG_KEYS.PINNED_MODELS, []),
            modelOrder: config.get<string[]>(CONFIG_KEYS.MODEL_ORDER, []),
            modelCustomNames: config.get<Record<string, string>>(CONFIG_KEYS.MODEL_CUSTOM_NAMES, {}),
            logLevel: config.get<string>(CONFIG_KEYS.LOG_LEVEL, LOG_LEVELS.INFO),
            notificationEnabled: config.get<boolean>(CONFIG_KEYS.NOTIFICATION_ENABLED, true),
            statusBarFormat: config.get<string>(CONFIG_KEYS.STATUS_BAR_FORMAT, STATUS_BAR_FORMAT.STANDARD),
            groupingEnabled: config.get<boolean>(CONFIG_KEYS.GROUPING_ENABLED, true),
            groupingCustomNames: config.get<Record<string, string>>(CONFIG_KEYS.GROUPING_CUSTOM_NAMES, {}),
            groupingShowInStatusBar: config.get<boolean>(CONFIG_KEYS.GROUPING_SHOW_IN_STATUS_BAR, true),
            pinnedGroups: config.get<string[]>(CONFIG_KEYS.PINNED_GROUPS, []),
            groupOrder: config.get<string[]>(CONFIG_KEYS.GROUP_ORDER, []),
            groupMappings: config.get<Record<string, string>>(CONFIG_KEYS.GROUP_MAPPINGS, {}),
            warningThreshold: config.get<number>(CONFIG_KEYS.WARNING_THRESHOLD, QUOTA_THRESHOLDS.WARNING_DEFAULT),
            criticalThreshold: config.get<number>(CONFIG_KEYS.CRITICAL_THRESHOLD, QUOTA_THRESHOLDS.CRITICAL_DEFAULT),
            displayMode: config.get<string>(CONFIG_KEYS.DISPLAY_MODE, DISPLAY_MODE.WEBVIEW),
            profileHidden: config.get<boolean>(CONFIG_KEYS.PROFILE_HIDDEN, false),
            viewMode: config.get<string>(CONFIG_KEYS.VIEW_MODE, 'card'),
            dataMasked: config.get<boolean>(CONFIG_KEYS.DATA_MASKED, false),
        };
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
    async updateConfig<K extends keyof CockpitConfig>(
        key: K, 
        value: CockpitConfig[K], 
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
    ): Promise<void> {
        logger.info(`Updating config '${this.configSection}.${key}':`, JSON.stringify(value));
        const config = vscode.workspace.getConfiguration(this.configSection);
        await config.update(key, value, target);
    }

    /**
     * Toggle pinned model
     */
    async togglePinnedModel(modelId: string): Promise<string[]> {
        logger.info(`Toggling pin state for model: ${modelId}`);
        const config = this.getConfig();
        const pinnedModels = [...config.pinnedModels];

        const existingIndex = pinnedModels.findIndex(
            p => p.toLowerCase() === modelId.toLowerCase(),
        );

        if (existingIndex > -1) {
            logger.info(`Model ${modelId} found at index ${existingIndex}, removing.`);
            pinnedModels.splice(existingIndex, 1);
        } else {
            logger.info(`Model ${modelId} not found, adding.`);
            pinnedModels.push(modelId);
        }

        logger.info(`New pinned models: ${JSON.stringify(pinnedModels)}`);
        await this.updateConfig('pinnedModels', pinnedModels);
        return pinnedModels;
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
