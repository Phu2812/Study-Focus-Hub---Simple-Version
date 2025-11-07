// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const SETTINGS_KEY = 'timer_settings_store'; 
const THEME_KEY = 'app_theme_mode'; 
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
// const ALARM_FADE_DURATION = 1000; // ĐÃ LOẠI BỎ
const DEFAULT_ALARM_SOUND = 'sounds/alarm.mp3'; // Bạn cần có file này

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 
let initialTime = 0; // TỔNG thời gian ban đầu của mode hiện tại (để tính Progress Circle)

// Cấu hình mặc định
const timerSettings = {
    study: 25 * 60, 
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    totalCycles: 4, 
    // Dữ liệu cài đặt thô (Giờ/Phút) để lưu vào Local Storage
    raw: {
        studyHour: 0, studyMinute: 25,
        shortBreak: 5, // Đơn vị: Phút
        longBreak: 15, // Đơn vị: Phút
        totalCycles: 4
    }
};

let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0; 
let pendingRestore = null; // Lưu trữ dữ liệu phiên cần khôi phục

// Elements
const playlistListEl = document.getElementById('playlist-list');
const playlistCountEl = document.getElementById('playlist-count');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const skipBtn = document.getElementById('btn-skip');
const resetBtn = document.getElementById('btn-reset');
const settingsBtn = document.getElementById('btn-settings');
const settingsAreaEl = document.getElementById('settings-area');
const alarmEl = document.getElementById('alarm-sound');
const progressCircleEl = document.getElementById('progress-circle');
const themeToggleBtn = document.getElementById('theme-toggle');

// Elements cho Cài đặt Timer
const studyHourInput = document.getElementById('study-hour');
const studyMinuteInput = document.getElementById('study-minute');
const shortBreakInput = document.getElementById('short-break');
const longBreakInput = document.getElementById('long-break');
const totalCyclesInput = document.getElementById('total-cycles');

// Elements cho Modal Restore
const settingsRestoreModalEl = document.getElementById('settings-restore-modal');
const videoRestoreModalEl = document.getElementById('video-restore-modal');
const timerRestoreModalEl = document.getElementById('timer-restore-modal');
const btnRestoreSettings = document.getElementById('btn-restore-settings');
const btnSkipSettings = document.getElementById('btn-skip-settings');
const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const settingsRestoreInfoEl = document.getElementById('settings-restore-info');
const videoRestoreInfoEl = document.getElementById('video-restore-info');
const timerRestoreInfoEl = document.getElementById('timer-restore-info');


// =======================================================
//                   ALARM FUNCTIONS (ĐÃ CẬP NHẬT)
// =======================================================

// Hàm chơi Alarm (Âm lượng tối đa, chạy hết nhạc)
const alarmPlay = () => {
    alarmEl.volume = 1.0; // Đặt âm lượng tối đa
    alarmEl.currentTime = 0;
    alarmEl.play();
    document.title = `Hết giờ! ${currentMode === 'study' ? 'NGHỈ GIẢI LAO' : 'HỌC'}`;
};

// Hàm dừng Alarm (Khi người dùng nhấn nút)
const alarmStop = () => {
    // Chỉ cần dừng (không cần fade out)
    alarmEl.pause();
    alarmEl.currentTime = 0;
};


// =======================================================
//                   TIMER LOGIC
// =======================================================

/**
 * Tính toán lại tổng thời gian (giây) từ dữ liệu thô (Giờ/Phút)
 */
