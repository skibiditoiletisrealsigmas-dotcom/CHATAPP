// ══ FIREBASE ══
const firebaseConfig = {
  apiKey: "AIzaSyDxQIX3dLLYOp6lWa9kEAa1legZW-W2lpk",
  authDomain: "chatapp-9274d.firebaseapp.com",
  databaseURL: "https://chatapp-9274d-default-rtdb.firebaseio.com",
  projectId: "chatapp-9274d",
  storageBucket: "chatapp-9274d.appspot.com",
  messagingSenderId: "840477271165",
  appId: "1:840477271165:web:db3ad0f4fc45c0478a7d14"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ══ STATE ══
let me = "", room = "global";
let typingTimeout = null;
let selectedRef = null;
let lastUser = null, lastTime = 0;
let currentAudio = null, currentPlayBtn = null, currentWave = null;
let mediaRecorder = null, audioChunks = [];
let currentImgSrc = "";

// ══ STICKERS ══
const STICKERS = {
  "😀": ["😀","😂","🤣","😍","🥰","😎","😭","😱","🥳","😴","🤩","😏","🤗","😬","🙄","🤔","😤","🥺","😇","🤯","🥸","😈"],
  "👍": ["👍","👎","👌","✌️","🤞","🤟","🤙","👏","🙌","💪","🫶","🤝","🫡","🤜","🤛","👊","✊","🖖","👋","🤚","🖐️","☝️"],
  "❤️": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","💖","💗","💓","💞","💕","💟","❣️","💔","❤️‍🔥","❤️‍🩹","💝","💘","💌","💋"],
  "🔥": ["🔥","⭐","✨","💫","🌟","💥","🎉","🎊","🏆","👑","💎","🚀","⚡","🌈","🍀","🎯","💯","🎁","🪄","🎭","🎮","🕹️"],
  "🐶": ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐧","🦋","🐺","🦄","🐙","🦑","🐬","🦈"],
  "🍕": ["🍕","🍔","🌮","🍜","🍣","🍩","🍪","🎂","☕","🧃","🍺","🥤","🍦","🍿","🧁","🍭","🍫","🧋","🥐","🍗","🌯","🥗"],
};
const CAT_ICONS = Object.keys(STICKERS);
let activeCat = CAT_ICONS[0];
let stickerOpen = false;

function buildStickerPanel() {
  const cats = document.getElementById("stickerCats");
  const grid = document.getElementById("stickerGrid");
  cats.innerHTML = "";
  CAT_ICONS.forEach(icon => {
    const btn = document.createElement("button");
    btn.className = "catBtn" + (icon === activeCat ? " active" : "");
    btn.textContent = icon;
    btn.onclick = () => {
      activeCat = icon;
      document.querySelectorAll(".catBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderStickerGrid();
    };
    cats.appendChild(btn);
  });
  renderStickerGrid();
}

function renderStickerGrid() {
  const grid = document.getElementById("stickerGrid");
  grid.innerHTML = "";
  STICKERS[activeCat].forEach(emoji => {
    const btn = document.createElement("button");
    btn.className = "stickerBtn";
    btn.textContent = emoji;
    btn.onclick = () => sendSticker(emoji);
    grid.appendChild(btn);
  });
}

function toggleStickers() {
  stickerOpen = !stickerOpen;
  const panel = document.getElementById("stickerPanel");
  if (stickerOpen) {
    buildStickerPanel();
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    document.getElementById("messageInput").blur();
  } else {
    panel.style.display = "none";
  }
}

function closeStickers() {
  stickerOpen = false;
  document.getElementById("stickerPanel").style.display = "none";
}

// ══ HELPERS ══
const $  = id => document.getElementById(id);
const ini = n => n.trim().charAt(0).toUpperCase();
const ftime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fdate = ts => {
  const d = new Date(ts), t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
};

// ══ LOGIN / LOGOUT ══
function login() {
  const u = $("usernameInput").value.trim();
  const r = $("roomInput").value.trim();
  if (!u) return $("usernameInput").focus();
  me = u; if (r) room = r;
  $("loginScreen").style.display = "none";
  $("chatScreen").style.display = "flex";
  $("headerRoom").textContent = room;
  listenMessages();
  listenTyping();
  listenCall();
}

function logout() {
  setTyping(false);
  endCall();
  db.ref(`${room}/messages`).off();
  db.ref(`${room}/typing`).off();
  db.ref(`${room}/call`).off();
  $("chatScreen").style.display = "none";
  $("loginScreen").style.display = "flex";
  $("chatBox").innerHTML = "";
  lastUser = null; lastTime = 0;
}

// ══ SEND ══
function sendText() {
  const input = $("messageInput");
  const text = input.value.trim();
  if (!text) return;
  push({ type: "text", text, user: me, ts: Date.now() });
  input.value = "";
  setTyping(false);
  closeStickers();
}

function sendSticker(emoji) {
  push({ type: "sticker", emoji, user: me, ts: Date.now() });
  closeStickers();
}

function sendImage(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { alert("Image too large (max 3MB)"); return; }
  const reader = new FileReader();
  reader.onload = e => push({ type: "image", data: e.target.result, user: me, ts: Date.now() });
  reader.readAsDataURL(file);
  input.value = "";
}

function push(data) {
  db.ref(`${room}/messages`).push(data);
}

// ══ VOICE RECORDING ══
function getSupportedMime() {
  const types = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4","audio/ogg"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

async function startRecording(e) {
  if (e) e.preventDefault();
  if (!navigator.mediaDevices) return alert("Microphone not supported");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const mime = getSupportedMime();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const mime2 = mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(audioChunks, { type: mime2 });
      if (blob.size > 4 * 1024 * 1024) { alert("Recording too long. Max ~30 seconds."); stream.getTracks().forEach(t=>t.stop()); return; }
      const reader = new FileReader();
      reader.onload = ev => push({ type: "voice", data: ev.target.result, mime: mime2, user: me, ts: Date.now() });
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    $("micBtn").classList.add("recording");
  } catch {
    alert("Microphone permission denied");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    $("micBtn").classList.remove("recording");
  }
}

// ══ VOICE PLAYBACK (FIXED) ──
function base64ToBlob(dataUrl, mime) {
  const arr = dataUrl.split(",");
  const bstr = atob(arr[1]);
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

function playVoice(dataUrl, mime, playBtn, waveEl) {
  // Stop previous audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    if (currentPlayBtn) currentPlayBtn.innerHTML = "▶";
    if (currentWave) currentWave.classList.remove("playing");
    // If same button, just stop
    if (currentPlayBtn === playBtn) {
      currentAudio = null; currentPlayBtn = null; currentWave = null;
      return;
    }
  }

  const blob = base64ToBlob(dataUrl, mime || "audio/webm");
  const blobUrl = URL.createObjectURL(blob);
  const audio = new Audio(blobUrl);

  audio.play().then(() => {
    playBtn.innerHTML = "⏸";
    waveEl.classList.add("playing");
    currentAudio = audio;
    currentPlayBtn = playBtn;
    currentWave = waveEl;
  }).catch(err => {
    console.error("Playback failed:", err);
    URL.revokeObjectURL(blobUrl);
    alert("Couldn't play audio. Try on desktop Chrome.");
  });

  audio.onended = () => {
    playBtn.innerHTML = "▶";
    waveEl.classList.remove("playing");
    URL.revokeObjectURL(blobUrl);
    currentAudio = null; currentPlayBtn = null; currentWave = null;
  };
}

// ══ IMAGE VIEWER ══
function openImgViewer(src) {
  currentImgSrc = src;
  $("imgViewerSrc").src = src;
  $("imgViewer").style.display = "flex";
}

function closeImgViewer() {
  $("imgViewer").style.display = "none";
  currentImgSrc = "";
}

function downloadCurrentImg(e) {
  e.stopPropagation();
  const a = document.createElement("a");
  a.href = currentImgSrc;
  a.download = "image_" + Date.now() + ".jpg";
  a.click();
}

// ══ MESSAGES LISTENER ══
function listenMessages() {
  const box = $("chatBox");

  db.ref(`${room}/messages`).on("child_added", snap => {
    const msg = snap.val();
    const isMine = msg.user === me;
    const ts = msg.ts || Date.now();

    // Date divider
    if (!lastTime || fdate(ts) !== fdate(lastTime)) {
      const d = document.createElement("div");
      d.className = "dateDivider";
      d.textContent = fdate(ts);
      box.appendChild(d);
    }

    const grouped = lastUser === msg.user && (ts - lastTime) < 60000;
    lastUser = msg.user;
    lastTime = ts;

    // Row
    const row = document.createElement("div");
    row.className = `msgRow ${isMine ? "mine" : "others"}`;
    row.dataset.key = snap.key;

    // Avatar
    const av = document.createElement("div");
    av.className = `msgAvatar ${grouped ? "hide" : ""}`;
    av.textContent = ini(msg.user);

    // Wrap
    const wrap = document.createElement("div");
    wrap.className = "msgWrap";

    // Sender (others only, first in group)
    if (!isMine && !grouped) {
      const s = document.createElement("div");
      s.className = "senderName";
      s.textContent = msg.user;
      wrap.appendChild(s);
    }

    // Bubble
    const bubble = document.createElement("div");

    if (msg.type === "text") {
      bubble.className = "bubble";
      bubble.textContent = msg.text;

    } else if (msg.type === "sticker") {
      bubble.className = "bubble stickerBubble";
      bubble.textContent = msg.emoji;

    } else if (msg.type === "image") {
      bubble.className = "bubble imgBubble";
      const img = document.createElement("img");
      img.src = msg.data;
      img.loading = "lazy";
      // Tap to view
      img.onclick = e => { e.stopPropagation(); openImgViewer(msg.data); };
      // Long press to download
      let holdT;
      img.addEventListener("touchstart", () => { holdT = setTimeout(() => openImgViewer(msg.data), 600); });
      img.addEventListener("touchend", () => clearTimeout(holdT));
      bubble.appendChild(img);

    } else if (msg.type === "voice") {
      bubble.className = "bubble voiceBubble";

      const playBtn = document.createElement("button");
      playBtn.className = "playBtn";
      playBtn.innerHTML = "▶";

      const wave = document.createElement("div");
      wave.className = "waveform";
      const bars = 14 + Math.floor(Math.random() * 6);
      for (let i = 0; i < bars; i++) {
        const s = document.createElement("span");
        s.style.height = (4 + Math.random() * 16) + "px";
        wave.appendChild(s);
      }

      const dur = document.createElement("span");
      dur.className = "voiceDur";
      dur.textContent = "0s";
      const tmpAudio = new Audio();
      const tmpBlob = base64ToBlob(msg.data, msg.mime || "audio/webm");
      const tmpUrl = URL.createObjectURL(tmpBlob);
      tmpAudio.src = tmpUrl;
      tmpAudio.onloadedmetadata = () => {
        dur.textContent = isFinite(tmpAudio.duration) ? Math.round(tmpAudio.duration) + "s" : "";
        URL.revokeObjectURL(tmpUrl);
      };

      playBtn.onclick = () => playVoice(msg.data, msg.mime, playBtn, wave);

      bubble.appendChild(playBtn);
      bubble.appendChild(wave);
      bubble.appendChild(dur);
    }

    // Time
    const timeEl = document.createElement("div");
    timeEl.className = "msgTime";
    timeEl.textContent = ftime(ts);

    // Delete (own messages)
    if (isMine) {
      let holdT;
      bubble.addEventListener("contextmenu", e => { e.preventDefault(); showMenu(snap.ref); });
      bubble.addEventListener("touchstart", () => { holdT = setTimeout(() => showMenu(snap.ref), 600); });
      bubble.addEventListener("touchend", () => clearTimeout(holdT));
      bubble.addEventListener("touchmove", () => clearTimeout(holdT));
    }

    // Tap to toggle time
    row.addEventListener("click", () => row.classList.toggle("showTime"));

    wrap.appendChild(bubble);
    wrap.appendChild(timeEl);

    if (!isMine) { row.appendChild(av); row.appendChild(wrap); }
    else         { row.appendChild(wrap); row.appendChild(av); }

    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  });

  db.ref(`${room}/messages`).on("child_removed", snap => {
    const row = document.querySelector(`[data-key="${snap.key}"]`);
    if (row) {
      row.style.transition = "opacity .2s, transform .2s";
      row.style.opacity = "0"; row.style.transform = "scale(0.9)";
      setTimeout(() => row.remove(), 200);
    }
  });
}

// ══ TYPING ══
function onInput() {
  if (stickerOpen) closeStickers();
  typingNow();
}

function typingNow() {
  setTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => setTyping(false), 2000);
}

function setTyping(state) {
  db.ref(`${room}/typing`).set(state ? me : "");
}

function listenTyping() {
  db.ref(`${room}/typing`).on("value", snap => {
    const who = snap.val();
    $("typingBar").textContent = (who && who !== me) ? `${who} is typing...` : "";
  });
}

// ══ DELETE MENU ══
function showMenu(ref) {
  selectedRef = ref;
  $("menuOverlay").style.display = "block";
  $("deleteMenu").style.display = "block";
}
function closeMenu() {
  $("menuOverlay").style.display = "none";
  $("deleteMenu").style.display = "none";
  selectedRef = null;
}
function confirmDelete() {
  if (selectedRef) selectedRef.remove();
  closeMenu();
}

// ══════════════════════════════
// ══ WEBRTC VOICE CALL ══
// ══════════════════════════════
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ]
};

