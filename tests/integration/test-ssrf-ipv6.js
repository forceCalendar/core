/**
 * Test that the ICS URL guard rejects IPv6 literals that denote private or
 * reserved addresses, whatever notation they use, and that the DNS and
 * redirect checks apply to every non-literal host.
 *
 * Before this test existed, IPv4-mapped literals such as
 * [::ffff:127.0.0.1] (which the URL parser rewrites to [::ffff:7f00:1]) and
 * NAT64 literals such as [64:ff9b::7f00:1] passed validateURL, and because
 * the hostname contained ':' the DNS re-check was skipped as well, so a
 * feed URL could reach loopback, link-local and metadata addresses.
 */

import { ICSHandler } from '../../core/ics/ICSHandler.js';

console.log('Testing ICS URL guard against IPv6 literal forms...\n');

let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
    } else {
        console.log(`  ❌ ${message}`);
        failures++;
    }
}

function assertThrows(fn, message, pattern = /not allowed|private/) {
    try {
        fn();
        assert(false, `${message} (no error thrown)`);
    } catch (error) {
        assert(pattern.test(error.message), `${message}: ${error.message}`);
    }
}

async function assertRejects(promiseFactory, message, pattern = /not allowed|private/) {
    try {
        await promiseFactory();
        assert(false, `${message} (no error thrown)`);
    } catch (error) {
        assert(pattern.test(error.message), `${message}: ${error.message}`);
    }
}

// --- Literal forms that must be rejected ---
const privateLiterals = [
    ['[::ffff:127.0.0.1]', 'IPv4-mapped loopback, dotted'],
    ['[::ffff:7f00:1]', 'IPv4-mapped loopback, hexadecimal'],
    ['[0:0:0:0:0:ffff:7f00:1]', 'IPv4-mapped loopback, uncompressed'],
    ['[0000:0000:0000:0000:0000:FFFF:7F00:0001]', 'IPv4-mapped loopback, zero-padded upper case'],
    ['[::ffff:169.254.169.254]', 'IPv4-mapped link-local metadata address, dotted'],
    ['[::ffff:a9fe:a9fe]', 'IPv4-mapped link-local metadata address, hexadecimal'],
    ['[::ffff:10.0.0.1]', 'IPv4-mapped RFC 1918 address'],
    ['[::ffff:0:7f00:1]', 'IPv4-translated loopback'],
    ['[::127.0.0.1]', 'IPv4-compatible loopback'],
    ['[64:ff9b::7f00:1]', 'NAT64 loopback, hexadecimal'],
    ['[64:ff9b::127.0.0.1]', 'NAT64 loopback, dotted'],
    ['[64:ff9b::a9fe:a9fe]', 'NAT64 link-local metadata address'],
    ['[64:ff9b:1::1]', 'NAT64 local-use prefix'],
    ['[2002:7f00:1::]', '6to4 loopback'],
    ['[2002:a9fe:a9fe::]', '6to4 link-local'],
    ['[::1]', 'IPv6 loopback'],
    ['[::]', 'IPv6 unspecified'],
    ['[fe80::1]', 'IPv6 link-local'],
    ['[fc00::1]', 'IPv6 unique-local (fc00::/7)'],
    ['[fd12:3456::1]', 'IPv6 unique-local (fd00::/8)'],
    ['[fec0::1]', 'IPv6 site-local'],
    ['[ff02::1]', 'IPv6 multicast'],
    ['[2001:db8::1]', 'IPv6 documentation prefix'],
    ['[2001::1]', 'Teredo prefix'],
    ['[100::1]', 'Discard-only prefix']
];

console.log('validateURL:');
for (const [literal, label] of privateLiterals) {
    assertThrows(() => ICSHandler.validateURL(`http://${literal}/calendar.ics`), `${label} ${literal} is rejected`);
}

console.log('\nvalidateURLForFetch:');
for (const [literal, label] of privateLiterals) {
    await assertRejects(
        () => ICSHandler.validateURLForFetch(`https://${literal}/calendar.ics`),
        `${label} ${literal} is rejected`
    );
}

