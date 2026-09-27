import nodemailer from 'nodemailer';
import type { AppEnv } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  readonly available: boolean;
  readonly publicAppUrl: string;
  send(message: MailMessage): Promise<void>;
}

export class MailDeliveryError extends Error {
  constructor() {
    super('Email delivery is temporarily unavailable. Try again later.');
    this.name = 'MailDeliveryError';
  }
}

export const disabledMailTransport: MailTransport = {
  available: false,
  publicAppUrl: '',
  async send() { throw new MailDeliveryError(); }
};

export function createMailTransport(env: AppEnv): MailTransport {
  if (env.MAIL_TRANSPORT === 'disabled') return disabledMailTransport;
  const smtp = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {})
  });
  return {
    available: true,
    publicAppUrl: env.PUBLIC_APP_URL,
    async send(message) {
      try {
        await smtp.sendMail({ from: env.MAIL_FROM, ...message });
      } catch {
        // SMTP errors may include credentials, addresses, or the mail body.
        throw new MailDeliveryError();
      }
    }
  };
}
