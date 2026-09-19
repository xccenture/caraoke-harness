(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    player: null,
    ready: false,
    queue: [...(window.CARAOKE_CATALOG || [])],
    index: 0,
    lines: [],
    offset: 0,
    score: 0,
    hits: 0,
    samples: 0,
    micOn: false,
    analyser: null,
    raf: 0,
    lastLine: -1
  };

  function current() {
    return state.queue[state.index] || null;
  }

  function renderNow() {
    const song = current();
    $("title").textContent = song ? song.title : "No song";
    $("artist").textContent = song ? `${song.artist} · ${sourceLabel(song)}` : "Add a track";
    $("meta").textContent = `${state.queue.length} in queue`;
    $("scoreVal").textContent = String(Math.round(state.score)).padStart(4, "0");
    renderQueue();
  }

  function sourceLabel(song) {
    if (song.source === "apple") return "Apple Music lyrics";
    if (song.videoId) return "Sing King / YouTube";
    return "Lyrics only";
  }

  function renderQueue() {
    const el = $("queue");
    el.innerHTML = "";
    state.queue.forEach((s, i) => {
      const n = document.createElement("button");
      n.className = "q-item" + (i === state.index ? " nowplaying" : "");
      n.textContent = `${s.title} — ${s.artist}`;
      n.onclick = () => loadIndex(i, true);
      el.appendChild(n);
    });
  }

  function parseLrc(text) {
    if (!text) return [];
    return text.split("\n").flatMap((raw) => {
      const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      const lyric = raw.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, "").trim();
      if (!times.length || !lyric) return [];
      return times.map((m) => ({
        t: Number(m[1]) * 60 + Number(m[2]),
        text: lyric
      }));
    }).sort((a, b) => a.t - b.t);
  }

  async function fetchLyrics(song) {
    $("curr").textContent = "Fetching lyrics…";
    $("prev").textContent = "";
    $("next").textContent = "";
    state.lines = [];
    try {
      const q = new URL("https://lrclib.net/api/search");
      q.searchParams.set("track_name", song.title);
      q.searchParams.set("artist_name", song.artist);
      const res = await fetch(q, { headers: { "Lrclib-Client": "CaraokeHarness/1.0" } });
      const rows = await res.json();
      const best = rows.find((r) => r.syncedLyrics) || rows[0];
      if (!best) throw new Error("none");
      state.lines = parseLrc(best.syncedLyrics) || [];
      if (!state.lines.length && best.plainLyrics) {
        state.lines = best.plainLyrics.split("\n").filter(Boolean).map((text, i) => ({ t: i * 4, text }));
      }
      if (!state.lines.length) $("curr").textContent = "No synced lyrics — sing from the video";
    } catch {
      $("curr").textContent = "Lyrics unavailable — use the on-screen video text";
    }
  }

  function lineAt(sec) {
    const t = sec + state.offset;
    let i = 0;
    while (i < state.lines.length && state.lines[i].t <= t) i += 1;
    return i - 1;
  }

  function paintLyrics(sec) {
    if (!state.lines.length) return;
    const i = lineAt(sec);
    const prev = state.lines[i - 1];
    const curr = state.lines[i];
    const next = state.lines[i + 1];
    $("prev").textContent = prev ? prev.text : "";
    $("curr").textContent = curr ? curr.text : "…";
    $("next").textContent = next ? next.text : "";
    $("curr").classList.toggle("active", i >= 0);
    if (i !== state.lastLine && i >= 0) {
      state.lastLine = i;
      tickScore();
    }
  }

  function tickScore() {
    const level = readMic();
    state.samples += 1;
    if (level > 0.08) {
      state.hits += 1;
      state.score += Math.round(40 + level * 180);
    } else {
      state.score = Math.max(0, state.score - 8);
    }
    $("scoreVal").textContent = String(Math.round(state.score)).padStart(4, "0");
    $("stars").textContent = "★".repeat(starCount()) + "☆".repeat(5 - starCount());
  }

  function starCount() {
    if (state.samples < 4) return 0;
    const ratio = state.hits / state.samples;
    return Math.min(5, Math.max(0, Math.round(ratio * 5)));
  }

  function readMic() {
    if (!state.analyser) return 0;
    const buf = new Uint8Array(state.analyser.fftSize);
    state.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  function paintBars() {
    const level = readMic();
    const spans = [...document.querySelectorAll("#bars span")];
    spans.forEach((el, i) => {
      const threshold = (i + 1) / spans.length * 0.22;
      el.classList.toggle("on", level > threshold);
      el.style.height = `${Math.min(100, 12 + level * 400 * ((i + 1) / spans.length))}%`;
    });
  }

  function loop() {
    if (state.player && state.ready && typeof state.player.getCurrentTime === "function") {
      try { paintLyrics(state.player.getCurrentTime()); } catch { /* player not ready */ }
    }
    paintBars();
    state.raf = requestAnimationFrame(loop);
  }

  function ytIdFromInput(raw) {
    const s = raw.trim();
    const m = s.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return null;
  }

  function loadIndex(i, play) {
    state.index = i;
    state.score = 0;
    state.hits = 0;
    state.samples = 0;
    state.lastLine = -1;
    const song = current();
    renderNow();
    if (!song) return;
    fetchLyrics(song);
    if (song.videoId && state.player) {
      state.player.loadVideoById(song.videoId);
      if (!play) state.player.pauseVideo();
    }
  }

  function addSong({ title, artist, videoId, source }) {
    state.queue.push({ title, artist, videoId, source });
    if (state.queue.length === 1) loadIndex(0, false);
    renderNow();
  }

  window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
    const first = current();
    state.player = new YT.Player("yt", {
      videoId: first ? first.videoId : "0nxmS92MiSM",
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: location.origin
      },
      events: {
        onReady: () => {
          state.ready = true;
          renderNow();
          fetchLyrics(current() || { title: "Never Enough", artist: "The Greatest Showman" });
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED && state.index < state.queue.length - 1) {
            loadIndex(state.index + 1, true);
          }
        }
      }
    });
  };

  $("searchBtn").onclick = () => {
    const q = $("q").value.trim();
    if (!q) return;
    const id = ytIdFromInput(q);
    if (id) {
      addSong({ title: q, artist: "YouTube", videoId: id, source: "singking" });
      loadIndex(state.queue.length - 1, true);
      return;
    }
    const bits = q.split(" - ").map((s) => s.trim());
    const artist = bits.length > 1 ? bits[0] : "";
    const title = bits.length > 1 ? bits.slice(1).join(" - ") : q;
    const ytQuery = encodeURIComponent(`${q} Sing King karaoke`);
    window.open(`https://www.youtube.com/results?search_query=${ytQuery}`, "_blank");
    addSong({ title, artist: artist || "Search result", videoId: null, source: "search" });
    fetchLyrics({ title, artist: artist || title });
  };

  $("appleBtn").onclick = () => {
    const q = $("q").value.trim() || (current() ? `${current().artist} ${current().title}` : "Never Enough");
    window.open(`https://music.apple.com/search?term=${encodeURIComponent(q)}`, "_blank");
    const bits = q.split(" - ");
    addSong({
      title: bits.length > 1 ? bits.slice(1).join(" - ") : q,
      artist: bits.length > 1 ? bits[0] : "Apple Music",
      videoId: null,
      source: "apple"
    });
  };

  $("playBtn").onclick = () => state.player && state.player.playVideo();
  $("pauseBtn").onclick = () => state.player && state.player.pauseVideo();
  $("nextBtn").onclick = () => {
    if (state.index < state.queue.length - 1) loadIndex(state.index + 1, true);
  };
  $("offset").oninput = (e) => {
    state.offset = Number(e.target.value);
    $("offsetVal").textContent = `${state.offset >= 0 ? "+" : ""}${state.offset.toFixed(1)}s`;
  };

  $("tvBtn").onclick = () => {
    document.body.classList.toggle("tv");
    $("tvBtn").textContent = document.body.classList.contains("tv") ? "Exit TV" : "TV mode";
  };

  $("micBtn").onclick = async () => {
    if (state.micOn) {
      state.micOn = false;
      $("micBtn").textContent = "Mic";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      state.analyser = ctx.createAnalyser();
      state.analyser.fftSize = 2048;
      src.connect(state.analyser);
      state.micOn = true;
      $("micBtn").textContent = "Mic on";
    } catch {
      $("micBtn").textContent = "Mic blocked";
    }
  };

  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("searchBtn").click();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) return;
    if (e.key === " ") { e.preventDefault(); $("playBtn").click(); }
    if (e.key === "n") $("nextBtn").click();
    if (e.key === "t") $("tvBtn").click();
    if (e.key === "m") $("micBtn").click();
  });

  renderNow();
  loop();
})();
