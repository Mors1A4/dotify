import { UserTasteProfile, VibeCategory } from '../types/vibes';

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
    dateString: string
  ): Promise<GeminiVibeResult> {
    const prompt = this.buildPrompt(tasteProfile, dateString);
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

          const parsed = this.extractJsonPlaylists(candidateText);
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
      playlists: this.generateAlgorithmicFallback(tasteProfile),
      modelUsed: 'Algorithmic Fallback Engine',
      fromFallback: true,
    };
  }

  private buildPrompt(tasteProfile: UserTasteProfile, dateString: string): string {
    const genreSummary = tasteProfile.topGenreGroups
      .slice(0, 4)
      .map((g) => `${g.group} (${g.percentage}% affinity, subgenres: ${g.topSubgenres.join(', ') || 'various'})`)
      .join('\n- ');

    const topArtists = tasteProfile.topArtists.slice(0, 6).map((a) => a.name).join(', ') || 'Daft Punk, The Weeknd, Arctic Monkeys';
    const topTracks = tasteProfile.topTracks.slice(0, 5).map((t) => `"${t.title}" by ${t.artist}`).join(', ') || 'Popular hits';

    return `You are Dotify's master AI music curator and DJ.
Today is ${dateString}.

Your task is to curate 4 to 5 distinct daily music playlists tailored for the user, set for specific vibes:
1. "gaming" - High focus, high adrenaline, synthwave, driving beats, dynamic flow state, epic electronic/rock.
2. "working" - Deep focus, study, lo-fi, melodic techno, ambient, chill instrumental, smooth productivity beats.
3. "partying" - High energy bangers, dance, upbeat hip-hop, club anthems, crowd-pleasers, vibrant rhythm.
4. "chilling" - Laid back, sunset vibes, acoustic, smooth R&B, relaxing indie, mellow downtime.
5. "workout" - Cardio, gym motivation, heavy bass, powerful drops, high BPM rock or electronic hype.

USER'S LISTENING HISTORY & TASTE PROFILE:
- Dominant Genre: ${tasteProfile.dominantGenre}
- Macro Genre Distribution:
- ${genreSummary}
- User's Top Artists: ${topArtists}
- Recent Favorite Songs: ${topTracks}

CRITICAL CURATION INSTRUCTIONS:
1. CURATED BASED ON TASTE, BUT NOT SOLELY FAMILIAR SONGS:
   Each playlist MUST blend tracks inspired by the user's genre tastes with FRESH, ACCLAIMED songs found via your Google Search tool. Search for real songs, real artists, and trending or classic gems. DO NOT solely regurgitate the user's past tracks.
2. EACH PLAYLIST MUST HAVE 20 TO 30 TRACKS.
3. PROVIDE REAL, ACCURATE TRACKS (exact song title and exact artist name).
4. RETURN STRICTLY VALID JSON ONLY, with NO extra conversational text, markdown preamble, or explanation outside the JSON block.

JSON OUTPUT SCHEMA:
{
  "playlists": [
    {
      "vibe": "gaming",
      "title": "Creative Playlist Name",
      "description": "Engaging 1-2 sentence description of the vibe and soundscape.",
      "tagline": "Based on your Electronic affinity + fresh discoveries",
      "themeColor": "purple",
      "tracks": [
        {
          "title": "Track Title",
          "artist": "Artist Name",
          "genre": "Genre",
          "vibeReason": "Why this track fits this vibe today"
        }
      ]
    },
    {
      "vibe": "working",
      "title": "Creative Playlist Name",
      "description": "Engaging description...",
      "tagline": "Deep focus beats matching your Chill & Lo-Fi taste",
      "themeColor": "emerald",
      "tracks": [ ... ]
    },
    {
      "vibe": "partying",
      "title": "Creative Playlist Name",
      "description": "Engaging description...",
      "tagline": "Weekend energy with fresh hits",
      "themeColor": "rose",
      "tracks": [ ... ]
    },
    {
      "vibe": "chilling",
      "title": "Creative Playlist Name",
      "description": "Engaging description...",
      "tagline": "Relaxed acoustic & mellow rhythms",
      "themeColor": "blue",
      "tracks": [ ... ]
    },
    {
      "vibe": "workout",
      "title": "Creative Playlist Name",
      "description": "Engaging description...",
      "tagline": "High octane momentum",
      "themeColor": "amber",
      "tracks": [ ... ]
    }
  ]
}

Theme colors: use "purple" for gaming, "emerald" for working, "rose" for partying, "blue" for chilling, "amber" for workout.
Now curate the playlists and return the JSON.`;
  }

  /**
   * Extracts and validates the JSON playlists payload from the model's text response.
   */
  private extractJsonPlaylists(text: string): RawVibePlaylist[] | null {
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

      const validVibes: VibeCategory[] = ['gaming', 'working', 'partying', 'chilling', 'workout'];
      const validated: RawVibePlaylist[] = [];

      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const vibe = String(item.vibe || '').toLowerCase() as VibeCategory;
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
          validated.push({
            vibe,
            title: String(item.title || `${vibe.charAt(0).toUpperCase() + vibe.slice(1)} Mix`).trim(),
            description: String(item.description || `Curated ${vibe} playlist tailored to your listening taste.`).trim(),
            tagline: String(item.tagline || `Curated with Gemini 3.8 Flash`).trim(),
            themeColor: ['purple', 'emerald', 'blue', 'amber', 'rose'].includes(item.themeColor)
              ? item.themeColor
              : this.getDefaultColorForVibe(vibe),
            tracks,
          });
        }
      }

      return validated.length >= 4 ? validated : null;
    } catch (err) {
      console.debug('[GeminiVibeService] JSON parse error:', err);
      return null;
    }
  }

  private getDefaultColorForVibe(vibe: VibeCategory): 'purple' | 'emerald' | 'blue' | 'amber' | 'rose' {
    switch (vibe) {
      case 'gaming':
        return 'purple';
      case 'working':
        return 'emerald';
      case 'partying':
        return 'rose';
      case 'chilling':
        return 'blue';
      case 'workout':
        return 'amber';
      default:
        return 'purple';
    }
  }

  /**
   * Resilient, high-fidelity algorithmic fallback playlists.
   */
  public generateAlgorithmicFallback(tasteProfile: UserTasteProfile): RawVibePlaylist[] {
    const dominant = tasteProfile.dominantGenre;

    return [
      {
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
      {
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
      {
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
      {
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
      {
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
    ];
  }
}

export const geminiVibeService = GeminiVibeService.getInstance();
