/**
 * Antigravity Cockpit - Announcement Types
 * 公告系统类型定义
 */

/** 公告类型 */
export type AnnouncementType = 'feature' | 'warning' | 'info' | 'urgent';

/** 公告操作类型 */
export type AnnouncementActionType = 'tab' | 'url' | 'command';

/** 公告操作 */
export interface AnnouncementAction {
    /** 操作类型 */
    type: AnnouncementActionType;
    /** 目标（Tab ID / URL / 命令 ID） */
    target: string;
    /** 按钮文字 */
    label: string;
    /** 命令参数（仅 type='command' 时有效） */
    arguments?: unknown[];
}

/** 公告多语言内容 */
export interface AnnouncementLocale {
    title?: string;
    summary?: string;
    content?: string;
    actionLabel?: string;
}

/** 公告图片 */
export interface AnnouncementImage {
    /** 图片 URL */
    url: string;
    /** 图片标签（如 "QQ 群"、"微信群"） */
    label?: string;
    /** 图片替代文字 */
    alt?: string;
}

/** 单条公告 */
export interface Announcement {
    /** 唯一标识 */
    id: string;
    /** 公告类型 */
    type: AnnouncementType;
    /** 优先级（数值越大越优先） */
    priority: number;
    /** 标题 */
    title: string;
    /** 简短摘要（列表展示用） */
    summary: string;
    /** 完整内容 */
    content: string;
    /** 操作按钮（可选） */
    action?: AnnouncementAction | null;
    /** 目标版本范围（如 ">=1.6.0", "*" 表示所有） */
    targetVersions: string;
    /** 目标语言列表（如 ["zh-cn", "zh-tw"], ["*"] 或留空表示所有语言） */
    targetLanguages?: string[];
    /** 是否仅显示一次（标记已读后不再弹） */
    showOnce: boolean;
    /** 是否主动弹框 */
    popup: boolean;
    /** 创建时间 */
    createdAt: string;
    /** 过期时间（可选） */
    expiresAt?: string | null;
    /** 多语言支持（可选） */
    locales?: { [key: string]: AnnouncementLocale };
    /** 图片列表（可选） */
    images?: AnnouncementImage[];
}

/** 公告 API 响应 */
export interface AnnouncementResponse {
    /** 数据版本 */
    version: string;
    /** 公告列表 */
    announcements: Announcement[];
}

/** 公告状态（传递给 Webview） */
export interface AnnouncementState {
    /** 所有公告 */
    announcements: Announcement[];
    /** 未读公告 ID 列表 */
    unreadIds: string[];
    /** 需要弹框的未读公告（优先级最高的一条） */
    popupAnnouncement: Announcement | null;
}
