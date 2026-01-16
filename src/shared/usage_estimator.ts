/**
 * Usage Estimator - Optimistic quota tracking
 * Estimates quota usage based on user activity before API sync
 */

import { QuotaSnapshot, ModelQuotaInfo } from './types';
import { logger } from './log_service';

export interface UsageEstimate {
    modelId: string;
    estimatedDecrease: number; // Percentage decrease
    timestamp: number;
}

export class UsageEstimator {
    private estimates: Map<string, UsageEstimate> = new Map();
    private lastApiSnapshot: QuotaSnapshot | null = null;

    /**
     * Average quota usage per message for different model types
     */
    private readonly USAGE_ESTIMATES = {
        // High-end models use more quota per message
        'claude-opus': 2.0, // ~2% per message
        'claude-sonnet-thinking': 1.5,
        'gemini-pro-high': 1.5,
        
        // Medium models
        'claude-sonnet': 1.0,
        'gpt-oss': 1.0,
        'gemini-pro-low': 0.8,
        
        // Light models
        'gemini-flash': 0.3,
        
        // Default fallback
        'default': 1.0,
    };

    /**
     * Record that user just sent a message with a specific model
     */
    recordMessageSent(modelId: string): void {
        const estimatedUsage = this.getEstimatedUsage(modelId);
        
        const existing = this.estimates.get(modelId);
        const newDecrease = (existing?.estimatedDecrease || 0) + estimatedUsage;
        
        this.estimates.set(modelId, {
            modelId,
            estimatedDecrease: newDecrease,
            timestamp: Date.now(),
        });
        
        logger.debug(`📊 Estimated usage: ${modelId} -${estimatedUsage.toFixed(2)}% (total: -${newDecrease.toFixed(2)}%)`);
    }

    /**
     * Get estimated usage for a model based on its type
     */
    private getEstimatedUsage(modelId: string): number {
        const lowerModelId = modelId.toLowerCase();
        
        // Match model ID to usage pattern
        for (const [key, usage] of Object.entries(this.USAGE_ESTIMATES)) {
            if (lowerModelId.includes(key)) {
                return usage;
            }
        }
        
        return this.USAGE_ESTIMATES.default;
    }

    /**
     * Apply estimates to a quota snapshot (optimistic update)
     */
    applyEstimates(snapshot: QuotaSnapshot): QuotaSnapshot {
        if (this.estimates.size === 0) {
            return snapshot; // No estimates, return as-is
        }

        // Clone snapshot
        const optimisticSnapshot: QuotaSnapshot = {
            ...snapshot,
            models: snapshot.models.map(model => {
                const estimate = this.findEstimateForModel(model);
                
                if (!estimate) {
                    return model; // No estimate for this model
                }

                // Apply estimated decrease
                const currentPct = model.remainingPercentage ?? 100;
                const optimisticPct = Math.max(0, currentPct - estimate.estimatedDecrease);

                return {
                    ...model,
                    remainingPercentage: optimisticPct,
                    // Mark as estimated
                    isEstimated: true,
                } as ModelQuotaInfo & { isEstimated?: boolean };
            }),
        };

        return optimisticSnapshot;
    }

    /**
     * Find estimate for a model (fuzzy matching)
     */
    private findEstimateForModel(model: ModelQuotaInfo): UsageEstimate | undefined {
        // Try exact match first
        if (this.estimates.has(model.modelId)) {
            return this.estimates.get(model.modelId);
        }

        // Try fuzzy match by label
        for (const [estimatedModelId, estimate] of this.estimates.entries()) {
            if (model.label.toLowerCase().includes(estimatedModelId.toLowerCase()) ||
                estimatedModelId.toLowerCase().includes(model.label.toLowerCase())) {
                return estimate;
            }
        }

        return undefined;
    }

    /**
     * Sync with actual API data - clear old estimates
     */
    syncWithApi(apiSnapshot: QuotaSnapshot): void {
        this.lastApiSnapshot = apiSnapshot;
        
        // Clear estimates that are now reflected in API data
        // (Keep recent estimates < 60s old, clear older ones)
        const now = Date.now();
        const maxAge = 60000; // 60 seconds
        
        for (const [modelId, estimate] of this.estimates.entries()) {
            if (now - estimate.timestamp > maxAge) {
                logger.debug(`🔄 Clearing old estimate for ${modelId}`);
                this.estimates.delete(modelId);
            }
        }
    }

    /**
     * Clear all estimates (e.g., on manual refresh)
     */
    clearAll(): void {
        logger.debug('🧹 Clearing all usage estimates');
        this.estimates.clear();
    }

    /**
     * Get current estimates (for debugging)
     */
    getEstimates(): UsageEstimate[] {
        return Array.from(this.estimates.values());
    }

    /**
     * Check if we have any active estimates
     */
    hasEstimates(): boolean {
        return this.estimates.size > 0;
    }
}

// Export singleton
export const usageEstimator = new UsageEstimator();
