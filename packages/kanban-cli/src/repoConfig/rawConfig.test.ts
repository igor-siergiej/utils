import { describe, expect, it } from 'vitest';

import { readFallbackMinutes, readRepoName } from './rawConfig';

describe('readRepoName', () => {
    it('reads repoName from a config the full validator would reject', () => {
        expect(readRepoName('{"repoName":"shoppingo"}')).toBe('shoppingo');
    });

    it('answers undefined when repoName is absent or the JSON is not an object', () => {
        expect(readRepoName('{}')).toBeUndefined();
        expect(readRepoName('[1]')).toBeUndefined();
        expect(readRepoName('null')).toBeUndefined();
    });

    it('throws on malformed JSON', () => {
        expect(() => readRepoName('{ nope')).toThrow(SyntaxError);
    });
});

describe('readFallbackMinutes', () => {
    it('reads factory.rateLimitFallbackMinutes', () => {
        expect(readFallbackMinutes('{"factory":{"rateLimitFallbackMinutes":45}}')).toBe(45);
    });

    it.each([
        '{}',
        '{"factory":{}}',
        '{"factory":{"rateLimitFallbackMinutes":0}}',
        '{"factory":{"rateLimitFallbackMinutes":-5}}',
        '{"factory":{"rateLimitFallbackMinutes":"45"}}',
        '{"factory":"nope"}',
    ])('ignores an unusable value in %s', (text) => {
        expect(readFallbackMinutes(text)).toBeUndefined();
    });
});
