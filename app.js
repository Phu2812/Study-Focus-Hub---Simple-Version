// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const SETTINGS_KEY = 'timer_settings_store'; // KEY MỚI: Lưu cài đặt Giờ/Phút/Chu kỳ
const THEME_KEY = 'app_theme_mode'; // KEY MỚI: Lưu chế độ Sáng/Tối
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 

// Cấu hình mặc định
const timerSettings = {
    study: 25 * 60, 
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    totalCycles: 4, 
    // Dữ liệu cài đặt thô (Giờ/Phút) để lưu vào Local Storage
    raw: {
        studyHour: 0, studyMinute: 25,
        shortBreakHour: 0, shortBreakMinute: 5,
        longBreakHour: 0, longBreakMinute: 15,
        totalCycles: 4
    }
};

let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0; 
let pendingRestore = { session: null, settings: null }; // Khôi phục cả Session và Settings

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

// Theme & Settings elements
const themeToggleBtn = document.getElementById('theme-toggle');
const settingsInputs = document.querySelectorAll('.settings-group input');


// Modal Elements
const videoRestoreModalEl = document.getElementById('video-restore-modal');
const timerRestoreModalEl = document.getElementById('timer-restore-modal');
const settingsRestoreModalEl = document.getElementById('settings-restore-modal'); // MODAL MỚI

const videoCloseBtn = document.querySelector('.modal-close-video');
const timerCloseBtn = document.querySelector('.modal-close-timer');
const settingsCloseBtn = document.querySelector('.modal-close-settings'); // NÚT CLOSE MỚI

const timerRestoreInfoEl = document.getElementById('timer-restore-info');
const videoRestoreInfoEl = document.getElementById('video-restore-info');
const settingsRestoreInfoEl = document.getElementById('settings-restore-info'); // INFO MỚI
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const btnRestoreSettings = document.getElementById('btn-restore-settings'); // NÚT MỚI
const btnSkipSettings = document.getElementById('btn-skip-settings'); // NÚT MỚI

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
//                   SETTINGS PERSISTENCE LOGIC
// =======================================================

/**
 * Lưu cài đặt giờ/phút/chu kỳ hiện tại vào Local Storage
 */
const saveTimerSettings = () => {
    const rawSettings = {};
    settingsInputs.forEach(input => {
        rawSettings[input.id.replace('setting-', '')] = parseInt(input.value || 0);
    });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rawSettings));
};

/**
 * Tải cài đặt giờ/phút/chu kỳ từ Local Storage (không áp dụng vào input)
 * @returns {Object|null} Cài đặt thô hoặc null
 */
const loadTimerSettings = () => {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
        return JSON.parse(data);
    }
    return null;
};

/**
 * Áp dụng cài đặt đã tải (hoặc khôi phục) vào các ô input
 * @param {Object} rawSettings - Dữ liệu cài đặt thô
 */
const applySettingsToInputs = (rawSettings) => {
    for (const key in rawSettings) {
        const inputEl = document.getElementById(`setting-${key}`);
        if (inputEl) {
            inputEl.value = rawSettings[key];
        }
    }
};

/**
 * Tạo chuỗi thông tin để hiển thị trong Modal Settings
 * @param {Object} rawSettings - Dữ liệu cài đặt thô
 * @returns {string} Chuỗi HTML thông tin cài đặt
 */
const formatSettingsInfo = (rawSettings) => {
    return `
        Học: <strong>${rawSettings.studyHour}h ${rawSettings.studyMinute}m</strong><br>
        Nghỉ Ngắn: <strong>${rawSettings.shortBreakHour}h ${rawSettings.shortBreakMinute}m</strong><br>
        Nghỉ Dài: <strong>${rawSettings.longBreakHour}h ${rawSettings.longBreakMinute}m</strong><br>
        Chu kỳ: <strong>${rawSettings.totalCycles}</strong>
    `;
};


// =======================================================
//                   SESSION & RESTORE LOGIC
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
        pendingRestore.session = JSON.parse(data);
        return true;
    }
    pendingRestore.session = null;
    return false;
};

const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    settingsRestoreModalEl.style.display = 'none'; // Đóng modal settings
    
    localStorage.removeItem(SESSION_KEY);
    // KHÔNG xóa SETTINGS_KEY ở đây
    pendingRestore.session = null;
    
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
    calculateTimerSettings(); 
    resetTimerToCurrentMode(); 
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    if (player && player.getPlayerState() === 1) { 
         player.pauseVideo();
    }
};


// -----------------------------------------------------------------
// Logic hiển thị Modal Tuần tự (Settings -> Video -> Timer)
// -----------------------------------------------------------------

