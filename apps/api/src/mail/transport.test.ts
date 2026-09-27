import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import type { AppEnv } from '../config/env.js';
import { createMailTransport, MailDeliveryError } from './transport.js';

test('SMTP_SECURE=false requires STARTTLS and refuses plaintext delivery', { timeout: 10_000 }, async () => {
  const commands: string[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 test SMTP\r\n');
    socket.on('data', (chunk: string) => {
      for (const line of chunk.split('\r\n').filter(Boolean)) {
        commands.push(line);
        socket.write(line.startsWith('EHLO ') ? '250 test\r\n' : line === 'STARTTLS' ? '500 STARTTLS unavailable\r\n' : '250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test SMTP did not bind.');
    const mail = createMailTransport({
      MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'cubic@example.test', SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(address.port), SMTP_SECURE: false, SMTP_USER: '', SMTP_PASSWORD: '',
      PUBLIC_APP_URL: 'http://127.0.0.1:3197'
    } as AppEnv);
    await assert.rejects(mail.send({ to: 'recipient@example.test', subject: 'Test', text: 'Test', html: '<p>Test</p>' }), MailDeliveryError);
    assert.equal(commands.some((line) => line.startsWith('MAIL FROM')), false);
    assert.equal(commands.some((line) => line === 'STARTTLS'), true);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
