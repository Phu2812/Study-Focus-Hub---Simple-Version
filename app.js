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
const timerRestoreModalEl = document.getElementById('timer-restore-modal');
const settingsRestoreModalEl = document.getElementById('settings-restore-modal');

const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const btnRestoreSettings = document.getElementById('btn-restore-settings');
const btnSkipSettings = document.getElementById('btn-skip-settings');

// Theme Toggle
const themeToggleBtn = document.getElementById('theme-toggle');

// Audio Element
const alarmSound = document.getElementById('alarm-sound'); 

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
 * Đặt lại Timer về mode Study mặc định (dùng cho nút Reset hoặc Skip Timer Modal).
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
 * Phát và Fade Out âm thanh báo thức trong 3 giây.
 * ĐÃ SỬA: Đảm bảo âm thanh phát và resolve sau 3 giây.
 */
const fadeAlarm = () => {
    return new Promise((resolve) => {
        // Đặt âm lượng mặc định trước khi phát
        alarmSound.volume = 0.5;
        alarmSound.currentTime = 0;

        // Bắt đầu phát (dùng catch để xử lý lỗi chặn Autoplay)
        alarmSound.play().catch(e => {
            console.warn("Trình duyệt chặn phát âm thanh thông báo. Vui lòng tương tác (click) với trang.", e);
        }); 
        
        const ALARM_TOTAL_DURATION = 3000; 
        const startTime = Date.now();
        
        let volume = 0.5;

        // Interval để giảm dần âm lượng
        const fadeInterval = setInterval(() => {
            // Bắt đầu giảm dần sau 2 giây (để báo thức phát to trong 2s đầu)
            if (Date.now() - startTime >= 2000) { 
                 volume -= 0.05; 
            }
            
            // Dừng Interval khi âm lượng về 0 hoặc đã đạt đủ thời gian
            if (volume <= 0 || Date.now() - startTime >= ALARM_TOTAL_DURATION) {
                clearInterval(fadeInterval);
                alarmSound.pause();
                alarmSound.currentTime = 0; 
                alarmSound.volume = 0.5; 
                resolve();
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
        }, ALARM_TOTAL_DURATION); 
    });
};


/**
 * Hàm chuyển mode Pomodoro. 
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
    
    // 3. TẠM DỪNG VIDEO với khoảng trễ ngắn (50ms) để Audio.play() được ưu tiên chạy trước
    if (player && player.pauseVideo) {
        setTimeout(() => {
             player.pauseVideo();
        }, 50); 
    }

    // 4. Phát và chờ báo thức kết thúc (3 giây)
    await fadeAlarm(); 
    
    // 5. Tự động phát lại video sau khi báo thức xong (CHỈ KHI NÓ ĐANG CHẠY TRƯỚC ĐÓ)
    if (player && shouldResumeVideo && player.playVideo) {
        try {
            player.playVideo();
        } catch (e) {
            console.error("Lỗi tự động phát lại video:", e);
        }
    }

    // 6. Chuyển Mode và Cập nhật Chu kỳ 
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

    // 7. Reset và Tự động BẮT ĐẦU MODE MỚI
    resetTimerToCurrentMode(); 
    startTimer(); // Tự động bắt đầu
};

// =======================================================
//                   VIDEO PLAYER & PLAYLIST LOGIC
// =======================================================

// --- YouTube API functions ---

/**
 * Bắt đầu tạo Player khi API sẵn sàng
 */
function onYouTubeIframeAPIReady() {
    // Tạo Player
    createPlayer(currentPlaylist.length > 0 ? currentPlaylist[0].id : 'dQw4w9WgXcQ'); // ID mặc định
    // Sau khi Player được tạo, checkRestoreStatus sẽ được gọi trong onPlayerReady
}

/**
 * Hàm tạo YouTube Player
 */
function createPlayer(videoId) {
    if (player) return; // Không tạo lại
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

/**
 * Xử lý khi Player sẵn sàng
 */
function onPlayerReady(event) {
    playerPlaceholderEl.style.display = 'none';
    videoContainerEl.style.display = 'block';
    
    // Bắt đầu quá trình khôi phục sau khi player sẵn sàng
    checkRestoreStatus();
}

/**
 * Xử lý thay đổi trạng thái của Player
 */
function onPlayerStateChange(event) {
    // Tự động chuyển bài khi kết thúc (YT.PlayerState.ENDED = 0)
    if (event.data === YT.PlayerState.ENDED) {
        nextTrack();
    }
}


// --- Playlist logic ---

/**
 * Lấy ID YouTube từ URL
 */
const getYouTubeId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\/(?:v|e)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return (match && match[1].length === 11) ? match[1] : null;
};

/**
 * Thêm video vào playlist
 */
const addVideoToPlaylist = async () => {
    const url = youtubeUrlInput.value.trim();
    const videoId = getYouTubeId(url);
    errorMessageEl.textContent = '';

    if (!videoId) {
        errorMessageEl.textContent = 'Lỗi: URL YouTube không hợp lệ.';
        return;
    }

    // Lấy tiêu đề video (sử dụng oEmbed API)
    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}${videoId}&format=json`);
        const data = await response.json();
        
        const newTrack = {
            id: videoId,
            title: data.title || 'Video không tên'
        };
        
        currentPlaylist.push(newTrack);
        savePlaylist();
        renderPlaylist();
        youtubeUrlInput.value = '';

        // Nếu playlist rỗng, load video mới ngay lập tức
        if (currentPlaylist.length === 1) {
             currentTrackIndex = 0;
             playVideoById(videoId);
        }

    } catch (error) {
        errorMessageEl.textContent = 'Lỗi: Không thể lấy thông tin video. Vui lòng kiểm tra URL.';
    }
};

/**
 * Render playlist ra DOM
 */
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
        
        // Event Listeners cho nút Play
        listItem.querySelector('.btn-play').addEventListener('click', () => {
            playVideoAtIndex(index, true, 0);
        });

        // Event Listeners cho nút Remove
        listItem.querySelector('.btn-remove').addEventListener('click', (e) => {
            e.stopPropagation(); // Ngăn chặn trigger event của listItem
            removeTrack(index);
        });

        playlistListEl.appendChild(listItem);
    });
};

/**
 * Phát video theo ID (loadPlayer)
 */
const playVideoById = (videoId, startSeconds = 0) => {
    if (player && player.loadVideoById) {
        player.loadVideoById(videoId, startSeconds);
    } else {
        // Tạo player nếu chưa có
        createPlayer(videoId);
    }
};

/**
 * Phát video theo Index trong Playlist
 */
const playVideoAtIndex = (index, autoPlay = true, startSeconds = 0) => {
    if (index < 0 || index >= currentPlaylist.length) return;

    currentTrackIndex = index;
    const videoId = currentPlaylist[index].id;
    
    // Cập nhật class 'active'
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.playlist-item[data-index="${index}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    playVideoById(videoId, startSeconds);

    if (!autoPlay) {
        // Tạm dừng ngay sau khi load
        if (player && player.pauseVideo) {
            player.pauseVideo();
        }
    }
    savePlaylist();
    saveSession();
};

/**
 * Chuyển sang bài tiếp theo
 */
const nextTrack = () => {
    if (currentPlaylist.length === 0) return;

    let newIndex = currentTrackIndex + 1;
    if (newIndex >= currentPlaylist.length) {
        newIndex = 0; // Quay lại bài đầu tiên
    }
    playVideoAtIndex(newIndex);
};

/**
 * Quay lại bài trước
 */
const prevTrack = () => {
    if (currentPlaylist.length === 0) return;

    let newIndex = currentTrackIndex - 1;
    if (newIndex < 0) {
        newIndex = currentPlaylist.length - 1; // Quay lại bài cuối cùng
    }
    playVideoAtIndex(newIndex);
};

/**
 * Xóa track khỏi playlist
 */
const removeTrack = (index) => {
    if (index < 0 || index >= currentPlaylist.length) return;

    // Nếu xóa bài đang chạy
    if (index === currentTrackIndex) {
        currentPlaylist.splice(index, 1);
        
        if (currentPlaylist.length === 0) {
            currentTrackIndex = -1;
            if (player && player.stopVideo) player.stopVideo();
            playerPlaceholderEl.style.display = 'flex';
            videoContainerEl.style.display = 'none';
        } else {
            // Chuyển sang bài tiếp theo (nếu là bài cuối, chuyển về đầu)
            currentTrackIndex = (index >= currentPlaylist.length) ? 0 : index;
            playVideoAtIndex(currentTrackIndex);
        }
    } else {
        currentPlaylist.splice(index, 1);
        // Cập nhật lại index nếu bài đang chạy nằm sau bài bị xóa
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
            // ** ĐÃ SỬA: KHÔNG LƯU timeLeft **
            currentMode: currentMode,
            cycleCount: cycleCount,
            isRunning: isRunning 
        }
    };

    // 3. Lưu
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
};

/**
 * Tải Playlist từ Local Storage.
 */
const loadPlaylist = () => {
    const savedPlaylist = localStorage.getItem(STORAGE_KEY);
    if (savedPlaylist) {
        const data = JSON.parse(savedPlaylist);
        currentPlaylist = data.playlist || [];
        currentTrackIndex = data.index !== undefined ? data.index : -1;
    }
};

/**
 * Lưu Playlist vào Local Storage.
 */
const savePlaylist = () => {
    const data = {
        playlist: currentPlaylist,
        index: currentTrackIndex
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

/**
 * Tải Cài đặt Timer từ Local Storage.
 */
const loadSettings = () => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
        try {
            const rawSettings = JSON.parse(savedSettings);
            // Lưu lại settings vào pendingRestore để xử lý qua Modal (nếu có)
            pendingRestore = pendingRestore || {};
            pendingRestore.settings = rawSettings;

        } catch(e) {
            console.error("Lỗi parse settings:", e);
        }
    }
    // Nếu không có pendingRestore.settings, sẽ sử dụng timerSettings mặc định
    calculateTimerSettings();
};

/**
 * Lưu Cài đặt Timer vào Local Storage.
 */
const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings.raw));
};

/**
 * Tính toán timerSettings (seconds) từ timerSettings.raw (minutes).
 */
const calculateTimerSettings = () => {
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

/**
 * Cập nhật input Settings theo giá trị hiện tại.
 */
const updateSettingsInputs = () => {
    studyInput.value = timerSettings.raw.study;
    shortBreakInput.value = timerSettings.raw.shortBreak;
    longBreakInput.value = timerSettings.raw.longBreak;
    cyclesInput.value = timerSettings.raw.totalCycles;
};

/**
 * Xử lý khi người dùng ấn nút Apply Settings.
 */
const applySettings = () => {
    const studyM = parseInt(studyInput.value);
    const shortM = parseInt(shortBreakInput.value);
    const longM = parseInt(longBreakInput.value);
    const cycles = parseInt(cyclesInput.value);
    
    // Kiểm tra tính hợp lệ
    if (studyM < 1 || shortM < 1 || longM < 1 || cycles < 1) {
        alert("Thời gian và chu kỳ phải lớn hơn 0.");
        return;
    }

    // Cập nhật Raw settings
    timerSettings.raw.study = studyM;
    timerSettings.raw.shortBreak = shortM;
    timerSettings.raw.longBreak = longM;
    timerSettings.raw.totalCycles = cycles;

    // Tính toán lại seconds và cập nhật Display
    calculateTimerSettings();
    saveSettings();

    // Dừng timer (nếu đang chạy) và reset về đầu mode hiện tại
    pauseTimer();
    resetTimerToCurrentMode();
    toggleSettings(); // Đóng settings
};

// --- Modal Logic ---

/**
 * Đóng tất cả modal và xóa pending restore session.
 */
const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    settingsRestoreModalEl.style.display = 'none';
    sessionStorage.removeItem(SESSION_KEY);
    pendingRestore = null;
    
    // Nếu chưa khôi phục gì cả, phải đảm bảo Timer được init
    if (timeLeft === 0) {
        initialTime = timerSettings.study;
        timeLeft = timerSettings.study;
        updateDisplay();
    }
};

/**
 * Bắt đầu kiểm tra trạng thái khôi phục (Settings -> Video -> Timer).
 */
const checkRestoreStatus = () => {
    // 1. Kiểm tra Settings
    if (pendingRestore && pendingRestore.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
        return;
    }
    
    // 2. Kiểm tra Video
    if (pendingRestore && pendingRestore.session && pendingRestore.session.video) {
        showVideoRestorePhase();
        return;
    } 

    // 3. Kiểm tra Timer (chỉ mode/cycle)
     if (pendingRestore && pendingRestore.session && pendingRestore.session.timer) {
        showTimerRestorePhase();
        return;
    } 
    
    // Nếu không có gì, đóng
    closeAllModalsAndClearSession();
};

/**
 * Hiện Modal khôi phục Settings.
 */
const showSettingsRestorePhase = (rawSettings) => {
    let infoHtml = '<ul>';
    infoHtml += `<li>**Tập Trung:** ${rawSettings.study} phút</li>`;
    infoHtml += `<li>**Nghỉ Ngắn:** ${rawSettings.shortBreak} phút</li>`;
    infoHtml += `<li>**Nghỉ Dài:** ${rawSettings.longBreak} phút</li>`;
    infoHtml += `<li>**Tổng Chu Kỳ:** ${rawSettings.totalCycles}</li></ul>`;
    
    document.getElementById('settings-restore-info').innerHTML = infoHtml;

    // Đặt dữ liệu khôi phục vào button
    btnRestoreSettings.dataset.settings = JSON.stringify(rawSettings);

    settingsRestoreModalEl.style.display = 'flex';
};


/**
 * Hiện Modal khôi phục Video.
 */
const showVideoRestorePhase = () => {
    const { video } = pendingRestore.session;
    const track = currentPlaylist[video.index];
    const restoreTimeDisplay = formatTime(video.time);

    document.getElementById('video-restore-info').innerHTML = `
        <p>Video: **${track ? track.title : 'Không rõ (Đã xóa)'}**</p>
        <p>Tiếp tục từ: **${restoreTimeDisplay}**</p>
    `;

    // Đặt dữ liệu khôi phục vào button
    btnRestoreVideo.dataset.time = video.time;
    btnRestoreVideo.dataset.index = video.index;
    btnRestoreVideo.dataset.play = video.isPlaying;
    
    videoRestoreModalEl.style.display = 'flex';
};

/**
 * Hiện Modal khôi phục Timer.
 * HÀM SỬA: Chỉ hiển thị mode và cycle, thông báo sẽ reset thời gian.
 */
const showTimerRestorePhase = () => {
    const { timer } = pendingRestore.session;

    // Hiển thị thời gian ban đầu của mode đó
    const restoreTimeDisplay = formatTime(timerSettings[timer.currentMode]); 
    
    document.getElementById('timer-restore-info').innerHTML = `
        <ul>
            <li>**Mode:** **${timer.currentMode === 'study' ? 'Tập Trung' : (timer.currentMode === 'shortBreak' ? 'Nghỉ Ngắn' : 'Nghỉ Dài')}**</li>
            <li>**Chu kỳ:** **${timer.cycleCount} / ${timerSettings.totalCycles}**</li>
        </ul>
        <p style="margin-top: 10px;">Lưu ý: Timer sẽ được đặt lại về đầu phiên **(${restoreTimeDisplay})**.</p>
    `;
    
    // Đặt dữ liệu khôi phục vào button
    btnRestoreTimer.dataset.currentMode = timer.currentMode;
    btnRestoreTimer.dataset.cycleCount = timer.cycleCount;
    btnRestoreTimer.dataset.isRunning = timer.isRunning;

    timerRestoreModalEl.style.display = 'flex';
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
    updateSettingsInputs(); // Load giá trị hiện tại vào inputs
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
document.querySelector('.modal-close-timer').onclick = closeAllModalsAndClearSession;
document.querySelector('.modal-close-settings').onclick = closeAllModalsAndClearSession;

// --- Modal Events ---

// 1. Settings Modal Events
btnRestoreSettings.onclick = (e) => {
    const rawSettings = JSON.parse(e.target.dataset.settings);
    
    timerSettings.raw = rawSettings;
    calculateTimerSettings(); // Cập nhật timerSettings (seconds)

    settingsRestoreModalEl.style.display = 'none';
    
    // Tiếp tục kiểm tra Video
    if (pendingRestore.session && pendingRestore.session.video) {
        showVideoRestorePhase(); 
    } else if (pendingRestore.session && pendingRestore.session.timer) {
        showTimerRestorePhase(); 
    } else {
        closeAllModalsAndClearSession();
    }
};

btnSkipSettings.onclick = () => {
    settingsRestoreModalEl.style.display = 'none';

    // Tiếp tục kiểm tra Video
    if (pendingRestore.session && pendingRestore.session.video) {
        showVideoRestorePhase(); 
    } else if (pendingRestore.session && pendingRestore.session.timer) {
        showTimerRestorePhase(); 
    } else {
        closeAllModalsAndClearSession();
    }
};

// 2. Video Modal Events (Video -> Timer)
btnRestoreVideo.onclick = (e) => {
    const startTime = parseFloat(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    const wasPlaying = e.target.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    videoRestoreModalEl.style.display = 'none';
    
    // Tiếp tục kiểm tra Timer (nếu có)
    if (pendingRestore.session && pendingRestore.session.timer) {
        showTimerRestorePhase(); 
    } else {
        closeAllModalsAndClearSession();
    }
};

btnSkipVideo.onclick = () => {
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); 
    }
    
    videoRestoreModalEl.style.display = 'none';
    
    // Tiếp tục kiểm tra Timer (nếu có)
    if (pendingRestore.session && pendingRestore.session.timer) {
        showTimerRestorePhase(); 
    } else {
        closeAllModalsAndClearSession();
    }
};

// 3. Timer Modal Events (HÀM SỬA: Khôi phục Mode/Cycle và reset thời gian)
btnRestoreTimer.onclick = (e) => {
    const mode = e.target.dataset.currentmode;
    const cycle = parseInt(e.target.dataset.cyclecount);
    const run = e.target.dataset.isrunning === 'true';
    
    // Khôi phục Mode và Cycle
    currentMode = mode;
    cycleCount = cycle;
    
    // ** QUAN TRỌNG: Đặt lại timeLeft về thời gian ĐẦU của mode đó **
    timeLeft = timerSettings[currentMode]; 
    
    // Tính toán lại settings để đảm bảo initialTime chính xác (dù đã chạy qua loadSettings trước đó)
    calculateTimerSettings(); 
    updateDisplay(); 
    
    // Khôi phục trạng thái isRunning
    isRunning = run;
    if (isRunning) {
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        startTimer(); // Bắt đầu lại Timer
    } else {
        startPauseBtn.textContent = '▶ Tiếp Tục';
    }
    
    closeAllModalsAndClearSession(); // Hoàn thành tất cả và đóng Modal
};

// Event Bỏ qua Timer (Modal Timer)
btnSkipTimer.onclick = () => {
    resetTimer(); // Đặt lại về mode Study mặc định
    closeAllModalsAndClearSession();
};

// --- Theme Toggle ---
themeToggleBtn.addEventListener('click', toggleTheme);


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
    
    // Thiết lập initialTime và timeLeft ban đầu 
    initialTime = timerSettings.study;
    timeLeft = timerSettings.study;
    updateDisplay(); 

    // Nếu YT API chưa sẵn sàng, onYouTubeIframeAPIReady sẽ gọi createPlayer, 
    // và onPlayerReady sẽ gọi checkRestoreStatus()
    if (typeof YT === 'undefined' || !YT.Player) {
        // Chờ API load
    } else {
        // Nếu YT API đã sẵn sàng (trường hợp hiếm), gọi checkRestoreStatus()
        checkRestoreStatus(); 
    }
};

// Khởi tạo ứng dụng
document.addEventListener('DOMContentLoaded', init);