const showRestoreModal = () => {
    const savedSettings = loadTimerSettings();
    const isSettingsAvailable = savedSettings !== null;
    const isSessionAvailable = loadSession();
    
    if (isSettingsAvailable) {
        pendingRestore.settings = savedSettings;
        showSettingsRestorePhase();
    } else if (isSessionAvailable) {
        showVideoRestorePhase(); // Bỏ qua Settings, chuyển sang Video
    }
    // Nếu không có gì để khôi phục, init bình thường.
};


const showSettingsRestorePhase = () => {
    if (!pendingRestore.settings) {
        if (pendingRestore.session) {
            showVideoRestorePhase();
        }
        return;
    }
    
    settingsRestoreInfoEl.innerHTML = formatSettingsInfo(pendingRestore.settings);
    settingsRestoreModalEl.style.display = 'flex';
};

const showVideoRestorePhase = () => {
    if (!pendingRestore.session) {
        return;
    }

    const { currentMode: savedMode, timeLeft: savedTime, cycleCount: savedCycles } = pendingRestore.session.timer;
    const { currentTrackIndex: savedIndex, videoCurrentTime: savedVTime } = pendingRestore.session.player;
    
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
        btnRestoreVideo.dataset.play = pendingRestore.session.player.wasPlaying; 
        
        videoRestoreModalEl.style.display = 'flex';
        timerRestoreModalEl.style.display = 'none'; 
        settingsRestoreModalEl.style.display = 'none';
    } else {
        // 2. Nếu không có video để khôi phục, chuyển thẳng sang Modal Timer
        showTimerRestorePhase();
    }
};

const showTimerRestorePhase = () => {
    if (!pendingRestore.session) {
        return;
    }
    const { timeLeft: savedTime } = pendingRestore.session.timer;

    if (savedTime > 0) {
        // Hiển thị Modal Timer
        timerRestoreModalEl.style.display = 'flex';
        videoRestoreModalEl.style.display = 'none'; 
        settingsRestoreModalEl.style.display = 'none';
    } else {
        // Hết dữ liệu để khôi phục (Timer = 0 hoặc đã kết thúc)
        closeAllModalsAndClearSession();
    }
};


// =======================================================
//                   4. POMODORO TIMER LOGIC
// =======================================================

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
    const modeText = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 
                     (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerModeEl.textContent = modeText;
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    
    // Cập nhật viền đồng hồ theo mode
    const boxEl = document.querySelector('.timer-display-box');
    boxEl.className = `timer-display-box ${currentMode === 'study' ? 'study-mode' : 'break-mode'}`;

    const totalCycles = timerSettings.totalCycles;
    const currentCycle = cycleCount % totalCycles;
    const displayCycle = currentCycle === 0 && cycleCount > 0 ? totalCycles : currentCycle;
    cycleInfoEl.textContent = `Chu kỳ: ${displayCycle} / ${totalCycles}`;
    
    document.title = `${formatTime(timeLeft)} - ${modeText}`;
};

/**
 * CHỈ tính toán lại giá trị từ input và lưu vào timerSettings & Local Storage.
 * HÀM NÀY KHÔNG ĐƯỢC RESET timeLeft.
 */
const calculateTimerSettings = () => {
    
    // 1. Đọc và lưu dữ liệu thô
    const rawSettings = {};
    rawSettings.studyHour = parseInt(document.getElementById('setting-study-hour').value || 0);
    rawSettings.studyMinute = parseInt(document.getElementById('setting-study-minute').value || 0);
    rawSettings.shortBreakHour = parseInt(document.getElementById('setting-short-break-hour').value || 0);
    rawSettings.shortBreakMinute = parseInt(document.getElementById('setting-short-break-minute').value || 0);
    rawSettings.longBreakHour = parseInt(document.getElementById('setting-long-break-hour').value || 0);
    rawSettings.longBreakMinute = parseInt(document.getElementById('setting-long-break-minute').value || 0);
    rawSettings.totalCycles = parseInt(document.getElementById('setting-total-cycles').value || 4);
    
    timerSettings.raw = rawSettings;

    // 2. Tính toán và lưu giá trị giây
    timerSettings.study = Math.max(60, (rawSettings.studyHour * 3600) + (rawSettings.studyMinute * 60)); 
    timerSettings.shortBreak = Math.max(60, (rawSettings.shortBreakHour * 3600) + (rawSettings.shortBreakMinute * 60));
    timerSettings.longBreak = Math.max(60, (rawSettings.longBreakHour * 3600) + (rawSettings.longBreakMinute * 60));
    timerSettings.totalCycles = Math.max(1, rawSettings.totalCycles);
    
    // 3. Lưu settings thô vào Local Storage
    saveTimerSettings(); 
};

