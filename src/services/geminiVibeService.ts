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

export class GeminiVibeService {
  private static instance: GeminiVibeService;
  private currentKeyIndex = 0;
  private readonly MODEL_NAME = 'gemini-3.8-flash';

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
   * Curates 4-5 daily vibe playlists using Gemini 3.8 Flash grounded with Google Search.
   */
  public async generateDailyVibePlaylists(
    tasteProfile: UserTasteProfile,
    dateString: string
  ): Promise<GeminiVibeResult> {
    const prompt = this.buildPrompt(tasteProfile, dateString);

    let attempts = 0;
    const maxAttempts = GEMINI_API_KEYS.length;

    while (attempts < maxAttempts) {
      const apiKey = this.getActiveKey();
      try {
        console.log(`[GeminiVibeService] Requesting vibe playlists via ${this.MODEL_NAME} (Key index ${this.currentKeyIndex})...`);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${apiKey}`;

        const payload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          tools: [
            {
              google_search: {},
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
          },
        };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000), // 30s timeout
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[GeminiVibeService] Key index ${this.currentKeyIndex} failed (${res.status}):`, errText);
          // If rate limit (429) or forbidden (403), rotate and retry
          this.rotateKey();
          attempts++;
          continue;
        }

        const data = await res.json();
        const candidateText =
          data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('\n') || '';

        const parsed = this.extractJsonPlaylists(candidateText);
        if (parsed && parsed.length >= 4) {
          console.log(`[GeminiVibeService] Successfully curated ${parsed.length} vibe playlists with ${this.MODEL_NAME}`);
          return {
            playlists: parsed,
            modelUsed: this.MODEL_NAME,
            fromFallback: false,
          };
        } else {
          console.warn('[GeminiVibeService] Candidate text did not contain at least 4 valid playlists. Raw text preview:', candidateText.slice(0, 300));
          this.rotateKey();
          attempts++;
        }
      } catch (err: any) {
        console.warn(`[GeminiVibeService] Network or execution error on key index ${this.currentKeyIndex}:`, err?.message || err);
        this.rotateKey();
        attempts++;
      }
    }

    // If all keys or attempts exhausted, generate through high-fidelity algorithmic fallback
    console.warn('[GeminiVibeService] All Gemini attempts exhausted. Using intelligent algorithmic fallback.');
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
2. EACH PLAYLIST MUST HAVE 10 TO 14 TRACKS.
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
        ],
      },
    ];
  }
}

export const geminiVibeService = GeminiVibeService.getInstance();
