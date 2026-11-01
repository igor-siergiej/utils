import type { ConstructorOfType } from './types';

type Tokens<Deps> = keyof Deps & string;

export class DependencyContainer<Deps extends Record<string, unknown>> {
    private static instance: DependencyContainer<Record<never, never>> | undefined;

    private constructors: { [K in Tokens<Deps>]?: ConstructorOfType<Deps[K]> } = {};
    private instances: { [K in Tokens<Deps>]?: Deps[K] } = {};

    public static getInstance<Deps2 extends Record<string, unknown>>(): DependencyContainer<Deps2> {
        DependencyContainer.instance ??= new DependencyContainer<Record<never, never>>();

        // SAFETY: the container is a process-wide singleton shared by every caller; Deps2 is the token map the caller declares for its own tokens, and nothing is stored until tokens are registered.
        return DependencyContainer.instance as DependencyContainer<Deps2>;
    }

    public registerSingleton<K extends Tokens<Deps>>(token: K, ctor: ConstructorOfType<Deps[K]>): void {
        if (this.isTokenRegistered(token)) {
            throw new Error('Dependency is already registered');
        }

        this.constructors[token] = ctor;
    }

    public resolve<K extends Tokens<Deps>>(token: K, ...args: Array<unknown>): Deps[K] {
        const existing = this.instances[token];

        if (existing !== undefined) {
            return existing;
        }

        const ctor = this.constructors[token];

        if (!ctor) {
            throw new Error(`Dependency '${String(token)}' not registered`);
        }

        // SAFETY: registerSingleton accepted a constructor for this token; the caller of resolve supplies the arguments that constructor expects.
        const instance = new (ctor as new (...a: Array<unknown>) => Deps[K])(...args);

        this.instances[token] = instance;

        return instance;
    }

    private isTokenRegistered(token: Tokens<Deps>): boolean {
        return token in this.instances || token in this.constructors;
    }
}
