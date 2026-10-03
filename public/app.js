const socket = io();

let myUsername = null;
let targetUsername = null;
let localStream = null;
let peerConnection = null;
let screenStream = null;
let callStartTime = null;
let timerInterval = null;
let currentCameraFacing = 'user';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Views
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const callStage = document.getElementById('call-stage');
const userDisplay = document.getElementById('current-user-display');
const targetStatus = document.getElementById('target-status');
const callBtn = document.getElementById('call-btn');

// Local video views (Left Panel)
const selfVideo = document.getElementById('self-video');
const selfVideoMobile = document.getElementById('self-video-mobile');
const labelSelf = document.getElementById('label-self');
const labelSelfMobile = document.getElementById('label-self-mobile');

// Remote participants container (Right Panel)
const remoteContainer = document.getElementById('remote-participants-container');
const remoteMobileContainer = document.getElementById('remote-mobile-container');
const timerMobile = document.getElementById('call-timer-mobile');

const remoteStreams = new Map();

// 1. Authentication
document.getElementById('login-form').onsubmit = (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value.trim();

  if (!username || !password) return alert('Enter credentials');

  socket.emit('login', { username, password }, (res) => {
    if (res && res.success) {
      myUsername = res.username;
      targetUsername = myUsername === 'alice' ? 'bob' : 'alice';

      loginView.classList.add('hidden');
      dashboardView.classList.remove('hidden');

      const formatted = myUsername.charAt(0).toUpperCase() + myUsername.slice(1);
      userDisplay.innerText = formatted;
      if (labelSelf) labelSelf.innerText = `You (${formatted})`;
      if (labelSelfMobile) labelSelfMobile.innerText = `You (${formatted})`;
    } else {
      alert((res && res.message) ? res.message : 'Invalid credentials');
    }
  });
};

// 2. Track Presence
socket.on('online-users', (users) => {
  if (!myUsername) return;
  const isOnline = users.includes(targetUsername);
  targetStatus.innerText = isOnline ? `${targetUsername} is Online` : `${targetUsername} is Offline`;
  callBtn.disabled = !isOnline;
  callBtn.innerText = `Call ${targetUsername}`;
});

// 3. Caller Initiates Call
callBtn.onclick = async () => {
  try {
    targetStatus.innerText = "Accessing camera...";
    await initLocalMedia();
    initPeerConnection();

    targetStatus.innerText = `Calling ${targetUsername}...`;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call-user', { to: targetUsername, offer });

    dashboardView.classList.add('hidden');
    callStage.classList.remove('hidden');
    startTimer();
  } catch (err) {
    alert("Media error: " + err.message);
  }
};

// 4. Receiver Accepts Call
socket.on('incoming-call', async ({ from, offer }) => {
  const accept = confirm(`Incoming call from ${from}. Accept?`);
  if (!accept) return;

  try {
    await initLocalMedia();
    initPeerConnection();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('make-answer', { to: from, answer });

    dashboardView.classList.add('hidden');
    callStage.classList.remove('hidden');
    startTimer();
  } catch (err) {
    alert("Media error: " + err.message);
  }
});

socket.on('call-answered', async ({ answer }) => {
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('ice-candidate', async ({ candidate }) => {
  if (peerConnection && candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error("ICE error:", e);
    }
  }
});

socket.on('call-ended', () => {
  endCallCleanly();
  alert('Call has ended');
});

function endCall() {
  socket.emit('end-call', { to: targetUsername });
  endCallCleanly();
}

document.getElementById('web-btn-end').onclick = endCall;
if (document.getElementById('mob-btn-end')) {
  document.getElementById('mob-btn-end').onclick = endCall;
}

// Controls: Mute
function toggleMute() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    const isMuted = !audioTrack.enabled;
    document.getElementById('web-btn-mute').classList.toggle('off-state', isMuted);
    const mobMute = document.getElementById('mob-btn-mute');
    if (mobMute) mobMute.classList.toggle('off-state', isMuted);
  }
}
document.getElementById('web-btn-mute').onclick = toggleMute;
if (document.getElementById('mob-btn-mute')) {
  document.getElementById('mob-btn-mute').onclick = toggleMute;
}

// Controls: Camera Toggle
function toggleCamera() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    const isOff = !videoTrack.enabled;
    document.getElementById('web-btn-cam').classList.toggle('off-state', isOff);
  }
}
document.getElementById('web-btn-cam').onclick = toggleCamera;

// Controls: Screen Share
async function toggleScreenShare() {
  if (!peerConnection) return;

  if (screenStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(videoTrack);
    attachLocalStreams(localStream);
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    document.getElementById('web-btn-share').classList.remove('off-state');
  } else {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
      attachLocalStreams(screenStream);
      document.getElementById('web-btn-share').classList.add('off-state');

      screenTrack.onended = () => toggleScreenShare();
    } catch (err) {
      console.warn("Screen share cancelled", err);
    }
  }
}
document.getElementById('web-btn-share').onclick = toggleScreenShare;
if (document.getElementById('mob-btn-share')) {
  document.getElementById('mob-btn-share').onclick = toggleScreenShare;
}

