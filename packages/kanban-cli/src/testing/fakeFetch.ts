/** A `fetch` double: `handler` answers every request; the URL arrives as a string. */
export function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
    return Object.assign((input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {}), {
        preconnect: () => {},
    });
}
