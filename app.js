// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 

// Cấu hình mặc định cho các mode (sẽ được cập nhật từ input)
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
let pendingRestore = null; 

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
const videoRestoreModalEl = document.getElementById('video-restore-modal');
const timerRestoreModalEl = document.getElementById('timer-restore-modal');

const videoCloseBtn = document.querySelector('.modal-close-video');
const timerCloseBtn = document.querySelector('.modal-close-timer');

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
    if (isRunning || currentPlaylist.length > 0 || timeLeft < timerSettings[currentMode]) {
        let videoTime = 0;
        let playerState = 0; 

        if (player && typeof player.getCurrentTime === 'function') {
            videoTime = Math.floor(player.getCurrentTime());
            playerState = player.getPlayerState();
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
                wasPlaying: playerState === 1 
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

const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    localStorage.removeItem(SESSION_KEY);
    pendingRestore = null;
    
    if (!isRunning) {
        initDefaultState();
    }
    if (currentPlaylist.length > 0 && currentTrackIndex === -1 && player) {
        currentTrackIndex = 0;
        player.cueVideoById(currentPlaylist[currentTrackIndex].videoId);
        renderPlaylist();
    }
};

const initDefaultState = () => {
    clearInterval(intervalId);
    isRunning = false;
    currentMode = 'study';
    updateTimerSettings(); // Cập nhật lại thời gian theo cài đặt input
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    updateDisplay();
    if (player && player.getPlayerState() === 1) { 
         player.pauseVideo();
    }
};

// -----------------------------------------------------------------
// Logic hiển thị Modal Tuần tự (Video -> Timer)
// -----------------------------------------------------------------

const showRestoreModal = () => {
    if (!pendingRestore) return;

    showVideoRestorePhase();
};

const showVideoRestorePhase = () => {
    const { currentMode: savedMode, timeLeft: savedTime, cycleCount: savedCycles } = pendingRestore.timer;
    const { currentTrackIndex: savedIndex, videoCurrentTime: savedVTime } = pendingRestore.player;
    
    const currentVideo = currentPlaylist[savedIndex];
    const hasVideoData = currentVideo && savedIndex !== -1;

    // Chuẩn bị Timer Info
    const timeFormatted = formatTime(savedTime);
    const modeName = savedMode === 'study' ? 'TẬP TRUNG HỌC' : 
                     (savedMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerRestoreInfoEl.innerHTML = `Chế độ: <strong>${modeName}</strong><br>Thời gian còn lại: <strong>${timeFormatted}</strong><br>Chu kỳ đã hoàn thành: <strong>${savedCycles}</strong>`;

    if (hasVideoData) {
        // 1. Hiển thị Modal Video
        const vTimeFormatted = formatTime(savedVTime);
        videoRestoreInfoEl.innerHTML = `Video: <strong>${currentVideo.title}</strong><br>Tiếp tục tại: <strong>${vTimeFormatted}</strong>`;
        
        btnRestoreVideo.dataset.time = savedVTime;
        btnRestoreVideo.dataset.index = savedIndex;
        btnRestoreVideo.dataset.play = pendingRestore.player.wasPlaying; 
        
        videoRestoreModalEl.style.display = 'flex';
        timerRestoreModalEl.style.display = 'none'; 
    } else {
        // 2. Nếu không có video để khôi phục, chuyển thẳng sang Modal Timer
        showTimerRestorePhase();
    }
};

const showTimerRestorePhase = () => {
    const { timeLeft: savedTime } = pendingRestore.timer;

    if (savedTime > 0) {
        // Hiển thị Modal Timer
        timerRestoreModalEl.style.display = 'flex';
        videoRestoreModalEl.style.display = 'none'; 
    } else {
        // Hết dữ liệu để khôi phục (Timer = 0 hoặc đã kết thúc)
        closeAllModalsAndClearSession();
    }
};


// =======================================================
//                   3. POMODORO TIMER LOGIC
// =======================================================

/**
 * Định dạng thời gian (giây) thành chuỗi H:MM:SS hoặc MM:SS.
 */
const formatTime = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const s = seconds.toString().padStart(2, '0');
    const m = minutes.toString().padStart(2, '0');
    
    if (hours > 0) {
        return `${hours}:${m}:${s}`;
    } else {
        return `${m}:${s}`;
    }
};

const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 
                               (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    timerCardEl.style.backgroundColor = currentMode === 'study' ? 'rgba(255, 99, 71, 0.1)' : 'rgba(60, 179, 113, 0.1)';
    
    const totalCycles = timerSettings.totalCycles;
    const currentCycle = cycleCount % totalCycles;
    const displayCycle = currentCycle === 0 && cycleCount > 0 ? totalCycles : currentCycle;
    cycleInfoEl.textContent = `Chu kỳ: ${displayCycle} / ${totalCycles}`;
    
    document.title = `${formatTime(timeLeft)} - ${timerModeEl.textContent}`;
};

/**
 * Lấy giây từ input Giờ/Phút của một chế độ
 */
const getSecondsFromInputs = (mode) => {
    const hourInput = document.getElementById(`setting-${mode}-hour`);
    const minuteInput = document.getElementById(`setting-${mode}-minute`);
    
    const hours = parseInt(hourInput.value || 0);
    const minutes = parseInt(minuteInput.value || 0);
    
    // Đảm bảo thời gian tối thiểu là 1 phút (60 giây) nếu cả giờ và phút đều bằng 0
    let totalSeconds = (hours * 3600) + (minutes * 60);
    return Math.max(60, totalSeconds);
}


/**
 * Lấy giá trị từ input Giờ/Phút/Chu kỳ và cập nhật lại timerSettings.
 * CHỈ reset timeLeft về giá trị đầy đủ nếu Timer đang dừng (!isRunning).
 */
const updateTimerSettings = () => {
    
    // 1. Cập nhật 3 chế độ từ input
    timerSettings.study = getSecondsFromInputs('study'); 
    timerSettings.shortBreak = getSecondsFromInputs('short-break');
    timerSettings.longBreak = getSecondsFromInputs('long-break');
    
    // 2. Cập nhật chu kỳ
    const totalCycles = parseInt(document.getElementById('setting-total-cycles').value || 4);
    timerSettings.totalCycles = Math.max(1, totalCycles);
    
    // 3. Cập nhật timeLeft nếu timer đang ở trạng thái dừng
    if (!isRunning) {
        timeLeft = timerSettings[currentMode];
        updateDisplay();
    }
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
                    if (cycleCount % totalCycles === 0) { // Kiểm tra nếu là cuối chu kỳ (ví dụ 4/4)
                        currentMode = 'longBreak';
                        // Đảm bảo lấy thời gian mới nhất
                        timeLeft = timerSettings.longBreak; 
                    } else {
                        currentMode = 'shortBreak';
                        // Đảm bảo lấy thời gian mới nhất
                        timeLeft = timerSettings.shortBreak; 
                    }
                } else { 
                    // Sau break (ngắn hoặc dài), quay lại study
                    currentMode = 'study';
                    // Đảm bảo lấy thời gian mới nhất
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
            // Không cần gọi updateTimerSettings ở đây, chỉ cần gọi khi cần chuyển mode/reset
            switchMode(true); 
        } else {
            updateDisplay();
        }
    }, 1000);
};


