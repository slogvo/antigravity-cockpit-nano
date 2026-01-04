/**
 * Antigravity Cockpit - Internationalization Support
 * i18n implementation supporting 2 languages
 */

import * as vscode from 'vscode';
import { en, vi } from './translations';

/** Supported Languages */
export type SupportedLocale = 
    | 'en' 
    | 'vi';

/** Translation Map */
interface TranslationMap {
    [key: string]: string;
}

/** Translation Resources */
const translations: Record<SupportedLocale, TranslationMap> = {
    'en': en,
    'vi': vi,
};

/** Locale Mapping */
const localeMapping: Record<string, SupportedLocale> = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'vi': 'vi',
    'vi-vn': 'vi',
};

/** i18n Service Class */
class I18nService {
    private currentLocale: SupportedLocale = 'en';

    constructor() {
        this.detectLocale();
    }

    /**
     * Detect current locale
     */
    private detectLocale(): void {
        const vscodeLocale = vscode.env.language.toLowerCase();
        
        // Try exact match first
        if (localeMapping[vscodeLocale]) {
            this.currentLocale = localeMapping[vscodeLocale];
            return;
        }
        
        // Try to verify language prefix
        const langPrefix = vscodeLocale.split('-')[0];
        if (localeMapping[langPrefix]) {
            this.currentLocale = localeMapping[langPrefix];
            return;
        }
        
        // Default to English
        this.currentLocale = 'en';
    }

    /**
     * Get translated text
     * @param key Translation key
     * @param params Replacement parameters
     */
    t(key: string, params?: Record<string, string | number>): string {
        const translation = translations[this.currentLocale]?.[key] 
            || translations['en'][key] 
            || key;

        if (!params) {
            return translation;
        }

        // Replace params {param} -> value
        return Object.entries(params).reduce(
            (text, [paramKey, paramValue]) => 
                text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue)),
            translation,
        );
    }

    /**
     * Get current locale
     */
    getLocale(): SupportedLocale {
        return this.currentLocale;
    }

    /**
     * Set locale
     */
    setLocale(locale: SupportedLocale): void {
        this.currentLocale = locale;
    }

    /**
     * Get all translations (for Webview)
     */
    getAllTranslations(): TranslationMap {
        return { ...translations['en'], ...translations[this.currentLocale] };
    }

    /**
     * Get list of all supported locales
     */
    getSupportedLocales(): SupportedLocale[] {
        return Object.keys(translations) as SupportedLocale[];
    }
}

// Export Singleton
export const i18n = new I18nService();

// Helper Function
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
