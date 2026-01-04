/**
 * Antigravity Cockpit - Auto Trigger Controller
 * 自动触发功能的主控制器
 * 整合 OAuth、调度器、触发器，提供统一的接口
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

// 存储键
const SCHEDULE_CONFIG_KEY = 'scheduleConfig';

/**
 * 自动触发控制器
 */
class AutoTriggerController {
    private initialized = false;
    private messageHandler?: (message: AutoTriggerMessage) => void;
    /** 配额中显示的模型常量列表，用于过滤可用模型 */
    private quotaModelConstants: string[] = [];


    /**
     * 设置配额模型常量列表（从 Dashboard 的配额数据中获取）
     */
    setQuotaModels(modelConstants: string[]): void {
        this.quotaModelConstants = modelConstants;
        logger.debug(`[AutoTriggerController] Quota model constants set: ${modelConstants.join(', ')}`);
    }

    /**
     * 初始化控制器
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.initialized) {
            return;
        }

        // 初始化凭证存储
        credentialStorage.initialize(context);

        // 初始化触发服务（加载历史记录）
        triggerService.initialize();

        // 恢复调度配置
        const savedConfig = credentialStorage.getState<ScheduleConfig | null>(SCHEDULE_CONFIG_KEY, null);
        if (savedConfig && savedConfig.enabled) {
            logger.info('[AutoTriggerController] Restoring schedule from saved config');
            schedulerService.setSchedule(savedConfig, () => this.executeTrigger());
        }

        this.initialized = true;
        logger.info('[AutoTriggerController] Initialized');
    }

    /**
     * 更新状态栏显示（已整合到主配额悬浮提示中，此方法现为空操作）
     */
    private async updateStatusBar(): Promise<void> {
        // 下次触发时间现在显示在主配额悬浮提示中，不再需要单独的状态栏
    }

    /**
     * 获取当前状态
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
        // 传入配额模型常量进行过滤
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
     * 开始授权流程
     */
    async startAuthorization(): Promise<boolean> {
        return await oauthService.startAuthorization();
    }

    /**
     * 开始授权流程（别名）
     */
    async authorize(): Promise<boolean> {
        return this.startAuthorization();
    }

    /**
     * 撤销授权
     */
    async revokeAuthorization(): Promise<void> {
        await oauthService.revokeAuthorization();
        // 停止调度器
        schedulerService.stop();
        // 禁用调度
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
     * 保存调度配置
     */
    async saveSchedule(config: ScheduleConfig): Promise<void> {
        // 验证配置
        if (config.crontab) {
            const result = schedulerService.validateCrontab(config.crontab);
            if (!result.valid) {
                throw new Error(`无效的 crontab 表达式: ${result.error}`);
            }
        }

        // 保存配置
        await credentialStorage.saveState(SCHEDULE_CONFIG_KEY, config);

        // 更新调度器
        if (config.enabled) {
            const hasAuth = await credentialStorage.hasValidCredential();
            if (!hasAuth) {
                throw new Error('请先完成授权');
            }
            schedulerService.setSchedule(config, () => this.executeTrigger());
        } else {
            schedulerService.stop();
        }

        this.updateStatusBar();
        logger.info(`[AutoTriggerController] Schedule saved, enabled=${config.enabled}`);
    }

    /**
     * 手动触发一次
     * @param models 可选的自定义模型列表
     */
    async testTrigger(models?: string[]): Promise<void> {
        const hasAuth = await credentialStorage.hasValidCredential();
        if (!hasAuth) {
            vscode.window.showErrorMessage('请先完成授权');
            return;
        }

        vscode.window.showInformationMessage('⏳ 正在发送触发请求...');
        
        // 如果传入了自定义模型列表，使用自定义的；否则使用配置中的
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
            vscode.window.showInformationMessage(`✅ 触发成功！耗时 ${result.duration}ms`);
        } else {
            vscode.window.showErrorMessage(`❌ 触发失败: ${result.message}`);
        }

        // 通知 UI 更新
        this.notifyStateUpdate();
    }

    /**
     * 立即触发（别名，返回结果）
     * @param models 可选的自定义模型列表，如果不传则使用配置中的模型
     */
    async triggerNow(models?: string[]): Promise<{ success: boolean; duration?: number; error?: string; response?: string }> {
        const hasAuth = await credentialStorage.hasValidCredential();
        if (!hasAuth) {
            return { success: false, error: '请先完成授权' };
        }

        // 如果传入了自定义模型列表，使用自定义的；否则使用配置中的
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

        // 通知 UI 更新
        this.notifyStateUpdate();

        return {
            success: result.success,
            duration: result.duration,
            error: result.success ? undefined : result.message,
            response: result.success ? result.message : undefined,  // AI 回复内容
        };
    }

    /**
     * 清空历史记录
     */
    async clearHistory(): Promise<void> {
        triggerService.clearHistory();
        this.notifyStateUpdate();
    }

    /**
     * 执行触发（由调度器调用）
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

        // 通知 UI 更新
        this.notifyStateUpdate();
    }

    /**
     * 获取调度描述
     */
    describeSchedule(config: ScheduleConfig): string {
        return schedulerService.describeSchedule(config);
    }

    /**
     * 获取预设模板
     */
    getPresets(): typeof SCHEDULE_PRESETS {
        return SCHEDULE_PRESETS;
    }

    /**
     * 将配置转换为 crontab
     */
    configToCrontab(config: ScheduleConfig): string {
        return schedulerService.configToCrontab(config);
    }

    /**
     * 验证 crontab
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
     * 获取下次运行时间的格式化字符串
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

        // 如果是今天，显示时间
        if (nextRun.toDateString() === now.toDateString()) {
            return nextRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }

        // 如果是明天，显示 "明天 HH:MM"
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (nextRun.toDateString() === tomorrow.toDateString()) {
            return `明天 ${nextRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
        }

        // 其他情况显示日期和时间
        return nextRun.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     * 处理来自 Webview 的消息
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
     * 设置消息处理器（用于向 Webview 发送更新）
     */
    setMessageHandler(handler: (message: AutoTriggerMessage) => void): void {
        this.messageHandler = handler;
    }

    /**
     * 通知状态更新
     */
    private async notifyStateUpdate(): Promise<void> {
        // 更新状态栏
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
     * 销毁控制器
     */
    dispose(): void {
        schedulerService.stop();
        logger.info('[AutoTriggerController] Disposed');
    }
}

// 导出单例
export const autoTriggerController = new AutoTriggerController();
