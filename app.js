// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const SETTINGS_KEY = 'timer_settings_store'; 
const THEME_KEY = 'app_theme_mode'; 
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 
const DEFAULT_ALARM_SOUND = 'sounds/alarm.mp3'; // Đảm bảo file này tồn tại

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let isRunning = false; 
let timeLeft = 0; 
let initialTime = 0; // TỔNG thời gian ban đầu của mode hiện tại (để tính Progress Circle)
let pendingRestore = null; // Dùng để lưu dữ liệu khôi phục tạm thời

// Cấu hình mặc định (Đơn vị: Giây)
const timerSettings = {
    study: 25 * 60, // 25 phút
    shortBreak: 5 * 60, // 5 phút
    longBreak: 15 * 60, // 15 phút
    totalCycles: 4, 
    // Dữ liệu cài đặt thô (Đơn vị: Phút) để lưu vào Local Storage
    raw: {
        study: 25, 
        shortBreak: 5, 
        longBreak: 15, 
        totalCycles: 4
    }
};

let currentMode = 'study';
let cycleCount = 0;

// =======================================================
//                   DOM ELEMENTS
// =======================================================

const countdownEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const resetBtn = document.getElementById('btn-reset');
const btnSettings = document.getElementById('btn-settings');
const settingsAreaEl = document.getElementById('settings-area');
const progressCircleEl = document.getElementById('progress-circle');

// Settings Inputs
const studyInput = document.getElementById('study-time');
const shortBreakInput = document.getElementById('short-break-time');
const longBreakInput = document.getElementById('long-break-time');
const cyclesInput = document.getElementById('total-cycles');

// Video Player & Playlist
const playlistListEl = document.getElementById('playlist-list');
const btnAddSong = document.getElementById('btn-add-song');
const youtubeUrlInput = document.getElementById('youtube-url');
const errorMessageEl = document.getElementById('error-message');
const playerPlaceholderEl = document.getElementById('player-placeholder');
const videoContainerEl = document.getElementById('youtube-player');
const nextBtn = document.getElementById('btn-next');
const prevBtn = document.getElementById('btn-prev');

// Modals
const videoRestoreModalEl = document.getElementById('video-restore-modal');
// ĐÃ XÓA: timerRestoreModalEl
const settingsRestoreModalEl = document.getElementById('settings-restore-modal');

const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const btnRestoreSettings = document.getElementById('btn-restore-settings');
const btnSkipSettings = document.getElementById('btn-skip-settings');

// Audio Element
const alarmSound = document.getElementById('alarm-sound'); 

// Theme Toggle
const themeToggleBtn = document.getElementById('theme-toggle');

// =======================================================
//                   COMMON UTILS
// =======================================================

/**
 * Định dạng thời gian (giây) thành chuỗi MM:SS.
 */
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

/**
 * Cập nhật hiển thị thời gian và Progress Circle.
 */
const updateDisplay = () => {
    countdownEl.textContent = formatTime(timeLeft);
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerModeEl.className = currentMode + '-mode';
    cycleInfoEl.textContent = `Chu kỳ: ${cycleCount} / ${timerSettings.totalCycles}`;

    // Tính toán và cập nhật Progress Circle
    const percentage = 100 - (timeLeft / initialTime) * 100;
    progressCircleEl.style.background = `conic-gradient(
        var(--color-${currentMode === 'study' ? 'study' : 'break'}) ${percentage}%, 
        var(--circle-bg) ${percentage}%
    )`;
};

/**
 * Đặt lại Timer về mode hiện tại (đầu phiên).
 */
const resetTimerToCurrentMode = () => {
    // Đặt lại thời gian về phút ban đầu của mode hiện tại
    timeLeft = timerSettings[currentMode];
    initialTime = timerSettings[currentMode];
    
    // Đảm bảo không còn chạy
    clearInterval(intervalId);
    intervalId = null;
    isRunning = false;
    startPauseBtn.innerHTML = '▶ Bắt Đầu';
    
    updateDisplay();
    saveSession();
};

/**
 * Đặt lại Timer về mode Study mặc định (dùng cho nút Reset).
 */
const resetTimer = () => {
    currentMode = 'study';
    cycleCount = 0;
    resetTimerToCurrentMode();
};

// =======================================================
//                   TIMER LOGIC
// =======================================================

