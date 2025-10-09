import { beforeEach, describe, expect, it } from 'vitest';

import { DependencyContainer } from '.';

class Foo {
    constructor(public readonly n: number) {}
}

interface Deps extends Record<string, unknown> {
    foo: Foo;
}

describe('DependencyContainer', () => {
    beforeEach(() => {
        // reset the singleton by reaching into private via any
        (DependencyContainer as any).instance = undefined;
    });

    it('registers and resolves singletons', () => {
        const di = DependencyContainer.getInstance<Deps>();

        di.registerSingleton('foo', Foo as any);

        const foo1 = di.resolve('foo', 1);
        const foo2 = di.resolve('foo', 2);

        expect(foo1).toBeInstanceOf(Foo);
        expect(foo1.n).toBe(1);
        expect(foo2).toBe(foo1);
    });

    it('throws when resolving unregistered token', () => {
        const di = DependencyContainer.getInstance<Deps>();

        expect(() => di.resolve('foo')).toThrow(/not registered/);
    });

    it('prevents double registration', () => {
        const di = DependencyContainer.getInstance<Deps>();

        di.registerSingleton('foo', Foo as any);
        expect(() => di.registerSingleton('foo', Foo as any)).toThrow(/already registered/);
    });
});
