// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; // Key mới cho session
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 

const timerSettings = {
    study: 25 * 60, 
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    totalCycles: 4, 
};

let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0; 
let pendingRestore = null; // Lưu trữ dữ liệu phiên cần khôi phục

// Elements
const playlistListEl = document.getElementById('playlist-list');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const skipBtn = document.getElementById('btn-skip'); 
const alarmSound = document.getElementById('alarm-sound');
const timerCardEl = document.getElementById('timer-section');

// Modal Elements
const restoreModalEl = document.getElementById('restore-modal');
const modalCloseBtn = document.querySelector('.modal-close');
const timerRestoreInfoEl = document.getElementById('timer-restore-info');
const videoRestoreInfoEl = document.getElementById('video-restore-info');
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');


// Icons
const playPauseIcon = document.querySelector('#btn-play-pause i');


// =======================================================
//                   HELPER FUNCTIONS
// =======================================================

const getYouTubeVideoId = (url) => {
    const regex = /(?:youtu\.be\/|v\/|watch\?v=|embed\/)([^&"'>]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const fetchVideoTitle = async (videoId) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}${encodeURIComponent(url)}&format=json`);
        const data = await response.json();
        return data.title || `Video ${videoId}`;
    } catch (error) {
        console.error("Lỗi lấy tiêu đề:", error);
        return `Video ${videoId}`;
    }
};

const loadPlaylist = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    currentPlaylist = data ? JSON.parse(data) : [];
};

const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
    renderPlaylist();
};

// =======================================================
//                   SESSION PERSISTENCE LOGIC
// =======================================================

