/**
 * 自定义错误基类
 */
export class AntigravityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AntigravityError';
        // 恢复原型链，确保 instanceof 工作正常 (特别是在编译为 ES5 时)
        Object.setPrototypeOf(this, AntigravityError.prototype);
    }
}

/**
 * 判断是否是服务端返回的错误（不属于插件 Bug，不需要上报）
 */
export function isServerError(err: Error): boolean {
    return err instanceof AntigravityError;
}
