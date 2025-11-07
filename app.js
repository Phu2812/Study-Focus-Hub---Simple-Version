// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; // Key cho session Timer/Video đang chạy
const SETTINGS_KEY = 'timer_settings_store'; // Key cho cài đặt thời gian
const THEME_KEY = 'app_theme_mode'; // Key cho chế độ Sáng/Tối
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 

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
        shortBreakHour: 0, shortBreakMinute: 5,
        longBreakHour: 0, longBreakMinute: 15,
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
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const skipBtn = document.getElementById('btn-skip'); 
const alarmSound = document.getElementById('alarm-sound');
const progressCircleEl = document.getElementById('progress-circle'); // Progress Circle

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
    if (!isRunning) return; // Chỉ lưu khi Timer đang chạy
    
    const sessionData = {
        video: {
            index: currentTrackIndex,
            time: player ? player.getCurrentTime() : 0,
            wasPlaying: player ? player.getPlayerState() === 1 : false, // 1 là đang play
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
        <p>Học: ${raw.studyHour}h ${raw.studyMinute}p</p>
        <p>Nghỉ Ngắn: ${raw.shortBreakMinute}p | Nghỉ Dài: ${raw.longBreakMinute}p</p>
        <p>Chu kỳ: ${raw.totalCycles}</p>
    `;
    settingsRestoreModalEl.style.display = 'flex';
};

/**
 * Hiển thị Modal khôi phục Video
 */
const showVideoRestorePhase = () => {
    const { video } = pendingRestore.session;
    const song = currentPlaylist[video.index];
    
    // Nếu không có video hoặc video không hợp lệ, bỏ qua bước này
    if (!song) {
        showTimerRestorePhase();
        return;
    }

    const minutes = Math.floor(video.time / 60);
    const seconds = Math.floor(video.time % 60);
    const timeString = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

    document.getElementById('video-restore-info').innerHTML = `
        <p>Bài hát: <strong>${song.title}</strong></p>
        <p>Thời điểm: ${timeString}</p>
    `;

    // Gán dữ liệu vào nút để JS có thể truy cập dễ dàng
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
 * Lấy cài đặt từ input và tính toán thời gian (tính bằng giây)
 */
const calculateTimerSettings = () => {
    // Lấy giá trị từ inputs và làm sạch
    const getVal = (id) => Math.max(0, parseInt(document.getElementById(id).value) || 0);

    const studyHour = getVal('study-hour');
    const studyMinute = getVal('study-minute');
    const shortBreakMinute = getVal('short-break');
    const longBreakMinute = getVal('long-break');
    const totalCycles = getVal('total-cycles');

    // Cập nhật timerSettings.raw
    timerSettings.raw = {
        studyHour, studyMinute,
        shortBreakHour: 0, shortBreakMinute, // Chỉ dùng phút cho Break
        longBreakHour: 0, longBreakMinute, 
        totalCycles: Math.max(1, totalCycles), // Chu kỳ tối thiểu là 1
    };

    // Tính toán thời gian (giây)
    timerSettings.study = (studyHour * 3600) + (studyMinute * 60);
    timerSettings.shortBreak = shortBreakMinute * 60;
    timerSettings.longBreak = longBreakMinute * 60;
    timerSettings.totalCycles = timerSettings.raw.totalCycles; 
    
    // Đảm bảo thời gian tối thiểu là 1 phút (60 giây) nếu người dùng nhập 0
    timerSettings.study = Math.max(60, timerSettings.study); 
    timerSettings.shortBreak = Math.max(60, timerSettings.shortBreak);
    timerSettings.longBreak = Math.max(60, timerSettings.longBreak);

    saveSettings(); 
};

/**
 * Load cài đặt từ Local Storage và áp dụng vào input
 */
const loadSettings = () => {
    const savedRaw = localStorage.getItem(SETTINGS_KEY);
    if (savedRaw) {
        const raw = JSON.parse(savedRaw);
        pendingRestore = { settings: raw }; // Đánh dấu có cài đặt cũ
        return; // Sẽ xử lý sau trong init
    } else {
        calculateTimerSettings(); // Tính toán và lưu cài đặt mặc định/hiện tại
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
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

/**
 * Cập nhật vòng tròn đếm ngược (Progress Circle)
 */
const updateProgressCircle = () => {
    // initialTime là tổng thời gian của mode hiện tại (Study, ShortBreak, LongBreak)
    // timeLeft là thời gian còn lại
    if (initialTime === 0) return;
    
    const timeElapsed = initialTime - timeLeft;
    const percentage = (timeElapsed / initialTime) * 100;
    const degree = (percentage / 100) * 360; // Chuyển phần trăm sang góc (0 đến 360 độ)
    
    // Chọn màu cho chế độ hiện tại
    const activeColor = currentMode === 'study' ? 'var(--color-study)' : 'var(--color-break)';
    const trackColor = 'var(--circle-bg)';

    // Sử dụng Conic Gradient để tạo vòng tròn đếm ngược
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
    
    // Cập nhật Vòng tròn Đếm ngược
    updateProgressCircle();

    const totalCycles = timerSettings.totalCycles;
    const currentCycle = cycleCount % totalCycles;
    const displayCycle = currentCycle === 0 && cycleCount > 0 ? totalCycles : currentCycle;
    cycleInfoEl.textContent = `Chu kỳ: ${displayCycle} / ${totalCycles}`;
    
    document.title = `${formatTime(timeLeft)} - ${modeText}`;
};

/**
 * Áp dụng giá trị thời gian đầy đủ cho chế độ hiện tại.
 */
const resetTimerToCurrentMode = () => {
    initialTime = timerSettings[currentMode]; // Cập nhật tổng thời gian ban đầu
    timeLeft = initialTime;
    updateDisplay();
}


const switchMode = async (autoStartNext = true) => {
    // 1. Dừng và làm mờ báo thức
    pauseTimer(false); // Dừng Interval
    await fadeAlarm(true); // Làm mờ và dừng báo thức

    // 2. Chuyển Mode
    if (currentMode === 'study') {
        cycleCount++;
        if (cycleCount % timerSettings.totalCycles === 0) {
            currentMode = 'longBreak';
        } else {
            currentMode = 'shortBreak';
        }
    } else { // break mode
        currentMode = 'study';
    }

    // 3. Reset và Cập nhật hiển thị
    resetTimerToCurrentMode(); 
    
    // 4. Nếu có nhạc, chuyển bài hoặc play/pause theo yêu cầu (optional: có thể bỏ qua)
    if (player && currentPlaylist.length > 0) {
        // Tùy chọn: Tự động chuyển bài khi hết giờ
        // playNext(); 
    }

    // 5. Tự động bắt đầu mode mới
    if (autoStartNext) {
        startTimer();
    }
};

const startTimer = () => {
    if (intervalId) clearInterval(intervalId);
    
    // Lần đầu chạy, đảm bảo initialTime được thiết lập
    if (initialTime === 0 || isNaN(initialTime)) {
         initialTime = timerSettings[currentMode];
    }
    
    isRunning = true;
    startPauseBtn.innerHTML = '⏸ Tạm Dừng';

    intervalId = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            switchMode(true); 
        } else {
            updateDisplay();
            saveSession(); // Lưu trạng thái mỗi giây
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
    currentMode = 'study';
    cycleCount = 0;
    resetTimerToCurrentMode(); // Đảm bảo reset lại thời gian và initialTime
};

// =======================================================
//                   YOUTUBE PLAYER LOGIC
// =======================================================

// Hàm được gọi khi YouTube API sẵn sàng
function onYouTubeIframeAPIReady() {
    // Load video đầu tiên nếu có
    if (currentPlaylist.length > 0) {
        currentTrackIndex = 0;
        loadVideoPlayer(currentPlaylist[currentTrackIndex].id);
    } else {
        loadVideoPlayer(null);
    }
}

const loadVideoPlayer = (videoId) => {
    const playerContainer = document.getElementById('youtube-player');
    
    // Nếu chưa có Player, khởi tạo
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
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError,
            }
        });
    } else {
        // Nếu đã có Player, chỉ cần load video mới
        if (videoId) {
            playerPlaceholder.style.display = 'none';
            player.loadVideoById(videoId);
        } else {
             // Ẩn player, hiển thị placeholder
            playerPlaceholder.style.display = 'flex';
        }
    }
};

const onPlayerReady = (event) => {
    // Tùy chỉnh Volume khi Player sẵn sàng
    if (player) {
        player.setVolume(currentVolume * 100);
    }
    // Xử lý logic khôi phục phiên Video
    if (pendingRestore && pendingRestore.session) {
        // Logic sẽ được gọi sau khi kiểm tra settings
    } else if (currentPlaylist.length > 0) {
        // Tự động load video đầu tiên
        playVideoAtIndex(0, false, 0); 
    }
};

const onPlayerStateChange = (event) => {
    const state = event.data;
    if (state === YT.PlayerState.PLAYING) { // Đang Play
        btnPlayPause.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
    }
    
    if (state === YT.PlayerState.ENDED) { // Hết bài
        playNext();
    }
    saveSession();
};

const onPlayerError = (event) => {
    console.error('YouTube Player Error:', event.data);
    // Bỏ qua bài lỗi
    playNext();
};

const playVideoAtIndex = (index, autoPlay = true, startTime = 0) => {
    if (index >= 0 && index < currentPlaylist.length) {
        currentTrackIndex = index;
        const videoId = currentPlaylist[index].id;
        
        if (player) {
            playerPlaceholder.style.display = 'none';
            // loadVideoById: videoId, startSeconds, suggestedQuality
            player.loadVideoById(videoId, startTime, 'default'); 
            if (!autoPlay) {
                // Sử dụng setTimeOut để đảm bảo load xong rồi mới dừng
                setTimeout(() => {
                    player.pauseVideo();
                    btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
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
//                   PLAYLIST LOGIC (Kéo & Thả)
// =======================================================

/**
 * Lấy ID Video từ URL YouTube
 */
const getVideoId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

/**
 * Lấy tiêu đề video từ YouTube oEmbed API
 */
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

/**
 * Thêm bài hát vào playlist
 */
const addSong = async (url) => {
    const videoId = getVideoId(url);
    if (!videoId) {
        errorEl.textContent = 'Lỗi: URL YouTube không hợp lệ.';
        return;
    }
    
    // Kiểm tra trùng lặp
    if (currentPlaylist.some(song => song.id === videoId)) {
        errorEl.textContent = 'Video này đã có trong playlist.';
        return;
    }

    errorEl.textContent = 'Đang tải tiêu đề...';
    const title = await getVideoTitle(videoId);

    // Thêm vào playlist
    const newSong = { 
        id: videoId, 
        title: title, 
        unique_id: Date.now() 
    };
    currentPlaylist.push(newSong);
    
    errorEl.textContent = '';
    urlInputEl.value = '';
    
    // Nếu là bài đầu tiên, tự động load
    if (currentTrackIndex === -1) {
        currentTrackIndex = 0;
        loadVideoPlayer(videoId);
    }
    
    savePlaylist();
    renderPlaylist();
};

/**
 * Xóa bài hát khỏi playlist
 */
const removeSong = (uniqueId) => {
    const index = currentPlaylist.findIndex(song => song.unique_id === uniqueId);
    if (index > -1) {
        // Xóa khỏi mảng
        currentPlaylist.splice(index, 1); 

        // Xử lý index bài đang phát
        if (index === currentTrackIndex) {
            // Nếu xóa bài đang phát, chuyển sang bài tiếp theo (hoặc về 0)
            currentTrackIndex = currentPlaylist.length > 0 ? 0 : -1;
            if (currentPlaylist.length > 0) {
                 playVideoAtIndex(currentTrackIndex, false, 0); 
            } else if (player) {
                // Dừng và hiển thị placeholder
                player.stopVideo();
                playerPlaceholder.style.display = 'flex';
            }
        } else if (index < currentTrackIndex) {
            // Nếu xóa bài phía trước bài đang phát, giảm index của bài đang phát đi 1
            currentTrackIndex--;
        }
        
        savePlaylist();
        renderPlaylist();
    }
};

/**
 * Lưu playlist vào Local Storage
 */
const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
};

/**
 * Load playlist từ Local Storage
 */
const loadPlaylist = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        currentPlaylist = JSON.parse(saved);
    }
};

/**
 * Render (vẽ) lại danh sách playlist
 */
const renderPlaylist = () => {
    playlistListEl.innerHTML = '';
    currentPlaylist.forEach((song, index) => {
        const li = document.createElement('li');
        li.dataset.id = song.unique_id; // Dùng unique_id cho Drag & Drop
        li.draggable = true;
        
        li.innerHTML = `
            <span>${index + 1}. ${song.title}</span>
            <button class="btn-delete" data-id="${song.unique_id}"><i class="fas fa-trash-alt"></i></button>
        `;
        
        if (index === currentTrackIndex) {
            li.classList.add('current-track');
        }
        
        // Event click để chuyển bài
        li.querySelector('span').addEventListener('click', () => {
            playVideoAtIndex(index);
        });

        // Event xóa
        li.querySelector('.btn-delete').addEventListener('click', (e) => {
            e.stopPropagation(); // Ngăn click từ LI
            removeSong(song.unique_id);
        });

        // Event Drag & Drop
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);

        playlistListEl.appendChild(li);
    });
};

// =======================================================
//                   DRAG & DROP LOGIC
// =======================================================

let draggingItem = null;

function handleDragStart() {
    draggingItem = this;
    setTimeout(() => this.style.display = 'none', 0);
}

function handleDragEnd() {
    setTimeout(() => this.style.display = 'flex', 0);
    this.classList.remove('drag-over');
    draggingItem = null;
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDragEnter() {
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
        const draggedUniqueId = parseInt(draggingItem.dataset.id);
        const droppedUniqueId = parseInt(this.dataset.id);
        
        const draggedIndex = currentPlaylist.findIndex(song => song.unique_id === draggedUniqueId);
        const droppedIndex = currentPlaylist.findIndex(song => song.unique_id === droppedUniqueId);

        const [movedItem] = currentPlaylist.splice(draggedIndex, 1);
        currentPlaylist.splice(droppedIndex, 0, movedItem);

        // Cập nhật index bài đang phát sau khi kéo thả
        if (currentTrackIndex === draggedIndex) {
            currentTrackIndex = droppedIndex;
        } else if (currentTrackIndex > draggedIndex && currentTrackIndex <= droppedIndex) {
            currentTrackIndex--;
        } else if (currentTrackIndex < draggedIndex && currentTrackIndex >= droppedIndex) {
            currentTrackIndex++;
        }

        savePlaylist();
        renderPlaylist();
    }
}

// =======================================================
//                   ALARM LOGIC
// =======================================================

/**
 * Phát báo thức và làm mờ dần âm lượng
 */
const fadeAlarm = (start = true, callback = () => {}) => {
    return new Promise(resolve => {
        if (start) {
            alarmSound.volume = currentVolume; // Bắt đầu ở âm lượng hiện tại
            alarmSound.play().catch(e => console.error("Lỗi phát báo thức:", e));
            
            // Dừng báo thức sau 3 giây (hoặc thời lượng nhạc)
            setTimeout(() => {
                fadeAlarm(false, resolve);
            }, 3000); 

        } else {
            // Logic làm mờ (fade out)
            let volume = currentVolume;
            const step = volume / (ALARM_FADE_DURATION / 100); // Giảm 10 lần mỗi giây
            
            const fadeInterval = setInterval(() => {
                volume -= step;
                if (volume <= 0) {
                    clearInterval(fadeInterval);
                    alarmSound.pause();
                    alarmSound.currentTime = 0;
                    alarmSound.volume = currentVolume;
                    resolve();
                } else {
                    alarmSound.volume = volume;
                }
            }, 100); 
        }
    });
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
skipBtn.addEventListener('click', () => switchMode(false)); // Bỏ qua mode hiện tại, không tự động chạy mode mới

// Settings Events
settingsInputs.forEach(input => { 
    input.addEventListener('change', () => {
        // Áp dụng giới hạn số (để tránh lỗi)
        const val = parseInt(input.value);
        if (isNaN(val)) input.value = input.min;
        if (val < parseInt(input.min)) input.value = input.min;
        if (val > parseInt(input.max)) input.value = input.max;
        
        // Tính toán và lưu cài đặt
        calculateTimerSettings(); 
        
        // Nếu Timer đang dừng, cập nhật lại thời gian mode hiện tại
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
    if (state === 1) { // 1: Playing
        player.pauseVideo();
    } else {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        if (player.getVideoUrl().includes('placeholder')) {
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


// 1. Event Khôi phục Cài đặt (Modal Settings)
btnRestoreSettings.onclick = () => {
    const rawSettings = pendingRestore.settings;
    
    applyRawSettingsToInputs(rawSettings); // Áp dụng giá trị vào input
    calculateTimerSettings(); // Tính toán và lưu
    
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase(); // Chuyển sang khôi phục Video
    } else {
        resetTimerToCurrentMode();
        closeAllModalsAndClearSession(); // Hoàn thành
    }
};

// 2. Event Bỏ qua Cài đặt (Modal Settings)
btnSkipSettings.onclick = () => {
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore.session) {
        showVideoRestorePhase(); // Chuyển sang khôi phục Video
    } else {
        resetTimerToCurrentMode();
        closeAllModalsAndClearSession(); // Hoàn thành
    }
};

// 3. Event Khôi phục Video (Modal Video)
btnRestoreVideo.onclick = (e) => {
    const startTime = parseFloat(btnRestoreVideo.dataset.time);
    const index = parseInt(btnRestoreVideo.dataset.index);
    const wasPlaying = btnRestoreVideo.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        // Khôi phục video và play/pause đúng trạng thái đã lưu
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); // Chuyển sang khôi phục Timer
};

// 4. Event Bỏ qua Video (Modal Video)
btnSkipVideo.onclick = () => {
    // Nếu có playlist, load video đầu tiên (hoặc hiện tại) nhưng không play, từ đầu.
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); // Load video từ đầu, không play
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); // Chuyển sang khôi phục Timer
};

// 5. Event Khôi phục Timer (Modal Timer)
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore.session;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    
    // Tính toán lại cài đặt dựa trên input hiện tại (đã được load/khôi phục từ settings modal)
    calculateTimerSettings(); 
    
    // Đặt lại initialTime cho Progress Circle
    initialTime = timerSettings[currentMode]; 
    updateDisplay(); 
    
    if (timer.isRunning) {
        isRunning = true;
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        startTimer();
    }
    
    closeAllModalsAndClearSession(); // Hoàn thành tất cả và đóng Modal
};

// 6. Event Bỏ qua Timer (Modal Timer)
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
    
    // Load Settings Restore
    loadSettings();
    
    // Bắt đầu quá trình khôi phục (nếu có)
    if (pendingRestore && pendingRestore.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
    } else {
        // Nếu không có settings cũ, đảm bảo các giá trị được tính toán và hiển thị đúng
        resetTimerToCurrentMode(); 
    }
};

init();