let localStream = null;
let pc = null; // RTCPeerConnection
let isCallActive = false;
let isCaller = false;
let callWith = "";
let incomingOfferData = null;
let callTimer = null, callSecs = 0;
let isMuted = false, isSpeaker = true;

const callRef = () => db.ref(`${room}/call`);

// ─── START CALL ───
async function startCall() {
  if (isCallActive) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    alert("Microphone permission denied"); return;
  }

  isCaller = true;
  callWith = room;
  setupPC();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await callRef().set({
    status: "ringing",
    caller: me,
    offer: { type: offer.type, sdp: offer.sdp },
    ts: Date.now()
  });

  showCallUI("calling");

  // Wait for answer
  callRef().child("answer").on("value", async snap => {
    const ans = snap.val();
    if (ans && pc && !pc.remoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(ans));
      showCallUI("connected");
    }
  });

  // Receive callee ICE
  callRef().child("calleeCandidates").on("child_added", async snap => {
    const c = snap.val();
    if (c && pc) try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
  });
}

// ─── ACCEPT CALL ───
async function acceptIncomingCall() {
  $("incomingCallUI").style.display = "none";
  if (!incomingOfferData) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    alert("Microphone permission denied"); return;
  }

  isCaller = false;
  callWith = $("incomingCallName").textContent;
  setupPC();

  await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferData));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await callRef().child("answer").set({ type: answer.type, sdp: answer.sdp });
  await callRef().child("status").set("connected");

  showCallUI("connected");

  // Receive caller ICE
  callRef().child("callerCandidates").on("child_added", async snap => {
    const c = snap.val();
    if (c && pc) try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
  });

  incomingOfferData = null;
}

