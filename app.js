// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const SETTINGS_KEY = 'timer_settings_store'; 
const THEME_KEY = 'app_theme_mode'; 
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; // Thời gian Fade In/Out: 1 giây

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 
let initialTime = 0; // TỔNG thời gian ban đầu của mode hiện tại (để tính Progress Circle)
let fadeIntervalId = null; 
let pendingRestore = null; // Dữ liệu phiên cần khôi phục

// Cấu hình mặc định (Dùng cho lần đầu tiên hoặc khi cài đặt cũ bị lỗi)
const timerSettings = {
    study: 25 * 60, 
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    totalCycles: 4, 
    // Dữ liệu cài đặt thô (Giờ/Phút) để lưu vào Local Storage
    raw: {
        studyHour: 0, studyMinute: 25,
        shortBreakMinute: 5,
        longBreakMinute: 15,
        totalCycles: 4
    }
};

let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0; 

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
const progressCircleEl = document.getElementById('progress-circle'); 

// Setting Inputs
const settingsInputs = document.querySelectorAll('#timer-section input[type="number"]');
const studyHourInput = document.getElementById('study-hour');
const studyMinuteInput = document.getElementById('study-minute');
const shortBreakInput = document.getElementById('short-break');
const longBreakInput = document.getElementById('long-break');
const totalCyclesInput = document.getElementById('total-cycles');

// Player Controls
const btnPlayPause = document.getElementById('btn-play-pause');
const btnNext = document.getElementById('btn-next');
const btnPrev = document.getElementById('btn-prev');
const playerPlaceholder = document.getElementById('player-placeholder');

// Modals
const videoRestoreModalEl = document.getElementById('video-restore-modal');
const timerRestoreModalEl = document.getElementById('timer-restore-modal');
const settingsRestoreModalEl = document.getElementById('settings-restore-modal');
const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const btnRestoreSettings = document.getElementById('btn-restore-settings');
const btnSkipSettings = document.getElementById('btn-skip-settings');
const closeButtons = document.querySelectorAll('.modal-close-video, .modal-close-timer, .modal-close-settings');

// Theme Toggle
const themeToggleBtn = document.getElementById('theme-toggle');
const bodyEl = document.body;


// =======================================================
//                   THEME LOGIC (Sáng/Tối)
// =======================================================

const loadTheme = () => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light') {
        bodyEl.classList.add('light-mode');
        themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
        bodyEl.classList.remove('light-mode');
        themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }
};

const toggleTheme = () => {
    bodyEl.classList.toggle('light-mode');
    const isLightMode = bodyEl.classList.contains('light-mode');
    localStorage.setItem(THEME_KEY, isLightMode ? 'light' : 'dark');
    themeToggleBtn.innerHTML = isLightMode ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
};

themeToggleBtn.addEventListener('click', toggleTheme);

// =======================================================
//                   SESSION & RESTORE LOGIC
// =======================================================

/**
 * Lưu trạng thái hiện tại (Timer và Video) vào Session Storage.
 */