const calculateTimerSettings = () => {
    // Lấy dữ liệu từ input hoặc từ timerSettings.raw
    const raw = timerSettings.raw; 
    
    const studyTotalMinutes = parseInt(raw.studyHour) * 60 + parseInt(raw.studyMinute);
    
    // Cập nhật giá trị tổng thời gian (giây)
    timerSettings.study = studyTotalMinutes * 60;
    timerSettings.shortBreak = parseInt(raw.shortBreak) * 60;
    timerSettings.longBreak = parseInt(raw.longBreak) * 60;
    timerSettings.totalCycles = parseInt(raw.totalCycles);
    
    // Đảm bảo timeLeft không bị tràn
    if (currentMode === 'study' && timeLeft > timerSettings.study) {
        timeLeft = timerSettings.study;
    }
    
    // Cập nhật initialTime cho Progress Circle
    initialTime = timerSettings[currentMode];
    
    // Cập nhật hiển thị (nếu không đang chạy)
    if (!isRunning) {
        timeLeft = timerSettings[currentMode];
        updateDisplay();
    }
};

/**
 * Lưu cài đặt thời gian (Giờ/Phút/Chu kỳ) vào Local Storage
 */
const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings.raw));
};

/**
 * Load cài đặt thời gian từ Local Storage (nếu có)
 */
const loadSettings = () => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
        const rawSettings = JSON.parse(savedSettings);
        
        // Kiểm tra xem cài đặt đã được áp dụng chưa
        if (rawSettings.studyMinute !== 25 || rawSettings.totalCycles !== 4) {
             pendingRestore = pendingRestore || {};
             pendingRestore.settings = rawSettings;
             return; // Dừng lại để chờ người dùng xác nhận khôi phục
        }
    }
    
    // Nếu không có cài đặt hoặc người dùng bỏ qua khôi phục (được gọi sau này)
    applySettings(timerSettings.raw);
};

/**
 * Áp dụng cài đặt và cập nhật input/timer
 * @param {object} settings - Dữ liệu thô của cài đặt
 */
const applySettings = (settings) => {
    // 1. Cập nhật STATE
    timerSettings.raw = settings;
    
    // 2. Cập nhật INPUT
    studyHourInput.value = settings.studyHour;
    studyMinuteInput.value = settings.studyMinute;
    shortBreakInput.value = settings.shortBreak;
    longBreakInput.value = settings.longBreak;
    totalCyclesInput.value = settings.totalCycles;

    // 3. Cập nhật TIMER
    calculateTimerSettings();
};


/**
 * Cập nhật hiển thị Timer, Progress Bar và Title
 */
const updateDisplay = () => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    timerDisplayEl.textContent = timeString;
    
    // Cập nhật chế độ
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 
                            (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';

    // Cập nhật thông tin chu kỳ
    cycleInfoEl.textContent = `Chu kỳ: ${cycleCount} / ${timerSettings.totalCycles}`;

    // Cập nhật Progress Circle
    const totalTime = initialTime;
    const progress = (totalTime - timeLeft) / totalTime;
    const circumference = 250 * Math.PI; // 250px là đường kính giả định (được thiết lập qua CSS)

    // Tính toán độ dài stroke-dashoffset: 
    // progress = 0: offset = circumference (vòng tròn đầy)
    // progress = 1: offset = 0 (vòng tròn rỗng)
    const offset = progress * circumference;

    progressCircleEl.style.background = `conic-gradient(
        var(--${currentMode === 'study' ? 'color-study' : 'color-break'}) 0deg,
        var(--${currentMode === 'study' ? 'color-study' : 'color-break'}) ${progress * 360}deg,
        var(--circle-bg) ${progress * 360}deg
    )`;

    // Cập nhật Title
    if (isRunning) {
        document.title = `(${timeString}) ${timerModeEl.textContent}`;
    } else if (timeLeft === 0) {
        document.title = `Hết giờ! ${timerModeEl.textContent}`;
    } else {
        document.title = `Study Focus Hub | ${timeString}`;
    }

    // Lưu trạng thái Timer vào Session Storage
    if (isRunning) {
        saveSession();
    }
};

/**
 * Logic đếm ngược
 */
const countdown = () => {
    if (timeLeft <= 0) {
        clearInterval(intervalId);
        isRunning = false;
        startPauseBtn.innerHTML = '▶ Bắt Đầu';
        
        alarmPlay();
        
        switchMode();
        return;
    }

    timeLeft--;
    updateDisplay();
};

