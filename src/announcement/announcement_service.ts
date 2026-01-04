/**
 * Antigravity Cockpit - Announcement Service
 * 公告服务：拉取、过滤、缓存公告
 */

import * as vscode from 'vscode';
import { Announcement, AnnouncementResponse, AnnouncementState } from './types';
import { logger } from '../shared/log_service';

// 公告源 URL（GitHub Gist Raw URL）
const ANNOUNCEMENT_URL_PROD = 'https://gist.githubusercontent.com/jlcodes99/49facf261e9479a5b50fb81e4ab0afad/raw/announcements.json';
const ANNOUNCEMENT_URL_DEV = 'https://gist.githubusercontent.com/jlcodes99/5618ef028eeaa7bdf6c45eca176f2a0a/raw/announcements_dev.json';

// 存储键
const READ_IDS_KEY = 'announcement_read_ids';
const CACHE_KEY = 'announcement_cache';
const CACHE_TTL = 3600 * 1000; // 1 小时缓存

/**
 * 简单的版本比较（支持 >=, <=, >, <, = 和 * 通配符）
 */
function matchVersion(currentVersion: string, pattern: string): boolean {
    if (!pattern || pattern === '*') return true;
    
    // 解析版本号为数字数组
    const parseVersion = (v: string): number[] => {
        return v.replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
    };
    
    const current = parseVersion(currentVersion);
    
    // 支持 >= <= > < 前缀
    const match = pattern.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) return true;
    
    const [, op = '=', ver] = match;
    const target = parseVersion(ver);
    
    // 比较版本
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
    
    // 版本相等
    return op === '>=' || op === '<=' || op === '=';
}

/**
 * 公告服务
 */
class AnnouncementService {
    private context!: vscode.ExtensionContext;
    private currentVersion: string = '0.0.0';
    private cachedAnnouncements: Announcement[] = [];
    private initialized = false;
    private announcementUrl: string = ANNOUNCEMENT_URL_PROD;

    /**
     * 初始化服务
     */
    initialize(context: vscode.ExtensionContext): void {
        if (this.initialized) return;
        
        this.context = context;
        
        // 获取当前插件版本
        const ext = vscode.extensions.getExtension('jlcodes.antigravity-cockpit');
        this.currentVersion = ext?.packageJSON?.version || '0.0.0';
        
        // 尝试加载缓存
        const cached = context.globalState.get<{ time: number; data: Announcement[] }>(CACHE_KEY);
        if (cached?.data) {
            this.cachedAnnouncements = cached.data;
        }
        
        // 开发环境使用测试公告源
        if (context.extensionMode === vscode.ExtensionMode.Development) {
            this.announcementUrl = ANNOUNCEMENT_URL_DEV;
            logger.info('[AnnouncementService] Using DEV announcement source');
        }
        
        this.initialized = true;
        logger.info(`[AnnouncementService] Initialized, version=${this.currentVersion}, url=${this.announcementUrl.includes('dev') ? 'DEV' : 'PROD'}`);
    }

    /**
     * 拉取公告（带缓存）
     */
    async fetchAnnouncements(): Promise<Announcement[]> {
        // 检查缓存是否有效
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

            // 添加时间戳参数绕过 HTTP 缓存
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

            // 更新缓存
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
     * 过滤公告（版本匹配、时间过滤）
     */
    private filterAnnouncements(list: Announcement[]): Announcement[] {
        const now = Date.now();
        const locale = vscode.env.language.toLowerCase(); // e.g., 'zh-cn', 'en-us'

        return list.filter(ann => {
            // 1. 版本匹配
            if (ann.targetVersions && ann.targetVersions !== '*') {
                if (!matchVersion(this.currentVersion, ann.targetVersions)) {
                    return false;
                }
            }

            // 2. 语言匹配
            if (ann.targetLanguages && ann.targetLanguages.length > 0) {
                const isAllLanguages = ann.targetLanguages.includes('*');
                if (!isAllLanguages) {
                    // 支持精确匹配 (zh-cn) 和前缀匹配 (zh)
                    const isMatch = ann.targetLanguages.some(lang => 
                        lang.toLowerCase() === locale || locale.startsWith(lang.toLowerCase() + '-')
                    );
                    if (!isMatch) {
                        return false;
                    }
                }
            }

            // 3. 未过期
            if (ann.expiresAt) {
                const expireTime = new Date(ann.expiresAt).getTime();
                if (expireTime < now) {
                    return false;
                }
            }

            return true;
        }).map(ann => {
            // 3. 多语言处理 (优先匹配全称如 zh-cn，其次匹配前缀如 zh)
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
     * 获取公告状态（用于传递给 Webview）
     */
    async getState(): Promise<AnnouncementState> {
        const announcements = await this.fetchAnnouncements();
        const readIds = this.getReadIds();
        const unreadIds = announcements
            .filter(a => !readIds.includes(a.id))
            .map(a => a.id);

        // 找到需要弹框的未读公告（优先级最高的一条）
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
     * 获取未读数量
     */
    async getUnreadCount(): Promise<number> {
        const state = await this.getState();
        return state.unreadIds.length;
    }

    /**
     * 标记为已读
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
     * 全部标记为已读
     */
    async markAllAsRead(): Promise<void> {
        const announcements = await this.fetchAnnouncements();
        const ids = announcements.map(a => a.id);
        await this.context.globalState.update(READ_IDS_KEY, ids);
        logger.debug('[AnnouncementService] Marked all as read');
    }

    /**
     * 检查是否已读
     */
    isRead(id: string): boolean {
        return this.getReadIds().includes(id);
    }

    /**
     * 获取已读 ID 列表
     */
    private getReadIds(): string[] {
        return this.context.globalState.get<string[]>(READ_IDS_KEY) || [];
    }

    /**
     * 清除缓存（调试用）
     */
    async clearCache(): Promise<void> {
        await this.context.globalState.update(CACHE_KEY, undefined);
        await this.context.globalState.update(READ_IDS_KEY, undefined);
        this.cachedAnnouncements = [];
        logger.info('[AnnouncementService] Cache cleared');
    }

    /**
     * 强制刷新公告（清除缓存并重新拉取）
     */
    async forceRefresh(): Promise<AnnouncementState> {
        await this.context.globalState.update(CACHE_KEY, undefined);
        this.cachedAnnouncements = [];
        logger.info('[AnnouncementService] Force refreshing announcements...');
        return await this.getState();
    }
}

// 导出单例
export const announcementService = new AnnouncementService();