/**
 * Hàm chính của Timer.
 */
const startTimer = () => {
    if (intervalId !== null) return; 

    isRunning = true;
    startPauseBtn.innerHTML = '⏸ Tạm Dừng';

    // Đảm bảo initialTime được set đúng trước khi đếm
    if (initialTime === 0 || initialTime !== timerSettings[currentMode]) {
        initialTime = timerSettings[currentMode];
    }

    intervalId = setInterval(() => {
        timeLeft--;
        updateDisplay();
        saveSession(); // Lưu trạng thái sau mỗi giây

        if (timeLeft <= 0) {
            clearInterval(intervalId);
            intervalId = null;
            switchMode();
        }
    }, 1000);
};

/**
 * Tạm dừng Timer.
 * @param {boolean} shouldToggleBtn - Có nên cập nhật nút Start/Pause không.
 */
const pauseTimer = (shouldToggleBtn = true) => {
    clearInterval(intervalId);
    intervalId = null;
    isRunning = false;
    if (shouldToggleBtn) {
        startPauseBtn.innerHTML = '▶ Tiếp Tục';
    }
    saveSession();
};

// =======================================================
//                   MODE SWITCHING & ALARM
// =======================================================

/**
 * Phát và Fade Out âm thanh báo thức.
 * ĐÃ SỬA: Đảm bảo âm thanh phát trước khi thao tác video.
 */
const fadeAlarm = () => {
    return new Promise((resolve) => {
        alarmSound.volume = 0.5;
        alarmSound.currentTime = 0;
        
        // Cố gắng phát (dùng catch để xử lý lỗi chặn Autoplay, nhưng vẫn cố gắng resolve)
        alarmSound.play().catch(e => {
            console.warn("Trình duyệt chặn phát âm thanh thông báo. Vui lòng tương tác (click) với trang.", e);
        }); 
        
        const ALARM_TOTAL_DURATION = 3000; // Tổng thời gian báo thức (3 giây)
        const startTime = Date.now();
        let volume = 0.5;

        // Bắt đầu interval giảm dần âm lượng
        const fadeInterval = setInterval(() => {
            // Giảm dần sau 2 giây
            if (Date.now() - startTime >= 2000) { 
                 volume -= 0.05; 
            }
            
            if (volume <= 0 || Date.now() - startTime >= ALARM_TOTAL_DURATION) {
                clearInterval(fadeInterval);
                alarmSound.pause();
                alarmSound.currentTime = 0; 
                alarmSound.volume = 0.5; 
                resolve(); // QUAN TRỌNG: Resolve sau khi báo thức kết thúc
                return;
            }
            
            alarmSound.volume = Math.max(0, volume);
        }, ALARM_FADE_DURATION / 10); 

        // Đảm bảo resolve sau 3 giây, kể cả khi lỗi interval
        setTimeout(() => {
            clearInterval(fadeInterval);
            alarmSound.pause();
            alarmSound.volume = 0.5;
            resolve();
        }, ALARM_TOTAL_DURATION + 50); // Thêm 50ms để đảm bảo hoàn tất
    });
};


/**
 * Hàm chuyển mode Pomodoro. 
 * ĐÃ SỬA: Báo thức chạy xong mới tạm dừng video.
 */
const switchMode = async () => {
    // 1. Dừng Timer hiện tại
    pauseTimer(false); 

    // 2. Lưu trạng thái video trước khi tạm dừng
    let shouldResumeVideo = false;
    if (player) {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
            shouldResumeVideo = true;
        }
    }
    
    // 3. Phát và chờ báo thức kết thúc (3 giây)
    // Đảm bảo báo thức đã phát xong trước khi thao tác video player
    await fadeAlarm(); 
    
    // 4. TẠM DỪNG VIDEO SAU KHI BÁO THỨC XONG
    if (player && player.pauseVideo) {
         player.pauseVideo();
    }

    // 5. Chuyển Mode và Cập nhật Chu kỳ 
    if (currentMode === 'study') {
        cycleCount++;
        if (cycleCount % timerSettings.totalCycles === 0) {
            currentMode = 'longBreak';
        } else {
            currentMode = 'shortBreak';
        }
    } else { // shortBreak hoặc longBreak
        currentMode = 'study';
    }

    // 6. Reset và Tự động BẮT ĐẦU MODE MỚI
    resetTimerToCurrentMode(); 
    startTimer(); // Tự động bắt đầu

    // 7. Tự động phát lại video sau khi báo thức và chuyển mode xong (CHỈ KHI NÓ ĐANG CHẠY TRƯỚC ĐÓ)
    if (player && shouldResumeVideo && player.playVideo) {
        try {
            player.playVideo();
        } catch (e) {
            console.error("Lỗi tự động phát lại video:", e);
        }
    }
};


