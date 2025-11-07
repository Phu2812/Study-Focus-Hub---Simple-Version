// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const SETTINGS_KEY = 'timer_settings_store'; 
const THEME_KEY = 'app_theme_mode'; 
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 
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
let pendingRestore = null; 
let currentTheme = 'dark'; // Mặc định là dark

// Elements
const playlistListEl = document.getElementById('playlist-list');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const resetBtn = document.getElementById('btn-reset');
const skipBtn = document.getElementById('btn-skip');
const alarmSound = document.getElementById('alarm-sound');
const progressCircle = document.getElementById('progress-circle');
const themeToggleBtn = document.getElementById('theme-toggle');

// Modal Elements
const videoRestoreModalEl = document.getElementById('video-restore-modal');
const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const timerRestoreModalEl = document.getElementById('timer-restore-modal');
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const settingsRestoreModalEl = document.getElementById('settings-restore-modal');
const btnRestoreSettings = document.getElementById('btn-restore-settings');
const btnSkipSettings = document.getElementById('btn-skip-settings');

// Input Elements (Cho phần Cài đặt)
const studyHourInput = document.getElementById('study-hour');
const studyMinuteInput = document.getElementById('study-minute');
const shortBreakInput = document.getElementById('short-break');
const longBreakInput = document.getElementById('long-break');
const totalCyclesInput = document.getElementById('total-cycles');


// =======================================================
//                   UTILITY FUNCTIONS
// =======================================================

/** SỬA LỖI QUAN TRỌNG: Đảm bảo khi hết giờ (totalSeconds <= 0), hiển thị 00:00 */
const formatTime = (totalSeconds) => {
    if (totalSeconds <= 0) {
        return '00:00'; 
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    // Đảm bảo luôn có 2 chữ số (00)
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

const getYouTubeId = (url) => {
    // Regex lấy ID từ URL thông thường, share link, hoặc embed
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\w\/\w\/|v=)|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return (match && match[1].length === 11) ? match[1] : null;
};

const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
};

const loadPlaylist = () => {
    const savedPlaylist = localStorage.getItem(STORAGE_KEY);
    if (savedPlaylist) {
        currentPlaylist = JSON.parse(savedPlaylist);
    }
};

const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings.raw));
};

const loadSettings = () => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
        // Tải cài đặt thô (giờ/phút/chu kỳ)
        timerSettings.raw = JSON.parse(savedSettings);
        
        // Tái tính toán cài đặt giây (tổng thời gian)
        calculateTimerSettings();
        
        // Cập nhật giá trị hiển thị trên Input
        studyHourInput.value = timerSettings.raw.studyHour;
        studyMinuteInput.value = timerSettings.raw.studyMinute;
        shortBreakInput.value = timerSettings.raw.shortBreak;
        longBreakInput.value = timerSettings.raw.longBreak;
        totalCyclesInput.value = timerSettings.raw.totalCycles;

        // Lưu trữ để có thể hỏi người dùng có muốn khôi phục không (chỉ khi có session đang chạy)
        // Nếu không có session đang chạy, apply luôn setting
        const savedSession = sessionStorage.getItem(SESSION_KEY);
        if (savedSession) {
            pendingRestore = pendingRestore || {};
            pendingRestore.settings = timerSettings.raw; // Đánh dấu là có settings cũ
        } else {
            // Nếu không có session cũ, áp dụng luôn và cập nhật display
            initialTime = timerSettings[currentMode];
            timeLeft = initialTime;
            updateDisplay();
        }
    }
};

const saveSession = () => {
    // Chỉ lưu Session nếu Timer đang chạy, hoặc đang Tạm dừng
    if (isRunning || startPauseBtn.textContent === '▶ Tiếp Tục') { 
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            video: {
                id: currentPlaylist[currentTrackIndex]?.id,
                time: player ? player.getCurrentTime() : 0,
                index: currentTrackIndex,
                isPlaying: player ? (player.getPlayerState() === YT.PlayerState.PLAYING) : false,
                title: currentPlaylist[currentTrackIndex]?.title || 'Không có tiêu đề',
            },
            timer: {
                currentMode: currentMode,
                timeLeft: timeLeft,
                isRunning: isRunning,
                cycleCount: cycleCount,
            }
        }));
    } else {
        sessionStorage.removeItem(SESSION_KEY);
    }
};

