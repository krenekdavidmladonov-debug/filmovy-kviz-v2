import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const theme = readFileSync('apps/web/src/styles/theme.css', 'utf8');
const css = readFileSync('apps/web/src/styles/global.css', 'utf8').replace(/\r\n/g, '\n');
const colors = Object.fromEntries([...theme.matchAll(/--color-([\w-]+): (#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]!])) as Record<string, string>;
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
}
function contrast(a: string, b: string) {
  const x = luminance(colors[a]!), y = luminance(colors[b]!);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

describe('dark UI accessibility and content boundaries', () => {
  test('all ordinary and placeholder text meets 4.5:1 on actual UI layers', () => {
    for (const foreground of ['text', 'text-muted', 'text-subtle', 'accent', 'link']) {
      for (const background of ['background', 'surface', 'surface-elevated', 'surface-subtle', 'selected']) {
        expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const status of ['success', 'warning', 'error']) {
      expect(contrast(status, `${status}-surface`), status).toBeGreaterThanOrEqual(4.5);
    }
    for (const action of ['primary', 'primary-hover']) expect(contrast('on-primary', action)).toBeGreaterThanOrEqual(4.5);
  });
  test('control boundaries and focus meet 3:1 against adjoining UI layers', () => {
    for (const background of ['background', 'surface', 'surface-elevated', 'surface-subtle']) {
      expect(contrast('border-strong', background), `field border on ${background}`).toBeGreaterThanOrEqual(3);
      expect(contrast('focus', background), `focus on ${background}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast('focus', 'selected')).toBeGreaterThanOrEqual(3);
    for (const status of ['success', 'warning', 'error']) expect(contrast(`${status}-border`, `${status}-surface`)).toBeGreaterThanOrEqual(3);
  });
  test('the previous content renderer CSS is preserved independently of the UI palette', () => {
    const content = '.slide-renderer {' + css.split('.slide-renderer {')[1]!.split('\n.preview-stage { min-height: 0;')[0]!;
    // Reference: deployed rebrand 40c124e. This includes background/overlay/media/answer colors.
    expect(createHash('sha256').update(content).digest('hex')).toBe('e26e3feea13123926cb184ff35195c3f8923929eefd1592157500626d42fd912');
  });
  test('the startup theme is render-blocking, without a script, preference or CSP exception', () => {
    const html = readFileSync('apps/web/index.html', 'utf8');
    expect(html.indexOf('href="/src/styles/theme.css"')).toBeLessThan(html.indexOf('<body>'));
    expect(html).toContain('name="color-scheme" content="dark"');
    expect(html).not.toContain('<style>');
    expect(theme).toContain('color-scheme: dark');
    expect(theme).not.toMatch(/prefers-color-scheme|localStorage|https?:/);
    expect(css).not.toMatch(/forced-color-adjust:\s*none|filter:\s*(invert|brightness)/);
    expect(css).toContain('@media (forced-colors: active)');
  });
});
