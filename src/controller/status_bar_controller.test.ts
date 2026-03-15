import { StatusBarController } from './status_bar_controller';
import * as vscode from 'vscode';
import { STATUS_BAR_FORMAT } from '../shared/constants';

describe('StatusBarController', () => {
    let context: vscode.ExtensionContext;
    let controller: StatusBarController;
    let mockStatusBarItem: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockStatusBarItem = {
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn(),
            text: '',
            tooltip: '',
            command: '',
            backgroundColor: undefined,
        };
        (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBarItem);
        
        context = {
            subscriptions: [],
            extension: {
                packageJSON: {
                    version: '1.2.3',
                },
            },
        } as any;
        
        controller = new StatusBarController(context);
    });

    it('should show pinned model if monitor exists', () => {
        const snapshot = {
            models: [
                { modelId: 'model-1', label: 'Model 1', remainingPercentage: 10 },
                { modelId: 'model-2', label: 'Model 2', remainingPercentage: 100 },
            ],
            userInfo: { email: 'test@example.com', name: 'Test' },
            timestamp: Date.now(),
            isConnected: true,
        } as any;
        
        const config = {
            statusBarFormat: STATUS_BAR_FORMAT.STANDARD,
            pinnedModels: ['model-2'], // Pins the healthier model
            modelOrder: [],
            modelCustomNames: {},
        } as any;

        controller.update(snapshot, config);

        // Should show Model 2 because it is pinned, even if Model 1 has lower quota
        expect(mockStatusBarItem.text).toContain('Model 2');
        expect(mockStatusBarItem.text).toContain('100%');
    });

    it('should show lowest quota model if nothing is pinned', () => {
        const snapshot = {
            models: [
                { modelId: 'model-x', label: 'Model X', remainingPercentage: 5 },
                { modelId: 'model-y', label: 'Model Y', remainingPercentage: 80 },
            ],
            userInfo: { email: 'test@example.com', name: 'Test' },
            timestamp: Date.now(),
            isConnected: true,
        } as any;
        
        const config = {
            statusBarFormat: STATUS_BAR_FORMAT.STANDARD,
            pinnedModels: [],
            modelOrder: [],
            modelCustomNames: {},
        } as any;

        controller.update(snapshot, config);

        // Should show Model X because it has the lowest quota
        expect(mockStatusBarItem.text).toContain('Model X');
        expect(mockStatusBarItem.text).toContain('5%');
    });

    it('should respect custom names in status bar', () => {
        const snapshot = {
            models: [
                { modelId: 'model-1', label: 'Original Name', remainingPercentage: 50 },
            ],
            userInfo: { email: 'test@example.com', name: 'Test' },
            timestamp: Date.now(),
            isConnected: true,
        } as any;
        
        const config = {
            statusBarFormat: STATUS_BAR_FORMAT.STANDARD,
            pinnedModels: ['model-1'],
            modelOrder: [],
            modelCustomNames: { 'model-1': 'Friendly Name' },
        } as any;

        controller.update(snapshot, config);

        expect(mockStatusBarItem.text).toContain('Friendly Name');
        expect(mockStatusBarItem.text).not.toContain('Original Name');
    });
});