const saveSession = () => {
    if (!isRunning) return; 
    
    const sessionData = {
        video: {
            index: currentTrackIndex,
            time: player ? player.getCurrentTime() : 0,
            wasPlaying: player ? player.getPlayerState() === 1 : false, 
        },
        timer: {
            currentMode: currentMode,
            timeLeft: timeLeft,
            cycleCount: cycleCount,
            isRunning: isRunning,
        },
        timestamp: Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
};

/**
 * Hiển thị Modal khôi phục Cài đặt
 */
const showSettingsRestorePhase = (rawSettings) => {
    const raw = rawSettings;
    document.getElementById('settings-restore-info').innerHTML = `
        <p>Học: <strong>${raw.studyHour}h ${raw.studyMinute}p</strong></p>
        <p>Nghỉ Ngắn: <strong>${raw.shortBreakMinute}p</strong> | Nghỉ Dài: <strong>${raw.longBreakMinute}p</strong></p>
        <p>Chu kỳ: <strong>${raw.totalCycles}</strong></p>
    `;
    settingsRestoreModalEl.style.display = 'flex';
};

/**
 * Hiển thị Modal khôi phục Video
 */
const showVideoRestorePhase = () => {
    const { video } = pendingRestore.session;
    const song = currentPlaylist[video.index];
    
    if (!song) {
        // Nếu không có bài hát (đã bị xóa/lỗi), bỏ qua Video và chuyển sang hỏi Timer
        showTimerRestorePhase();
        return;
    }

    const minutes = Math.floor(video.time / 60);
    const seconds = Math.floor(video.time % 60);
    const timeString = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    const statusText = video.wasPlaying ? 'Đang phát' : 'Đã tạm dừng';

    document.getElementById('video-restore-info').innerHTML = `
        <p>Bài hát: <strong>${song.title}</strong></p>
        <p>Thời điểm: ${timeString} (${statusText})</p>
    `;

    btnRestoreVideo.dataset.time = video.time;
    btnRestoreVideo.dataset.index = video.index;
    btnRestoreVideo.dataset.play = video.wasPlaying;

    videoRestoreModalEl.style.display = 'flex';
};

/**
 * Hiển thị Modal khôi phục Timer
 */
const showTimerRestorePhase = () => {
    const { timer } = pendingRestore.session;
    const modeText = timer.currentMode === 'study' ? 'Học' : (timer.currentMode === 'shortBreak' ? 'Nghỉ Ngắn' : 'Nghỉ Dài');
    const timeRemaining = formatTime(timer.timeLeft);

    document.getElementById('timer-restore-info').innerHTML = `
        <p>Chế độ: <strong>${modeText}</strong></p>
        <p>Thời gian còn lại: <strong>${timeRemaining}</strong></p>
        <p>Chu kỳ đã hoàn thành: ${timer.cycleCount}</p>
    `;
    timerRestoreModalEl.style.display = 'flex';
};

/**
 * Đóng tất cả Modals và xóa Session Restore Data
 */
const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    settingsRestoreModalEl.style.display = 'none';
    sessionStorage.removeItem(SESSION_KEY);
    pendingRestore = null;
};

// =======================================================
//                   SETTINGS LOGIC
// =======================================================

/**
 * Lưu cài đặt Giờ/Phút/Chu kỳ vào Local Storage
 */
const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings.raw));
};

/**
 * Lấy cài đặt từ input và tính toán thời gian (tính bằng giây).
 * Đảm bảo thời gian tối thiểu là 1 phút (60 giây).
 */
const calculateTimerSettings = () => {
    // Lấy giá trị từ input, đảm bảo giá trị tối thiểu
    const getVal = (id, min = 0) => Math.max(min, parseInt(document.getElementById(id).value) || min);

    const studyHour = getVal('study-hour');
    const studyMinute = getVal('study-minute');
    const shortBreakMinute = getVal('short-break');
    const longBreakMinute = getVal('long-break');
    const totalCycles = getVal('total-cycles', 1); // Chu kỳ tối thiểu là 1

    // 1. Cập nhật timerSettings.raw
    timerSettings.raw = {
        studyHour, studyMinute,
        shortBreakMinute, 
        longBreakMinute, 
        totalCycles: totalCycles, 
    };

    // 2. Tính toán thời gian (giây) và đảm bảo thời gian tối thiểu là 60s
    // Thời gian học: Phải là 60s trở lên
    timerSettings.study = Math.max(60, (studyHour * 3600) + (studyMinute * 60)); 
    // Thời gian nghỉ: Phải là 60s trở lên
    timerSettings.shortBreak = Math.max(60, shortBreakMinute * 60);
    timerSettings.longBreak = Math.max(60, longBreakMinute * 60);
    timerSettings.totalCycles = totalCycles; 

    saveSettings(); 
};

/**
 * Load cài đặt từ Local Storage và áp dụng vào input
 */
const loadSettings = () => {
    const savedRaw = localStorage.getItem(SETTINGS_KEY);
    
    if (savedRaw) {
        const raw = JSON.parse(savedRaw);
        
        // Kiểm tra tính hợp lệ của cài đặt đã lưu (thời gian học phải >= 60s)
        const studyTimeSeconds = (raw.studyHour * 3600) + (raw.studyMinute * 60);
        
        if (studyTimeSeconds >= 60 && raw.totalCycles >= 1) {
            pendingRestore = pendingRestore || {};
            pendingRestore.settings = raw; 
        } else {
            // Cài đặt cũ bị lỗi (thời gian học bị 0) -> Dùng giá trị mặc định trong input
             calculateTimerSettings(); 
        }
    } else {
        // Lần đầu load hoặc localStorage rỗng -> Dùng giá trị mặc định của input
        calculateTimerSettings(); 
    }
};

/**
 * Áp dụng giá trị từ timerSettings.raw vào các input
 */
