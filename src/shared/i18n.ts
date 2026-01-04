/**
 * Antigravity Cockpit - 国际化支持
 * i18n implementation supporting 14 languages
 */

import * as vscode from 'vscode';
import { en, zhCN, ja, es, de, fr, ptBR, ru, ko, it, zhTW, tr, pl, cs } from './translations';

/** 支持的语言 */
export type SupportedLocale = 
    | 'en' 
    | 'zh-cn' 
    | 'ja' 
    | 'es' 
    | 'de' 
    | 'fr' 
    | 'pt-br' 
    | 'ru' 
    | 'ko' 
    | 'it' 
    | 'zh-tw' 
    | 'tr' 
    | 'pl' 
    | 'cs';

/** 翻译键值对 */
interface TranslationMap {
    [key: string]: string;
}

/** 翻译资源 */
const translations: Record<SupportedLocale, TranslationMap> = {
    'en': en,
    'zh-cn': zhCN,
    'ja': ja,
    'es': es,
    'de': de,
    'fr': fr,
    'pt-br': ptBR,
    'ru': ru,
    'ko': ko,
    'it': it,
    'zh-tw': zhTW,
    'tr': tr,
    'pl': pl,
    'cs': cs,
};

/** 语言代码映射 - 将 VSCode 语言代码映射到我们支持的语言 */
const localeMapping: Record<string, SupportedLocale> = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'zh-cn': 'zh-cn',
    'zh-hans': 'zh-cn',
    'zh-tw': 'zh-tw',
    'zh-hant': 'zh-tw',
    'ja': 'ja',
    'es': 'es',
    'de': 'de',
    'fr': 'fr',
    'pt-br': 'pt-br',
    'pt': 'pt-br',
    'ru': 'ru',
    'ko': 'ko',
    'it': 'it',
    'tr': 'tr',
    'pl': 'pl',
    'cs': 'cs',
};

/** i18n 服务类 */
class I18nService {
    private currentLocale: SupportedLocale = 'en';

    constructor() {
        this.detectLocale();
    }

    /**
     * 检测当前语言环境
     */
    private detectLocale(): void {
        const vscodeLocale = vscode.env.language.toLowerCase();
        
        // 首先尝试精确匹配
        if (localeMapping[vscodeLocale]) {
            this.currentLocale = localeMapping[vscodeLocale];
            return;
        }
        
        // 尝试匹配语言前缀
        const langPrefix = vscodeLocale.split('-')[0];
        if (localeMapping[langPrefix]) {
            this.currentLocale = localeMapping[langPrefix];
            return;
        }
        
        // 默认使用英文
        this.currentLocale = 'en';
    }

    /**
     * 获取翻译文本
     * @param key 翻译键
     * @param params 替换参数
     */
    t(key: string, params?: Record<string, string | number>): string {
        const translation = translations[this.currentLocale]?.[key] 
            || translations['en'][key] 
            || key;

        if (!params) {
            return translation;
        }

        // 替换参数 {param} -> value
        return Object.entries(params).reduce(
            (text, [paramKey, paramValue]) => 
                text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue)),
            translation,
        );
    }

    /**
     * 获取当前语言
     */
    getLocale(): SupportedLocale {
        return this.currentLocale;
    }

    /**
     * 设置语言
     */
    setLocale(locale: SupportedLocale): void {
        this.currentLocale = locale;
    }

    /**
     * 获取所有翻译（用于 Webview）
     */
    getAllTranslations(): TranslationMap {
        return { ...translations['en'], ...translations[this.currentLocale] };
    }

    /**
     * 获取所有支持的语言列表
     */
    getSupportedLocales(): SupportedLocale[] {
        return Object.keys(translations) as SupportedLocale[];
    }
}

// 导出单例
export const i18n = new I18nService();

// 便捷函数
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
