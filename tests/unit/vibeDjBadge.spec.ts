import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VibeDjBadge, VibeDjIcon } from '../../src/components/player/VibeDjBadge';
import { useVibeDjStore } from '../../src/store/vibeDjStore';

describe('VibeDjBadge & VibeDjIcon (Text-free Single SVG Animation)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders VibeDjIcon as a pure SVG with no text elements', () => {
    const html = renderToStaticMarkup(
      React.createElement(VibeDjIcon, {
        size: 22,
        themeColor: 'rose',
        isPlaying: true,
        isShaking: false,
      })
    );

    // Must be an SVG element
    expect(html.startsWith('<svg')).toBe(true);
    expect(html).toContain('viewBox="0 0 100 100"');
    expect(html).toContain('width="22"');
    expect(html).toContain('height="22"');

    // Invariant: MUST NOT contain any text or tspan nodes or any textual strings
    expect(html).not.toContain('<text');
    expect(html).not.toContain('<tspan');
    expect(html).not.toContain('Vibe DJ');
    expect(html).not.toContain('Prismatic');

    // Must contain SVG defs
    expect(html).toContain('<defs>');
  });

  it('returns null when Vibe DJ is inactive', () => {
    const html = renderToStaticMarkup(React.createElement(VibeDjBadge, { isActive: false }));
    expect(html).toBe('');
  });

  it('renders interactive button with zero text and single animated SVG icon when active', () => {
    const html = renderToStaticMarkup(
      React.createElement(VibeDjBadge, {
        isActive: true,
        vibeLabel: 'Prismatic Euphoria',
        themeColor: 'rose',
      })
    );

    // Must be a button
    expect(html.startsWith('<button')).toBe(true);
    expect(html).toContain('data-testid="vibe-dj-badge"');

    // Title / tooltip must inform user cleanly
    expect(html).toContain('title="Vibe DJ: Prismatic Euphoria');

    // Extract content between <button ...> and </button>
    const innerContent = html.replace(/<button[^>]*>/, '').replace(/<\/button>$/, '');

    // Must contain exactly one SVG
    const svgMatches = innerContent.match(/<svg/g);
    expect(svgMatches?.length).toBe(1);

    // Strip out all SVG tags, style blocks, and attributes
    const strippedText = innerContent
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    // MUST NOT have any visible text content
    expect(strippedText).toBe('');
  });

  it('supports custom theme colors and playing states', () => {
    const html = renderToStaticMarkup(
      React.createElement(VibeDjBadge, {
        isActive: true,
        vibeLabel: 'Velvet Midnight Reverie',
        themeColor: 'blue',
        accentColor: '#38bdf8',
      })
    );
    expect(html).toContain('Velvet Midnight Reverie');
    expect(html).toContain('#38bdf8');
  });

  it('guarantees center disc and center dot are 100% static with no rotation transforms', () => {
    const html = renderToStaticMarkup(
      React.createElement(VibeDjIcon, {
        size: 22,
        accentColor: '#38bdf8',
      })
    );

    // Tone 2 (Grey ring) must be concentric at (50, 50) with no transform
    expect(html).toContain('cx="50" cy="50" r="26.5" fill="#2c2d36"');
    // Tone 3 (Black dot) must be concentric at (50, 50) with no transform
    expect(html).toContain('cx="50" cy="50" r="11" fill="#000000"');

    // Must NOT contain any rotating group, translation, or transform-origin
    expect(html).not.toContain('transform="rotate');
    expect(html).not.toContain('transformOrigin');
    expect(html).not.toContain('transform-origin');
    expect(html).not.toContain('will-change-transform');
  });
});