// --- Existing behaviour is intact ---
console.log('\nExisting checks:');
assertThrows(() => ICSHandler.validateURL('http://localhost/calendar.ics'), 'localhost is still rejected');
assertThrows(() => ICSHandler.validateURL('http://metadata.google.internal/x'), 'metadata.google.internal is still rejected');
assertThrows(() => ICSHandler.validateURL('http://127.0.0.1/calendar.ics'), 'IPv4 loopback is still rejected');
assertThrows(() => ICSHandler.validateURL('http://2130706433/calendar.ics'), 'Decimal IPv4 loopback is rejected');
assertThrows(() => ICSHandler.validateURL('http://0x7f.1/calendar.ics'), 'Hexadecimal IPv4 loopback is rejected');
assertThrows(() => ICSHandler.validateURL('http://169.254.169.254/latest'), 'IPv4 link-local is still rejected');

console.log('\nPublic hosts:');
const publicURLs = [
    'https://example.com/calendar.ics',
    'https://8.8.8.8/calendar.ics',
    'https://[2001:4860:4860::8888]/calendar.ics',
    'https://[::ffff:8.8.8.8]/calendar.ics',
    'https://[64:ff9b::808:808]/calendar.ics',
    'https://[2002:808:808::]/calendar.ics'
];
for (const url of publicURLs) {
    let accepted = false;
    try {
        accepted = ICSHandler.validateURL(url) instanceof URL;
    } catch {
        accepted = false;
    }
    assert(accepted, `validateURL accepts ${url}`);
}
for (const url of publicURLs.slice(1)) {
    let accepted = false;
    try {
        accepted = (await ICSHandler.validateURLForFetch(url)) instanceof URL;
    } catch {
        accepted = false;
    }
    assert(accepted, `validateURLForFetch accepts public literal ${url}`);
}

console.log('\nisPrivateIPAddress:');
assert(ICSHandler.isPrivateIPAddress('::ffff:127.0.0.1') === true, 'Unbracketed IPv4-mapped loopback is private');
assert(ICSHandler.isPrivateIPAddress('::FFFF:7F00:1') === true, 'Upper-case hexadecimal IPv4-mapped loopback is private');
assert(ICSHandler.isPrivateIPAddress('fe80::1%eth0') === true, 'Link-local with a zone id is private');
assert(ICSHandler.isPrivateIPAddress(':::') === true, 'Unparseable IPv6 text is treated as private');
assert(ICSHandler.isPrivateIPAddress('1:2:3:4:5:6:7:8:9') === true, 'Over-long IPv6 text is treated as private');
assert(ICSHandler.isPrivateIPAddress('::ffff:8.8.8.8') === false, 'IPv4-mapped public address is not private');
assert(ICSHandler.isPrivateIPAddress('64:ff9b::808:808') === false, 'NAT64 public address is not private');
assert(ICSHandler.isPrivateIPAddress('2001:4860:4860::8888') === false, 'Public IPv6 address is not private');
assert(ICSHandler.isPrivateIPAddress('example.com') === false, 'A hostname is not an address');
assert(ICSHandler.isPrivateIPAddress('256.1.1.1') === true, 'Out-of-range IPv4 octets are treated as private');

// --- DNS results are checked for every non-literal host ---
console.log('\nDNS check:');
const originalResolve = ICSHandler.resolveHostname;
let lookedUp = null;
const withResolver = async (addresses, fn) => {
    ICSHandler.resolveHostname = async hostname => {
        lookedUp = hostname;
        return addresses;
    };
    try {
        return await fn();
    } finally {
        ICSHandler.resolveHostname = originalResolve;
    }
};

