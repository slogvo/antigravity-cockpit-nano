/**
 * Antigravity Cockpit - Credential Storage
 * OAuth 凭证的安全存储服务
 * 使用 VS Code 的 SecretStorage API 安全存储敏感信息
 */

import * as vscode from 'vscode';
import { OAuthCredential, AuthorizationStatus } from './types';
import { logger } from '../shared/log_service';

const CREDENTIAL_KEY = 'antigravity.autoTrigger.credential';
const STATE_KEY = 'antigravity.autoTrigger.state';

/**
 * 凭证存储服务
 * 单例模式，通过 initialize() 初始化
 */
class CredentialStorage {
    private secretStorage?: vscode.SecretStorage;
    private globalState?: vscode.Memento;
    private initialized = false;

    /**
     * 初始化存储服务
     * @param context VS Code 扩展上下文
     */
    initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
        this.globalState = context.globalState;
        this.initialized = true;
        logger.info('[CredentialStorage] Initialized');
    }

    /**
     * 检查是否已初始化
     */
    private ensureInitialized(): void {
        if (!this.initialized || !this.secretStorage || !this.globalState) {
            throw new Error('CredentialStorage not initialized. Call initialize() first.');
        }
    }

    /**
     * 保存 OAuth 凭证
     */
    async saveCredential(credential: OAuthCredential): Promise<void> {
        this.ensureInitialized();
        try {
            const json = JSON.stringify(credential);
            await this.secretStorage!.store(CREDENTIAL_KEY, json);
            logger.info('[CredentialStorage] Credential saved successfully');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to save credential: ${err.message}`);
            throw err;
        }
    }

    /**
     * 获取 OAuth 凭证
     */
    async getCredential(): Promise<OAuthCredential | null> {
        this.ensureInitialized();
        try {
            const json = await this.secretStorage!.get(CREDENTIAL_KEY);
            if (!json) {
                return null;
            }
            return JSON.parse(json) as OAuthCredential;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to get credential: ${err.message}`);
            return null;
        }
    }

    /**
     * 删除 OAuth 凭证
     */
    async deleteCredential(): Promise<void> {
        this.ensureInitialized();
        try {
            await this.secretStorage!.delete(CREDENTIAL_KEY);
            logger.info('[CredentialStorage] Credential deleted');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[CredentialStorage] Failed to delete credential: ${err.message}`);
            throw err;
        }
    }

    /**
     * 检查是否有有效凭证
     */
    async hasValidCredential(): Promise<boolean> {
        const credential = await this.getCredential();
        if (!credential) {
            return false;
        }

        // 检查是否有 refresh_token（有 refresh_token 就可以刷新 access_token）
        if (!credential.refreshToken) {
            return false;
        }

        return true;
    }

    /**
     * 获取授权状态
     */
    async getAuthorizationStatus(): Promise<AuthorizationStatus> {
        const credential = await this.getCredential();
        
        if (!credential || !credential.refreshToken) {
            return {
                isAuthorized: false,
            };
        }

        return {
            isAuthorized: true,
            email: credential.email,
            expiresAt: credential.expiresAt,
        };
    }

    /**
     * 更新 access_token（刷新后调用）
     */
    async updateAccessToken(accessToken: string, expiresAt: string): Promise<void> {
        const credential = await this.getCredential();
        if (!credential) {
            throw new Error('No credential to update');
        }

        credential.accessToken = accessToken;
        credential.expiresAt = expiresAt;
        await this.saveCredential(credential);
        logger.info('[CredentialStorage] Access token updated');
    }

    /**
     * 保存通用状态数据（非敏感）
     */
    async saveState<T>(key: string, value: T): Promise<void> {
        this.ensureInitialized();
        await this.globalState!.update(`${STATE_KEY}.${key}`, value);
    }

    /**
     * 获取通用状态数据
     */
    getState<T>(key: string, defaultValue: T): T {
        this.ensureInitialized();
        return this.globalState!.get(`${STATE_KEY}.${key}`, defaultValue);
    }
}

// 导出单例
export const credentialStorage = new CredentialStorage();