const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    settingsRestoreModalEl.style.display = 'none';
    sessionStorage.removeItem(SESSION_KEY);
    pendingRestore = null;
};

// =======================================================
//                   THEME LOGIC
// =======================================================

const loadTheme = () => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        currentTheme = savedTheme;
    }
    applyTheme(currentTheme);
};

const applyTheme = (theme) => {
    document.body.classList.toggle('light-mode', theme === 'light');
    themeToggleBtn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem(THEME_KEY, theme);
    // Cần cập nhật lại Progress Circle để màu background chính xác
    updateDisplay(); 
};

themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
});

// =======================================================
//                   TIMER LOGIC
// =======================================================

const calculateTimerSettings = () => {
    const raw = timerSettings.raw;
    // Tính toán lại tổng số giây
    timerSettings.study = (parseInt(raw.studyHour) * 3600) + (parseInt(raw.studyMinute) * 60);
    timerSettings.shortBreak = parseInt(raw.shortBreak) * 60;
    timerSettings.longBreak = parseInt(raw.longBreak) * 60;
    timerSettings.totalCycles = parseInt(raw.totalCycles);
};

const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    cycleInfoEl.textContent = `Chu kỳ: ${cycleCount} / ${timerSettings.totalCycles}`;
    
    // Cập nhật mode
    let modeText = '';
    let modeClass = '';
    let modeColor = '';

    if (currentMode === 'study') {
        modeText = 'TẬP TRUNG HỌC';
        modeClass = 'study-mode';
        modeColor = 'var(--color-study)';
    } else if (currentMode === 'shortBreak') {
        modeText = 'NGHỈ NGẮN';
        modeClass = 'break-mode';
        modeColor = 'var(--color-break)';
    } else {
        modeText = 'NGHỈ DÀI';
        modeClass = 'break-mode';
        modeColor = 'var(--color-break)';
    }

    timerModeEl.textContent = modeText;
    timerModeEl.className = modeClass;
    
    // Cập nhật Progress Circle
    const totalTime = timerSettings[currentMode];
    // Đảm bảo totalTime > 0 để tránh chia cho 0
    const percentage = totalTime > 0 ? 100 - (timeLeft / totalTime) * 100 : 0;
    
    // Áp dụng màu và phần trăm
    progressCircle.style.background = `conic-gradient(${modeColor} ${percentage}%, var(--circle-bg) ${percentage}%)`;
};

const startTimer = () => {
    if (isRunning) return; 

    isRunning = true;
    startPauseBtn.innerHTML = '⏸ Tạm Dừng';

    intervalId = setInterval(() => {
        timeLeft--;
        updateDisplay();

        if (timeLeft <= 0) {
            clearInterval(intervalId);
            intervalId = null;
            isRunning = false;
            
            // Tự động chuyển mode và chạy lại timer
            switchMode();
        }
    }, 1000);
};

const pauseTimer = (updateButton = true) => {
    clearInterval(intervalId);
    intervalId = null;
    isRunning = false;
    if (updateButton) {
        startPauseBtn.textContent = '▶ Tiếp Tục';
    }
};

const resetTimerToCurrentMode = () => {
    // Đặt lại thời gian ban đầu của mode hiện tại
    initialTime = timerSettings[currentMode];
    timeLeft = initialTime;
    
    // Đảm bảo cập nhật hiển thị ngay lập tức
    updateDisplay();
};

const resetTimer = () => {
    pauseTimer();
    currentMode = 'study';
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    // Đảm bảo timer hiển thị đúng giờ học đã cài đặt
    resetTimerToCurrentMode(); 
};

// =======================================================
//                   MODE SWITCHING & ALARM
// =======================================================