/**
 * Bắt đầu/Tiếp tục Timer
 */
const startTimer = () => {
    if (!isRunning) {
        isRunning = true;
        intervalId = setInterval(countdown, 1000);
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        alarmStop(); // Đảm bảo dừng alarm nếu nó đang chạy
        saveSession(); // Lưu trạng thái khi bắt đầu/tiếp tục
    }
};

/**
 * Tạm dừng Timer
 */
const pauseTimer = () => {
    if (isRunning) {
        isRunning = false;
        clearInterval(intervalId);
        startPauseBtn.innerHTML = '▶ Tiếp Tục';
        saveSession(); // Lưu trạng thái khi tạm dừng
    }
};

/**
 * Chuyển đổi giữa các chế độ (Study, Short Break, Long Break)
 */
const switchMode = () => {
    alarmStop();

    // 1. Logic chuyển mode
    if (currentMode === 'study') {
        cycleCount++;
        if (cycleCount % timerSettings.totalCycles === 0) {
            currentMode = 'longBreak';
        } else {
            currentMode = 'shortBreak';
        }
    } else {
        currentMode = 'study';
    }

    // 2. Thiết lập lại thời gian và initialTime
    timeLeft = timerSettings[currentMode];
    initialTime = timerSettings[currentMode];
    
    // 3. Cập nhật hiển thị và tự động bắt đầu nếu không ở Long Break (hoặc theo logic riêng)
    updateDisplay();

    // Tự động bắt đầu mode mới
    startTimer();
};

/**
 * Đặt lại Timer về trạng thái Study mặc định
 */
const resetTimer = () => {
    pauseTimer();
    currentMode = 'study';
    timeLeft = timerSettings.study;
    cycleCount = 0;
    initialTime = timerSettings.study;
    updateDisplay();
    alarmStop();
};


// =======================================================
//                   EVENT LISTENERS
// =======================================================

// 1. Start/Pause Button
startPauseBtn.onclick = () => {
    isRunning ? pauseTimer() : startTimer();
};

// 2. Reset Button
resetBtn.onclick = resetTimer;

// 3. Skip Button
skipBtn.onclick = () => {
    pauseTimer();
    switchMode();
};

// 4. Settings Button
settingsBtn.onclick = () => {
    settingsAreaEl.classList.toggle('show');
    // Cập nhật lại giá trị input từ timerSettings.raw khi mở modal (đảm bảo đồng bộ)
    studyHourInput.value = timerSettings.raw.studyHour;
    studyMinuteInput.value = timerSettings.raw.studyMinute;
    shortBreakInput.value = timerSettings.raw.shortBreak;
    longBreakInput.value = timerSettings.raw.longBreak;
    totalCyclesInput.value = timerSettings.raw.totalCycles;
};

// 5. Settings Input Change (Sử dụng 'change' để xử lý khi người dùng nhập xong)
const handleSettingChange = () => {
    // 1. Đọc và lưu giá trị thô mới
    timerSettings.raw.studyHour = parseInt(studyHourInput.value) || 0;
    timerSettings.raw.studyMinute = parseInt(studyMinuteInput.value) || 0;
    timerSettings.raw.shortBreak = parseInt(shortBreakInput.value) || 0;
    timerSettings.raw.longBreak = parseInt(longBreakInput.value) || 0;
    timerSettings.raw.totalCycles = parseInt(totalCyclesInput.value) || 0;

    // 2. Tính toán và cập nhật thời gian tổng (giây)
    calculateTimerSettings(); 

    // 3. Lưu cài đặt mới vào Local Storage
    saveSettings(); 

    // 4. Nếu timer đang tạm dừng, cập nhật lại timeLeft & display cho mode hiện tại
    if (!isRunning) {
        timeLeft = timerSettings[currentMode];
        updateDisplay();
    }
};

studyHourInput.onchange = handleSettingChange;
studyMinuteInput.onchange = handleSettingChange;
shortBreakInput.onchange = handleSettingChange;
longBreakInput.onchange = handleSettingChange;
totalCyclesInput.onchange = handleSettingChange;

