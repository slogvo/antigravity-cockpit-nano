/**
 * Antigravity Cockpit - Trigger Service
 * 触发服务：执行自动对话触发
 */

import { oauthService } from './oauth_service';
import { credentialStorage } from './credential_storage';
import { TriggerRecord, ModelInfo } from './types';
import { logger } from '../shared/log_service';

// Antigravity API 配置
const ANTIGRAVITY_API_URL = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_USER_AGENT = 'antigravity/1.11.3 windows/amd64';
const ANTIGRAVITY_METADATA = {
    ideType: 'ANTIGRAVITY',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
};
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * 触发服务
 * 负责发送对话请求以触发配额重置周期
 */
class TriggerService {
    private recentTriggers: TriggerRecord[] = [];
    private readonly maxRecords = 40;  // 最多保留 40 条
    private readonly maxDays = 7;      // 最多保留 7 天
    private readonly storageKey = 'triggerHistory';

    /**
     * 初始化：从存储加载历史记录
     */
    initialize(): void {
        this.loadHistory();
    }

    /**
     * 从存储加载历史记录
     */
    private loadHistory(): void {
        const saved = credentialStorage.getState<TriggerRecord[]>(this.storageKey, []);
        this.recentTriggers = this.cleanupRecords(saved);
        logger.debug(`[TriggerService] Loaded ${this.recentTriggers.length} history records`);
    }

    /**
     * 保存历史记录到存储
     */
    private saveHistory(): void {
        credentialStorage.saveState(this.storageKey, this.recentTriggers);
    }

    /**
     * 清理过期记录（超过 7 天或超过 40 条）
     */
    private cleanupRecords(records: TriggerRecord[]): TriggerRecord[] {
        const now = Date.now();
        const maxAge = this.maxDays * 24 * 60 * 60 * 1000;  // 7 天的毫秒数
        
        // 过滤掉超过 7 天的记录
        const filtered = records.filter(record => {
            const recordTime = new Date(record.timestamp).getTime();
            return (now - recordTime) < maxAge;
        });
        
        // 限制最多 40 条
        return filtered.slice(0, this.maxRecords);
    }

    /**
     * 执行触发
     * 发送一条简短的对话消息以触发配额计时
     * @param models 要触发的模型列表，如果不传则使用默认
     */
    async trigger(models?: string[], triggerType: 'manual' | 'auto' = 'manual'): Promise<TriggerRecord> {
        const startTime = Date.now();
        const triggerModels = (models && models.length > 0) ? models : ['gemini-3-flash'];
        const promptText = 'hi';  // 发送的请求内容
        
        logger.info(`[TriggerService] Starting trigger (${triggerType}) for models: ${triggerModels.join(', ')}...`);

        try {
            // 1. 获取有效的 access_token
            const accessToken = await oauthService.getValidAccessToken();
            if (!accessToken) {
                throw new Error('No valid access token. Please authorize first.');
            }

            // 2. 获取 project_id
            const credential = await credentialStorage.getCredential();
            const projectId = credential?.projectId || await this.fetchProjectId(accessToken);

            // 3. 发送触发请求
            const results = [];
            
            for (const model of triggerModels) {
                const reply = await this.sendTriggerRequest(accessToken, projectId, model);
                results.push(`${model}: ${reply}`);
            }

            // 4. 记录成功
            const record: TriggerRecord = {
                timestamp: new Date().toISOString(),
                success: true,
                prompt: `[${triggerModels.join(', ')}] ${promptText}`,
                message: results.join('\n'),
                duration: Date.now() - startTime,
                triggerType: triggerType,
            };

            this.addRecord(record);
            logger.info(`[TriggerService] Trigger successful in ${record.duration}ms`);
            return record;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            
            // 记录失败
            const record: TriggerRecord = {
                timestamp: new Date().toISOString(),
                success: false,
                prompt: `[${triggerModels.join(', ')}] ${promptText}`,
                message: err.message,
                duration: Date.now() - startTime,
                triggerType: triggerType,
            };

            this.addRecord(record);
            logger.error(`[TriggerService] Trigger failed: ${err.message}`);
            return record;
        }
    }

    /**
     * 获取最近的触发记录
     */
    getRecentTriggers(): TriggerRecord[] {
        return [...this.recentTriggers];
    }

    /**
     * 获取最后一次触发记录
     */
    getLastTrigger(): TriggerRecord | undefined {
        return this.recentTriggers[0];
    }

    /**
     * 清空历史记录
     */
    clearHistory(): void {
        this.recentTriggers = [];
        this.saveHistory();
        logger.info('[TriggerService] History cleared');
    }

