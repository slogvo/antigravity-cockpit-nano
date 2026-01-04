/**
 * Antigravity Cockpit - Announcement Service
 * Announcement Service: fetch, filter, cache announcements
 */

import * as vscode from 'vscode';
import { Announcement, AnnouncementResponse, AnnouncementState } from './types';
import { logger } from '../shared/log_service';

// Announcement Source URL (GitHub Gist Raw URL)
const ANNOUNCEMENT_URL_PROD = 'https://gist.githubusercontent.com/jlcodes99/49facf261e9479a5b50fb81e4ab0afad/raw/announcements.json';
const ANNOUNCEMENT_URL_DEV = 'https://gist.githubusercontent.com/jlcodes99/5618ef028eeaa7bdf6c45eca176f2a0a/raw/announcements_dev.json';

// Storage Key
const READ_IDS_KEY = 'announcement_read_ids';
const CACHE_KEY = 'announcement_cache';
const CACHE_TTL = 3600 * 1000; // 1 hour cache

/**
 * Simple version comparison (supports >=, <=, >, <, = and * wildcards)
 */
function matchVersion(currentVersion: string, pattern: string): boolean {
    if (!pattern || pattern === '*') return true;
    
    // Parse version number to number array
    const parseVersion = (v: string): number[] => {
        return v.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
    };
    
    const current = parseVersion(currentVersion);
    
    // Support >= <= > < prefixes
    const match = pattern.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) return true;
    
    const [, op = '=', ver] = match;
    const target = parseVersion(ver);
    
    // Compare versions
    for (let i = 0; i < 3; i++) {
        const c = current[i] || 0;
        const t = target[i] || 0;
        if (c !== t) {
            const cmp = c - t;
            switch (op) {
                case '>=': return cmp >= 0;
                case '<=': return cmp <= 0;
                case '>': return cmp > 0;
                case '<': return cmp < 0;
                default: return false;
            }
        }
    }
    
    // Versions equal
    return op === '>=' || op === '<=' || op === '=';
}

/**
 * Announcement Service
 */
class AnnouncementService {
    private context!: vscode.ExtensionContext;
    private currentVersion: string = '0.0.0';
    private cachedAnnouncements: Announcement[] = [];
    private initialized = false;
    private announcementUrl: string = ANNOUNCEMENT_URL_PROD;

    /**
     * Initialize Service
     */
    initialize(context: vscode.ExtensionContext): void {
        if (this.initialized) return;
        
        this.context = context;
        
        // Get current extension version
        const ext = vscode.extensions.getExtension('jlcodes.antigravity-cockpit');
        this.currentVersion = ext?.packageJSON?.version || '0.0.0';
        
        // Try loading cache
        const cached = context.globalState.get<{ time: number; data: Announcement[] }>(CACHE_KEY);
        if (cached?.data) {
            this.cachedAnnouncements = cached.data;
        }
        
        // Use test announcement source in development environment
        if (context.extensionMode === vscode.ExtensionMode.Development) {
            this.announcementUrl = ANNOUNCEMENT_URL_DEV;
            logger.info('[AnnouncementService] Using DEV announcement source');
        }
        
        this.initialized = true;
        logger.info(`[AnnouncementService] Initialized, version=${this.currentVersion}, url=${this.announcementUrl.includes('dev') ? 'DEV' : 'PROD'}`);
    }

    /**
     * Fetch announcements (with cache)
     */
    async fetchAnnouncements(): Promise<Announcement[]> {
        // Check if cache is valid
        const cached = this.context.globalState.get<{ time: number; data: Announcement[] }>(CACHE_KEY);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
            logger.debug('[AnnouncementService] Using cached announcements');
            this.cachedAnnouncements = cached.data;
            return this.filterAnnouncements(cached.data);
        }

