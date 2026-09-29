import { UserTasteProfile, VibeCategory, UserVibeConfig } from '../types/vibes';

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
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

export class GeminiVibeService {
  private static instance: GeminiVibeService;
  private currentKeyIndex = 0;
  private readonly DEFAULT_MODEL = 'gemini-3.8-flash';

  public static getInstance(): GeminiVibeService {
    if (!GeminiVibeService.instance) {
      GeminiVibeService.instance = new GeminiVibeService();
    }
    return GeminiVibeService.instance;
  }

  /**
   * Returns current active API key.
   */
  private getActiveKey(): string {
    return GEMINI_API_KEYS[this.currentKeyIndex % GEMINI_API_KEYS.length];
  }

  /**
   * Advances to next key in pool upon rate limit or failure.
   */
  private rotateKey(): string {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    console.log(`[GeminiVibeService] Rotated to API key index ${this.currentKeyIndex}`);
    return this.getActiveKey();
  }

  /**
   * Curates 4-5 daily vibe playlists using Gemini Flash grounded with Google Search,
   * with automatic multi-model failover (3.8 Flash -> 3 Flash Preview -> 3.7 Flash) and key rotation.
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
            signal: AbortSignal.timeout(90000), // 90s timeout for 20-30 track playlists
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[GeminiVibeService] ${model} on Key index ${this.currentKeyIndex} failed (${res.status}):`, errText);

            // If search tool quota failed (429 or 400), disable search tool and retry this key immediately
            if (useSearch && (res.status === 429 || res.status === 400)) {
              console.log('[GeminiVibeService] Search tool quota exhausted or unsupported; disabling search tool and retrying directly...');
              useSearch = false;
              continue;
            }

            // On 503 (high demand) or 429 (rate limit), rotate to next key in pool
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

    // If all models or attempts exhausted, generate through high-fidelity algorithmic fallback
    console.warn('[GeminiVibeService] All Gemini models and keys exhausted. Using intelligent algorithmic fallback.');
    return {
      playlists: this.generateAlgorithmicFallback(tasteProfile, customVibes),
      modelUsed: 'Algorithmic Fallback Engine',
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

    const themesList = vibes
      .map((v, i) => `${i + 1}. "${v.id}" ("${v.label}"): ${v.prompt}`)
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
   Even for activity-based vibes (e.g. "Gaming", "Workout", "Coding", "Late Night"), select songs that match the specific genres, subgenres, and styles the user actually loves. For example:
   - If the user loves Indie Rock & Alternative, curate high-energy indie rock / post-punk tracks for high-tempo vibes—do NOT give them generic mainstream EDM or pop club hits.
   - If the user loves Electronic & House, curate melodic techno and French touch rather than acoustic pop.
   Blend tracks by their favorite artists (or their contemporaries and collaborators) with fresh, acclaimed discoveries that naturally expand their taste within those sonic worlds.
2. ZERO UNRELATED COMMERCIAL FILLER:
   Do NOT output generic top-40 songs that disregard the user's listening profile. Every recommendation must feel custom-tailored by a boutique DJ who knows this listener intimately.`
      : `USER PROFILE:
- New listener (cold start, no listening history yet).
- Curate each custom vibe based strictly on the user's specified title, mood, and musical direction, selecting critically acclaimed, authentic, high-quality songs that capture that vibe.`;

    return `You are Dotify's master AI music curator and DJ.
Today is ${dateString}.

The user has explicitly defined the following ${vibes.length} custom daily vibes/themes for their music rotation:
${themesList}

${tasteSection}

PLAYLIST REQUIREMENTS:
1. 20 TO 30 TRACKS PER PLAYLIST:
   Every playlist MUST have between 20 and 30 tracks.
2. ACCURATE REAL SONGS:
   Provide real, released songs with exact track title and artist name.
3. AUTHENTIC VIBE REASONS:
   For each track, write a concise "vibeReason" explaining why this track fits this theme and connects to the user's musical taste.
4. STRICT VALID JSON ONLY (no markdown text or commentary outside the JSON block).

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
      "tracks": [
        {
          "title": "Track Title",
          "artist": "Artist Name",
          "genre": "Genre",
          "vibeReason": "Why this track fits this theme and user taste"
        }
      ]
    }`
  )
  .join(',\n')}
  ]
}

Now curate the playlists and return the JSON.`;
  }

  /**
   * Extracts and validates the JSON playlists payload from the model's text response.
   */
  private extractJsonPlaylists(text: string, customVibes?: UserVibeConfig[]): RawVibePlaylist[] | null {
    if (!text || typeof text !== 'string') return null;

    try {
      // Look for code block ```json ... ```
      let jsonStr = text;
      const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (blockMatch && blockMatch[1]) {
        jsonStr = blockMatch[1];
      } else {
        // Find outer curly braces
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = text.substring(firstBrace, lastBrace + 1);
        }
      }

      const parsed = JSON.parse(jsonStr);
      const list = parsed.playlists || parsed;
      if (!Array.isArray(list)) return null;

      const validVibes: string[] =
        customVibes && customVibes.length > 0
          ? customVibes.map((v) => v.id.toLowerCase())
          : ['gaming', 'working', 'partying', 'chilling', 'workout'];
      const validated: RawVibePlaylist[] = [];

      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const vibe = String(item.vibe || '').toLowerCase();
        if (!validVibes.includes(vibe)) continue;

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
          const matchingVibe = customVibes?.find((v) => v.id.toLowerCase() === vibe);
          const fallbackLabel = matchingVibe?.label || (vibe.charAt(0).toUpperCase() + vibe.slice(1));
          const allowedColors = ['purple', 'emerald', 'blue', 'amber', 'rose'];
          const themeColor = allowedColors.includes(item.themeColor)
            ? item.themeColor
            : (matchingVibe?.themeColor && allowedColors.includes(matchingVibe.themeColor)
                ? matchingVibe.themeColor
                : this.getDefaultColorForVibe(vibe));

          validated.push({
            vibe,
            title: String(item.title || `${fallbackLabel} Mix`).trim(),
            description: String(
              item.description || matchingVibe?.prompt || `Curated ${fallbackLabel} playlist tailored to your listening taste.`
            ).trim(),
            tagline: String(item.tagline || `Curated for ${fallbackLabel}`).trim(),
            themeColor,
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
    if (v.includes('work') || v.includes('cod') || v.includes('study')) return 'emerald';
    if (v.includes('party') || v.includes('dance') || v.includes('nostal')) return 'rose';
    if (v.includes('chill') || v.includes('meditat') || v.includes('sleep')) return 'blue';
    if (v.includes('workout') || v.includes('gym') || v.includes('run') || v.includes('coffee')) return 'amber';
    return 'purple';
  }

  /**
   * Resilient, high-fidelity algorithmic fallback playlists.
   */
  public generateAlgorithmicFallback(
    tasteProfile: UserTasteProfile,
    customVibes?: UserVibeConfig[]
  ): RawVibePlaylist[] {
    const dominant = tasteProfile.dominantGenre;

    const catalog: Record<string, RawVibePlaylist> = {
      gaming: {
        vibe: 'gaming',
        title: 'Cyber Circuit // Game Mode',
        description: 'Driving synthwave, high-BPM electronic adrenaline, and dark electro for intense flow state.',
        tagline: `Tuned to your ${dominant} taste + modern synthwave classics`,
        themeColor: 'purple',
        tracks: [
          { title: 'Nightcall', artist: 'Kavinsky', genre: 'Synthwave', vibeReason: 'Iconic cinematic driving electronic anthem' },
          { title: 'Turbo Killer', artist: 'Carpenter Brut', genre: 'Darksynth', vibeReason: 'Maximum adrenaline boss-fight energy' },
          { title: 'Get Lucky', artist: 'Daft Punk', genre: 'Nu-Disco', vibeReason: 'Infectious rhythm to keep you in the zone' },
          { title: 'Midnight City', artist: 'M83', genre: 'Synth-Pop', vibeReason: 'Uplifting stadium synthwave melody' },
          { title: 'Resonance', artist: 'HOME', genre: 'Chillwave', vibeReason: 'Smooth retro-future focus track' },
          { title: 'Starboy', artist: 'The Weeknd', genre: 'Synth-Pop', vibeReason: 'Punchy bassline and modern sleek production' },
          { title: 'Tech Noir', artist: 'Gunship', genre: 'Synthwave', vibeReason: 'Rich atmospheric soundscapes' },
          { title: 'Genesis', artist: 'Justice', genre: 'Electro House', vibeReason: 'Crunchy distorted bass and rhythmic drive' },
          { title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Synth-Pop', vibeReason: 'High tempo neon synth momentum' },
          { title: 'Voyager', artist: 'Daft Punk', genre: 'French Touch', vibeReason: 'Smooth groove for long gaming sessions' },
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
        ],
      },
      working: {
        vibe: 'working',
        title: 'Deep Flow // Studio Focus',
        description: 'Instrumental chillhop, ambient lo-fi textures, and melodic soundscapes for uninterrupted concentration.',
        tagline: 'Ambient calm and productivity rhythms',
        themeColor: 'emerald',
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
        tracks: [
          { title: 'Sunset Lover', artist: 'Petit Biscuit', genre: 'Chill Electronic', vibeReason: 'Warm breezy sunset chords' },
          { title: 'Banana Pancakes', artist: 'Jack Johnson', genre: 'Acoustic', vibeReason: 'Gentle acoustic warmth and easy vibes' },
          { title: 'Location', artist: 'Khalid', genre: 'R&B / Soul', vibeReason: 'Smooth mellow groove for late afternoon relaxing' },
          { title: 'Put Your Records On', artist: 'Corinne Bailey Rae', genre: 'Soul / Pop', vibeReason: 'Carefree, uplifting comfort music' },
          { title: 'Sunflower', artist: 'Post Malone & Swae Lee', genre: 'Chill Melodic Pop', vibeReason: 'Effortless melodic glide' },
          { title: 'San Luis', artist: 'Gregory Alan Isakov', genre: 'Indie Folk', vibeReason: 'Whispering fingerpicked guitar and stillness' },
          { title: 'Electric Feel (Acoustic)', artist: 'MGMT', genre: 'Indie', vibeReason: 'Laid-back acoustic reimagining' },
          { title: 'Beyond', artist: 'Leon Bridges', genre: 'Soul', vibeReason: 'Warm vintage soul ballads' },
          { title: 'Yellow', artist: 'Coldplay', genre: 'Alternative Rock', vibeReason: 'Emotional nostalgic comfort' },
          { title: 'Lost in the Light', artist: 'Bahamas', genre: 'Chill Rock', vibeReason: 'Soulful groove with spacious guitar' },
          { title: 'Come Away With Me', artist: 'Norah Jones', genre: 'Vocal Jazz / Acoustic', vibeReason: 'Velvet vocals and soothing acoustic guitar' },
          { title: 'Chamber of Reflection', artist: 'Mac DeMarco', genre: 'Indie Pop', vibeReason: 'Dreamy vintage synthesizer chords' },
          { title: 'White Ferrari', artist: 'Frank Ocean', genre: 'Alternative R&B', vibeReason: 'Intimate poetic reflection and soft acoustic ambiance' },
          { title: 'Show Me How', artist: 'Men I Trust', genre: 'Dream Pop', vibeReason: 'Gentle bassline and ethereal vocals' },
          { title: 'Riptide', artist: 'Vance Joy', genre: 'Indie Folk', vibeReason: 'Breezy ukulele strums and sunny indie vibes' },
          { title: 'The Night We Met', artist: 'Lord Huron', genre: 'Indie Folk', vibeReason: 'Haunting atmospheric ballad' },
          { title: 'ocean eyes', artist: 'Billie Eilish', genre: 'Alt-Pop', vibeReason: 'Airy vocal harmonies and delicate texture' },
          { title: 'Easily', artist: 'Bruno Major', genre: 'Neo-Soul', vibeReason: 'Velvety guitar chords and smooth vocal delivery' },
          { title: 'Pretty Girl', artist: 'Clairo', genre: 'Bedroom Pop', vibeReason: 'Charming lo-fi keys and sweet melody' },
          { title: 'Apocalypse', artist: 'Cigarettes After Sex', genre: 'Slowcore / Ambient Pop', vibeReason: 'Hypnotic cinematic romantic haze' },
        ],
      },
      workout: {
        vibe: 'workout',
        title: 'Pure Beast // High Octane',
        description: 'Heavy basslines, aggressive rock riffs, and motivating drops to push your physical limits.',
        tagline: 'Adrenaline and maximum endurance beats',
        themeColor: 'amber',
        tracks: [
          { title: 'Till I Collapse', artist: 'Eminem', genre: 'Hip-Hop', vibeReason: 'The ultimate motivational endurance anthem' },
          { title: 'Can\'t Be Touched', artist: 'Roy Jones Jr.', genre: 'Hip-Hop', vibeReason: 'Heavy battle-ready motivation' },
          { title: 'Bangarang', artist: 'Skrillex', genre: 'Dubstep', vibeReason: 'Explosive high-BPM energy boosts' },
          { title: 'Enter Sandman', artist: 'Metallica', genre: 'Heavy Metal', vibeReason: 'Driving heavy guitar riffs' },
          { title: 'Power', artist: 'Kanye West', genre: 'Hip-Hop', vibeReason: 'Triumphant martial rhythm' },
          { title: 'Run Boy Run', artist: 'Woodkid', genre: 'Cinematic Drums', vibeReason: 'Thunderous drums for sprint intervals' },
          { title: 'Animals', artist: 'Martin Garrix', genre: 'EDM', vibeReason: 'Relentless club drop momentum' },
          { title: 'Seven Nation Army (Glitch Mob Remix)', artist: 'The White Stripes', genre: 'Electronic Rock', vibeReason: 'Heavy bass rework of a classic' },
          { title: 'Remember the Name', artist: 'Fort Minor', genre: 'Hip-Hop', vibeReason: 'Classic determination and focus' },
          { title: 'Turn Down for What', artist: 'DJ Snake & Lil Jon', genre: 'Trap', vibeReason: 'Explosive drop to power through final reps' },
          { title: 'Eye of the Tiger', artist: 'Survivor', genre: 'Hard Rock', vibeReason: 'The quintessential workout driving rhythm' },
          { title: 'X Gon\' Give It To Ya', artist: 'DMX', genre: 'Hardcore Hip-Hop', vibeReason: 'Raw aggressive energy for heavy lifts' },
          { title: 'Thunderstruck', artist: 'AC/DC', genre: 'Hard Rock', vibeReason: 'Electrifying guitar intro that surges heart rate' },
          { title: 'In The End', artist: 'Linkin Park', genre: 'Nu-Metal', vibeReason: 'Powerful chorus and cathartic release' },
          { title: 'HUMBLE.', artist: 'Kendrick Lamar', genre: 'Hip-Hop', vibeReason: 'Hard-hitting minimalist piano bassline' },
          { title: 'Firestarter', artist: 'The Prodigy', genre: 'Big Beat / Breakbeat', vibeReason: 'Wild frenetic tempo for high-intensity intervals' },
          { title: 'Killing In the Name', artist: 'Rage Against the Machine', genre: 'Rap Metal', vibeReason: 'Pure explosive defiance and adrenaline' },
          { title: 'Fight Back', artist: 'NEFFEX', genre: 'Electronic Rock', vibeReason: 'Relentless drive to push past fatigue' },
          { title: 'Galvanize', artist: 'The Chemical Brothers', genre: 'Electronic / Big Beat', vibeReason: 'Exotic driving strings and urgent rhythm' },
          { title: 'Purple Lamborghini', artist: 'Skrillex & Rick Ross', genre: 'Trap / Dubstep', vibeReason: 'Massive sub-bass and heavy rap swagger' },
        ],
      },
      nightdrive: {
        vibe: 'nightdrive',
        title: 'Neon Horizon // Night Drive',
        description: 'Atmospheric synth-pop, darkwave pulses, and midnight cruising rhythms under street lamps.',
        tagline: 'Moody highway soundscapes and neon synthwave',
        themeColor: 'purple',
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
      return customVibes.map((cv) => {
        const key = cv.id.toLowerCase();
        if (catalog[key]) {
          const item = catalog[key];
          return {
            ...item,
            vibe: cv.id,
            title: cv.label ? `${cv.label} Mix` : item.title,
            description: cv.prompt || item.description,
            themeColor: cv.themeColor || item.themeColor,
          };
        }

        // Custom vibe: construct from working / chilling pool
        const basePool = key.includes('up') || key.includes('hype') || key.includes('gym') ? catalog.workout.tracks : catalog.working.tracks;
        return {
          vibe: cv.id,
          title: `${cv.label} Soundscape`,
          description: cv.prompt || `Tailored ${cv.label} music flow matching your taste.`,
          tagline: `Curated for ${cv.label}`,
          themeColor: cv.themeColor || this.getDefaultColorForVibe(cv.id),
          tracks: basePool.slice(0, 15),
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