// =======================================================
//                   VIDEO PLAYER & PLAYLIST LOGIC (Giữ nguyên)
// =======================================================

// --- YouTube API functions ---
function onYouTubeIframeAPIReady() {
    createPlayer(currentPlaylist.length > 0 ? currentPlaylist[0].id : 'dQw4w9WgXcQ'); 
}

function createPlayer(videoId) {
    if (player) return; 
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    playerPlaceholderEl.style.display = 'none';
    videoContainerEl.style.display = 'block';
    checkRestoreStatus();
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        nextTrack();
    }
}

// --- Playlist logic ---
const getYouTubeId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\/(?:v|e)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return (match && match[1].length === 11) ? match[1] : null;
};

const addVideoToPlaylist = async () => {
    const url = youtubeUrlInput.value.trim();
    const videoId = getYouTubeId(url);
    errorMessageEl.textContent = '';

    if (!videoId) {
        errorMessageEl.textContent = 'Lỗi: URL YouTube không hợp lệ.';
        return;
    }

    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}https://www.youtube.com/watch?v=${videoId}&format=json`);
        const data = await response.json();
        
        const newTrack = {
            id: videoId,
            title: data.title || 'Video không tên'
        };
        
        currentPlaylist.push(newTrack);
        savePlaylist();
        renderPlaylist();
        youtubeUrlInput.value = '';

        if (currentPlaylist.length === 1) {
             currentTrackIndex = 0;
             playVideoById(videoId);
        }

    } catch (error) {
        errorMessageEl.textContent = 'Lỗi: Không thể lấy thông tin video. Vui lòng kiểm tra URL.';
    }
};

const renderPlaylist = () => {
    playlistListEl.innerHTML = '';
    if (currentPlaylist.length === 0) {
        playlistListEl.innerHTML = '<li class="empty-list">Chưa có video nào trong danh sách.</li>';
        return;
    }

    currentPlaylist.forEach((track, index) => {
        const listItem = document.createElement('li');
        listItem.className = `playlist-item ${index === currentTrackIndex ? 'active' : ''}`;
        listItem.dataset.index = index;
        listItem.innerHTML = `
            <span>${index + 1}. ${track.title}</span>
            <div class="playlist-controls">
                <button class="btn-icon btn-play"><i class="fas fa-play"></i></button>
                <button class="btn-icon btn-remove"><i class="fas fa-trash"></i></button>
            </div>
        `;
        
        listItem.querySelector('.btn-play').addEventListener('click', () => {
            playVideoAtIndex(index, true, 0);
        });

        listItem.querySelector('.btn-remove').addEventListener('click', (e) => {
            e.stopPropagation(); 
            removeTrack(index);
        });

        playlistListEl.appendChild(listItem);
    });
};

const playVideoById = (videoId, startSeconds = 0) => {
    if (player && player.loadVideoById) {
        player.loadVideoById(videoId, startSeconds);
    } else {
        createPlayer(videoId);
    }
};

