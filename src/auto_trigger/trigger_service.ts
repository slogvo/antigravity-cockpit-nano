/**
 * Antigravity Cockpit - Trigger Service
 * Trigger Service: Execute automatic conversation trigger
 */

import { oauthService } from './oauth_service';
import { credentialStorage } from './credential_storage';
import { TriggerRecord, ModelInfo } from './types';
import { logger } from '../shared/log_service';

// Antigravity API Configuration
const ANTIGRAVITY_API_URL = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_USER_AGENT = 'antigravity/1.11.3 windows/amd64';
const ANTIGRAVITY_METADATA = {
    ideType: 'ANTIGRAVITY',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
};
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Trigger Service
 * Responsible for sending conversation requests to trigger quota reset cycle
 */
class TriggerService {
    private recentTriggers: TriggerRecord[] = [];
    private readonly maxRecords = 40;  // Keep max 40 records
    private readonly maxDays = 7;      // Keep max 7 days
    private readonly storageKey = 'triggerHistory';

    /**
     * Initialize: Load history from storage
     */
    initialize(): void {
        this.loadHistory();
    }

    /**
     * Load history from storage
     */
    private loadHistory(): void {
        const saved = credentialStorage.getState<TriggerRecord[]>(this.storageKey, []);
        this.recentTriggers = this.cleanupRecords(saved);
        logger.debug(`[TriggerService] Loaded ${this.recentTriggers.length} history records`);
    }

    /**
     * Save history to storage
     */
    private saveHistory(): void {
        credentialStorage.saveState(this.storageKey, this.recentTriggers);
    }

    /**
     * Clean up expired records (older than 7 days or exceeding 40 records)
     */
    private cleanupRecords(records: TriggerRecord[]): TriggerRecord[] {
        const now = Date.now();
        const maxAge = this.maxDays * 24 * 60 * 60 * 1000;  // Milliseconds in 7 days
        
        // Filter out records older than 7 days
        const filtered = records.filter(record => {
            const recordTime = new Date(record.timestamp).getTime();
            return (now - recordTime) < maxAge;
        });
        
        // Limit to max 40 records
        return filtered.slice(0, this.maxRecords);
    }

    /**
     * Execute trigger
     * Send a short conversation message to trigger quota timing
     * @param models List of models to trigger, defaults used if not provided
     */
    async trigger(models?: string[], triggerType: 'manual' | 'auto' = 'manual'): Promise<TriggerRecord> {
        const startTime = Date.now();
        const triggerModels = (models && models.length > 0) ? models : ['gemini-3-flash'];
        const promptText = 'hi';  // Content of request sent
        
        logger.info(`[TriggerService] Starting trigger (${triggerType}) for models: ${triggerModels.join(', ')}...`);

        try {
            // 1. Get valid access_token
            const accessToken = await oauthService.getValidAccessToken();
            if (!accessToken) {
                throw new Error('No valid access token. Please authorize first.');
            }

            // 2. Get project_id
            const credential = await credentialStorage.getCredential();
            const projectId = credential?.projectId || await this.fetchProjectId(accessToken);

            // 3. Send trigger request
            const results = [];
            
            for (const model of triggerModels) {
                const reply = await this.sendTriggerRequest(accessToken, projectId, model);
                results.push(`${model}: ${reply}`);
            }

            // 4. Record success
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
            
            // Record failure
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
     * Get recent trigger records
     */
    getRecentTriggers(): TriggerRecord[] {
        return [...this.recentTriggers];
    }

    /**
     * Get last trigger record
     */
    getLastTrigger(): TriggerRecord | undefined {
        return this.recentTriggers[0];
    }

    /**
     * Clear history
     */
    clearHistory(): void {
        this.recentTriggers = [];
        this.saveHistory();
        logger.info('[TriggerService] History cleared');
    }

    /**
     * Add trigger record
     */
    private addRecord(record: TriggerRecord): void {
        this.recentTriggers.unshift(record);
        // Clean up and limit count
        this.recentTriggers = this.cleanupRecords(this.recentTriggers);
        // Persist to storage
        this.saveHistory();
    }

    /**
     * Get project_id
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
     * Get available model list
     * @param filterByConstants Optional, list of model constants displayed in quota, used for filtering
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
            // Return empty array, let frontend get model list from quota data
            return [];
        }

        const data = result.data as { models?: Record<string, { displayName?: string; model?: string }> };
        if (!data.models) {
            return [];
        }

        // Build ModelInfo array
        const allModels: ModelInfo[] = Object.entries(data.models).map(([id, info]) => ({
            id,
            displayName: info.displayName || id,
            modelConstant: info.model || '',
        }));

        // If filter list provided, return matching models in order
        if (filterByConstants && filterByConstants.length > 0) {
            // Build modelConstant -> ModelInfo map
            const modelMap = new Map<string, ModelInfo>();
            for (const model of allModels) {
                if (model.modelConstant) {
                    modelMap.set(model.modelConstant, model);
                }
            }
            
            // Return in order of filterByConstants
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
     * Send trigger request
     * Send a short message to trigger quota timing
     * @returns Short reply from AI
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
                        parts: [{ text: 'hi' }],  // Shortest message
                    },
                ],
                session_id: sessionId,
                // No output length limit, let model reply naturally
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
        // Output complete response for debugging
        logger.info(`[TriggerService] generateContent response: ${text.substring(0, 2000)}`);
        
        try {
            const data = JSON.parse(text);
            // Antigravity API response structure: data.response.candidates[0].content.parts[0].text
            // Or directly: data.candidates[0].content.parts[0].text
            const candidates = data?.response?.candidates || data?.candidates;
            const reply = candidates?.[0]?.content?.parts?.[0]?.text || '(No reply)';
            return reply.trim();
        } catch {
            return '(Non-JSON response received)';
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
                // If retry, wait a short while (exponential backoff)
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
                // Only retry on fetch errors (network errors), excluding timeouts
                if (lastError.name === 'AbortError') {
                    // Timeouts generally not retried, assume fail fast here
                    // But if fetch failed, usually network issue
                }
                logger.warn(`[TriggerService] Request attempt ${attempt + 1} failed: ${lastError.message}`);
                
                // If last attempt, or error is not network error (for simplicity, retry all fetch exceptions), break loop
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
     * Generate session_id
     */
    private generateSessionId(): string {
        return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Generate request_id
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
}

// Export Singleton
export const triggerService = new TriggerService();
