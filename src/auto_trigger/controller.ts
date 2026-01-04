/**
 * Antigravity Cockpit - Auto Trigger Controller
 * Main Controller for Auto Trigger Functionality
 * Integrates OAuth, Scheduler, Trigger, providing a unified interface
 */

import * as vscode from 'vscode';
import { credentialStorage } from './credential_storage';
import { oauthService } from './oauth_service';
import { schedulerService, CronParser } from './scheduler_service';
import { triggerService } from './trigger_service';
import { 
    AutoTriggerState, 
    ScheduleConfig, 
    AutoTriggerMessage,
    SCHEDULE_PRESETS 
} from './types';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';

// Storage Key
const SCHEDULE_CONFIG_KEY = 'scheduleConfig';

/**
 * Auto Trigger Controller
 */
class AutoTriggerController {
    private initialized = false;
    private messageHandler?: (message: AutoTriggerMessage) => void;
    /** List of model constants displayed in quota, used to filter available models */
    private quotaModelConstants: string[] = [];


    /**
     * Set quota model constant list (retrieved from Dashboard quota data)
     */
    setQuotaModels(modelConstants: string[]): void {
        this.quotaModelConstants = modelConstants;
        logger.debug(`[AutoTriggerController] Quota model constants set: ${modelConstants.join(', ')}`);
    }

    /**
     * Initialize Controller
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Initialize Credential Storage
        credentialStorage.initialize(context);

        // Initialize Trigger Service (Load History)
        triggerService.initialize();

        // Restore Schedule Configuration
        const savedConfig = credentialStorage.getState<ScheduleConfig | null>(SCHEDULE_CONFIG_KEY, null);
        if (savedConfig && savedConfig.enabled) {
            logger.info('[AutoTriggerController] Restoring schedule from saved config');
            schedulerService.setSchedule(savedConfig, () => this.executeTrigger());
        }

        this.initialized = true;
        logger.info('[AutoTriggerController] Initialized');
    }

    /**
     * Update Status Bar Display (Integrated into main quota tooltip, this method is now a no-op)
     */
    private async updateStatusBar(): Promise<void> {
        // Next trigger time is now displayed in the main quota tooltip, no separate status bar needed
    }