// ─── SETUP PEER CONNECTION ───
function setupPC() {
  pc = new RTCPeerConnection(RTC_CONFIG);
  isCallActive = true;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = e => {
    const audio = $("remoteAudio");
    audio.srcObject = e.streams[0];
    audio.play().catch(() => {});
  };

  pc.onicecandidate = e => {
    if (!e.candidate) return;
    const path = isCaller ? "callerCandidates" : "calleeCandidates";
    callRef().child(path).push(e.candidate.toJSON());
  };

  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === "disconnected" || pc.connectionState === "failed")) {
      endCall();
    }
  };
}

// ─── END CALL ───
function endCall() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

  callRef().off();
  if (isCallActive) callRef().remove();

  isCallActive = false; isCaller = false;
  isMuted = false; isSpeaker = true;
  incomingOfferData = null;

  $("callUI").style.display = "none";
  $("incomingCallUI").style.display = "none";
  stopCallTimer();
}

// ─── DECLINE CALL ───
function declineCall() {
  $("incomingCallUI").style.display = "none";
  incomingOfferData = null;
}

// ─── LISTEN FOR CALL ───
function listenCall() {
  callRef().on("value", snap => {
    const call = snap.val();

    if (!call || call.status === "ended") {
      if (isCallActive) endCall();
      $("incomingCallUI").style.display = "none";
      return;
    }

    if (call.status === "ringing" && call.caller !== me && !isCallActive) {
      incomingOfferData = call.offer;
      const av = $("incomingAvatar");
      av.textContent = ini(call.caller);
      $("incomingCallName").textContent = call.caller;
      $("incomingCallUI").style.display = "flex";
    }
  });
}

// ─── CALL UI ───
function showCallUI(state) {
  $("callUI").style.display = "flex";
  $("callWithName").textContent = callWith;
  if (state === "calling") {
    $("callStatus").textContent = "Calling...";
  } else if (state === "connected") {
    callSecs = 0;
    stopCallTimer();
    callTimer = setInterval(() => {
      callSecs++;
      const m = String(Math.floor(callSecs / 60)).padStart(2, "0");
      const s = String(callSecs % 60).padStart(2, "0");
      $("callStatus").textContent = `${m}:${s}`;
    }, 1000);
  }
}

function stopCallTimer() {
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
}

// ─── MUTE / SPEAKER ───
function toggleMute() {
  isMuted = !isMuted;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  const btn = $("muteBtn");
  btn.classList.toggle("active", isMuted);
  btn.title = isMuted ? "Unmute" : "Mute";
  btn.innerHTML = isMuted
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`;
}

function toggleSpeaker() {
  isSpeaker = !isSpeaker;
  const audio = $("remoteAudio");
  if (audio) audio.muted = !isSpeaker;
  $("speakerBtn").classList.toggle("active", !isSpeaker);
}
