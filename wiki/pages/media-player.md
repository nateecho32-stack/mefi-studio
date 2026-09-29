# Music, video and the player

Studio has its own media player. Play your own music, ad-free radio, or a YouTube, Spotify, SoundCloud or Vimeo link while your agents work. You can also browse a website, put a video behind your work, and let the node tree move with the music.

## Open Music & video

- Use the audio button in Command view's toolbar (**Music, video and audio setup**). Hover it to open the settings for what's playing.
- Open **Settings › Audio** and choose **Open music & video**.
- Search for “Music & video” with **Ctrl + K**.
- In the [companion](#/companion) menu, choose **Audio link** at the bottom.

Closing the menu keeps the music playing.

## Choose what to play

The menu has three tabs.

**Local music** plays MP3, WAV, FLAC or OGG files from your PC. Choose **Add audio files**. It needs no account and shows what's playing on a record-style card. Pick your files again after you restart Studio.

**Ad-free radio** has twelve listener-funded stations from SomaFM and Radio Paradise, such as Groove Salad, Drone Zone and RP Mellow Mix. They carry no ads at all. Each station has backup streams, so if one stops, the next fades in.

**Video & links** plays a link you paste or drop:

- YouTube (in its privacy-enhanced player), Spotify, SoundCloud and Vimeo play in their official players.
- A link to an audio or video file, Discord attachments included, plays in Studio's own player.
- A Spotify Jam, a Twitch stream or any other page can open in its own app, in your browser, or with **Browse here**.

**Copy link** copies the loaded link so you can share it in Discord or anywhere else. Embedded players follow their own service's sign-in, ads and availability rules.

## Up next and YouTube

- **Up next** is a saved queue of up to 50 links. **Add to queue** adds a link without stopping what's playing, and **Queue next** puts it first. Each row has **Play now**, **Play next** and **Remove**. YouTube, Vimeo and files move on to the next item by themselves.
- **Explore YouTube** searches YouTube inside the menu. **Play** a result or add it to your queue. **Next video** plays your queue first, then your results or the YouTube playlist.
- With **Offer copied media links** on (under **Audio connection & clipboard**), copying a playable link offers **Play**, **Add to queue**, **Queue next** or **Dismiss**. It never starts playing by itself.
- **Show links** hides link addresses on screen, which is handy while you stream. It doesn't change what plays.

## Browse here

**Browse here** opens a website inside the player, with an address bar, Back, Forward, reload, mute, minimize and close. Links on the site stay in the same player. Sites run in their own session with no access to Studio. Some sign-ins and protected videos need your regular browser, and the player can open the page there too.

## The floating player

Videos and websites play in a floating player that stays on screen as you move around Studio.

- Drag it by its grip, or resize it from an edge. The arrow keys work too, with **Shift** for small steps.
- **Pin** keeps it in place. **Move aside** lets it glide out of the pointer's way in menus.
- Minimize it without stopping playback. Closing it stops playback.
- If the player was open in the last ten minutes, it comes back after Studio closes or reloads, in the same place. YouTube, Vimeo and files pick up where they were.
- Studio remembers the volume and mute for YouTube, Vimeo and files.

<span class="status next">Coming in 0.4.5</span> Every floating player gets a move handle and a **Settings** button, a minimized player leaves a restore bar in view, and websites get the full panel width.

## A video behind your work

**Use as background** puts the video behind Studio, where it doesn't catch your clicks. **Return to player** brings it back beside its queue. **Video settings** hold the rest:

- **Video brightness**, from 25% to 150%;
- **Video transparency** and **Tree transparency**, so the node tree stays easy to read;
- **Keep tree in dark areas**: the tree glides slowly toward a darker part of the video. Studio only reads a few brightness values, and it doesn't save or send screenshots;
- **Fade on finish**: the video dims when a task finishes, with **View result** or **Restore video**.

## Let the tree move with the music

Connect the audio link, and the live node tree reacts to what you play.

1. Open **Audio connection & clipboard**. Under **Listen to**, pick **Auto · local or desktop**, **Local player**, **Desktop audio / Spotify** (for example the Spotify app) or **Microphone**. Then choose **Connect audio**.
2. Open **Audio reactions**. **Response** sets how strongly the tree reacts. It starts gently at 35%.
3. Under **Reactions**, turn on what you like: **Connection waves**, **Separate frequency lines**, **Node glow**, **Tree motion**, **Drum accents** and **Background glow**.

With **Tree motion** on and the 3D overview spinning, the music's energy quickens the spin, the bass swells the tree and the mids sway it. Every node stays in view, and the tree settles when the music stops. The microphone only moves the visuals. Studio uses desktop audio or the microphone only while you have the audio link on.

**Tree modes & movement** picks what moves the tree: **Steady**, **Music**, **Video** or **Music + video**. Its shapes and sliders are the same ones as in [Appearance](#/appearance/layouts).

## More sound

- **Music recommendations**: say what you're in the mood for and choose **Ask for recommendations**. Each suggestion has a **Search Spotify** button. This needs a connected AI.
- **Zen bells**, under **Settings › Audio › Sound effects**, play soft bells that follow how fast your agents work. Pick a **Profile**: Zen Bells, Deep Temple, Crystal Bells or After Hours.

## Listen with friends <span class="status rolling">Rolling out</span>

**Listen together** lets a room hear the same link at the same moment. **Share what I'm playing** lets Void Engine members see what you're playing with `/nowplaying`. Both need the rooms hub. See [Listen together](#/friends-and-rooms/listen-together).

## What's next

- <span class="status progress">In progress</span> **A smaller player.** The media menu becomes a mini player with play, pause, back, forward and volume, quick switches for the node tree, and YouTube videos you can scroll through and add to Up next. It isn't in a release yet.
- <span class="status planned">Planned</span> **Shared mixes.** Share your mixes and see which ones are played the most, counted only from people who turn on “share music taste”. Nothing is built yet.

The [roadmap](../roadmap.html) has the details.

See also: [Themes, node styles and looks](#/appearance), [Command view](#/command-center) and [Privacy](#/privacy).