    /**
     * 添加触发记录
     */
    private addRecord(record: TriggerRecord): void {
        this.recentTriggers.unshift(record);
        // 清理并限制数量
        this.recentTriggers = this.cleanupRecords(this.recentTriggers);
        // 持久化保存
        this.saveHistory();
    }

    /**
     * 获取 project_id
     */
    private async fetchProjectId(accessToken: string): Promise<string> {
        const projectId = await this.tryLoadCodeAssist(accessToken)
            || await this.tryOnboardUser(accessToken);

        if (projectId) {
            const credential = await credentialStorage.getCredential();
            if (credential) {
                credential.projectId = projectId;
                await credentialStorage.saveCredential(credential);
            }
            return projectId;
        }

        logger.warn('[TriggerService] Failed to fetch project_id, using fallback');
        const randomId = Math.random().toString(36).substring(2, 10);
        return `projects/random-${randomId}/locations/global`;
    }

    /**
     * 获取可用模型列表
     * @param filterByConstants 可选，配额中显示的模型常量列表，用于过滤
     */
    async fetchAvailableModels(filterByConstants?: string[]): Promise<ModelInfo[]> {
        const accessToken = await oauthService.getValidAccessToken();
        if (!accessToken) {
            logger.debug('[TriggerService] fetchAvailableModels: No access token, skipping');
            return [];
        }

        const url = `${ANTIGRAVITY_API_URL}/v1internal:fetchAvailableModels`;
        const result = await this.requestJson(url, {}, accessToken);

        if (!result.ok || !result.data) {
            logger.warn('[TriggerService] fetchAvailableModels failed, returning empty');
            // 返回空数组，让前端从配额数据中获取模型列表
            return [];
        }

        const data = result.data as { models?: Record<string, { displayName?: string; model?: string }> };
        if (!data.models) {
            return [];
        }

        // 构建 ModelInfo 数组
        const allModels: ModelInfo[] = Object.entries(data.models).map(([id, info]) => ({
            id,
            displayName: info.displayName || id,
            modelConstant: info.model || '',
        }));

        // 如果提供了过滤列表，按顺序返回匹配的模型
        if (filterByConstants && filterByConstants.length > 0) {
            // 建立 modelConstant -> ModelInfo 的映射
            const modelMap = new Map<string, ModelInfo>();
            for (const model of allModels) {
                if (model.modelConstant) {
                    modelMap.set(model.modelConstant, model);
                }
            }
            
            // 按照 filterByConstants 的顺序返回
            const sorted: ModelInfo[] = [];
            for (const constant of filterByConstants) {
                const model = modelMap.get(constant);
                if (model) {
                    sorted.push(model);
                }
            }
            
            logger.debug(`[TriggerService] Filtered models (sorted): ${sorted.map(m => m.displayName).join(', ')}`);
            return sorted;
        }

        logger.debug(`[TriggerService] All available models: ${allModels.map(m => m.displayName).join(', ')}`);
        return allModels;
    }

