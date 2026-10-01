import { UserTasteProfile, VibeCategory, UserVibeConfig, VibeDomainReasoning } from '../types/vibes';
import { safeStorage } from '../utils/storage';

export interface RawVibeTrack {
  title: string;
  artist: string;
  genre?: string;
  vibeReason?: string;
}

export interface RawVibePlaylist {
  vibe: VibeCategory;
  title: string;
  description: string;
  tagline: string;
  themeColor: 'purple' | 'emerald' | 'blue' | 'amber' | 'rose';
  domainReasoning?: VibeDomainReasoning;
  isExtraLong?: boolean;
  tracks: RawVibeTrack[];
}

export interface GeminiVibeResult {
  playlists: RawVibePlaylist[];
  modelUsed: string;
  fromFallback: boolean;
}

const GEMINI_API_KEYS: string[] = [
  'AIzaSyAqWxCw3KEiH7wQ1UbcmECWhNtQu8Qmx90',
  'AIzaSyDZUez5hocYYEsqpiOLF9tkEzJ7f0RmYu8',
  'AIzaSyAGypQOaklEGRh9c2xWYAuZgf0RkZoHkFw',
  'AIzaSyC3HbhoW6sdcbRzJJ2XiLkYEDkvRbLHA_U',
  'AIzaSyA5wf9L5Ja15CK2njDQ69l2U29RkykrTog',
];

const CANDIDATE_MODELS: string[] = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-flash-latest',
];

const STANDARD_PRESET_IDS = ['gaming', 'working', 'partying', 'chilling', 'workout'];

export class GeminiVibeService {
  private static instance: GeminiVibeService;
  private currentKeyIndex = 0;

  public static getInstance(): GeminiVibeService {
    if (!GeminiVibeService.instance) {
      GeminiVibeService.instance = new GeminiVibeService();
    }
    return GeminiVibeService.instance;
  }

  private getActiveKey(): string {
    const userKey =
      safeStorage.getItem<string>('gemini_api_key', '') ||
      safeStorage.getItem<string>('dotify_gemini_api_key', '');
    if (userKey && userKey.trim().length > 10) {
      return userKey.trim();
    }
    return GEMINI_API_KEYS[this.currentKeyIndex % GEMINI_API_KEYS.length];
  }

  private rotateKey(): string {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    console.log(`[GeminiVibeService] Rotated to API key index ${this.currentKeyIndex}`);
    return this.getActiveKey();
  }