// =======================================================
//                   THEME TOGGLE
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
    document.body.classList.toggle('light-mode');
    const isLightMode = document.body.classList.contains('light-mode');
    localStorage.setItem(THEME_KEY, isLightMode ? 'light-mode' : 'dark-mode');
    
    if (isLightMode) {
        themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
        themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }
    // Fix: Cần đảm bảo progress circle cập nhật màu
    updateDisplay();
};

themeToggleBtn.onclick = toggleTheme;


// =======================================================
//                   YOUTUBE PLAYER & PLAYLIST LOGIC
// =======================================================

// Hàm được gọi khi YouTube API sẵn sàng
function onYouTubeIframeAPIReady() {
    // Tạo Player instance
    player = new YT.Player('youtube-player', {
        height: '300',
        width: '100%',
        videoId: currentPlaylist.length > 0 ? currentPlaylist[currentTrackIndex === -1 ? 0 : currentTrackIndex].id : '',
        playerVars: {
            'playsinline': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });

    // Sau khi player sẵn sàng, mới check trạng thái khôi phục
    checkRestoreStatus();
}

const onPlayerReady = (event) => {
    // Ẩn placeholder khi player sẵn sàng
    document.getElementById('player-placeholder').style.display = 'none';

    // Đặt âm lượng mặc định (để tránh quá lớn)
    player.setVolume(currentVolume * 100);

    // Render lại playlist để hiển thị track hiện tại
    renderPlaylist();
};

const onPlayerStateChange = (event) => {
    // 0: Ended, 1: Playing, 2: Paused
    if (event.data === 0) {
        // Tự động chuyển bài khi kết thúc
        playNextVideo();
    }
    // Khi đang phát, lưu trạng thái
    if (event.data === 1 || event.data === 2) {
        saveSession();
    }
};

const getYouTubeId = (url) => {
    // Regex để lấy ID từ URL (bao gồm cả watch?v=, youtu.be/ và embed/)
    const regex = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const getVideoTitle = async (videoId) => {
    const embedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}${encodeURIComponent(embedUrl)}&format=json`);
        const data = await response.json();
        return data.title || `Video ${videoId}`;
    } catch (error) {
        return `Video ${videoId}`;
    }
};

/**
 * Thêm video vào playlist
 */
const addVideoToPlaylist = async () => {
    const url = urlInputEl.value.trim();
    errorEl.textContent = '';
    
    if (!url) {
        errorEl.textContent = 'Vui lòng nhập link YouTube.';
        return;
    }

    const videoId = getYouTubeId(url);
    if (!videoId) {
        errorEl.textContent = 'Link YouTube không hợp lệ.';
        return;
    }

    // Lấy tiêu đề
    const title = await getVideoTitle(videoId);

    // Thêm vào list và render
    currentPlaylist.push({ id: videoId, title: title });
    savePlaylist();
    renderPlaylist();
    urlInputEl.value = '';

    // Nếu là video đầu tiên, load vào player
    if (currentPlaylist.length === 1) {
        currentTrackIndex = 0;
        player.loadVideoById(videoId);
        document.getElementById('player-placeholder').style.display = 'none';
    }
};

/**
 * Xóa video khỏi playlist
 */
const removeVideoFromPlaylist = (index) => {
    if (index >= 0 && index < currentPlaylist.length) {
        const removedId = currentPlaylist[index].id;
        currentPlaylist.splice(index, 1);
        savePlaylist();
        renderPlaylist();

        // Xử lý index sau khi xóa
        if (currentPlaylist.length === 0) {
            currentTrackIndex = -1;
            document.getElementById('player-placeholder').style.display = 'flex';
        } else if (index < currentTrackIndex) {
            // Nếu xóa bài trước bài đang phát, giảm index
            currentTrackIndex--;
        } else if (index === currentTrackIndex) {
            // Nếu xóa bài đang phát, chuyển sang bài tiếp theo (hoặc bài đầu)
            currentTrackIndex = Math.max(0, currentTrackIndex - 1);
            player.loadVideoById(currentPlaylist[currentTrackIndex].id);
            player.pauseVideo();
        }
    }
};

/**
 * Render lại danh sách playlist
 */
const renderPlaylist = () => {
    playlistListEl.innerHTML = '';
    playlistCountEl.textContent = currentPlaylist.length;

    currentPlaylist.forEach((item, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;
        li.className = index === currentTrackIndex ? 'current-track' : '';
        li.onclick = () => playVideoAtIndex(index, true, 0);

        li.innerHTML = `
            <i class="fas fa-bars drag-handle" draggable="false"></i>
            <span>${item.title}</span>
            <button class="remove-btn" data-index="${index}"><i class="fas fa-times"></i></button>
        `;
        
        // Thêm event cho nút xóa
        li.querySelector('.remove-btn').onclick = (e) => {
            e.stopPropagation(); 
            removeVideoFromPlaylist(index);
        };

        playlistListEl.appendChild(li);
    });

    // Thêm Drag and Drop events
    addDragDropListeners(playlistListEl);
};

/**
 * Tải playlist từ Local Storage
 */
const loadPlaylist = () => {
    const savedPlaylist = localStorage.getItem(STORAGE_KEY);
    if (savedPlaylist) {
        currentPlaylist = JSON.parse(savedPlaylist);
        // Tìm và thiết lập currentTrackIndex dựa trên trạng thái đã lưu
        if (currentPlaylist.length > 0) {
            // Mặc định load bài đầu tiên nếu không có index nào được lưu
            currentTrackIndex = 0; 
        }
    }
};

/**
 * Lưu playlist vào Local Storage
 */
const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
};

/**
 * Phát video tại index chỉ định
 * @param {number} index - Index của video trong playlist
 * @param {boolean} shouldPlay - Có nên tự động phát không
 * @param {number} startTime - Bắt đầu từ giây thứ bao nhiêu
 */
const playVideoAtIndex = (index, shouldPlay, startTime = 0) => {
    if (index >= 0 && index < currentPlaylist.length) {
        currentTrackIndex = index;
        const videoId = currentPlaylist[index].id;
        
        // Load và seekTo
        player.loadVideoById({
            videoId: videoId,
            startSeconds: startTime
        });

        if (shouldPlay) {
            player.playVideo();
            document.getElementById('btn-play-pause').innerHTML = '<i class="fas fa-pause"></i>';
        } else {
            player.pauseVideo();
            document.getElementById('btn-play-pause').innerHTML = '<i class="fas fa-play"></i>';
        }

        renderPlaylist();
    }
};

/**
 * Chuyển sang video tiếp theo
 */
const playNextVideo = () => {
    if (currentPlaylist.length === 0) return;

    currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex, true, 0); 
};

/**
 * Chuyển về video trước đó
 */
const playPrevVideo = () => {
    if (currentPlaylist.length === 0) return;

    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex, true, 0); 
};


// Player Controls Events
document.getElementById('btn-add-song').onclick = addVideoToPlaylist;

document.getElementById('btn-play-pause').onclick = () => {
    if (player && player.getPlayerState) {
        const state = player.getPlayerState();
        if (state === 1) { // Playing
            player.pauseVideo();
            document.getElementById('btn-play-pause').innerHTML = '<i class="fas fa-play"></i>';
        } else if (state === 2 || state === 5) { // Paused or Cued
            player.playVideo();
            document.getElementById('btn-play-pause').innerHTML = '<i class="fas fa-pause"></i>';
        }
    }
};

document.getElementById('btn-next').onclick = playNextVideo;
document.getElementById('btn-prev').onclick = playPrevVideo;


// =======================================================
//                   DRAG AND DROP LOGIC
// =======================================================

let dragSrcEl = null;

function handleDragStart(e) {
    this.style.opacity = '0.4'; 
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault(); 
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    this.classList.add('drag-over');
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation(); 
    this.classList.remove('drag-over');

    if (dragSrcEl !== this) {
        const fromIndex = parseInt(dragSrcEl.dataset.index);
        const toIndex = parseInt(this.dataset.index);
        
        // Cập nhật lại playlist
        const [movedItem] = currentPlaylist.splice(fromIndex, 1);
        currentPlaylist.splice(toIndex, 0, movedItem);

        // Cập nhật currentTrackIndex sau khi sắp xếp
        if (currentTrackIndex === fromIndex) {
            currentTrackIndex = toIndex;
        } else if (currentTrackIndex > fromIndex && currentTrackIndex <= toIndex) {
            currentTrackIndex--;
        } else if (currentTrackIndex < fromIndex && currentTrackIndex >= toIndex) {
            currentTrackIndex++;
        }
        
        savePlaylist();
        renderPlaylist();
    }
    
    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1';
    // Xóa class drag-over khỏi tất cả các item
    document.querySelectorAll('#playlist-list li').forEach(item => {
        item.classList.remove('drag-over');
    });
}

function addDragDropListeners(list) {
    list.querySelectorAll('li').forEach(item => {
        item.addEventListener('dragstart', handleDragStart, false);
        item.addEventListener('dragenter', handleDragEnter, false);
        item.addEventListener('dragover', handleDragOver, false);
        item.addEventListener('dragleave', handleDragLeave, false);
        item.addEventListener('drop', handleDrop, false);
        item.addEventListener('dragend', handleDragEnd, false);
    });
}


// =======================================================
//                   SESSION RESTORE (MODALS)
// =======================================================

/**
 * Lưu trạng thái hiện tại (Timer + Video) vào Session Storage
 */
const saveSession = () => {
    const sessionData = {
        timer: {
            currentMode: currentMode,
            timeLeft: timeLeft,
            cycleCount: cycleCount,
            isRunning: isRunning
        },
        video: {
            playlist: currentPlaylist,
            currentTrackIndex: currentTrackIndex,
            // Chỉ lấy thời gian hiện tại nếu player đã load
            currentTime: player && player.getCurrentTime ? player.getCurrentTime() : 0, 
            isPlaying: player && player.getPlayerState ? player.getPlayerState() === 1 : false,
            // Lưu lại volume
            volume: player && player.getVolume ? player.getVolume() / 100 : currentVolume
        }
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
};

const closeAllModalsAndClearSession = () => {
    settingsRestoreModalEl.style.display = 'none';
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    sessionStorage.removeItem(SESSION_KEY);
};

const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

const formatSettings = (raw) => {
    const studyTime = (raw.studyHour > 0 ? `${raw.studyHour} giờ ` : '') + `${raw.studyMinute} phút`;
    return `
        <ul>
            <li>Học: <strong>${studyTime}</strong></li>
            <li>Nghỉ Ngắn: <strong>${raw.shortBreak} phút</strong></li>
            <li>Nghỉ Dài: <strong>${raw.longBreak} phút</strong></li>
            <li>Chu kỳ: <strong>${raw.totalCycles} lần</strong></li>
        </ul>
    `;
}

// --- Pha 1: Khôi phục Cài đặt ---
const showSettingsRestorePhase = (settings) => {
    settingsRestoreInfoEl.innerHTML = formatSettings(settings);
    settingsRestoreModalEl.style.display = 'flex';
};

// --- Pha 2: Khôi phục Video ---
const showVideoRestorePhase = () => {
    const { video } = pendingRestore.session;
    const { currentTrackIndex: index, currentTime: time } = video;
    
    if (index !== -1 && video.playlist.length > 0) {
        const title = video.playlist[index].title;
        videoRestoreInfoEl.innerHTML = `Đang phát dở: <strong>${title}</strong><br>(Tại thời điểm: ${formatTime(time)})`;
        
        // Gán data cho nút Restore
        btnRestoreVideo.dataset.index = index;
        btnRestoreVideo.dataset.time = Math.floor(time);
        btnRestoreVideo.dataset.play = video.isPlaying;
        
        videoRestoreModalEl.style.display = 'flex';
    } else {
        // Nếu không có video để khôi phục, chuyển sang pha Timer
        showTimerRestorePhase();
    }
};

// --- Pha 3: Khôi phục Timer ---
const showTimerRestorePhase = () => {
    const { timer } = pendingRestore.session;
    const modeText = timer.currentMode === 'study' ? 'Học' : (timer.currentMode === 'shortBreak' ? 'Nghỉ Ngắn' : 'Nghỉ Dài');
    
    timerRestoreInfoEl.innerHTML = `Chế độ: <strong>${modeText}</strong><br>Thời gian còn: <strong>${formatTime(timer.timeLeft)}</strong>`;
    timerRestoreModalEl.style.display = 'flex';
};

const checkRestoreStatus = () => {
    if (pendingRestore && pendingRestore.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
    } else if (pendingRestore && pendingRestore.session) {
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};

// Modal Close Buttons
document.querySelectorAll('.modal-close-settings, .modal-close-video, .modal-close-timer').forEach(btn => {
    btn.onclick = () => {
        closeAllModalsAndClearSession();
        resetTimer(); 
    };
});

// Settings Modal Events
btnRestoreSettings.onclick = () => {
    applySettings(pendingRestore.settings);
    settingsRestoreModalEl.style.display = 'none';
    
    if (pendingRestore.session) {
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};

btnSkipSettings.onclick = () => {
    // Giữ cài đặt mặc định (đã được load từ loadSettings)
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};


// Video Modal Events
btnRestoreVideo.onclick = (e) => {
    const startTime = parseInt(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    const wasPlaying = e.target.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        // Khôi phục video và play/pause đúng trạng thái đã lưu
        currentPlaylist = pendingRestore.session.video.playlist;
        currentVolume = pendingRestore.session.video.volume;
        player.setVolume(currentVolume * 100);
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    // Đóng Modal Video và chuyển sang hỏi Timer
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); 
};

btnSkipVideo.onclick = () => {
    // Nếu có playlist, load video đầu tiên (hoặc hiện tại) nhưng không play, từ đầu.
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); // Load video từ đầu, không play
    }
    
    // Đóng Modal Video và chuyển sang hỏi Timer
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); 
};

// Timer Modal Events
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore.session;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    
    // Cập nhật initialTime sau khi áp dụng setting
    initialTime = timerSettings[currentMode]; 
    updateDisplay();
    
    if (timer.isRunning) {
        isRunning = true;
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        startTimer();
    } else {
        startPauseBtn.textContent = '▶ Tiếp Tục';
    }
    
    closeAllModalsAndClearSession(); // Hoàn thành tất cả và đóng Modal
};

btnSkipTimer.onclick = () => {
    resetTimer(); // Đặt lại về mode Study mặc định
    closeAllModalsAndClearSession();
};


// =======================================================
//                   INIT
// =======================================================

const init = () => {
    loadTheme();
    loadPlaylist();
    renderPlaylist(); // Render playlist trước khi load player

    // Load Session Restore (Video + Timer)
    const savedSession = sessionStorage.getItem(SESSION_KEY);
    if (savedSession) {
        pendingRestore = pendingRestore || {};
        pendingRestore.session = JSON.parse(savedSession);
    }
    
    // Load Settings Restore (Sẽ set pendingRestore.settings nếu có)
    loadSettings();
    
    // onYouTubeIframeAPIReady sẽ gọi checkRestoreStatus()
    // Nó cũng sẽ gọi updateDisplay() sau khi loadSettings
    
    // Thiết lập initialTime cho lần load đầu tiên (sử dụng giá trị mặc định/đã load từ loadSettings)
    initialTime = timerSettings.study;
    timeLeft = timerSettings.study;
    updateDisplay(); 
};

// Khởi chạy ứng dụng
init();