const applyRawSettingsToInputs = (raw) => {
    studyHourInput.value = raw.studyHour;
    studyMinuteInput.value = raw.studyMinute;
    shortBreakInput.value = raw.shortBreakMinute;
    longBreakInput.value = raw.longBreakMinute;
    totalCyclesInput.value = raw.totalCycles;
};

// =======================================================
//                   POMODORO TIMER LOGIC
// =======================================================

const formatTime = (totalSeconds) => {
    // Đảm bảo không hiển thị số âm 
    if (totalSeconds < 0) totalSeconds = 0; 
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

/**
 * Cập nhật vòng tròn đếm ngược (Progress Circle)
 */
const updateProgressCircle = () => {
    if (initialTime === 0) return;
    
    const timeElapsed = initialTime - timeLeft;
    const percentage = (timeElapsed / initialTime) * 100;
    const degree = (percentage / 100) * 360; 
    
    const activeColor = currentMode === 'study' ? 'var(--color-study)' : 'var(--color-break)';
    const trackColor = 'var(--circle-bg)';

    progressCircleEl.style.background = `conic-gradient(
        ${activeColor} 0deg, 
        ${activeColor} ${degree}deg, 
        ${trackColor} ${degree}deg
    )`;
};


const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    const modeText = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 
                     (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerModeEl.textContent = modeText;
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    
    updateProgressCircle();

    const totalCycles = timerSettings.totalCycles;
    // Tính toán chu kỳ hiển thị (1 đến totalCycles)
    const currentCycleDisplay = cycleCount % totalCycles;
    // Nếu cycleCount = 0 (khởi tạo) hoặc là bội số của totalCycles (cuối chu kỳ long break), hiển thị totalCycles
    const displayCycle = cycleCount === 0 ? 0 : (currentCycleDisplay === 0 ? totalCycles : currentCycleDisplay);
    cycleInfoEl.textContent = `Chu kỳ: ${displayCycle} / ${totalCycles}`;
    
    document.title = `${formatTime(timeLeft)} - ${modeText}`;
};

/**
 * Áp dụng giá trị thời gian đầy đủ cho chế độ hiện tại.
 */
const resetTimerToCurrentMode = () => {
    initialTime = timerSettings[currentMode]; 
    timeLeft = initialTime;
    updateDisplay();
}


const switchMode = (autoStartNext = true) => {
    // FIX LỖI 3 & 4: Dừng Timer trước, sau đó phát nhạc và chuyển mode
    
    // 1. Dừng Timer và Cập nhật hiển thị về 00:00 
    pauseTimer(false); 
    
    // 2. Play/Stop Báo thức
    playAlarm(); // Phát báo thức với Fade In
    setTimeout(stopAlarm, 3000); // Dừng báo thức với Fade Out sau 3 giây

    // 3. Chuyển Mode và Cập nhật Chu kỳ (Logic đã sửa)
    if (currentMode === 'study') {
        cycleCount++; // FIX: Tăng chu kỳ khi kết thúc Study
        if (cycleCount % timerSettings.totalCycles === 0) {
            currentMode = 'longBreak';
        } else {
            currentMode = 'shortBreak';
        }
    } else { // break mode (shortBreak hoặc longBreak)
        currentMode = 'study';
    }

    // 4. Reset và Cập nhật hiển thị cho mode mới
    resetTimerToCurrentMode(); 
    
    // 5. Tự động bắt đầu mode mới
    if (autoStartNext) {
        startTimer();
    }
};

const startTimer = () => {
    if (intervalId) clearInterval(intervalId);
    
    if (initialTime === 0 || isNaN(initialTime)) {
         initialTime = timerSettings[currentMode];
         timeLeft = initialTime; // Đặt lại nếu bằng 0
    }
    
    isRunning = true;
    startPauseBtn.innerHTML = '⏸ Tạm Dừng';

    intervalId = setInterval(() => {
        timeLeft--;
        
        // FIX LỖI 2: Xử lý ngay khi timeLeft < 0 (tức là sau khi hiển thị 00:00)
        if (timeLeft < 0) {
            clearInterval(intervalId); 
            intervalId = null;
            switchMode(true); // Tự động chuyển mode và bắt đầu
        } else {
            updateDisplay();
            saveSession(); 
        }
    }, 1000);
};

const pauseTimer = (updateButton = true) => {
    if (intervalId) clearInterval(intervalId);
    isRunning = false;
    if (updateButton) {
        startPauseBtn.innerHTML = '▶ Bắt Đầu';
    }
    saveSession();
};

const resetTimer = () => {
    pauseTimer();
    stopAlarm(); // Đảm bảo báo thức dừng
    currentMode = 'study';
    cycleCount = 0;
    resetTimerToCurrentMode(); 
};

// =======================================================
//                   YOUTUBE PLAYER LOGIC
// =======================================================

function onYouTubeIframeAPIReady() {
    // Khởi tạo player với ID trống (để tránh lỗi) hoặc video đầu tiên nếu có playlist
    const initialVideoId = currentPlaylist.length > 0 ? currentPlaylist[0].id : '';
    if (currentPlaylist.length > 0) {
        currentTrackIndex = 0;
    }
    loadVideoPlayer(initialVideoId); 
}

const loadVideoPlayer = (videoId) => {
    const playerContainer = document.getElementById('youtube-player');
    
    if (!player) {
        player = new YT.Player(playerContainer, {
            videoId: videoId || '',
            playerVars: {
                'playsinline': 1,
                'autoplay': 0,
                'controls': 1,
                'rel': 0,
                'showinfo': 0,
                'modestbranding': 1,
            },
            // Đặt kích thước Player 100% (CSS đã xử lý FIX LỖI 1)
            height: '100%', 
            width: '100%', 
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError,
            }
        });
    } else {
        if (videoId) {
            playerPlaceholder.style.display = 'none';
            if (player.loadVideoById) { 
                 player.loadVideoById(videoId);
            }
        } else {
            playerPlaceholder.style.display = 'flex';
        }
    }
};

