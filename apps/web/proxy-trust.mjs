import { BlockList, isIP } from 'node:net';

export function parseTrustedProxyCidrs(value) {
  const entries = value.split(',').map((entry) => entry.trim());

  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new Error('must be a comma-separated list of IP CIDRs');
  }

  for (const entry of entries) {
    const separator = entry.lastIndexOf('/');
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`contains invalid CIDR "${entry}"`);
    }

    const address = entry.slice(0, separator);
    const prefixText = entry.slice(separator + 1);
    const family = isIP(address);
    const maximumPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;

    if (!/^(0|[1-9]\d{0,2})$/.test(prefixText)) {
      throw new Error(`contains invalid CIDR "${entry}"`);
    }

    const prefix = Number(prefixText);
    if (maximumPrefix < 0 || prefix > maximumPrefix || prefix === 0) {
      throw new Error(`contains invalid CIDR "${entry}"`);
    }

    try {
      new BlockList().addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
    } catch {
      throw new Error(`contains invalid CIDR "${entry}"`);
    }
  }

  return [...new Set(entries)];
}

function normalizeAddress(address) {
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) {
    return address.slice(7);
  }
  return address;
}

function compileTrustedProxyCidrs(cidrs) {
  const blockList = new BlockList();

  for (const cidr of cidrs) {
    const separator = cidr.lastIndexOf('/');
    const address = cidr.slice(0, separator);
    const prefix = Number(cidr.slice(separator + 1));
    blockList.addSubnet(address, prefix, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }

  return (address) => {
    const normalized = normalizeAddress(address);
    const family = isIP(normalized);
    return family !== 0 && blockList.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
  };
}

function lastHeaderValue(value) {
  if (typeof value !== 'string') return undefined;
  const values = value.split(',');
  const candidate = values.at(-1)?.trim();
  return candidate || undefined;
}

function validHost(value) {
  return Boolean(
    value &&
      value.length <= 255 &&
      !/[\s\\/@?#]/.test(value) &&
      !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function createForwardedHeaderPolicy(cidrs) {
  const isTrustedProxy = compileTrustedProxyCidrs(cidrs);

  return ({ remoteAddress, encrypted, headers }) => {
    const normalizedRemoteAddress = normalizeAddress(remoteAddress);
    const trustedPeer = isTrustedProxy(normalizedRemoteAddress);
    let clientAddress = normalizedRemoteAddress;

    if (trustedPeer && typeof headers['x-forwarded-for'] === 'string') {
      const chain = headers['x-forwarded-for'].split(',').map((entry) => entry.trim()).reverse();
      for (const candidate of chain) {
        if (isIP(candidate) === 0) break;
        clientAddress = normalizeAddress(candidate);
        if (!isTrustedProxy(clientAddress)) break;
      }
    }

    const forwardedProtocol = trustedPeer ? lastHeaderValue(headers['x-forwarded-proto']) : undefined;
    const normalizedForwardedProtocol = forwardedProtocol === 'https' || forwardedProtocol === 'wss'
      ? 'https'
      : forwardedProtocol === 'http' || forwardedProtocol === 'ws'
        ? 'http'
        : undefined;
    const protocol = normalizedForwardedProtocol ?? (encrypted ? 'https' : 'http');

    const forwardedHost = trustedPeer ? lastHeaderValue(headers['x-forwarded-host']) : undefined;
    const host = validHost(forwardedHost) ? forwardedHost : headers.host;

    return { clientAddress, host, protocol, trustedPeer };
  };
}