const fadeAlarm = (isStart) => {
    return new Promise((resolve) => {
        // Đặt âm lượng mặc định trước khi phát
        alarmSound.volume = 0.5;
        alarmSound.currentTime = 0;

        if (isStart) {
            alarmSound.play().catch(e => console.log("Lỗi phát âm thanh:", e)); 
        }
        
        // Tạo hiệu ứng Fade Out
        let volume = isStart ? 0.5 : 0;
        const fadeInterval = setInterval(() => {
            volume -= 0.05; // Giảm 0.05 mỗi bước
            if (volume <= 0) {
                alarmSound.pause();
                alarmSound.currentTime = 0; // Đưa về đầu
                clearInterval(fadeInterval);
                resolve();
            }
            alarmSound.volume = Math.max(0, volume);
        }, ALARM_FADE_DURATION / 10); // Giả sử 10 bước trong 1 giây
        
        // Đảm bảo dừng hẳn sau 3 giây (để báo thức chạy đủ)
        setTimeout(() => {
            clearInterval(fadeInterval);
            alarmSound.pause();
            alarmSound.volume = 0.5;
            resolve();
        }, 3000); // 3 giây
    });
};

/**
 * Hàm chuyển mode Pomodoro. 
 * ĐÃ SỬA: Luôn tự động bắt đầu Timer cho mode tiếp theo.
 */
const switchMode = async () => {
    // 1. Dừng Timer và Video (nếu đang chạy)
    pauseTimer(false); 
    if (player && player.pauseVideo) {
        player.pauseVideo();
    }
    
    // 2. Phát và chờ báo thức kết thúc (3 giây)
    await fadeAlarm(true); 
    
    // 3. Tự động phát lại video sau khi báo thức xong
    if (player && currentPlaylist.length > 0 && player.playVideo) {
        // Chỉ phát lại nếu video đang ở trạng thái dừng (Paused) hoặc sẵn sàng (Cued)
        if (player.getPlayerState() === YT.PlayerState.PAUSED || player.getPlayerState() === YT.PlayerState.ENDED || player.getPlayerState() === YT.PlayerState.CUED) {
            player.playVideo();
        }
    }

    // 4. Chuyển Mode và Cập nhật Chu kỳ 
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

    // 5. Reset và Cập nhật hiển thị cho mode mới
    resetTimerToCurrentMode(); 
    
    // 6. TỰ ĐỘNG BẮT ĐẦU MODE MỚI
    startTimer();
};


// =======================================================
//                   YOUTUBE PLAYER LOGIC
// =======================================================

function onYouTubeIframeAPIReady() {
    // Tạo Player nếu có playlist
    if (currentPlaylist.length > 0) {
        createPlayer(currentPlaylist[0].id);
    } else {
        // Nếu không có playlist, hiện placeholder
        document.getElementById('player-placeholder').style.display = 'flex';
    }

    // Sau khi API sẵn sàng, chạy kiểm tra khôi phục
    checkRestoreStatus();
}

function createPlayer(videoId, startSeconds = 0) {
    // Ẩn placeholder
    document.getElementById('player-placeholder').style.display = 'none';

    player = new YT.Player('youtube-player', {
        videoId: videoId,
        playerVars: {
            'controls': 1,
            'rel': 0,
            'modestbranding': 1,
            'start': startSeconds,
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    if (pendingRestore && pendingRestore.session?.video?.id === event.target.getVideoData().video_id) {
        // Nếu đang trong quá trình khôi phục, logic sẽ được xử lý qua Modal
        // Không tự động phát ở đây
    } else if (currentPlaylist.length > 0 && currentTrackIndex === -1) {
        // Lần đầu load trang mà không có session cũ
        currentTrackIndex = 0;
        document.getElementById('playlist-list').querySelector('li')?.classList.add('current-track');
    }
    
    // Sau khi player ready, kiểm tra xem có cần khôi phục settings/session không
    if (pendingRestore?.settings && !pendingRestore.session) {
         showSettingsRestorePhase(pendingRestore.settings);
    } else if (pendingRestore?.session && !pendingRestore.settings) {
         showVideoRestorePhase(); // Chỉ hiển thị Video Restore nếu không có Settings Restore
    } else if (pendingRestore?.settings && pendingRestore.session) {
         showSettingsRestorePhase(pendingRestore.settings); // Ưu tiên Settings trước
    }
}

function onPlayerStateChange(event) {
    // Tự động chuyển bài khi kết thúc (State 0)
    if (event.data === YT.PlayerState.ENDED) {
        playNextTrack();
    }
    // Cập nhật nút Play/Pause
    const playPauseIcon = document.getElementById('btn-play-pause').querySelector('i');
    if (event.data === YT.PlayerState.PLAYING) {
        playPauseIcon.className = 'fas fa-pause';
    } else {
        playPauseIcon.className = 'fas fa-play';
    }
    // Lưu session khi trạng thái thay đổi
    saveSession(); 
}

const playVideoAtIndex = (index, autoPlay = true, startSeconds = 0) => {
    if (index >= 0 && index < currentPlaylist.length) {
        currentTrackIndex = index;
        const videoId = currentPlaylist[index].id;
        
        // Cập nhật class current-track trên giao diện
        document.querySelectorAll('.playlist-list li').forEach((li, i) => {
            li.classList.toggle('current-track', i === index);
        });

        // Nếu Player đã tồn tại, load video mới
        if (player && player.loadVideoById) {
            player.loadVideoById({
                'videoId': videoId,
                'startSeconds': startSeconds
            });
            if (!autoPlay) {
                player.pauseVideo();
            }
        } else {
            // Nếu chưa có Player, tạo Player mới
            createPlayer(videoId, startSeconds);
        }
        
        document.getElementById('player-placeholder').style.display = 'none';
    }
};

const playNextTrack = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex, true, 0);
};

const playPrevTrack = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex, true, 0);
};