// Controls: Screenshot
function takeScreenshot() {
  const remoteVideoElement = remoteContainer.querySelector('video');
  if (!remoteVideoElement || !remoteVideoElement.videoWidth) {
    alert("No active remote video available for screenshot.");
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = remoteVideoElement.videoWidth;
  canvas.height = remoteVideoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(remoteVideoElement, 0, 0, canvas.width, canvas.height);

  const link = document.createElement('a');
  link.download = `Kite_Snapshot_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
document.getElementById('web-btn-shot').onclick = takeScreenshot;
if (document.getElementById('mob-btn-shot')) {
  document.getElementById('mob-btn-shot').onclick = takeScreenshot;
}

// Timer
function startTimer() {
  callStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = String(elapsed % 60).padStart(2, '0');
    if (timerMobile) timerMobile.innerText = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  if (timerMobile) timerMobile.innerText = "0:00";
}

// Creates an active animated test pattern if camera is locked by the other browser tab
function createSimulatedCameraStream(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  let angle = 0;
  function render() {
    angle += 0.03;
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#1e2430');
    gradient.addColorStop(1, '#0e121a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Animated indicator ring
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 30;
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 90, angle, angle + 1.6);
    ctx.strokeStyle = '#0076ff';
    ctx.lineWidth = 10;
    ctx.stroke();

    // User tag
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${name.toUpperCase()} (Live)`, cx, cy + 160);

    ctx.font = '22px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('Single PC Mode (Camera 2 Virtual Feed)', cx, cy + 205);

    requestAnimationFrame(render);
  }
  render();

  const stream = canvas.captureStream(30);

  // Generate blank audio track so WebRTC audio transceivers match
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const dst = osc.connect(audioCtx.createMediaStreamDestination());
  osc.start();
  stream.addTrack(dst.stream.getAudioTracks()[0]);

  return stream;
}

// Initialize Local Media with Automatic Multi-Tab Fallback
async function initLocalMedia() {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: currentCameraFacing },
        audio: true
      });
    } catch (e) {
      console.warn("Camera occupied or blocked by another window. Using simulated live stream.", e);
      localStream = createSimulatedCameraStream(myUsername);
    }
    attachLocalStreams(localStream);
  }
}

function attachLocalStreams(stream) {
  if (selfVideo) {
    selfVideo.srcObject = stream;
    selfVideo.play().catch(() => {});
  }
  if (selfVideoMobile) {
    selfVideoMobile.srcObject = stream;
    selfVideoMobile.play().catch(() => {});
  }
}

function initPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((t) => peerConnection.addTrack(t, localStream));

  peerConnection.ontrack = (event) => {
    const stream = event.streams[0];
    const peerName = targetUsername.charAt(0).toUpperCase() + targetUsername.slice(1);
    addRemoteParticipant(peerName, stream);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: targetUsername, candidate: event.candidate });
    }
  };
}

function addRemoteParticipant(name, stream) {
  remoteStreams.set(name, stream);

  remoteContainer.innerHTML = '';
  if (remoteMobileContainer) remoteMobileContainer.innerHTML = '';

  const count = remoteStreams.size;
  remoteContainer.className = `right-stage grid-${Math.min(count, 4)}`;

  remoteStreams.forEach((s, peerName) => {
    // Desktop View
    const card = document.createElement('div');
    card.className = 'participant-card';
    card.innerHTML = `
      <span class="feed-label">${peerName}</span>
      <video autoplay playsinline></video>
    `;
    const v = card.querySelector('video');
    v.srcObject = s;
    v.play().catch(() => {});
    remoteContainer.appendChild(card);

    // Mobile View
    if (remoteMobileContainer) {
      const mCard = document.createElement('div');
      mCard.style.width = '100%';
      mCard.style.height = '100%';
      mCard.style.position = 'relative';
      mCard.innerHTML = `
        <span class="feed-label">${peerName}</span>
        <video autoplay playsinline style="width: 100%; height: 100%; object-fit: cover; border-radius: 18px;"></video>
      `;
      const mv = mCard.querySelector('video');
      mv.srcObject = s;
      mv.play().catch(() => {});
      remoteMobileContainer.appendChild(mCard);
    }
  });
}

function endCallCleanly() {
  stopTimer();
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }

  if (selfVideo) selfVideo.srcObject = null;
  if (selfVideoMobile) selfVideoMobile.srcObject = null;
  remoteStreams.clear();
  remoteContainer.innerHTML = '';
  if (remoteMobileContainer) remoteMobileContainer.innerHTML = '';

  callStage.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  targetStatus.innerText = `${targetUsername} is Online`;
}