const playVideoAtIndex = (index, autoPlay = true, startSeconds = 0) => {
    if (index < 0 || index >= currentPlaylist.length) return;

    currentTrackIndex = index;
    const videoId = currentPlaylist[index].id;
    
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.playlist-item[data-index="${index}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    playVideoById(videoId, startSeconds);

    if (!autoPlay) {
        if (player && player.pauseVideo) {
            player.pauseVideo();
        }
    }
    savePlaylist();
    saveSession();
};

const nextTrack = () => {
    if (currentPlaylist.length === 0) return;

    let newIndex = currentTrackIndex + 1;
    if (newIndex >= currentPlaylist.length) {
        newIndex = 0; 
    }
    playVideoAtIndex(newIndex);
};

const prevTrack = () => {
    if (currentPlaylist.length === 0) return;

    let newIndex = currentTrackIndex - 1;
    if (newIndex < 0) {
        newIndex = currentPlaylist.length - 1; 
    }
    playVideoAtIndex(newIndex);
};

const removeTrack = (index) => {
    if (index < 0 || index >= currentPlaylist.length) return;

    if (index === currentTrackIndex) {
        currentPlaylist.splice(index, 1);
        
        if (currentPlaylist.length === 0) {
            currentTrackIndex = -1;
            if (player && player.stopVideo) player.stopVideo();
            playerPlaceholderEl.style.display = 'flex';
            videoContainerEl.style.display = 'none';
        } else {
            currentTrackIndex = (index >= currentPlaylist.length) ? 0 : index;
            playVideoAtIndex(currentTrackIndex);
        }
    } else {
        currentPlaylist.splice(index, 1);
        if (index < currentTrackIndex) {
            currentTrackIndex--;
        }
    }

    savePlaylist();
    renderPlaylist();
    saveSession();
};


// =======================================================
//                   LƯU/TẢI DỮ LIỆU & MODALS
// =======================================================

/**
 * HÀM SỬA: Lưu Session (Video + Mode/Cycle) - KHÔNG LƯU THỜI GIAN CÒN LẠI (timeLeft)
 */
const saveSession = () => {
    // Chỉ lưu khi Timer đang chạy hoặc đang tạm dừng
    if (!isRunning && intervalId === null) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
    }

    // 1. Dữ liệu Video
    let videoData = null;
    if (player && currentPlaylist.length > 0 && currentTrackIndex !== -1) {
        videoData = {
            id: currentPlaylist[currentTrackIndex].id,
            index: currentTrackIndex,
            time: player.getCurrentTime(),
            isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING 
        };
    }
    
    // 2. Dữ liệu Session
    const sessionData = {
        video: videoData,
        timer: {
            // Chỉ lưu Mode, Cycle và trạng thái chạy/dừng
            currentMode: currentMode,
            cycleCount: cycleCount,
            isRunning: isRunning 
        }
    };

    // 3. Lưu
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
};

const loadPlaylist = () => {
    const savedPlaylist = localStorage.getItem(STORAGE_KEY);
    if (savedPlaylist) {
        const data = JSON.parse(savedPlaylist);
        currentPlaylist = data.playlist || [];
        currentTrackIndex = data.index !== undefined ? data.index : -1;
    }
};

const savePlaylist = () => {
    const data = {
        playlist: currentPlaylist,
        index: currentTrackIndex
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const loadSettings = () => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
        try {
            const rawSettings = JSON.parse(savedSettings);
            pendingRestore = pendingRestore || {};
            pendingRestore.settings = rawSettings;

        } catch(e) {
            console.error("Lỗi parse settings:", e);
        }
    }
    calculateTimerSettings();
};

const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings.raw));
};

const calculateTimerSettings = () => {
    // Chuyển đổi phút thô sang giây
    timerSettings.study = timerSettings.raw.study * 60;
    timerSettings.shortBreak = timerSettings.raw.shortBreak * 60;
    timerSettings.longBreak = timerSettings.raw.longBreak * 60;
    timerSettings.totalCycles = timerSettings.raw.totalCycles;

    // Cập nhật lại thời gian còn lại (timeLeft) nếu nó đang ở đầu mode
    if (timeLeft === 0 || timeLeft === initialTime) {
        initialTime = timerSettings[currentMode];
        timeLeft = initialTime;
        updateDisplay();
    }
};

const updateSettingsInputs = () => {
    studyInput.value = timerSettings.raw.study;
    shortBreakInput.value = timerSettings.raw.shortBreak;
    longBreakInput.value = timerSettings.raw.longBreak;
    cyclesInput.value = timerSettings.raw.totalCycles;
};

const applySettings = () => {
    const studyM = parseInt(studyInput.value);
    const shortM = parseInt(shortBreakInput.value);
    const longM = parseInt(longBreakInput.value);
    const cycles = parseInt(cyclesInput.value);
    
    if (studyM < 1 || shortM < 1 || longM < 1 || cycles < 1) {
        alert("Thời gian và chu kỳ phải lớn hơn 0.");
        return;
    }

    timerSettings.raw.study = studyM;
    timerSettings.raw.shortBreak = shortM;
    timerSettings.raw.longBreak = longM;
    timerSettings.raw.totalCycles = cycles;

    calculateTimerSettings();
    saveSettings();

    pauseTimer();
    resetTimerToCurrentMode();
    toggleSettings(); 
};