        try {
            logger.info('[AnnouncementService] Fetching announcements from remote...');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            // Add timestamp parameter to bypass HTTP cache
            const urlWithTimestamp = `${this.announcementUrl}?t=${Date.now()}`;
            const response = await fetch(urlWithTimestamp, {
                headers: { 
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json() as AnnouncementResponse;
            this.cachedAnnouncements = data.announcements || [];

            // Update cache
            await this.context.globalState.update(CACHE_KEY, {
                time: Date.now(),
                data: this.cachedAnnouncements,
            });

            logger.info(`[AnnouncementService] Fetched ${this.cachedAnnouncements.length} announcements`);
            return this.filterAnnouncements(this.cachedAnnouncements);

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[AnnouncementService] Fetch failed: ${err.message}, using cache`);
            return this.filterAnnouncements(this.cachedAnnouncements);
        }
    }

    /**
     * Filter announcements (version matching, time filtering)
     */
    private filterAnnouncements(list: Announcement[]): Announcement[] {
        const now = Date.now();
        const locale = vscode.env.language.toLowerCase(); // e.g., 'zh-cn', 'en-us'

        return list.filter(ann => {
            // 1. Version matching
            if (ann.targetVersions && ann.targetVersions !== '*') {
                if (!matchVersion(this.currentVersion, ann.targetVersions)) {
                    return false;
                }
            }

            // 2. Language matching
            if (ann.targetLanguages && ann.targetLanguages.length > 0) {
                const isAllLanguages = ann.targetLanguages.includes('*');
                if (!isAllLanguages) {
                    // Support exact match (zh-cn) and prefix match (zh)
                    const isMatch = ann.targetLanguages.some(lang => 
                        lang.toLowerCase() === locale || locale.startsWith(lang.toLowerCase() + '-')
                    );
                    if (!isMatch) {
                        return false;
                    }
                }
            }

            // 3. Not expired
            if (ann.expiresAt) {
                const expireTime = new Date(ann.expiresAt).getTime();
                if (expireTime < now) {
                    return false;
                }
            }

            return true;
        }).map(ann => {
            // 3. Multilingual handling (Prioritize full name like zh-cn, then prefix like zh)
            if (ann.locales) {
                const localeKey = Object.keys(ann.locales).find(k => 
                    k.toLowerCase() === locale || locale.startsWith(k.toLowerCase())
                );

                if (localeKey && ann.locales[localeKey]) {
                    const localized = ann.locales[localeKey];
                    return {
                        ...ann,
                        title: localized.title || ann.title,
                        summary: localized.summary || ann.summary,
                        content: localized.content || ann.content,
                        action: ann.action ? {
                            ...ann.action,
                            label: localized.actionLabel || ann.action.label
                        } : ann.action
                    };
                }
            }
            return ann;
        }).sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get announcement state (for passing to Webview)
     */
    async getState(): Promise<AnnouncementState> {
        const announcements = await this.fetchAnnouncements();
        const readIds = this.getReadIds();
        const unreadIds = announcements
            .filter(a => !readIds.includes(a.id))
            .map(a => a.id);

        // Find unread announcement requiring popup (highest priority)
        const popupAnnouncement = announcements.find(
            a => a.popup && !readIds.includes(a.id)
        ) || null;

        return {
            announcements,
            unreadIds,
            popupAnnouncement,
        };
    }

    /**
     * Get unread count
     */
    async getUnreadCount(): Promise<number> {
        const state = await this.getState();
        return state.unreadIds.length;
    }

    /**
     * Mark as read
     */
    async markAsRead(id: string): Promise<void> {
        const ids = this.getReadIds();
        if (!ids.includes(id)) {
            ids.push(id);
            await this.context.globalState.update(READ_IDS_KEY, ids);
            logger.debug(`[AnnouncementService] Marked as read: ${id}`);
        }
    }

    /**
     * Mark all as read
     */
    async markAllAsRead(): Promise<void> {
        const announcements = await this.fetchAnnouncements();
        const ids = announcements.map(a => a.id);
        await this.context.globalState.update(READ_IDS_KEY, ids);
        logger.debug('[AnnouncementService] Marked all as read');
    }

    /**
     * Check if read
     */
    isRead(id: string): boolean {
        return this.getReadIds().includes(id);
    }

    /**
     * Get read IDs list
     */
    private getReadIds(): string[] {
        return this.context.globalState.get<string[]>(READ_IDS_KEY) || [];
    }

    /**
     * Clear cache (for debugging)
     */
    async clearCache(): Promise<void> {
        await this.context.globalState.update(CACHE_KEY, undefined);
        await this.context.globalState.update(READ_IDS_KEY, undefined);
        this.cachedAnnouncements = [];
        logger.info('[AnnouncementService] Cache cleared');
    }

    /**
     * Force refresh announcements (clear cache and refetch)
     */
    async forceRefresh(): Promise<AnnouncementState> {
        await this.context.globalState.update(CACHE_KEY, undefined);
        this.cachedAnnouncements = [];
        logger.info('[AnnouncementService] Force refreshing announcements...');
        return await this.getState();
    }
}

// Export singleton
export const announcementService = new AnnouncementService();