await withResolver([{ address: '93.184.216.34', family: 4 }], async () => {
    let accepted = false;
    try {
        accepted = (await ICSHandler.validateURLForFetch('https://feed.example.com/cal.ics')) instanceof URL;
    } catch {
        accepted = false;
    }
    assert(accepted && lookedUp === 'feed.example.com', 'A hostname resolving to a public address is accepted after lookup');
});
await withResolver([{ address: '::ffff:7f00:1', family: 6 }], () =>
    assertRejects(
        () => ICSHandler.validateURLForFetch('https://feed.example.com/cal.ics'),
        'A hostname resolving to an IPv4-mapped loopback address is rejected',
        /resolves to a private/
    )
);
await withResolver([{ address: '93.184.216.34', family: 4 }, { address: 'fe80::1%eth0', family: 6 }], () =>
    assertRejects(
        () => ICSHandler.validateURLForFetch('https://feed.example.com/cal.ics'),
        'A hostname with any link-local address is rejected',
        /resolves to a private/
    )
);
await withResolver([{ address: '64:ff9b::a9fe:a9fe', family: 6 }], () =>
    assertRejects(
        () => ICSHandler.validateURLForFetch('https://feed.example.com/cal.ics'),
        'A hostname resolving to a NAT64 metadata address is rejected',
        /resolves to a private/
    )
);
await withResolver([], () =>
    assertRejects(
        () => ICSHandler.validateURLForFetch('https://feed.example.com/cal.ics'),
        'A hostname with no addresses is rejected',
        /did not resolve/
    )
);

// --- Redirect handling ---
console.log('\nRedirects:');
const handler = new ICSHandler({ getEvent: () => null, addEvent: () => {}, getEvents: () => [] });
const originalFetch = globalThis.fetch;
const originalIsNode = ICSHandler.isNodeRuntime;
const fakeResponse = ({ url, status = 200, location = null }) => {
    const state = { cancelled: false };
    const headers = new Map(location ? [['location', location]] : []);
    return {
        state,
        response: {
            url,
            status,
            ok: status >= 200 && status < 300,
            headers: { get: name => headers.get(name.toLowerCase()) ?? null },
            body: {
                cancel: async () => {
                    state.cancelled = true;
                }
            }
        }
    };
};

try {
    // Node: each redirect hop is validated before it is requested
    ICSHandler.isNodeRuntime = () => true;
    await withResolver([{ address: '93.184.216.34', family: 4 }], async () => {
        const hop = fakeResponse({ url: 'https://feed.example.com/cal.ics', status: 302, location: 'http://[::ffff:7f00:1]/cal.ics' });
        let fetched = 0;
        globalThis.fetch = async () => {
            fetched++;
            return hop.response;
        };
        await assertRejects(
            () => handler.fetchSafeURL('https://feed.example.com/cal.ics', { signal: undefined, maxRedirects: 5 }),
            'A redirect to an IPv4-mapped loopback literal is rejected before it is fetched'
        );
        assert(fetched === 1 && hop.state.cancelled, 'Only the first hop was fetched and its body was discarded');
    });

    // Non-Node runtimes follow redirects themselves: the final URL is checked afterwards
    ICSHandler.isNodeRuntime = () => false;
    const followed = fakeResponse({ url: 'http://[::ffff:7f00:1]/cal.ics' });
    globalThis.fetch = async () => followed.response;
    await assertRejects(
        () => handler.fetchSafeURL('https://feed.example.com/cal.ics', { signal: undefined, maxRedirects: 5 }),
        'A followed redirect ending at a private address is rejected',
        /Redirected to a URL that is not allowed/
    );
    assert(followed.state.cancelled, 'The body of the disallowed final response was discarded');

    const followedPublic = fakeResponse({ url: 'https://cdn.example.net/cal.ics' });
    globalThis.fetch = async () => followedPublic.response;
    const result = await handler.fetchSafeURL('https://feed.example.com/cal.ics', { signal: undefined, maxRedirects: 5 });
    assert(result === followedPublic.response && !followedPublic.state.cancelled, 'A followed redirect ending at a public host is returned intact');
} finally {
    globalThis.fetch = originalFetch;
    ICSHandler.isNodeRuntime = originalIsNode;
}

console.log(`\n${failures === 0 ? 'All ICS URL guard tests passed' : `${failures} ICS URL guard test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