/**
 * HÀM MỚI: Tự động áp dụng trạng thái Timer đã lưu (Mode/Cycle) mà không cần hỏi.
 */
const applySavedTimerState = (timerData) => {
    // Khôi phục Mode và Cycle
    currentMode = timerData.currentMode;
    cycleCount = timerData.cycleCount;
    
    // ** QUAN TRỌNG: Đặt lại timeLeft về thời gian ĐẦU của mode đó **
    timeLeft = timerSettings[currentMode]; 
    
    calculateTimerSettings(); // Cập nhật initialTime cho Progress Circle
    updateDisplay(); 
    
    // Khôi phục trạng thái isRunning
    isRunning = timerData.isRunning;
    if (isRunning) {
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        startTimer(); // Bắt đầu lại Timer
    } else {
        startPauseBtn.textContent = '▶ Tiếp Tục';
    }
};

const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    settingsRestoreModalEl.style.display = 'none';
    sessionStorage.removeItem(SESSION_KEY);
    pendingRestore = null;
    
    if (timeLeft === 0) {
        initialTime = timerSettings.study;
        timeLeft = timerSettings.study;
        updateDisplay();
    }
};

/**
 * HÀM SỬA: Luồng khôi phục: Settings -> Video -> Apply Timer State -> Close
 */
const checkRestoreStatus = () => {
    // 1. Kiểm tra Settings (Vẫn cần hỏi)
    if (pendingRestore && pendingRestore.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
        return;
    }
    
    // 2. Kiểm tra Video (Vẫn cần hỏi)
    if (pendingRestore && pendingRestore.session && pendingRestore.session.video) {
        showVideoRestorePhase();
        return;
    } 

    // 3. Tự động áp dụng Timer State (KHÔNG CẦN HỎI)
    if (pendingRestore && pendingRestore.session && pendingRestore.session.timer) {
        applySavedTimerState(pendingRestore.session.timer);
    }
    
    // 4. Nếu không còn gì, đóng
    closeAllModalsAndClearSession();
};

const showSettingsRestorePhase = (rawSettings) => {
    let infoHtml = '<ul>';
    infoHtml += `<li>**Tập Trung:** ${rawSettings.study} phút</li>`;
    infoHtml += `<li>**Nghỉ Ngắn:** ${rawSettings.shortBreak} phút</li>`;
    infoHtml += `<li>**Nghỉ Dài:** ${rawSettings.longBreak} phút</li>`;
    infoHtml += `<li>**Tổng Chu Kỳ:** ${rawSettings.totalCycles}</li></ul>`;
    
    document.getElementById('settings-restore-info').innerHTML = infoHtml;

    btnRestoreSettings.dataset.settings = JSON.stringify(rawSettings);

    settingsRestoreModalEl.style.display = 'flex';
};

const showVideoRestorePhase = () => {
    const { video } = pendingRestore.session;
    const track = currentPlaylist[video.index];
    const restoreTimeDisplay = formatTime(video.time);

    document.getElementById('video-restore-info').innerHTML = `
        <p>Video: **${track ? track.title : 'Không rõ (Đã xóa)'}**</p>
        <p>Tiếp tục từ: **${restoreTimeDisplay}**</p>
    `;

    btnRestoreVideo.dataset.time = video.time;
    btnRestoreVideo.dataset.index = video.index;
    btnRestoreVideo.dataset.play = video.isPlaying;
    
    videoRestoreModalEl.style.display = 'flex';
};


// --- Theme Toggle ---

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
    document.body.classList.toggle('light-mode');
    const isLightMode = document.body.classList.contains('light-mode');
    localStorage.setItem(THEME_KEY, isLightMode ? 'light-mode' : 'dark-mode');
    themeToggleBtn.innerHTML = isLightMode ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
};

// =======================================================
//                   EVENT LISTENERS
// =======================================================

// --- Timer & Controls ---

