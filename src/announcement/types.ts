/**
 * Antigravity Cockpit - Announcement Types
 * Announcement System Type Definitions
 */

/** Announcement Type */
export type AnnouncementType = 'feature' | 'warning' | 'info' | 'urgent';

/** Announcement Action Type */
export type AnnouncementActionType = 'tab' | 'url' | 'command';

/** Announcement Action */
export interface AnnouncementAction {
    /** Action Type */
    type: AnnouncementActionType;
    /** Target (Tab ID / URL / Command ID) */
    target: string;
    /** Button Label */
    label: string;
    /** Command Arguments (valid only when type='command') */
    arguments?: unknown[];
}

/** Announcement Localized Content */
export interface AnnouncementLocale {
    title?: string;
    summary?: string;
    content?: string;
    actionLabel?: string;
}

/** Announcement Image */
export interface AnnouncementImage {
    /** Image URL */
    url: string;
    /** Image Label (e.g., "QQ Group", "WeChat Group") */
    label?: string;
    /** Image Alt Text */
    alt?: string;
}

/** Single Announcement */
export interface Announcement {
    /** Unique ID */
    id: string;
    /** Announcement Type */
    type: AnnouncementType;
    /** Priority (higher number means higher priority) */
    priority: number;
    /** Title */
    title: string;
    /** Short Summary (for list view) */
    summary: string;
    /** Full Content */
    content: string;
    /** Action Button (Optional) */
    action?: AnnouncementAction | null;
    /** Target Version Range (e.g. ">=1.6.0", "*" for all) */
    targetVersions: string;
    /** Target Language List (e.g. ["zh-cn", "zh-tw"], ["*"] or empty for all) */
    targetLanguages?: string[];
    /** Show Only Once (do not pop up again after marked read) */
    showOnce: boolean;
    /** Pop up proactively */
    popup: boolean;
    /** Created At */
    createdAt: string;
    /** Expires At (Optional) */
    expiresAt?: string | null;
    /** Multilingual Support (Optional) */
    locales?: { [key: string]: AnnouncementLocale };
    /** Image List (Optional) */
    images?: AnnouncementImage[];
}

/** Announcement API Response */
export interface AnnouncementResponse {
    /** Data Version */
    version: string;
    /** Announcement List */
    announcements: Announcement[];
}

/** Announcement State (Passed to Webview) */
export interface AnnouncementState {
    /** All Announcements */
    announcements: Announcement[];
    /** Unread Announcement IDs */
    unreadIds: string[];
    /** Unread announcement requiring popup (highest priority) */
    popupAnnouncement: Announcement | null;
}