const saveSession = () => {
    // Chỉ lưu nếu Timer đang chạy HOẶC đã có Playlist và Player đã được khởi tạo
    if (isRunning || currentPlaylist.length > 0) {
        let videoTime = 0;
        if (player && typeof player.getCurrentTime === 'function') {
            videoTime = Math.floor(player.getCurrentTime());
        }

        const sessionData = {
            timer: {
                currentMode,
                timeLeft: timeLeft,
                isRunning: isRunning,
                cycleCount: cycleCount,
            },
            player: {
                currentTrackIndex,
                videoCurrentTime: videoTime,
            }
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } else {
        localStorage.removeItem(SESSION_KEY);
    }
};

const loadSession = () => {
    const data = localStorage.getItem(SESSION_KEY);
    if (data) {
        pendingRestore = JSON.parse(data);
        return true;
    }
    return false;
};

const showRestoreModal = () => {
    if (!pendingRestore) return;
    
    // --- Chuẩn bị dữ liệu cho Modal ---

    // 1. Dữ liệu Timer
    const { currentMode: savedMode, timeLeft: savedTime, cycleCount: savedCycles } = pendingRestore.timer;
    const timeFormatted = formatTime(savedTime);
    const modeName = savedMode === 'study' ? 'TẬP TRUNG HỌC' : 
                     (savedMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    
    timerRestoreInfoEl.innerHTML = `Chế độ: <strong>${modeName}</strong><br>Thời gian còn lại: <strong>${timeFormatted}</strong><br>Chu kỳ đã hoàn thành: <strong>${savedCycles}</strong>`;
    
    // 2. Dữ liệu Video
    const { currentTrackIndex: savedIndex, videoCurrentTime: savedVTime } = pendingRestore.player;
    
    // Kiểm tra tính hợp lệ của video
    const currentVideo = currentPlaylist[savedIndex];
    if (currentVideo && savedIndex !== -1) {
        const vTimeFormatted = formatTime(savedVTime);
        videoRestoreInfoEl.innerHTML = `Video: <strong>${currentVideo.title}</strong><br>Tiếp tục tại: <strong>${vTimeFormatted}</strong>`;
        
        // Hiện nút Video
        document.getElementById('modal-video-section').style.display = 'block';
        btnRestoreVideo.dataset.time = savedVTime;
        btnRestoreVideo.dataset.index = savedIndex;

    } else {
        // Ẩn nút Video nếu không tìm thấy hoặc chưa có bài hát nào được chọn
        document.getElementById('modal-video-section').style.display = 'none';
    }
    
    // Nếu cả hai đều không có gì, không hiện modal
    if (savedTime <= 0 && document.getElementById('modal-video-section').style.display === 'none') {
        localStorage.removeItem(SESSION_KEY);
        pendingRestore = null;
        return;
    }

    // --- Hiển thị Modal ---
    restoreModalEl.style.display = 'flex';
};

// =======================================================
//                   3. POMODORO TIMER LOGIC
// =======================================================

const formatTime = (time) => {
    const minutes = Math.floor(time / 60).toString().padStart(2, '0');
    const seconds = (time % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 
                               (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    timerCardEl.style.backgroundColor = currentMode === 'study' ? 'rgba(255, 99, 71, 0.1)' : 'rgba(60, 179, 113, 0.1)';
    
    const totalCycles = parseInt(document.getElementById('setting-total-cycles').value || 4);
    timerSettings.totalCycles = totalCycles;
    const currentCycle = cycleCount % totalCycles;
    const displayCycle = currentCycle === 0 && cycleCount > 0 ? totalCycles : currentCycle;
    cycleInfoEl.textContent = `Chu kỳ: ${displayCycle} / ${totalCycles}`;
    
    document.title = `${formatTime(timeLeft)} - ${timerModeEl.textContent}`;
};


const fadeAlarm = (isFadeIn, callback) => {
    alarmSound.volume = isFadeIn ? 0 : 1;
    
    if (isFadeIn) {
        alarmSound.play().catch(e => console.error("Lỗi play audio:", e));
    }
    
    let volume = alarmSound.volume;
    const step = 0.1;
    
    const fadeInterval = setInterval(() => {
        if (isFadeIn) {
            volume += step;
            if (volume >= 1) {
                volume = 1;
                clearInterval(fadeInterval);
                if (callback) callback();
            }
        } else { 
            volume -= step;
            if (volume <= 0) {
                volume = 0;
                alarmSound.pause();
                alarmSound.currentTime = 0;
                clearInterval(fadeInterval);
                if (callback) callback();
            }
        }
        alarmSound.volume = volume;
    }, ALARM_FADE_DURATION / 10);
};

const switchMode = async (autoStartNext = true) => {
    clearInterval(intervalId);
    isRunning = false;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    
    let wasPlaying = false;
    if (player && player.getPlayerState() === 1) { 
        wasPlaying = true;
        currentVolume = player.getVolume() / 100;
        player.pauseVideo();
        playPauseIcon.classList.remove('fa-pause');
        playPauseIcon.classList.add('fa-play');
    }
    
    if (Notification.permission === 'granted') {
      new Notification(`Hết giờ ${currentMode === 'study' ? 'HỌC' : 'NGHỈ'}!`);
    }
    
    await alarmSound.load(); 
    fadeAlarm(true, () => {
        setTimeout(() => {
            fadeAlarm(false, () => {
                const totalCycles = timerSettings.totalCycles;
                
                if (currentMode === 'study') {
                    cycleCount++;
                    if (cycleCount > totalCycles) {
                        currentMode = 'study';
                        timeLeft = timerSettings.study;
                        cycleCount = 0;
                        updateDisplay();
                        return; 
                    } else if (cycleCount % totalCycles === 0 && totalCycles > 0) {
                        currentMode = 'longBreak';
                        timeLeft = timerSettings.longBreak;
                    } else {
                        currentMode = 'shortBreak';
                        timeLeft = timerSettings.shortBreak;
                    }
                } else { 
                    currentMode = 'study';
                    timeLeft = timerSettings.study;
                }
                
                updateDisplay();
                
                if (autoStartNext) {
                    isRunning = true;
                    startPauseBtn.textContent = '⏸ Tạm Dừng';
                    startTimer();
                    
                    if (wasPlaying && player) {
                        player.playVideo();
                        player.setVolume(currentVolume * 100);
                        playPauseIcon.classList.remove('fa-play');
                        playPauseIcon.classList.add('fa-pause');
                    }
                }
            });
        }, 3000); 
    });
};

const startTimer = () => {
    if (intervalId) clearInterval(intervalId);
    
    intervalId = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            switchMode(true); 
        } else {
            updateDisplay();
        }
    }, 1000);
};

const updateStudyTimeSetting = () => {
    const hours = parseInt(document.getElementById('setting-study-hour').value || 0);
    const minutes = parseInt(document.getElementById('setting-study-minute').value || 0);
    
    const totalSeconds = (hours * 3600) + (minutes * 60);
    timerSettings.study = Math.max(60, totalSeconds); 
    
    if (!isRunning && currentMode === 'study') {
        timeLeft = timerSettings.study;
        updateDisplay();
    }
};


// Events cho Pomodoro
startPauseBtn.addEventListener('click', () => {
    if (currentMode === 'study') {
        updateStudyTimeSetting(); 
    }
    
    isRunning = !isRunning;
    if (isRunning) {
        startPauseBtn.textContent = '⏸ Tạm Dừng';
        startTimer();
    } else {
        startPauseBtn.textContent = '▶ Bắt Đầu';
        clearInterval(intervalId);
    }
});

skipBtn.addEventListener('click', () => {
    if (isRunning || timeLeft > 0) {
        switchMode(true); 
    }
});


document.getElementById('btn-reset').addEventListener('click', () => {
    clearInterval(intervalId);
    isRunning = false;
    currentMode = 'study';
    updateStudyTimeSetting(); 
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    updateDisplay();
    // Xóa session đã lưu khi reset
    localStorage.removeItem(SESSION_KEY);
});

document.querySelectorAll('.settings-group input').forEach(input => { 
    input.addEventListener('change', (e) => {
        if (e.target.id === 'setting-study-hour' || e.target.id === 'setting-study-minute') {
            updateStudyTimeSetting();
        } else if (e.target.id === 'setting-total-cycles') {
            timerSettings.totalCycles = parseInt(e.target.value || 1);
            updateDisplay();
        } else {
            const name = e.target.id.replace('setting-', '');
            timerSettings[name] = parseInt(e.target.value || 1) * 60; 
            
            if (!isRunning && currentMode.toLowerCase().includes(name.toLowerCase())) { 
                timeLeft = timerSettings[name];
                updateDisplay();
            }
        }
    });
});


if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

// Gắn hàm lưu session vào sự kiện đóng/tải lại trang
window.addEventListener('beforeunload', saveSession);


// =======================================================
//                   4. YOUTUBE PLAYER LOGIC
// =======================================================

window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        playerVars: { 'controls': 1, 'autoplay': 0, 'modestbranding': 1 },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

const onPlayerReady = (event) => {
    console.log("YouTube Player đã sẵn sàng.");
    
    const placeholderEl = document.getElementById('player-placeholder');
    if (placeholderEl) {
        placeholderEl.style.display = 'none';
    }
    
    playPauseIcon.classList.add('fa-play');

    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) {
            currentTrackIndex = 0;
        }
        player.cueVideoById(currentPlaylist[currentTrackIndex].videoId); 
        renderPlaylist(); 
    }
};