/**
 * Áp dụng giá trị thời gian đầy đủ cho chế độ hiện tại.
 * Chỉ dùng khi khởi tạo, Reset, hoặc chuyển mode.
 */
const resetTimerToCurrentMode = () => {
    timeLeft = timerSettings[currentMode];
    updateDisplay();
}


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
                    if (cycleCount % totalCycles === 0) {
                        currentMode = 'longBreak';
                    } else {
                        currentMode = 'shortBreak';
                    }
                } else { 
                    currentMode = 'study';
                }
                
                resetTimerToCurrentMode(); 
                
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


// Events cho Pomodoro
startPauseBtn.addEventListener('click', () => {
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
    calculateTimerSettings(); 
    if (isRunning || timeLeft > 0) {
        switchMode(true); 
    }
});


document.getElementById('btn-reset').addEventListener('click', () => {
    initDefaultState();
    localStorage.removeItem(SESSION_KEY);
});

// Lắng nghe sự kiện thay đổi trên TẤT CẢ input cài đặt
settingsInputs.forEach(input => { 
    input.addEventListener('change', () => {
        calculateTimerSettings(); 
        
        // Nếu timer đang DỪNG, thì reset lại thời gian trên màn hình
        if (!isRunning) {
            resetTimerToCurrentMode();
        }
    });
});


if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

window.addEventListener('beforeunload', saveSession);


// =======================================================
//                   5. THEME TOGGLE LOGIC
// =======================================================

const loadTheme = () => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light-mode') {
        document.body.classList.add('light-mode');
        themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
        document.body.classList.remove('light-mode');
        themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }
};

const toggleTheme = () => {
    if (document.body.classList.contains('light-mode')) {
        document.body.classList.remove('light-mode');
        localStorage.setItem(THEME_KEY, 'dark-mode');
    } else {
        document.body.classList.add('light-mode');
        localStorage.setItem(THEME_KEY, 'light-mode');
    }
    // Cập nhật icon sau khi thay đổi mode
    loadTheme();
};

themeToggleBtn.addEventListener('click', toggleTheme);


// =======================================================
//                   6. YOUTUBE PLAYER LOGIC (Giữ nguyên)
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
        if (currentTrackIndex === -1 && !pendingRestore.session) {
            currentTrackIndex = 0;
            player.cueVideoById(currentPlaylist[currentTrackIndex].videoId); 
        } else if (currentTrackIndex === -1 && pendingRestore.session) {
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
        autoplay: 0 
    }); 
    
    renderPlaylist(); 

    if (forcePlay) {
         let attempts = 0;
         const maxAttempts = 10; 
         
         const tryPlay = () => {
             const state = player.getPlayerState();
             if (state === 1) return; 

             if (state === 3 || state === 5 || state === 2) { 
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
//                   7. PLAYLIST MANAGER & DRAG & DROP (Giữ nguyên)
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
        playlistListEl.innerHTML = '<li style="text-align:center; color:var(--text-secondary); padding: 15px; background: none;">Playlist rỗng. Hãy thêm nhạc!</li>';
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
//                   8. INIT & MODAL EVENTS
// =======================================================

const init = () => {
    // 1. Load Theme
    loadTheme(); 
    
    // 2. Load Dữ liệu
    loadPlaylist();
    calculateTimerSettings(); // Tính toán settings từ input (mặc định)
    resetTimerToCurrentMode(); 
    renderPlaylist();
    
    // 3. Khởi tạo Notification
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
    
    // 4. Kiểm tra và hiển thị Modal khôi phục (Ưu tiên Settings)
    showRestoreModal();
};

// --- XỬ LÝ NÚT BẤM MODAL ---

settingsCloseBtn.onclick = () => { btnSkipSettings.onclick(); }; 
videoCloseBtn.onclick = () => { btnSkipVideo.onclick(); }; 
timerCloseBtn.onclick = () => { btnSkipTimer.onclick(); }; 

// Settings Modal Events
btnRestoreSettings.onclick = () => {
    if (pendingRestore.settings) {
        applySettingsToInputs(pendingRestore.settings); // Áp dụng cài đặt vào input
        calculateTimerSettings(); // Tính toán lại timerSettings từ input mới
        resetTimerToCurrentMode(); // Cập nhật đồng hồ theo cài đặt mới
    }
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};

btnSkipSettings.onclick = () => {
    // Giữ cài đặt hiện tại trên input, chỉ cần tính toán lại
    calculateTimerSettings(); 
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};


// Video Modal Events (Giữ nguyên)
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

// Timer Modal Events (Giữ nguyên)
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore.session;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    
    calculateTimerSettings(); 
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
