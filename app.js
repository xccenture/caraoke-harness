(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    queue: [...(window.CARAOKE_CATALOG || [])],
    index: 0, lines: [], offset: 0, score: 0, hits: 0, samples: 0,
    micOn: false, analyser: null, lastLine: -1, running: false, startedAt: 0, elapsed: 0
  };
  function current() { return state.queue[state.index] || null; }
  function fmt(sec) { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  function nowSec() { return state.running ? state.elapsed + (Date.now() - state.startedAt) / 1000 : state.elapsed; }
  function youtubeUrl(song) {
    if (song?.videoId) return `https://www.youtube.com/watch?v=${song.videoId}`;
    const q = encodeURIComponent(`${song?.artist || ""} ${song?.title || ""} Sing King karaoke`);
    return `https://www.youtube.com/results?search_query=${q}`;
  }
  function appleUrl(song) {
    const q = encodeURIComponent(`${song?.artist || ""} ${song?.title || "Never Enough"}`);
    return `https://music.apple.com/search?term=${q}`;
  }
  function renderNow() {
    const song = current();
    $("title").textContent = song ? song.title : "No song";
    $("artist").textContent = song ? `${song.artist} · Sing King / Apple Music` : "Add a track";
    $("meta").textContent = `${state.queue.length} in queue`;
    $("scoreVal").textContent = String(Math.round(state.score)).padStart(4, "0");
    $("clock").textContent = fmt(nowSec());
    renderQueue();
  }
  function renderQueue() {
    const el = $("queue"); el.innerHTML = "";
    state.queue.forEach((s, i) => {
      const n = document.createElement("button");
      n.className = "q-item" + (i === state.index ? " nowplaying" : "");
      n.textContent = `${s.title} — ${s.artist}`;
      n.onclick = () => loadIndex(i, false);
      el.appendChild(n);
    });
  }
  function parseLrc(text) {
    if (!text) return [];
    return text.split("\n").flatMap((raw) => {
      const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      const lyric = raw.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, "").trim();
      if (!times.length || !lyric) return [];
      return times.map((m) => ({ t: Number(m[1]) * 60 + Number(m[2]), text: lyric }));
    }).sort((a, b) => a.t - b.t);
  }
  async function fetchLyrics(song) {
    $("curr").textContent = "Fetching lyrics…"; $("prev").textContent = ""; $("next").textContent = ""; state.lines = [];
    try {
      const q = new URL("https://lrclib.net/api/search");
      q.searchParams.set("track_name", song.title);
      q.searchParams.set("artist_name", song.artist);
      const res = await fetch(q, { headers: { "Lrclib-Client": "CaraokeHarness/1.1" } });
      const rows = await res.json();
      const best = rows.find((r) => r.syncedLyrics) || rows[0];
      if (!best) throw new Error("none");
      state.lines = parseLrc(best.syncedLyrics) || [];
      if (!state.lines.length && best.plainLyrics) {
        state.lines = best.plainLyrics.split("\n").filter(Boolean).map((text, i) => ({ t: i * 4, text }));
      }
      $("curr").textContent = state.lines.length ? "Ready. Open YouTube, then Play / Sync." : "No synced lyrics — use YouTube on-screen text";
    } catch { $("curr").textContent = "Lyrics unavailable — sing from the YouTube video"; }
  }
  function lineAt(sec) {
    const t = sec + state.offset; let i = 0;
    while (i < state.lines.length && state.lines[i].t <= t) i += 1;
    return i - 1;
  }
  function paintLyrics(sec) {
    if (!state.lines.length) return;
    const i = lineAt(sec);
    $("prev").textContent = state.lines[i - 1]?.text || "";
    $("curr").textContent = state.lines[i]?.text || "…";
    $("next").textContent = state.lines[i + 1]?.text || "";
    $("curr").classList.toggle("active", i >= 0);
    if (i !== state.lastLine && i >= 0) { state.lastLine = i; tickScore(); }
  }
  function tickScore() {
    const level = readMic(); state.samples += 1;
    if (level > 0.08) { state.hits += 1; state.score += Math.round(40 + level * 180); }
    else state.score = Math.max(0, state.score - 8);
    $("scoreVal").textContent = String(Math.round(state.score)).padStart(4, "0");
    $("stars").textContent = "★".repeat(starCount()) + "☆".repeat(5 - starCount());
  }
  function starCount() {
    if (state.samples < 4) return 0;
    return Math.min(5, Math.max(0, Math.round((state.hits / state.samples) * 5)));
  }
  function readMic() {
    if (!state.analyser) return 0;
    const buf = new Uint8Array(state.analyser.fftSize);
    state.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }
  function paintBars() {
    const level = readMic();
    [...document.querySelectorAll("#bars span")].forEach((el, i) => {
      el.classList.toggle("on", level > ((i + 1) / 8) * 0.22);
      el.style.height = `${Math.min(100, 12 + level * 400 * ((i + 1) / 8))}%`;
    });
  }
  function loop() {
    const sec = nowSec();
    if ($("clock")) $("clock").textContent = fmt(sec);
    if (state.running) paintLyrics(sec);
    paintBars();
    requestAnimationFrame(loop);
  }
  function ytIdFromInput(raw) {
    const s = raw.trim();
    const m = s.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return null;
  }
  function loadIndex(i, autoOpen) {
    state.index = i; state.score = 0; state.hits = 0; state.samples = 0;
    state.lastLine = -1; state.running = false; state.elapsed = 0;
    const song = current(); renderNow();
    if (!song) return;
    fetchLyrics(song);
    if (autoOpen) window.open(youtubeUrl(song), "_blank");
  }
  function addSong(song) { state.queue.push(song); loadIndex(state.queue.length - 1, false); }
  function startClock() { if (state.running) return; state.startedAt = Date.now(); state.running = true; }
  function pauseClock() { if (!state.running) return; state.elapsed = nowSec(); state.running = false; }
  $("openYt").onclick = () => { const song = current(); if (song) window.open(youtubeUrl(song), "_blank"); };
  $("openApple").onclick = () => { const song = current(); if (song) window.open(appleUrl(song), "_blank"); };
  $("searchBtn").onclick = () => {
    const q = $("q").value.trim(); if (!q) return;
    const id = ytIdFromInput(q);
    if (id) { addSong({ title: q, artist: "YouTube", videoId: id, source: "singking" }); return; }
    const bits = q.split(" - ").map((s) => s.trim());
    addSong({ title: bits.length > 1 ? bits.slice(1).join(" - ") : q, artist: bits.length > 1 ? bits[0] : "Search", videoId: null, source: "search" });
  };
  $("playBtn").onclick = startClock;
  $("pauseBtn").onclick = pauseClock;
  $("nextBtn").onclick = () => { if (state.index < state.queue.length - 1) loadIndex(state.index + 1, true); };
  $("offset").oninput = (e) => {
    state.offset = Number(e.target.value);
    $("offsetVal").textContent = `${state.offset >= 0 ? "+" : ""}${state.offset.toFixed(1)}s`;
  };
  $("tvBtn").onclick = () => {
    document.body.classList.toggle("tv");
    $("tvBtn").textContent = document.body.classList.contains("tv") ? "Exit TV" : "TV mode";
  };
  $("micBtn").onclick = async () => {
    if (state.micOn) { state.micOn = false; $("micBtn").textContent = "Mic"; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      state.analyser = ctx.createAnalyser(); state.analyser.fftSize = 2048; src.connect(state.analyser);
      state.micOn = true; $("micBtn").textContent = "Mic on";
    } catch { $("micBtn").textContent = "Mic blocked"; }
  };
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") $("searchBtn").click(); });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) return;
    if (e.key === " ") { e.preventDefault(); state.running ? pauseClock() : startClock(); }
    if (e.key === "n") $("nextBtn").click();
    if (e.key === "t") $("tvBtn").click();
    if (e.key === "m") $("micBtn").click();
    if (e.key === "o") $("openYt").click();
  });
  if (current()) fetchLyrics(current());
  renderNow(); loop();
})();