    /**
     * Get Current State
     */
    async getState(): Promise<AutoTriggerState> {
        const authorization = await credentialStorage.getAuthorizationStatus();
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            dailyTimes: ['08:00'],
            selectedModels: ['gemini-3-flash'],
        });

        const nextRunTime = schedulerService.getNextRunTime();
        // Pass in quota model constants for filtering
        const availableModels = await triggerService.fetchAvailableModels(this.quotaModelConstants);

        return {
            authorization,
            schedule,
            lastTrigger: triggerService.getLastTrigger(),
            recentTriggers: triggerService.getRecentTriggers(),
            nextTriggerTime: nextRunTime?.toISOString(),
            availableModels,
        };
    }

    /**
     * Start Authorization Process
     */
    async startAuthorization(): Promise<boolean> {
        return await oauthService.startAuthorization();
    }

    /**
     * Start Authorization Process (Alias)
     */
    async authorize(): Promise<boolean> {
        return this.startAuthorization();
    }

    /**
     * Revoke Authorization
     */
    async revokeAuthorization(): Promise<void> {
        await oauthService.revokeAuthorization();
        // Stop Scheduler
        schedulerService.stop();
        // Disable Schedule
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            selectedModels: ['gemini-3-flash'],
        });
        schedule.enabled = false;
        await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, schedule);
        this.updateStatusBar();
    }

    /**
     * Save Schedule Configuration
     */
    async saveSchedule(config: ScheduleConfig): Promise<void> {
        // Validate Configuration
        if (config.crontab) {
            const result = schedulerService.validateCrontab(config.crontab);
            if (!result.valid) {
                throw new Error(`Invalid crontab expression: ${result.error}`);
            }
        }

        // Save Configuration
        await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, config);

        // Update Scheduler
        if (config.enabled) {
            const hasAuth = await credentialStorage.hasValidCredential();
            if (!hasAuth) {
                throw new Error('Please complete authorization first');
            }
            schedulerService.setSchedule(config, () => this.executeTrigger());
        } else {
            schedulerService.stop();
        }

        this.updateStatusBar();
        logger.info(`[AutoTriggerController] Schedule saved, enabled=${config.enabled}`);
    }

    /**
     * Trigger Once Manually
     * @param models Optional custom model list
     */
    async testTrigger(models?: string[]): Promise<void> {
        const hasAuth = await credentialStorage.hasValidCredential();
        if (!hasAuth) {
            vscode.window.showErrorMessage('Please complete authorization first');
            return;
        }

        vscode.window.showInformationMessage('⏳ Sending trigger request...');
        
        // If custom model list is provided, use it; otherwise use configuration
        let selectedModels = models;
        if (!selectedModels || selectedModels.length === 0) {
            const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
                enabled: false,
                repeatMode: 'daily',
                selectedModels: ['gemini-3-flash'],
            });
            selectedModels = schedule.selectedModels || ['gemini-3-flash'];
        }

        const result = await triggerService.trigger(selectedModels, 'manual');

        if (result.success) {
            vscode.window.showInformationMessage(`✅ Trigger Successful! Duration ${result.duration}ms`);
        } else {
            vscode.window.showErrorMessage(`❌ Trigger Failed: ${result.message}`);
        }

        // Notify UI Update
        this.notifyStateUpdate();
    }

    /**
     * Trigger Now (Alias, returns result)
     * @param models Optional custom model list, defaults to configured models if not provided
     */
    async triggerNow(models?: string[]): Promise<{ success: boolean; duration?: number; error?: string; response?: string }> {
        const hasAuth = await credentialStorage.hasValidCredential();
        if (!hasAuth) {
            return { success: false, error: 'Please complete authorization first' };
        }

        // If custom model list is provided, use it; otherwise use configuration
        let selectedModels = models;
        if (!selectedModels || selectedModels.length === 0) {
            const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
                enabled: false,
                repeatMode: 'daily',
                selectedModels: ['gemini-3-flash'],
            });
            selectedModels = schedule.selectedModels || ['gemini-3-flash'];
        }

        const result = await triggerService.trigger(selectedModels, 'manual');

        // Notify UI Update
        this.notifyStateUpdate();

        return {
            success: result.success,
            duration: result.duration,
            error: result.success ? undefined : result.message,
            response: result.success ? result.message : undefined,  // AI Response Content
        };
    }

    /**
     * Clear History
     */
    async clearHistory(): Promise<void> {
        triggerService.clearHistory();
        this.notifyStateUpdate();
    }

    /**
     * Execute Trigger (Called by Scheduler)
     */
    private async executeTrigger(): Promise<void> {
        const schedule = credentialStorage.getState<ScheduleConfig>(SCHEDULE_CONFIG_KEY, {
            enabled: false,
            repeatMode: 'daily',
            selectedModels: ['gemini-3-flash'],
        });
        const result = await triggerService.trigger(schedule.selectedModels, 'auto');
        
        if (result.success) {
            logger.info('[AutoTriggerController] Scheduled trigger executed successfully');
        } else {
            logger.error(`[AutoTriggerController] Scheduled trigger failed: ${result.message}`);
        }

        // Notify UI Update
        this.notifyStateUpdate();
    }

    /**
     * Get Schedule Description
     */
    describeSchedule(config: ScheduleConfig): string {
        return schedulerService.describeSchedule(config);
    }

    /**
     * Get Presets
     */
    getPresets(): typeof SCHEDULE_PRESETS {
        return SCHEDULE_PRESETS;
    }

    /**
     * Convert Configuration to Crontab
     */
    configToCrontab(config: ScheduleConfig): string {
        return schedulerService.configToCrontab(config);
    }

    /**
     * Validate Crontab
     */
    validateCrontab(crontab: string): { valid: boolean; description?: string; error?: string } {
        const result = CronParser.parse(crontab);
        return {
            valid: result.valid,
            description: result.description,
            error: result.error,
        };
    }

    /**
     * Get Formatted Next Run Time String
     */
    getNextRunTimeFormatted(): string | null {
        const nextRun = schedulerService.getNextRunTime();
        if (!nextRun) {
            return null;
        }

        const now = new Date();
        const diff = nextRun.getTime() - now.getTime();

        if (diff < 0) {
            return null;
        }

        // If today, show time
        if (nextRun.toDateString() === now.toDateString()) {
            return nextRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }

        // If tomorrow, show "Tomorrow HH:MM"
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (nextRun.toDateString() === tomorrow.toDateString()) {
            return `Tomorrow ${nextRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
        }

        // Otherwise show date and time
        return nextRun.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     * Handle Messages from Webview
     */
    async handleMessage(message: AutoTriggerMessage): Promise<void> {
        switch (message.type) {
            case 'auto_trigger_get_state':
                this.notifyStateUpdate();
                break;

            case 'auto_trigger_start_auth':
                await this.startAuthorization();
                this.notifyStateUpdate();
                break;

            case 'auto_trigger_revoke_auth':
                await this.revokeAuthorization();
                this.notifyStateUpdate();
                break;

            case 'auto_trigger_save_schedule':
                try {
                    await this.saveSchedule(message.data as unknown as ScheduleConfig);
                    this.notifyStateUpdate();
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    vscode.window.showErrorMessage(err.message);
                }
                break;

            case 'auto_trigger_test_trigger':
                await this.testTrigger(message.data?.models);
                break;

            default:
                logger.warn(`[AutoTriggerController] Unknown message type: ${message.type}`);
        }
    }

    /**
     * Set Message Handler (Used to send updates to Webview)
     */
    setMessageHandler(handler: (message: AutoTriggerMessage) => void): void {
        this.messageHandler = handler;
    }

    /**
     * Notify State Update
     */
    private async notifyStateUpdate(): Promise<void> {
        // Update Status Bar
        this.updateStatusBar();
        
        if (this.messageHandler) {
            const state = await this.getState();
            this.messageHandler({
                type: 'auto_trigger_state_update',
                data: state as any,
            });
        }
    }

    /**
     * Dispose Controller
     */
    dispose(): void {
        schedulerService.stop();
        logger.info('[AutoTriggerController] Disposed');
    }
}

// Export Singleton
export const autoTriggerController = new AutoTriggerController();