const onPlayerStateChange = (event) => {
    if (event.data === 0) { // ENDED
        playNextTrack();
    }
    if (event.data === 1) { // PLAYING
        currentVolume = player.getVolume() / 100; 
        playPauseIcon.classList.remove('fa-play');
        playPauseIcon.classList.add('fa-pause');
    }
    if (event.data === 2) { // PAUSED
        playPauseIcon.classList.remove('fa-pause');
        playPauseIcon.classList.add('fa-play');
    }
};

const playVideoAtIndex = (index, forcePlay = true, startTime = 0) => {
    if (currentPlaylist.length === 0 || !player || typeof player.loadVideoById !== 'function') return; 
    
    const videoId = currentPlaylist[index].videoId;
    currentTrackIndex = index;

    player.loadVideoById({
        videoId: videoId,
        startSeconds: startTime, 
        suggestedQuality: 'small',
        autoplay: 0 
    }); 
    
    if (forcePlay) {
         setTimeout(() => {
             // Chỉ gọi play nếu Player đã được tải (state khác -1 và khác 0)
             if (player.getPlayerState() !== -1 && player.getPlayerState() !== 0) {
                 player.playVideo();
             }
         }, 500);
    }
    
    renderPlaylist(); 
};


const playNextTrack = () => {
    if (currentPlaylist.length === 0 || !player) return; 
    const nextIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(nextIndex, true);
};