const onPlayerReady = (event) => {
    if (player) {
        // Lấy âm lượng hiện tại (nếu có) hoặc mặc định là 50%
        currentVolume = player.getVolume() / 100 || 0.5;
        player.setVolume(currentVolume * 100);
    }
    
    // Nếu không có dữ liệu khôi phục, đảm bảo player dừng lại sau khi load
    if (!pendingRestore) { 
        if (currentPlaylist.length > 0) {
            // Load video đầu tiên nhưng không play
            playVideoAtIndex(0, false, 0); 
        }
    } else if (pendingRestore.settings && !pendingRestore.session) {
        // Nếu chỉ có cài đặt được khôi phục, reset timer
        resetTimerToCurrentMode();
    }
};

const onPlayerStateChange = (event) => {
    const state = event.data;
    if (state === YT.PlayerState.PLAYING) { 
        btnPlayPause.innerHTML = '<i class="fas fa-pause"></i>';
        currentVolume = player.getVolume() / 100; 
    } else {
        btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
    }
    
    if (state === YT.PlayerState.ENDED) { 
        playNext();
    }
    // Lưu session khi trạng thái player thay đổi (Play/Pause)
    saveSession(); 
};

const onPlayerError = (event) => {
    console.error('YouTube Player Error:', event.data);
    // Tự động chuyển bài khi gặp lỗi
    playNext();
};

const playVideoAtIndex = (index, autoPlay = true, startTime = 0) => {
    if (index >= 0 && index < currentPlaylist.length) {
        currentTrackIndex = index;
        const videoId = currentPlaylist[index].id;
        
        if (player) {
            playerPlaceholder.style.display = 'none';
            player.loadVideoById(videoId, startTime, 'default'); 
            
            if (!autoPlay) {
                // Đảm bảo lệnh pause được gọi sau khi load hoàn tất
                setTimeout(() => {
                    if(player && player.pauseVideo) {
                        player.pauseVideo();
                        btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
                    }
                }, 500); 
            }
        }
        renderPlaylist();
    }
};

const playNext = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex);
};

const playPrev = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex);
};

// =======================================================
//                   PLAYLIST & DRAG & DROP LOGIC
// =======================================================

const getVideoId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

const getVideoTitle = async (videoId) => {
    const url = `${YOUTUBE_OEMBED_API}https://www.youtube.com/watch?v=${videoId}&format=json`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.title;
    } catch (error) {
        console.error("Lỗi khi lấy tiêu đề YouTube:", error);
        return "Video không xác định";
    }
};

const addSong = async (url) => {
    const videoId = getVideoId(url);
    if (!videoId) {
        errorEl.textContent = 'Lỗi: URL YouTube không hợp lệ.';
        return;
    }
    
    if (currentPlaylist.some(song => song.id === videoId)) {
        errorEl.textContent = 'Video này đã có trong playlist.';
        return;
    }

    errorEl.textContent = 'Đang tải tiêu đề...';
    const title = await getVideoTitle(videoId);

    // Sử dụng unique_id để quản lý trong playlist và Drag/Drop
    const newSong = { 
        id: videoId, 
        title: title, 
        unique_id: Date.now() // Dùng ID duy nhất để phân biệt các video
    };
    currentPlaylist.push(newSong);
    
    errorEl.textContent = '';
    urlInputEl.value = '';
    
    // Nếu là bài hát đầu tiên, load ngay
    if (currentTrackIndex === -1) {
        currentTrackIndex = 0;
        loadVideoPlayer(videoId);
    }
    
    savePlaylist();
    renderPlaylist();
};

