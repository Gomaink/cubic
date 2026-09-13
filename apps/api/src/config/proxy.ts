import { BlockList, isIP } from 'node:net';

export function parseTrustedProxyCidrs(value: string): string[] {
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

export function createTrustedProxyCheck(cidrs: string[]): (address: string) => boolean {
  const blockList = new BlockList();

  for (const cidr of cidrs) {
    const separator = cidr.lastIndexOf('/');
    const address = cidr.slice(0, separator);
    const prefix = Number(cidr.slice(separator + 1));
    blockList.addSubnet(address, prefix, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }

  return (address) => {
    const normalized = address.startsWith('::ffff:') && isIP(address.slice(7)) === 4
      ? address.slice(7)
      : address;
    const family = isIP(normalized);
    return family !== 0 && blockList.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
  };
}
