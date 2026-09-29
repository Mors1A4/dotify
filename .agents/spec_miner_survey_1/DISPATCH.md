# Dispatch Task: Spec Miner Survey 1 (APIs & P2P Streaming Engine)
Investigate exact API specifications, endpoints, parameters, and P2P streaming mechanisms for dotify.

## 2026-09-18T08:01:44Z
Investigate, test, and document the exact API specifications, protocols, data schemas, and streaming endpoints for all four audio sources required by dotify:
1. Audius API:
   - Discovery node selection/fallback mechanism
   - Trending tracks endpoint (/v1/tracks/trending with app_name parameter)
   - Search endpoint (/v1/tracks/search)
   - Genre listing & filtering
   - Direct audio stream endpoint (/v1/tracks/{id}/stream)
   - Track metadata model (title, artist, artwork, duration, id)
2. Internet Archive (archive.org) API:
   - Advanced search API (/advancedsearch.php) parameters, query syntax for audio/music/live concerts (e.g. mediatype:audio, collection:etree)
   - Item metadata API (/metadata/{identifier})
   - Audio file extraction (identifying MP3 files, titles, track numbers)
   - Direct streaming URL construction (https://archive.org/download/{identifier}/{file})
3. Radio-Browser API:
   - Server discovery / DNS lookup / reliable base URLs (e.g. de1.api.radio-browser.info, at1.api.radio-browser.info)
   - Station search API (/json/stations/search with name, tag, country, limit)
   - Top clicked / trending stations (/json/stations/topclick)
   - Station data schema (name, url_resolved, favicon, tags, country, bitrate, codec)
4. WebTorrent / P2P Torrent Streaming Engine:
   - Browser WebTorrent client architecture (webtorrent / parse-torrent)
   - WebRTC tracker list (wss://tracker.openwebtorrent.com, wss://tracker.btorrent.xyz, etc.)
   - Magnet URI parsing & .torrent file upload parsing
   - Torrent inspection: extracting file tree and filtering audio files (.mp3, .flac, .ogg, .wav, .m4a, .aac)
   - Sequential streaming mechanism without full download (streaming via HTML5 Audio element / ServiceWorker HTTP 206 partial content range requests or renderTo / BlobURL)
   - Fallback and error handling for stalled torrents or missing peers.

## 2026-09-18T08:24:20Z
Parent check-in: Checking in on your progress across Audius, Internet Archive, Radio-Browser, and WebTorrent P2P streaming specs. How is the investigation going?
Please reply with your current status and estimated time to complete handoff.md.