const removeSong = (uniqueId) => {
    const index = currentPlaylist.findIndex(song => song.unique_id === uniqueId);
    if (index > -1) {
        currentPlaylist.splice(index, 1); 

        if (index === currentTrackIndex) {
            currentTrackIndex = currentPlaylist.length > 0 ? 0 : -1;
            if (currentPlaylist.length > 0) {
                 playVideoAtIndex(currentTrackIndex, false, 0); 
            } else if (player && player.stopVideo) {
                player.stopVideo();
                playerPlaceholder.style.display = 'flex';
            }
        } else if (index < currentTrackIndex) {
            currentTrackIndex--;
        }
        
        savePlaylist();
        renderPlaylist();
    }
};

const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
};

const loadPlaylist = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        currentPlaylist = JSON.parse(saved);
    }
};

const renderPlaylist = () => {
    playlistListEl.innerHTML = '';
    currentPlaylist.forEach((song, index) => {
        const li = document.createElement('li');
        li.dataset.id = song.unique_id; // Dùng unique_id để quản lý
        li.draggable = true;
        
        li.innerHTML = `
            <span>${index + 1}. ${song.title}</span>
            <button class="btn-delete" data-id="${song.unique_id}"><i class="fas fa-trash-alt"></i></button>
        `;
        
        if (index === currentTrackIndex) {
            li.classList.add('current-track');
        }
        
        li.querySelector('span').addEventListener('click', () => {
            playVideoAtIndex(index);
        });

        li.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation(); 
            removeSong(song.unique_id);
        });

        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);

        playlistListEl.appendChild(li);
    });
};

let draggingItem = null;

function handleDragStart() {
    draggingItem = this;
    setTimeout(() => this.style.opacity = '0.5', 0); 
}

function handleDragEnd() {
    this.style.opacity = '1';
    this.classList.remove('drag-over');
    draggingItem = null;
    savePlaylist();
}

function handleDragOver(e) { 
    e.preventDefault();
}

function handleDragEnter(e) { 
    e.preventDefault();
    if (draggingItem && draggingItem !== this) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) { 
    e.preventDefault();
    this.classList.remove('drag-over');

    if (draggingItem && draggingItem !== this) {
        const draggedUniqueId = parseInt(draggingItem.dataset.id);
        const droppedUniqueId = parseInt(this.dataset.id);
        
        // Dùng unique_id để tìm index 
        const draggedIndex = currentPlaylist.findIndex(song => song.unique_id === draggedUniqueId);
        const droppedIndex = currentPlaylist.findIndex(song => song.unique_id === droppedUniqueId);

        const [movedItem] = currentPlaylist.splice(draggedIndex, 1);
        currentPlaylist.splice(droppedIndex, 0, movedItem);

        // Cập nhật currentTrackIndex sau khi kéo thả
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
//                   ALARM LOGIC (Có Fade In/Out)
// =======================================================

/**
 * Hàm chung để Fade (làm mờ) âm thanh Alarm
 */
const fadeAlarm = (targetVolume, duration) => {
    if (fadeIntervalId) clearInterval(fadeIntervalId); 
    
    const startVolume = alarmSound.volume;
    const startTime = Date.now();
    
    if (Math.abs(startVolume - targetVolume) < 0.01) return;

    fadeIntervalId = setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        let fraction = elapsedTime / duration;

        if (fraction >= 1) {
            clearInterval(fadeIntervalId);
            fadeIntervalId = null;
            alarmSound.volume = targetVolume;
            if (targetVolume === 0) {
                alarmSound.pause();
                alarmSound.currentTime = 0;
            }
        } else {
            // Tính toán âm lượng mới (tuyến tính)
            alarmSound.volume = Math.max(0, Math.min(1, startVolume + (targetVolume - startVolume) * fraction));
        }
    }, 50); // Cập nhật mỗi 50ms
};

/**
 * Phát báo thức với Fade In
 */