    /**
     * 发送触发请求
     * 发送一条简短的消息来触发配额计时
     * @returns AI 的简短回复
     */
    private async sendTriggerRequest(accessToken: string, projectId: string, model: string): Promise<string> {
        const sessionId = this.generateSessionId();
        const requestId = this.generateRequestId();

        const requestBody = {
            project: projectId,
            requestId: requestId,
            model: model,
            userAgent: 'antigravity',
            request: {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: 'hi' }],  // 最简短的消息
                    },
                ],
                session_id: sessionId,
                // 不限制输出长度，让模型自然回复
            },
        };

        const response = await fetch(`${ANTIGRAVITY_API_URL}/v1internal:generateContent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': ANTIGRAVITY_USER_AGENT,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} - ${errorText.substring(0, 100)}`);
        }

        const text = await response.text();
        // 输出完整响应，便于调试
        logger.info(`[TriggerService] generateContent response: ${text.substring(0, 2000)}`);
        
        try {
            const data = JSON.parse(text);
            // Antigravity API 响应结构：data.response.candidates[0].content.parts[0].text
            // 或者直接：data.candidates[0].content.parts[0].text
            const candidates = data?.response?.candidates || data?.candidates;
            const reply = candidates?.[0]?.content?.parts?.[0]?.text || '(无回复)';
            return reply.trim();
        } catch {
            return '(收到非 JSON 响应)';
        }
    }

    private async tryLoadCodeAssist(accessToken: string): Promise<string | null> {
        const url = `${ANTIGRAVITY_API_URL}/v1internal:loadCodeAssist`;
        const body = { metadata: ANTIGRAVITY_METADATA };
        const result = await this.requestJson(url, body, accessToken);

        if (!result.ok) {
            logger.warn(`[TriggerService] loadCodeAssist failed: ${result.status}`);
            return null;
        }

        const data = result.data as {
            currentTier?: unknown;
            cloudaicompanionProject?: unknown;
        } | undefined;

        if (!data?.currentTier) {
            logger.info('[TriggerService] loadCodeAssist: user not activated');
            return null;
        }

        const project = data.cloudaicompanionProject;
        if (typeof project === 'string' && project) {
            return project;
        }
        if (project && typeof project === 'object' && 'id' in project) {
            const id = (project as { id?: string }).id;
            if (id) {
                return id;
            }
        }

        logger.warn('[TriggerService] loadCodeAssist returned no project_id');
        return null;
    }

    private async tryOnboardUser(accessToken: string): Promise<string | null> {
        const tierId = await this.getOnboardTier(accessToken);
        if (!tierId) {
            return null;
        }

        const url = `${ANTIGRAVITY_API_URL}/v1internal:onboardUser`;
        const body = {
            tierId,
            metadata: ANTIGRAVITY_METADATA,
        };

        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const result = await this.requestJson(url, body, accessToken);
            if (!result.ok) {
                logger.warn(`[TriggerService] onboardUser failed: ${result.status}`);
                return null;
            }

            const data = result.data as {
                done?: boolean;
                response?: { cloudaicompanionProject?: unknown };
            } | undefined;

            if (data?.done) {
                const project = data.response?.cloudaicompanionProject;
                if (typeof project === 'string' && project) {
                    return project;
                }
                if (project && typeof project === 'object' && 'id' in project) {
                    const id = (project as { id?: string }).id;
                    if (id) {
                        return id;
                    }
                }
                logger.warn('[TriggerService] onboardUser done but no project_id');
                return null;
            }

            await this.sleep(2000);
        }

        logger.warn('[TriggerService] onboardUser timed out');
        return null;
    }

    private async getOnboardTier(accessToken: string): Promise<string | null> {
        const url = `${ANTIGRAVITY_API_URL}/v1internal:loadCodeAssist`;
        const body = { metadata: ANTIGRAVITY_METADATA };
        const result = await this.requestJson(url, body, accessToken);

        if (!result.ok) {
            logger.warn(`[TriggerService] loadCodeAssist (tier) failed: ${result.status}`);
            return null;
        }

        const data = result.data as { allowedTiers?: Array<{ id?: string; isDefault?: boolean }> } | undefined;
        const allowedTiers = data?.allowedTiers || [];
        const defaultTier = allowedTiers.find(tier => tier?.isDefault);
        if (defaultTier?.id) {
            return defaultTier.id;
        }

        logger.warn('[TriggerService] No default tier found, using LEGACY');
        return 'LEGACY';
    }

    private async requestJson(
        url: string,
        body: object,
        accessToken: string,
        timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
        retries: number = 2,
    ): Promise<{ ok: boolean; status: number; data?: unknown; text?: string }> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            try {
                // 如果是重试，等待一小会儿 (指数退避)
                if (attempt > 0) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    logger.info(`[TriggerService] Retrying request (${attempt}/${retries}) in ${delay}ms...`);
                    await this.sleep(delay);
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'User-Agent': ANTIGRAVITY_USER_AGENT,
                        'Content-Type': 'application/json',
                        'Accept-Encoding': 'gzip',
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });

                const text = await response.text();
                let data: unknown;
                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch {
                        data = undefined;
                    }
                }

                return {
                    ok: response.ok,
                    status: response.status,
                    data,
                    text,
                };
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                // 只对 fetch 错误（网络错误）进行重试，不包括超时
                if (lastError.name === 'AbortError') {
                    // 超时通常不再重试，除非你想，这里假设超时不重试以快速失败
                    // 但如果是 fetch failed，通常是网络问题
                }
                logger.warn(`[TriggerService] Request attempt ${attempt + 1} failed: ${lastError.message}`);
                
                // 如果是最后一次尝试，或者错误不是网络连接错误（简单起见，所有 fetch 异常都重试），退出循环
                if (attempt === retries) {
                    break;
                }
            } finally {
                clearTimeout(timeout);
            }
        }
        
        return { ok: false, status: 0 };
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 生成 session_id
     */
    private generateSessionId(): string {
        return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * 生成 request_id
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
}

// 导出单例
export const triggerService = new TriggerService();
