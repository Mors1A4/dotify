package com.dotify.music

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class DotifyMediaService : Service() {

    private lateinit var mediaSession: MediaSessionCompat
    private var currentTitle: String = "Dotify"
    private var currentArtist: String = "No track playing"
    private var currentAlbum: String = "Dotify"
    private var currentArtworkUrl: String = ""
    private var currentArtworkBitmap: Bitmap? = null
    private var currentDurationMs: Long = 0L
    private var currentPositionMs: Long = 0L
    private var isPlaying: Boolean = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initMediaSession()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Dotify Music Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows currently playing song and playback controls"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun initMediaSession() {
        mediaSession = MediaSessionCompat(this, "DotifyMediaSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )

            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    MainActivity.dispatchMediaAction("play")
                }

                override fun onPause() {
                    MainActivity.dispatchMediaAction("pause")
                }

                override fun onSkipToNext() {
                    MainActivity.dispatchMediaAction("next")
                }

                override fun onSkipToPrevious() {
                    MainActivity.dispatchMediaAction("prev")
                }

                override fun onSeekTo(pos: Long) {
                    MainActivity.dispatchMediaAction("seek", pos)
                }

                override fun onStop() {
                    MainActivity.dispatchMediaAction("pause")
                    stopForegroundService()
                }
            })

            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE_TRACK -> {
                currentTitle = intent.getStringExtra(EXTRA_TITLE) ?: "Dotify"
                currentArtist = intent.getStringExtra(EXTRA_ARTIST) ?: ""
                currentAlbum = intent.getStringExtra(EXTRA_ALBUM) ?: "Dotify"
                val artwork = intent.getStringExtra(EXTRA_ARTWORK) ?: ""
                currentDurationMs = intent.getLongExtra(EXTRA_DURATION, 0L)
                currentPositionMs = intent.getLongExtra(EXTRA_POSITION, 0L)
                isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true)

                if (artwork != currentArtworkUrl) {
                    currentArtworkUrl = artwork
                    loadArtworkAsync(artwork)
                } else {
                    syncStateAndNotification()
                }
            }

            ACTION_UPDATE_PLAYBACK_STATE -> {
                isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false)
                currentPositionMs = intent.getLongExtra(EXTRA_POSITION, currentPositionMs)
                syncStateAndNotification()
            }

            ACTION_PLAY -> MainActivity.dispatchMediaAction("play")
            ACTION_PAUSE -> MainActivity.dispatchMediaAction("pause")
            ACTION_PREVIOUS -> MainActivity.dispatchMediaAction("prev")
            ACTION_NEXT -> MainActivity.dispatchMediaAction("next")
            ACTION_STOP -> {
                MainActivity.dispatchMediaAction("pause")
                stopForegroundService()
            }
        }

        return START_NOT_STICKY
    }

    private fun loadArtworkAsync(urlStr: String) {
        if (urlStr.isBlank()) {
            currentArtworkBitmap = null
            syncStateAndNotification()
            return
        }

        thread {
            try {
                val conn = URL(urlStr).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 8000
                conn.doInput = true
                conn.connect()
                val input = conn.inputStream
                val bitmap = BitmapFactory.decodeStream(input)
                conn.disconnect()
                currentArtworkBitmap = bitmap
            } catch (e: Exception) {
                currentArtworkBitmap = null
            }
            syncStateAndNotification()
        }
    }

    private fun syncStateAndNotification() {
        val stateBuilder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_STOP
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                currentPositionMs,
                if (isPlaying) 1.0f else 0.0f,
                SystemClock.elapsedRealtime()
            )

        mediaSession.setPlaybackState(stateBuilder.build())

        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)

        if (currentArtworkBitmap != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtworkBitmap)
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, currentArtworkBitmap)
        }

        mediaSession.setMetadata(metaBuilder.build())

        val notification = buildNotification()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevPendingIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, DotifyMediaService::class.java).apply { action = ACTION_PREVIOUS },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPausePendingIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, DotifyMediaService::class.java).apply {
                action = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val nextPendingIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, DotifyMediaService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play_arrow
        val playPauseTitle = if (isPlaying) "Pause" else "Play"

        val style = MediaStyle()
            .setMediaSession(mediaSession.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setContentIntent(contentPendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOngoing(isPlaying)
            .addAction(R.drawable.ic_skip_previous, "Previous", prevPendingIntent)
            .addAction(playPauseIcon, playPauseTitle, playPausePendingIntent)
            .addAction(R.drawable.ic_skip_next, "Next", nextPendingIntent)
            .setStyle(style)

        if (currentArtworkBitmap != null) {
            builder.setLargeIcon(currentArtworkBitmap)
        }

        return builder.build()
    }

    private fun stopForegroundService() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Exception) {}
        mediaSession.isActive = false
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        mediaSession.release()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "dotify_playback_channel"
        const val NOTIFICATION_ID = 2001

        const val ACTION_PLAY = "com.dotify.music.ACTION_PLAY"
        const val ACTION_PAUSE = "com.dotify.music.ACTION_PAUSE"
        const val ACTION_PREVIOUS = "com.dotify.music.ACTION_PREVIOUS"
        const val ACTION_NEXT = "com.dotify.music.ACTION_NEXT"
        const val ACTION_STOP = "com.dotify.music.ACTION_STOP"
        const val ACTION_UPDATE_TRACK = "com.dotify.music.ACTION_UPDATE_TRACK"
        const val ACTION_UPDATE_PLAYBACK_STATE = "com.dotify.music.ACTION_UPDATE_PLAYBACK_STATE"

        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_ARTIST = "extra_artist"
        const val EXTRA_ALBUM = "extra_album"
        const val EXTRA_ARTWORK = "extra_artwork"
        const val EXTRA_DURATION = "extra_duration"
        const val EXTRA_POSITION = "extra_position"
        const val EXTRA_IS_PLAYING = "extra_is_playing"
    }
}
