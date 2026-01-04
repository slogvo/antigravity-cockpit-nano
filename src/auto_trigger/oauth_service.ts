/**
 * Antigravity Cockpit - OAuth Service
 * Google OAuth Authentication Service
 * Handles OAuth authorization flow, token exchange, and refreshing
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { URL } from 'url';
import { OAuthCredential } from './types';
import { credentialStorage } from './credential_storage';
import { logger } from '../shared/log_service';

// Antigravity OAuth Configuration
const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const ANTIGRAVITY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Callback Server Configuration
const CALLBACK_HOST = 'localhost';
const CALLBACK_PORT_START = 11451;
const CALLBACK_PORT_RANGE = 100;

/**
 * OAuth Service Class
 */
class OAuthService {
    private callbackServer?: http.Server;
    private pendingAuth?: {
        state: string;
        resolve: (code: string) => void;
        reject: (error: Error) => void;
    };

    /**
     * Start OAuth Authorization Flow
     * @returns true if authorization successful, false otherwise
     */
    async startAuthorization(): Promise<boolean> {
        logger.info('[OAuthService] Starting authorization flow');

        try {
            // 1. Find available port and start callback server
            const port = await this.startCallbackServer();
            const redirectUri = `http://${CALLBACK_HOST}:${port}`;
            
            // 2. Generate state code (CSRF protection)
            const state = this.generateState();
            
            // 3. Build authorization URL
            const authUrl = this.buildAuthUrl(redirectUri, state);
            
            // 4. Open browser
            const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
            if (!opened) {
                logger.warn('[OAuthService] Failed to open browser, falling back to clipboard');
                try {
                    await vscode.env.clipboard.writeText(authUrl);
                } catch (copyError) {
                    logger.warn('[OAuthService] Failed to copy auth URL to clipboard', copyError);
                }
                vscode.window.showWarningMessage('Unable to open browser automatically. Authorization link copied to clipboard. Please open it manually to complete authorization.');
            }

            // 5. Show waiting prompt
            vscode.window.showInformationMessage(
                '🔗 Waiting for Google authorization...\nPlease complete login and authorization in your browser.',
                'Cancel'
            ).then(selection => {
                if (selection === 'Cancel') {
                    this.cancelPendingAuth();
                }
            });

            // 6. Wait for callback (max 5 minutes)
            const code = await this.waitForCallback(state, 5 * 60 * 1000);
            
            // 7. Exchange code for token
            const credential = await this.exchangeCodeForToken(code, redirectUri);
            
            // 8. Get user info
            const email = await this.fetchUserEmail(credential.accessToken);
            credential.email = email;
            
            // 9. Save credential
            await credentialStorage.saveCredential(credential);
            
            // 10. Show success message
            vscode.window.showInformationMessage(`✅ Authorization successful! Linked account: ${email}`);
            
            logger.info(`[OAuthService] Authorization successful: ${email}`);
            return true;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Authorization failed: ${err.message}`);
            vscode.window.showErrorMessage(`❌ Authorization failed: ${err.message}`);
            return false;

        } finally {
            this.stopCallbackServer();
        }
    }

    /**
     * Revoke Authorization
     */
    async revokeAuthorization(): Promise<void> {
        await credentialStorage.deleteCredential();
        logger.info('[OAuthService] Authorization revoked');
        vscode.window.showInformationMessage('✅ Authorization revoked');
    }

    /**
     * Refresh access_token
     * @returns New access_token, or null if failed
     */
    async refreshAccessToken(): Promise<string | null> {
        const credential = await credentialStorage.getCredential();
        if (!credential || !credential.refreshToken) {
            logger.warn('[OAuthService] No refresh token available');
            return null;
        }

        try {
            const response = await fetch(TOKEN_URL, {
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
                throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json() as {
                access_token: string;
                expires_in: number;
            };

            const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
            await credentialStorage.updateAccessToken(data.access_token, expiresAt);

            logger.info('[OAuthService] Access token refreshed');
            return data.access_token;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`[OAuthService] Token refresh failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Get valid access_token (refresh automatically if necessary)
     */
    async getValidAccessToken(): Promise<string | null> {
        const credential = await credentialStorage.getCredential();
        if (!credential) {
            return null;
        }

        // Check if expired (refresh 5 minutes early)
        const expiresAt = new Date(credential.expiresAt);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000; // 5 minutes

        if (expiresAt.getTime() - now.getTime() < bufferTime) {
            logger.info('[OAuthService] Token expiring soon, refreshing...');
            return await this.refreshAccessToken();
        }

        return credential.accessToken;
    }

    /**
     * Start Callback Server
     */
    private async startCallbackServer(): Promise<number> {
        return new Promise((resolve, reject) => {
            let port = CALLBACK_PORT_START;
            let attempts = 0;

            const tryPort = () => {
                if (attempts >= CALLBACK_PORT_RANGE) {
                    reject(new Error('No available port for OAuth callback'));
                    return;
                }

                const server = http.createServer((req, res) => {
                    this.handleCallback(req, res);
                });

                server.on('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE') {
                        port++;
                        attempts++;
                        tryPort();
                    } else {
                        reject(err);
                    }
                });

                server.listen(port, CALLBACK_HOST, () => {
                    this.callbackServer = server;
                    logger.info(`[OAuthService] Callback server started on port ${port}`);
                    resolve(port);
                });
            };

            tryPort();
        });
    }

