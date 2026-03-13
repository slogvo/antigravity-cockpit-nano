/**
 * Antigravity Nano - OAuth Service
 * Simplified version for token refresh only
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { URL } from 'url';
import { OAuthCredential } from './types';
import { credentialStorage } from './credential_storage';
import { logger } from '../shared/log_service';

// Antigravity OAuth configuration
const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const ANTIGRAVITY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Callback server configuration
const CALLBACK_HOST_IPV4 = '127.0.0.1';
const CALLBACK_HOST_IPV6 = '::1';
const CALLBACK_PORT_START = 11451;
const CALLBACK_PORT_RANGE = 100;
const OAUTH_HTTP_TIMEOUT_MS = 15000;

export type AccessTokenState =
    | 'ok'
    | 'missing'
    | 'expired'
    | 'invalid_grant'
    | 'refresh_failed';

export interface AccessTokenResult {
    state: AccessTokenState;
    token?: string;
    error?: string;
}

class OAuthService {
    private callbackServer?: http.Server;
    private callbackBaseUrl: string = `http://${CALLBACK_HOST_IPV4}`;
    private pendingAuth?: {
        state: string;
        resolve: (code: string) => void;
        reject: (error: Error) => void;
    };

    /**
     * Start OAuth authorization flow
     */
    async startAuthorization(): Promise<boolean> {
        logger.info('[OAuthService] Starting authorization flow');

        try {
            const port = await this.startCallbackServer();
            const redirectUri = `${this.callbackBaseUrl}:${port}`;
            const state = this.generateState();
            const authUrl = this.buildAuthUrl(redirectUri, state);

            // Open browser
            const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
            if (!opened) {
                logger.warn('[OAuthService] Failed to open browser');
                vscode.window.showErrorMessage('Failed to open browser. Please try again or copy the link manually.');
                return false;
            }

            // Wait for callback (5 min timeout)
            const code = await this.waitForCallback(state, 5 * 60 * 1000);
            
            // Exchange code for token
            const credential = await this.exchangeCodeForToken(code, redirectUri);

            // Fetch user email
            const email = await this.fetchUserEmail(credential.accessToken);
            credential.email = email;

            // Save credential
            await credentialStorage.saveCredential(credential);
            
            vscode.window.showInformationMessage(`Authorization successful: ${email}`);
            logger.info(`[OAuthService] Authorization successful: ${email}`);
            return true;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Authorization failed: ${err.message}`);
            vscode.window.showErrorMessage(`Authorization failed: ${err.message}`);
            return false;
        } finally {
            this.stopCallbackServer();
        }
    }

    /**
     * Get valid access token (auto-refresh if needed)
     */
    async getAccessTokenStatus(): Promise<AccessTokenResult> {
        const credential = await credentialStorage.getCredential();
        if (!credential) {
            return { state: 'missing' };
        }

        // Check if token is expiring soon (5 min buffer)
        const expiresAt = new Date(credential.expiresAt);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000;
        const isExpired = expiresAt.getTime() <= now.getTime();

        if (expiresAt.getTime() - now.getTime() < bufferTime) {
            logger.info('[OAuthService] Token expiring soon, refreshing...');
            const refreshed = await this.refreshAccessToken(credential);
            if (refreshed.state === 'missing' && isExpired) {
                return { state: 'expired', error: 'Access token expired' };
            }
            return refreshed;
        }

        return { state: 'ok', token: credential.accessToken };
    }

    /**
     * Refresh access token
     */
    private async refreshAccessToken(credential: OAuthCredential): Promise<AccessTokenResult> {
        if (!credential.refreshToken) {
            return { state: 'missing' };
        }

        try {
            const response = await this.fetchWithTimeout(TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: ANTIGRAVITY_CLIENT_ID,
                    client_secret: ANTIGRAVITY_CLIENT_SECRET,
                    refresh_token: credential.refreshToken,
                    grant_type: 'refresh_token',
                }).toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                if (errorText.toLowerCase().includes('invalid_grant')) {
                    logger.warn('[OAuthService] Refresh token invalid (invalid_grant)');
                    return { state: 'invalid_grant', error: errorText };
                }
                return { state: 'refresh_failed', error: `${response.status}: ${errorText}` };
            }

            const data = await response.json() as {
                access_token: string;
                expires_in: number;
            };

            const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
            await credentialStorage.updateAccessToken(data.access_token, expiresAt);

            logger.info('[OAuthService] Access token refreshed');
            return { state: 'ok', token: data.access_token };

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Token refresh failed: ${err.message}`);
            return { state: 'refresh_failed', error: err.message };
        }
    }

    private async startCallbackServer(): Promise<number> {
        return new Promise((resolve, reject) => {
            let port = CALLBACK_PORT_START;
            let attempts = 0;

            const tryListen = (host: string, onError: (err: NodeJS.ErrnoException) => void) => {
                const server = http.createServer((req, res) => this.handleCallback(req, res));
                server.on('error', (err: NodeJS.ErrnoException) => {
                    server.close();
                    onError(err);
                });
                server.listen(port, host, () => {
                    this.callbackServer = server;
                    this.callbackBaseUrl = host.includes(':') ? `http://[${host}]` : `http://${host}`;
                    logger.info(`[OAuthService] Callback server started on ${host}:${port}`);
                    resolve(port);
                });
            };

            const tryPort = () => {
                if (attempts >= CALLBACK_PORT_RANGE) {
                    reject(new Error('No available port for OAuth callback'));
                    return;
                }
                tryListen(CALLBACK_HOST_IPV4, (err) => {
                    if (err.code === 'EADDRINUSE') {
                        port++;
                        attempts++;
                        tryPort();
                    } else {
                        reject(err);
                    }
                });
            };
            tryPort();
        });
    }

    private stopCallbackServer(): void {
        if (this.callbackServer) {
            this.callbackServer.close();
            this.callbackServer = undefined;
            logger.info('[OAuthService] Callback server stopped');
        }
    }

    private handleCallback(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url || '', this.callbackBaseUrl);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Authorization Failed</h1><p>Please close this page and try again.</p>');
            this.pendingAuth?.reject(new Error(`OAuth error: ${error}`));
            return;
        }

        if (code && state && this.pendingAuth?.state === state) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Authorization Successful!</h1><p>You can close this page now.</p>');
            this.pendingAuth.resolve(code);
            this.pendingAuth = undefined;
        } else {
            res.writeHead(400);
            res.end('Invalid request');
        }
    }

    private waitForCallback(state: string, timeout: number): Promise<string> {
        return new Promise((resolve, reject) => {
            this.pendingAuth = { state, resolve, reject };
            setTimeout(() => {
                if (this.pendingAuth?.state === state) {
                    this.pendingAuth.reject(new Error('Authorization timeout'));
                    this.pendingAuth = undefined;
                }
            }, timeout);
        });
    }

    private generateState(): string {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    private buildAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: ANTIGRAVITY_SCOPES.join(' '),
            state: state,
            access_type: 'offline',
            prompt: 'consent',
        });
        return `${AUTH_URL}?${params.toString()}`;
    }

    private async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuthCredential> {
        const response = await this.fetchWithTimeout(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Token exchange failed: ${text}`);
        }

        const data = await response.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            scope: string;
        };

        return {
            clientId: ANTIGRAVITY_CLIENT_ID,
            clientSecret: ANTIGRAVITY_CLIENT_SECRET,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
            scopes: data.scope.split(' '),
        };
    }

    private async fetchUserEmail(accessToken: string): Promise<string> {
        const response = await this.fetchWithTimeout(USERINFO_URL, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (!response.ok) {
            throw new Error('Failed to fetch user email');
        }
        const data = await response.json() as { email: string };
        return data.email;
    }

    private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), OAUTH_HTTP_TIMEOUT_MS);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            return response;
        } finally {
            clearTimeout(id);
        }
    }
}

export const oauthService = new OAuthService();