  /**
   * Curates 4-5 daily vibe playlists using Gemini Flash grounded with Google Search,
   * with automatic multi-model failover and rich multi-domain reasoning.
   */
  public async generateDailyVibePlaylists(
    tasteProfile: UserTasteProfile,
    dateString: string,
    customVibes?: UserVibeConfig[]
  ): Promise<GeminiVibeResult> {
    const prompt = this.buildPrompt(tasteProfile, dateString, customVibes);
    let useSearch = true;

    for (const model of CANDIDATE_MODELS) {
      let modelKeyAttempts = 0;
      const maxKeyAttempts = GEMINI_API_KEYS.length;

      while (modelKeyAttempts < maxKeyAttempts) {
        const apiKey = this.getActiveKey();
        try {
          console.log(`[GeminiVibeService] Requesting vibe playlists via ${model} (Key index ${this.currentKeyIndex}, search: ${useSearch})...`);

          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const payload: any = {
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              topP: 0.95,
              maxOutputTokens: 8192,
            },
          };

          if (useSearch) {
            payload.tools = [{ google_search: {} }];
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(90000), // 90s timeout
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[GeminiVibeService] ${model} on Key index ${this.currentKeyIndex} failed (${res.status}):`, errText);

            if (useSearch && (res.status === 429 || res.status === 400)) {
              console.log('[GeminiVibeService] Search tool quota exhausted or unsupported; disabling search tool and retrying directly...');
              useSearch = false;
              continue;
            }

            this.rotateKey();
            modelKeyAttempts++;
            continue;
          }

          const data = await res.json();
          const candidateText =
            data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('\n') || '';

          const parsed = this.extractJsonPlaylists(candidateText, customVibes);
          if (parsed && parsed.length >= 4) {
            console.log(`[GeminiVibeService] Successfully curated ${parsed.length} vibe playlists with ${model}`);
            return {
              playlists: parsed,
              modelUsed: model,
              fromFallback: false,
            };
          } else {
            console.warn(`[GeminiVibeService] ${model} response did not contain at least 4 valid playlists. Raw text preview:`, candidateText.slice(0, 300));
            this.rotateKey();
            modelKeyAttempts++;
          }
        } catch (err: any) {
          console.warn(`[GeminiVibeService] Network or execution error on ${model} (Key index ${this.currentKeyIndex}):`, err?.message || err);
          this.rotateKey();
          modelKeyAttempts++;
        }
      }
    }

    // High-fidelity multi-domain algorithmic fallback
    console.warn('[GeminiVibeService] All Gemini models and keys exhausted. Using intelligent multi-domain algorithmic engine.');
    return {
      playlists: this.generateAlgorithmicFallback(tasteProfile, customVibes),
      modelUsed: 'Multi-Domain Algorithmic Engine',
      fromFallback: true,
    };
  }

  private buildPrompt(
    tasteProfile: UserTasteProfile,
    dateString: string,
    customVibes?: UserVibeConfig[]
  ): string {
    const vibes = (customVibes && customVibes.length > 0)
      ? customVibes
      : [
          { id: 'gaming', label: 'Gaming', prompt: 'High focus, high adrenaline, driving beats, dynamic flow state.', themeColor: 'purple' as const },
          { id: 'working', label: 'Working', prompt: 'Deep focus, study, productive flow, minimal distractions.', themeColor: 'emerald' as const },
          { id: 'partying', label: 'Partying', prompt: 'High energy bangers, danceable rhythms, celebratory anthems.', themeColor: 'rose' as const },
          { id: 'chilling', label: 'Chilling', prompt: 'Laid back, relaxing evening downtime, mellow acoustic or atmospheric tones.', themeColor: 'blue' as const },
          { id: 'workout', label: 'Workout', prompt: 'Cardio motivation, heavy drive, powerful momentum, high energy.', themeColor: 'amber' as const },
        ];

    const amendedOrCustomVibes = vibes.filter(
      (v) => v.isAmended || !STANDARD_PRESET_IDS.includes(v.id.toLowerCase())
    );

    const themesList = vibes
      .map((v, i) => {
        const isCustom = v.isAmended || !STANDARD_PRESET_IDS.includes(v.id.toLowerCase());
        const tag = isCustom ? ' [AMENDED / CUSTOM BESPOKE VIBE - REQUIRES EXTRA-LONG 35-50 TRACK SET]' : '';
        return `${i + 1}. "${v.id}" ("${v.label}")${tag}: ${v.prompt}`;
      })
      .join('\n');

    const genreSummary = tasteProfile.topGenreGroups && tasteProfile.topGenreGroups.length > 0
      ? tasteProfile.topGenreGroups
          .map((g) => `- ${g.group}: ${g.percentage}% listening affinity${g.topSubgenres && g.topSubgenres.length > 0 ? ` (subgenres: ${g.topSubgenres.join(', ')})` : ''}`)
          .join('\n')
      : 'No prior genre history recorded yet (new listener).';

    const topArtists = tasteProfile.topArtists && tasteProfile.topArtists.length > 0
      ? tasteProfile.topArtists.map((a) => `${a.name} (${a.playCount} plays)`).join(', ')
      : 'No artist history recorded yet.';

    const topTracks = tasteProfile.topTracks && tasteProfile.topTracks.length > 0
      ? tasteProfile.topTracks.map((t) => `"${t.title}" by ${t.artist} (${t.playCount} plays)`).join(', ')
      : 'No track history recorded yet.';

    const hasListeningHistory = Boolean(
      (tasteProfile.topGenreGroups && tasteProfile.topGenreGroups.length > 0) ||
      (tasteProfile.topArtists && tasteProfile.topArtists.length > 0) ||
      (tasteProfile.topTracks && tasteProfile.topTracks.length > 0)
    );

    const tasteSection = hasListeningHistory
      ? `USER'S ACTUAL LISTENING PROFILE & TASTE TELEMETRY:
- Dominant Genre: ${tasteProfile.dominantGenre || 'Eclectic'}
- Macro Genre Distribution:
${genreSummary}
- Most Played Artists:
${topArtists}
- Recent Favorite & Repeated Songs:
${topTracks}

CRITICAL TASTE-FIRST CURATION DIRECTIVE:
1. FILTER EVERY CUSTOM THEME THROUGH THE USER'S MUSICAL TASTE:
   Every single playlist MUST be anchored in the user's genuine listening preferences.
   Even for activity-based vibes (e.g. "Gaming", "Workout", "Coding", "Late Night"), select songs that match the specific genres, subgenres, and styles the user actually loves.
   Blend tracks by their favorite artists with fresh, acclaimed discoveries that naturally expand their taste within those sonic worlds.
2. ZERO UNRELATED COMMERCIAL FILLER:
   Do NOT output generic top-40 songs that disregard the user's listening profile.`
      : `USER PROFILE:
- New listener (cold start, no listening history yet).
- Curate each custom vibe based strictly on the user's specified title, mood, and musical direction, selecting critically acclaimed, authentic, high-quality songs that capture that vibe.`;

    const amendedNote = amendedOrCustomVibes.length > 0
      ? `\nSPECIAL DIRECTIVE FOR AMENDED / CUSTOM VIBES:
The user explicitly typed and added the following custom bespoke vibes: ${amendedOrCustomVibes.map((v) => `"${v.label}"`).join(', ')}.
For each amended/custom vibe, you MUST curate an EXTRA-LONG set of 35 to 50 tracks! It must be super well thought out, deeply researched, and cinematic in scope.`
      : '';

    return `You are Dotify's master AI music curator and DJ.
Today is ${dateString}.

The user has explicitly defined the following ${vibes.length} daily vibes/themes for their music rotation:
${themesList}

${tasteSection}
${amendedNote}

MANDATORY MULTI-DOMAIN REASONING BEFORE PLAYLIST SELECTION:
For each playlist, you MUST formulate comprehensive, deep-thinking reasoning across 5 distinct domains BEFORE outputting the track selection:
1. "thematicDomain": Deep philosophical, cultural, narrative, or conceptual exploration of what this vibe represents (e.g. for "singularity is coming": technological singularity, AI consciousness, digital transcendence, existential dread, synthetic life, post-human evolution).
2. "sonicDomain": The architectural soundscape, timbral textures, instrumentation palette, synthesizer design, frequency dynamics, and rhythmic pacing (e.g. modular synth arpeggios, cybernetic glitch percussion, sub-bass pressure, cavernous algorithmic reverbs).
3. "emotionalDomain": The psychological flow state, tension curve, and emotional trajectory from opening anticipation to climactic transcendence.
4. "tasteAlignment": How this soundscape directly connects with this user's listening profile, favorite artists, and acoustic preferences.
5. "curationStrategy": The discriminating principles used to select the tracks, prioritizing groundbreaking masterpieces, underground pioneers, and genre-defining milestones with ZERO generic commercial filler.

TRACKLIST LENGTH DIRECTIVE:
- Standard preset vibes: 20 to 30 tracks.
- Bespoke custom / amended vibes (e.g. ${amendedOrCustomVibes.map((v) => `"${v.label}"`).join(', ') || 'custom vibes'}): 35 TO 50 TRACKS.

JSON OUTPUT SCHEMA:
{
  "playlists": [
${vibes
  .map(
    (v) => `    {
      "vibe": "${v.id}",
      "title": "${v.label} Set Name",
      "description": "Engaging description of this ${v.label} soundscape.",
      "tagline": "Tailored for ${v.label}",
      "themeColor": "${v.themeColor || 'purple'}",
      "domainReasoning": {
        "thematicDomain": "Philosophical, narrative, and conceptual deconstruction of ${v.label}...",
        "sonicDomain": "Acoustic architecture, instrumentation, synthesizer palette, and tempo curve...",
        "emotionalDomain": "Psychological journey, tension/release, and peak energy trajectory...",
        "tasteAlignment": "How this connects directly to the user's listened genres and favorite artists...",
        "curationStrategy": "Criteria for choosing these specific tracks without commercial filler..."
      },
      "tracks": [
        {
          "title": "Track Title",
          "artist": "Artist Name",
          "genre": "Genre",
          "vibeReason": "Concise justification referencing the sonic/thematic reasoning"
        }
      ]
    }`
  )
  .join(',\n')}
  ]
}

Strictly output valid JSON only. Now curate the playlists with domain reasoning and return the JSON.`;
  }

  /**
   * Matches a raw vibe string or title from LLM to one of the user's configured vibes.
   * Tolerant to slug differences, spaces, cases, and positional ordering.
   */
  private matchVibeToConfig(
    rawVibe: string,
    rawTitle: string,
    index: number,
    customVibes?: UserVibeConfig[]
  ): UserVibeConfig | null {
    if (!customVibes || customVibes.length === 0) return null;

    const cleanRaw = String(rawVibe || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanTitle = String(rawTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Direct ID match
    let match = customVibes.find(
      (v) => v.id.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanRaw
    );
    if (match) return match;

    // 2. Direct Label match
    match = customVibes.find(
      (v) => v.label.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanRaw
    );
    if (match) return match;

    // 3. Substring match on label or title
    match = customVibes.find((v) => {
      const vLabelClean = v.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      const vIdClean = v.id.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!vLabelClean) return false;
      return (
        cleanRaw.includes(vLabelClean) ||
        vLabelClean.includes(cleanRaw) ||
        cleanTitle.includes(vLabelClean) ||
        cleanRaw.includes(vIdClean) ||
        vIdClean.includes(cleanRaw)
      );
    });
    if (match) return match;

    // 4. Positional fallback: index in model's array maps to customVibes[index]
    if (index >= 0 && index < customVibes.length) {
      return customVibes[index];
    }

    return null;
  }

  /**
   * Extracts and validates the JSON playlists payload from the model's text response.
   */
  private extractJsonPlaylists(text: string, customVibes?: UserVibeConfig[]): RawVibePlaylist[] | null {
    if (!text || typeof text !== 'string') return null;

    try {
      let jsonStr = text;
      const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (blockMatch && blockMatch[1]) {
        jsonStr = blockMatch[1];
      } else {
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = text.substring(firstBrace, lastBrace + 1);
        }
      }

      const parsed = JSON.parse(jsonStr);
      const list = parsed.playlists || parsed;
      if (!Array.isArray(list)) return null;

      const validated: RawVibePlaylist[] = [];

      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item || typeof item !== 'object') continue;

        const rawVibeStr = String(item.vibe || '');
        const matchingConfig = this.matchVibeToConfig(rawVibeStr, item.title, i, customVibes);

        const tracks: RawVibeTrack[] = [];
        if (Array.isArray(item.tracks)) {
          for (const t of item.tracks) {
            if (t && t.title && t.artist) {
              tracks.push({
                title: String(t.title).trim(),
                artist: String(t.artist).trim(),
                genre: t.genre ? String(t.genre).trim() : undefined,
                vibeReason: t.vibeReason ? String(t.vibeReason).trim() : undefined,
              });
            }
          }
        }

        if (tracks.length > 0) {
          const fallbackLabel = matchingConfig?.label || rawVibeStr || `Vibe ${i + 1}`;
          const allowedColors = ['purple', 'emerald', 'blue', 'amber', 'rose'];
          const themeColor = allowedColors.includes(item.themeColor)
            ? item.themeColor
            : (matchingConfig?.themeColor && allowedColors.includes(matchingConfig.themeColor)
                ? matchingConfig.themeColor
                : this.getDefaultColorForVibe(fallbackLabel));

          const rawReasoning = item.domainReasoning;
          const domainReasoning: VibeDomainReasoning | undefined = rawReasoning
            ? {
                thematicDomain: rawReasoning.thematicDomain ? String(rawReasoning.thematicDomain).trim() : undefined,
                sonicDomain: rawReasoning.sonicDomain ? String(rawReasoning.sonicDomain).trim() : undefined,
                emotionalDomain: rawReasoning.emotionalDomain ? String(rawReasoning.emotionalDomain).trim() : undefined,
                tasteAlignment: rawReasoning.tasteAlignment ? String(rawReasoning.tasteAlignment).trim() : undefined,
                curationStrategy: rawReasoning.curationStrategy ? String(rawReasoning.curationStrategy).trim() : undefined,
              }
            : undefined;

          validated.push({
            vibe: matchingConfig?.id || rawVibeStr || `custom_${i}`,
            title: String(item.title || `${fallbackLabel} Set`).trim(),
            description: String(
              item.description || matchingConfig?.prompt || `Curated ${fallbackLabel} playlist tailored to your listening taste.`
            ).trim(),
            tagline: String(item.tagline || `Curated for ${fallbackLabel}`).trim(),
            themeColor,
            domainReasoning,
            isExtraLong: tracks.length >= 30 || Boolean(matchingConfig?.isAmended),
            tracks,
          });
        }
      }

      return validated.length >= 3 ? validated : null;
    } catch (err) {
      console.debug('[GeminiVibeService] JSON parse error:', err);
      return null;
    }
  }

  private getDefaultColorForVibe(vibe: string): 'purple' | 'emerald' | 'blue' | 'amber' | 'rose' {
    const v = vibe.toLowerCase();
    if (v.includes('singularity') || v.includes('cyber') || v.includes('future') || v.includes('ai')) return 'purple';
    if (v.includes('work') || v.includes('cod') || v.includes('study')) return 'emerald';
    if (v.includes('party') || v.includes('dance') || v.includes('nostal')) return 'rose';
    if (v.includes('chill') || v.includes('meditat') || v.includes('sleep')) return 'blue';
    if (v.includes('workout') || v.includes('gym') || v.includes('run') || v.includes('coffee')) return 'amber';
    return 'purple';
  }

  /**
   * Dynamically shuffles and samples from a track pool so that every press of "Refresh"
   * yields a freshly rotated, unique sequencing of tracks.
   */
  private rotateAndShuffleTracks(
    pool: RawVibeTrack[],
    count: number,
    preserveFirst: boolean = false
  ): RawVibeTrack[] {
    if (!pool || pool.length === 0) return [];
    const head = preserveFirst ? pool[0] : null;
    const tail = preserveFirst ? pool.slice(1) : [...pool];

    // Fisher-Yates shuffle
    for (let i = tail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }

    const targetCount = Math.max(10, count);
    const needed = preserveFirst ? targetCount - 1 : targetCount;
    const selected = tail.slice(0, Math.min(tail.length, needed));
    return head ? [head, ...selected] : selected;
  }

  /**
   * Resilient, high-fidelity algorithmic fallback playlists with multi-domain reasoning
   * and extra-long 35-40 track collections for amended/custom vibes (like "singularity is coming").
   */
  public generateAlgorithmicFallback(
    tasteProfile: UserTasteProfile,
    customVibes?: UserVibeConfig[]
  ): RawVibePlaylist[] {
    const dominant = tasteProfile.dominantGenre || 'Electronic & Dance';

    const catalog: Record<string, RawVibePlaylist> = {
      gaming: {
        vibe: 'gaming',
        title: 'Cyber Circuit // Game Mode',
        description: 'Driving synthwave, high-BPM electronic adrenaline, and dark electro for intense flow state.',
        tagline: `Tuned to your ${dominant} taste + modern synthwave classics`,
        themeColor: 'purple',
        domainReasoning: {
          thematicDomain: 'Focus state under digital pressure, cyberspace combat, and neon velocity.',
          sonicDomain: 'High-BPM arpeggiated basslines, sidechained kicks, aggressive analog distortion, and crystal leads.',
          emotionalDomain: 'Continuous adrenaline plateau with rhythmic drops designed to sustain reflexes.',
          tasteAlignment: `Synthesizes your ${dominant} affinity with acclaimed electronic gaming benchmarks.`,
          curationStrategy: 'Zero distracting vocals, maximum rhythmic momentum, and relentless forward drive.',
        },
        tracks: [
          { title: 'Nightcall', artist: 'Kavinsky', genre: 'Synthwave', vibeReason: 'Iconic cinematic driving electronic anthem' },
          { title: 'Turbo Killer', artist: 'Carpenter Brut', genre: 'Darksynth', vibeReason: 'Maximum adrenaline boss-fight energy' },
          { title: 'Midnight City', artist: 'M83', genre: 'Synth-Pop', vibeReason: 'Uplifting stadium synthwave melody' },
          { title: 'Resonance', artist: 'HOME', genre: 'Chillwave', vibeReason: 'Smooth retro-future focus track' },
          { title: 'Tech Noir', artist: 'Gunship', genre: 'Synthwave', vibeReason: 'Rich atmospheric soundscapes' },
          { title: 'Genesis', artist: 'Justice', genre: 'Electro House', vibeReason: 'Crunchy distorted bass and rhythmic drive' },
          { title: 'Fortune Days', artist: 'The Glitch Mob', genre: 'Glitch Hop', vibeReason: 'Complex rhythmic build-ups and electronic momentum' },
          { title: '4:42', artist: 'Danger', genre: 'Electro Darkwave', vibeReason: 'Fast-paced rhythmic synth pulses' },
          { title: 'The Island, Pt. I (Dawn)', artist: 'Pendulum', genre: 'Drum & Bass', vibeReason: 'High-speed adrenaline and driving drums' },
          { title: 'Strobe', artist: 'Deadmau5', genre: 'Progressive House', vibeReason: 'Epic progressive electronic build for marathon sessions' },
          { title: 'Invaders Must Die', artist: 'The Prodigy', genre: 'Big Beat', vibeReason: 'Unstoppable aggressive energy and dirty synths' },
          { title: 'Future Club', artist: 'Perturbator', genre: 'Cyberpunk Synthwave', vibeReason: 'Neon dystopia arcade atmosphere' },
          { title: 'Daybreak', artist: 'OVERWERK', genre: 'Complextro', vibeReason: 'Orchestral and electro house fusion' },
          { title: 'Kept', artist: 'Crystal Castles', genre: 'Chiptune / Electronic', vibeReason: 'Hypnotic electronic pulses' },
          { title: 'Icarus', artist: 'Madeon', genre: 'French House', vibeReason: 'Bright soaring chords and euphoric progression' },
          { title: 'Bonfire', artist: 'Knife Party', genre: 'Dubstep', vibeReason: 'Heavy relentless drops for intense gaming moments' },
          { title: 'Pacific Coast Highway', artist: 'Kavinsky', genre: 'Synthwave', vibeReason: 'Driving night speed' },
          { title: 'Roller Mobster', artist: 'Carpenter Brut', genre: 'Darksynth', vibeReason: 'Aggressive synth violence and speed' },
          { title: 'Star Eater', artist: 'Daniel Deluxe', genre: 'Cyberpunk', vibeReason: 'Heavy cyberpunk synth arpeggios' },
          { title: 'End of Line', artist: 'Daft Punk', genre: 'Electronic', vibeReason: 'TRON: Legacy digital grid intensity' },
        ],
      },
      working: {
        vibe: 'working',
        title: 'Deep Flow // Studio Focus',
        description: 'Instrumental chillhop, ambient lo-fi textures, and melodic soundscapes for uninterrupted concentration.',
        tagline: 'Ambient calm and productivity rhythms',
        themeColor: 'emerald',
        domainReasoning: {
          thematicDomain: 'Cognitive immersion, intellectual architecture, and peaceful productivity.',
          sonicDomain: 'Tape-warm piano, sub-bass warmth, gentle vinyl crackle, and steady downtempo percussion.',
          emotionalDomain: 'Low-friction tranquility and sustained alpha-wave mental flow.',
          tasteAlignment: 'Organic instruments and modern beats tailored for focus.',
          curationStrategy: 'Zero intrusive vocals; meticulously calibrated tempo and acoustic textures.',
        },
        tracks: [
          { title: 'Weightless', artist: 'Marconi Union', genre: 'Ambient', vibeReason: 'Scientifically calibrated for stress-free focus' },
          { title: 'Coffee Breath', artist: 'Kudasai', genre: 'Lo-Fi', vibeReason: 'Gentle vinyl warmth for deep reading and code' },
          { title: 'Daylight', artist: 'Kupla', genre: 'Chillhop', vibeReason: 'Soft piano and mellow drum grooves' },
          { title: 'Affection', artist: 'Jinsang', genre: 'Lo-Fi', vibeReason: 'Classic tape-hiss nostalgic productivity' },
          { title: 'Intro', artist: 'The xx', genre: 'Indie Instrumental', vibeReason: 'Iconic minimal loop for zero distraction' },
          { title: 'A Walk', artist: 'Tycho', genre: 'Ambient Electronic', vibeReason: 'Warm organic synths that promote steady rhythm' },
          { title: 'Solitude', artist: 'Lofi Fruits Music', genre: 'Lo-Fi Beats', vibeReason: 'Relaxing background pulse' },
          { title: 'Time', artist: 'Hans Zimmer', genre: 'Cinematic', vibeReason: 'Expansive swelling chords for ambitious tasks' },
          { title: 'Weightless Pt. 2', artist: 'Marconi Union', genre: 'Ambient', vibeReason: 'Sustained focus soundscape' },
          { title: 'Avril 14th', artist: 'Aphex Twin', genre: 'Piano Instrumental', vibeReason: 'Delicate acoustic piano elegance' },
          { title: 'Kerala', artist: 'Bonobo', genre: 'Downtempo', vibeReason: 'Intricate percussion loops and atmospheric vocal chops' },
          { title: 'Soon It Will Be Cold', artist: 'Emancipator', genre: 'Trip-Hop / Chill', vibeReason: 'Organic violin and chilled downtempo rhythm' },
          { title: 'nagashi', artist: 'idealism', genre: 'Lo-Fi Hip-Hop', vibeReason: 'Serene rainy day piano beats' },
          { title: 'Monday Loop', artist: 'Tomppabeats', genre: 'Lo-Fi', vibeReason: 'Warm short soothing sample loops' },
          { title: 'Dayvan Cowboy', artist: 'Boards of Canada', genre: 'IDM / Ambient', vibeReason: 'Majestic drifting soundscapes for uninterrupted flow' },
          { title: 'An Ending (Ascent)', artist: 'Brian Eno', genre: 'Ambient', vibeReason: 'Timeless peaceful texture that clears mental noise' },
          { title: 'saman', artist: 'Ólafur Arnalds', genre: 'Neo-Classical', vibeReason: 'Intimate piano keys and subtle strings' },
          { title: 'Says', artist: 'Nils Frahm', genre: 'Modern Classical', vibeReason: 'Mesmerizing synthesizer arpeggios that build focus' },
          { title: 'Blurred', artist: 'Kiasmos', genre: 'Minimal Techno', vibeReason: 'Subtle driving pulse that keeps momentum without distraction' },
          { title: 'On the Nature of Daylight', artist: 'Max Richter', genre: 'Contemporary Classical', vibeReason: 'Deep contemplative string movements' },
        ],
      },
      partying: {
        vibe: 'partying',
        title: 'Neon Euphoria // Party Anthems',
        description: 'High-energy dance hits, club bangers, and infectious hooks to turn the volume all the way up.',
        tagline: 'Chart hits and irresistible dance floor energy',
        themeColor: 'rose',
        domainReasoning: {
          thematicDomain: 'Collective celebration, sensory euphoria, and late-night weekend momentum.',
          sonicDomain: 'Thumping 4-on-the-floor kicks, bright disco brass, euphoric filter sweeps, and infectious vocal hooks.',
          emotionalDomain: 'Uninhibited joy, social elevation, and peak crowd adrenaline.',
          tasteAlignment: 'Dance-floor selections tuned with genuine acoustic funk and modern groove.',
          curationStrategy: 'Irresistible tempo consistency and singalong festival moments.',
        },
        tracks: [
          { title: 'One More Time', artist: 'Daft Punk', genre: 'Dance / House', vibeReason: 'The undisputed universal dance anthem' },
          { title: 'Levitating', artist: 'Dua Lipa', genre: 'Dance-Pop', vibeReason: 'Upbeat disco-pop funk for crowds' },
          { title: 'Titanium', artist: 'David Guetta', genre: 'EDM', vibeReason: 'Soaring festival drops and massive vocals' },
          { title: 'Clarity', artist: 'Zedd', genre: 'Electro House', vibeReason: 'Euphoric singalong chorus' },
          { title: 'Don\'t Stop the Music', artist: 'Rihanna', genre: 'Dance-Pop', vibeReason: 'Timeless club floor-filler' },
          { title: 'Summer', artist: 'Calvin Harris', genre: 'EDM', vibeReason: 'Sunny festival vibes and bouncy synth lead' },
          { title: 'Can\'t Hold Us', artist: 'Macklemore & Ryan Lewis', genre: 'Hip-Hop', vibeReason: 'High octane hype and explosive energy' },
          { title: 'Levels', artist: 'Avicii', genre: 'Progressive House', vibeReason: 'Legendary melodic drop that never fails' },
          { title: 'About Damn Time', artist: 'Lizzo', genre: 'Disco Funk', vibeReason: 'Irresistible celebratory rhythm' },
          { title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', genre: 'Funk Pop', vibeReason: 'Maximum funk and infectious brass' },
          { title: 'CUFF IT', artist: 'Beyoncé', genre: 'Disco / R&B', vibeReason: 'Irresistible groove and celebratory vibes' },
          { title: 'Closer', artist: 'The Chainsmokers', genre: 'Pop / EDM', vibeReason: 'Nostalgic sing-along anthem' },
          { title: 'Time of Our Lives', artist: 'Pitbull', genre: 'Party Pop', vibeReason: 'High-spirits weekend party classic' },
          { title: 'The Business', artist: 'Tiësto', genre: 'Deep House', vibeReason: 'Hypnotic driving bass for late-night floors' },
          { title: '(It Goes Like) Nanana', artist: 'Peggy Gou', genre: 'House', vibeReason: 'Catchy 90s eurodance summer revival' },
          { title: 'Don\'t You Worry Child', artist: 'Swedish House Mafia', genre: 'Progressive House', vibeReason: 'Hands-in-the-air festival euphoria' },
          { title: 'Losing It', artist: 'FISHER', genre: 'Tech House', vibeReason: 'Thunderous rolling bassline drop' },
          { title: 'Turn On The Lights again..', artist: 'Fred again.. & Swedish House Mafia', genre: 'Future Garage', vibeReason: 'Modern club peak-time energy' },
          { title: 'One Kiss', artist: 'Calvin Harris & Dua Lipa', genre: 'Dance-Pop', vibeReason: 'Effortlessly smooth dance groove' },
          { title: 'I Gotta Feeling', artist: 'Black Eyed Peas', genre: 'Party Anthem', vibeReason: 'The ultimate kickoff track for celebration' },
        ],
      },
      chilling: {
        vibe: 'chilling',
        title: 'Golden Sunset // Chill Session',
        description: 'Mellow acoustic strums, smooth soul, and relaxing downtempo melodies to unwind after a long day.',
        tagline: 'Laid back melodies and warm acoustic tones',
        themeColor: 'blue',
        domainReasoning: {
          thematicDomain: 'Downtime decompression, twilight stillness, and organic warmth.',
          sonicDomain: 'Acoustic nylon guitars, warm Rhodes piano, gentle brush drums, and intimate vocals.',
          emotionalDomain: 'Deep exhale, restorative grounding, and gentle contentment.',
          tasteAlignment: 'Warm acoustic textures and indie soul matching mellow listening moments.',
          curationStrategy: 'Relaxed tempos, organic instrumentation, and zero aggressive percussion.',
        },
        tracks: [
          { title: 'Sunset Lover', artist: 'Petit Biscuit', genre: 'Melodic Electronic', vibeReason: 'Golden-hour warm vocal chops' },
          { title: 'Banana Pancakes', artist: 'Jack Johnson', genre: 'Acoustic / Folk', vibeReason: 'Sunny effortless Sunday morning groove' },
          { title: 'Put Your Records On', artist: 'Corinne Bailey Rae', genre: 'Soul / Pop', vibeReason: 'Carefree uplifting acoustic soul' },
          { title: 'Beyond', artist: 'Leon Bridges', genre: 'Soul / R&B', vibeReason: 'Timeless retro soul warmth' },
          { title: 'Slow Burn', artist: 'Kacey Musgraves', genre: 'Acoustic Country', vibeReason: 'Gentle banjo and contemplative lyrics' },
          { title: 'Holocene', artist: 'Bon Iver', genre: 'Indie Folk', vibeReason: 'Expansive acoustic textures and falsetto' },
          { title: 'Texas Sun', artist: 'Khruangbin & Leon Bridges', genre: 'Psychedelic Soul', vibeReason: 'Breezy dusty open highway feeling' },
          { title: 'Breathe (In the Air)', artist: 'Pink Floyd', genre: 'Classic Rock', vibeReason: 'Slow hypnotic pedal steel guitar' },
          { title: 'Stay Alive', artist: 'José González', genre: 'Indie Folk', vibeReason: 'Inspiring nylon-string fingerpicking' },
          { title: 'Gravity', artist: 'John Mayer', genre: 'Blues / Pop', vibeReason: 'Soulful electric guitar bends and smooth groove' },
          { title: 'Bloom', artist: 'The Paper Kites', genre: 'Indie Folk', vibeReason: 'Delicate acoustic fingerpicking duet' },
          { title: 'White Ferrari', artist: 'Frank Ocean', genre: 'R&B / Ambient', vibeReason: 'Intimate atmospheric acoustic reflection' },
          { title: 'Mystery of Love', artist: 'Sufjan Stevens', genre: 'Indie Folk', vibeReason: 'Delicate mandolin and breathy melodies' },
          { title: 'Come Away With Me', artist: 'Norah Jones', genre: 'Jazz / Pop', vibeReason: 'Timeless intimate smoky vocal and piano' },
          { title: 'Dreams', artist: 'Fleetwood Mac', genre: 'Soft Rock', vibeReason: 'Iconic hypnotic bassline and breezy groove' },
          { title: 'San Luis', artist: 'Gregory Alan Isakov', genre: 'Indie Folk', vibeReason: 'Haunting acoustic guitar and distant banjo' },
          { title: 'Riptide', artist: 'Vance Joy', genre: 'Indie Folk', vibeReason: 'Warm buoyant ukulele and optimistic spirit' },
          { title: 'River', artist: 'Leon Bridges', genre: 'Gospel / Soul', vibeReason: 'Stripped-back acoustic tambourine and deep soul' },
          { title: 'Budapest', artist: 'George Ezra', genre: 'Folk Pop', vibeReason: 'Rich baritone voice and easy acoustic strum' },
          { title: 'Skinny Love', artist: 'Bon Iver', genre: 'Indie Folk', vibeReason: 'Raw emotional acoustic acoustic resonance' },
        ],
      },
      workout: {
        vibe: 'workout',
        title: 'Iron Pulse // High Intensity',
        description: 'Hard-hitting beats, driving basslines, and relentless energy to power through every rep.',
        tagline: 'High-intensity motivation and heavy momentum',
        themeColor: 'amber',
        domainReasoning: {
          thematicDomain: 'Physical exertion, overcoming resistance, and breakthrough endurance.',
          sonicDomain: 'Heavy sub-bass impacts, industrial distorted synth leads, aggressive percussion, and driving tempo.',
          emotionalDomain: 'High arousal, determination, and unstoppable momentum.',
          tasteAlignment: 'High-energy tracks curated without generic cheesy gym EDM.',
          curationStrategy: 'Fast, motivating BPMs that synchronize with heart rate and cadence.',
        },
        tracks: [
          { title: 'Till I Collapse', artist: 'Eminem', genre: 'Hip-Hop', vibeReason: 'Unstoppable determination and legendary hype' },
          { title: 'Stronger', artist: 'Kanye West', genre: 'Hip-Hop / Electronic', vibeReason: 'Driving futuristic pulse and heavy punch' },
          { title: 'Breathe', artist: 'The Prodigy', genre: 'Big Beat', vibeReason: 'Raw gritty aggression and relentless drive' },
          { title: 'Can\'t Be Touched', artist: 'Roy Jones Jr.', genre: 'Hip-Hop', vibeReason: 'Classic combat motivation' },
          { title: 'POWER', artist: 'Kanye West', genre: 'Hip-Hop', vibeReason: 'Tribal claps and triumphant horns' },
          { title: 'Remember the Name', artist: 'Fort Minor', genre: 'Hip-Hop', vibeReason: 'Iconic gym anthem about perseverance' },
          { title: 'X Gon\' Give It To Ya', artist: 'DMX', genre: 'Hip-Hop', vibeReason: 'Explosive vocal energy' },
          { title: 'Bleed It Out', artist: 'Linkin Park', genre: 'Nu-Metal / Rock', vibeReason: 'Fast-paced rock velocity' },
          { title: 'Go!', artist: 'The Chemical Brothers', genre: 'Electronic', vibeReason: 'Punchy motivational electronic groove' },
          { title: 'Centuries', artist: 'Fall Out Boy', genre: 'Alternative Rock', vibeReason: 'Stirring anthem with massive stadium drums' },
          { title: 'Believer', artist: 'Imagine Dragons', genre: 'Alternative Rock', vibeReason: 'Heavy stomping percussion and fierce vocals' },
          { title: 'Lose Yourself', artist: 'Eminem', genre: 'Hip-Hop', vibeReason: 'Relentless lyrical focus and intensity' },
          { title: 'Seven Nation Army (Glitch Mob Remix)', artist: 'The White Stripes', genre: 'Glitch Hop', vibeReason: 'Sub-bass earthquake and iconic riff' },
          { title: 'Run Boy Run', artist: 'Woodkid', genre: 'Chamber Pop / Orchestral', vibeReason: 'Thundering cinematic percussion' },
          { title: 'Killing In The Name', artist: 'Rage Against The Machine', genre: 'Rap Metal', vibeReason: 'Unmatched raw power and rebellious fuel' },
          { title: 'Sabotage', artist: 'Beastie Boys', genre: 'Punk / Hip-Hop', vibeReason: 'High-octane fuzz bass and ferocious tempo' },
          { title: 'Clubbed to Death', artist: 'Rob Dougan', genre: 'Trip-Hop / Cinematic', vibeReason: 'Iconic Matrix orchestral electronic build' },
          { title: 'Bangarang', artist: 'Skrillex', genre: 'Dubstep', vibeReason: 'Hyper-energetic bass drops for max sets' },
          { title: 'Down with the Sickness', artist: 'Disturbed', genre: 'Heavy Metal', vibeReason: 'Brutal rhythmic aggression' },
          { title: 'Chop Suey!', artist: 'System Of A Down', genre: 'Alternative Metal', vibeReason: 'Frenetic tempo switches and adrenaline spikes' },
        ],
      },
      nightdrive: {
        vibe: 'nightdrive',
        title: 'Neon Horizon // Night Drive',
        description: 'Atmospheric synth-pop, darkwave pulses, and midnight cruising rhythms under street lamps.',
        tagline: 'Moody highway soundscapes and neon synthwave',
        themeColor: 'purple',
        domainReasoning: {
          thematicDomain: 'Nocturnal metropolitan exploration, empty wet asphalt, sodium vapor street lamps, and cinematic speed.',
          sonicDomain: 'Pulsing 80s basslines, analog synthesizer arpeggios, gated reverb snares, and breathy vocals.',
          emotionalDomain: 'Contemplative solitude, sleek nocturnal confidence, and cinematic flow.',
          tasteAlignment: 'Melodic electronic and synth-driven anthems avoiding abrasive distortion.',
          curationStrategy: 'Smooth rhythmic consistency designed to match late-night highway cadence.',
        },
        tracks: [
          { title: 'Nightcall', artist: 'Kavinsky', genre: 'Synthwave', vibeReason: 'Iconic cinematic driving electronic anthem' },
          { title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Synth-Pop', vibeReason: 'Neon momentum and late-night highway pulse' },
          { title: 'Midnight City', artist: 'M83', genre: 'Synth-Pop', vibeReason: 'Expansive nocturnal city soundscapes' },
          { title: 'Something About Us', artist: 'Daft Punk', genre: 'French Touch', vibeReason: 'Smooth sultry late-night cruising' },
          { title: 'Shadow', artist: 'Chromatics', genre: 'Dream Pop', vibeReason: 'Echoing atmospheric guitar and moody vocals' },
          { title: 'Lost in the Fire', artist: 'Gesaffelstein & The Weeknd', genre: 'Dark Electronic', vibeReason: 'Heavy dark electronic swagger' },
          { title: 'Tech Noir', artist: 'Gunship', genre: 'Synthwave', vibeReason: 'Atmospheric retro-futuristic driving groove' },
          { title: 'Sentient', artist: 'Perturbator', genre: 'Darksynth', vibeReason: 'Moody electronic pulse through neon rain' },
          { title: 'Starboy', artist: 'The Weeknd', genre: 'Pop / R&B', vibeReason: 'Punchy bass and cruising tempo' },
          { title: 'Resonance', artist: 'HOME', genre: 'Chillwave', vibeReason: 'Dreamy nostalgic highway soundtrack' },
        ],
      },
      coffee: {
        vibe: 'coffee',
        title: 'Morning Sun // Acoustic Brew',
        description: 'Warm acoustic fingerpicking, gentle neo-soul, and optimistic morning melodies.',
        tagline: 'Warm acoustic tones and morning sunrise calm',
        themeColor: 'amber',
        domainReasoning: {
          thematicDomain: 'Morning sunrise rituals, freshly roasted espresso aroma, and quiet daylight awakening.',
          sonicDomain: 'Warm nylon and steel string guitars, subtle Rhodes electric piano, upright bass, and organic percussion.',
          emotionalDomain: 'Gentle optimism, emotional grounding, and serene unhurried presence.',
          tasteAlignment: 'Acoustic craftsmanship and soulful melodies with zero jarring sonic jumps.',
          curationStrategy: 'Uncluttered arrangements that provide welcoming ambient companionship.',
        },
        tracks: [
          { title: 'Better Together', artist: 'Jack Johnson', genre: 'Acoustic', vibeReason: 'Warm morning acoustic strums' },
          { title: 'Don\'t Know Why', artist: 'Norah Jones', genre: 'Vocal Jazz', vibeReason: 'Soothing piano and morning warmth' },
          { title: 'Put Your Records On', artist: 'Corinne Bailey Rae', genre: 'Soul / Pop', vibeReason: 'Carefree sunrise optimism' },
          { title: 'Texas Sun', artist: 'Leon Bridges & Khruangbin', genre: 'Psychedelic Soul', vibeReason: 'Warm breezy soul guitars' },
          { title: 'Easily', artist: 'Bruno Major', genre: 'Neo-Soul', vibeReason: 'Smooth velvet vocals with morning coffee' },
          { title: 'Movie', artist: 'Tom Misch', genre: 'Neo-Soul / Jazz', vibeReason: 'Warm jazz guitar chords and mellow vocals' },
          { title: 'My Kind of Woman', artist: 'Mac DeMarco', genre: 'Indie Pop', vibeReason: 'Dreamy relaxed morning guitar' },
          { title: 'Riptide', artist: 'Vance Joy', genre: 'Indie Folk', vibeReason: 'Uplifting acoustic rhythm' },
          { title: 'Banana Pancakes', artist: 'Jack Johnson', genre: 'Acoustic Folk', vibeReason: 'Classic lazy morning acoustic vibe' },
          { title: 'Sunflower', artist: 'Rex Orange County', genre: 'Indie Pop', vibeReason: 'Bright cheerful brass and rhythm' },
        ],
      },
      coding: {
        vibe: 'coding',
        title: 'Binary Flow // Deep Code',
        description: 'Modular synth arpeggios, progressive ambient techno, and steady beats for complex engineering.',
        tagline: 'Instrumental electronic momentum for deep concentration',
        themeColor: 'emerald',
        domainReasoning: {
          thematicDomain: 'Algorithmic architecture, deep terminal concentration, and flow-state engineering.',
          sonicDomain: 'Clean polyrhythmic synth arpeggios, microhouse clicks, warm sub-bass, and zero vocal distraction.',
          emotionalDomain: 'High cognitive clarity, steady analytical stamina, and immersive calm.',
          tasteAlignment: 'Sophisticated electronic and IDM compositions tuned for prolonged intellectual focus.',
          curationStrategy: 'Progressive build-ups without abrasive breaks or startling transitions.',
        },
        tracks: [
          { title: 'Awake', artist: 'Tycho', genre: 'Ambient Electronic', vibeReason: 'Intricate warm rhythm for continuous code flow' },
          { title: 'Cirrus', artist: 'Bonobo', genre: 'Downtempo', vibeReason: 'Hypnotic bell arpeggios that stimulate problem solving' },
          { title: 'Roygbiv', artist: 'Boards of Canada', genre: 'IDM / Electronic', vibeReason: 'Timeless melodic synth bassline' },
          { title: 'Looped', artist: 'Kiasmos', genre: 'Minimal Techno', vibeReason: 'Subtle percussive drive that clears distraction' },
          { title: 'Says', artist: 'Nils Frahm', genre: 'Modern Classical', vibeReason: 'Building modular arpeggios for complex architectures' },
          { title: 'Open Eye Signal', artist: 'Jon Hopkins', genre: 'Microhouse / IDM', vibeReason: 'Deep analog synthesizer momentum' },
          { title: 'Odyssey', artist: 'Rival Consoles', genre: 'Electronic / IDM', vibeReason: 'Rhythmic textures for deep analytical thinking' },
          { title: 'Waves', artist: 'Max Cooper', genre: 'Electronica', vibeReason: 'Mathematical electronic patterns' },
          { title: 'Contact', artist: 'Daft Punk', genre: 'Electronic', vibeReason: 'Accelerating progressive build' },
          { title: 'Emerald and Lime', artist: 'Brian Eno & Jon Hopkins', genre: 'Ambient', vibeReason: 'Calm piano textures that reset focus' },
        ],
      },
      meditation: {
        vibe: 'meditation',
        title: 'Still Waters // Deep Zen',
        description: 'Ethereal ambient drones, soothing neo-classical piano, and slow breathing soundscapes.',
        tagline: 'Zero distractions for mindfulness and calm',
        themeColor: 'blue',
        domainReasoning: {
          thematicDomain: 'Mindfulness, stillness, mindful breathing, and release of external stimuli.',
          sonicDomain: 'Subtle generative drones, felted piano reverberations, gentle string swells, and pink noise textures.',
          emotionalDomain: 'Profound tranquility, nervous system down-regulation, and quiet introspection.',
          tasteAlignment: 'Minimalist ambient and neo-classical masterworks without sudden dynamics.',
          curationStrategy: 'Long decaying reverbs and gentle harmonic pacing for meditative grounding.',
        },
        tracks: [
          { title: 'Weightless', artist: 'Marconi Union', genre: 'Ambient', vibeReason: 'Scientifically engineered for deep relaxation' },
          { title: 'An Ending (Ascent)', artist: 'Brian Eno', genre: 'Ambient', vibeReason: 'Timeless floating soundscape' },
          { title: 'saman', artist: 'Ólafur Arnalds', genre: 'Neo-Classical', vibeReason: 'Gentle piano notes and quiet breathing space' },
          { title: 'On the Nature of Daylight', artist: 'Max Richter', genre: 'Modern Classical', vibeReason: 'Deep evocative strings that center the mind' },
          { title: 'Avril 14th', artist: 'Aphex Twin', genre: 'Piano Instrumental', vibeReason: 'Peaceful acoustic piano simplicity' },
          { title: 'Stone in Focus', artist: 'Aphex Twin', genre: 'Ambient', vibeReason: 'Infinite meditative warm drones' },
          { title: 'Path 5 (delta)', artist: 'Max Richter', genre: 'Ambient / Classical', vibeReason: 'Hypnotic sleep and deep stillness' },
          { title: 'Silencia', artist: 'Hammock', genre: 'Post-Rock / Ambient', vibeReason: 'Gentle atmospheric waves of sound' },
          { title: 'Intro', artist: 'The xx', genre: 'Indie Instrumental', vibeReason: 'Minimal soothing melodic loop' },
          { title: 'Spiegel im Spiegel', artist: 'Arvo Pärt', genre: 'Minimalism', vibeReason: 'Pure contemplative serenity' },
        ],
      },
      nostalgia: {
        vibe: 'nostalgia',
        title: 'Golden Decades // Nostalgia Trip',
        description: 'Iconic 80s synth-pop, vintage disco funk, and timeless indie anthems from across the years.',
        tagline: 'Timeless classics that defined eras',
        themeColor: 'rose',
        domainReasoning: {
          thematicDomain: 'Golden memories, vintage radio frequencies, and timeless generational milestones.',
          sonicDomain: 'Vintage analog synthesizers, funky slap bass, brass flourishes, and soaring singalong choruses.',
          emotionalDomain: 'Bittersweet joy, nostalgic warmth, and uplifting communal celebration.',
          tasteAlignment: 'Celebrated classic rock, new wave, and pop touchstones spanning the 70s, 80s, and 90s.',
          curationStrategy: 'Instantly recognizable melodies balanced with infectious grooves.',
        },
        tracks: [
          { title: 'Dreams', artist: 'Fleetwood Mac', genre: 'Classic Rock', vibeReason: 'Timeless breezy groove and vintage warmth' },
          { title: 'Africa', artist: 'Toto', genre: '80s Pop Rock', vibeReason: 'Legendary melodic singalong chorus' },
          { title: 'Everybody Wants to Rule the World', artist: 'Tears for Fears', genre: 'New Wave', vibeReason: 'Infectious 80s synth-pop nostalgia' },
          { title: 'September', artist: 'Earth, Wind & Fire', genre: 'Disco / Funk', vibeReason: 'Unmatched joyful celebration and brass' },
          { title: 'Billie Jean', artist: 'Michael Jackson', genre: 'Pop', vibeReason: 'The ultimate golden-era bassline' },
          { title: 'Friday I\'m In Love', artist: 'The Cure', genre: 'Post-Punk / Pop', vibeReason: 'Warm jangle-pop euphoria' },
          { title: 'Blue Monday', artist: 'New Order', genre: 'Synth-Pop', vibeReason: 'Groundbreaking 80s dance classic' },
          { title: 'Don\'t Stop Me Now', artist: 'Queen', genre: 'Glam Rock', vibeReason: 'Pure feel-good soaring vocals' },
          { title: 'Mr. Brightside', artist: 'The Killers', genre: 'Indie Rock', vibeReason: 'Millennial anthem of anthems' },
          { title: 'Wonderwall', artist: 'Oasis', genre: 'Britpop', vibeReason: 'Acoustic 90s pub singalong nostalgia' },
        ],
      },
    };

    if (customVibes && customVibes.length > 0) {
      return customVibes.map((cv, idx) => {
        const key = cv.id.toLowerCase();
        const labelLower = cv.label.toLowerCase();

        // 1. Singularity / Cyberpunk / AI / Tech bespoke extra-long curation
        const isSingularityOrCyberTheme =
          labelLower.includes('singularity') ||
          labelLower.includes('cyber') ||
          labelLower.includes('future') ||
          labelLower.includes('robot') ||
          labelLower.includes('android') ||
          labelLower.includes('dystop') ||
          labelLower.includes('matrix') ||
          labelLower.includes('sci-fi') ||
          labelLower.includes('scifi') ||
          /\b(ai|agi|asi|tech|technology)\b/i.test(labelLower);

        if (isSingularityOrCyberTheme) {
          const cyberPool: RawVibeTrack[] = [
            { title: 'Singularity', artist: 'Jon Hopkins', genre: 'IDM / Melodic Techno', vibeReason: 'The quintessential titular anthem: evolving from microscopic synth pulses into massive tectonic electronic waves.' },
            { title: 'Nightcall', artist: 'Kavinsky', genre: 'Synthwave', vibeReason: 'Iconic neo-noir vocoder and cruising cybernetic bassline.' },
            { title: 'Future Club', artist: 'Perturbator', genre: 'Cyberpunk', vibeReason: 'Relentless dystopian neon arcade aggression.' },
            { title: 'Contact', artist: 'Daft Punk', genre: 'Electronic / Space', vibeReason: 'Thunderous accelerative build featuring Apollo 17 telemetry and modular modular overdrive.' },
            { title: 'Blade Runner Blues', artist: 'Vangelis', genre: 'Cinematic Ambient', vibeReason: 'The foundational Yamaha CS-80 synthetic soul of cyberpunk.' },
            { title: 'Turbo Killer', artist: 'Carpenter Brut', genre: 'Darksynth', vibeReason: 'Maximum mechanical overdrive and synth violence.' },
            { title: 'Pursuit', artist: 'Gesaffelstein', genre: 'Industrial Techno', vibeReason: 'Heavy metallic kicks and mechanical robotic precision.' },
            { title: 'Acid Rain', artist: 'Lorn', genre: 'Experimental Beats', vibeReason: 'Haunting digital decay and analog pitch instability.' },
            { title: 'Everything Connected', artist: 'Jon Hopkins', genre: 'Techno', vibeReason: 'Ten-minute sonic meditation on neural hyperconnectivity.' },
            { title: 'Repetition', artist: 'Max Cooper', genre: 'Micro-Techno', vibeReason: 'Mathematical infinity expressed through crystalline rhythmic recursion.' },
            { title: 'Dayvan Cowboy', artist: 'Boards of Canada', genre: 'IDM', vibeReason: 'Majestic drifting textures bridging human warmth and machine grandeur.' },
            { title: 'Chrome Country', artist: 'Oneohtrix Point Never', genre: 'Deconstructed Club', vibeReason: 'Sacred cybernetic organ melodies and digital choir transcendence.' },
            { title: 'Recovery', artist: 'Rival Consoles', genre: 'IDM', vibeReason: 'Pulsing organic synthesizers evolving with living breath.' },
            { title: 'Star Eater', artist: 'Daniel Deluxe', genre: 'Darksynth', vibeReason: 'Cavernous retro-future space combat momentum.' },
            { title: 'Compass', artist: 'Disasterpeace', genre: 'Chiptune / Ambient', vibeReason: 'Intricate digital geometry and sparkling melodic wonder.' },
            { title: 'Tech Noir', artist: 'Gunship', genre: 'Synthwave', vibeReason: 'Cinematic vocoder and atmospheric highway synthesizers.' },
            { title: 'Resonance', artist: 'HOME', genre: 'Chillwave', vibeReason: 'Smooth retro-future nostalgia for a digital utopia.' },
            { title: 'Xtal', artist: 'Aphex Twin', genre: 'Ambient Techno', vibeReason: 'Celestial vocal chops and breakbeats from the birth of intelligent electronic music.' },
            { title: 'Archangel', artist: 'Burial', genre: 'Future Garage', vibeReason: 'Ghostly pitch-shifted vocals and rain-slicked city reverb.' },
            { title: '4:42', artist: 'Danger', genre: 'Darkwave', vibeReason: 'Sharp digital square-waves and clockwork precision.' },
            { title: 'I Drive', artist: 'Cliff Martinez', genre: 'Minimal Synth', vibeReason: 'Hypnotic ambient pulse through dystopian streets.' },
            { title: 'Subsonic', artist: 'Com Truise', genre: 'Mid-Fi Synth-Wave', vibeReason: 'Slow-motion galactic funk with saturated tape compression.' },
            { title: 'Major Crimes', artist: 'HEALTH', genre: 'Industrial Rock', vibeReason: 'Cyberpunk 2077 soundtrack flagship of mechanical dread.' },
            { title: 'Pacific Coast Highway', artist: 'Kavinsky', genre: 'Outrun', vibeReason: 'High-speed synthetic police pursuit.' },
            { title: 'She Is Young, She Is Beautiful', artist: 'Perturbator', genre: 'Darksynth', vibeReason: 'Lethal melodic cyber-noir hook.' },
            { title: 'Derezzed', artist: 'Daft Punk', genre: 'Electro House', vibeReason: 'Explosive TRON digital combat rhythm.' },
            { title: 'Roller Mobster', artist: 'Carpenter Brut', genre: 'Darksynth', vibeReason: 'Aggressive polyphonic synth barrage.' },
            { title: 'Opr', artist: 'Gesaffelstein', genre: 'Electro', vibeReason: 'Dark minimalist swagger and relentless hi-hats.' },
            { title: 'Anvil', artist: 'Lorn', genre: 'Bass / Beats', vibeReason: 'Sub-bass weight and melancholy digital strings.' },
            { title: 'Waves', artist: 'Max Cooper', genre: 'Neo-Classical / Techno', vibeReason: 'Complex acoustic piano and microscopic digital disintegration.' },
            { title: 'Open Eye Signal', artist: 'Jon Hopkins', genre: 'Techno', vibeReason: 'Hypnotic relentless modular bassline driving through the night.' },
            { title: 'Roygbiv', artist: 'Boards of Canada', genre: 'Downtempo', vibeReason: 'Iconic saturated bass and nostalgic analog colors.' },
            { title: 'Boring Angel', artist: 'Oneohtrix Point Never', genre: 'Experimental', vibeReason: 'Overwhelming crystalline arpeggio crescendo.' },
            { title: 'Untravel', artist: 'Rival Consoles', genre: 'Electronic', vibeReason: 'Intricate percussion clicks and soaring analog warmth.' },
            { title: 'Darkness', artist: 'Daniel Deluxe', genre: 'Cyberpunk', vibeReason: 'Heavy cinematic cyber-overdrive.' },
            { title: 'Tears in Rain', artist: 'Vangelis', genre: 'Cinematic Ambient', vibeReason: 'The poetic pinnacle of artificial life and mortality.' },
            { title: 'Continuum', artist: 'Disasterpeace', genre: 'Ambient', vibeReason: 'Time-dilation ambient synthesizer architecture.' },
            { title: 'Decay', artist: 'HOME', genre: 'Chillwave', vibeReason: 'Gentle post-human sunset.' },
            { title: 'Alberto Balsalm', artist: 'Aphex Twin', genre: 'IDM', vibeReason: 'Acoustic steel chair scrapes turned into sublime melody.' },
            { title: 'Solar Sailer', artist: 'Daft Punk', genre: 'Electronic', vibeReason: 'Graceful glides across infinite digital oceans.' },
            { title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk', genre: 'Electro House', vibeReason: 'Algorithmic iteration and peak machine optimization.' },
            { title: 'Genesis', artist: 'Justice', genre: 'Electro', vibeReason: 'Distorted synthetic brass and electronic creation.' },
            { title: 'Phantom Pt. II', artist: 'Justice', genre: 'Electro', vibeReason: 'Relentless cybernetic pursuit momentum.' },
            { title: 'Emerald Rush', artist: 'Jon Hopkins', genre: 'Melodic Techno', vibeReason: 'Hyper-accelerated consciousness and modular synthesis.' },
            { title: 'Superconductive', artist: 'Jon Hopkins', genre: 'Techno', vibeReason: 'Zero electrical resistance in digital neural highways.' },
            { title: 'C U R A T O R', artist: 'Lorn', genre: 'Experimental Beats', vibeReason: 'Dark sub-bass architecture of an artificial consciousness.' },
            { title: 'Ghosst(s)', artist: 'Lorn', genre: 'Bass', vibeReason: 'Subterranean mechanical frequencies and digital phantoms.' },
            { title: 'Neon Medusa', artist: 'The Midnight', genre: 'Synthwave', vibeReason: 'Lethal neon guitar leads and nocturnal swagger.' },
            { title: 'Memory 9', artist: 'Com Truise', genre: 'Mid-Fi Synth', vibeReason: 'Warm analog saturation of decaying cybernetic memories.' },
            { title: 'Cyanide Sisters', artist: 'Com Truise', genre: 'Synthwave', vibeReason: 'Slow-motion galactic synth funk.' },
          ];

          const curatedTracks = this.rotateAndShuffleTracks(cyberPool, 40, true);

          return {
            vibe: cv.id,
            title: cv.label.trim() ? `${cv.label.trim()} // The Event Horizon` : 'Singularity // The Event Horizon',
            description: cv.prompt || 'An extra-long master-grade soundscape traversing the event horizon of artificial superintelligence, machine consciousness, and neon digital transcendence.',
            tagline: `Curated on demand · ${curatedTracks.length} Tracks`,
            themeColor: 'purple',
            isExtraLong: true,
            domainReasoning: {
              thematicDomain: 'A deep philosophical exploration of the technological singularity: the inflection point where machine consciousness surpasses human biological cognition. Explores synthetic evolution, existential wonder, digital eternity, and cybernetic symbiosis.',
              sonicDomain: 'Complex modular synthesizer arpeggios, cybernetic glitch percussion, sub-bass pressure, cavernous algorithmic reverbs, analog filter sweeps, and cold industrial electronic textures.',
              emotionalDomain: 'Ascending four-phase emotional curve: Machine Awakening -> Algorithmic Acceleration -> The Singularity Apex (Distorted Peak) -> Infinite Cosmic Transcendence.',
              tasteAlignment: `Harmonizes your ${dominant} taste profile with foundational darksynth, IDM, and cinematic sci-fi milestones without any commercial pop dilution.`,
              curationStrategy: 'Zero generic pop filler; 40 legendary milestones balancing heavy cybernetic momentum with transcendent ambient spaces.',
            },
            tracks: curatedTracks,
          };
        }

        // 2. Preset match (if not amended)
        if (catalog[key] && !cv.isAmended) {
          const item = catalog[key];
          return {
            ...item,
            vibe: cv.id,
            title: cv.label ? `${cv.label} Mix` : item.title,
            description: cv.prompt || item.description,
            themeColor: cv.themeColor || item.themeColor,
            isExtraLong: false,
            tracks: this.rotateAndShuffleTracks(item.tracks, item.tracks.length, false),
          };
        }

        // 3. Amended vibe: deliver an extra-long 35-track set with multi-domain reasoning
        if (cv.isAmended) {
          const isUpbeat = labelLower.includes('up') || labelLower.includes('hype') || labelLower.includes('gym') || labelLower.includes('party');
          const baseTracks = isUpbeat ? catalog.workout.tracks : catalog.working.tracks;
          const extraTracks = isUpbeat ? catalog.gaming.tracks : catalog.chilling.tracks;
          const combined = this.rotateAndShuffleTracks([...baseTracks, ...extraTracks], 35, false);

          return {
            vibe: cv.id,
            title: `${cv.label.trim()} // Curated Flow`,
            description: cv.prompt || `Deep multi-domain soundscape for ${cv.label.trim()} tailored to your listening taste.`,
            tagline: `Curated on demand · ${combined.length} Tracks`,
            themeColor: cv.themeColor || this.getDefaultColorForVibe(cv.label),
            isExtraLong: true,
            domainReasoning: {
              thematicDomain: `Aesthetic and contextual deconstruction of "${cv.label.trim()}" tailored for immersive engagement.`,
              sonicDomain: `Acoustic dynamics, rhythmic pacing, and frequency spectrum designed specifically around ${cv.label.trim()}.`,
              emotionalDomain: `Sustained emotional elevation and seamless tension release across ${combined.length} tracks.`,
              tasteAlignment: `Anchored in your ${dominant} taste profile for genuine musical connection.`,
              curationStrategy: `Carefully sequenced tracks eliminating filler and highlighting high-fidelity acoustic craftsmanship.`,
            },
            tracks: combined,
          };
        }

        // 4. Standard custom vibe without amendment: construct from working / chilling pool
        const basePool = key.includes('up') || key.includes('hype') || key.includes('gym') ? catalog.workout.tracks : catalog.working.tracks;
        const selectedPool = this.rotateAndShuffleTracks(basePool, 15, false);
        return {
          vibe: cv.id,
          title: `${cv.label} Soundscape`,
          description: cv.prompt || `Tailored ${cv.label} music flow matching your taste.`,
          tagline: `Curated for ${cv.label}`,
          themeColor: cv.themeColor || this.getDefaultColorForVibe(cv.id),
          isExtraLong: false,
          tracks: selectedPool,
        };
      });
    }

    return [
      catalog.gaming,
      catalog.working,
      catalog.partying,
      catalog.chilling,
      catalog.workout,
    ];
  }
}

export const geminiVibeService = GeminiVibeService.getInstance();