// Events cho Pomodoro
startPauseBtn.addEventListener('click', () => {
    // *** FIX LỖI RESET TIMER ***
    // Đã loại bỏ lệnh gọi updateTimerSettings() khỏi sự kiện này
    // để tránh reset timeLeft khi resume (isRunning chuyển từ false -> true).
    
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
    // Gọi updateTimerSettings để đảm bảo thời gian cho mode tiếp theo là mới nhất
    updateTimerSettings(); 
    if (isRunning || timeLeft > 0) {
        switchMode(true); 
    }
});


document.getElementById('btn-reset').addEventListener('click', () => {
    initDefaultState();
    localStorage.removeItem(SESSION_KEY);
});

// Lắng nghe sự kiện thay đổi trên TẤT CẢ input cài đặt
document.querySelectorAll('.settings-group input').forEach(input => { 
    // Gắn updateTimerSettings() trực tiếp vào sự kiện thay đổi input
    input.addEventListener('change', updateTimerSettings);
});


if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

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
    const placeholderEl = document.getElementById('player-placeholder');
    if (placeholderEl) {
        placeholderEl.style.display = 'none';
    }
    
    playPauseIcon.classList.add('fa-play');

    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1 && !pendingRestore) {
            currentTrackIndex = 0;
            player.cueVideoById(currentPlaylist[currentTrackIndex].videoId); 
        } else if (currentTrackIndex === -1 && pendingRestore) {
             // Chờ modal khôi phục xử lý
        } else {
            player.cueVideoById(currentPlaylist[currentTrackIndex].videoId); 
        }
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
        autoplay: 0 // luôn đặt 0, sau đó dùng tryPlay
    }); 
    
    renderPlaylist(); 

    if (forcePlay) {
         let attempts = 0;
         const maxAttempts = 10; 
         
         const tryPlay = () => {
             const state = player.getPlayerState();
             if (state === 1) return; // Đã chơi, kết thúc

             if (state === 3 || state === 5 || state === 2) { // Buffering, Cued, hoặc Paused - Sẵn sàng để chơi
                 player.playVideo();
                 return;
             }
             if (attempts < maxAttempts) {
                 attempts++;
                 setTimeout(tryPlay, 100);
             } else {
                 console.warn("Không thể buộc video phát sau 1 giây. Trạng thái:", state);
             }
         };
         
         setTimeout(tryPlay, 100); 
    }
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
    } else if (state === 2 || state === 5) { 
        player.playVideo();
    } else if (state === -1 && currentPlaylist.length > 0) {
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
            
            if (index === currentTrackIndex) {
                currentTrackIndex = -1; 
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
    updateTimerSettings(); 
    renderPlaylist();
    updateDisplay();
    
    // Yêu cầu quyền truy cập Notification nếu chưa có
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
    
    if (loadSession()) {
        showRestoreModal();
    }
};

// --- XỬ LÝ NÚT BẤM MODAL ---
videoCloseBtn.onclick = () => { btnSkipVideo.onclick(); }; 
timerCloseBtn.onclick = () => { btnSkipTimer.onclick(); }; 

btnRestoreVideo.onclick = (e) => {
    const startTime = parseInt(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    const wasPlaying = e.target.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); 
};

btnSkipVideo.onclick = () => {
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); 
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); 
};

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
    
    closeAllModalsAndClearSession(); 
};

btnSkipTimer.onclick = () => {
    initDefaultState(); 
    closeAllModalsAndClearSession(); 
};


window.onload = init;