    /**
     * Stop Callback Server
     */
    private stopCallbackServer(): void {
        if (this.callbackServer) {
            this.callbackServer.close();
            this.callbackServer = undefined;
            logger.info('[OAuthService] Callback server stopped');
        }
    }

    /**
     * Handle OAuth Callback
     */
    private handleCallback(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url || '', `http://${CALLBACK_HOST}`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <head><title>Authorization Failed</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>❌ Authorization Failed</h1>
                    <p>Error: ${error}</p>
                    <p>Please close this page and try again.</p>
                </body>
                </html>
            `);
            if (this.pendingAuth) {
                this.pendingAuth.reject(new Error(`OAuth error: ${error}`));
                this.pendingAuth = undefined;
            }
            return;
        }

        if (code && state && this.pendingAuth && this.pendingAuth.state === state) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <head><title>Authorization Successful</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>✅ Authorization Successful!</h1>
                    <p>You can close this page and return to VS Code.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                </body>
                </html>
            `);
            this.pendingAuth.resolve(code);
            this.pendingAuth = undefined;
        } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <html>
                <head><title>Invalid Request</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1>⚠️ Invalid Request</h1>
                    <p>Please restart the authorization process.</p>
                </body>
                </html>
            `);
        }
    }

    /**
     * Wait for Callback
     */
    private waitForCallback(state: string, timeout: number): Promise<string> {
        return new Promise((resolve, reject) => {
            this.pendingAuth = { state, resolve, reject };

            setTimeout(() => {
                if (this.pendingAuth && this.pendingAuth.state === state) {
                    this.pendingAuth.reject(new Error('Authorization timeout'));
                    this.pendingAuth = undefined;
                }
            }, timeout);
        });
    }

    /**
     * Cancel Pending Authorization
     */
    private cancelPendingAuth(): void {
        if (this.pendingAuth) {
            this.pendingAuth.reject(new Error('Authorization cancelled by user'));
            this.pendingAuth = undefined;
        }
        this.stopCallbackServer();
    }

    /**
     * Generate State Code
     */
    private generateState(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let state = '';
        for (let i = 0; i < 32; i++) {
            state += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return state;
    }

    /**
     * Build Authorization URL
     */
    private buildAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: ANTIGRAVITY_SCOPES.join(' '),
            state: state,
            access_type: 'offline',
            prompt: 'consent',  // Force authorization prompt to ensure refresh_token is received
            include_granted_scopes: 'true',
        });
        return `${AUTH_URL}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for token
     */
    private async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuthCredential> {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            scope: string;
            token_type: string;
        };

        if (!data.refresh_token) {
            throw new Error('No refresh_token received. Please try again.');
        }

        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

        return {
            clientId: ANTIGRAVITY_CLIENT_ID,
            clientSecret: ANTIGRAVITY_CLIENT_SECRET,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: expiresAt,
            scopes: data.scope.split(' '),
        };
    }

    /**
     * Get User Email
     */
    private async fetchUserEmail(accessToken: string): Promise<string> {
        const response = await fetch(USERINFO_URL, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch user info: ${response.status}`);
        }

        const data = await response.json() as { email: string };
        return data.email;
    }
}

// Export Singleton
export const oauthService = new OAuthService();
