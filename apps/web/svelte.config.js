import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const livekitPublicUrl = process.env.LIVEKIT_PUBLIC_URL ?? 'ws://localhost:7880';
const livekitUrl = new URL(livekitPublicUrl);
if (
  !['ws:', 'wss:'].includes(livekitUrl.protocol) ||
  livekitUrl.username ||
  livekitUrl.password ||
  livekitUrl.pathname !== '/' ||
  livekitUrl.search ||
  livekitUrl.hash
) {
  throw new Error('LIVEKIT_PUBLIC_URL must be one exact ws:// or wss:// origin for web CSP');
}
const livekitOrigin = livekitUrl.origin;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      mode: 'nonce',
      directives: {
        'default-src': ['none'],
        'script-src': ['self'],
        'script-src-attr': ['none'],
        'style-src': ['self'],
        'style-src-attr': ['none'],
        'img-src': ['self', 'https:'],
        'connect-src': ['self', livekitOrigin],
        'media-src': ['self'],
        'worker-src': ['self'],
        'font-src': ['self'],
        'object-src': ['none'],
        'frame-src': ['none'],
        'frame-ancestors': ['none'],
        'base-uri': ['none'],
        'form-action': ['self'],
        'manifest-src': ['self'],
        'report-uri': ['/api/v1/security/csp-report']
      }
    }
  }
};

export default config;
