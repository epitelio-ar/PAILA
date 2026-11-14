# What's new in PAILA

What changed in each version, in a few words. The newest is at the top. PAILA shows the one for the version you have in **Settings → Updates → What's new**.

<!-- The English version of docs/NOVEDADES.md: every version needs its entry in both files, with the same "## X.Y.Z · day/month/year: title"
     header (the date stays day/month/year). Simple points, no jargon. npm run version:subir checks both. -->

## 1.0.0 · 13/11/2026: the first public version

- **PAILA is now public and open source** (AGPL-3.0 license): you download it from github.com/epitelio-ar/PAILA, and anyone can see how it's made.
- **It updates itself:** when a new version comes out, PAILA lets you know and brings itself up to date, with nothing to download by hand. What changed in each one is in Settings → Updates.
- **Every version comes with its fingerprint** (SHA256): it lets you check that the installer you downloaded is the original and nobody touched it.
- **NAPIA comes included and is optional:** a box in the installer, ticked by default, that you can untick. PAILA works fully without NAPIA.
- Everything from 0.5.36: the new tabs, Organize with a single Apply, the internet just once, undo without leftovers, Sound at a glance and Un disco in NAPIA.
- **Not officially signed yet:** Windows shows "Windows protected your PC" the first time. Click "More info" and then "Run anyway". Signing gets requested now that PAILA is public.

## 0.5.36 · 13/11/2026: PAILA rethought, with Organize and Sound at a glance

- **New tabs:** Home · Your music · Organize · Sound · Take along · DJ. Everything is where you'd look for it. The DJ tools have their own tab, and Take along brings together the USB stick and the phone.
- **Organize, one single review:** PAILA works out by itself what can be fixed safely: identical repeats, tidy names and folders. It shows you everything together and you press a single Apply. What you untick stays in sight, and you decide the doubtful ones right there, in "For you to decide".
- **Folders are built with blocks, no codes:** you choose between three layouts (by album, by artist or by genre) with two of your tracks as examples, or build your own. PAILA suggests the layout your folders already have. Tracks have no number in the file name: the order still comes from the track number that music programs read.
- **The internet, just once:** you give the OK and PAILA fills in official names, albums, years and covers by itself. The doubtful ones went down from 472 tracks to 8. A track can have several genres: lists show the main one, and all of them appear in the track's details.
- **Undo, truly without leftovers:** applying removes the folders left empty, and undoing brings them back, along with each file's original date. Undoing something old also undoes what came after it, in order.
- **Sound at a glance:** a single screen for what sounds bad or is missing, with NAPIA on top. What can be improved is offered from the worst sound to the best, and better copies are suggested there and in the top bar.
- **NAPIA downloads a whole album:** you type the artist and the album, and if there are several editions (original, remastered, deluxe) it shows them with year and number of tracks so you choose. When it finishes downloading, it stays minimized.
- **PAILA scans your folders by itself when it opens,** and there's a small button to do it by hand.
- **Simpler:** Tools (Statistics, Space, ZIP and RAR) grouped and closed, Tracklist only in DJ, an ⓘ on every technical term, and "Rajatabla" is now called "Strict".
- **Fixed:** an Opus disguised as an .mp3 is marked as incompatible, and a genre folder is no longer taken for an album.

## 0.5.35 · 01/11/2026: what gets moved stays in order, and what you click makes sense

- **Fixed: Organize no longer leaves tracks half moved.** If a new track was going to the place of one you sent to the trash (it happens when you replace tracks with what NAPIA brings), Organize moved it but didn't record it. Now what's in the trash no longer holds its old place. The 11 tracks left that way get recorded on their own when you open this version. And if something can't be recorded, the file goes back where it was.
- **Organize, rethought:** the preview works itself out, no button. It separates the tracks that change folder from the ones that only get a new name. And you can untick **"Also rename the files"**: each track goes to its folder and keeps its name, so Rekordbox doesn't lose so many tracks. The rule with codes is under "Customize".
- **Propose and apply, end to end:** the top bar shows one thing at a time: what's ready to apply, the progress while it applies and then "Done", with Undo. No more little notices to close. What you propose or apply leaves the list it came from by itself.
- **Notices show up at the bottom right** and no longer cover Apply.
- **Fill in from the internet, in three folded parts:** official names, genres, and album and year. Each says where it stands, and the one that's pending is open. If you fix a name, it searches again with the new name.
- **Organize warns you if there are changes not applied yet**, so you don't have to organize twice.
- **Bottom left, tidied up:** History, Trash and Settings with their names (the gear no longer looks like brightness). Your disks show up in rows, with their name and drive letter. If you click one, it tells you which one it is and how much space it has left, and lets you open it or eject it safely.
- **In Analysis, the bar follows the pass that's running** (for example, the precise one) and no longer sits stuck at 100%.