startPauseBtn.addEventListener('click', () => isRunning ? pauseTimer() : startTimer());
resetBtn.addEventListener('click', resetTimer);
btnSettings.addEventListener('click', () => {
    updateSettingsInputs(); 
    toggleSettings();
});
document.getElementById('btn-apply-settings').addEventListener('click', applySettings);

function toggleSettings() {
    settingsAreaEl.classList.toggle('active');
}

// --- Playlist & Video Controls ---

btnAddSong.addEventListener('click', addVideoToPlaylist);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);

// --- Modal Close Buttons ---

document.querySelector('.modal-close-video').onclick = closeAllModalsAndClearSession;
document.querySelector('.modal-close-settings').onclick = closeAllModalsAndClearSession;
// ĐÃ XÓA: .modal-close-timer

// --- Modal Events ---

// 1. Settings Modal Events (Settings -> Video hoặc Apply Timer State)
btnRestoreSettings.onclick = (e) => {
    const rawSettings = JSON.parse(e.target.dataset.settings);
    
    timerSettings.raw = rawSettings;
    calculateTimerSettings(); 

    settingsRestoreModalEl.style.display = 'none';
    
    // Tiếp tục kiểm tra Video
    if (pendingRestore.session && pendingRestore.session.video) {
        showVideoRestorePhase(); 
    } 
    // Nếu không có Video, TỰ ĐỘNG áp dụng trạng thái Timer đã lưu
    else if (pendingRestore.session && pendingRestore.session.timer) {
        applySavedTimerState(pendingRestore.session.timer);
        closeAllModalsAndClearSession(); // Đóng ngay sau khi áp dụng Timer State
    }
    else {
        closeAllModalsAndClearSession();
    }
};

btnSkipSettings.onclick = () => {
    settingsRestoreModalEl.style.display = 'none';

    // Tiếp tục kiểm tra Video
    if (pendingRestore.session && pendingRestore.session.video) {
        showVideoRestorePhase(); 
    } 
    // Nếu không có Video, TỰ ĐỘNG áp dụng trạng thái Timer đã lưu
    else if (pendingRestore.session && pendingRestore.session.timer) {
        applySavedTimerState(pendingRestore.session.timer);
        closeAllModalsAndClearSession(); // Đóng ngay sau khi áp dụng Timer State
    }
    else {
        closeAllModalsAndClearSession();
    }
};

// 2. Video Modal Events (Video -> Apply Timer State)
btnRestoreVideo.onclick = (e) => {
    const startTime = parseFloat(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    const wasPlaying = e.target.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    videoRestoreModalEl.style.display = 'none';
    
    // TỰ ĐỘNG áp dụng trạng thái Timer đã lưu (Mode/Cycle/isRunning)
    if (pendingRestore.session && pendingRestore.session.timer) {
        applySavedTimerState(pendingRestore.session.timer);
    }
    
    closeAllModalsAndClearSession(); // Hoàn thành và đóng
};

btnSkipVideo.onclick = () => {
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); 
    }
    
    videoRestoreModalEl.style.display = 'none';
    
    // TỰ ĐỘNG áp dụng trạng thái Timer đã lưu (Mode/Cycle/isRunning)
    if (pendingRestore.session && pendingRestore.session.timer) {
        applySavedTimerState(pendingRestore.session.timer);
    }
    
    closeAllModalsAndClearSession(); // Hoàn thành và đóng
};


// --- Theme Toggle ---
themeToggleBtn.addEventListener('click', toggleTheme);


// =======================================================
//                   INIT
// =======================================================

const init = () => {
    loadTheme();
    loadPlaylist();
    renderPlaylist(); 

    const savedSession = sessionStorage.getItem(SESSION_KEY);
    if (savedSession) {
        pendingRestore = pendingRestore || {};
        pendingRestore.session = JSON.parse(savedSession);
    }
    
    loadSettings();
    
    // Thiết lập initialTime và timeLeft ban đầu 
    initialTime = timerSettings.study;
    timeLeft = timerSettings.study;
    updateDisplay(); 

    if (typeof YT === 'undefined' || !YT.Player) {
        // Chờ API load, onYouTubeIframeAPIReady sẽ gọi createPlayer/onPlayerReady -> checkRestoreStatus
    } else {
        checkRestoreStatus(); 
    }
};

// Khởi tạo ứng dụng
document.addEventListener('DOMContentLoaded', init);