const playPrevTrack = () => {
    if (currentPlaylist.length === 0 || !player) return; 
    const prevIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playVideoAtIndex(prevIndex, true);
};

const togglePlayback = () => {
    if (!player) return;
    const state = player.getPlayerState();
    if (state === 1) {
        player.pauseVideo();
    } else if (state === 2 || state === 5) { // PAUSED hoặc CUED
        player.playVideo();
    } else if (state === -1 && currentPlaylist.length > 0) {
        // Chưa load video nào, load video đầu tiên
        playVideoAtIndex(currentTrackIndex !== -1 ? currentTrackIndex : 0, true);
    }
};

document.getElementById('btn-next').addEventListener('click', playNextTrack);
document.getElementById('btn-prev').addEventListener('click', playPrevTrack);
document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);


// =======================================================
//                   5. PLAYLIST MANAGER & DRAG & DROP
// =======================================================

document.getElementById('btn-add-song').addEventListener('click', async () => {
    const url = urlInputEl.value.trim();
    const videoId = getYouTubeVideoId(url);
    errorEl.textContent = ''; 

    if (!videoId) {
        errorEl.textContent = '❌ URL YouTube không hợp lệ.';
        return;
    }
    
    const isDuplicate = currentPlaylist.some(song => song.videoId === videoId);
    if (isDuplicate) {
        errorEl.textContent = '⚠️ Video này đã có trong Playlist.';
        return;
    }

    const title = await fetchVideoTitle(videoId);

    const newSong = {
        id: Date.now(),
        videoId: videoId,
        title: title,
    };

    const wasEmpty = currentPlaylist.length === 0;
    
    currentPlaylist.push(newSong);
    savePlaylist();
    urlInputEl.value = '';

    if (wasEmpty && player) {
        // Tự động play khi thêm bài đầu tiên
        playVideoAtIndex(0, true); 
    }
});


const renderPlaylist = () => {
    playlistListEl.innerHTML = ''; 
    
    if (currentPlaylist.length === 0) {
        playlistListEl.innerHTML = '<li style="text-align:center; color:#9ca3af; padding: 15px;">Playlist rỗng. Hãy thêm nhạc!</li>';
        return;
    }

    currentPlaylist.forEach((song, index) => {
        const li = document.createElement('li');
        li.setAttribute('draggable', 'true');
        li.dataset.id = song.id;

        li.innerHTML = `
            <span>${song.title}</span>
            <button data-id="${song.id}"><i class="fas fa-trash-alt"></i></button>
        `;
        
        if (index === currentTrackIndex) {
            li.classList.add('current-track');
        }
        
        li.querySelector('span').addEventListener('click', () => {
            if (player) {
                if (index === currentTrackIndex && player.getPlayerState() !== 2) { 
                    togglePlayback();
                } else {
                    playVideoAtIndex(index, true); 
                }
            }
        });
        
        li.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation(); 
            const idToRemove = parseInt(e.target.closest('button').dataset.id); 
            currentPlaylist = currentPlaylist.filter(s => s.id !== idToRemove);
            
            // Xử lý lại currentTrackIndex sau khi xóa
            if (index === currentTrackIndex) {
                currentTrackIndex = -1; // Đặt lại để load bài tiếp theo
                playNextTrack(); 
            } else if (index < currentTrackIndex) {
                currentTrackIndex--;
            }
            savePlaylist();
        });

        // Logic kéo thả (Drag & Drop)
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('dragend', handleDragEnd);

        playlistListEl.appendChild(li);
    });
};