## 0.5.34 · 01/11/2026: NAPIA doesn't make bogus files wait, and what you click responds

- **NAPIA downloads each list 25 tracks at a time.** If a track arrives bogus, it looks for it from another user as soon as that batch of 25 ends, not at the end of the list. With a long list, it used to wait for hours.
- **While a track downloads, NAPIA already listens to a piece of it.** If that piece sounds bogus (an inflated MP3 or a FLAC that's really an MP3 inside) and it's the only thing left downloading, it's cut and another user is tried, without waiting for it to finish. While other tracks are still downloading, it lets it finish and decides with the whole file.
- **What looks clickable now does something.** In the queue, the playing track opens its details. In Now playing, the cover and the title open the details, and the artist and the album take you to the library with those tracks. In Analysis, each grade (A, B… F) shows the tracks that have it. In the track details, the title plays the track. In Separate vocals, clicking a row plays it.
- **A cleaner Now playing:** the bar at the bottom no longer repeats the controls and the timeline, and clicking it doesn't take you out of the screen. Now playing no longer covers the tabs.
- **In NAPIA, every row has its button:** "See yours", "Search another way" (just that track) or "See in PAILA".
- **Organize says just what it is:** instead of "you changed 1,091 tracks", it says how many are out of their folder and how many would only get a new name (for example, because Fill in from the internet added the track number).

## 0.5.33 · 01/11/2026: NAPIA recognizes the version and picks up on its own

- **To review:** if new tracks come in after you did a step, or you change names after organizing, that step gets a yellow **!** on its tab and its part, saying what changed. If you undo Organize, it gets unticked.

- **NAPIA compares what it downloads by its sound**, like Shazam. If it comes to replace one of your tracks, it has to be the same audio. If it's a live version, a remix or another track, it discards it and tries another source. For tracks you don't have, it asks AcoustID whether it really is that track.
- **NAPIA remembers the batch.** If it closes while downloading (by hand, when installing a new version or because the computer shut down), when you open it again it picks up where it left off, without repeating what was already downloaded. If you had stopped it with Stop, it doesn't start on its own.

## 0.5.32 · 01/11/2026: tabs that move forward

- **At the top, PAILA is now organized in tabs** that go from left to right, in the order that works best: **Get to know → Clean up → Names and info → Organize → Improve the sound → Use**. First comes **Your music**, with your tracks and playlists.
- **The left bar shows the parts of the tab you're in**, numbered and in order. For example, in Names and info: 1 Fill in from the internet, 2 Fix names, 3 Albums and covers.
- Each tab shows a tick when it's done. Tapping it takes you back to the last part you opened.
- The welcome tour now explains the tabs.

## 0.5.31 · 01/11/2026: PAILA and NAPIA, better connected

- **PAILA sees what NAPIA is downloading:** the top bar shows "NAPIA downloading «list»" with its progress. Tapping it brings NAPIA up.
- **When NAPIA finishes a list, PAILA tells you** how many it got and how many couldn't be found. Those are marked in «Missing or sounds bad» as "Not on Soulseek".
- **The Inbox follows NAPIA's folder:** if you change where NAPIA saves, the Inbox starts watching the new one (if NAPIA had set it). If it saves inside your Music, it isn't needed.
- **Look for a better copy with NAPIA:** from a track's details or from several selected tracks.
- **In NAPIA, "See yours":** on each track that comes to replace one of yours, it opens PAILA on your copy so you can listen and compare.

## 0.5.30 · 01/11/2026: what the second test with a person asked for

- **Fill in from the internet (and everything that takes a while):** the time left no longer shoots up ("2 h left" when it was minutes). Part of the progress was lost when working it out.
- **Track panel:** if you tap a track in "up next", the panel switches to that track (if it was showing the one playing).
- **Apply** (in Pending changes) is now green: it stands out from the other buttons, which are all yellow.

## 0.5.29 · 01/11/2026: choose what to download, and NAPIA warns when there's no room

- **Missing or sounds bad:** at the top you choose what to send to NAPIA: **Improve what I have** (tracks you already have that sound bad), **What I'm missing** (the ones missing from your albums and from lists you brought in) or **Everything**. Each part reaches NAPIA as a separate list.

- **NAPIA:** the button to stop a download is now big and red ("⏹ Stop"). What was downloaded stays, and anything half-done resumes next time.
- **NAPIA:** before starting, it warns if the batch might not fit on the drive of the chosen folder, and suggests choosing another one (an external drive, for example).

## 0.5.28 · 01/11/2026: what the first test with people asked for, second batch

- **Fix names:** above the levels (Neat, Strict, Official) it says that choosing one changes no file: changes are only suggested when you tap Propose.
- **Fill in from the internet:** each counter says what it searches for ("name searches" or "genre searches"), so they don't get mixed up.
- **Tests with people:** what is done in NAPIA is noted down too, and every 15 seconds what each running job shows is noted.

## 0.5.27 · 31/10/2026: separating with the external disk unplugged

- **Separate vocals and separate into 4 work with any music folder:** what you separate goes to the track's own music folder (before, it always went to the first one, and with that disk unplugged nothing could be separated).
- **If it can't, it says so:** with the disk disconnected or the track missing, it tells you when you tap "Separate" instead of failing silently.

## 0.5.26 · 31/10/2026: separate into 4 parts

- **Separate into 4 parts:** in Separate vocals you can now choose **4 parts: vocals, drums, bass and instrumental** (guitars, keys, synths and everything else). The model (HT-Demucs v4, from Meta) is optional and downloaded separately, only once: 166 MB if you already had Separate vocals. Each track takes about as long as it lasts.
- **Maximum quality:** another option, with four specialist models (1.26 GB): vocals and drums come out a bit cleaner, but it takes about five and a half times the length of the track.
- **Its own folder:** what you split into 4 goes to «Stems (PAILA)», next to «Acapellas e instrumentales (PAILA)». As always, the original track is never touched and it can be undone.

## 0.5.25 · 31/10/2026: fixes from the first test with people

- **Changing the language no longer sends you to Home:** the window reloads and goes back to Settings, where you were.
- **Changing the audio output doesn't erase what's playing:** when switching between bit perfect and the Windows output, the bar at the bottom kept playing but sometimes lost the track. Not anymore.
- **NAPIA changes style on its own:** if you switch between Studio and Comic in PAILA with NAPIA open, NAPIA follows in a couple of seconds, without closing it.
- **The analysis pause says why:** "Paused while the vocals are separated", and which pass it was on. It continues on its own when that finishes.
- **Bring a list:** "Confirm the likely ones" comes before "Create", and they can also be confirmed afterwards.

## 0.5.24 · 31/10/2026: first steps in order and an Undo that doesn't confuse

- **First steps in an order that doesn't make you go back:** Listen → Duplicates → Fill in from the internet → Fix names → Albums and covers → Organize folders. Repeats are removed before looking them up online, what the internet brings is reviewed in Fix names, and Organize comes last, when names no longer change.
- **Fix names gets ticked:** it counts as done when you propose changes there, and it has "Done" (tracks with no data at all can't be fixed on that screen and kept it unticked).
- **Undo, without surprises:** while there are pending changes, the top bar no longer shows "Undo the last thing" next to "Discard": they got mixed up and something else was undone. The last thing can still be undone from History.
- **NAPIA doesn't search for the impossible:** tracks with no artist and names like "Track 01" or "AudioTrack 08" aren't sent. Fix their name first.
- **Safer tests with people:** inside a test you can't add a folder or pick an Inbox outside the test, so your real music is never touched.

## 0.5.23 · 31/10/2026: what NAPIA downloads reaches your music

- **NAPIA and the Inbox, connected:** when you tap "Download with NAPIA" and the Inbox isn't watching any folder yet, it starts watching NAPIA's and tells you. That way what it downloads shows up in the Inbox, ready to move into your Music (before, it stayed in NAPIA's folder).
- **Download only what's on your list:** in "Bring a list", once it's brought in, the **Download what is missing with NAPIA** button sends only what's missing or low quality from that list, not everything in "Missing or low quality".
- **Tests with people:** the report says "Library" instead of "library", and task 6 is "Copy a list to the USB stick".

## 0.5.22 · 31/10/2026: "Missing or low quality"

- **New name:** the "Wantlist" is now called **Missing or low quality**, which says what's in it: the tracks you don't have and the ones you have in poor quality. It works the same as before.
- **NAPIA in tests with people:** when opened from a test, NAPIA keeps everything inside the test folder and uses that PAILA's Inbox, never yours.

## 0.5.21 · 31/10/2026: faster internet lookups and an honest time left

- **Fill in from the internet, faster:** if a track was already recognized by how it sounds, MusicBrainz (the slowest service) is not asked again. In the 28/10 test that was almost half the lookups.
- **Lookups wait in line:** if you start two lookups that use the same service (for example names and genres), the second one shows **"Queued"** and starts by itself when the first one ends, instead of failing. You can cancel it while it waits.
- **"Found" counts tracks:** at the end it says how many tracks have something to review (before it added up every lookup in every source: "1,429 found" with 300 tracks).
- **Time left:** worked out from the pace of the last few minutes, not the average since the start, and at the start it says "calculating…" instead of making up "24 h 55 min".
- **Now playing:** clicking the track in the bottom bar opens Listening.
- **Details:** MusicBrainz and Deezer say "no key needed", and the job in progress switches language when you change the language.

## 0.5.20 · 30/10/2026: safer

- **Security fix:** PAILA and NAPIA move to a newer version of the engine they run on (Electron 43.8.4), which closes a flaw when receiving compressed data from the internet. Nothing else changes.

## 0.5.19 · 27/10/2026: faster and more at hand

- **Wantlist:** opens right away even with a huge library (names are cleaned in the background) and uses space better: the explanation moves to an ⓘ and more tracks show without scrolling.
- **Sidebar with arrows:** one Tab to get in, ↑↓ to move and Enter to open. Reaching a tool with the keyboard goes from 61–76 keys to 13–28.
- **Copy music to a phone:** the "Copy tracks" button always stays in sight at the bottom and says what is still missing.
- **Inbox:** reasons show in the language you choose.

## 0.5.18 · 27/10/2026: keyboard, small screens and huge libraries

- **Ctrl+K fixed:** every letter can be typed now, and Enter goes to the screen instead of changing a setting.
- **Keyboard:** Escape closes windows, the focus is visible and each main button is a few keys away; rows open with Enter.
- **Small screens:** the top and bottom take less room and the player shrinks in short windows. "Library" starts folded so more tools are in sight.
- **With a huge library**, the Wantlist no longer freezes the app.
- **Less text:** Fill in from the internet goes from 191 to 74 words; History no longer repeats "Undo" on every row.

## 0.5.17 · 27/10/2026: tools at hand and your playlists on their own screen

- **Tools in sight:** they come before the playlists in the sidebar; at the bottom, History, Trash, Settings and the drive sit in one row of icons (Comic/Sober and the DJ switch move to Settings).
- **Playlists screen:** the sidebar shows a few (pinned or recent) and "See all" opens a screen with their covers to search, sort, pin, merge or delete. When dragging tracks, the sidebar shows them all to drop on.
- **Home with a single button** while First steps are pending, and "wax" explained in sight.
- **DJ programs:** Export comes first. **Wantlist:** "Download with NAPIA" and "Export" on top.
- **Errors in words:** a file open in another program no longer shows a cryptic code; if the internet drops during a search, those tracks are searched again.
- **Test mode** so someone new can try it with sample music (for the author and his testers).

## 0.5.16 · 27/10/2026: it guides you and doesn't break itself

- **First steps on Home:** a card with the path to tidy your music that ticks itself off and goes away when you're done. If you skip a step, the screen tells you what is best done first.
- **A single bar on top** with notices, pending changes and undo.
- **Less text:** each screen says in one line what it does; the long version lives in "How it works".
- **When a search finishes** it tells you what's next.
- **Tools don't step on each other:** whatever moves files waits for whatever is reading them and says so; trimming silences goes before tags; replacing a track drops what was calculated with the old audio.
- **Your choices rule:** nothing changes what you picked by hand without asking; next comes how the author released it, and only then the automatic rules.
- **What couldn't be applied** is shown apart, with the reason.

## 0.5.15 · 27/10/2026: what came out of using it for real

- **Windows and notices:** the confirm button is no longer hidden on long lists; top notices have a limit and don't cover the screen; changes that can't be applied can be discarded.
- **Cleaner:** the dot texture stays only in the background; "Note" becomes "Feedback" (with "Send to PAILA" in advanced mode); the Booth button leaves the top bar; covers live in one place.
- **Fill in from the internet:** what it finds can be accepted all at once or by group, not one by one.
- **Playlists:** merging or deleting no longer loses what the playlist is missing; delete with right-click or Del; bringing in the same list again offers **Update** instead of making "(2)"; new **"Both"** button to keep your version and request the list's one.
- **Better matching:** the album name is no longer taken as the title; covers are offered as another version.
- **Artists with "/"** are saved correctly.
- **Replacing with another version** deletes the old beat grid so it gets recalculated.
- **NAPIA:** "Skip what you already have" no longer skips what you have in poor quality; doesn't skip another version; prefers the track over the acapella; "Search another way" at hand; cleans up leftovers from cut downloads.

## 0.5.14 · 24/10/2026: NAPIA doesn't stall on a slow source

- **A slow source no longer holds up the download:** if a track needs more than 5 minutes at its current pace, it keeps going while other things are downloading; when it's the only thing left, NAPIA cuts it and tries another user. You see it as "Slow" and "trying the 2nd source".
- If there are only slow sources, it ends as "couldn't" and you can use "Search another way".

## 0.5.13 · 24/10/2026: NAPIA takes notes and follows the download

- **"Note" in NAPIA too** (or Ctrl+Shift+N): notes go together with PAILA's, in Settings → Usage notes.
- **The download list follows what is happening on its own** (downloading, checking, waiting). If you scroll up to look at something it doesn't drag you; it comes back with "Follow what's happening".

## 0.5.12 · 24/10/2026: get what a playlist needs

- **Wanted list, "Only from this playlist":** pick a playlist and the list shows only what it is missing and its poor-quality tracks, not the bad ones from the rest of your music. Export and "Download with NAPIA" send only that.
- **The playlist made by Bring in a list shows up right away:** if you had the playlists group folded in the sidebar, it opens on its own, and the request has a "See the playlist" button.

## 0.5.11 · 24/10/2026: beat grids that don't freeze and warnings for Rekordbox

- **Beat grids no longer freeze PAILA:** they are calculated separately, so the window responds and you can keep using everything. Very long tracks (mixes, sets) go last, Sets are left out by default, and there is a **"Skip this one"** button. While a batch runs, the screen shows only that batch, without two different counts.
- **Warning before moving tracks that are in Rekordbox:** if Organize or Fix names is going to move tracks you brought from Rekordbox, the preview warns you that Rekordbox will lose them until you import again.
- **Organize no longer takes Windows Media Player thumbnails** (AlbumArt…jpg) as if they were covers.
- **Clicking PAILA when it is already open brings the window to the front.**
- **"Note" button** (or Ctrl+Shift+N): if something feels odd or confusing, write it in one line and PAILA saves which screen you were on and a screenshot. It stays on your computer, in Settings → Usage notes.

## 0.5.10 · 24/10/2026: stubborn WMA and MP3 files

- **WMA files can now be written:** names, details and even volume, without re-encoding: the sound stays identical, bit for bit. Windows and players read them, and it can be undone like everything else.
- **MP3s that refused to be written:** the ones with a badly closed tag or leftovers from another program before the audio now get written fine.
- **Rekordbox:** the "DJ software" help no longer says Rekordbox always updates: a track PAILA moved or renamed comes in as new, with its beat grid, cues and stars.

## 0.5.9 · 24/10/2026: what sorting a real library asked for

- **More careful covers:** if the folder has a larger image, PAILA only uses it if it is the same cover the tracks already have (before it could pick another edition, like the instrumental one). And a "Various Artists" compilation with a common name ("Reggaeton Classics") no longer takes the cover of another album with the same name.
- **Duplicates keeps what came from Rekordbox:** the copy that stays gets the stars and play count of the one going to the trash. Restoring puts everything back.
- **Remove empty folders** now also removes the ones Windows marked as "read-only", and undo leaves them as they were.
- **Files that can't be written:** videos with an audio name (WebM) and WMA files show up from the start as "can't be written", instead of failing when applying.
- **Covers:** after proposing, the tab no longer offers to propose the same thing again.

## 0.5.8 · 24/10/2026: lyrics, empty folders and the Separate vocals warning

- **Lyrics travel with their track:** when organizing, a lyrics file (.lrc) with the same name as a track moves with it and takes its new name, so your player still finds it. Undo brings it back.
- **Remove empty folders:** in Space, PAILA shows the folders left empty (for example, after organizing) and removes them after asking. It goes into the History and Undo creates them again. It never touches sample packs, Ableton projects or the Rekordbox USB folder.
- **Separate vocals warns with data:** only for D or F tracks, which separate slightly worse (measured). An MP3 of 192 or more separates as well as a FLAC, so it doesn't warn.

## 0.5.7 · 24/10/2026: bands with a comma

- **Organize** no longer splits the name of a band that has a comma: "Earth, Wind & Fire", "Lipps, Inc" or "Tyler, The Creator" get their own folder. A real list of artists ("Charly García, Pedro Aznar") is still split as before.

## 0.5.6 · 24/10/2026: separate the vocals

- **Separate vocals:** in DJ and production, PAILA pulls the acapella and the instrumental out of a track, with a free model downloaded separately (once, ~107 MB). They become new files with the original's tags and cover, in their own folder; the original is not touched. If the track is low quality it warns you and offers to look for a better one. Undo from the History.
- **"Undo the last thing"** now says what it undoes and when ("Sent 1,039 tracks to the trash · today at 11:28"), whatever it was.
- **NAPIA and the Inbox** use the same yardstick to decide whether a new copy is better than yours: a better grade, or the same one with more real quality, no dropouts, no more clipping and the same length.
- **Official names** no longer gets stuck if MusicBrainz didn't answer some search (when it asks to slow down).

## 0.5.5 · 24/10/2026: PAILA checks itself

- **Health check:** in Settings, PAILA checks that everything works (ffmpeg, that it can write to your folders, the space on the drive, the keys for the internet services, the database) and tells you how to fix whatever fails. You don't need to open it: if something fails while you use PAILA, it warns you on its own.
- **NAPIA and the Windows firewall:** it notices if you never answered the prompt, if you said no, or if you allowed it for the other kind of network (for example, only "Public" when your wifi is "Private"), and fixes it with a button that asks for Windows' permission once.
- **NAPIA, when replacing one of your tracks:** the new one only counts if it is clearly better than your copy. If no better one turns up, it tells you.
- **Re-reads the quality of all your music in the background** to find small dropouts (a few hundredths of a second) that weren't visible before. It picks up where it left off if it's interrupted.
- **Finer organizing:** a website in place of the artist no longer makes a folder, the Windows Media Player "Unknown album" with a date no longer counts as an album, collaborations from a compilation go with the first artist, and a title that carried ".mp3" loses it.
- **G + letter shortcuts:** the same letters in Spanish and English.

## 0.5.4 · 24/10/2026: ready to sort your music

- **Light backups:** before changing a file, PAILA keeps only what is about to change (a few KB per track), not the whole file: a batch of covers and volume went from 45 GB to about 70 MB. It writes to a copy, checks it and only then replaces; undo leaves every file identical. "Delete backups" sends them to the trash, which now shows how much space it takes.
- **Better decisions on its own, with rules reviewed one by one on a real library:**
  - **Duplicates:** it keeps the copy that doesn't clip and the one without dropouts; with the same grade, MP3 beats WMA; to break a tie it looks at the sound, not at which site it came from.
  - **Names:** it respects your capitals and accents, fixes broken tags on its own (a track number stuck to the artist, "Various Artists" with the artist in the title, an email as the artist) and uses the artist's name as it is published today.
  - **Folders:** the artist's official name with its capitals (ABBA, YSY A), a duo in a single folder, one-off collaborations with the first artist and stray compilation tracks with each artist.
  - **Covers:** among several albums with the same name, it picks the one with your tracks and your year.
  - **Impossible BPM and key:** Fix names removes from the tag the ones that are surely wrong (a BPM of 900, or the same BPM copied to a whole album). It doesn't write new values.
  - **Quality:** "Damaged" counts real glitches (a word in the lyrics could trigger it before) and the details say where the dropouts are ("3 dropouts of 26 ms: 0:39, 0:49, 1:29").
- **"To do" on Home:** everything pending in one place, each with its button, and how much space you can free up.
- **NAPIA checks what it downloads:** if a track arrives fake (an inflated MP3 or a fake FLAC), it moves it to "descartados" and looks for another source on its own. "Whatever is there" tries the best first.
- **Export to Engine DJ** (Denon and other gear), a more accurate **Bring in a list**, sharper icons and screens that look right at 125 % and 150 %.
- **In English,** the quality grade and its reasons also change language.

## 0.5.3 · 23/10/2026: safer for your music and faster

- **Backup before every change:** before touching tags, covers, volume or comments, PAILA copies the files it is about to change and checks the copy. If there is no room, it doesn't start. The preview tells you how much space it takes and where it goes, and the History shows where it ended up. Backups are only deleted by hand, in Settings → Backups.
- **Everything that touches files works the same way:** the same confirmation on every screen, the same checks before starting (the drive is there, there is room, nothing lands inside a sample pack) and the same log in case the power goes out. Copying to a USB stick, a phone or other programs now also shows up in the History.
- **Undoing a genre or artist with several values** ("Rap; Hip Hop") now works in every MP3.
- **Faster with huge libraries:** Fix names opens in seconds, and Duplicates and Analysis work faster.
- **The installer** no longer says NAPIA needs sockseek installed separately: it comes inside.

## 0.5.2 · 23/10/2026: security fix

- **Electron updated** (what PAILA runs on): the new version stops trusting some internet certificates that had been compromised. Nothing changes for you.

## 0.5.1 · 23/10/2026: trim silences and PAILA for Mac

- **Trim long silences:** from the Problem center, PAILA cuts the silence at the start or end of tracks that take long to start or go quiet at the end, without losing quality and with the tags untouched. It goes through Pending changes, you can listen before and after, and you can undo it from the History. Sample packs are never touched.
- **PAILA and NAPIA for Mac** (in testing): they now build for Mac with Apple chips and Intel, and on a Mac the shortcuts say Cmd instead of Ctrl. It still needs testing on a real Mac.
- **When the drive comes back:** if the drive gets unplugged in the middle of something and comes back while PAILA is open, it sorts itself out without reopening.
- **Replace** no longer fails when the new track has the same name with a different capital letter in the extension (".Mp3").

## 0.5.0 · 23/10/2026: in English, other DJ programs, untouched sound and more

- **PAILA and NAPIA in English:** pick the language in Settings → Display. What PAILA writes into your files does not change with the language.
- **Move PAILA to another computer:** "Export everything" saves your playlists, history, analysis and settings in one file, and "Bring from another computer" opens it on another PC even if your music is somewhere else. No need to analyze again.
- **Finer quality check**, compared against Fakin' The Funk on 200 tracks: it spots small MP3s blown up to 320 better. Lossless files that cut off exactly where a very good MP3 does stay at B, with the label **"May come from an MP3"**, a filter and a button to look for the original.
- **"Projects" is now "Unreleased"**: demos, promos and tracks you got before they came out. You can play them and send them to Rekordbox, but PAILA doesn't look up their names online or reorganize them.
- **Duplicates it used to miss:** the same very percussive techno track in lower quality, versions that share a short piece, and very short tracks.
- **Export to Traktor, Serato and VirtualDJ:** your playlists, with beat grids, cues and BPM, on top of Rekordbox. Tested in the real Serato and VirtualDJ.
- **"Bit perfect" sound** (off by default): the track reaches your sound card or gear exactly as it was recorded, without Windows touching it, like when Ableton takes over the sound card. While it's on, other programs don't play through that device.
- **Open RAR and ZIP files** inside your library: see what's in them, listen to them, analyze them and extract the tracks, with undo. If you already extracted everything, PAILA offers to send the archive to the trash.
- **Genres from the internet** (Discogs and Last.fm): by default, with the names you already use in your library, and the fine-grained style or the broad genre a click away. Just one per track.
- **Style by sound** (separate, optional download): a style suggestion when PAILA is very sure. And **"Your energy"**: you mark a few tracks and the 1-to-10 energy adjusts to your ear.
- **Inbox:** the checkbox is now called "Replace only when there's no doubt", which says better what it does.
- **Tidier inside:** it opens faster (1.25 s), and the sidebar titles no longer shift when you scroll a little.

## 0.4.0 · 22/10/2026: set tracklists, Rekordbox and Excel

- **Automatic tracklist for sets:** PAILA listens to a DJ set, a mix or a live show and tells you which tracks from your library play and at what minute, even if they're sped up or slowed down like on a turntable. It comes out as a list, in the tags or as cues, always with a preview.
- **Bring in your Rekordbox playlists:** you drop your rekordbox.xml and they show up as PAILA playlists. What you don't have goes to the Wantlist.
- **Read a CDJ USB stick** made by Rekordbox: you see what's on it and recover its playlists, beat grids and cues (it only reads, it writes nothing to the stick).
- **Your library to Excel:** you export the table, with the columns you're looking at.
- **Saved views:** you save a table filter and sort order with a name and come back to it with one click from the sidebar.
- **Long silences:** PAILA warns you about tracks with a lot of silence at the start or end.
- **Steadier live beat grids** on tracks played very loosely, and the time it's going to take is now estimated correctly.

## 0.3.0 · 22/10/2026: a single mode and a fuller NAPIA

- **A single mode for everyone:** it no longer asks "what do you use your music for?". At the bottom of the sidebar there's a switch, **DJ and production tools**, that adds BPM and key, the For DJs section and the Booth button. If PAILA sees that you DJ, it offers it to you once.
- **Comic by default**, and **Studio** a click away, right there in the sidebar.
- **Folders → Playlists** is now for everyone, in "Bring in and take out".
- **NAPIA downloads in batches:** you queue several lists and it downloads them one after another, each in its own folder.
- **NAPIA has a history:** what you downloaded, when, what arrived and what didn't, with a button to see it in PAILA's Inbox.
- **NAPIA searches differently for what it didn't find:** without the "feat.", without "remaster", or the original version. It tells you what changed before searching.
- **Inbox: "Replace only the safe ones"** (off by default): it replaces on its own only when it's the same audio with no doubt at all, and the whole day can be undone at once.
- **Advanced mode** (off by default, in Settings): to look inside at what PAILA knows about a track, the analysis queue and the log of what it did.
- **Inside:** sturdier tests and the "remix, edit, live…" list in one place, so one fix works everywhere.

## 0.2.0 · 22/10/2026: PAILA complete

- **Now you know which version you have** and what it brought: you see it right here, in Settings.
- **Quality with judgment:** PAILA decides each track's grade on its own, with clues (whether it came from YouTube, from a store, the year), without sending you to look at graphs.
- **Even volume:** if another program had already adjusted it well, that's respected; if not, it's corrected for the whole album, so it doesn't jump between tracks.
- **Saving doesn't erase anything:** when PAILA writes a track's name or artist, the rest of its data stays the same, and undo puts it back exactly.
- **Playlists:** "Merge" joins two into one and "Clean up" removes repeats, keeping the best version. Always with a preview, and it can be undone.
- **NAPIA skips what you already have** in PAILA, and understands that a "feat." or a remaster is the same track.
- **Rekordbox beat grids that follow the track** even when the tempo drifts (live rock, bands without a click track). The BPM is shown honestly: a range (117–120) when the track isn't steady.
- **Comic mode:** a new, more hand-drawn style. You choose it the first time, in Settings or with Ctrl+K, and NAPIA copies it.
- **PAILA on Home** fills up with wax depending on how much low-quality music you have (5 steps).
- **Tidier:** one row per track in Duplicates, Inbox, History and other screens, and a reordered sidebar, with Even volume on its own.
- **Sturdier:** if you close the window in the middle of Organize, it asks first; the trash, Space and the Inbox no longer freeze the window; some healthy FLACs that showed up as "damaged" no longer do.

## 0.1.0 · 22/10/2026: the first installed PAILA

- The first version with an installer: PAILA and NAPIA on your computer, with their shortcuts on the desktop.
- Everything done up to masterplan 2: see the real quality of your music, fix names and tags, organize folders, find duplicates, free up space, playlists, take your music to your phone, BPM and key, and move to Rekordbox. Always with a preview, its own trash and undo.