const playAlarm = () => {
    const maxVolume = currentVolume; // Âm lượng tối đa là âm lượng hiện tại của Player
    
    alarmSound.volume = 0; // Đặt âm lượng ban đầu bằng 0
    alarmSound.currentTime = 0; // Reset thời điểm
    
    // Bắt đầu Play
    alarmSound.play().catch(e => console.error("Lỗi phát báo thức:", e));

    // Bắt đầu Fade In
    fadeAlarm(maxVolume, ALARM_FADE_DURATION);
};

/**
 * Dừng báo thức với Fade Out
 */
const stopAlarm = () => {
    // Chỉ dừng khi alarm đang phát
    if (alarmSound.paused) return; 
    
    // Bắt đầu Fade Out
    fadeAlarm(0, ALARM_FADE_DURATION);
};


// =======================================================
//                   EVENTS & INIT
// =======================================================

// Timer Events
startPauseBtn.addEventListener('click', () => {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
});

document.getElementById('btn-reset').addEventListener('click', resetTimer);

// FIX LỖI 4: Khi bấm Skip, chuyển mode và bắt đầu mode mới
skipBtn.addEventListener('click', () => {
    stopAlarm(); 
    switchMode(true);
}); 

// Settings Events
settingsInputs.forEach(input => { 
    input.addEventListener('change', () => {
        const val = parseInt(input.value);
        const min = parseInt(input.min);
        const max = parseInt(input.max);

        if (isNaN(val) || val < min) input.value = min;
        if (val > max) input.value = max;
        
        calculateTimerSettings(); 
        
        if (!isRunning) {
            resetTimerToCurrentMode(); 
        }
    });
});

// Playlist Events
document.getElementById('btn-add-song').addEventListener('click', () => addSong(urlInputEl.value));
urlInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addSong(urlInputEl.value);
});

// Player Events
btnPlayPause.addEventListener('click', () => {
    if (!player || currentPlaylist.length === 0) return;

    const state = player.getPlayerState();
    if (state === 1) { 
        player.pauseVideo();
    } else {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        
        if (player.getPlayerState() === YT.PlayerState.UNSTARTED || player.getPlayerState() === YT.PlayerState.CUED) {
             playVideoAtIndex(currentTrackIndex, true, 0); 
        } else {
            player.playVideo();
        }
    }
});

btnNext.addEventListener('click', playNext);
btnPrev.addEventListener('click', playPrev);


// Modal Restore Events
closeButtons.forEach(btn => btn.onclick = closeAllModalsAndClearSession);


// 1. Event Khôi phục Cài đặt
btnRestoreSettings.onclick = () => {
    const rawSettings = pendingRestore.settings;
    
    applyRawSettingsToInputs(rawSettings); 
    calculateTimerSettings(); // Áp dụng settings mới (đã khôi phục)
    
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase(); // Tiếp tục hỏi khôi phục video
    } else {
        resetTimerToCurrentMode();
        closeAllModalsAndClearSession(); 
    }
};

// 2. Event Bỏ qua Cài đặt 
btnSkipSettings.onclick = () => {
    calculateTimerSettings(); // Vẫn tính toán settings từ input để áp dụng cho timer
    
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase(); // Tiếp tục hỏi khôi phục video
    } else {
        resetTimerToCurrentMode();
        closeAllModalsAndClearSession(); 
    }
};

// 3. Event Khôi phục Video 
btnRestoreVideo.onclick = (e) => {
    const targetButton = e.currentTarget; 
    const startTime = parseFloat(targetButton.dataset.time);
    const index = parseInt(targetButton.dataset.index);
    const wasPlaying = targetButton.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); 
};

// 4. Event Bỏ qua Video
btnSkipVideo.onclick = () => {
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); 
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); 
};

// 5. Event Khôi phục Timer 
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore.session;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    
    // Đã tính toán cài đặt (settings) ở bước trước, chỉ cần đặt lại initialTime
    initialTime = timerSettings[currentMode]; 
    updateDisplay(); 
    
    if (timer.isRunning) {
        isRunning = true;
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        startTimer();
    }
    
    closeAllModalsAndClearSession(); 
};

// 6. Event Bỏ qua Timer 
btnSkipTimer.onclick = () => {
    resetTimer(); 
    closeAllModalsAndClearSession();
};


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
    
    // Bắt đầu quá trình khôi phục theo thứ tự: Settings -> Video -> Timer
    if (pendingRestore && pendingRestore.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
    } else {
        // Nếu không có cài đặt cũ, đặt lại timer theo giá trị input/mặc định
        resetTimerToCurrentMode(); 
    }
};

init();
