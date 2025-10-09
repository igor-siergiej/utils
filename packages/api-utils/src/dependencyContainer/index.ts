import type { ConstructorOfType } from './types';

export class DependencyContainer<Deps extends Record<string, unknown> = Record<string, unknown>> {
    private static instance: DependencyContainer<Record<string, unknown>>;

    private constructors: Partial<Record<keyof Deps & string, ConstructorOfType<unknown>>> = {};
    private instances: Partial<Record<keyof Deps & string, unknown>> = {};

    public static getInstance<Deps2 extends Record<string, unknown>>(): DependencyContainer<Deps2> {
        if (!DependencyContainer.instance) {
            DependencyContainer.instance = new DependencyContainer<Record<string, unknown>>();
        }

        return DependencyContainer.instance as unknown as DependencyContainer<Deps2>;
    }

    public registerSingleton<K extends keyof Deps & string>(token: K, ctor: ConstructorOfType<Deps[K]>): void {
        if (this.isTokenRegistered(token)) {
            throw new Error('Dependency is already registered');
        }

        this.constructors[token] = ctor as unknown as ConstructorOfType<unknown>;
    }

    public resolve<K extends keyof Deps & string>(token: K, ...args: Array<unknown>): Deps[K] {
        const existing = this.instances[token];

        if (existing !== undefined) {
            return existing as Deps[K];
        }

        const ctor = this.constructors[token] as (new (...a: Array<unknown>) => Deps[K]) | undefined;

        if (!ctor) {
            throw new Error(`Dependency '${String(token)}' not registered`);
        }

        const instance = new ctor(...args);

        this.instances[token] = instance as unknown;

        return instance as Deps[K];
    }

    private isTokenRegistered(token: keyof Deps & string): boolean {
        return token in this.instances || token in this.constructors;
    }
}