let draggingItem = null;
function handleDragStart(e) {
    draggingItem = this;
    setTimeout(() => this.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.id);
}
function handleDragEnd() {
    this.classList.remove('dragging');
    this.classList.remove('drag-over');
    draggingItem = null;
    savePlaylist();
}
function handleDragOver(e) {
    e.preventDefault(); 
    if (draggingItem && draggingItem !== this) {
        this.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    }
}
function handleDragLeave() {
    this.classList.remove('drag-over');
}
function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    if (draggingItem && draggingItem !== this) {
        const draggedId = parseInt(draggingItem.dataset.id);
        const droppedId = parseInt(this.dataset.id);
        
        const draggedIndex = currentPlaylist.findIndex(song => song.id === draggedId);
        const droppedIndex = currentPlaylist.findIndex(song => song.id === droppedId);

        const [movedItem] = currentPlaylist.splice(draggedIndex, 1);
        currentPlaylist.splice(droppedIndex, 0, movedItem);

        if (currentTrackIndex === draggedIndex) {
            currentTrackIndex = droppedIndex;
        } else if (currentTrackIndex > draggedIndex && currentTrackIndex <= droppedIndex) {
            currentTrackIndex--;
        } else if (currentTrackIndex < draggedIndex && currentTrackIndex >= droppedIndex) {
            currentTrackIndex++;
        }

        renderPlaylist();
    }
}


// =======================================================
//                   INIT & MODAL EVENTS
// =======================================================

const init = () => {
    loadPlaylist();
    updateStudyTimeSetting(); 
    renderPlaylist();
    updateDisplay();
    
    // Xử lý Khôi phục Session
    if (loadSession()) {
        showRestoreModal();
    }
};

// Đóng Modal khi click X hoặc ngoài Modal
modalCloseBtn.onclick = () => { restoreModalEl.style.display = 'none'; localStorage.removeItem(SESSION_KEY);};
window.onclick = (event) => {
    if (event.target === restoreModalEl) {
        restoreModalEl.style.display = 'none';
        localStorage.removeItem(SESSION_KEY);
    }
};


// 1. Event Khôi phục Timer
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    updateDisplay();
    
    if (timer.isRunning) {
        isRunning = true;
        startPauseBtn.textContent = '⏸ Tạm Dừng';
        startTimer();
    }
    
    // Đã khôi phục Timer, chuyển sang hỏi Video
    document.getElementById('modal-timer-section').style.display = 'none';
    
    // Nếu không có video để hỏi, đóng modal luôn
    if (document.getElementById('modal-video-section').style.display === 'none') {
        restoreModalEl.style.display = 'none';
        localStorage.removeItem(SESSION_KEY);
    }
};

// 2. Event Bỏ qua Timer
btnSkipTimer.onclick = () => {
    // Ẩn Timer, giữ nguyên Video để người dùng quyết định
    document.getElementById('modal-timer-section').style.display = 'none';
    // Nếu không có video, đóng modal
    if (document.getElementById('modal-video-section').style.display === 'none') {
        restoreModalEl.style.display = 'none';
        localStorage.removeItem(SESSION_KEY);
    }
};

// 3. Event Khôi phục Video
btnRestoreVideo.onclick = (e) => {
    const startTime = parseInt(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    if (player && currentPlaylist.length > index) {
        // Khôi phục video và play ngay tại thời điểm đã lưu
        playVideoAtIndex(index, true, startTime);
    }
    restoreModalEl.style.display = 'none';
    localStorage.removeItem(SESSION_KEY);
};

// 4. Event Bỏ qua Video
btnSkipVideo.onclick = () => {
    // Nếu có playlist, load video đầu tiên (hoặc hiện tại) nhưng không play
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); // Load video từ đầu, không play
    }
    restoreModalEl.style.display = 'none';
    localStorage.removeItem(SESSION_KEY);
};


window.onload = init;
