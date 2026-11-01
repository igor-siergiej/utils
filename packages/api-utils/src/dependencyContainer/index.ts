import type { ConstructorOfType } from './types';

export class DependencyContainer<Deps extends Record<string, unknown>> {
    private static instance: DependencyContainer<Record<string, never>> | undefined;

    private constructors = new Map<string, ConstructorOfType<unknown>>();
    private instances = new Map<string, unknown>();

    public static getInstance<Deps2 extends Record<string, unknown>>(): DependencyContainer<Deps2> {
        DependencyContainer.instance ??= new DependencyContainer<Record<string, never>>();

        // SAFETY: the container is a process-wide singleton shared by every caller; Deps2 is the token map the caller declares for its own tokens, and the map holds nothing until tokens are registered.
        return DependencyContainer.instance as DependencyContainer<Deps2>;
    }

    public registerSingleton<K extends keyof Deps & string>(token: K, ctor: ConstructorOfType<Deps[K]>): void {
        if (this.isTokenRegistered(token)) {
            throw new Error('Dependency is already registered');
        }

        this.constructors.set(token, ctor);
    }

    public resolve<K extends keyof Deps & string>(token: K, ...args: Array<unknown>): Deps[K] {
        const existing = this.instances.get(token);

        if (existing !== undefined) {
            // SAFETY: instances are only ever stored under the token whose constructor produced them, so the value for K is a Deps[K].
            return existing as Deps[K];
        }

        const ctor = this.constructors.get(token);

        if (!ctor) {
            throw new Error(`Dependency '${String(token)}' not registered`);
        }

        // SAFETY: registerSingleton accepted a constructor for this token; the caller of resolve supplies the arguments that constructor expects.
        const instance = new (ctor as new (...a: Array<unknown>) => Deps[K])(...args);

        this.instances.set(token, instance);

        return instance;
    }

    private isTokenRegistered(token: keyof Deps & string): boolean {
        return this.instances.has(token) || this.constructors.has(token);
    }
}