// =======================================================
//                   PLAYLIST & UI LOGIC
// =======================================================

const renderPlaylist = () => {
    playlistListEl.innerHTML = ''; // Clear cũ
    if (currentPlaylist.length === 0) {
        document.getElementById('player-placeholder').style.display = 'flex';
        return;
    } else {
         document.getElementById('player-placeholder').style.display = 'none';
    }

    currentPlaylist.forEach((track, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;
        li.classList.toggle('current-track', index === currentTrackIndex);
        
        // 1. Tiêu đề
        const titleSpan = document.createElement('span');
        titleSpan.textContent = `${index + 1}. ${track.title}`;
        titleSpan.title = track.title;
        titleSpan.addEventListener('click', () => {
            playVideoAtIndex(index, true, 0);
        });

        // 2. Nút Xóa
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Xóa khỏi Playlist';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeSong(index);
        });

        // 3. Nút Kéo (Drag Handle)
        const dragHandle = document.createElement('button');
        dragHandle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
        dragHandle.title = 'Kéo để sắp xếp';
        dragHandle.classList.add('drag-handle');
        dragHandle.addEventListener('mousedown', (e) => e.stopPropagation()); // Ngăn click lan truyền

        li.appendChild(dragHandle);
        li.appendChild(titleSpan);
        li.appendChild(deleteBtn);
        
        // Kéo và Thả (Drag and Drop)
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);

        playlistListEl.appendChild(li);
    });
};

const removeSong = (index) => {
    currentPlaylist.splice(index, 1);
    
    // Cập nhật currentTrackIndex sau khi xóa
    if (currentTrackIndex === index) {
        currentTrackIndex = -1; // Đánh dấu là không có bài nào đang phát
    } else if (currentTrackIndex > index) {
        currentTrackIndex--; // Giảm index nếu bài đang phát nằm sau bài bị xóa
    }
    
    savePlaylist();
    renderPlaylist();
    
    // Nếu xóa hết, hiển thị placeholder
    if (currentPlaylist.length === 0) {
        document.getElementById('player-placeholder').style.display = 'flex';
        if(player && player.stopVideo) player.stopVideo();
    } else if (currentTrackIndex === -1) {
        // Tự động chọn bài đầu tiên nếu bài đang phát bị xóa
        playVideoAtIndex(0, false, 0);
    }
};

const addSong = async (url) => {
    errorEl.textContent = '';
    const videoId = getYouTubeId(url);
    if (!videoId) {
        errorEl.textContent = 'Lỗi: URL không hợp lệ hoặc không tìm thấy Video ID.';
        return;
    }

    // Kiểm tra trùng lặp
    if (currentPlaylist.some(track => track.id === videoId)) {
        errorEl.textContent = 'Video này đã có trong Playlist.';
        return;
    }

    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}${encodeURIComponent(url)}&format=json`);
        const data = await response.json();
        
        const newTrack = {
            id: videoId,
            title: data.title,
            thumbnail: data.thumbnail_url
        };
        
        currentPlaylist.push(newTrack);
        savePlaylist();
        renderPlaylist();
        urlInputEl.value = '';

        // Tự động load và play bài đầu tiên nếu playlist trống
        if (currentPlaylist.length === 1) {
            currentTrackIndex = 0;
            playVideoAtIndex(0, true, 0);
        }
        
    } catch (e) {
        errorEl.textContent = 'Lỗi: Không thể lấy thông tin video từ YouTube.';
        console.error("Lỗi fetch YouTube oEmbed:", e);
    }
};


// =======================================================
//                   DRAG & DROP LOGIC
// =======================================================

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.classList.add('dragging'), 0);
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation(); 
    this.classList.remove('drag-over');

    if (draggedItem !== this) {
        const fromIndex = parseInt(draggedItem.dataset.index);
        const toIndex = parseInt(this.dataset.index);

        // Di chuyển trong mảng JS
        const [movedItem] = currentPlaylist.splice(fromIndex, 1);
        currentPlaylist.splice(toIndex, 0, movedItem);

        // Cập nhật currentTrackIndex
        if (currentTrackIndex === fromIndex) {
            currentTrackIndex = toIndex;
        } else if (fromIndex < currentTrackIndex && toIndex >= currentTrackIndex) {
            currentTrackIndex--;
        } else if (fromIndex > currentTrackIndex && toIndex <= currentTrackIndex) {
            currentTrackIndex++;
        }
        
        savePlaylist();
        renderPlaylist();
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.playlist-list li').forEach(item => item.classList.remove('drag-over'));
    draggedItem = null;
}

// =======================================================
//                   MODAL RESTORE LOGIC
// =======================================================

const showSettingsRestorePhase = (settings) => {
    // Hiển thị thông tin cài đặt cũ
    const infoEl = document.getElementById('settings-restore-info');
    infoEl.innerHTML = `
        <p><strong>Học:</strong> ${settings.studyHour} giờ ${settings.studyMinute} phút</p>
        <p><strong>Nghỉ Ngắn:</strong> ${settings.shortBreak} phút</p>
        <p><strong>Nghỉ Dài:</strong> ${settings.longBreak} phút</p>
        <p><strong>Chu kỳ:</strong> ${settings.totalCycles} lần</p>
    `;

    settingsRestoreModalEl.style.display = 'flex';
};

const showVideoRestorePhase = () => {
    const { video } = pendingRestore.session;
    
    // Thêm data vào nút restore để sử dụng sau
    btnRestoreVideo.dataset.time = video.time;
    btnRestoreVideo.dataset.index = video.index;
    btnRestoreVideo.dataset.play = video.isPlaying;

    document.getElementById('video-restore-info').innerHTML = `
        <p><strong>Bài hát:</strong> ${video.title}</p>
        <p><strong>Thời gian:</strong> ${formatTime(Math.floor(video.time))}</p>
    `;
    
    videoRestoreModalEl.style.display = 'flex';
};

const showTimerRestorePhase = () => {
    if (!pendingRestore || !pendingRestore.session) {
        closeAllModalsAndClearSession();
        return;
    }
    
    const { timer } = pendingRestore.session;
    
    document.getElementById('timer-restore-info').innerHTML = `
        <p><strong>Chế độ:</strong> ${timer.currentMode === 'study' ? 'Học' : 'Nghỉ'}</p>
        <p><strong>Còn lại:</strong> ${formatTime(timer.timeLeft)}</p>
        <p><strong>Chu kỳ:</strong> ${timer.cycleCount}</p>
        <p><strong>Trạng thái:</strong> ${timer.isRunning ? 'Đang chạy' : 'Tạm dừng'}</p>
    `;
    
    timerRestoreModalEl.style.display = 'flex';
};

const checkRestoreStatus = () => {
    // Đã load settings và session trong init.
    // Xử lý logic hiển thị modal trong onPlayerReady.
    // Nếu không có player, ta vẫn cần hiển thị modal settings
    if (!player && pendingRestore?.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
    } else if (!player && pendingRestore?.session) {
        // Cần Player để load video trước khi hỏi khôi phục Video
        // Nếu không có Player, ta chỉ có thể hỏi về Timer
        showTimerRestorePhase();
    }
};

// =======================================================
//                   EVENT LISTENERS
// =======================================================

// Timer Events
startPauseBtn.addEventListener('click', () => {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
});

resetBtn.addEventListener('click', resetTimer);

// SỬA LỖI: Bỏ tham số trong switchMode để nó luôn tự động chạy Timer tiếp theo
skipBtn.addEventListener('click', () => switchMode()); 

// Player Controls
document.getElementById('btn-add-song').addEventListener('click', () => {
    addSong(urlInputEl.value.trim());
});

document.getElementById('btn-play-pause').addEventListener('click', () => {
    if (!player) return;
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
        player.pauseVideo();
    } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED || state === YT.PlayerState.CUED) {
        player.playVideo();
    } else if (currentPlaylist.length > 0 && currentTrackIndex === -1) {
        // Nếu chưa load bài nào, load bài đầu tiên
        playVideoAtIndex(0, true, 0);
    }
});

document.getElementById('btn-next').addEventListener('click', playNextTrack);
document.getElementById('btn-prev').addEventListener('click', playPrevTrack);


// Input Settings Events
const handleSettingsChange = (e) => {
    let value = parseInt(e.target.value);
    if (isNaN(value) || value < 0) {
        value = 0;
    }
    e.target.value = value;
    
    // Lưu giá trị thô
    if (e.target.id === 'study-hour') timerSettings.raw.studyHour = value;
    if (e.target.id === 'study-minute') timerSettings.raw.studyMinute = value;
    if (e.target.id === 'short-break') timerSettings.raw.shortBreak = value;
    if (e.target.id === 'long-break') timerSettings.raw.longBreak = value;
    if (e.target.id === 'total-cycles') timerSettings.raw.totalCycles = value;

    // Tái tính toán và lưu
    calculateTimerSettings();
    saveSettings();

    // Nếu đang ở trạng thái dừng, cập nhật lại thời gian hiển thị
    if (!isRunning) {
        resetTimerToCurrentMode();
    }
};

// Dùng event 'input' thay vì 'change' để cập nhật nhanh hơn
studyHourInput.addEventListener('input', handleSettingsChange);
studyMinuteInput.addEventListener('input', handleSettingsChange);
shortBreakInput.addEventListener('input', handleSettingsChange);
longBreakInput.addEventListener('input', handleSettingsChange);
totalCyclesInput.addEventListener('input', handleSettingsChange);


// Modal Buttons Events
// 1. Settings Restore
btnRestoreSettings.onclick = () => {
    // Nếu có session cũ, chuyển sang hỏi khôi phục session
    if (pendingRestore.session) {
        settingsRestoreModalEl.style.display = 'none';
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};

btnSkipSettings.onclick = () => {
    // Bỏ qua settings cũ, dùng settings hiện tại trên giao diện
    // (Settings hiện tại là mặc định hoặc đã được người dùng chỉnh)
    settingsRestoreModalEl.style.display = 'none';

    // Đặt lại thời gian theo setting mới nhất
    calculateTimerSettings();
    resetTimerToCurrentMode();

    if (pendingRestore.session) {
        showVideoRestorePhase();
    } else {
        closeAllModalsAndClearSession();
    }
};


// 2. Video Restore
btnRestoreVideo.onclick = (e) => {
    const startTime = parseFloat(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    const wasPlaying = e.target.dataset.play === 'true'; 
    
    if (player && currentPlaylist.length > index) {
        // Khôi phục video và play/pause đúng trạng thái đã lưu
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

// 3. Timer Restore
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore.session;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    
    // Đảm bảo settings đã được load/khôi phục từ settings modal
    calculateTimerSettings(); 
    
    // Đặt lại initialTime cho Progress Circle
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
    
    // Nếu đã load xong settings và session, onYouTubeIframeAPIReady sẽ gọi checkRestoreStatus()
    if (typeof YT === 'undefined' || !YT.Player) {
        // Nếu YT API chưa sẵn sàng, onYouTubeIframeAPIReady sẽ lo việc này
    } else {
        // Nếu YT API đã sẵn sàng (trường hợp hiếm)
        checkRestoreStatus(); 
    }
    
    // Đảm bảo thời gian hiển thị ban đầu đúng (dựa trên settings mới nhất)
    resetTimerToCurrentMode();
};

// Chạy Init (Bắt đầu chương trình)
init();
